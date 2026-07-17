(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PetroPolarizationAnalysis = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const EPSILON = 1e-10;
  const ANISOTROPY_CLASSES = Object.freeze([
    Object.freeze({ code: 0, key: "unresolved", label: "Unresolved / poor fit", color: [244, 220, 120] }),
    Object.freeze({ code: 1, key: "opaque_like", label: "Opaque-like / very low transmission", color: [20, 20, 20] }),
    Object.freeze({ code: 2, key: "isotropic_like", label: "Isotropic-like / continuously extinct", color: [150, 150, 150] }),
    Object.freeze({ code: 3, key: "pleochroic", label: "Pleochroic", color: [230, 126, 34] }),
    Object.freeze({ code: 4, key: "birefringent", label: "Birefringent", color: [52, 120, 210] }),
    Object.freeze({ code: 5, key: "pleochroic_birefringent", label: "Pleochroic + birefringent", color: [139, 79, 191] }),
  ]);
  const ANISOTROPY_REASONS = Object.freeze([
    "No classification evidence",
    "Very low PPL transmission estimate",
    "High PPL and XPL modulation",
    "High PPL modulation",
    "High XPL modulation",
    "PPL is transmissive while observed and reliable fitted XPL maxima remain below the extinction ceiling",
    "XPL input unavailable",
    "PPL input unavailable",
    "PPL fit quality is poor",
    "XPL fit quality is poor",
    "Classification confidence is below the selected minimum",
    "PPL angular fit is unavailable",
  ]);
  const DEFAULT_CLASSIFICATION_THRESHOLDS = Object.freeze({
    lowTransmission: 15,
    xplExtinctionCeiling: 12,
    pplModulation: 0.08,
    pplAbsoluteModulation: 4,
    xplModulation: 0.15,
    maxFitError: 0.12,
    minConfidence: 0.35,
  });
  const COLOR_MAPS = Object.freeze({
    viridis: [
      [68, 1, 84],
      [59, 82, 139],
      [33, 145, 140],
      [94, 201, 98],
      [253, 231, 37],
    ],
    inferno: [
      [0, 0, 4],
      [87, 15, 109],
      [187, 55, 84],
      [249, 142, 9],
      [252, 255, 164],
    ],
    turbo: [
      [48, 18, 59],
      [50, 120, 238],
      [34, 208, 139],
      [249, 190, 31],
      [122, 4, 3],
    ],
    blues: [
      [247, 251, 255],
      [198, 219, 239],
      [107, 174, 214],
      [33, 113, 181],
      [8, 48, 107],
    ],
    gray: [
      [0, 0, 0],
      [255, 255, 255],
    ],
    // Sixteen-interval samples of Matplotlib's cyclic twilight maps. Matching
    // endpoints keep angular values continuous across the 0/1 display seam.
    twilight: [
      [226, 217, 226],
      [196, 206, 212],
      [149, 181, 199],
      [114, 151, 193],
      [98, 118, 186],
      [94, 81, 173],
      [89, 42, 143],
      [69, 19, 92],
      [47, 20, 54],
      [74, 19, 66],
      [116, 30, 79],
      [152, 53, 80],
      [178, 86, 82],
      [194, 124, 99],
      [204, 163, 137],
      [216, 199, 190],
      [226, 217, 226],
    ],
    twilight_shifted: [
      [48, 20, 55],
      [69, 19, 92],
      [89, 42, 143],
      [94, 81, 173],
      [98, 118, 186],
      [114, 151, 193],
      [149, 181, 199],
      [196, 206, 212],
      [226, 217, 226],
      [216, 199, 190],
      [204, 163, 137],
      [194, 124, 99],
      [178, 86, 82],
      [152, 53, 80],
      [116, 30, 79],
      [74, 19, 66],
      [48, 20, 55],
    ],
    diverging: [
      [33, 102, 172],
      [146, 197, 222],
      [247, 247, 247],
      [244, 165, 130],
      [178, 24, 43],
    ],
  });

  function getColorMapRgb(value, name = "viridis") {
    const normalized = Math.max(0, Math.min(1, Number(value) || 0));
    if (name === "hue" || name === "hue_shifted") {
      const phase = name === "hue_shifted"
        ? (normalized + 0.5) % 1
        : normalized;
      const sector = phase * 6;
      const x = 1 - Math.abs((sector % 2) - 1);
      let rgb;
      if (sector < 1) rgb = [1, x, 0];
      else if (sector < 2) rgb = [x, 1, 0];
      else if (sector < 3) rgb = [0, 1, x];
      else if (sector < 4) rgb = [0, x, 1];
      else if (sector < 5) rgb = [x, 0, 1];
      else rgb = [1, 0, x];
      return rgb.map((component) => Math.round(component * 255));
    }
    const colors = COLOR_MAPS[name] || COLOR_MAPS.viridis;
    const position = normalized * (colors.length - 1);
    const index = Math.min(colors.length - 2, Math.floor(position));
    const fraction = position - index;
    return colors[index].map((channel, channelIndex) =>
      Math.round(
        channel + (colors[index + 1][channelIndex] - channel) * fraction,
      ),
    );
  }

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
      coefficients: [a, b, c],
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

  function evaluateHarmonicFitAtAngle(model, fit, angleDegrees) {
    if (!model || !fit?.coefficients || !Number.isFinite(angleDegrees)) {
      return Number.NaN;
    }
    const radians = (angleDegrees * Math.PI) / 180;
    const [a, b, c] = fit.coefficients;
    return (
      a +
      b * Math.cos(model.harmonic * radians) +
      c * Math.sin(model.harmonic * radians)
    );
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
      ppl_maximum: {
        mode: "ppl",
        field: "maximum",
        unit: "intensity",
        range: [0, 255],
        rgbAngleField: "maximumAzimuth",
      },
      ppl_minimum: {
        mode: "ppl",
        field: "minimum",
        unit: "intensity",
        range: [0, 255],
        rgbAngleField: "minimumAzimuth",
      },
      ppl_modulation: { mode: "ppl", field: "amplitude", unit: "intensity", range: [0, 255] },
      ppl_normalized_modulation: { mode: "ppl", field: "normalizedModulation", unit: "ratio", range: [0, 1] },
      ppl_azimuth: { mode: "ppl", field: "maximumAzimuth", unit: "degrees", range: [0, 180], circular: true },
      ppl_rmse: { mode: "ppl", field: "rmse", unit: "intensity", range: [0, 64] },
      xpl_maximum: {
        mode: "xpl",
        field: "maximum",
        unit: "intensity",
        range: [0, 255],
        rgbAngleField: "maximumAzimuth",
      },
      xpl_minimum: {
        mode: "xpl",
        field: "minimum",
        unit: "intensity",
        range: [0, 255],
        rgbAngleField: "minimumAzimuth",
      },
      xpl_absolute_modulation: { mode: "xpl", field: "amplitude", unit: "intensity", range: [0, 255] },
      xpl_modulation: { mode: "xpl", field: "normalizedModulation", unit: "ratio", range: [0, 1] },
      xpl_extinction_azimuth: { mode: "xpl", field: "minimumAzimuth", unit: "degrees", range: [0, 90], circular: true },
      xpl_rmse: { mode: "xpl", field: "rmse", unit: "intensity", range: [0, 64] },
      xpl_cpl_difference: { mode: "combined", combined: true, unit: "intensity", range: [-255, 255] },
      anisotropy_class: {
        mode: "interpretation",
        classification: true,
        categorical: true,
        unit: "class-code",
        range: [0, ANISOTROPY_CLASSES.length - 1],
      },
      anisotropy_confidence: {
        mode: "interpretation",
        classification: true,
        confidence: true,
        unit: "ratio",
        range: [0, 1],
      },
    };
    return definitions[product] || null;
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function normalizeClassificationThresholds(thresholds = {}) {
    const normalized = {};
    Object.entries(DEFAULT_CLASSIFICATION_THRESHOLDS).forEach(([key, fallback]) => {
      const value = Number(thresholds[key]);
      normalized[key] = Number.isFinite(value) ? value : fallback;
    });
    normalized.lowTransmission = Math.max(0, Math.min(255, normalized.lowTransmission));
    normalized.xplExtinctionCeiling = Math.max(0, Math.min(255, normalized.xplExtinctionCeiling));
    normalized.pplModulation = Math.max(0.001, Math.min(2, normalized.pplModulation));
    normalized.pplAbsoluteModulation = Math.max(0, Math.min(255, normalized.pplAbsoluteModulation));
    normalized.xplModulation = Math.max(0.001, Math.min(2, normalized.xplModulation));
    normalized.maxFitError = Math.max(0.001, Math.min(2, normalized.maxFitError));
    normalized.minConfidence = clamp01(normalized.minConfidence);
    return normalized;
  }

  function getFitQuality(fit, observationCount, maxFitError) {
    if (!fit) return { reliable: false, quality: 0, normalizedRmse: Number.NaN };
    const scale = Math.max(Math.abs(fit.mean), fit.amplitude, 1);
    const normalizedRmse = fit.rmse / scale;
    const reliable = Number.isFinite(normalizedRmse) && normalizedRmse <= maxFitError;
    let quality = reliable
      ? clamp01(1 - 0.5 * (normalizedRmse / maxFitError))
      : clamp01(0.5 * (maxFitError / Math.max(normalizedRmse, EPSILON)));
    if (observationCount <= 3) quality = Math.min(quality, 0.55);
    return { reliable, quality, normalizedRmse };
  }

  function getThresholdEvidence(value, threshold, positive) {
    const distance = positive ? value - threshold : threshold - value;
    return clamp01(0.5 + distance / (2 * Math.max(threshold, EPSILON)));
  }

  function getObservedStatistics(values) {
    if (!values?.length) return null;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const item of values) {
      const value = Number(item);
      if (!Number.isFinite(value)) return null;
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
    }
    return { min, max, mean: sum / values.length, range: max - min };
  }

  function classifyAnisotropyFits(pplFit, xplFit, options = {}) {
    const thresholds = normalizeClassificationThresholds(options.thresholds);
    const pplObserved = options.pplObserved || (pplFit
      ? { min: pplFit.minimum, max: pplFit.maximum, mean: pplFit.mean, range: pplFit.maximum - pplFit.minimum }
      : null);
    const xplObserved = options.xplObserved || (xplFit
      ? { min: xplFit.minimum, max: xplFit.maximum, mean: xplFit.mean, range: xplFit.maximum - xplFit.minimum }
      : null);
    const pplAvailable = Boolean(pplObserved);
    const xplAvailable = Boolean(xplObserved);
    const pplQuality = getFitQuality(
      pplFit,
      Number(options.pplObservationCount) || 0,
      thresholds.maxFitError,
    );
    const xplQuality = getFitQuality(
      xplFit,
      Number(options.xplObservationCount) || 0,
      thresholds.maxFitError,
    );
    const pplModulation = pplFit?.normalizedModulation;
    const xplModulation = xplFit?.normalizedModulation;
    const pplPredictedMaximum = Number.isFinite(pplFit?.maximum)
      ? pplFit.maximum
      : Number.NaN;
    const xplPredictedMaximum = Number.isFinite(xplFit?.maximum)
      ? xplFit.maximum
      : Number.NaN;
    const reliablePplPredictedMaximum = pplQuality.reliable &&
      Number.isFinite(pplPredictedMaximum)
      ? pplPredictedMaximum
      : Number.NaN;
    const pplTransmissionMaximum = Number.isFinite(reliablePplPredictedMaximum)
      ? reliablePplPredictedMaximum
      : pplObserved?.max;
    const reliableXplPredictedMaximum = xplQuality.reliable &&
      Number.isFinite(xplPredictedMaximum)
      ? xplPredictedMaximum
      : Number.NaN;
    const pplOpaqueMaximum = Number.isFinite(reliablePplPredictedMaximum)
      ? Math.max(pplObserved?.max ?? -Infinity, reliablePplPredictedMaximum)
      : pplObserved?.max;
    const xplDarknessMaximum = Number.isFinite(reliableXplPredictedMaximum)
      ? Math.max(xplObserved?.max ?? -Infinity, reliableXplPredictedMaximum)
      : xplObserved?.max;
    const result = {
      classCode: 0,
      confidence: 0,
      reasonCode: 0,
      pplModulation: Number.isFinite(pplModulation) ? pplModulation : Number.NaN,
      xplModulation: Number.isFinite(xplModulation) ? xplModulation : Number.NaN,
      pplFitError: pplQuality.normalizedRmse,
      xplFitError: xplQuality.normalizedRmse,
      pplPredictedMaximum,
      xplPredictedMaximum,
    };
    if (!pplAvailable && !xplAvailable) return result;

    const pplNoiseFloor = Math.max(
      thresholds.pplAbsoluteModulation,
      pplFit?.residualDegreesOfFreedom > 0 ? pplFit.rmse * 2 : 0,
    );
    const pplPositive = Boolean(
      pplFit &&
      pplQuality.reliable &&
      Number.isFinite(pplModulation) &&
      pplModulation >= thresholds.pplModulation &&
      pplFit.amplitude >= pplNoiseFloor,
    );
    const pplEvidence = pplPositive
      ? Math.min(
          getThresholdEvidence(pplModulation, thresholds.pplModulation, true),
          getThresholdEvidence(
            pplFit.amplitude,
            Math.max(pplNoiseFloor, 1),
            true,
          ),
          pplQuality.quality,
        )
      : 0;
    const xplContinuouslyDark = Boolean(
      xplAvailable &&
      (Number(options.xplObservationCount) || 0) >= 3 &&
      xplDarknessMaximum <= thresholds.xplExtinctionCeiling,
    );

    // Very low PPL transmission is direct evidence for opaque-like material.
    // When a reliable angular fit is available, both the sampled observations
    // and fitted maximum must remain below the threshold. Otherwise the
    // observed maximum is retained as the limited single-image fallback.
    // Continuous XPL extinction is only isotropic-like when a sufficient,
    // reliable PPL angular fit also rules out pleochroism. This keeps strongly
    // absorbing pleochroic minerals from being classified as isotropic-like.
    if (
      pplAvailable &&
      pplObserved.max <= thresholds.lowTransmission &&
      (!Number.isFinite(reliablePplPredictedMaximum) ||
        reliablePplPredictedMaximum <= thresholds.lowTransmission)
    ) {
      result.classCode = 1;
      result.reasonCode = 1;
      result.confidence = clamp01(
        getThresholdEvidence(
          pplOpaqueMaximum,
          Math.max(thresholds.lowTransmission, 1),
          false,
        ) * ((Number(options.pplObservationCount) || 0) <= 1 ? 0.8 : 1),
      );
    } else if (
      xplContinuouslyDark &&
      pplFit &&
      pplQuality.reliable &&
      (Number(options.pplObservationCount) || 0) >= 3 &&
      !pplPositive
    ) {
      result.classCode = 2;
      result.reasonCode = 5;
      const pplEvidence = getThresholdEvidence(
        pplTransmissionMaximum,
        Math.max(thresholds.lowTransmission, 1),
        true,
      );
      const xplEvidence = getThresholdEvidence(
        xplDarknessMaximum,
        Math.max(thresholds.xplExtinctionCeiling, 1),
        false,
      );
      const xplSampling = (Number(options.xplObservationCount) || 0) <= 3
        ? 0.65
        : 1;
      const pplSampling = (Number(options.pplObservationCount) || 0) <= 1
        ? 0.8
        : 1;
      result.confidence = Math.min(pplEvidence, xplEvidence) *
        xplSampling * pplSampling;
    } else {
      const xplPositive = Boolean(
        xplFit &&
        xplQuality.reliable &&
        xplObserved.max > thresholds.xplExtinctionCeiling &&
        Number.isFinite(xplModulation) &&
        xplModulation >= thresholds.xplModulation &&
        xplFit.amplitude >= 2,
      );
      const xplEvidence = xplPositive
        ? Math.min(
            getThresholdEvidence(xplModulation, thresholds.xplModulation, true),
            getThresholdEvidence(xplFit.amplitude, 2, true),
            xplQuality.quality,
          )
        : 0;
      if (pplPositive && xplPositive) {
        result.classCode = 5;
        result.reasonCode = 2;
        result.confidence = Math.min(pplEvidence, xplEvidence);
      } else if (pplPositive) {
        result.classCode = 3;
        result.reasonCode = 3;
        result.confidence = pplEvidence *
          (xplAvailable && !xplQuality.reliable && !xplContinuouslyDark
            ? 0.75
            : 1);
      } else if (xplPositive) {
        result.classCode = 4;
        result.reasonCode = 4;
        result.confidence = xplEvidence * (pplFit && !pplQuality.reliable ? 0.75 : 1);
      } else {
        result.reasonCode = pplAvailable && !pplFit
          ? 11
          : pplFit && !pplQuality.reliable
            ? 8
            : xplFit && !xplQuality.reliable
              ? 9
              : pplAvailable
                ? 6
                : 7;
        result.confidence = Math.max(
          pplFit ? pplQuality.quality * 0.5 : 0,
          xplFit ? xplQuality.quality * 0.5 : 0,
        );
      }
    }
    if (result.classCode !== 0 && result.confidence < thresholds.minConfidence) {
      result.classCode = 0;
      result.reasonCode = 10;
    }
    result.confidence = clamp01(result.confidence);
    return result;
  }

  function calculateAnisotropyRaster(stacks, width, height, options, definition) {
    const pplStack = Array.isArray(stacks.ppl) && stacks.ppl.length ? stacks.ppl : null;
    const xplStack = Array.isArray(stacks.xpl) && stacks.xpl.length ? stacks.xpl : null;
    const pplModel = pplStack ? createHarmonicModel(options.pplAngles, 2) : null;
    const xplModel = xplStack ? createHarmonicModel(options.xplAngles, 4) : null;
    if (!pplStack && !xplModel) {
      throw new Error("A PPL image or fitted XPL source is required for anisotropy classification.");
    }
    const assessableClassCodes = [0];
    if (pplStack) assessableClassCodes.push(1);
    if (pplStack && xplModel) assessableClassCodes.push(2);
    if (pplModel) assessableClassCodes.push(3);
    if (xplModel) assessableClassCodes.push(4);
    if (pplModel && xplModel) assessableClassCodes.push(5);
    const count = width * height;
    const values = new Float32Array(count);
    const classValues = new Uint8Array(count);
    const confidenceValues = new Float32Array(count);
    const reasonCodes = new Uint8Array(count);
    const pplModulation = new Float32Array(count);
    const xplModulation = new Float32Array(count);
    const pplFitError = new Float32Array(count);
    const xplFitError = new Float32Array(count);
    const pplObservedMaximum = new Float32Array(count);
    const pplPredictedMaximum = new Float32Array(count);
    const xplObservedMaximum = new Float32Array(count);
    const xplPredictedMaximum = new Float32Array(count);
    [
      pplModulation,
      xplModulation,
      pplFitError,
      xplFitError,
      pplObservedMaximum,
      pplPredictedMaximum,
      xplObservedMaximum,
      xplPredictedMaximum,
    ].forEach((array) =>
      array.fill(Number.NaN),
    );
    const pplObservations = pplStack ? new Float64Array(pplStack.length) : null;
    const xplObservations = xplStack ? new Float64Array(xplStack.length) : null;
    let min = Infinity;
    let max = -Infinity;
    for (let pixelIndex = 0; pixelIndex < count; pixelIndex += 1) {
      const offset = pixelIndex * 4;
      if (pplStack) {
        for (let index = 0; index < pplStack.length; index += 1) {
          pplObservations[index] = getChannelValue(pplStack[index], offset, "luminance");
        }
      }
      if (xplStack) {
        for (let index = 0; index < xplStack.length; index += 1) {
          xplObservations[index] = getChannelValue(xplStack[index], offset, "luminance");
        }
      }
      const pplObserved = getObservedStatistics(pplObservations);
      const xplObserved = getObservedStatistics(xplObservations);
      const classification = classifyAnisotropyFits(
        pplModel ? fitHarmonicValues(pplModel, pplObservations) : null,
        xplModel ? fitHarmonicValues(xplModel, xplObservations) : null,
        {
          thresholds: options.classificationThresholds,
          pplObservationCount: pplStack?.length || 0,
          xplObservationCount: xplStack?.length || 0,
          pplObserved,
          xplObserved,
        },
      );
      classValues[pixelIndex] = classification.classCode;
      confidenceValues[pixelIndex] = classification.confidence;
      reasonCodes[pixelIndex] = classification.reasonCode;
      pplModulation[pixelIndex] = classification.pplModulation;
      xplModulation[pixelIndex] = classification.xplModulation;
      pplFitError[pixelIndex] = classification.pplFitError;
      xplFitError[pixelIndex] = classification.xplFitError;
      pplObservedMaximum[pixelIndex] = pplObserved?.max ?? Number.NaN;
      pplPredictedMaximum[pixelIndex] = classification.pplPredictedMaximum;
      xplObservedMaximum[pixelIndex] = xplObserved?.max ?? Number.NaN;
      xplPredictedMaximum[pixelIndex] = classification.xplPredictedMaximum;
      const value = definition.confidence
        ? classification.confidence
        : classification.classCode;
      values[pixelIndex] = value;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    return {
      values,
      min,
      max,
      definition,
      rgbValues: null,
      classification: {
        classValues,
        confidenceValues,
        reasonCodes,
        pplModulation,
        xplModulation,
        pplFitError,
        xplFitError,
        pplObservedMaximum,
        pplPredictedMaximum,
        xplObservedMaximum,
        xplPredictedMaximum,
        assessableClassCodes,
      },
    };
  }

  function getDefaultColorMap(product) {
    const definition = getProductDefinition(product);
    if (definition?.circular) return "hue";
    if (definition?.range?.[0] < 0 && definition.range[1] > 0) {
      return "diverging";
    }
    return "viridis";
  }

  function calculatePolarizationRaster(stacks, width, height, options = {}) {
    const product = options.product || "ppl_modulation";
    const definition = getProductDefinition(product);
    if (!definition) throw new Error(`Unknown polarization product: ${product}`);
    if (definition.classification) {
      return calculateAnisotropyRaster(stacks, width, height, options, definition);
    }
    const rgbOutput = Boolean(
      options.output === "rgb" && definition.rgbAngleField,
    );
    const channel = rgbOutput ? "luminance" : options.channel || "luminance";
    const count = width * height;
    const output = new Float32Array(count);
    output.fill(Number.NaN);
    const rgbValues = rgbOutput ? new Float32Array(count * 3) : null;
    rgbValues?.fill(Number.NaN);
    const fitReliabilityValues = definition.circular
      ? new Uint8Array(count)
      : null;
    const classificationThresholds = normalizeClassificationThresholds(
      options.classificationThresholds,
    );
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
        if (fitReliabilityValues && fit) {
          const fitQuality = getFitQuality(
            fit,
            sourceStack.length,
            classificationThresholds.maxFitError,
          );
          const modulationThreshold = definition.mode === "ppl"
            ? classificationThresholds.pplModulation
            : classificationThresholds.xplModulation;
          const signalReliable = definition.mode === "ppl"
            ? fit.amplitude >= Math.max(
                classificationThresholds.pplAbsoluteModulation,
                fit.residualDegreesOfFreedom > 0 ? fit.rmse * 2 : 0,
              )
            : fit.maximum > classificationThresholds.xplExtinctionCeiling;
          fitReliabilityValues[pixelIndex] = Number(
            fitQuality.reliable &&
              signalReliable &&
              Number.isFinite(fit.normalizedModulation) &&
              fit.normalizedModulation >= modulationThreshold,
          );
        }
        if (rgbValues && fit) {
          const sharedAngle = fit[definition.rgbAngleField];
          ["red", "green", "blue"].forEach((rgbChannel, channelIndex) => {
            for (
              let imageIndex = 0;
              imageIndex < sourceStack.length;
              imageIndex += 1
            ) {
              observations[imageIndex] = getChannelValue(
                sourceStack[imageIndex],
                offset,
                rgbChannel,
              );
            }
            const channelFit = fitHarmonicValues(model, observations);
            rgbValues[pixelIndex * 3 + channelIndex] =
              evaluateHarmonicFitAtAngle(model, channelFit, sharedAngle);
          });
        }
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
      rgbValues,
      fitReliability: fitReliabilityValues
        ? {
            values: fitReliabilityValues,
            residualUnchecked: sourceStack.length <= 3,
          }
        : null,
    };
  }

  return {
    ANISOTROPY_CLASSES,
    ANISOTROPY_REASONS,
    COLOR_MAPS,
    DEFAULT_CLASSIFICATION_THRESHOLDS,
    classifyAnisotropyFits,
    createHarmonicModel,
    evaluateHarmonicFitAtAngle,
    fitHarmonicValues,
    getColorMapRgb,
    getDefaultColorMap,
    getProductDefinition,
    calculatePolarizationRaster,
    positiveModulo,
  };
});
