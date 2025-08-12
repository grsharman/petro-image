const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  setUnsavedState: (state) => ipcRenderer.send("set-unsaved-state", state),
});
