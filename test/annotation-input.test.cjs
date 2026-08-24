const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "annotation-input.js"),
  "utf8",
);

function loadApi() {
  const window = {};
  vm.runInNewContext(source, { window, globalThis: window });
  return window.PetroImageAnnotationInput;
}

test("rapid distant annotation clicks remain separate vertices", () => {
  const api = loadApi();
  assert.equal(
    api.isDoubleClick(
      { time: 1000, position: { x: 20, y: 20 } },
      { time: 1100, position: { x: 120, y: 80 } },
    ),
    false,
  );
});

test("rapid nearby annotation clicks complete a shape", () => {
  const api = loadApi();
  assert.equal(
    api.isDoubleClick(
      { time: 1000, position: { x: 20, y: 20 } },
      { time: 1100, position: { x: 25, y: 24 } },
    ),
    true,
  );
});

test("nearby annotation clicks outside the time threshold stay separate", () => {
  const api = loadApi();
  assert.equal(
    api.isDoubleClick(
      { time: 1000, position: { x: 20, y: 20 } },
      { time: 1400, position: { x: 25, y: 24 } },
    ),
    false,
  );
});

test("a slow press and release still counts as a vertex click", () => {
  const api = loadApi();
  assert.equal(
    api.isVertexClickGesture(
      { pointerId: 1, position: { x: 20, y: 20 }, time: 1000 },
      { pointerId: 1, position: { x: 24, y: 23 }, time: 2500 },
    ),
    true,
  );
});

test("a drag does not count as a vertex click", () => {
  const api = loadApi();
  assert.equal(
    api.isVertexClickGesture(
      { pointerId: 1, position: { x: 20, y: 20 } },
      { pointerId: 1, position: { x: 60, y: 45 } },
    ),
    false,
  );
});

test("a release from another pointer does not count as a vertex click", () => {
  const api = loadApi();
  assert.equal(
    api.isVertexClickGesture(
      { pointerId: 1, position: { x: 20, y: 20 } },
      { pointerId: 2, position: { x: 20, y: 20 } },
    ),
    false,
  );
});
