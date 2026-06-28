const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  setUnsavedState: (state) => ipcRenderer.send("set-unsaved-state", state),
  openImportWizard: () => ipcRenderer.invoke("open-import-wizard"),
  resizeImportWizardToContent: (size) =>
    ipcRenderer.invoke("resize-import-wizard-to-content", size),
  initializeProjectLibrary: () => ipcRenderer.invoke("initialize-project-library"),
  changeProjectLibrary: () => ipcRenderer.invoke("change-project-library"),
  getProjectSettings: () => ipcRenderer.invoke("get-project-settings"),
  getLocalDziTileSource: (dziPath) =>
    ipcRenderer.invoke("get-local-dzi-tile-source", dziPath),
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
