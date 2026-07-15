const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "annotation-coordinate-space.js"),
  "utf8",
);

function loadApi() {
  const window = {};
  vm.runInNewContext(source, { window, globalThis: window });
  return window.PetroImageAnnotationCoordinates;
}

test("legacy annotations scale from saved image dimensions", () => {
  const api = loadApi();
  const migrated = api.migrateFeatureToCoordinateSpace(
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [1000, 500],
            [2000, 500],
            [2000, 1000],
            [1000, 500],
          ],
        ],
      },
      properties: {
        xLabel: 1500,
        yLabel: 750,
        imageWidth: 2000,
        imageHeight: 1000,
        pixelsPerMeter: 200,
      },
    },
    { width: 20000, height: 10000 },
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(migrated.geometry.coordinates[0][0])),
    [10000, 5000],
  );
  assert.equal(migrated.properties.xLabel, 15000);
  assert.equal(migrated.properties.yLabel, 7500);
  assert.equal(migrated.properties.imageWidth, 20000);
  assert.equal(migrated.properties.imageHeight, 10000);
  assert.equal(migrated.properties.pixelsPerMeter, 200);
});

test("collection coordinate metadata takes precedence over feature lookup", () => {
  const api = loadApi();
  const coordinateSpace = api.getGeoJSONCoordinateSpace({
    type: "FeatureCollection",
    petroImage: {
      annotationCoordinateSpace: {
        version: 1,
        width: 20000,
        height: 10000,
      },
    },
    features: [],
  });

  assert.deepEqual(JSON.parse(JSON.stringify(coordinateSpace)), {
    version: 1,
    width: 20000,
    height: 10000,
  });
});

test("coordinates remain unchanged when tile-set order changes resolution only", () => {
  const api = loadApi();
  const feature = {
    type: "Feature",
    geometry: { type: "Point", coordinates: [10000, 5000] },
    properties: {
      xLabel: 10000,
      yLabel: 5000,
      imageWidth: 20000,
      imageHeight: 10000,
    },
  };
  const migrated = api.migrateFeatureToCoordinateSpace(feature, {
    width: 20000,
    height: 10000,
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(migrated.geometry.coordinates)),
    [10000, 5000],
  );
  const originalDisplayPoint = api.annotationToDisplayPoint(
    { x: 10000, y: 5000 },
    { width: 20000, height: 10000 },
    { width: 20000, height: 10000 },
  );
  const sobelDisplayPoint = api.annotationToDisplayPoint(
    { x: 10000, y: 5000 },
    { width: 20000, height: 10000 },
    { width: 2000, height: 1000 },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(originalDisplayPoint)), {
    x: 10000,
    y: 5000,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(sobelDisplayPoint)), {
    x: 1000,
    y: 500,
  });
  assert.equal(originalDisplayPoint.x / 20000, sobelDisplayPoint.x / 2000);
  assert.equal(originalDisplayPoint.y / 10000, sobelDisplayPoint.y / 1000);
});
