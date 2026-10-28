const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Could not find ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not parse ${name}`);
}

function runFunctions(names, context) {
  vm.runInNewContext(names.map(functionSource).join("\n"), context);
  return context;
}

test("segmenteverygrain AOI inserts vertices in display-image coordinates", () => {
  const context = runFunctions(["insertUnsupervisedAoiVertex"], {
    getUnsupervisedAoiEdgeHit: () => ({ insertIndex: 1 }),
    getDisplayImagePointFromViewerPixel: () => ({ x: 250, y: 125 }),
    getImagePointFromViewerPixel: () => {
      throw new Error("annotation coordinates must not be used for this AOI");
    },
    unsupervisedAoiImagePoints: [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 500, y: 500 },
    ],
    unsupervisedAoiSelectedVertexIndex: null,
    syncUnsupervisedAoiRectFromPoints() {},
    updateUnsupervisedAoiPreview() {},
    setUnsupervisedSegmentStatus() {},
    updateUnsupervisedSegmentControls() {},
  });

  assert.equal(context.insertUnsupervisedAoiVertex({ x: 20, y: 10 }), true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.unsupervisedAoiImagePoints[1])),
    { x: 250, y: 125 },
  );
});

test("display AOIs share the current tiled-image coordinate conversion", () => {
  const displayImage = {
    viewportToImageCoordinates: ({ x, y }) => ({ x: x * 4, y: y * 5 }),
  };
  const context = runFunctions(
    [
      "getDisplayImagePointFromViewerPixel",
      "getPorosityImagePointFromViewerPixel",
    ],
    {
      viewer: {
        world: { getItemAt: () => displayImage },
        viewport: {
          pointFromPixel: ({ x, y }) => ({ x: x + 1, y: y + 2 }),
        },
      },
    },
  );

  assert.deepEqual(
    JSON.parse(
      JSON.stringify(context.getPorosityImagePointFromViewerPixel({ x: 9, y: 8 })),
    ),
    { x: 40, y: 50 },
  );
});

test("window pointer coordinates are localized before annotation conversion", () => {
  class Point {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
  }
  let convertedPixel = null;
  const context = runFunctions(
    ["getViewerPixelFromClientPoint", "getImagePointFromPointerEvent"],
    {
      OpenSeadragon: { Point },
      viewerContainer: {
        getBoundingClientRect: () => ({ left: 120, top: 75 }),
      },
      getImagePointFromViewerPixel(pixel) {
        convertedPixel = pixel;
        return { x: pixel.x * 2, y: pixel.y * 3 };
      },
    },
  );

  const imagePoint = context.getImagePointFromPointerEvent({
    clientX: 150,
    clientY: 95,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(convertedPixel)), { x: 30, y: 20 });
  assert.deepEqual(JSON.parse(JSON.stringify(imagePoint)), { x: 60, y: 60 });
});
