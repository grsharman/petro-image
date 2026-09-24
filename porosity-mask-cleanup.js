(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PetroPorosityMaskCleanup = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  function fillEnclosedBackground(mask, valid, width, height, options = {}) {
    const size = width * height;
    if (mask.length !== size || valid.length !== size) {
      throw new Error("Mask dimensions do not match.");
    }
    const protectedMask = options.protectedMask || null;
    if (protectedMask && protectedMask.length !== size) {
      throw new Error("Protected mask dimensions do not match.");
    }
    const maxPixels = Number(options.maxPixels);
    const fillValue = Number(options.fillValue) > 0
      ? Number(options.fillValue)
      : 1;
    if (!(maxPixels >= 1)) {
      return { inclusionCount: 0, filledPixels: 0 };
    }

    const visited = new Uint8Array(size);
    const queue = new Int32Array(size);
    let inclusionCount = 0;
    let filledPixels = 0;

    for (let start = 0; start < size; start += 1) {
      if (!valid[start] || mask[start] || visited[start]) continue;
      let head = 0;
      let tail = 0;
      let touchesBoundary = false;
      let containsProtectedPixel = false;
      queue[tail++] = start;
      visited[start] = 1;

      while (head < tail) {
        const index = queue[head++];
        const x = index % width;
        const y = Math.floor(index / width);
        containsProtectedPixel ||= Boolean(protectedMask?.[index]);
        const neighbors = [
          x > 0 ? index - 1 : -1,
          x + 1 < width ? index + 1 : -1,
          y > 0 ? index - width : -1,
          y + 1 < height ? index + width : -1,
        ];
        for (const neighbor of neighbors) {
          if (neighbor < 0 || !valid[neighbor]) {
            touchesBoundary = true;
          } else if (!mask[neighbor] && !visited[neighbor]) {
            visited[neighbor] = 1;
            queue[tail++] = neighbor;
          }
        }
      }

      if (touchesBoundary || containsProtectedPixel || tail > maxPixels) {
        continue;
      }
      inclusionCount += 1;
      filledPixels += tail;
      for (let index = 0; index < tail; index += 1) {
        mask[queue[index]] = fillValue;
      }
    }
    return { inclusionCount, filledPixels };
  }

  return { fillEnclosedBackground };
});
