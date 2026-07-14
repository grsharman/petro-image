const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

function runWorkerHarness(body) {
  const workerPath = path.join(
    __dirname,
    "..",
    "scripts",
    "axioscan_czi_worker.py",
  );
  const harness = `
import importlib.util
import json
import sys
import types

sys.modules["numpy"] = types.ModuleType("numpy")
pil = types.ModuleType("PIL")
pil.Image = object()
sys.modules["PIL"] = pil
pylib = types.ModuleType("pylibCZIrw")
pylib.czi = object()
sys.modules["pylibCZIrw"] = pylib

spec = importlib.util.spec_from_file_location("axioscan_worker", sys.argv[1])
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
${body}
`;
  return spawnSync("python3", ["-c", harness, workerPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONPYCACHEPREFIX: "/tmp/petro-image-test-pycache",
    },
  });
}

test("AxioScan tile sets adapt to the selected channels", (t) => {
  const python = spawnSync("python3", ["--version"], { encoding: "utf8" });
  if (python.error || python.status !== 0) {
    t.skip("python3 is not available");
    return;
  }

  const result = runWorkerHarness(`
details = [
    {"index": 0, "kind": "brightfield", "label": "Brightfield"},
    {"index": 1, "kind": "ppl", "label": "PPL 0", "angleDegrees": 0},
    {"index": 2, "kind": "ppl", "label": "PPL 30", "angleDegrees": 30},
    {"index": 3, "kind": "xpl", "label": "XPL 15", "angleDegrees": 15},
    {"index": 4, "kind": "cpl", "label": "CPL"},
]
print(json.dumps(worker.build_tile_set_specs(details)))
`);
  assert.equal(result.status, 0, result.stderr);
  const specs = JSON.parse(result.stdout);
  assert.deepEqual(specs.map((spec) => spec.label), [
    "Brightfield",
    "CPL",
    "XPL",
    "PPL",
  ]);
  assert.equal(specs.find((spec) => spec.label === "PPL").rotationEnabled, true);
  assert.equal(specs.find((spec) => spec.label === "PPL").periodDegrees, 180);
  assert.equal(specs.find((spec) => spec.label === "XPL").rotationEnabled, false);
  assert.equal("periodDegrees" in specs.find((spec) => spec.label === "XPL"), false);
});

test("Brightfield and CPL channels always produce individual tile sets", () => {
  const result = runWorkerHarness(`
details = [
    {"index": 0, "kind": "brightfield", "label": "Brightfield"},
    {"index": 1, "kind": "brightfield", "label": "Brightfield"},
    {"index": 2, "kind": "cpl", "label": "CPL"},
    {"index": 3, "kind": "cpl", "label": "CPL"},
]
print(json.dumps(worker.build_tile_set_specs(details)))
`);
  assert.equal(result.status, 0, result.stderr);
  const specs = JSON.parse(result.stdout);
  assert.deepEqual(specs.map((spec) => spec.label), [
    "Brightfield 1",
    "Brightfield 2",
    "CPL 1",
    "CPL 2",
  ]);
  assert.ok(specs.every((spec) => spec.channelIndices.length === 1));
  assert.ok(specs.every((spec) => spec.rotationEnabled === false));
});

test("AxioScan performance metrics aggregate level timings and pixel counts", () => {
  const result = runWorkerHarness(`
levels = [
    {"tileCount": 2, "readCalls": 2, "readSeconds": 1.5,
     "colorSeconds": 0.2, "resizeSeconds": 0.1, "jpegSeconds": 0.4,
     "requestedSourcePixels": 2000, "returnedPixels": 1000,
     "outputPixels": 900, "wallSeconds": 2.3},
    {"tileCount": 1, "readCalls": 1, "readSeconds": 0.5,
     "colorSeconds": 0.1, "resizeSeconds": 0.0, "jpegSeconds": 0.2,
     "requestedSourcePixels": 500, "returnedPixels": 250,
     "outputPixels": 225, "wallSeconds": 0.9},
]
print(json.dumps(worker.summarize_metrics(levels)))
`);
  assert.equal(result.status, 0, result.stderr);
  const metrics = JSON.parse(result.stdout);
  assert.equal(metrics.tileCount, 3);
  assert.equal(metrics.readCalls, 3);
  assert.equal(metrics.readSeconds, 2);
  assert.ok(Math.abs(metrics.jpegSeconds - 0.6) < 1e-9);
  assert.equal(metrics.requestedSourcePixels, 2500);
  assert.equal(metrics.returnedPixels, 1250);
  assert.equal(metrics.outputPixels, 1125);
  assert.ok(Math.abs(metrics.wallSeconds - 3.2) < 1e-9);
});

test("AxioScan read benchmark compares chunk sizes without writing images", () => {
  const result = runWorkerHarness(`
class Bounds:
    x = 0
    y = 0
    w = 8192
    h = 8192

class Pixels:
    ndim = 3
    def __init__(self, width, height):
        self.shape = (height, width, 3)

class Reader:
    total_bounding_rectangle = Bounds()
    metadata = {"ImageDocument": {"Metadata": {
        "Information": {
            "Image": {"Dimensions": {"Channels": {"Channel": {
                "@Name": "Brightfield", "ContrastMethod": "Brightfield"
            }}}},
            "Instrument": {"Microscopes": {"Microscope": {
                "@Name": "Axioscan 7"
            }}}
        }
    }}}
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self, roi, plane, scene, zoom):
        return Pixels(round(roi[2] * zoom), round(roi[3] * zoom))

class FakeCzi:
    def open_czi(self, source): return Reader()

worker.czi = FakeCzi()
metrics = worker.benchmark_czi_reads(
    worker.Path("sample.czi"), 0, 1, max_output_side=512
)
print(json.dumps(metrics))
`);
  assert.equal(result.status, 0, result.stderr);
  const metrics = JSON.parse(result.stdout.trim().split("\n").at(-1));
  assert.equal(metrics.channelLabel, "Brightfield");
  assert.deepEqual(metrics.results.map((entry) => entry.chunkSize), [
    254,
    512,
    1024,
    2048,
    4096,
  ]);
  assert.equal(metrics.results[0].readCalls, 9);
  assert.equal(metrics.results[1].readCalls, 1);
  assert.equal(metrics.results[0].returnedPixels, 512 * 512);
});

test("DZI levels use large CZI reads and retain individual tile output", () => {
  const result = runWorkerHarness(`
import tempfile

read_boxes = []
saved_tiles = []

class Tile:
    def __init__(self, width, height):
        self.width = width
        self.height = height
    def save(self, path, image_format, quality):
        saved_tiles.append((path.name, self.width, self.height))

class BatchImage:
    def __init__(self, width, height):
        self.width = width
        self.height = height
    def crop(self, box):
        assert 0 <= box[0] < box[2] <= self.width
        assert 0 <= box[1] < box[3] <= self.height
        return Tile(box[2] - box[0], box[3] - box[1])

def fake_read_tile(reader, channel, roi, zoom, tile_box):
    read_boxes.append(tile_box)
    width = tile_box[2] - tile_box[0]
    height = tile_box[3] - tile_box[1]
    return BatchImage(width, height), {
        "readSeconds": 0.1,
        "colorSeconds": 0.01,
        "resizeSeconds": 0,
        "requestedSourcePixels": width * height,
        "returnedPixels": width * height,
        "outputPixels": width * height,
    }

worker.read_tile = fake_read_tile
completed = []
metrics = worker.write_level_tiles(
    object(), 0, (0, 0, 5000, 300), 1, 5000, 300,
    worker.Path(tempfile.mkdtemp()), 13, 90, completed.append
)
print(json.dumps({
    "metrics": metrics,
    "readBoxes": read_boxes,
    "savedTiles": saved_tiles,
    "savedCount": len(saved_tiles),
    "completedCount": len(completed),
}))
`);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.metrics.tileCount, 40);
  assert.equal(output.metrics.readCalls, 2);
  assert.equal(output.savedCount, 40);
  assert.equal(output.completedCount, 40);
  assert.deepEqual(output.savedTiles.find((tile) => tile[0] === "15_0.jpg"), [
    "15_0.jpg",
    256,
    255,
  ]);
  assert.deepEqual(output.savedTiles.find((tile) => tile[0] === "16_0.jpg"), [
    "16_0.jpg",
    256,
    255,
  ]);
  assert.deepEqual(output.readBoxes, [
    [0, 0, 4065, 300],
    [4063, 0, 5000, 300],
  ]);
});
