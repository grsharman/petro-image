import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { fileURLToPath } from "url";
import path from "path";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let hasUnsavedWork = false; // main process copy

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile("index.html");

  mainWindow.on("close", async (e) => {
    console.log("closing window, unsaved work?", hasUnsavedWork);
    if (hasUnsavedWork) {
      e.preventDefault();
      const result = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        buttons: ["Cancel", "Quit Without Saving"],
        defaultId: 1,
        cancelId: 0,
        message: "You have unsaved changes. Are you sure you want to quit?",
      });
      if (result.response === 1) {
        hasUnsavedWork = false; // allow closing next time
        mainWindow.destroy();
      }
    }
  });

  let dziConversionWindow = new BrowserWindow({
    width: 400,
    height: 300,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  dziConversionWindow.setMenuBarVisibility(false);
  dziConversionWindow.loadFile("convert.html");
};

// IPC listener to update unsaved work state
ipcMain.on("set-unsaved-state", (event, state) => {
  console.log("Main process received unsaved state:", state);
  hasUnsavedWork = state;
});

// IPC listener to open a file dialog and return the selected paths
ipcMain.handle("open-dialog", async (_event, options) => {
  const result = await dialog.showOpenDialog(options);
  return result.filePaths;
});

// IPC listener to generate a Deep Zoom image from an input image
ipcMain.handle(
  "generate-dzi",
  async (_event, inputPath, outputDirectory, options) => {
    const outputPath = path.join(outputDirectory, "output.dz");
    return await sharp(inputPath).png().tile(options).toFile(outputPath);
  }
);

app.whenReady().then(createWindow);
