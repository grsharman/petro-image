const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const storePromise = import("../desktop-annotation-store.js");

test("legacy libraries receive stable unique sample IDs", async () => {
  const { normalizeLibrarySampleIds } = await storePromise;
  const ids = [
    "10000000-0000-4000-8000-000000000001",
    "10000000-0000-4000-8000-000000000002",
  ];
  const library = {
    samples: [
      { title: "Legacy A" },
      { title: "Legacy B", sampleId: "not-a-uuid" },
    ],
  };

  const result = normalizeLibrarySampleIds(library, () => ids.shift());
  assert.equal(result.changed, true);
  assert.deepEqual(
    library.samples.map((sample) => sample.sampleId),
    [
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
    ],
  );
});

test("valid IDs are preserved and duplicate IDs are repaired", async () => {
  const { normalizeLibrarySampleIds } = await storePromise;
  const existing = "20000000-0000-4000-8000-000000000001";
  const replacement = "20000000-0000-4000-8000-000000000002";
  const library = {
    samples: [
      { title: "A", sampleId: existing },
      { title: "B", sampleId: existing },
    ],
  };

  normalizeLibrarySampleIds(library, () => replacement);
  assert.equal(library.samples[0].sampleId, existing);
  assert.equal(library.samples[1].sampleId, replacement);
});

test("working annotations round-trip independently for each sample", async (t) => {
  const { loadWorkingAnnotations, saveWorkingAnnotations } = await storePromise;
  const projectDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "petro-image-annotations-"),
  );
  t.after(() => fs.rm(projectDirectory, { recursive: true, force: true }));
  const sampleId = "30000000-0000-4000-8000-000000000001";
  const geoJSON = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [10, 20] },
        properties: { uuid: "point-1" },
      },
    ],
  };

  await saveWorkingAnnotations(projectDirectory, {
    sampleId,
    sampleTitle: "Renamable sample",
    geoJSON,
  });
  const loaded = await loadWorkingAnnotations(projectDirectory, sampleId);
  assert.deepEqual(loaded.features, geoJSON.features);
  assert.equal(loaded.petroImage.kind, "working-annotations");
  assert.equal(loaded.petroImage.sampleId, sampleId);

  await saveWorkingAnnotations(projectDirectory, {
    sampleId,
    sampleTitle: "Renamed sample",
    geoJSON,
  });
  const files = await fs.readdir(path.join(projectDirectory, "annotations"));
  assert.deepEqual(files, [`${sampleId}.working.geojson`]);
  const renamed = await loadWorkingAnnotations(projectDirectory, sampleId);
  assert.equal(renamed.petroImage.sampleTitle, "Renamed sample");
});

test("saving an empty collection records cleared annotations", async (t) => {
  const { loadWorkingAnnotations, saveWorkingAnnotations } = await storePromise;
  const projectDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "petro-image-empty-annotations-"),
  );
  t.after(() => fs.rm(projectDirectory, { recursive: true, force: true }));
  const sampleId = "40000000-0000-4000-8000-000000000001";

  await saveWorkingAnnotations(projectDirectory, {
    sampleId,
    geoJSON: { type: "FeatureCollection", features: [] },
  });
  const loaded = await loadWorkingAnnotations(projectDirectory, sampleId);
  assert.deepEqual(loaded.features, []);
});

test("a sample without a working file returns null", async (t) => {
  const { loadWorkingAnnotations } = await storePromise;
  const projectDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "petro-image-missing-annotations-"),
  );
  t.after(() => fs.rm(projectDirectory, { recursive: true, force: true }));

  const loaded = await loadWorkingAnnotations(
    projectDirectory,
    "50000000-0000-4000-8000-000000000001",
  );
  assert.equal(loaded, null);
});
