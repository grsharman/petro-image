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

test("scalar color maps provide stable endpoints and a cyclic hue option", async () => {
  const { getColorMapRgb, getDefaultColorMap } = await polarizationApi;
  assert.deepEqual(getColorMapRgb(0, "viridis"), [68, 1, 84]);
  assert.deepEqual(getColorMapRgb(1, "viridis"), [253, 231, 37]);
  assert.deepEqual(getColorMapRgb(0, "hue"), [255, 0, 0]);
  assert.deepEqual(getColorMapRgb(1, "hue"), [255, 0, 0]);
  assert.deepEqual(getColorMapRgb(0, "unknown"), [68, 1, 84]);
  assert.deepEqual(getColorMapRgb(0.5, "diverging"), [247, 247, 247]);
  assert.equal(getDefaultColorMap("ppl_azimuth"), "hue");
  assert.equal(getDefaultColorMap("xpl_extinction_azimuth"), "hue");
  assert.equal(getDefaultColorMap("xpl_cpl_difference"), "diverging");
  assert.equal(getDefaultColorMap("xpl_maximum"), "viridis");
});
