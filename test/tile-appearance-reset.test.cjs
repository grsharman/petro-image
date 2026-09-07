const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "index.js"),
  "utf8",
);

function extractFunction(name) {
  const functionStart = source.indexOf(`function ${name}(`);
  assert.notEqual(functionStart, -1, `${name} should exist`);
  const bodyStart = source.indexOf("{", functionStart);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(functionStart, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function loadResetApi() {
  const context = {
    createSourceContextForLoadedTile() {
      throw new Error("An existing original context should be reused");
    },
  };
  vm.runInNewContext(
    `${extractFunction("isUsableSourceTileContext")}\n` +
      `${extractFunction("restoreLoadedTileSourceContext")}\n` +
      `${extractFunction("forEachLoadedTileInTileSet")}\n` +
      `${extractFunction("restoreLoadedTileSetSourceContexts")}\n` +
      "this.resetApi = { restoreLoadedTileSetSourceContexts };",
    context,
  );
  return context.resetApi;
}

test("appearance reset restores and evicts processed contexts for every loaded tile", () => {
  const { restoreLoadedTileSetSourceContexts } = loadResetApi();
  const visibleOriginal = { canvas: {} };
  const offscreenOriginal = { canvas: {} };
  const makeLoadedTile = (originalContext) => ({
    loaded: true,
    context2D: { canvas: { petroImageGeneratedPreviewContext: true } },
    petroImageOriginalContext: originalContext,
    petroImageProcessedContext: { key: "adjusted", context: {} },
    petroImagePendingProcessedContext: { key: "pending", context: {} },
    hasTransparency: true,
  });
  const visibleTile = makeLoadedTile(visibleOriginal);
  const offscreenTile = makeLoadedTile(offscreenOriginal);
  const tileSet = {
    tiles: [
      {
        image: {
          tilesMatrix: {
            0: { 0: { 0: visibleTile } },
            4: { 9: { 7: offscreenTile } },
          },
        },
      },
    ],
  };

  const restored = restoreLoadedTileSetSourceContexts(tileSet);

  assert.equal(restored, 2);
  assert.equal(visibleTile.context2D, visibleOriginal);
  assert.equal(offscreenTile.context2D, offscreenOriginal);
  for (const loadedTile of [visibleTile, offscreenTile]) {
    assert.equal(loadedTile.petroImageProcessedContext, null);
    assert.equal(loadedTile.petroImagePendingProcessedContext, null);
    assert.equal(loadedTile.hasTransparency, false);
  }
});

test("returning to the default appearance restores source tiles immediately", () => {
  const tileSet = {};
  const calls = [];
  const context = {
    tileAppearanceReprocessQueue: new Set([tileSet]),
    invalidateTileAppearanceReprocess: () => calls.push("invalidate"),
    shouldProcessTileSet: () => false,
    updateTileSetAppearanceRenderingHints: () => calls.push("hints"),
    restoreLoadedTileSetSourceContexts: () => {
      calls.push("restore");
      return 3;
    },
    displayImages: () => calls.push("display"),
    viewer: { forceRedraw: () => calls.push("redraw") },
    updateTransformPreviewAfterReprocess: (_tileSet, stats) =>
      calls.push(`stats:${stats.processed}`),
    scheduleTransformHistogramRefresh: () => calls.push("histogram"),
    startNextTileAppearanceReprocess: () => calls.push("queued"),
  };
  vm.runInNewContext(
    `${extractFunction("scheduleTileAppearanceReprocess")}\n` +
      "this.scheduleTileAppearanceReprocess = scheduleTileAppearanceReprocess;",
    context,
  );

  context.scheduleTileAppearanceReprocess(tileSet);

  assert.deepEqual(calls, [
    "invalidate",
    "hints",
    "restore",
    "display",
    "redraw",
    "stats:3",
    "histogram",
  ]);
  assert.equal(context.tileAppearanceReprocessQueue.has(tileSet), false);
});
