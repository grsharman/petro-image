const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("segmenteverygrain worker loads models once for multiple jobs", (t) => {
  const scriptsDirectory = path.resolve(__dirname, "..", "scripts");
  const python = spawnSync("python3", ["--version"], { encoding: "utf8" });
  if (python.error || python.status !== 0) {
    t.skip("python3 is not available");
    return;
  }

  const harness = String.raw`
import io
import json
import sys
from types import SimpleNamespace

sys.path.insert(0, ${JSON.stringify(scriptsDirectory)})
import segmenteverygrain_worker as worker

load_count = 0
def fake_load_models(*args):
    global load_count
    load_count += 1
    print("third-party startup output without newline", end="")
    return ("seg", "model", None, "", "cpu")

def fake_run_segmentation(job, *runtime):
    return {
        "ok": True,
        "image": job.image,
        "loadCount": load_count,
        "patchSize": job.patch_size,
        "dbsMaxDist": job.dbs_max_dist,
    }

worker.load_models = fake_load_models
worker.run_segmentation = fake_run_segmentation
sys.argv = ["segmenteverygrain_worker.py", "--model", "model.keras"]
sys.stdin = io.StringIO(
    json.dumps({"id": 1, "image": "first.png", "patchSize": 1000, "dbsMaxDist": 75}) + "\n" +
    json.dumps({"id": 2, "image": "second.png", "patchSize": 2000, "dbsMaxDist": 125}) + "\n" +
    json.dumps({"type": "shutdown", "id": 3}) + "\n"
)
raise SystemExit(worker.main())
`;
  const result = spawnSync("python3", ["-c", harness], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /third-party startup output without newline/);
  const messages = result.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  assert.equal(messages[0].type, "progress");
  assert.equal(messages[1].type, "ready");
  assert.equal(messages[2].message, "Segmentation request received by worker.");
  assert.deepEqual(
    messages.filter((message) => message.ok && message.image).map(({ id, image, loadCount, patchSize, dbsMaxDist }) => ({
      id,
      image,
      loadCount,
      patchSize,
      dbsMaxDist,
    })),
    [
      { id: 1, image: "first.png", loadCount: 1, patchSize: 1000, dbsMaxDist: 75 },
      { id: 2, image: "second.png", loadCount: 1, patchSize: 2000, dbsMaxDist: 125 },
    ],
  );
  assert.equal(messages.at(-1).type, "shutdown");
});

test("segmenteverygrain progress reports overall patch counts", (t) => {
  const scriptsDirectory = path.resolve(__dirname, "..", "scripts");
  const python = spawnSync("python3", ["--version"], { encoding: "utf8" });
  if (python.error || python.status !== 0) {
    t.skip("python3 is not available");
    return;
  }

  const harness = String.raw`
import contextlib
import io
import sys

sys.path.insert(0, ${JSON.stringify(scriptsDirectory)})
from segmenteverygrain_segment import ProgressStdout

capture = io.StringIO()
with contextlib.redirect_stdout(capture):
    progress = ProgressStdout(capture)
    progress.overall_patch_total = 12
    progress.announced_overall_patch = 1
    progress.write("patch 3/12 - 50 grains\n")
print(capture.getvalue(), end="")
`;
  const result = spawnSync("python3", ["-c", harness], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = result.stdout
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line))
    .at(-1);
  assert.equal(payload.message, "Segmentation: patch 3 of 12 complete.");
  assert.equal(payload.overallPatchCurrent, 3);
  assert.equal(payload.overallPatchTotal, 12);
});
