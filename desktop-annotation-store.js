import path from "path";
import fs from "fs/promises";
import { randomBytes, randomUUID } from "crypto";

export const ANNOTATIONS_FOLDER_NAME = "annotations";
export const COUNTS_FOLDER_NAME = "counts";
export const WORKING_ANNOTATION_KIND = "working-annotations";
export const WORKING_ANNOTATION_VERSION = 1;
export const WORKING_COUNT_KIND = "working-counts";
export const WORKING_COUNT_VERSION = 1;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHORT_ID_PATTERN = /^[0-9a-hjkmnp-tv-z]{8}$/i;
const SAMPLE_ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export function createSampleId() {
  const bytes = randomBytes(5);
  let sampleId = "";
  let buffer = 0;
  let bitCount = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      sampleId += SAMPLE_ID_ALPHABET[(buffer >>> bitCount) & 31];
    }
  }
  return sampleId;
}

export function isValidSampleId(value) {
  return (
    typeof value === "string" &&
    (SHORT_ID_PATTERN.test(value) || UUID_PATTERN.test(value))
  );
}

export function normalizeLibrarySampleIds(jsonData, createId = createSampleId) {
  if (!jsonData || !Array.isArray(jsonData.samples)) {
    return { jsonData, changed: false };
  }

  const seen = new Set();
  let changed = false;
  for (const sample of jsonData.samples) {
    if (!sample || typeof sample !== "object") continue;
    const normalizedId = isValidSampleId(sample.sampleId)
      ? sample.sampleId.toLowerCase()
      : "";
    if (!normalizedId || seen.has(normalizedId)) {
      let nextId;
      do {
        nextId = createId().toLowerCase();
      } while (!isValidSampleId(nextId) || seen.has(nextId));
      sample.sampleId = nextId;
      seen.add(nextId);
      changed = true;
      continue;
    }
    seen.add(normalizedId);
    if (sample.sampleId !== normalizedId) {
      sample.sampleId = normalizedId;
      changed = true;
    }
  }

  return { jsonData, changed };
}

export function getWorkingAnnotationPath(projectDirectory, sampleId) {
  if (!projectDirectory) throw new Error("No project folder is open.");
  if (!isValidSampleId(sampleId)) throw new Error("Invalid sample ID.");
  return path.join(
    projectDirectory,
    ANNOTATIONS_FOLDER_NAME,
    `${sampleId.toLowerCase()}.working.geojson`,
  );
}

export function getWorkingCountPath(projectDirectory, sampleId) {
  if (!projectDirectory) throw new Error("No project folder is open.");
  if (!isValidSampleId(sampleId)) throw new Error("Invalid sample ID.");
  return path.join(
    projectDirectory,
    COUNTS_FOLDER_NAME,
    `${sampleId.toLowerCase()}.working.geojson`,
  );
}

export async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function migrateLibrarySampleIds(filePath, jsonData) {
  const result = normalizeLibrarySampleIds(jsonData);
  if (result.changed) {
    await writeJsonAtomic(filePath, result.jsonData);
  }
  return result;
}

export async function saveWorkingAnnotations(
  projectDirectory,
  { sampleId, sampleTitle = "", geoJSON },
) {
  if (!geoJSON || geoJSON.type !== "FeatureCollection" || !Array.isArray(geoJSON.features)) {
    throw new Error("Working annotations must be a GeoJSON FeatureCollection.");
  }

  const filePath = getWorkingAnnotationPath(projectDirectory, sampleId);
  const document = {
    type: "FeatureCollection",
    petroImage: {
      kind: WORKING_ANNOTATION_KIND,
      version: WORKING_ANNOTATION_VERSION,
      sampleId: sampleId.toLowerCase(),
      sampleTitle: typeof sampleTitle === "string" ? sampleTitle : "",
      savedAt: new Date().toISOString(),
      ...(geoJSON.petroImage?.annotationCoordinateSpace
        ? {
            annotationCoordinateSpace:
              geoJSON.petroImage.annotationCoordinateSpace,
          }
        : {}),
    },
    features: geoJSON.features,
  };
  await writeJsonAtomic(filePath, document);
  return { filePath, savedAt: document.petroImage.savedAt };
}

export async function loadWorkingAnnotations(projectDirectory, sampleId) {
  const filePath = getWorkingAnnotationPath(projectDirectory, sampleId);
  let text;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }

  const document = JSON.parse(text.replace(/^\uFEFF/, ""));
  if (document?.type !== "FeatureCollection" || !Array.isArray(document.features)) {
    throw new Error(`${path.basename(filePath)} is not a GeoJSON FeatureCollection.`);
  }
  if (
    document.petroImage?.kind !== WORKING_ANNOTATION_KIND ||
    document.petroImage?.sampleId?.toLowerCase() !== sampleId.toLowerCase()
  ) {
    throw new Error(`${path.basename(filePath)} does not match the selected sample.`);
  }
  return document;
}

export async function saveWorkingCounts(
  projectDirectory,
  { sampleId, sampleTitle = "", geoJSON },
) {
  if (
    !geoJSON ||
    geoJSON.type !== "FeatureCollection" ||
    !Array.isArray(geoJSON.features)
  ) {
    throw new Error("Working counts must be a GeoJSON FeatureCollection.");
  }

  const filePath = getWorkingCountPath(projectDirectory, sampleId);
  const document = {
    type: "FeatureCollection",
    petroImage: {
      kind: WORKING_COUNT_KIND,
      version: WORKING_COUNT_VERSION,
      sampleId: sampleId.toLowerCase(),
      sampleTitle: typeof sampleTitle === "string" ? sampleTitle : "",
      savedAt: new Date().toISOString(),
    },
    features: geoJSON.features,
  };
  await writeJsonAtomic(filePath, document);
  return { filePath, savedAt: document.petroImage.savedAt };
}

export async function loadWorkingCounts(projectDirectory, sampleId) {
  const filePath = getWorkingCountPath(projectDirectory, sampleId);
  let text;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }

  const document = JSON.parse(text.replace(/^\uFEFF/, ""));
  if (
    document?.type !== "FeatureCollection" ||
    !Array.isArray(document.features)
  ) {
    throw new Error(`${path.basename(filePath)} is not a GeoJSON FeatureCollection.`);
  }
  if (
    document.petroImage?.kind !== WORKING_COUNT_KIND ||
    document.petroImage?.sampleId?.toLowerCase() !== sampleId.toLowerCase()
  ) {
    throw new Error(`${path.basename(filePath)} does not match the selected sample.`);
  }
  return document;
}
