(function (root) {
  "use strict";

  const VERSION = 1;

  function normalizeCoordinateSpace(value) {
    const width = Number(value?.width);
    const height = Number(value?.height);
    if (!Number.isFinite(width) || width <= 0) return null;
    if (!Number.isFinite(height) || height <= 0) return null;
    return {
      version: Number(value?.version) || VERSION,
      width,
      height,
    };
  }

  function getFeatureCoordinateSpace(feature) {
    return normalizeCoordinateSpace({
      width: feature?.properties?.imageWidth,
      height: feature?.properties?.imageHeight,
    });
  }

  function getGeoJSONCoordinateSpace(geoJSON) {
    return normalizeCoordinateSpace(
      geoJSON?.petroImage?.annotationCoordinateSpace ||
        geoJSON?.annotationCoordinateSpace,
    );
  }

  function scaleCoordinateTree(coordinates, scaleX, scaleY) {
    if (!Array.isArray(coordinates)) return coordinates;
    if (
      coordinates.length >= 2 &&
      Number.isFinite(Number(coordinates[0])) &&
      Number.isFinite(Number(coordinates[1]))
    ) {
      return coordinates.map((value, index) => {
        if (index === 0) return Number(value) * scaleX;
        if (index === 1) return Number(value) * scaleY;
        return value;
      });
    }
    return coordinates.map((coordinate) =>
      scaleCoordinateTree(coordinate, scaleX, scaleY),
    );
  }

  function annotationToDisplayPoint(point, annotationSpace, displaySpace) {
    const annotation = normalizeCoordinateSpace(annotationSpace);
    const display = normalizeCoordinateSpace(displaySpace);
    if (!annotation || !display) return null;
    return {
      x: (Number(point?.x) * display.width) / annotation.width,
      y: (Number(point?.y) * display.height) / annotation.height,
    };
  }

  function displayToAnnotationPoint(point, displaySpace, annotationSpace) {
    const annotation = normalizeCoordinateSpace(annotationSpace);
    const display = normalizeCoordinateSpace(displaySpace);
    if (!annotation || !display) return null;
    return {
      x: (Number(point?.x) * annotation.width) / display.width,
      y: (Number(point?.y) * annotation.height) / display.height,
    };
  }

  function migrateFeatureToCoordinateSpace(
    feature,
    targetCoordinateSpace,
    fallbackSourceCoordinateSpace = null,
  ) {
    const target = normalizeCoordinateSpace(targetCoordinateSpace);
    if (!target || !feature || typeof feature !== "object") return feature;

    const source =
      getFeatureCoordinateSpace(feature) ||
      normalizeCoordinateSpace(fallbackSourceCoordinateSpace) ||
      target;
    const scaleX = target.width / source.width;
    const scaleY = target.height / source.height;
    const properties = { ...(feature.properties || {}) };
    const xLabel = Number(properties.xLabel);
    const yLabel = Number(properties.yLabel);

    if (Number.isFinite(xLabel)) properties.xLabel = xLabel * scaleX;
    if (Number.isFinite(yLabel)) properties.yLabel = yLabel * scaleY;
    properties.imageWidth = target.width;
    properties.imageHeight = target.height;

    return {
      ...feature,
      geometry: feature.geometry
        ? {
            ...feature.geometry,
            coordinates: scaleCoordinateTree(
              feature.geometry.coordinates,
              scaleX,
              scaleY,
            ),
          }
        : feature.geometry,
      properties,
    };
  }

  root.PetroImageAnnotationCoordinates = Object.freeze({
    VERSION,
    normalizeCoordinateSpace,
    getFeatureCoordinateSpace,
    getGeoJSONCoordinateSpace,
    scaleCoordinateTree,
    annotationToDisplayPoint,
    displayToAnnotationPoint,
    migrateFeatureToCoordinateSpace,
  });
})(typeof window !== "undefined" ? window : globalThis);
