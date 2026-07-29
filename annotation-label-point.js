(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) root.PetroImageAnnotationLabelPoint = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function getFinitePoint(coordinate) {
    if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
    const x = Number(coordinate[0]);
    const y = Number(coordinate[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }

  function getPolygonExteriorRings(geometry) {
    if (geometry?.type === "Polygon") {
      return Array.isArray(geometry.coordinates?.[0])
        ? [geometry.coordinates[0]]
        : [];
    }
    if (geometry?.type === "MultiPolygon") {
      return (geometry.coordinates || [])
        .map((polygon) => polygon?.[0])
        .filter(Array.isArray);
    }
    return [];
  }

  function getTopmostGeometryPoint(geometry) {
    let topmostPoint = null;
    getPolygonExteriorRings(geometry).forEach((ring) => {
      ring.forEach((coordinate) => {
        const point = getFinitePoint(coordinate);
        if (!point) return;
        if (!topmostPoint || point[1] < topmostPoint[1]) {
          topmostPoint = point;
        }
      });
    });
    return topmostPoint;
  }

  return {
    getTopmostGeometryPoint,
  };
});
