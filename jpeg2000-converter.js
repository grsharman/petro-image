import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const DZI_TILE_SIZE = 254;
const DZI_OVERLAP = 1;
const JPEG_QUALITY = 90;

export const JPEG2000_EXTENSIONS = new Set([
  ".jp2",
  ".j2k",
  ".j2c",
  ".jpc",
  ".jpf",
  ".jpx",
]);

export function isJpeg2000Path(sourcePath) {
  return JPEG2000_EXTENSIONS.has(path.extname(String(sourcePath || "")).toLowerCase());
}

export function parseVipsProgress(line) {
  const match = String(line || "").match(/(?:^|\s)(\d+(?:\.\d+)?)%\s+complete\b/i);
  if (!match) return null;
  return Math.max(0, Math.min(100, Number(match[1])));
}

export async function convertJpeg2000ToDzi(
  sourcePath,
  onProgress = () => {},
  outputDirectory = path.dirname(sourcePath),
  options = {},
) {
  if (!isJpeg2000Path(sourcePath)) {
    throw new Error("Choose a supported JPEG 2000 still image.");
  }

  await fs.access(sourcePath).catch(() => {
    throw new Error("The selected JPEG 2000 file could not be found.");
  });

  const { dziPath, tilesPath } = await getUniqueDziOutputPaths(
    sourcePath,
    outputDirectory,
  );
  const outputBase = dziPath.replace(/\.dzi$/i, "");
  const command = options.command || "vips";
  let lastPercent = -1;
  const emitProgress = (percent) => {
    if (percent === lastPercent) return;
    lastPercent = percent;
    onProgress(createProgress(sourcePath, percent));
  };
  const args = [
    "--vips-progress",
    "dzsave",
    sourcePath,
    outputBase,
    "--layout",
    "dz",
    "--tile-size",
    String(DZI_TILE_SIZE),
    "--overlap",
    String(DZI_OVERLAP),
    "--suffix",
    `.jpg[Q=${JPEG_QUALITY}]`,
  ];

  await fs.mkdir(outputDirectory, { recursive: true });
  emitProgress(0);

  const result = await runVips(command, args, {
    env: options.env,
    onChild: options.onChild,
    spawnImpl: options.spawnImpl,
    onLine: (line) => {
      const percent = parseVipsProgress(line);
      if (percent !== null) emitProgress(percent);
    },
  });

  if (result.exitCode !== 0) {
    await cleanupPartialOutput(dziPath, tilesPath);
    if (result.canceled) throw new Error("JPEG 2000 conversion canceled.");
    const detail = lastNonemptyLine(result.stderr || result.error);
    throw new Error(
      detail
        ? `Could not convert the JPEG 2000 image: ${detail}`
        : "Could not convert the JPEG 2000 image.",
    );
  }

  let descriptor;
  try {
    descriptor = parseDziDescriptor(await fs.readFile(dziPath, "utf8"));
  } catch (error) {
    await cleanupPartialOutput(dziPath, tilesPath);
    throw new Error(
      `JPEG 2000 conversion did not create a valid DZI descriptor: ${error.message}`,
    );
  }

  emitProgress(100);
  return {
    dziPath,
    tilesPath,
    width: descriptor.width,
    height: descriptor.height,
    tileSize: descriptor.tileSize,
    overlap: descriptor.overlap,
  };
}

function createProgress(sourcePath, percent) {
  return {
    sourcePath,
    completedTiles: 0,
    totalTiles: 0,
    level: 0,
    percent,
  };
}

function runVips(command, args, options) {
  return new Promise((resolve) => {
    const spawnImpl = options.spawnImpl || spawn;
    const child = spawnImpl(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
    options.onChild?.(child);

    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;

    const consume = (name, chunk) => {
      const text = chunk.toString();
      if (name === "stdout") {
        stdout += text;
        stdoutBuffer += text;
        stdoutBuffer = consumeLines(stdoutBuffer, options.onLine);
      } else {
        stderr += text;
        stderrBuffer += text;
        stderrBuffer = consumeLines(stderrBuffer, options.onLine);
      }
    };

    child.stdout.on("data", (chunk) => consume("stdout", chunk));
    child.stderr.on("data", (chunk) => consume("stderr", chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode: null,
        stdout,
        stderr,
        error: error.message,
        canceled: Boolean(child._petroImageCanceled),
      });
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      if (stdoutBuffer.trim()) options.onLine?.(stdoutBuffer.trim());
      if (stderrBuffer.trim()) options.onLine?.(stderrBuffer.trim());
      resolve({
        exitCode,
        stdout,
        stderr,
        canceled: Boolean(child._petroImageCanceled),
      });
    });
  });
}

function consumeLines(buffer, onLine) {
  const lines = buffer.split(/\r|\n/);
  const remainder = lines.pop() || "";
  lines.forEach((line) => {
    if (line.trim()) onLine?.(line.trim());
  });
  return remainder;
}

function parseDziDescriptor(xml) {
  const image = String(xml).match(/<Image\b([^>]*)>/i);
  const size = String(xml).match(/<Size\b([^>]*)\/?\s*>/i);
  if (!image || !size) throw new Error("missing Image or Size element");

  const tileSize = numberAttribute(image[1], "TileSize");
  const overlap = numberAttribute(image[1], "Overlap");
  const width = numberAttribute(size[1], "Width");
  const height = numberAttribute(size[1], "Height");
  if (![tileSize, overlap, width, height].every(Number.isFinite)) {
    throw new Error("missing numeric image attributes");
  }
  return { tileSize, overlap, width, height };
}

function numberAttribute(attributes, name) {
  const match = attributes.match(new RegExp(`\\b${name}=["'](\\d+)["']`, "i"));
  return match ? Number(match[1]) : Number.NaN;
}

async function getUniqueDziOutputPaths(sourcePath, outputDirectory) {
  const baseName = path.parse(sourcePath).name;
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index === 0 ? "" : `-${index}`;
    const outputBaseName = `${baseName}${suffix}`;
    const dziPath = path.join(outputDirectory, `${outputBaseName}.dzi`);
    const tilesPath = path.join(outputDirectory, `${outputBaseName}_files`);
    if (!(await pathExists(dziPath)) && !(await pathExists(tilesPath))) {
      return { dziPath, tilesPath };
    }
  }
  const outputBaseName = `${baseName}-${Date.now()}`;
  return {
    dziPath: path.join(outputDirectory, `${outputBaseName}.dzi`),
    tilesPath: path.join(outputDirectory, `${outputBaseName}_files`),
  };
}

async function cleanupPartialOutput(dziPath, tilesPath) {
  await Promise.all([
    fs.rm(dziPath, { force: true }),
    fs.rm(tilesPath, { recursive: true, force: true }),
  ]);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function lastNonemptyLine(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
}
