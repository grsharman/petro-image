const test = require("node:test");
const assert = require("node:assert/strict");

const polarizationApi = import("../polarization-analysis.js").then(
  () => globalThis.PetroPolarizationAnalysis,
);

test("PPL second-harmonic fit recovers mean, modulation, and azimuth", async () => {
  const { createHarmonicModel, fitHarmonicValues } = await polarizationApi;
  const angles = [0, 30, 60, 90, 120, 150];
  const mean = 100;
  const amplitude = 30;
  const azimuth = 25;
  const values = angles.map(
    (angle) =>
      mean + amplitude * Math.cos((2 * (angle - azimuth) * Math.PI) / 180),
  );
  const fit = fitHarmonicValues(createHarmonicModel(angles, 2), values);
  assert.ok(Math.abs(fit.mean - mean) < 1e-9);
  assert.ok(Math.abs(fit.amplitude - amplitude) < 1e-9);
  assert.ok(Math.abs(fit.maximumAzimuth - azimuth) < 1e-9);
  assert.ok(Math.abs(fit.normalizedModulation - 0.3) < 1e-9);
  assert.ok(fit.rmse < 1e-9);
});

test("XPL fourth-harmonic fit reports the extinction azimuth", async () => {
  const { createHarmonicModel, fitHarmonicValues } = await polarizationApi;
  const angles = [0, 15, 30, 45, 60, 75];
  const extinction = 12;
  const values = angles.map(
    (angle) => 20 + 80 * Math.sin((2 * (angle - extinction) * Math.PI) / 180) ** 2,
  );
  const fit = fitHarmonicValues(createHarmonicModel(angles, 4), values);
  assert.ok(Math.abs(fit.minimumAzimuth - extinction) < 1e-9);
  assert.ok(Math.abs(fit.minimum - 20) < 1e-9);
  assert.ok(Math.abs(fit.maximum - 100) < 1e-9);
});

test("singular or undersampled angle sequences do not create a fit model", async () => {
  const { createHarmonicModel } = await polarizationApi;
  assert.equal(createHarmonicModel([0, 30], 2), null);
  assert.equal(createHarmonicModel([0, 0, 0], 2), null);
});

test("polarization raster calculation preserves analytical angle values", async () => {
  const { calculatePolarizationRaster } = await polarizationApi;
  const angles = [0, 30, 60, 90, 120, 150];
  const makePixel = (value) => new Uint8ClampedArray([value, value, value, 255]);
  const stack = angles.map((angle) => {
    const value = 100 + 30 * Math.cos((2 * (angle - 25) * Math.PI) / 180);
    return makePixel(Math.round(value));
  });
  const result = calculatePolarizationRaster(
    { ppl: stack },
    1,
    1,
    { product: "ppl_azimuth", channel: "luminance", pplAngles: angles },
  );
  assert.ok(Math.abs(result.values[0] - 25) < 0.25);
  assert.equal(result.definition.unit, "degrees");
});

test("azimuth rasters identify pixels with interpretable fitted orientations", async () => {
  const { calculatePolarizationRaster } = await polarizationApi;
  const angles = [0, 30, 60, 90, 120, 150];
  const stack = angles.map((angle) => {
    const strong = 100 + 30 * Math.cos((2 * (angle - 25) * Math.PI) / 180);
    const weak = 100 + 2 * Math.cos((2 * (angle - 70) * Math.PI) / 180);
    return new Float64Array([
      strong, strong, strong, 255,
      weak, weak, weak, 255,
    ]);
  });
  const result = calculatePolarizationRaster(
    { ppl: stack },
    2,
    1,
    { product: "ppl_azimuth", channel: "luminance", pplAngles: angles },
  );
  assert.deepEqual(Array.from(result.fitReliability.values), [1, 0]);
  assert.equal(result.fitReliability.residualUnchecked, false);
});

test("normalized RMSE and azimuth uncertainty expose fit quality as map products", async () => {
  const {
    calculatePolarizationRaster,
    createHarmonicModel,
    fitHarmonicValues,
  } = await polarizationApi;
  const angles = [0, 30, 60, 90, 120, 150];
  const noise = [2, -2, 1, -1, 2, -2];
  const values = angles.map(
    (angle, index) =>
      100 +
      30 * Math.cos((2 * (angle - 25) * Math.PI) / 180) +
      noise[index],
  );
  const stack = values.map(
    (value) => new Float64Array([value, value, value, 255]),
  );
  const fit = fitHarmonicValues(createHarmonicModel(angles, 2), values);
  const normalizedRmse = calculatePolarizationRaster(
    { ppl: stack },
    1,
    1,
    { product: "ppl_normalized_rmse", pplAngles: angles },
  );
  const uncertainty = calculatePolarizationRaster(
    { ppl: stack },
    1,
    1,
    { product: "ppl_azimuth_uncertainty", pplAngles: angles },
  );
  assert.ok(Math.abs(normalizedRmse.values[0] - fit.normalizedRmse) < 1e-6);
  assert.ok(Math.abs(uncertainty.values[0] - fit.azimuthStandardError) < 1e-6);
  assert.ok(uncertainty.values[0] > 0);
  assert.equal(uncertainty.definition.unit, "degrees");

  const exactAngles = angles.slice(0, 3);
  const exactFit = fitHarmonicValues(
    createHarmonicModel(exactAngles, 2),
    values.slice(0, 3),
  );
  assert.equal(exactFit.residualDegreesOfFreedom, 0);
  assert.equal(Number.isNaN(exactFit.azimuthStandardError), true);
});

test("PPL and XPL azimuth reliability products reproduce their modality-specific masks", async () => {
  const { calculatePolarizationRaster } = await polarizationApi;
  const pplAngles = [0, 30, 60, 90, 120, 150];
  const pplStack = pplAngles.map((angle) => {
    const strong = 100 + 30 * Math.cos((2 * (angle - 25) * Math.PI) / 180);
    const weak = 100 + 2 * Math.cos((2 * (angle - 70) * Math.PI) / 180);
    return new Float64Array([
      strong, strong, strong, 255,
      weak, weak, weak, 255,
    ]);
  });
  const pplReliability = calculatePolarizationRaster(
    { ppl: pplStack },
    2,
    1,
    { product: "ppl_azimuth_reliability", pplAngles },
  );
  assert.deepEqual(Array.from(pplReliability.values), [1, 0]);

  const xplAngles = [0, 15, 30, 45, 60, 75];
  const xplStack = xplAngles.map((angle) => {
    const strong = 60 + 40 * Math.cos((4 * (angle - 20) * Math.PI) / 180);
    const dark = 4 + 1 * Math.cos((4 * (angle - 20) * Math.PI) / 180);
    return new Float64Array([
      strong, strong, strong, 255,
      dark, dark, dark, 255,
    ]);
  });
  const xplReliability = calculatePolarizationRaster(
    { xpl: xplStack },
    2,
    1,
    { product: "xpl_azimuth_reliability", xplAngles },
  );
  assert.deepEqual(Array.from(xplReliability.values), [1, 0]);
  assert.equal(xplReliability.definition.unit, "binary-mask");
});

test("PPL-XPL azimuth difference folds the two fitted symmetries into 0 to 45 degrees", async () => {
  const {
    calculatePolarizationRaster,
    getPplXplAzimuthDifference,
  } = await polarizationApi;
  assert.equal(getPplXplAzimuthDifference(170, 80), 0);
  assert.equal(getPplXplAzimuthDifference(10, 80), 20);

  const pplAngles = [0, 30, 60, 90, 120, 150];
  const xplAngles = [0, 15, 30, 45, 60, 75];
  const pplStack = pplAngles.map((angle) => {
    const value = 100 + 30 * Math.cos((2 * (angle - 25) * Math.PI) / 180);
    return new Float64Array([value, value, value, 255]);
  });
  const xplStack = xplAngles.map((angle) => {
    const value = 20 + 80 * Math.sin((2 * (angle - 10) * Math.PI) / 180) ** 2;
    return new Float64Array([value, value, value, 255]);
  });
  const result = calculatePolarizationRaster(
    { ppl: pplStack, xpl: xplStack },
    1,
    1,
    {
      product: "ppl_xpl_azimuth_difference",
      pplAngles,
      xplAngles,
    },
  );
  assert.ok(Math.abs(result.values[0] - 15) < 1e-5);
  assert.deepEqual(result.definition.range, [0, 45]);
});

test("PPL raster products distinguish modulation amplitude from normalized modulation", async () => {
  const { calculatePolarizationRaster, getProductDefinition } = await polarizationApi;
  const angles = [0, 30, 60, 90, 120, 150];
  const stack = angles.map((angle) => {
    const value = 100 + 30 * Math.cos((2 * (angle - 25) * Math.PI) / 180);
    return new Float64Array([value, value, value, 255]);
  });
  const modulation = calculatePolarizationRaster(
    { ppl: stack },
    1,
    1,
    { product: "ppl_modulation", channel: "luminance", pplAngles: angles },
  );
  const normalized = calculatePolarizationRaster(
    { ppl: stack },
    1,
    1,
    {
      product: "ppl_normalized_modulation",
      channel: "luminance",
      pplAngles: angles,
    },
  );
  assert.ok(Math.abs(modulation.values[0] - 30) < 1e-5);
  assert.ok(Math.abs(normalized.values[0] - 0.3) < 1e-6);
  assert.equal(modulation.definition.unit, "intensity");
  assert.equal(normalized.definition.unit, "ratio");
  assert.equal(getProductDefinition("ppl_mean"), null);
  assert.equal(getProductDefinition("ppl_range"), null);
  assert.equal(getProductDefinition("cpl_intensity"), null);
});

test("XPL raster products distinguish modulation amplitude from normalized modulation", async () => {
  const { calculatePolarizationRaster } = await polarizationApi;
  const angles = [0, 15, 30, 45, 60, 75];
  const stack = angles.map((angle) => {
    const value = 80 + 20 * Math.cos((4 * (angle - 10) * Math.PI) / 180);
    return new Float64Array([value, value, value, 255]);
  });
  const modulation = calculatePolarizationRaster(
    { xpl: stack },
    1,
    1,
    {
      product: "xpl_absolute_modulation",
      channel: "luminance",
      xplAngles: angles,
    },
  );
  const normalized = calculatePolarizationRaster(
    { xpl: stack },
    1,
    1,
    { product: "xpl_modulation", channel: "luminance", xplAngles: angles },
  );
  assert.ok(Math.abs(modulation.values[0] - 20) < 1e-5);
  assert.ok(Math.abs(normalized.values[0] - 0.25) < 1e-6);
  assert.equal(modulation.definition.unit, "intensity");
  assert.equal(normalized.definition.unit, "ratio");
});

test("scalar color maps provide stable endpoints and cyclic options", async () => {
  const { getColorMapRgb, getDefaultColorMap } = await polarizationApi;
  assert.deepEqual(getColorMapRgb(0, "viridis"), [68, 1, 84]);
  assert.deepEqual(getColorMapRgb(1, "viridis"), [253, 231, 37]);
  assert.deepEqual(getColorMapRgb(0, "hue"), [255, 0, 0]);
  assert.deepEqual(getColorMapRgb(1, "hue"), [255, 0, 0]);
  assert.deepEqual(getColorMapRgb(0, "hue_shifted"), [0, 255, 255]);
  assert.deepEqual(getColorMapRgb(1, "hue_shifted"), [0, 255, 255]);
  assert.deepEqual(getColorMapRgb(0, "twilight"), [226, 217, 226]);
  assert.deepEqual(getColorMapRgb(1, "twilight"), [226, 217, 226]);
  assert.deepEqual(getColorMapRgb(0, "twilight_shifted"), [48, 20, 55]);
  assert.deepEqual(getColorMapRgb(1, "twilight_shifted"), [48, 20, 55]);
  assert.deepEqual(
    getColorMapRgb(0.5, "twilight_shifted"),
    getColorMapRgb(0, "twilight"),
  );
  assert.deepEqual(getColorMapRgb(0, "unknown"), [68, 1, 84]);
  assert.deepEqual(getColorMapRgb(0.5, "diverging"), [247, 247, 247]);
  assert.equal(getDefaultColorMap("ppl_azimuth"), "hue");
  assert.equal(getDefaultColorMap("xpl_extinction_azimuth"), "hue");
  assert.equal(getDefaultColorMap("xpl_cpl_difference"), "diverging");
  assert.equal(getDefaultColorMap("ppl_azimuth_reliability"), "gray");
  assert.equal(getDefaultColorMap("xpl_maximum"), "viridis");
});

test("RGB polarization products evaluate every channel at one luminance-derived angle", async () => {
  const {
    calculatePolarizationRaster,
    createHarmonicModel,
    evaluateHarmonicFitAtAngle,
    fitHarmonicValues,
  } = await polarizationApi;
  const xplAngles = [0, 15, 30, 45, 60, 75];
  const channelModels = [
    { mean: 100, amplitude: 40, azimuth: 0 },
    { mean: 100, amplitude: 40, azimuth: 20 },
    { mean: 100, amplitude: 40, azimuth: 40 },
  ];
  const xplStack = xplAngles.map((angle) => {
    const channels = channelModels.map(
      ({ mean, amplitude, azimuth }) =>
        mean +
        amplitude * Math.cos((4 * (angle - azimuth) * Math.PI) / 180),
    );
    return new Float64Array([...channels, 255]);
  });
  const model = createHarmonicModel(xplAngles, 4);
  const luminance = xplStack.map(
    (pixels) =>
      0.2126 * pixels[0] + 0.7152 * pixels[1] + 0.0722 * pixels[2],
  );
  const luminanceFit = fitHarmonicValues(model, luminance);

  for (const [product, angleField] of [
    ["xpl_maximum", "maximumAzimuth"],
    ["xpl_minimum", "minimumAzimuth"],
  ]) {
    const raster = calculatePolarizationRaster(
      { xpl: xplStack },
      1,
      1,
      { product, output: "rgb", xplAngles },
    );
    const expected = [0, 1, 2].map((channelIndex) => {
      const fit = fitHarmonicValues(
        model,
        xplStack.map((pixels) => pixels[channelIndex]),
      );
      return evaluateHarmonicFitAtAngle(
        model,
        fit,
        luminanceFit[angleField],
      );
    });
    expected.forEach((value, channelIndex) => {
      assert.ok(Math.abs(raster.rgbValues[channelIndex] - value) < 1e-4);
    });
  }

  assert.ok(
    calculatePolarizationRaster(
      { xpl: xplStack },
      1,
      1,
      { product: "xpl_maximum", output: "rgb", xplAngles },
    ).rgbValues[0] < channelModels[0].mean + channelModels[0].amplitude,
  );

  const pplAngles = [0, 30, 60, 90, 120, 150];
  const pplStack = pplAngles.map((angle) => {
    const value = 90 + 35 * Math.cos((2 * (angle - 25) * Math.PI) / 180);
    return new Float64Array([value, value * 0.8, value * 0.6, 255]);
  });
  for (const [product, expected] of [
    ["ppl_maximum", [125, 100, 75]],
    ["ppl_minimum", [55, 44, 33]],
  ]) {
    const pplRaster = calculatePolarizationRaster(
      { ppl: pplStack },
      1,
      1,
      { product, output: "rgb", pplAngles },
    );
    expected.forEach((value, channelIndex) => {
      assert.ok(Math.abs(pplRaster.rgbValues[channelIndex] - value) < 1e-4);
    });
  }
});

test("anisotropy classification distinguishes the five optical response classes", async () => {
  const { classifyAnisotropyFits } = await polarizationApi;
  const fit = (maximum, modulation, rmse = 1, mean = 100) => ({
    maximum,
    minimum: mean - modulation * mean,
    mean,
    amplitude: modulation * mean,
    normalizedModulation: modulation,
    rmse,
  });
  const options = { pplObservationCount: 6, xplObservationCount: 6 };
  assert.equal(classifyAnisotropyFits(fit(8, 0.2), fit(100, 0.4), options).classCode, 1);
  assert.equal(classifyAnisotropyFits(fit(100, 0.02), fit(5, 0.04, 3, 4), options).classCode, 2);
  assert.equal(classifyAnisotropyFits(fit(100, 0.3), fit(100, 0.04), options).classCode, 3);
  assert.equal(classifyAnisotropyFits(fit(100, 0.02), fit(100, 0.5), options).classCode, 4);
  assert.equal(classifyAnisotropyFits(fit(100, 0.3), fit(100, 0.5), options).classCode, 5);
});

test("anisotropy classification preserves missing evidence and poor fits as unresolved", async () => {
  const { classifyAnisotropyFits } = await polarizationApi;
  const fit = (modulation, rmse = 1) => ({
    maximum: 120,
    mean: 100,
    amplitude: modulation * 100,
    normalizedModulation: modulation,
    rmse,
  });
  const pplOnlyPositive = classifyAnisotropyFits(fit(0.3), null, {
    pplObservationCount: 6,
  });
  assert.equal(pplOnlyPositive.classCode, 3);
  assert.equal(classifyAnisotropyFits(fit(0.02), null, { pplObservationCount: 6 }).classCode, 0);
  assert.equal(classifyAnisotropyFits(null, fit(0.5), { xplObservationCount: 6 }).classCode, 4);
  assert.equal(classifyAnisotropyFits(null, fit(0.02), { xplObservationCount: 6 }).classCode, 0);
  const poorFit = classifyAnisotropyFits(fit(0.3, 30), fit(0.5), {
    pplObservationCount: 6,
    xplObservationCount: 6,
  });
  assert.equal(poorFit.classCode, 4);
  assert.equal(poorFit.reasonCode, 4);
});

test("continuous XPL extinction is isotropic-like even when its harmonic fit is unstable", async () => {
  const { classifyAnisotropyFits } = await polarizationApi;
  const pplFit = {
    maximum: 110,
    minimum: 106,
    mean: 108,
    amplitude: 2,
    normalizedModulation: 2 / 108,
    rmse: 1,
    residualDegreesOfFreedom: 3,
  };
  const unstableDarkXplFit = {
    maximum: 5,
    minimum: -1,
    mean: 2,
    amplitude: 3,
    normalizedModulation: 1.5,
    rmse: 5,
    residualDegreesOfFreedom: 3,
  };
  const result = classifyAnisotropyFits(pplFit, unstableDarkXplFit, {
    pplObservationCount: 6,
    xplObservationCount: 6,
    pplObserved: { min: 106, max: 110, mean: 108, range: 4 },
    xplObserved: { min: 0, max: 5, mean: 2, range: 5 },
  });
  assert.equal(result.classCode, 2);
  assert.equal(result.reasonCode, 5);
  assert.ok(result.confidence > 0.5);
});

test("PPL pleochroism takes precedence over continuous XPL darkness", async () => {
  const { classifyAnisotropyFits } = await polarizationApi;
  const pleochroicPplFit = {
    maximum: 110,
    minimum: 50,
    mean: 80,
    amplitude: 30,
    normalizedModulation: 30 / 80,
    rmse: 2,
    residualDegreesOfFreedom: 3,
  };
  const unstableDarkXplFit = {
    maximum: 5,
    minimum: -1,
    mean: 2,
    amplitude: 3,
    normalizedModulation: 1.5,
    rmse: 5,
    residualDegreesOfFreedom: 3,
  };
  const result = classifyAnisotropyFits(
    pleochroicPplFit,
    unstableDarkXplFit,
    {
      pplObservationCount: 6,
      xplObservationCount: 6,
      pplObserved: { min: 50, max: 110, mean: 80, range: 60 },
      xplObserved: { min: 0, max: 5, mean: 2, range: 5 },
    },
  );
  assert.equal(result.classCode, 3);
  assert.equal(result.reasonCode, 3);
  assert.ok(result.confidence > 0.5);
});

test("continuous XPL darkness without reliable PPL evidence remains unresolved", async () => {
  const { classifyAnisotropyFits } = await polarizationApi;
  const unreliablePplFit = {
    maximum: 110,
    minimum: 50,
    mean: 80,
    amplitude: 30,
    normalizedModulation: 30 / 80,
    rmse: 40,
    residualDegreesOfFreedom: 3,
  };
  const darkXplFit = {
    maximum: 5,
    minimum: 0,
    mean: 2,
    amplitude: 2,
    normalizedModulation: 1,
    rmse: 4,
    residualDegreesOfFreedom: 3,
  };
  const result = classifyAnisotropyFits(unreliablePplFit, darkXplFit, {
    pplObservationCount: 6,
    xplObservationCount: 6,
    pplObserved: { min: 50, max: 110, mean: 80, range: 60 },
    xplObserved: { min: 0, max: 5, mean: 2, range: 5 },
  });
  assert.equal(result.classCode, 0);
  assert.equal(result.reasonCode, 8);
});

test("PPL pleochroism requires an absolute modulation above the noise floor", async () => {
  const { classifyAnisotropyFits } = await polarizationApi;
  const lowAmplitudeFit = {
    maximum: 28,
    minimum: 22,
    mean: 25,
    amplitude: 3,
    normalizedModulation: 0.12,
    rmse: 0.5,
    residualDegreesOfFreedom: 3,
  };
  const result = classifyAnisotropyFits(lowAmplitudeFit, null, {
    pplObservationCount: 6,
    pplObserved: { min: 22, max: 28, mean: 25, range: 6 },
  });
  assert.equal(result.classCode, 0);
});

test("a reliable PPL predicted maximum prevents a false opaque-like result", async () => {
  const { classifyAnisotropyFits } = await polarizationApi;
  const pplFit = {
    maximum: 40,
    minimum: 10,
    mean: 25,
    amplitude: 15,
    normalizedModulation: 0.6,
    rmse: 1,
    residualDegreesOfFreedom: 3,
  };
  const result = classifyAnisotropyFits(pplFit, null, {
    pplObservationCount: 6,
    pplObserved: { min: 4, max: 12, mean: 8, range: 8 },
  });
  assert.equal(result.classCode, 3);
  assert.equal(result.pplPredictedMaximum, 40);
});

test("an unreliable PPL fit retains observed maximum as the opaque-like fallback", async () => {
  const { classifyAnisotropyFits } = await polarizationApi;
  const unreliablePplFit = {
    maximum: 40,
    minimum: -20,
    mean: 10,
    amplitude: 30,
    normalizedModulation: 3,
    rmse: 40,
    residualDegreesOfFreedom: 3,
  };
  const result = classifyAnisotropyFits(unreliablePplFit, null, {
    pplObservationCount: 6,
    pplObserved: { min: 4, max: 12, mean: 8, range: 8 },
  });
  assert.equal(result.classCode, 1);
  assert.equal(result.pplPredictedMaximum, 40);
});

test("opaque-like confidence uses the conservative fitted and observed PPL maximum", async () => {
  const { classifyAnisotropyFits } = await polarizationApi;
  const pplFit = {
    maximum: 14,
    minimum: 10,
    mean: 12,
    amplitude: 2,
    normalizedModulation: 2 / 12,
    rmse: 0.5,
    residualDegreesOfFreedom: 3,
  };
  const result = classifyAnisotropyFits(pplFit, null, {
    pplObservationCount: 6,
    pplObserved: { min: 3, max: 5, mean: 4, range: 2 },
  });
  assert.equal(result.classCode, 1);
  assert.ok(Math.abs(result.confidence - (0.5 + 1 / 30)) < 1e-12);
});

test("PPL confidence evaluates fitted amplitude against its noise-adjusted floor", async () => {
  const { classifyAnisotropyFits } = await polarizationApi;
  const pplFit = {
    maximum: 110,
    minimum: 90,
    mean: 100,
    amplitude: 10,
    normalizedModulation: 0.1,
    rmse: 5,
    residualDegreesOfFreedom: 3,
  };
  const result = classifyAnisotropyFits(pplFit, null, {
    pplObservationCount: 6,
  });
  assert.equal(result.classCode, 3);
  assert.ok(Math.abs(result.confidence - 0.5) < 1e-12);
});

test("XPL confidence includes fitted absolute amplitude evidence", async () => {
  const { classifyAnisotropyFits } = await polarizationApi;
  const xplFit = {
    maximum: 102,
    minimum: 98,
    mean: 100,
    amplitude: 2,
    normalizedModulation: 0.2,
    rmse: 1,
    residualDegreesOfFreedom: 3,
  };
  const result = classifyAnisotropyFits(null, xplFit, {
    xplObservationCount: 6,
  });
  assert.equal(result.classCode, 4);
  assert.ok(Math.abs(result.confidence - 0.5) < 1e-12);
});

test("a reliable fitted XPL maximum prevents a false continuously-dark result", async () => {
  const { classifyAnisotropyFits } = await polarizationApi;
  const pplFit = {
    maximum: 110,
    minimum: 106,
    mean: 108,
    amplitude: 2,
    normalizedModulation: 2 / 108,
    rmse: 1,
    residualDegreesOfFreedom: 3,
  };
  const xplFit = {
    maximum: 20,
    minimum: 0,
    mean: 10,
    amplitude: 10,
    normalizedModulation: 1,
    rmse: 1,
    residualDegreesOfFreedom: 3,
  };
  const result = classifyAnisotropyFits(pplFit, xplFit, {
    pplObservationCount: 6,
    xplObservationCount: 6,
    pplObserved: { min: 106, max: 110, mean: 108, range: 4 },
    xplObserved: { min: 0, max: 5, mean: 2, range: 5 },
  });
  assert.equal(result.classCode, 0);
  assert.equal(result.xplPredictedMaximum, 20);
});

test("a single PPL image supports opaque-like classification only", async () => {
  const { calculatePolarizationRaster } = await polarizationApi;
  const ppl = [new Float64Array([
    5, 5, 5, 255,
    100, 100, 100, 255,
  ])];
  const raster = calculatePolarizationRaster(
    { ppl },
    2,
    1,
    { product: "anisotropy_class", pplAngles: [Number.NaN] },
  );
  assert.deepEqual(Array.from(raster.classification.classValues), [1, 0]);
  assert.deepEqual(raster.classification.assessableClassCodes, [0, 1]);
});

test("anisotropy raster exposes class, confidence, reason, and metric rasters", async () => {
  const { calculatePolarizationRaster } = await polarizationApi;
  const pplAngles = [0, 30, 60, 90, 120, 150];
  const xplAngles = [0, 15, 30, 45, 60, 75];
  const pixel = (value) => new Float64Array([value, value, value, 255]);
  const ppl = pplAngles.map((angle) =>
    pixel(100 + 30 * Math.cos((2 * (angle - 20) * Math.PI) / 180)),
  );
  const xpl = xplAngles.map((angle) =>
    pixel(100 + 40 * Math.cos((4 * (angle - 10) * Math.PI) / 180)),
  );
  const classRaster = calculatePolarizationRaster(
    { ppl, xpl },
    1,
    1,
    { product: "anisotropy_class", pplAngles, xplAngles },
  );
  const confidenceRaster = calculatePolarizationRaster(
    { ppl, xpl },
    1,
    1,
    { product: "anisotropy_confidence", pplAngles, xplAngles },
  );
  assert.equal(classRaster.values[0], 5);
  assert.equal(classRaster.classification.classValues[0], 5);
  assert.ok(classRaster.classification.confidenceValues[0] > 0.5);
  assert.equal(classRaster.classification.reasonCodes[0], 2);
  assert.ok(Math.abs(classRaster.classification.pplModulation[0] - 0.3) < 1e-6);
  assert.ok(Math.abs(classRaster.classification.xplModulation[0] - 0.4) < 1e-6);
  assert.ok(Math.abs(classRaster.classification.pplPredictedMaximum[0] - 130) < 1e-6);
  assert.ok(Math.abs(classRaster.classification.xplPredictedMaximum[0] - 140) < 1e-6);
  assert.ok(
    classRaster.classification.pplObservedMaximum[0] <
      classRaster.classification.pplPredictedMaximum[0],
  );
  assert.ok(Math.abs(confidenceRaster.values[0] - classRaster.classification.confidenceValues[0]) < 1e-6);
});
