(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) root.PetroDerivedPreviewOverlay = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createAbortError() {
    const error = new Error("Derived preview tile request was canceled.");
    error.name = "AbortError";
    return error;
  }

  function getDerivedSlotDisplayState(options = {}) {
    const checked = Boolean(options.checked);
    const previewReplacesRaw = Boolean(
      options.active && options.previewEnabled,
    );
    return {
      derivedVisible: checked && previewReplacesRaw,
      rawVisible: checked && !previewReplacesRaw,
    };
  }

  function getDerivedTileContext2D(tile) {
    if (tile?.context2D?.canvas) return tile.context2D;
    const cached = tile?.cacheImageRecord?.getRenderedContext?.();
    if (cached?.canvas) return cached;
    return cached?.getContext?.("2d") || null;
  }

  function buildScalarHistogram(valueArrays, options = {}) {
    const arrays = Array.from(valueArrays || []).filter(
      (values) => values?.length,
    );
    if (!arrays.length) return null;
    const binCount = Math.max(2, Math.round(options.binCount || 256));
    const maxSamples = Math.max(1, Math.round(options.maxSamples || 100000));
    const totalValues = arrays.reduce((sum, values) => sum + values.length, 0);
    const stride = Math.max(1, Math.ceil(totalValues / maxSamples));
    let observedMin = Infinity;
    let observedMax = -Infinity;
    let sampleCount = 0;
    arrays.forEach((values) => {
      for (let index = 0; index < values.length; index += stride) {
        const value = Number(values[index]);
        if (!Number.isFinite(value)) continue;
        observedMin = Math.min(observedMin, value);
        observedMax = Math.max(observedMax, value);
        sampleCount += 1;
      }
    });
    if (!sampleCount) return null;

    const requestedMin = Number(options.min);
    const requestedMax = Number(options.max);
    let min = Number.isFinite(requestedMin) ? requestedMin : observedMin;
    let max = Number.isFinite(requestedMax) ? requestedMax : observedMax;
    if (!(max > min)) {
      const padding = Math.max(Math.abs(min) * 0.01, 0.5);
      min -= padding;
      max += padding;
    }
    const bins = new Uint32Array(binCount);
    const span = max - min;
    arrays.forEach((values) => {
      for (let index = 0; index < values.length; index += stride) {
        const value = Number(values[index]);
        if (!Number.isFinite(value)) continue;
        const normalized = (value - min) / span;
        const bin = Math.max(
          0,
          Math.min(binCount - 1, Math.floor(normalized * binCount)),
        );
        bins[bin] += 1;
      }
    });
    return { bins, min, max, observedMin, observedMax, sampleCount };
  }

  class DerivedPreviewOverlay {
    constructor(options) {
      this.OpenSeadragon = options.OpenSeadragon;
      this.viewer = options.viewer;
      this.onProgress = options.onProgress || (() => {});
      this.onReady = options.onReady || (() => {});
      this.generation = 0;
      this.state = null;
    }

    isActiveFor(tileSet) {
      return Boolean(this.state && this.state.tileSet === tileSet);
    }

    get item() {
      return this.state?.item || null;
    }

    stop() {
      this.generation += 1;
      const state = this.state;
      this.state = null;
      if (!state) return;
      state.controllers.forEach((controller) => {
        controller.abort();
        controller.petroFinishCanceledRequest?.();
      });
      state.controllers.clear();
      this._removeItem(state.item);
    }

    start(options) {
      this.stop();
      const generation = this.generation;
      const OpenSeadragon = this.OpenSeadragon;
      const referenceImage = options.referenceImage;
      const referenceSource = referenceImage?.source;
      const contentSize = referenceImage?.getContentSize?.();
      if (!referenceSource || !contentSize?.x || !contentSize?.y) {
        return Promise.reject(
          new Error("The selected source image is not ready for preview."),
        );
      }

      const state = {
        generation,
        tileSet: options.tileSet,
        key: options.key,
        referenceImage,
        requestTile: options.requestTile,
        item: null,
        controllers: new Set(),
        requestedKeys: new Set(),
        completedKeys: new Set(),
      };
      this.state = state;

      const tileSource = new OpenSeadragon.TileSource({
        width: contentSize.x,
        height: contentSize.y,
        tileSize:
          referenceSource.tileSize ||
          referenceSource.getTileWidth?.(referenceSource.maxLevel) ||
          256,
        tileOverlap: Number(referenceSource.tileOverlap) || 0,
        minLevel: Number(referenceSource.minLevel) || 0,
        maxLevel: Number.isFinite(Number(referenceSource.maxLevel))
          ? Number(referenceSource.maxLevel)
          : Math.ceil(
              Math.log2(Math.max(Number(contentSize.x), Number(contentSize.y))),
            ),
      });
      tileSource.getTileUrl = (level, x, y) =>
        `petro-derived://${encodeURIComponent(options.key)}/${generation}/${level}/${x}/${y}`;
      tileSource.getTileHashKey = (level, x, y) =>
        `petro-derived:${options.key}:${generation}:${level}:${x}:${y}`;
      tileSource.hasTransparency = () => false;
      tileSource.createTileCache = (cache, data) => {
        cache._data = data;
      };
      tileSource.destroyTileCache = (cache) => {
        cache._data = null;
      };
      tileSource.getTileCacheData = (cache) => cache._data;
      tileSource.getTileCacheDataAsImage = (cache) => cache._data;
      tileSource.getTileCacheDataAsContext2D = (cache) =>
        cache._data?.getContext?.("2d") || null;
      tileSource.downloadTileStart = (job) => {
        const tile = job.tile;
        const tileKey = `${tile.level}/${tile.x}/${tile.y}`;
        const controller = new AbortController();
        job.userData.controller = controller;
        job.userData.finished = false;
        job.userData.finish = (canvas, error = null) => {
          if (job.userData.finished) return;
          job.userData.finished = true;
          job.finish(canvas, null, error);
        };
        job.userData.finishCanceled = () => {
          if (job.userData.finished) return;
          const canvas = document.createElement("canvas");
          canvas.width = 1;
          canvas.height = 1;
          const context = canvas.getContext("2d");
          context.fillStyle = "black";
          context.fillRect(0, 0, 1, 1);
          job.userData.finish(canvas);
        };
        controller.petroFinishCanceledRequest = job.userData.finishCanceled;
        state.controllers.add(controller);
        state.requestedKeys.add(tileKey);
        this._reportProgress(state);

        Promise.resolve(
          state.requestTile({
            level: tile.level,
            x: tile.x,
            y: tile.y,
            signal: controller.signal,
            generation,
          }),
        )
          .then((canvas) => {
            if (
              controller.signal.aborted ||
              this.state !== state ||
              this.generation !== generation
            ) {
              throw createAbortError();
            }
            if (!canvas?.width || !canvas?.height) {
              throw new Error("Derived preview returned an empty tile.");
            }
            state.completedKeys.add(tileKey);
            this._reportProgress(state);
            job.userData.finish(canvas);
          })
          .catch((error) => {
            if (error?.name === "AbortError" || controller.signal.aborted) {
              job.userData.finishCanceled();
              return;
            }
            job.userData.finish(
              null,
              error?.message || "Derived tile failed.",
            );
          })
          .finally(() => state.controllers.delete(controller));
      };
      tileSource.downloadTileAbort = (job) => {
        job.userData?.controller?.abort();
        job.userData?.finishCanceled?.();
      };

      return new Promise((resolve, reject) => {
        const worldItemCount = this.viewer.world.getItemCount();
        const worldIndex = Number.isFinite(options.worldIndex)
          ? Math.max(0, Math.min(options.worldIndex, worldItemCount))
          : worldItemCount;
        this.viewer.addTiledImage({
          tileSource,
          opacity: 0,
          index: worldIndex,
          success: (event) => {
            if (this.state !== state || this.generation !== generation) {
              this._removeItem(event.item);
              reject(createAbortError());
              return;
            }
            state.item = event.item;
            this.syncGeometry();
            this.onReady(state);
            resolve(state);
          },
          error: (event) => {
            if (this.state === state) this.state = null;
            reject(
              new Error(event?.message || "Could not create derived preview."),
            );
          },
        });
      });
    }

    syncGeometry() {
      const state = this.state;
      if (!state?.item || !state.referenceImage) return;
      const bounds = state.referenceImage.getBounds?.(true);
      if (bounds) {
        state.item.setPosition(bounds.getTopLeft(), true);
        state.item.setWidth(bounds.width, true);
      }
      const rotation = state.referenceImage.getRotation?.(true);
      if (Number.isFinite(rotation)) state.item.setRotation(rotation, true);
      if (
        typeof state.referenceImage.getFlip === "function" &&
        typeof state.item.setFlip === "function"
      ) {
        state.item.setFlip(state.referenceImage.getFlip());
      }
    }

    setDisplay(options = {}) {
      const item = this.state?.item;
      if (!item) return;
      this.syncGeometry();
      item.setOpacity(options.visible === false ? 0 : options.opacity ?? 1);
      if (options.imagePolygon?.length >= 3) {
        item.setCroppingPolygons([options.imagePolygon]);
      } else {
        item.resetCroppingPolygons();
      }
    }

    _removeItem(item) {
      if (!item) return;
      const world = this.viewer?.world;
      if (world?.getIndexOfItem?.(item) >= 0) {
        world.removeItem(item);
      } else {
        item.destroy?.();
      }
    }

    _reportProgress(state) {
      if (this.state !== state) return;
      this.onProgress({
        requested: state.requestedKeys.size,
        completed: state.completedKeys.size,
        pending: Math.max(
          0,
          state.requestedKeys.size - state.completedKeys.size,
        ),
        key: state.key,
      });
    }
  }

  return {
    DerivedPreviewOverlay,
    createAbortError,
    buildScalarHistogram,
    getDerivedSlotDisplayState,
    getDerivedTileContext2D,
  };
});
