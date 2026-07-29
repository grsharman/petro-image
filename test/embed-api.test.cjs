const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "embed-api.js"), "utf8");

function loadApi() {
  const window = {};
  window.parent = {};
  vm.runInNewContext(source, { window, globalThis: window });
  return { api: window.PetroImageEmbedApi, window };
}

test("only accepts versioned commands from the embedding parent", () => {
  const { api, window } = loadApi();
  const accepted = api.validateEnvelope(
    {
      source: window.parent,
      origin: "https://example.org",
      data: {
        source: "petro-image-host",
        version: 1,
        type: "viewer.setAnnotations",
      },
    },
    { parentWindow: window.parent, parentOrigin: "https://example.org" },
  );
  assert.equal(accepted.ok, true);

  const wrongOrigin = api.validateEnvelope(
    {
      source: window.parent,
      origin: "https://other.example",
      data: {
        source: "petro-image-host",
        version: 1,
        type: "viewer.setAnnotations",
      },
    },
    { parentWindow: window.parent, parentOrigin: "https://example.org" },
  );
  assert.equal(wrongOrigin.ok, false);
  assert.equal(wrongOrigin.ignored, true);
});

test("advertises and validates direct library commands", () => {
  const { api } = loadApi();
  assert.equal(api.COMMANDS.includes("viewer.setLibrary"), true);

  const library = {
    format: "v1",
    samples: [
      {
        title: "Filtered sample",
        groups: ["Teaching"],
        tileSets: [
          {
            label: "PPL",
            tiles: [{ uri: "https://example.org/ppl.dzi" }],
          },
        ],
      },
    ],
  };
  assert.equal(api.validateLibrary(library), library);

  assert.throws(
    () => api.validateLibrary({ samples: [] }),
    (error) => error.code === "invalid_library",
  );
  assert.throws(
    () =>
      api.validateLibrary({
        samples: [{ title: "Missing tiles", tileSets: [] }],
      }),
    (error) => error.code === "invalid_library",
  );
});

test("calculates and merges image-pixel bounds for GeoJSON features", () => {
  const { api } = loadApi();
  const first = api.getFeatureBounds({
    geometry: { type: "Polygon", coordinates: [[[10, 20], [30, 20], [30, 50], [10, 20]]] },
  });
  const second = api.getFeatureBounds({
    geometry: { type: "Point", coordinates: [80, 90] },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(first)), { x: 10, y: 20, width: 20, height: 30 });
  assert.deepEqual(JSON.parse(JSON.stringify(api.mergeBounds([first, second]))), {
    x: 10,
    y: 20,
    width: 70,
    height: 70,
  });
});

test("converts the visible viewport to source-image pixel bounds", () => {
  const { api } = loadApi();
  const bounds = api.getImageBoundsForViewport(
    { x: 1, y: 2, width: 3, height: 4 },
    {
      viewportToImageCoordinates(x, y) {
        return { x: x * 100, y: y * 50 };
      },
    },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(bounds)), {
    x: 100,
    y: 100,
    width: 300,
    height: 200,
  });
});

test("accepts viewport bounds that intersect the image without clamping them", () => {
  const { api } = loadApi();
  const bounds = { x: -25, y: 10, width: 100, height: 80 };

  assert.equal(api.imageBoundsIntersect(bounds, { x: 1000, y: 500 }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(api.normalizeImageBounds(bounds))), bounds);
});

test("rejects viewport bounds that do not intersect the image", () => {
  const { api } = loadApi();

  assert.equal(
    api.imageBoundsIntersect(
      { x: -100, y: 10, width: 100, height: 80 },
      { x: 1000, y: 500 },
    ),
    false,
  );
  assert.equal(
    api.imageBoundsIntersect(
      { x: 1000, y: 10, width: 100, height: 80 },
      { x: 1000, y: 500 },
    ),
    false,
  );
});

test("uses OpenSeadragon rectangle corners when calculating rotated image bounds", () => {
  const { api } = loadApi();
  const bounds = api.getImageBoundsForViewport(
    {
      x: 0,
      y: 0,
      width: 2,
      height: 1,
      getTopLeft: () => ({ x: 0.5, y: -0.5 }),
      getTopRight: () => ({ x: 2.5, y: 0.5 }),
      getBottomRight: () => ({ x: 1.5, y: 1.5 }),
      getBottomLeft: () => ({ x: -0.5, y: 0.5 }),
    },
    {
      viewportToImageCoordinates(x, y) {
        return { x: x * 100, y: y * 100 };
      },
    },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(bounds)), {
    x: -50,
    y: -50,
    width: 300,
    height: 200,
  });
});

test("normalizes independent annotation selection and editing capabilities", () => {
  const { api } = loadApi();
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        api.normalizeAnnotationCapabilities({ canSelect: true, canEdit: false }),
      ),
    ),
    { canSelect: true, canEdit: false, legacyLock: false },
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(api.normalizeAnnotationCapabilities({ readOnly: true })),
    ),
    { canSelect: false, canEdit: false, legacyLock: true },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.normalizeAnnotationCapabilities({}))),
    { canSelect: true, canEdit: true, legacyLock: false },
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        api.normalizeAnnotationCapabilities({ readOnly: true, canSelect: true }),
      ),
    ),
    { canSelect: true, canEdit: false, legacyLock: false },
  );
});

test("normalizes embedded annotation selection modes", () => {
  const { api } = loadApi();
  assert.equal(api.normalizeAnnotationSelectionMode({}), "single");
  assert.equal(api.normalizeAnnotationSelectionMode({ selectionMode: "multiple" }), "multiple");
  assert.equal(api.normalizeAnnotationSelectionMode({ selectionMode: "anything-else" }), "single");
});

test("routes commands and returns request-correlated success events", async () => {
  const { api, window } = loadApi();
  const events = [];
  const controller = api.createController({
    parentWindow: window.parent,
    parentOrigin: "https://example.org",
    postEvent: (type, detail) => events.push({ type, detail }),
    handlers: {
      "viewer.setViewport": async (message) => ({ bounds: api.normalizeImageBounds(message.bounds) }),
    },
  });
  const handled = await controller.handleMessage({
    source: window.parent,
    origin: "https://example.org",
    data: {
      source: "petro-image-host",
      version: 1,
      type: "viewer.setViewport",
      requestId: "question-2-start",
      bounds: { x: 100, y: 200, width: 300, height: 400 },
    },
  });
  assert.equal(handled, true);
  assert.equal(events[0].type, "viewer.commandSucceeded");
  assert.equal(events[0].detail.requestId, "question-2-start");
  assert.deepEqual(JSON.parse(JSON.stringify(events[0].detail.bounds)), {
    x: 100,
    y: 200,
    width: 300,
    height: 400,
  });
});

test("reports invalid viewport commands without throwing across the message boundary", async () => {
  const { api, window } = loadApi();
  const events = [];
  const controller = api.createController({
    parentWindow: window.parent,
    parentOrigin: "https://example.org",
    postEvent: (type, detail) => events.push({ type, detail }),
    handlers: {
      "viewer.setViewport": (message) => api.normalizeImageBounds(message.bounds),
    },
  });
  await controller.handleMessage({
    source: window.parent,
    origin: "https://example.org",
    data: {
      source: "petro-image-host",
      version: 1,
      type: "viewer.setViewport",
      requestId: "bad-bounds",
      bounds: { x: 0, y: 0, width: 0, height: 10 },
    },
  });
  assert.equal(events[0].type, "viewer.commandFailed");
  assert.equal(events[0].detail.error.code, "invalid_viewport");
});
