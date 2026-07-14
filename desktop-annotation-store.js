import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";

export const ANNOTATIONS_FOLDER_NAME = "annotations";
export const WORKING_ANNOTATION_KIND = "working-annotations";
export const WORKING_ANNOTATION_VERSION = 1;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidSampleId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function normalizeLibrarySampleIds(jsonData, createId = randomUUID) {
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
