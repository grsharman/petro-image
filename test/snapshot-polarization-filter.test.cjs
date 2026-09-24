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
  const declarationStart = source.slice(functionStart - 6, functionStart) === "async "
    ? functionStart - 6
    : functionStart;
  const bodyStart = source.indexOf(") {", functionStart) + 2;
  assert.ok(bodyStart > 1, `${name} body should exist`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(declarationStart, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function loadSnapshotApi(filterValue) {
  const transform = { polarizationProduct: "xpl_extinction_azimuth" };
  const raster = { values: new Float32Array([20]) };
  let mappedOptions = null;
  const context = {
    snapshotExportFilter: { checked: true },
    transformAzimuthFilter: { value: filterValue },
    tileSets: () => [{}],
    isDefaultTileSetTransform: () => false,
    getTileSetTransform: () => transform,
    getSnapshotSelectionImageRect: () => ({ width: 10, height: 10 }),
    isPolarizationRecipe: () => true,
    getTransformRoseConfig: (settings) =>
      settings.polarizationProduct === "xpl_extinction_azimuth" ? {} : null,
    renderPolarizationRaster: async () => raster,
    applySnapshotLayerAppearance: () => {},
    mapPolarizationRasterToImageData: (_context, _raster, _transform, options) => {
      mappedOptions = options;
    },
    document: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({}),
      }),
    },
  };
  vm.runInNewContext(
    `${extractFunction("shouldMaskUnreliableAzimuthFits")}\n` +
      `${extractFunction("createPolarizationRasterDisplayCanvas")}\n` +
      `${extractFunction("applySnapshotLayerProcessing")}\n` +
      "this.snapshotApi = { applySnapshotLayerProcessing };",
    context,
  );
  return {
    apply: context.snapshotApi.applySnapshotLayerProcessing,
    getMappedOptions: () => mappedOptions,
  };
}

test("Snapshot greys unreliable XPL azimuth fits when Fits is Reliable", async () => {
  const snapshot = loadSnapshotApi("reliable");
  await snapshot.apply({}, 0, { width: 100, height: 100 });
  assert.equal(snapshot.getMappedOptions().maskUnreliable, true);
});

test("Snapshot includes all XPL azimuth fits when Fits is All", async () => {
  const snapshot = loadSnapshotApi("all");
  await snapshot.apply({}, 0, { width: 100, height: 100 });
  assert.equal(snapshot.getMappedOptions().maskUnreliable, false);
});
