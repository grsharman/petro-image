const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  setUnsavedState: (state) => ipcRenderer.send("set-unsaved-state", state),
  openImportWizard: (context) =>
    ipcRenderer.invoke("open-import-wizard", context),
  resizeImportWizardToContent: (size) =>
    ipcRenderer.invoke("resize-import-wizard-to-content", size),
  initializeProjectLibrary: () => ipcRenderer.invoke("initialize-project-library"),
  changeProjectLibrary: () => ipcRenderer.invoke("change-project-library"),
  getProjectSettings: () => ipcRenderer.invoke("get-project-settings"),
  saveSamSettings: (samSettings) =>
    ipcRenderer.invoke("save-sam-settings", samSettings),
  saveSegmenteverygrainSettings: (settings) =>
    ipcRenderer.invoke("save-segmenteverygrain-settings", settings),
  selectSamPython: () => ipcRenderer.invoke("select-sam-python"),
  selectSamCheckpoint: () => ipcRenderer.invoke("select-sam-checkpoint"),
  selectSegmenteverygrainModel: () =>
    ipcRenderer.invoke("select-segmenteverygrain-model"),
  validateSamSetup: (samSettings) =>
    ipcRenderer.invoke("validate-sam-setup", samSettings),
  validateSegmenteverygrainSetup: (samSettings) =>
    ipcRenderer.invoke("validate-segmenteverygrain-setup", samSettings),
  runSegmenteverygrainSegmentation: (request) =>
    ipcRenderer.invoke("run-segmenteverygrain-segmentation", request),
  cancelSegmenteverygrainSegmentation: () =>
    ipcRenderer.invoke("cancel-segmenteverygrain-segmentation"),
  onSegmenteverygrainProgress: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("segmenteverygrain-progress", listener);
    return () =>
      ipcRenderer.removeListener("segmenteverygrain-progress", listener);
  },
  runSamSegmentation: (request) =>
    ipcRenderer.invoke("run-sam-segmentation", request),
  getLocalDziTileSource: (dziPath) =>
    ipcRenderer.invoke("get-local-dzi-tile-source", dziPath),
  validateSampleTiles: (tileSets) =>
    ipcRenderer.invoke("validate-sample-tiles", tileSets),
  confirmSlowTiles: (validationResult) =>
    ipcRenderer.invoke("confirm-slow-tiles", validationResult),
  copyImageToClipboard: (imageBytes) =>
    ipcRenderer.invoke("copy-image-to-clipboard", imageBytes),
  readLocalJsonFile: (filePath) =>
    ipcRenderer.invoke("read-local-json-file", filePath),
  selectImageFile: () => ipcRenderer.invoke("select-image-file"),
  selectAxioScanCzi: () => ipcRenderer.invoke("select-axioscan-czi"),
  inspectAxioScanCzi: (sourcePath) =>
    ipcRenderer.invoke("inspect-axioscan-czi", sourcePath),
  benchmarkAxioScanCzi: (request) =>
    ipcRenderer.invoke("benchmark-axioscan-czi", request),
  cancelAxioScanCziBenchmark: () =>
    ipcRenderer.invoke("cancel-axioscan-czi-benchmark"),
  onCziBenchmarkProgress: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("czi-benchmark-progress", listener);
    return () => ipcRenderer.removeListener("czi-benchmark-progress", listener);
  },
  convertAxioScanCzi: (request) =>
    ipcRenderer.invoke("convert-axioscan-czi", request),
  cancelAxioScanCzi: () => ipcRenderer.invoke("cancel-axioscan-czi"),
  onCziConversionProgress: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("czi-conversion-progress", listener);
    return () => ipcRenderer.removeListener("czi-conversion-progress", listener);
  },
  selectExistingJsonFile: () => ipcRenderer.invoke("select-existing-json-file"),
  chooseNewLibraryPath: (defaultFileName) =>
    ipcRenderer.invoke("choose-new-library-path", defaultFileName),
  writeJsonFile: (filePath, jsonData) =>
    ipcRenderer.invoke("write-json-file", { filePath, jsonData }),
  saveJsonFileAs: (defaultFileName, jsonData) =>
    ipcRenderer.invoke("save-json-file-as", { defaultFileName, jsonData }),
  convertImageToDzi: (sourcePath) =>
    ipcRenderer.invoke("convert-image-to-dzi", sourcePath),
  createDerivedDzi: (request) =>
    ipcRenderer.invoke("create-derived-dzi", request),
  deleteProjectDzi: (request) =>
    ipcRenderer.invoke("delete-project-dzi", request),
  onDziConversionProgress: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("dzi-conversion-progress", listener);
    return () =>
      ipcRenderer.removeListener("dzi-conversion-progress", listener);
  },
  onImportWizardContext: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("import-wizard-context", listener);
    return () => ipcRenderer.removeListener("import-wizard-context", listener);
  },
  onDerivedDziProgress: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("derived-dzi-progress", listener);
    return () =>
      ipcRenderer.removeListener("derived-dzi-progress", listener);
  },
  completeSampleImport: (jsonData, selectedTitle) =>
    ipcRenderer.invoke("complete-sample-import", {
      jsonData,
      selectedTitle,
    }),
  onLoadSampleJSON: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("load-sample-json", listener);
    return () => ipcRenderer.removeListener("load-sample-json", listener);
  },
});
