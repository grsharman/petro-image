export function summarizeProjectLibrary(jsonData = {}) {
  const samples = Array.isArray(jsonData.samples) ? jsonData.samples : [];
  const imageLayerCount = samples.reduce(
    (total, sample) =>
      total + (Array.isArray(sample?.tileSets) ? sample.tileSets.length : 0),
    0,
  );

  return {
    sampleCount: samples.length,
    imageLayerCount,
  };
}

export function formatProjectContents({ sampleCount = 0, imageLayerCount = 0 } = {}) {
  const samples = `${sampleCount} ${sampleCount === 1 ? "sample" : "samples"}`;
  const imageLayers =
    `${imageLayerCount} ${imageLayerCount === 1 ? "image layer" : "image layers"}`;
  return `${samples} · ${imageLayers}`;
}

export function getProjectFolderButtonLabel(platform = process.platform) {
  if (platform === "darwin") return "Show in Finder";
  if (platform === "win32") return "Show in File Explorer";
  return "Open Project Folder";
}
