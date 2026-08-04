const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("segmenteverygrain validation allows slow native imports", () => {
  const validator = fs.readFileSync(
    path.resolve(
      __dirname,
      "..",
      "scripts",
      "segmenteverygrain_validate.py",
    ),
    "utf8",
  );

  assert.match(validator, /IMPORT_TIMEOUT_SECONDS = 120/);
  assert.match(validator, /"installed": True/);
  assert.match(validator, /"timedOut": True/);
  assert.doesNotMatch(validator, /timeout=45/);

  const interfaceSource = fs.readFileSync(
    path.resolve(__dirname, "..", "index.js"),
    "utf8",
  );
  assert.match(interfaceSource, /found; import timed out/);
  assert.match(interfaceSource, /found; import failed/);
});

test("segmenteverygrain validation survives a native-style import exit", (t) => {
  const python = spawnSync("python3", ["--version"], { encoding: "utf8" });
  if (python.error || python.status !== 0) {
    t.skip("python3 is not available");
    return;
  }

  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "petro-image-seg-validation-"),
  );
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

  fs.writeFileSync(
    path.join(temporaryDirectory, "segmenteverygrain.py"),
    "import os\nos._exit(23)\n",
  );
  const modelPath = path.join(temporaryDirectory, "model.keras");
  fs.writeFileSync(modelPath, "model placeholder");

  const validatorPath = path.resolve(
    __dirname,
    "..",
    "scripts",
    "segmenteverygrain_validate.py",
  );
  const result = spawnSync("python3", [validatorPath, modelPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONPATH: [temporaryDirectory, process.env.PYTHONPATH]
        .filter(Boolean)
        .join(path.delimiter),
    },
    timeout: 120000,
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(
    result.stdout
      .trim()
      .split(/\r?\n/)
      .filter((line) => line.trim().startsWith("{"))
      .at(-1),
  );
  assert.equal(payload.ok, false);
  assert.equal(payload.modules.segmenteverygrain.available, false);
  assert.equal(payload.modules.segmenteverygrain.exitCode, 23);
  assert.match(payload.errors.join("\n"), /segmenteverygrain import failed/);
});
