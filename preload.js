const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  setUnsavedState: (state) => ipcRenderer.send("set-unsaved-state", state),
});

contextBridge.exposeInMainWorld("dialogAPI", {
  openDialog: (options) => ipcRenderer.invoke("open-dialog", options),
});

contextBridge.exposeInMainWorld("sharpAPI", {
  generateDZI: (imagePath, options) =>
    ipcRenderer.invoke("generate-dzi", imagePath, options),
});
