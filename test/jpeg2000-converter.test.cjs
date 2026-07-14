const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(
  path.join(__dirname, "..", "jpeg2000-converter.js"),
).href;

function createFakeSpawn(run) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      setImmediate(() => child.emit("close", null));
      return true;
    };
    setImmediate(() => {
      Promise.resolve(run({ child, command, args, options })).catch((error) => {
        child.emit("error", error);
      });
    });
    return child;
  };
}

async function makeSource(extension = ".jp2") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "petro-jp2-test-"));
  const sourcePath = path.join(directory, `source${extension}`);
  const outputDirectory = path.join(directory, "dzi");
  await fs.writeFile(sourcePath, "fixture");
  return { directory, sourcePath, outputDirectory };
}

test("recognizes supported still-image JPEG 2000 extensions", async () => {
  const { isJpeg2000Path } = await import(moduleUrl);
  for (const extension of ["jp2", "J2K", "j2c", "jpc", "jpf", "JPX"]) {
    assert.equal(isJpeg2000Path(`scan.${extension}`), true);
  }
  for (const extension of ["jpg", "jpm", "mj2", "tif"]) {
    assert.equal(isJpeg2000Path(`scan.${extension}`), false);
  }
});

test("parses libvips progress output", async () => {
  const { parseVipsProgress } = await import(moduleUrl);
  assert.equal(parseVipsProgress("vips temp-1: 42% complete"), 42);
  assert.equal(parseVipsProgress("scan: 99.5% complete"), 99.5);
  assert.equal(parseVipsProgress("not progress"), null);
});

test("converts JPEG 2000 directly to the expected DZI contract", async (t) => {
  const { convertJpeg2000ToDzi } = await import(moduleUrl);
  const fixture = await makeSource();
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const progress = [];
  let invocation;
  const spawnImpl = createFakeSpawn(async ({ child, command, args, options }) => {
    invocation = { command, args, options };
    const outputBase = args[3];
    await fs.mkdir(`${outputBase}_files/0`, { recursive: true });
    await fs.writeFile(
      `${outputBase}.dzi`,
      '<?xml version="1.0"?><Image TileSize="254" Overlap="1" Format="jpg"><Size Width="120000" Height="80000"/></Image>',
    );
    child.stderr.write("vips source: 37% complete\n");
    child.stderr.end();
    child.emit("close", 0);
  });

  const result = await convertJpeg2000ToDzi(
    fixture.sourcePath,
    (event) => progress.push(event.percent),
    fixture.outputDirectory,
    { command: "/bundle/bin/vips", spawnImpl },
  );

  assert.equal(invocation.command, "/bundle/bin/vips");
  assert.deepEqual(invocation.args.slice(0, 4), [
    "--vips-progress",
    "dzsave",
    fixture.sourcePath,
    path.join(fixture.outputDirectory, "source"),
  ]);
  assert.ok(invocation.args.includes(".jpg[Q=90]"));
  assert.equal(result.width, 120000);
  assert.equal(result.height, 80000);
  assert.equal(result.tileSize, 254);
  assert.equal(result.overlap, 1);
  assert.deepEqual(progress, [0, 37, 100]);
});

test("removes partial DZI output after a worker failure", async (t) => {
  const { convertJpeg2000ToDzi } = await import(moduleUrl);
  const fixture = await makeSource(".j2k");
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  let outputBase;
  const spawnImpl = createFakeSpawn(async ({ child, args }) => {
    outputBase = args[3];
    await fs.mkdir(`${outputBase}_files/0`, { recursive: true });
    await fs.writeFile(`${outputBase}.dzi`, "partial");
    child.stderr.end("OpenJPEG decode failed\n");
    child.emit("close", 1);
  });

  await assert.rejects(
    convertJpeg2000ToDzi(
      fixture.sourcePath,
      () => {},
      fixture.outputDirectory,
      { spawnImpl },
    ),
    /OpenJPEG decode failed/,
  );
  await assert.rejects(fs.access(`${outputBase}.dzi`));
  await assert.rejects(fs.access(`${outputBase}_files`));
});

test("marks a killed worker as a canceled conversion", async (t) => {
  const { convertJpeg2000ToDzi } = await import(moduleUrl);
  const fixture = await makeSource(".jpx");
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const spawnImpl = createFakeSpawn(() => {});

  await assert.rejects(
    convertJpeg2000ToDzi(
      fixture.sourcePath,
      () => {},
      fixture.outputDirectory,
      {
        spawnImpl,
        onChild: (child) => {
          child._petroImageCanceled = true;
          child.kill();
        },
      },
    ),
    /conversion canceled/i,
  );
});
