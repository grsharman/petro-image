import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

const DZI_TILE_SIZE = 254;
const DZI_OVERLAP = 1;
const JPEG_QUALITY = 90;

export async function convertJpgToDzi(
  sourcePath,
  onProgress = () => {},
  outputDirectory = path.dirname(sourcePath),
) {
  let metadata;

  try {
    metadata = await createSourceImage(sourcePath).metadata();
  } catch (error) {
    throw new Error("Could not load the selected JPG file.");
  }

  const { width, height } = metadata;

  if (!width || !height) {
    throw new Error("Could not load the selected JPG file.");
  }

  const maxLevel = Math.ceil(Math.log2(Math.max(width, height)));
  const { dziPath, tilesPath } = await getUniqueDziOutputPaths(
    sourcePath,
    outputDirectory,
  );
  const totalTiles = countTiles(width, height, maxLevel);
  let completedTiles = 0;

  const emitProgress = (level = 0) => {
    onProgress({
      sourcePath,
      completedTiles,
      totalTiles,
      level,
      percent: totalTiles ? Math.round((completedTiles / totalTiles) * 100) : 0,
    });
  };

  await fs.mkdir(outputDirectory, { recursive: true });
  emitProgress(0);

  await createSourceImage(sourcePath)
    .jpeg({ quality: JPEG_QUALITY })
    .tile({
      size: DZI_TILE_SIZE,
      overlap: DZI_OVERLAP,
      layout: "dz",
    })
    .toFile(stripDziExtension(dziPath));

  completedTiles = totalTiles;
  emitProgress(maxLevel);

  return {
    dziPath,
    tilesPath,
    width,
    height,
    tileSize: DZI_TILE_SIZE,
    overlap: DZI_OVERLAP,
  };
}

function stripDziExtension(dziPath) {
  return dziPath.replace(/\.dzi$/i, "");
}

function createSourceImage(sourcePath) {
  return sharp(sourcePath, {
    limitInputPixels: false,
    sequentialRead: true,
  });
}

function countTiles(width, height, maxLevel) {
  let totalTiles = 0;

  for (let level = 0; level <= maxLevel; level += 1) {
    const scale = 2 ** (maxLevel - level);
    const levelWidth = Math.max(1, Math.ceil(width / scale));
    const levelHeight = Math.max(1, Math.ceil(height / scale));
    const columns = Math.ceil(levelWidth / DZI_TILE_SIZE);
    const rows = Math.ceil(levelHeight / DZI_TILE_SIZE);

    totalTiles += columns * rows;
  }

  return totalTiles;
}

async function getUniqueDziOutputPaths(sourcePath, outputDirectory) {
  const parsed = path.parse(sourcePath);
  const baseName = parsed.name;

  for (let index = 0; index < 1000; index += 1) {
    const suffix = index === 0 ? "" : `-${index}`;
    const outputBaseName = `${baseName}${suffix}`;
    const dziPath = path.join(outputDirectory, `${outputBaseName}.dzi`);
    const tilesPath = path.join(outputDirectory, `${outputBaseName}_files`);

    if (!(await pathExists(dziPath)) && !(await pathExists(tilesPath))) {
      return { dziPath, tilesPath };
    }
  }

  const timestamp = Date.now();
  const outputBaseName = `${baseName}-${timestamp}`;
  return {
    dziPath: path.join(outputDirectory, `${outputBaseName}.dzi`),
    tilesPath: path.join(outputDirectory, `${outputBaseName}_files`),
  };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
