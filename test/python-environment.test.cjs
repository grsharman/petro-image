const test = require("node:test");
const assert = require("node:assert/strict");

const pythonEnvironmentApi = import("../python-environment.js");

test("Windows Python environment includes Conda DLL directories", async () => {
  const { buildPythonProcessEnv } = await pythonEnvironmentApi;
  const env = buildPythonProcessEnv(
    String.raw`C:\Users\CSRG\anaconda3\envs\segmenteverygrain\python.exe`,
    { TF_CPP_MIN_LOG_LEVEL: "2" },
    {
      platform: "win32",
      baseEnv: { Path: String.raw`C:\Windows\System32;C:\Windows` },
    },
  );

  assert.equal(env.TF_CPP_MIN_LOG_LEVEL, "2");
  assert.equal(
    env.Path,
    [
      String.raw`C:\Users\CSRG\anaconda3\envs\segmenteverygrain`,
      String.raw`C:\Users\CSRG\anaconda3\envs\segmenteverygrain\Library\mingw-w64\bin`,
      String.raw`C:\Users\CSRG\anaconda3\envs\segmenteverygrain\Library\usr\bin`,
      String.raw`C:\Users\CSRG\anaconda3\envs\segmenteverygrain\Library\bin`,
      String.raw`C:\Users\CSRG\anaconda3\envs\segmenteverygrain\Scripts`,
      String.raw`C:\Users\CSRG\anaconda3\envs\segmenteverygrain\bin`,
      String.raw`C:\Windows\System32`,
      String.raw`C:\Windows`,
    ].join(";"),
  );
});

test("non-Windows Python environment is unchanged apart from overrides", async () => {
  const { buildPythonProcessEnv } = await pythonEnvironmentApi;
  const env = buildPythonProcessEnv(
    "/opt/conda/envs/segmenteverygrain/bin/python",
    { EXTRA_SETTING: "enabled" },
    { platform: "linux", baseEnv: { PATH: "/usr/bin" } },
  );

  assert.deepEqual(env, { PATH: "/usr/bin", EXTRA_SETTING: "enabled" });
});
