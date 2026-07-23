const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const storePromise = import("../desktop-annotation-store.js");

test("legacy libraries receive stable unique sample IDs", async () => {
  const { normalizeLibrarySampleIds } = await storePromise;
  const ids = ["01arz3nd", "01arz3ne"];
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
    ["01arz3nd", "01arz3ne"],
  );
});

test("valid IDs are preserved and duplicate IDs are repaired", async () => {
  const { normalizeLibrarySampleIds } = await storePromise;
  const existingUuid = "20000000-0000-4000-8000-000000000001";
  const existingShortId = "01arz3nh";
  const replacement = "01arz3nf";
  const library = {
    samples: [
      { title: "Legacy UUID", sampleId: existingUuid },
      { title: "Short ID", sampleId: existingShortId },
      { title: "Duplicate short ID", sampleId: existingShortId },
    ],
  };

  normalizeLibrarySampleIds(library, () => replacement);
  assert.equal(library.samples[0].sampleId, existingUuid);
  assert.equal(library.samples[1].sampleId, existingShortId);
  assert.equal(library.samples[2].sampleId, replacement);
});

test("generated sample IDs are short, filename-safe, and unique", async () => {
  const { createSampleId, isValidSampleId } = await storePromise;
  const ids = Array.from({ length: 100 }, () => createSampleId());

  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, /^[0-9a-hjkmnp-tv-z]{8}$/);
    assert.equal(isValidSampleId(id), true);
  }
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
    petroImage: {
      annotationCoordinateSpace: {
        version: 1,
        width: 20000,
        height: 10000,
      },
    },
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
  assert.deepEqual(
    loaded.petroImage.annotationCoordinateSpace,
    geoJSON.petroImage.annotationCoordinateSpace,
  );

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
  const sampleId = "01arz3ng";

  await saveWorkingAnnotations(projectDirectory, {
    sampleId,
    geoJSON: { type: "FeatureCollection", features: [] },
  });
  const loaded = await loadWorkingAnnotations(projectDirectory, sampleId);
  assert.deepEqual(loaded.features, []);
  const files = await fs.readdir(path.join(projectDirectory, "annotations"));
  assert.deepEqual(files, ["01arz3ng.working.geojson"]);
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

test("working counts round-trip in the project counts folder", async (t) => {
  const { loadWorkingCounts, saveWorkingCounts } = await storePromise;
  const projectDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "petro-image-counts-"),
  );
  t.after(() => fs.rm(projectDirectory, { recursive: true, force: true }));
  const sampleId = "60000000-0000-4000-8000-000000000001";
  const geoJSON = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [10, 20] },
        properties: { uuid: "count-1", label: "1", id: "quartz" },
      },
    ],
  };

  await saveWorkingCounts(projectDirectory, {
    sampleId,
    sampleTitle: "Counted sample",
    geoJSON,
  });

  const loaded = await loadWorkingCounts(projectDirectory, sampleId);
  assert.deepEqual(loaded.features, geoJSON.features);
  assert.equal(loaded.petroImage.kind, "working-counts");
  assert.equal(loaded.petroImage.sampleId, sampleId);
  assert.equal(loaded.petroImage.sampleTitle, "Counted sample");
  const files = await fs.readdir(path.join(projectDirectory, "counts"));
  assert.deepEqual(files, [`${sampleId}.working.geojson`]);
});

test("a sample without working counts returns null", async (t) => {
  const { loadWorkingCounts } = await storePromise;
  const projectDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "petro-image-missing-counts-"),
  );
  t.after(() => fs.rm(projectDirectory, { recursive: true, force: true }));

  const loaded = await loadWorkingCounts(
    projectDirectory,
    "70000000-0000-4000-8000-000000000001",
  );
  assert.equal(loaded, null);
});
