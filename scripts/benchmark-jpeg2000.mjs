import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { convertJpeg2000ToDzi } from "../jpeg2000-converter.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const sourcePath = process.argv[2] ? path.resolve(process.argv[2]) : "";
const outputDirectory = process.argv[3]
  ? path.resolve(process.argv[3])
  : sourcePath
    ? path.join(path.dirname(sourcePath), "petro-image-jpeg2000-benchmark")
    : "";

if (!sourcePath) {
  console.error(
    "Usage: npm run benchmark:jpeg2000 -- /path/to/image.jp2 [/path/to/output]",
  );
  process.exitCode = 2;
} else {
  await main();
}

async function main() {
  const workerRoot = path.join(projectDirectory, "build", "vips-worker");
  const executable = path.join(
    workerRoot,
    "bin",
    process.platform === "win32" ? "vips.exe" : "vips",
  );
  await fs.access(executable).catch(() => {
    throw new Error("Build the worker first with npm run build:vips-worker.");
  });
  const source = await fs.stat(sourcePath);
  let lastReported = -5;
  const started = performance.now();
  const result = await convertJpeg2000ToDzi(
    sourcePath,
    ({ percent }) => {
      const rounded = Math.floor(percent / 5) * 5;
      if (rounded >= lastReported + 5 || percent === 100) {
        lastReported = rounded;
        console.log(`Conversion progress: ${percent.toFixed(1)}%`);
      }
    },
    outputDirectory,
    {
      command: executable,
      env: runtimeEnvironment(workerRoot),
    },
  );
  const outputBytes = await directorySize(outputDirectory);
  const elapsedSeconds = (performance.now() - started) / 1000;
  console.log(
    JSON.stringify(
      {
        sourcePath,
        sourceBytes: source.size,
        outputDirectory,
        outputBytes,
        elapsedSeconds,
        width: result.width,
        height: result.height,
        tileSize: result.tileSize,
        overlap: result.overlap,
      },
      null,
      2,
    ),
  );
}

function runtimeEnvironment(workerRoot) {
  const libraryDirectory = path.join(workerRoot, "lib");
  if (process.platform === "darwin") {
    return { DYLD_LIBRARY_PATH: libraryDirectory };
  }
  if (process.platform === "linux") {
    return { LD_LIBRARY_PATH: libraryDirectory };
  }
  return {
    PATH: [path.join(workerRoot, "bin"), process.env.PATH]
      .filter(Boolean)
      .join(path.delimiter),
  };
}

async function directorySize(directory) {
  let total = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directorySize(entryPath);
    else if (entry.isFile()) total += (await fs.stat(entryPath)).size;
  }
  return total;
}
