const test = require("node:test");
const assert = require("node:assert/strict");

const overlayApi = import("../derived-preview-overlay.js").then(
  () => globalThis.PetroDerivedPreviewOverlay,
);

test("derived previews replace only their checked source display slot", async () => {
  const { getDerivedSlotDisplayState } = await overlayApi;
  assert.deepEqual(
    getDerivedSlotDisplayState({
      active: true,
      previewEnabled: true,
      checked: true,
    }),
    { derivedVisible: true, rawVisible: false },
  );
  assert.deepEqual(
    getDerivedSlotDisplayState({
      active: true,
      previewEnabled: false,
      checked: true,
    }),
    { derivedVisible: false, rawVisible: true },
  );
  assert.deepEqual(
    getDerivedSlotDisplayState({
      active: true,
      previewEnabled: true,
      checked: false,
    }),
    { derivedVisible: false, rawVisible: false },
  );
  assert.deepEqual(
    getDerivedSlotDisplayState({
      active: false,
      previewEnabled: true,
      checked: true,
    }),
    { derivedVisible: false, rawVisible: true },
  );
});

test("derived tile contexts are read from OpenSeadragon's custom cache", async () => {
  const { getDerivedTileContext2D } = await overlayApi;
  const directContext = { canvas: {} };
  assert.equal(
    getDerivedTileContext2D({ context2D: directContext }),
    directContext,
  );

  const cachedContext = { canvas: {} };
  assert.equal(
    getDerivedTileContext2D({
      cacheImageRecord: {
        getRenderedContext: () => cachedContext,
      },
    }),
    cachedContext,
  );

  const canvasContext = { canvas: {} };
  const cachedCanvas = { getContext: () => canvasContext };
  assert.equal(
    getDerivedTileContext2D({
      cacheImageRecord: {
        getRenderedContext: () => cachedCanvas,
      },
    }),
    canvasContext,
  );
});

test("scalar histograms bin analytical values in their requested domain", async () => {
  const { buildScalarHistogram } = await overlayApi;
  const histogram = buildScalarHistogram(
    [new Float32Array([0, 45, 90, Number.NaN])],
    { min: 0, max: 90, binCount: 9 },
  );
  assert.equal(histogram.min, 0);
  assert.equal(histogram.max, 90);
  assert.equal(histogram.sampleCount, 3);
  assert.equal(histogram.bins[0], 1);
  assert.equal(histogram.bins[4], 1);
  assert.equal(histogram.bins[8], 1);
});

test("auto-scaled scalar histograms report the observed analytical range", async () => {
  const { buildScalarHistogram } = await overlayApi;
  const histogram = buildScalarHistogram(
    [new Float32Array([60, 75, 120])],
    { binCount: 12 },
  );
  assert.equal(histogram.min, 60);
  assert.equal(histogram.max, 120);
  assert.equal(histogram.observedMin, 60);
  assert.equal(histogram.observedMax, 120);
});

async function createHarness({ deferAttach = false } = {}) {
  const { DerivedPreviewOverlay } = await overlayApi;
  class TileSource {
    constructor(options) {
      Object.assign(this, options);
    }
  }

  const items = [];
  const attachments = [];
  const viewer = {
    world: {
      getItemCount: () => items.length,
      getIndexOfItem: (item) => items.indexOf(item),
      removeItem: (item) => {
        const index = items.indexOf(item);
        if (index >= 0) items.splice(index, 1);
        item.removed = true;
      },
    },
    addTiledImage(options) {
      const item = {
        setPosition() {},
        setWidth() {},
        setRotation() {},
        setFlip() {},
        setOpacity() {},
        resetCroppingPolygons() {},
        destroy() {
          this.destroyed = true;
        },
      };
      const index = Number.isFinite(options.index)
        ? Math.max(0, Math.min(options.index, items.length))
        : items.length;
      items.splice(index, 0, item);
      attachments.push({ options, item });
      if (!deferAttach) options.success({ item });
    },
  };
  const referenceImage = {
    source: { tileSize: 256, tileOverlap: 0, minLevel: 0, maxLevel: 8 },
    getContentSize: () => ({ x: 1024, y: 512 }),
    getBounds: () => ({
      width: 2,
      getTopLeft: () => ({ x: 0, y: 0 }),
    }),
    getRotation: () => 0,
    getFlip: () => false,
  };
  return {
    manager: new DerivedPreviewOverlay({
      OpenSeadragon: { TileSource },
      viewer,
    }),
    viewer,
    items,
    attachments,
    referenceImage,
  };
}

test("a derived overlay is inserted at its source tile-set layer position", async () => {
  const harness = await createHarness();
  const lowerLayer = {};
  const upperLayer = {};
  harness.items.push(lowerLayer, upperLayer);

  await harness.manager.start({
    tileSet: {},
    key: "slotted",
    worldIndex: 1,
    referenceImage: harness.referenceImage,
    requestTile: async () => ({}),
  });

  assert.equal(harness.attachments[0].options.index, 1);
  assert.equal(harness.items[0], lowerLayer);
  assert.equal(harness.items[1], harness.manager.item);
  assert.equal(harness.items[2], upperLayer);
});

test("stopping a preview immediately finishes its in-flight tile jobs", async () => {
  const originalDocument = global.document;
  global.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ fillStyle: "", fillRect() {} }),
    }),
  };
  try {
    const harness = await createHarness();
    await harness.manager.start({
      tileSet: {},
      key: "first",
      referenceImage: harness.referenceImage,
      requestTile: () => new Promise(() => {}),
    });
    const tileSource = harness.attachments[0].options.tileSource;
    let finishCount = 0;
    tileSource.downloadTileStart({
      tile: { level: 4, x: 2, y: 1 },
      userData: {},
      finish(canvas) {
        finishCount += 1;
        assert.equal(canvas.width, 1);
        assert.equal(canvas.height, 1);
      },
    });

    harness.manager.stop();

    assert.equal(finishCount, 1);
    assert.equal(harness.manager.state, null);
    assert.equal(harness.items.length, 0);
  } finally {
    global.document = originalDocument;
  }
});

test("a replaced preview cannot attach a stale overlay item", async () => {
  const harness = await createHarness({ deferAttach: true });
  const firstStart = harness.manager.start({
    tileSet: {},
    key: "first",
    referenceImage: harness.referenceImage,
    requestTile: async () => ({}),
  });
  const secondTileSet = {};
  const secondStart = harness.manager.start({
    tileSet: secondTileSet,
    key: "second",
    referenceImage: harness.referenceImage,
    requestTile: async () => ({}),
  });
  const firstHash = harness.attachments[0].options.tileSource.getTileHashKey(4, 2, 1);
  const secondHash = harness.attachments[1].options.tileSource.getTileHashKey(4, 2, 1);
  assert.notEqual(firstHash, secondHash);

  harness.attachments[0].options.success({ item: harness.attachments[0].item });
  await assert.rejects(firstStart, { name: "AbortError" });
  assert.equal(harness.attachments[0].item.removed, true);

  harness.attachments[1].options.success({ item: harness.attachments[1].item });
  await secondStart;
  assert.equal(harness.manager.state.tileSet, secondTileSet);
  assert.equal(harness.manager.item, harness.attachments[1].item);
});
