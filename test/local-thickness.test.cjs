const test = require("node:test");
const assert = require("node:assert/strict");
const localThicknessApi = import("../local-thickness.js").then(
  () => globalThis.PetroLocalThickness
);

test("squared EDT returns Euclidean squared distances", async () => {
  const { squaredEuclideanDistanceToZero } = await localThicknessApi;
  const binary = new Uint8Array([
    0, 1, 1,
    1, 1, 1,
    1, 1, 1,
  ]);
  assert.deepEqual([...squaredEuclideanDistanceToZero(binary, 3, 3)], [0, 1, 4, 1, 2, 5, 4, 5, 8]);
});

test("EDT respects nearby background above irregular foreground", async () => {
  const { squaredEuclideanDistanceToZero } = await localThicknessApi;
  const binary = new Uint8Array([
    0, 0, 0, 0, 0,
    0, 1, 1, 1, 0,
    0, 1, 1, 1, 0,
    0, 0, 0, 0, 0,
  ]);
  const distance2 = squaredEuclideanDistanceToZero(binary, 5, 4);
  assert.equal(distance2[1 * 5 + 2], 1);
});

test("a discrete circular pore is filled by its largest overlapping radius", async () => {
  const { localThicknessDt } = await localThicknessApi;
  const width = 9;
  const mask = new Uint8Array(width * width);
  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((x - 4) ** 2 + (y - 4) ** 2 <= 9) mask[y * width + x] = 1;
    }
  }
  const { values, maxRadius } = localThicknessDt(mask, width, width, { sizes: [Math.sqrt(10)] });
  assert.ok(Math.abs(maxRadius - Math.sqrt(10)) < 1e-6);
  mask.forEach((value, index) => {
    if (value) assert.ok(Math.abs(values[index] - Math.sqrt(10)) < 1e-5);
  });
});

test("background remains zero", async () => {
  const { localThicknessDt } = await localThicknessApi;
  const mask = new Uint8Array([0, 1, 0, 1, 1, 1, 0, 1, 0]);
  const { values } = localThicknessDt(mask, 3, 3, { sizes: 8 });
  mask.forEach((value, index) => {
    if (!value) assert.equal(values[index], 0);
  });
});

test("exact mode evaluates every pore centre", async () => {
  const { localThicknessExact } = await localThicknessApi;
  const mask = new Uint8Array([
    0, 0, 0, 0, 0,
    0, 1, 1, 1, 0,
    0, 1, 1, 1, 0,
    0, 1, 1, 1, 0,
    0, 0, 0, 0, 0,
  ]);
  const { values } = localThicknessExact(mask, 5, 5);
  assert.equal(values[12], 2);
  assert.equal(values[0], 0);
  assert.ok(values[6] > 0);
});

test("a small disconnected pore cannot inherit a nearby large pore radius", async () => {
  const { localThicknessExact } = await localThicknessApi;
  const width = 23;
  const height = 13;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inLarge = (x - 5) ** 2 + (y - 6) ** 2 <= 16;
      const inSmall = (x - 18) ** 2 + (y - 6) ** 2 <= 4;
      if (inLarge || inSmall) mask[y * width + x] = 1;
    }
  }
  const { values } = localThicknessExact(mask, width, height);
  const smallPoreValue = values[6 * width + 18];
  const largePoreValue = values[6 * width + 5];
  assert.ok(smallPoreValue < largePoreValue);
  assert.ok(smallPoreValue <= Math.sqrt(5) + 1e-6);
});

test("connected components label separate pores and report their areas", async () => {
  const { connectedComponents } = await localThicknessApi;
  const mask = new Uint8Array([
    1, 1, 0, 0, 0,
    1, 1, 0, 1, 1,
    0, 0, 0, 1, 1,
  ]);
  const local = new Float32Array(mask.length).fill(1);
  const { labels, components } = connectedComponents(mask, 5, 3, local);
  assert.equal(components.length, 2);
  assert.deepEqual(components.map((component) => component.area), [4, 4]);
  assert.notEqual(labels[0], labels[9]);
});

test("connected-component orientation preserves negative, zero, and positive angles", async () => {
  const { connectedComponents } = await localThicknessApi;
  const componentOrientation = (points) => {
    const width = 9;
    const mask = new Uint8Array(width * width);
    points.forEach(([x, y]) => {
      mask[y * width + x] = 1;
    });
    return connectedComponents(
      mask,
      width,
      width,
      new Float32Array(mask.length).fill(1),
    ).components[0].orientation;
  };

  assert.equal(
    componentOrientation([
      [2, 4], [3, 4], [4, 4], [5, 4], [6, 4],
    ]),
    0,
  );
  assert.ok(
    componentOrientation([
      [2, 6], [2, 5], [3, 5], [3, 4],
      [4, 4], [4, 3], [5, 3], [5, 2],
    ]) < 0,
  );
  assert.ok(
    componentOrientation([
      [2, 2], [2, 3], [3, 3], [3, 4],
      [4, 4], [4, 5], [5, 5], [5, 6],
    ]) > 0,
  );
});

test("chord lengths are extracted independently by direction", async () => {
  const { chordLengths } = await localThicknessApi;
  const mask = new Uint8Array([
    1, 1, 1,
    0, 1, 0,
    0, 1, 0,
  ]);
  const chords = chordLengths(mask, 3, 3);
  assert.deepEqual([...chords.horizontal], [3, 1, 1]);
  assert.deepEqual([...chords.vertical], [1, 3, 1]);
});
