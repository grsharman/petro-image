const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "sample-orientation.js"),
  "utf8",
);

function loadApi() {
  const window = {};
  vm.runInNewContext(source, { window, globalThis: window });
  return window.PetroImageSampleOrientation;
}

test("uses a sample's configured rotation as its initial orientation", () => {
  const api = loadApi();
  assert.equal(api.getInitialRotationDegrees({ rotationDegrees: 90 }), 90);
  assert.equal(api.getInitialRotationDegrees({ rotationDegrees: "135" }), 135);
});

test("keeps legacy and invalid sample rotations at zero degrees", () => {
  const api = loadApi();
  assert.equal(api.getInitialRotationDegrees({}), 0);
  assert.equal(api.getInitialRotationDegrees({ rotationDegrees: "sideways" }), 0);
  assert.equal(api.getInitialRotationDegrees(null), 0);
});

test("normalizes configured rotations to the supported control range", () => {
  const api = loadApi();
  assert.equal(api.normalizeRotationDegrees(42.6), 43);
  assert.equal(api.normalizeRotationDegrees(-10), 0);
  assert.equal(api.normalizeRotationDegrees(450), 360);
});

test("targets control-scroll rotation based on rotation-aware imagery", () => {
  const api = loadApi();
  assert.equal(api.getControlScrollRotationTarget(false), "image");
  assert.equal(api.getControlScrollRotationTarget(true), "stage");
});
