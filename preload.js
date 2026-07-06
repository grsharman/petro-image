const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  setUnsavedState: (state) => ipcRenderer.send("set-unsaved-state", state),
  openImportWizard: () => ipcRenderer.invoke("open-import-wizard"),
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
  showTileLoadWarning: (failure) =>
    ipcRenderer.invoke("show-tile-load-warning", failure),
  readLocalJsonFile: (filePath) =>
    ipcRenderer.invoke("read-local-json-file", filePath),
  selectJpgFile: () => ipcRenderer.invoke("select-jpg-file"),
  selectExistingJsonFile: () => ipcRenderer.invoke("select-existing-json-file"),
  writeJsonFile: (filePath, jsonData) =>
    ipcRenderer.invoke("write-json-file", { filePath, jsonData }),
  saveJsonFileAs: (defaultFileName, jsonData) =>
    ipcRenderer.invoke("save-json-file-as", { defaultFileName, jsonData }),
  convertJpgToDzi: (sourcePath) =>
    ipcRenderer.invoke("convert-jpg-to-dzi", sourcePath),
  onDziConversionProgress: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("dzi-conversion-progress", listener);
    return () =>
      ipcRenderer.removeListener("dzi-conversion-progress", listener);
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
