const test = require("node:test");
const assert = require("node:assert/strict");

const processOutputApi = import("../process-output.js");

test("process output parser returns the final JSON object", async () => {
  const { parseJsonProcessOutput } = await processOutputApi;
  const parsed = parseJsonProcessOutput(
    'startup message\r\n{"ok":false}\r\n{"ok":true,"platform":"win32"}\r\n2026\r\n',
  );

  assert.deepEqual(parsed, { ok: true, platform: "win32" });
});

test("process output parser recovers JSON appended to unterminated startup output", async () => {
  const { parseJsonProcessOutput } = await processOutputApi;
  const parsed = parseJsonProcessOutput(
    'TensorFlow startup message without newline{"ok":true,"modules":{"tensorflow":{"available":true}}}',
  );

  assert.deepEqual(parsed, {
    ok: true,
    modules: { tensorflow: { available: true } },
  });
});

test("process output parser rejects output without JSON", async () => {
  const { parseJsonProcessOutput } = await processOutputApi;

  assert.throws(
    () => parseJsonProcessOutput("TensorFlow failed before producing a result"),
    /did not write JSON/,
  );
});
