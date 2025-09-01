async function convert() {
  // Choose the input image via dialog.
  const inputPaths = await window.dialogAPI.openDialog({
    properties: ["openFile"],
    filters: [{ name: "Image Files", extensions: ["png", "jpg", "jpeg"] }],
  });
  if (!inputPaths || !inputPaths.length) {
    // No input paths selected.
    return;
  }
  const inputPath = inputPaths[0];

  // Choose the output directory via dialog.
  const outputDirectories = await window.dialogAPI.openDialog({
    properties: ["openDirectory"],
  });
  if (!outputDirectories || !outputDirectories.length) {
    // No input paths selected.
    return;
  }
  const outputDirectory = outputDirectories[0];

  // Convert the selected image to DZI.
  await window.sharpAPI.generateDZI(inputPath, outputDirectory, { size: 128 });
}
