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

  root.PetroImageSampleOrientation = Object.freeze({
    getInitialRotationDegrees,
    normalizeRotationDegrees,
  });
})(typeof window !== "undefined" ? window : globalThis);
