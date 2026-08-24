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

test("annotation coordinate trees scale independently onto display pixels", () => {
  const api = loadApi();
  const annotationSpace = { width: 1000, height: 500 };
  const displaySpace = { width: 2000, height: 2000 };
  const polygon = [
    [
      [100, 100],
      [200, 100],
      [200, 200],
      [100, 100],
    ],
  ];

  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        api.annotationToDisplayCoordinateTree(
          polygon,
          annotationSpace,
          displaySpace,
        ),
      ),
    ),
    [
      [
        [200, 400],
        [400, 400],
        [400, 800],
        [200, 400],
      ],
    ],
  );
});

test("rotation preserves rendered shape when x and y use different scales", () => {
  const api = loadApi();
  const annotationSpace = { width: 200, height: 100 };
  const displaySpace = { width: 100, height: 100 };
  const center = { x: 100, y: 50 };
  const coordinates = [
    [120, 50],
    [100, 60],
  ];

  const rotated = api.rotateCoordinateTreeForDisplay(
    coordinates,
    center,
    Math.PI / 2,
    annotationSpace,
    displaySpace,
  );

  assert.ok(Math.abs(rotated[0][0] - 100) < 1e-10);
  assert.ok(Math.abs(rotated[0][1] - 60) < 1e-10);
  assert.ok(Math.abs(rotated[1][0] - 80) < 1e-10);
  assert.ok(Math.abs(rotated[1][1] - 50) < 1e-10);

  const beforeDistances = coordinates.map((point) => {
    const displayPoint = api.annotationToDisplayPoint(
      { x: point[0], y: point[1] },
      annotationSpace,
      displaySpace,
    );
    const displayCenter = api.annotationToDisplayPoint(
      center,
      annotationSpace,
      displaySpace,
    );
    return Math.hypot(
      displayPoint.x - displayCenter.x,
      displayPoint.y - displayCenter.y,
    );
  });
  const afterDistances = rotated.map((point) => {
    const displayPoint = api.annotationToDisplayPoint(
      { x: point[0], y: point[1] },
      annotationSpace,
      displaySpace,
    );
    const displayCenter = api.annotationToDisplayPoint(
      center,
      annotationSpace,
      displaySpace,
    );
    return Math.hypot(
      displayPoint.x - displayCenter.x,
      displayPoint.y - displayCenter.y,
    );
  });

  beforeDistances.forEach((distance, index) => {
    assert.ok(Math.abs(distance - afterDistances[index]) < 1e-10);
  });
});
