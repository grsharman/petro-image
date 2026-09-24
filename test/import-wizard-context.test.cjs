const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

function extractFunction(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = source.indexOf(") {", start) + 2;
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function loadContextApi({ activeLibrary = null, initialization = null } = {}) {
  const context = {
    path,
    activeProjectLibrary: activeLibrary,
    projectLibraryInitializationPromise: initialization,
    getBundledDefaultLibraryPath: () => "/app/samples.json",
    getBundledProjectLibraryTemplatePath: () => "/app/default_library.json",
  };
  vm.runInNewContext(
    `${extractFunction("getImportWizardContext")}\nthis.api = getImportWizardContext;`,
    context,
  );
  return { api: context.api, context };
}

test("the import wizard waits for a project library that is still loading", async () => {
  let finishLoading;
  const initialization = new Promise((resolve) => {
    finishLoading = resolve;
  });
  const { api, context } = loadContextApi({ initialization });
  const resultPromise = api({ filePath: "", jsonData: { samples: [] } });

  context.activeProjectLibrary = {
    filePath: "/Volumes/Images/petro-image/library.json",
    jsonData: { samples: [{ title: "External sample" }] },
  };
  finishLoading();

  const result = await resultPromise;
  assert.equal(result.filePath, "/Volumes/Images/petro-image/library.json");
  assert.equal(result.canWriteCurrentLibrary, true);
  assert.equal(result.jsonData.samples[0].title, "External sample");
});

test("a loaded renderer library takes precedence over the cached project", async () => {
  const { api } = loadContextApi({
    activeLibrary: {
      filePath: "/Volumes/Images/project/library.json",
      jsonData: { samples: [{ title: "Cached" }] },
    },
  });

  const result = await api({
    filePath: "/Volumes/Images/other/library.json",
    jsonData: { samples: [{ title: "Current" }] },
  });

  assert.equal(result.filePath, "/Volumes/Images/other/library.json");
  assert.equal(result.jsonData.samples[0].title, "Current");
});

test("bundled libraries remain read-only", async () => {
  const { api } = loadContextApi();
  const result = await api({
    filePath: "/app/samples.json",
    jsonData: { samples: [] },
  });

  assert.equal(result.canWriteCurrentLibrary, false);
});
