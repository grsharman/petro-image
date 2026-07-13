importScripts("./local-thickness.js");

self.addEventListener("message", (event) => {
  const { maskBuffer, width, height, sizes = 25, method = "approximate" } = event.data;
  try {
    const mask = new Uint8Array(maskBuffer);
    const calculation = self.PetroLocalThickness[
      method === "exact" ? "localThicknessExact" : "localThicknessDt"
    ](mask, width, height, {
      sizes,
      onProgress(progress) {
        self.postMessage({ type: "progress", progress: progress * 0.75, label: "Local thickness" });
      },
    });
    self.postMessage({ type: "progress", progress: 0.78, label: "Distance to boundary" });
    const distance = self.PetroLocalThickness.distanceToBoundary(mask, width, height);
    self.postMessage({ type: "progress", progress: 0.86, label: "Connected components" });
    const componentData = self.PetroLocalThickness.connectedComponents(
      mask,
      width,
      height,
      calculation.values
    );
    self.postMessage({ type: "progress", progress: 0.95, label: "Chord lengths" });
    const chords = self.PetroLocalThickness.chordLengths(mask, width, height);
    self.postMessage(
      {
        type: "result",
        valuesBuffer: calculation.values.buffer,
        radii: calculation.radii,
        maxRadius: calculation.maxRadius,
        distanceBuffer: distance.buffer,
        labelsBuffer: componentData.labels.buffer,
        components: componentData.components,
        horizontalChordsBuffer: chords.horizontal.buffer,
        verticalChordsBuffer: chords.vertical.buffer,
      },
      [
        calculation.values.buffer,
        distance.buffer,
        componentData.labels.buffer,
        chords.horizontal.buffer,
        chords.vertical.buffer,
      ]
    );
  } catch (error) {
    self.postMessage({ type: "error", message: error?.message || String(error) });
  }
});
