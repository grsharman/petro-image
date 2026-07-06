#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const supportedGeometryTypes = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
]);

const defaultAnnotationGroup = {
  groupId: "default",
  groupName: "Default",
  groupColor: "#ffcc00",
  groupVisible: true,
  groupLocked: false,
};

const builtInFixtures = [
  {
    name: "feature-collection-point-app-style",
    data: featureCollection([
      feature("Point", [10, 20], {
        uuid: "point-app",
        label: "App point",
        xLabel: 10,
        yLabel: 20,
      }),
    ]),
  },
  {
    name: "feature-collection-point-generic",
    data: featureCollection([
      feature("Point", [10, 20], {
        label: "Generic point",
        source: "geojson.io-like",
      }),
    ]),
  },
  {
    name: "line-string-generic",
    data: featureCollection([
      feature("LineString", [
        [0, 0],
        [10, 10],
      ], {
        label: "Generic line",
      }),
    ]),
  },
  {
    name: "multi-line-string-generic",
    data: featureCollection([
      feature("MultiLineString", [
        [
          [0, 0],
          [10, 10],
        ],
        [
          [2, 8],
          [8, 2],
        ],
      ], {
        label: "Generic multiline",
      }),
    ]),
  },
  {
    name: "multi-line-string-app-style",
    data: featureCollection([
      feature("MultiLineString", [
        [
          [0, 0],
          [10, 10],
        ],
        [
          [2, 8],
          [8, 2],
        ],
      ], {
        uuid: "multiline-app",
        label: "App multiline",
        xLabel: 0,
        yLabel: 0,
      }),
    ]),
  },
  {
    name: "polygon-with-hole-generic",
    data: featureCollection([
      feature("Polygon", [
        [
          [0, 0],
          [20, 0],
          [20, 20],
          [0, 20],
          [0, 0],
        ],
        [
          [5, 5],
          [10, 5],
          [10, 10],
          [5, 10],
          [5, 5],
        ],
      ], {
        label: "Generic polygon with hole",
      }),
    ]),
  },
  {
    name: "multi-polygon-generic",
    data: featureCollection([
      feature("MultiPolygon", [
        [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
        ],
        [
          [
            [20, 20],
            [30, 20],
            [30, 30],
            [20, 30],
            [20, 20],
          ],
        ],
      ], {
        label: "Generic multipolygon",
      }),
    ]),
  },
  {
    name: "single-feature-point",
    data: feature("Point", [1, 2], { label: "Standalone feature" }),
  },
  {
    name: "null-geometry",
    expectUnsupported: true,
    data: featureCollection([
      { type: "Feature", geometry: null, properties: { label: "Null geometry" } },
    ]),
  },
  {
    name: "geometry-collection",
    expectUnsupported: true,
    data: featureCollection([
      {
        type: "Feature",
        geometry: {
          type: "GeometryCollection",
          geometries: [
            { type: "Point", coordinates: [1, 2] },
            {
              type: "LineString",
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
          ],
        },
        properties: { label: "Geometry collection" },
      },
    ]),
  },
  {
    name: "coordinate-z-values",
    data: featureCollection([
      feature("LineString", [
        [0, 0, 5],
        [10, 10, 7],
      ], {
        label: "3D coordinates",
      }),
    ]),
  },
];

function featureCollection(features) {
  return { type: "FeatureCollection", features };
}

function feature(type, coordinates, properties = {}) {
  return {
    type: "Feature",
    geometry: { type, coordinates },
    properties,
  };
}

function parseJSON(input) {
  if (typeof input !== "string") return input;
  return JSON.parse(input);
}

function generateUniqueId() {
  return "test-" + Math.random().toString(36).slice(2, 10);
}

function normalizeAnnotationProperties(properties = {}) {
  return {
    ...properties,
    uuid: properties.uuid || generateUniqueId(),
    visible: properties.visible === undefined ? true : Boolean(properties.visible),
    locked: properties.locked === undefined ? false : Boolean(properties.locked),
    groupId: properties.groupId || defaultAnnotationGroup.groupId,
    groupName: properties.groupName || defaultAnnotationGroup.groupName,
    groupColor: properties.groupColor || defaultAnnotationGroup.groupColor,
    groupVisible:
      properties.groupVisible === undefined
        ? defaultAnnotationGroup.groupVisible
        : Boolean(properties.groupVisible),
    groupLocked:
      properties.groupLocked === undefined
        ? defaultAnnotationGroup.groupLocked
        : Boolean(properties.groupLocked),
  };
}

function getAnnotationFeaturesFromGeoJSONCurrent(geoJSONData) {
  const geoJSON = parseJSON(geoJSONData);
  if (!geoJSON) return [];
  if (geoJSON.type === "FeatureCollection") {
    return Array.isArray(geoJSON.features) ? geoJSON.features.filter(Boolean) : [];
  }
  if (geoJSON.type === "Feature") return [geoJSON];
  const features = Array.isArray(geoJSON)
    ? geoJSON
    : geoJSON.features || Object.values(geoJSON);
  return Array.isArray(features) ? features.filter(Boolean) : [];
}

function getAnnotationFeaturesFromGeoJSONGeoJSONAware(geoJSONData) {
  const geoJSON = parseJSON(geoJSONData);
  if (!geoJSON) return [];
  if (geoJSON.type === "FeatureCollection") return geoJSON.features || [];
  if (geoJSON.type === "Feature") return [geoJSON];
  return [];
}

function isFiniteCoordPair(value) {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(Number(value[0])) &&
    Number.isFinite(Number(value[1]))
  );
}

function visitCoordinatePairs(value, pairs = []) {
  if (isFiniteCoordPair(value)) {
    pairs.push(value);
    return pairs;
  }
  if (Array.isArray(value)) {
    value.forEach((child) => visitCoordinatePairs(child, pairs));
  }
  return pairs;
}

function hasValidCoordinateStructure(type, coordinates) {
  if (type === "Point") return isFiniteCoordPair(coordinates);
  if (type === "MultiPoint") {
    return Array.isArray(coordinates) && coordinates.every(isFiniteCoordPair);
  }
  if (type === "LineString") {
    return (
      Array.isArray(coordinates) &&
      coordinates.length >= 2 &&
      coordinates.every(isFiniteCoordPair)
    );
  }
  if (type === "MultiLineString") {
    return (
      Array.isArray(coordinates) &&
      coordinates.length > 0 &&
      coordinates.every((line) => hasValidCoordinateStructure("LineString", line))
    );
  }
  if (type === "Polygon") {
    return (
      Array.isArray(coordinates) &&
      coordinates.length > 0 &&
      coordinates.every(
        (ring) =>
          Array.isArray(ring) &&
          ring.length >= 4 &&
          ring.every(isFiniteCoordPair)
      )
    );
  }
  if (type === "MultiPolygon") {
    return (
      Array.isArray(coordinates) &&
      coordinates.length > 0 &&
      coordinates.every((polygon) =>
        hasValidCoordinateStructure("Polygon", polygon)
      )
    );
  }
  return false;
}

function hasFiniteLabelPosition(properties) {
  return Number.isFinite(Number(properties.xLabel)) &&
    Number.isFinite(Number(properties.yLabel));
}

function inferLabelPosition(properties, geometry) {
  if (hasFiniteLabelPosition(properties)) return properties;
  const firstCoordinate = visitCoordinatePairs(geometry?.coordinates)[0];
  if (!firstCoordinate) return properties;
  return {
    ...properties,
    xLabel: Number(firstCoordinate[0]),
    yLabel: Number(firstCoordinate[1]),
  };
}

function analyzeFeature(feature, index) {
  const errors = [];
  const warnings = [];

  if (!feature || feature.type !== "Feature") {
    errors.push("not a GeoJSON Feature");
    return { index, geometryType: "n/a", importedCount: 0, errors, warnings };
  }

  const geometry = feature.geometry;
  if (!geometry) {
    errors.push("missing geometry");
    return { index, geometryType: "null", importedCount: 0, errors, warnings };
  }
  const properties = normalizeAnnotationProperties(
    inferLabelPosition(feature.properties || {}, geometry)
  );

  const { type, coordinates } = geometry;
  if (!supportedGeometryTypes.has(type)) {
    errors.push(`unsupported geometry type: ${type}`);
    return { index, geometryType: type || "n/a", importedCount: 0, errors, warnings };
  }

  if (!hasValidCoordinateStructure(type, coordinates)) {
    errors.push("invalid coordinate structure");
    return { index, geometryType: type, importedCount: 0, errors, warnings };
  }

  if (type === "MultiPoint") {
    const duplicateRisk = coordinates.some((_, pointIndex) =>
      pointIndex > 0 && properties.uuid === `${properties.uuid}-${pointIndex}`
    );
    if (duplicateRisk) warnings.push("multipoint derived UUID may collide");
  }

  if (type !== "MultiPoint" && !hasFiniteLabelPosition(properties)) {
    warnings.push("missing xLabel/yLabel and no finite coordinate could be used as fallback");
  }

  const importedCount = type === "MultiPoint" ? coordinates.length : 1;
  return { index, geometryType: type, importedCount, errors, warnings };
}

function analyzeGeoJSON(name, data, options = {}) {
  const currentFeatures = getAnnotationFeaturesFromGeoJSONCurrent(data);
  const geoJSONFeatures = getAnnotationFeaturesFromGeoJSONGeoJSONAware(data);
  const results = currentFeatures.map(analyzeFeature);
  const errors = [];
  const warnings = [];

  if (geoJSONFeatures.length > 0 && currentFeatures.length !== geoJSONFeatures.length) {
    errors.push(
      `current extractor sees ${currentFeatures.length} item(s), GeoJSON-aware extractor sees ${geoJSONFeatures.length} feature(s)`
    );
  }

  results.forEach((result) => {
    result.errors.forEach((error) =>
      errors.push(`feature ${result.index + 1}: ${error}`)
    );
    result.warnings.forEach((warning) =>
      warnings.push(`feature ${result.index + 1} ${result.geometryType}: ${warning}`)
    );
  });

  const importedCount = results.reduce(
    (sum, result) => sum + (result.errors.length ? 0 : result.importedCount),
    0
  );
  return {
    name,
    expectUnsupported: Boolean(options.expectUnsupported),
    sourceFeatureCount: currentFeatures.length,
    importedCount,
    geometryTypes: [...new Set(results.map((result) => result.geometryType))],
    errors,
    warnings,
  };
}

function loadFileFixtures(paths) {
  return paths.map((filePath) => ({
    name: filePath,
    expectUnsupported: false,
    data: fs.readFileSync(filePath, "utf8"),
  }));
}

function formatResult(result) {
  const status =
    result.errors.length && result.expectUnsupported
      ? "UNSUPPORTED"
      : result.errors.length
        ? "FAIL"
        : result.warnings.length
          ? "WARN"
          : "PASS";
  const types = result.geometryTypes.length ? result.geometryTypes.join(", ") : "none";
  const lines = [
    `${status} ${result.name} (${result.sourceFeatureCount} source item(s), ${result.importedCount} imported annotation(s), ${types})`,
  ];
  result.errors.forEach((error) => lines.push(`  error: ${error}`));
  result.warnings.forEach((warning) => lines.push(`  warning: ${warning}`));
  return lines.join("\n");
}

const args = process.argv.slice(2);
const fixtures =
  args.length > 0
    ? loadFileFixtures(args.map((arg) => path.resolve(arg)))
    : builtInFixtures;

const results = fixtures.map(({ name, data, expectUnsupported }) =>
  analyzeGeoJSON(name, data, { expectUnsupported })
);
results.forEach((result) => {
  console.log(formatResult(result));
});

const unsupported = results.filter(
  (result) => result.errors.length && result.expectUnsupported
).length;
const failed = results.filter(
  (result) => result.errors.length && !result.expectUnsupported
).length;
const warned = results.filter((result) => !result.errors.length && result.warnings.length).length;
const passed = results.length - failed - warned - unsupported;
console.log(`\n${passed} passed, ${warned} warned, ${unsupported} unsupported, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
