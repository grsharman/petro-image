(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PetroLocalThickness = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  const INF = 1e20;

  function edt1d(input, output, length, offset, stride, workspace) {
    const v = workspace.v;
    const z = workspace.z;
    let firstFinite = -1;
    for (let q = 0; q < length; q += 1) {
      if (input[offset + q * stride] < INF / 2) {
        firstFinite = q;
        break;
      }
    }
    if (firstFinite < 0) {
      for (let q = 0; q < length; q += 1) output[offset + q * stride] = INF;
      return;
    }
    let k = 0;
    v[0] = firstFinite;
    z[0] = -INF;
    z[1] = INF;
    for (let q = firstFinite + 1; q < length; q += 1) {
      const fq = input[offset + q * stride];
      if (fq >= INF / 2) continue;
      const intersection = (site) => {
        const fsite = input[offset + site * stride];
        return ((fq + q * q) - (fsite + site * site)) / (2 * (q - site));
      };
      let s = intersection(v[k]);
      while (s <= z[k]) {
        k -= 1;
        const vk = v[k];
        s = intersection(vk);
      }
      k += 1;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < length; q += 1) {
      while (z[k + 1] < q) k += 1;
      const delta = q - v[k];
      output[offset + q * stride] =
        delta * delta + input[offset + v[k] * stride];
    }
  }

  function squaredEuclideanDistanceToZero(binary, width, height) {
    const size = width * height;
    if (binary.length !== size) throw new Error("Mask dimensions do not match.");
    const first = new Float64Array(size);
    const second = new Float64Array(size);
    for (let i = 0; i < size; i += 1) first[i] = binary[i] ? INF : 0;
    const workspace = {
      v: new Int32Array(Math.max(width, height)),
      z: new Float64Array(Math.max(width, height) + 1),
    };
    for (let y = 0; y < height; y += 1) {
      edt1d(first, second, width, y * width, 1, workspace);
    }
    for (let x = 0; x < width; x += 1) {
      edt1d(second, first, height, x, width, workspace);
    }
    return first;
  }

  function padMask(mask, width, height) {
    const paddedWidth = width + 2;
    const paddedHeight = height + 2;
    const padded = new Uint8Array(paddedWidth * paddedHeight);
    for (let y = 0; y < height; y += 1) {
      padded.set(mask.subarray(y * width, (y + 1) * width), (y + 1) * paddedWidth + 1);
    }
    return { padded, paddedWidth, paddedHeight };
  }

  function logarithmicRadii(maxRadius, count) {
    if (!(maxRadius > 0)) return [];
    const bins = Math.max(1, Math.floor(count || 25));
    if (maxRadius <= 1 || bins === 1) return [maxRadius];
    const radii = [];
    const logMax = Math.log(maxRadius);
    for (let i = 0; i < bins; i += 1) {
      radii.push(Math.exp(logMax * (1 - i / (bins - 1))));
    }
    radii[radii.length - 1] = 1;
    return radii;
  }

  // Mirrors PoreSpy local_thickness(method="dt"): for each descending radius,
  // find valid circle centres from the pore EDT, then dilate those centres.
  function localThicknessDt(mask, width, height, options = {}) {
    if (mask.length !== width * height) throw new Error("Mask dimensions do not match.");
    const { padded, paddedWidth, paddedHeight } = padMask(mask, width, height);
    const poreDistance2 = squaredEuclideanDistanceToZero(
      padded,
      paddedWidth,
      paddedHeight
    );
    let maxRadius = 0;
    for (let y = 1; y <= height; y += 1) {
      for (let x = 1; x <= width; x += 1) {
        const radius = Math.sqrt(poreDistance2[y * paddedWidth + x]);
        if (radius > maxRadius) maxRadius = radius;
      }
    }
    const radii = Array.isArray(options.sizes)
      ? [...options.sizes].filter((value) => value > 0).sort((a, b) => b - a)
      : logarithmicRadii(maxRadius, options.sizes || 25);
    const result = new Float32Array(width * height);
    const centres = new Uint8Array(padded.length);
    for (let radiusIndex = 0; radiusIndex < radii.length; radiusIndex += 1) {
      const radius = radii[radiusIndex];
      const radius2 = radius * radius;
      centres.fill(1);
      let hasCentre = false;
      for (let y = 1; y <= height; y += 1) {
        for (let x = 1; x <= width; x += 1) {
          const index = y * paddedWidth + x;
          if (poreDistance2[index] + 1e-9 >= radius2) {
            centres[index] = 0;
            hasCentre = true;
          }
        }
      }
      if (!hasCentre) continue;
      const centreDistance2 = squaredEuclideanDistanceToZero(
        centres,
        paddedWidth,
        paddedHeight
      );
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const outputIndex = y * width + x;
          if (
            mask[outputIndex] &&
            result[outputIndex] === 0 &&
            centreDistance2[(y + 1) * paddedWidth + x + 1] <= radius2 + 1e-9
          ) {
            result[outputIndex] = radius;
          }
        }
      }
      if (typeof options.onProgress === "function") {
        options.onProgress((radiusIndex + 1) / radii.length);
      }
    }
    return { values: result, radii, maxRadius };
  }

  function localThicknessExact(mask, width, height, options = {}) {
    if (mask.length !== width * height) throw new Error("Mask dimensions do not match.");
    const { padded, paddedWidth, paddedHeight } = padMask(mask, width, height);
    const poreDistance2 = squaredEuclideanDistanceToZero(padded, paddedWidth, paddedHeight);
    const maxWork = options.maxWork || 250000000;
    let estimatedWork = 0;
    let maxRadius = 0;
    let poreCount = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!mask[y * width + x]) continue;
        poreCount += 1;
        const radius2 = poreDistance2[(y + 1) * paddedWidth + x + 1];
        estimatedWork += Math.PI * radius2;
        if (radius2 > maxRadius * maxRadius) maxRadius = Math.sqrt(radius2);
        if (estimatedWork > maxWork) {
          throw new Error("Exact local thickness is too expensive for this mask. Choose Approximate 25, 50, or 100 radii.");
        }
      }
    }
    const result = new Float32Array(mask.length);
    let processed = 0;
    const progressStep = Math.max(1, Math.floor(poreCount / 100));
    for (let cy = 0; cy < height; cy += 1) {
      for (let cx = 0; cx < width; cx += 1) {
        const centreIndex = cy * width + cx;
        if (!mask[centreIndex]) continue;
        const radius2 = poreDistance2[(cy + 1) * paddedWidth + cx + 1];
        const radius = Math.sqrt(radius2);
        const reach = Math.ceil(radius);
        const minY = Math.max(0, cy - reach);
        const maxY = Math.min(height - 1, cy + reach);
        const minX = Math.max(0, cx - reach);
        const maxX = Math.min(width - 1, cx + reach);
        for (let y = minY; y <= maxY; y += 1) {
          const dy2 = (y - cy) ** 2;
          for (let x = minX; x <= maxX; x += 1) {
            const index = y * width + x;
            if (mask[index] && dy2 + (x - cx) ** 2 <= radius2 + 1e-9 && radius > result[index]) {
              result[index] = radius;
            }
          }
        }
        processed += 1;
        if (processed % progressStep === 0 && typeof options.onProgress === "function") {
          options.onProgress(Math.min(1, processed / Math.max(1, poreCount)));
        }
      }
    }
    if (typeof options.onProgress === "function") options.onProgress(1);
    return { values: result, radii: null, maxRadius, estimatedWork };
  }

  function distanceToBoundary(mask, width, height) {
    const { padded, paddedWidth, paddedHeight } = padMask(mask, width, height);
    const distance2 = squaredEuclideanDistanceToZero(padded, paddedWidth, paddedHeight);
    const values = new Float32Array(mask.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (mask[index]) values[index] = Math.sqrt(distance2[(y + 1) * paddedWidth + x + 1]);
      }
    }
    return values;
  }

  function connectedComponents(mask, width, height, localThickness) {
    const labels = new Int32Array(mask.length);
    const components = [];
    const queue = new Int32Array(mask.length);
    let nextLabel = 0;
    for (let start = 0; start < mask.length; start += 1) {
      if (!mask[start] || labels[start]) continue;
      nextLabel += 1;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      labels[start] = nextLabel;
      let area = 0;
      let perimeter = 0;
      let sumX = 0;
      let sumY = 0;
      let sumXX = 0;
      let sumYY = 0;
      let sumXY = 0;
      let sumThickness = 0;
      let maxThickness = 0;
      let minX = width;
      let maxX = 0;
      let minY = height;
      let maxY = 0;
      let touchesEdge = false;
      while (head < tail) {
        const index = queue[head++];
        const x = index % width;
        const y = Math.floor(index / width);
        area += 1;
        sumX += x; sumY += y; sumXX += x * x; sumYY += y * y; sumXY += x * y;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        touchesEdge ||= x === 0 || y === 0 || x === width - 1 || y === height - 1;
        const thickness = localThickness[index] || 0;
        sumThickness += thickness;
        maxThickness = Math.max(maxThickness, thickness);
        const neighbors = [index - 1, index + 1, index - width, index + width];
        const valid = [x > 0, x < width - 1, y > 0, y < height - 1];
        for (let direction = 0; direction < 4; direction += 1) {
          if (!valid[direction] || !mask[neighbors[direction]]) {
            perimeter += 1;
          } else if (!labels[neighbors[direction]]) {
            labels[neighbors[direction]] = nextLabel;
            queue[tail++] = neighbors[direction];
          }
        }
      }
      const cx = sumX / area;
      const cy = sumY / area;
      const mu20 = sumXX / area - cx * cx;
      const mu02 = sumYY / area - cy * cy;
      const mu11 = sumXY / area - cx * cy;
      components.push({
        id: nextLabel,
        area,
        perimeter,
        equivalentDiameter: 2 * Math.sqrt(area / Math.PI),
        circularity: perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0,
        aspectRatio: Math.max(maxX - minX + 1, maxY - minY + 1) / Math.max(1, Math.min(maxX - minX + 1, maxY - minY + 1)),
        orientation: 0.5 * Math.atan2(2 * mu11, mu20 - mu02) * 180 / Math.PI,
        meanThickness: sumThickness / area,
        maxThickness,
        touchesEdge,
      });
    }
    return { labels, components };
  }

  function chordLengths(mask, width, height) {
    const horizontal = [];
    const vertical = [];
    for (let y = 0; y < height; y += 1) {
      let run = 0;
      for (let x = 0; x <= width; x += 1) {
        if (x < width && mask[y * width + x]) run += 1;
        else if (run) { horizontal.push(run); run = 0; }
      }
    }
    for (let x = 0; x < width; x += 1) {
      let run = 0;
      for (let y = 0; y <= height; y += 1) {
        if (y < height && mask[y * width + x]) run += 1;
        else if (run) { vertical.push(run); run = 0; }
      }
    }
    return { horizontal: new Float32Array(horizontal), vertical: new Float32Array(vertical) };
  }

  return {
    logarithmicRadii,
    localThicknessDt,
    localThicknessExact,
    squaredEuclideanDistanceToZero,
    distanceToBoundary,
    connectedComponents,
    chordLengths,
  };
});
