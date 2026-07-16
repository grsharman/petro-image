(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PetroPolarizationAnalysis = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const EPSILON = 1e-10;

  function positiveModulo(value, period) {
    return ((value % period) + period) % period;
  }

  function invert3x3(matrix) {
    const [a, b, c, d, e, f, g, h, i] = matrix;
    const A = e * i - f * h;
    const B = c * h - b * i;
    const C = b * f - c * e;
    const D = f * g - d * i;
    const E = a * i - c * g;
    const F = c * d - a * f;
    const G = d * h - e * g;
    const H = b * g - a * h;
    const I = a * e - b * d;
    const determinant = a * A + b * D + c * G;
    if (!Number.isFinite(determinant) || Math.abs(determinant) <= EPSILON) {
      return null;
    }
    const scale = 1 / determinant;
    return [A, B, C, D, E, F, G, H, I].map((value) => value * scale);
  }

  function createHarmonicModel(anglesDegrees, harmonic) {
    const angles = Array.from(anglesDegrees || [], Number);
    if (angles.length < 3 || angles.some((angle) => !Number.isFinite(angle))) {
      return null;
    }
    const rows = angles.map((angle) => {
      const radians = (angle * Math.PI) / 180;
      return [1, Math.cos(harmonic * radians), Math.sin(harmonic * radians)];
    });
    const normal = new Float64Array(9);
    rows.forEach((row) => {
      for (let r = 0; r < 3; r += 1) {
        for (let c = 0; c < 3; c += 1) {
          normal[r * 3 + c] += row[r] * row[c];
        }
      }
    });
    const inverse = invert3x3(normal);
    if (!inverse) return null;
    const weights = rows.map((_, observation) => {
      return [0, 1, 2].map((coefficient) => {
        let value = 0;
        for (let component = 0; component < 3; component += 1) {
          value += inverse[coefficient * 3 + component] * rows[observation][component];
        }
        return value;
      });
    });
    return { angles, harmonic, rows, weights };
  }

  function fitHarmonicValues(model, values) {
    if (!model || values?.length !== model.angles.length) return null;
    let a = 0;
    let b = 0;
    let c = 0;
    for (let index = 0; index < values.length; index += 1) {
      const value = Number(values[index]);
      if (!Number.isFinite(value)) return null;
      a += model.weights[index][0] * value;
      b += model.weights[index][1] * value;
      c += model.weights[index][2] * value;
    }
    let squaredError = 0;
    for (let index = 0; index < values.length; index += 1) {
      const row = model.rows[index];
      const residual = values[index] - (a + b * row[1] + c * row[2]);
      squaredError += residual * residual;
    }
    const amplitude = Math.hypot(b, c);
    const periodDegrees = 360 / model.harmonic;
    const maximumAzimuth = positiveModulo(
      ((Math.atan2(c, b) * 180) / Math.PI) / model.harmonic,
      periodDegrees,
    );
    return {
      mean: a,
      amplitude,
      minimum: a - amplitude,
      maximum: a + amplitude,
      normalizedModulation: Math.abs(a) <= EPSILON ? Number.NaN : amplitude / Math.abs(a),
      maximumAzimuth,
      minimumAzimuth: positiveModulo(maximumAzimuth + periodDegrees / 2, periodDegrees),
      rmse: Math.sqrt(squaredError / values.length),
      residualDegreesOfFreedom: Math.max(0, values.length - 3),
    };
  }

  function getChannelValue(pixels, offset, channel) {
    switch (channel) {
      case "red": return pixels[offset];
      case "green": return pixels[offset + 1];
      case "blue": return pixels[offset + 2];
      default:
        return 0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2];
    }
  }

  function getProductDefinition(product) {
    const definitions = {
      ppl_modulation: { mode: "ppl", field: "amplitude", unit: "intensity", range: [0, 255] },
      ppl_normalized_modulation: { mode: "ppl", field: "normalizedModulation", unit: "ratio", range: [0, 1] },
      ppl_azimuth: { mode: "ppl", field: "maximumAzimuth", unit: "degrees", range: [0, 180], circular: true },
      ppl_rmse: { mode: "ppl", field: "rmse", unit: "intensity", range: [0, 64] },
      xpl_maximum: { mode: "xpl", field: "maximum", unit: "intensity", range: [0, 255] },
      xpl_minimum: { mode: "xpl", field: "minimum", unit: "intensity", range: [0, 255] },
      xpl_modulation: { mode: "xpl", field: "normalizedModulation", unit: "ratio", range: [0, 1] },
      xpl_extinction_azimuth: { mode: "xpl", field: "minimumAzimuth", unit: "degrees", range: [0, 90], circular: true },
      xpl_rmse: { mode: "xpl", field: "rmse", unit: "intensity", range: [0, 64] },
      xpl_cpl_difference: { mode: "combined", combined: true, unit: "intensity", range: [-255, 255] },
    };
    return definitions[product] || null;
  }

  function calculatePolarizationRaster(stacks, width, height, options = {}) {
    const product = options.product || "ppl_modulation";
    const definition = getProductDefinition(product);
    if (!definition) throw new Error(`Unknown polarization product: ${product}`);
    const channel = options.channel || "luminance";
    const count = width * height;
    const output = new Float32Array(count);
    output.fill(Number.NaN);
    const sourceStack = definition.mode === "combined" ? stacks.xpl : stacks[definition.mode];
    if (!Array.isArray(sourceStack) || sourceStack.length === 0) {
      throw new Error(`The ${definition.mode.toUpperCase()} source is not available.`);
    }
    const angles = definition.mode === "xpl" || definition.mode === "combined"
      ? options.xplAngles
      : definition.mode === "ppl" ? options.pplAngles : null;
    const harmonic = definition.mode === "ppl" ? 2 : 4;
    const model = definition.field || definition.combined
      ? createHarmonicModel(angles, harmonic)
      : null;
    if ((definition.field || definition.combined) && !model) {
      throw new Error("At least three distinct, well-spaced angles are required for this fitted product.");
    }
    const observations = new Float64Array(sourceStack.length);
    let min = Infinity;
    let max = -Infinity;
    for (let pixelIndex = 0; pixelIndex < count; pixelIndex += 1) {
      const offset = pixelIndex * 4;
      for (let imageIndex = 0; imageIndex < sourceStack.length; imageIndex += 1) {
        observations[imageIndex] = getChannelValue(sourceStack[imageIndex], offset, channel);
      }
      let value;
      if (definition.observed === "range") {
        let observedMin = Infinity;
        let observedMax = -Infinity;
        observations.forEach((item) => {
          observedMin = Math.min(observedMin, item);
          observedMax = Math.max(observedMax, item);
        });
        value = observedMax - observedMin;
      } else if (definition.observed === "mean") {
        value = observations.reduce((sum, item) => sum + item, 0) / observations.length;
      } else {
        const fit = fitHarmonicValues(model, observations);
        value = fit?.[definition.field];
        if (definition.combined) {
          const cpl = stacks.cpl;
          if (!Array.isArray(cpl) || cpl.length === 0) value = Number.NaN;
          else value = getChannelValue(cpl[0], offset, channel) - fit.maximum;
        }
      }
      if (Number.isFinite(value)) {
        output[pixelIndex] = value;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
    return {
      values: output,
      min: Number.isFinite(min) ? min : Number.NaN,
      max: Number.isFinite(max) ? max : Number.NaN,
      definition,
    };
  }

  return {
    createHarmonicModel,
    fitHarmonicValues,
    getProductDefinition,
    calculatePolarizationRaster,
    positiveModulo,
  };
});
