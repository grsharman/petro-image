const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "annotation-label-point.js"),
  "utf8",
);

function loadApi() {
  const window = {};
  vm.runInNewContext(source, { window, globalThis: window });
  return window.PetroImageAnnotationLabelPoint;
}

const api = loadApi();

test("polygon label point uses the topmost vertex regardless of ring start", () => {
  const point = api.getTopmostGeometryPoint({
    type: "Polygon",
    coordinates: [
      [
        [10, 80],
        [40, 90],
        [55, 12],
        [20, 30],
        [10, 80],
      ],
    ],
  });

  assert.deepEqual(Array.from(point), [55, 12]);
});

test("multipolygon label point uses the highest exterior point", () => {
  const point = api.getTopmostGeometryPoint({
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [0, 40],
          [10, 20],
          [20, 40],
          [0, 40],
        ],
      ],
      [
        [
          [30, 60],
          [40, 5],
          [50, 60],
          [30, 60],
        ],
      ],
    ],
  });

  assert.deepEqual(Array.from(point), [40, 5]);
});

test("polygon label point ignores interior rings", () => {
  const point = api.getTopmostGeometryPoint({
    type: "Polygon",
    coordinates: [
      [
        [0, 10],
        [20, 10],
        [20, 30],
        [0, 10],
      ],
      [
        [5, 1],
        [10, 15],
        [15, 15],
        [5, 1],
      ],
    ],
  });

  assert.deepEqual(Array.from(point), [0, 10]);
});
