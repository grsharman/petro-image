(function initializePetroImageAnnotationInput(global) {
  "use strict";

  function isDoubleClick(previousClick, currentClick, options = {}) {
    if (!previousClick?.position || !currentClick?.position) return false;
    const previousTime = Number(previousClick.time);
    const currentTime = Number(currentClick.time);
    if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) {
      return false;
    }

    const maxDelay = Number(options.maxDelay ?? 300);
    const maxDistance = Number(options.maxDistance ?? 20);
    const delay = currentTime - previousTime;
    const distance = Math.hypot(
      Number(currentClick.position.x) - Number(previousClick.position.x),
      Number(currentClick.position.y) - Number(previousClick.position.y),
    );
    return delay >= 0 && delay < maxDelay && distance <= maxDistance;
  }

  function isVertexClickGesture(press, release, options = {}) {
    if (!press?.position || !release?.position) return false;
    if (
      press.pointerId !== undefined &&
      release.pointerId !== undefined &&
      press.pointerId !== release.pointerId
    ) {
      return false;
    }

    const maxDistance = Number(options.maxDistance ?? 12);
    const distance = Math.hypot(
      Number(release.position.x) - Number(press.position.x),
      Number(release.position.y) - Number(press.position.y),
    );
    return Number.isFinite(distance) && distance <= maxDistance;
  }

  global.PetroImageAnnotationInput = Object.freeze({
    isDoubleClick,
    isVertexClickGesture,
  });
})(typeof window !== "undefined" ? window : globalThis);
