(function (root) {
  "use strict";

  function normalizeRotationDegrees(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 0;
    return Math.max(0, Math.min(360, Math.round(numericValue)));
  }

  function getInitialRotationDegrees(sample) {
    return normalizeRotationDegrees(sample?.rotationDegrees);
  }

  function getControlScrollRotationTarget(hasRotationAwareTileSet) {
    return hasRotationAwareTileSet ? "stage" : "image";
  }

  root.PetroImageSampleOrientation = Object.freeze({
    getControlScrollRotationTarget,
    getInitialRotationDegrees,
    normalizeRotationDegrees,
  });
})(typeof window !== "undefined" ? window : globalThis);
