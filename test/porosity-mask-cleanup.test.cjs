const test = require("node:test");
const assert = require("node:assert/strict");

const cleanupApi = import("../porosity-mask-cleanup.js").then(
  () => globalThis.PetroPorosityMaskCleanup,
);

test("fills an enclosed background component within the area threshold", async () => {
  const { fillEnclosedBackground } = await cleanupApi;
  const mask = new Uint8Array([
    1, 1, 1, 1, 1,
    1, 1, 0, 1, 1,
    1, 1, 0, 1, 1,
    1, 1, 1, 1, 1,
  ]);
  const result = fillEnclosedBackground(
    mask,
    new Uint8Array(mask.length).fill(1),
    5,
    4,
    { maxPixels: 2, fillValue: 255 },
  );
  assert.deepEqual(result, { inclusionCount: 1, filledPixels: 2 });
  assert.equal(mask.every(Boolean), true);
  assert.equal(mask[7], 255);
});

test("leaves enclosed components larger than the threshold unchanged", async () => {
  const { fillEnclosedBackground } = await cleanupApi;
  const mask = new Uint8Array([
    1, 1, 1, 1, 1,
    1, 0, 0, 0, 1,
    1, 1, 1, 1, 1,
  ]);
  const result = fillEnclosedBackground(
    mask,
    new Uint8Array(mask.length).fill(1),
    5,
    3,
    { maxPixels: 2.9 },
  );
  assert.deepEqual(result, { inclusionCount: 0, filledPixels: 0 });
  assert.equal(mask[6], 0);
});

test("does not fill background connected to an AOI or raster boundary", async () => {
  const { fillEnclosedBackground } = await cleanupApi;
  const mask = new Uint8Array([
    1, 1, 1, 1, 1,
    1, 1, 0, 1, 1,
    1, 1, 0, 1, 1,
    1, 1, 1, 1, 1,
  ]);
  const valid = new Uint8Array(mask.length).fill(1);
  valid[2] = 0;
  const result = fillEnclosedBackground(mask, valid, 5, 4, { maxPixels: 10 });
  assert.deepEqual(result, { inclusionCount: 0, filledPixels: 0 });
  assert.equal(mask[7], 0);
});

test("does not fill a gap containing another porosity type", async () => {
  const { fillEnclosedBackground } = await cleanupApi;
  const mask = new Uint8Array([
    1, 1, 1,
    1, 0, 1,
    1, 1, 1,
  ]);
  const protectedMask = new Uint8Array(mask.length);
  protectedMask[4] = 1;
  const result = fillEnclosedBackground(
    mask,
    new Uint8Array(mask.length).fill(1),
    3,
    3,
    { maxPixels: 10, protectedMask },
  );
  assert.deepEqual(result, { inclusionCount: 0, filledPixels: 0 });
  assert.equal(mask[4], 0);
});
