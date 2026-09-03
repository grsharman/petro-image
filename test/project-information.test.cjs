const test = require("node:test");
const assert = require("node:assert/strict");

let projectInformation;

test.before(async () => {
  projectInformation = await import("../project-information.js");
});

test("summarizes samples and image layers", () => {
  assert.deepEqual(
    projectInformation.summarizeProjectLibrary({
      samples: [
        { tileSets: [{}, {}] },
        { tileSets: [{}] },
        {},
      ],
    }),
    { sampleCount: 3, imageLayerCount: 3 },
  );
});

test("handles an invalid or empty library", () => {
  assert.deepEqual(projectInformation.summarizeProjectLibrary(), {
    sampleCount: 0,
    imageLayerCount: 0,
  });
  assert.deepEqual(projectInformation.summarizeProjectLibrary({ samples: null }), {
    sampleCount: 0,
    imageLayerCount: 0,
  });
});

test("formats singular and plural content counts", () => {
  assert.equal(
    projectInformation.formatProjectContents({
      sampleCount: 1,
      imageLayerCount: 1,
    }),
    "1 sample · 1 image layer",
  );
  assert.equal(
    projectInformation.formatProjectContents({
      sampleCount: 2,
      imageLayerCount: 4,
    }),
    "2 samples · 4 image layers",
  );
});

test("uses the platform-specific project folder button label", () => {
  assert.equal(projectInformation.getProjectFolderButtonLabel("darwin"), "Show in Finder");
  assert.equal(
    projectInformation.getProjectFolderButtonLabel("win32"),
    "Show in File Explorer",
  );
  assert.equal(
    projectInformation.getProjectFolderButtonLabel("linux"),
    "Open Project Folder",
  );
});
