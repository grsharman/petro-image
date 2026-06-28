import { app, BrowserWindow, ipcMain, dialog, screen } from "electron";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs/promises";
import http from "http";
import { randomUUID } from "crypto";
import { convertJpgToDzi } from "./dzi-converter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let importWizardWindow;
let hasUnsavedWork = false; // main process copy
let localFileServer;
let localFileServerPort;
const localFileServerToken = randomUUID();
const grantedLocalRoots = [];
const APP_TITLE = "petro-image";
const DEFAULT_LIBRARY_FILE_NAME = "default_library.json";
const USER_LIBRARY_FILE_NAME = "library.json";
const DZI_FOLDER_NAME = "dzi";

function setMainWindowTitle(projectDirectory, libraryPath = "") {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const projectLabel = projectDirectory
    ? path.basename(projectDirectory)
    : "Default Library";
  const libraryLabel =
    projectDirectory && libraryPath ? path.basename(libraryPath) : "";
  const titleParts = [APP_TITLE, projectLabel];

  if (libraryLabel) {
    titleParts.push(libraryLabel);
  }

  mainWindow.setTitle(titleParts.join(" - "));
}

function getSettingsPath() {
  return path.join(app.getPath("userData"), "project-settings.json");
}

async function readProjectSettings() {
  try {
    const settingsText = await fs.readFile(getSettingsPath(), "utf8");
    return JSON.parse(settingsText.replace(/^\uFEFF/, ""));
  } catch {
    return {};
  }
}

async function writeProjectSettings(settings) {
  await fs.mkdir(path.dirname(getSettingsPath()), { recursive: true });
  await fs.writeFile(getSettingsPath(), JSON.stringify(settings, null, 2), "utf8");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getBundledDefaultLibraryPath() {
  return path.join(__dirname, "samples.json");
}

async function ensureProjectStructure(projectDirectory) {
  await fs.mkdir(projectDirectory, { recursive: true });
  await fs.mkdir(path.join(projectDirectory, DZI_FOLDER_NAME), { recursive: true });

  const defaultLibraryPath = path.join(projectDirectory, DEFAULT_LIBRARY_FILE_NAME);
  if (!(await pathExists(defaultLibraryPath))) {
    const defaultLibraryText = await fs.readFile(
      getBundledDefaultLibraryPath(),
      "utf8",
    );
    await fs.writeFile(defaultLibraryPath, defaultLibraryText, "utf8");
  }

  return defaultLibraryPath;
}

async function promptForProjectDirectory(mode) {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: mode === "create" ? "Create Project Folder" : "Open Project Folder",
    message:
      mode === "create"
        ? "Choose or create a folder for this petro-image project."
        : "Choose the folder containing this petro-image project.",
    properties: ["openDirectory", "createDirectory"],
  });

  if (canceled || !filePaths.length) {
    return null;
  }

  return filePaths[0];
}

async function chooseProjectDirectory({ allowCancel = false } = {}) {
  const buttons = [
    "Create New Project Folder",
    "Open Existing Project Folder",
    "Use Default Library",
  ];

  if (allowCancel) {
    buttons.push("Cancel");
  }

  const result = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons,
    defaultId: 0,
    cancelId: allowCancel ? 3 : 2,
    message: "Choose a Library Project",
    detail:
      "A project folder keeps your libraries and generated DZI files together.",
  });

  if (result.response === 0) {
    return promptForProjectDirectory("create");
  }

  if (result.response === 1) {
    return promptForProjectDirectory("open");
  }

  if (result.response === 2) {
    return "";
  }

  return null;
}

async function getBundledDefaultLibraryResult() {
  const jsonText = await fs.readFile(getBundledDefaultLibraryPath(), "utf8");
  return {
    projectDirectory: "",
    defaultLibraryPath: "",
    lastLibraryPath: "",
    filePath: getBundledDefaultLibraryPath(),
    fileName: "samples.json",
    jsonData: parseSampleJSON(jsonText, getBundledDefaultLibraryPath()),
  };
}

async function clearProjectSettingsForDefaultLibrary(settings) {
  await writeProjectSettings({
    ...settings,
    projectDirectory: "",
    defaultLibraryPath: "",
    lastLibraryPath: "",
  });
}

async function loadBundledDefaultLibrary(settings) {
  if (settings) {
    await clearProjectSettingsForDefaultLibrary(settings);
  }

  return getBundledDefaultLibraryResult();
}

function wasProjectChoiceCanceled(projectDirectory) {
  return projectDirectory === null;
}

function shouldUseDefaultLibrary(projectDirectory) {
  return projectDirectory === "";
}

function makeCanceledProjectResult() {
  return { canceled: true };
}

function makeProjectSettings(
  settings,
  projectDirectory,
  defaultLibraryPath,
  lastLibraryPath,
) {
  const recentLibrariesByProject = {
    ...(settings.recentLibrariesByProject || {}),
    [projectDirectory]: lastLibraryPath,
  };

  return {
    ...settings,
    projectDirectory,
    defaultLibraryPath,
    lastLibraryPath,
    recentLibrariesByProject,
  };
}

function getPreferredLibraryPath(
  projectDirectory,
  defaultLibraryPath,
  useRememberedPath,
  settings,
) {
  const userLibraryPath = path.join(projectDirectory, USER_LIBRARY_FILE_NAME);
  const projectLibraryPath =
    settings.recentLibrariesByProject?.[projectDirectory] || "";
  const globalLibraryPath =
    settings.lastLibraryPath &&
    path.dirname(settings.lastLibraryPath) === projectDirectory
      ? settings.lastLibraryPath
      : "";
  return {
    userLibraryPath,
    rememberedPath: useRememberedPath
      ? projectLibraryPath || globalLibraryPath
      : projectLibraryPath,
    defaultLibraryPath,
  };
}

async function chooseLibraryPath(
  projectDirectory,
  defaultLibraryPath,
  useRememberedPath,
  settings,
) {
  const { userLibraryPath, rememberedPath } = getPreferredLibraryPath(
    projectDirectory,
    defaultLibraryPath,
    useRememberedPath,
    settings,
  );

  return (
    rememberedPath ||
    ((await pathExists(userLibraryPath)) ? userLibraryPath : defaultLibraryPath)
  );
}

async function buildProjectLibraryResult(
  projectDirectory,
  lastLibraryPath,
  defaultLibraryPath,
) {
  const jsonText = await fs.readFile(lastLibraryPath, "utf8");
  return {
    projectDirectory,
    defaultLibraryPath,
    lastLibraryPath,
    filePath: lastLibraryPath,
    fileName: path.basename(lastLibraryPath),
    jsonData: parseSampleJSON(jsonText, lastLibraryPath),
  };
}

async function openProjectLibrary(projectDirectory, settings, useRememberedPath) {
  const defaultLibraryPath = await ensureProjectStructure(projectDirectory);
  let lastLibraryPath = await chooseLibraryPath(
    projectDirectory,
    defaultLibraryPath,
    useRememberedPath,
    settings,
  );

  if (!(await pathExists(lastLibraryPath))) {
    lastLibraryPath = defaultLibraryPath;
  }

  await writeProjectSettings(
    makeProjectSettings(
      settings,
      projectDirectory,
      defaultLibraryPath,
      lastLibraryPath,
    ),
  );
  rememberLocalRoot(projectDirectory);

  return buildProjectLibraryResult(
    projectDirectory,
    lastLibraryPath,
    defaultLibraryPath,
  );
}

async function openDefaultLibraryIfNoProject(settings) {
  return loadBundledDefaultLibrary(settings);
}

async function resolveProjectChoice(projectDirectory, settings, useRememberedPath) {
  if (wasProjectChoiceCanceled(projectDirectory)) {
    return makeCanceledProjectResult();
  }

  if (shouldUseDefaultLibrary(projectDirectory)) {
    return openDefaultLibraryIfNoProject(settings);
  }

  return openProjectLibrary(projectDirectory, settings, useRememberedPath);
}

async function initializeMissingProject(settings) {
  const projectDirectory = await chooseProjectDirectory({ allowCancel: false });
  const result = await resolveProjectChoice(projectDirectory, settings, false);

  if (result.canceled) {
    return getBundledDefaultLibraryResult();
  }

  return result;
}

async function initializeRememberedProject(settings, projectDirectory) {
  return openProjectLibrary(projectDirectory, settings, true);
}

async function selectProjectForChange(settings) {
  const projectDirectory = await chooseProjectDirectory({ allowCancel: true });
  return resolveProjectChoice(projectDirectory, settings, true);
}

async function getExistingProjectDirectory(settings) {
  const projectDirectory = settings.projectDirectory || "";

  if (!projectDirectory || !(await pathExists(projectDirectory))) {
    return "";
  }

  return projectDirectory;
}

async function getInitialProjectLibrary(settings) {
  const projectDirectory = await getExistingProjectDirectory(settings);

  if (!projectDirectory) {
    return initializeMissingProject(settings);
  }

  return initializeRememberedProject(settings, projectDirectory);
}

async function getChangedProjectLibrary(settings) {
  return selectProjectForChange(settings);
}

async function initializeProjectLibrary() {
  const settings = await readProjectSettings();
  const result = await getInitialProjectLibrary(settings);
  if (!result.canceled) {
    setMainWindowTitle(result.projectDirectory, result.filePath);
  }
  return result;
}

async function changeProjectLibrary() {
  const settings = await readProjectSettings();
  const result = await getChangedProjectLibrary(settings);
  if (!result.canceled) {
    setMainWindowTitle(result.projectDirectory, result.filePath);
  }
  return result;
}

async function rememberLastLibraryPath(filePath) {
  if (!filePath) return;

  const settings = await readProjectSettings();
  const projectDirectory = settings.projectDirectory || path.dirname(filePath);
  const defaultLibraryPath =
    settings.defaultLibraryPath ||
    path.join(projectDirectory, DEFAULT_LIBRARY_FILE_NAME);
  const recentLibrariesByProject = {
    ...(settings.recentLibrariesByProject || {}),
    [projectDirectory]: filePath,
  };

  await writeProjectSettings({
    ...settings,
    projectDirectory,
    defaultLibraryPath,
    lastLibraryPath: filePath,
    recentLibrariesByProject,
  });
  rememberLocalRoot(projectDirectory);
  setMainWindowTitle(projectDirectory, filePath);
}

async function startLocalFileServer() {
  if (localFileServerPort) return;

  localFileServer = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, "http://127.0.0.1");
      const token = requestUrl.searchParams.get("token");
      const filePath = requestUrl.searchParams.get("path");

      if (token !== localFileServerToken) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      if (!filePath) {
        response.writeHead(400);
        response.end("Missing path");
        return;
      }

      const data = await fs.readFile(filePath);
      response.writeHead(200, {
        "Content-Type": getContentType(filePath),
        "Content-Length": data.byteLength,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      response.end(data);
    } catch (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      response.end(error.message);
    }
  });

  await new Promise((resolve, reject) => {
    localFileServer.once("error", reject);
    localFileServer.listen(0, "127.0.0.1", () => {
      localFileServer.off("error", reject);
      localFileServerPort = localFileServer.address().port;
      resolve();
    });
  });
}

function localFileServerUrl(filePath) {
  return `http://127.0.0.1:${localFileServerPort}/local-file?token=${localFileServerToken}&path=${encodeURIComponent(filePath)}`;
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".dzi":
    case ".xml":
      return "application/xml";
    case ".geojson":
    case ".json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}

function getDefaultWindowBounds() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  return {
    width: Math.min(1200, width - 80),
    height: Math.min(900, height - 80),
  };
}

const createWindow = () => {
  const defaultBounds = getDefaultWindowBounds();

  mainWindow = new BrowserWindow({
    title: APP_TITLE,
    width: defaultBounds.width,
    height: defaultBounds.height,
    minWidth: 800,
    minHeight: 600,
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
};

// IPC listener to update unsaved work state
ipcMain.on("set-unsaved-state", (event, state) => {
  console.log("Main process received unsaved state:", state);
  hasUnsavedWork = state;
});

ipcMain.handle("open-import-wizard", () => {
  if (importWizardWindow && !importWizardWindow.isDestroyed()) {
    importWizardWindow.focus();
    return;
  }

  importWizardWindow = new BrowserWindow({
    width: 324,
    height: 420,
    parent: mainWindow,
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  importWizardWindow.setMenuBarVisibility(false);
  importWizardWindow.loadFile("index_import_wizard_v3.html");
  importWizardWindow.on("closed", () => {
    importWizardWindow = null;
  });
});

ipcMain.handle("resize-import-wizard-to-content", (event, { width, height }) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);

  if (
    !importWizardWindow ||
    senderWindow !== importWizardWindow ||
    importWizardWindow.isDestroyed()
  ) {
    return;
  }

  const display = screen.getDisplayMatching(importWizardWindow.getBounds());
  const nextWidth = Math.min(
    display.workAreaSize.width - 80,
    Math.max(300, Math.ceil(width)),
  );
  const nextHeight = Math.min(
    display.workAreaSize.height - 80,
    Math.max(240, Math.ceil(height)),
  );

  importWizardWindow.setContentSize(nextWidth, nextHeight);
});

ipcMain.handle("select-jpg-file", async () => {
  const ownerWindow = BrowserWindow.getFocusedWindow() || mainWindow;
  const { canceled, filePaths } = await dialog.showOpenDialog(ownerWindow, {
    title: "Select JPG file",
    properties: ["openFile"],
    filters: [{ name: "JPEG Images", extensions: ["jpg", "jpeg"] }],
  });

  if (canceled || !filePaths.length) {
    return { canceled: true };
  }

  return {
    canceled: false,
    sourcePath: filePaths[0],
  };
});

ipcMain.handle("initialize-project-library", async () => initializeProjectLibrary());

ipcMain.handle("change-project-library", async () => changeProjectLibrary());

ipcMain.handle("get-project-settings", async () => readProjectSettings());

ipcMain.handle("select-existing-json-file", async () => {
  const ownerWindow = BrowserWindow.getFocusedWindow() || mainWindow;
  const { canceled, filePaths } = await dialog.showOpenDialog(ownerWindow, {
    title: "Select library JSON",
    properties: ["openFile"],
    filters: [{ name: "JSON Files", extensions: ["json"] }],
  });

  if (canceled || !filePaths.length) {
    return { canceled: true };
  }

  const filePath = filePaths[0];
  let jsonData;

  try {
    const jsonText = await fs.readFile(filePath, "utf8");
    jsonData = parseSampleJSON(jsonText, filePath);
    await rememberLastLibraryPath(filePath);
  } catch (error) {
    throw new Error(`Could not read library JSON: ${error.message}`);
  }

  return {
    canceled: false,
    filePath,
    fileName: path.basename(filePath),
    jsonData,
  };
});

function parseSampleJSON(jsonText, filePath) {
  let jsonData;

  try {
    jsonData = JSON.parse(jsonText.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`${path.basename(filePath)} is not valid JSON. ${error.message}`);
  }

  if (!jsonData || !Array.isArray(jsonData.samples)) {
    throw new Error(
      `${path.basename(filePath)} does not contain a top-level samples array.`,
    );
  }

  return jsonData;
}

ipcMain.handle("write-json-file", async (event, { filePath, jsonData }) => {
  if (!filePath) {
    throw new Error("No JSON file path was provided.");
  }

  await fs.writeFile(filePath, JSON.stringify(jsonData, null, 2), "utf8");
  await rememberLastLibraryPath(filePath);
  return { ok: true };
});

ipcMain.handle("save-json-file-as", async (event, { defaultFileName, jsonData }) => {
  const ownerWindow = BrowserWindow.getFocusedWindow() || mainWindow;
  const settings = await readProjectSettings();
  const { canceled, filePath } = await dialog.showSaveDialog(ownerWindow, {
    title: "Save library JSON",
    defaultPath: path.join(
      settings.projectDirectory || app.getPath("documents"),
      ensureJsonExtension(defaultFileName || USER_LIBRARY_FILE_NAME),
    ),
    filters: [{ name: "JSON Files", extensions: ["json"] }],
  });

  if (canceled || !filePath) {
    return { canceled: true };
  }

  await fs.writeFile(filePath, JSON.stringify(jsonData, null, 2), "utf8");
  await rememberLastLibraryPath(filePath);
  return {
    canceled: false,
    filePath,
    fileName: path.basename(filePath),
  };
});

ipcMain.handle("get-local-dzi-tile-source", async (event, dziPath) => {
  return getDziTileSource(event, dziPath);
});

ipcMain.handle("read-local-json-file", async (event, filePath) => {
  const resolvedPath = await resolveLibraryFilePath(filePath);
  const jsonText = await fs.readFile(resolvedPath, "utf8");

  try {
    return JSON.parse(jsonText.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(
      `${path.basename(resolvedPath)} is not valid JSON. ${error.message}`,
    );
  }
});

async function readDziXmlWithPermissionFallback(event, dziPath) {
  const cachedMatch = await readDziFromCachedRoot(dziPath);
  if (cachedMatch) {
    return cachedMatch;
  }

  try {
    return {
      dziPath,
      dziXml: await fs.readFile(dziPath, "utf8"),
    };
  } catch (error) {
    if (!["EACCES", "EPERM", "ENOENT"].includes(error.code)) {
      throw error;
    }
  }

  const ownerWindow =
    BrowserWindow.fromWebContents(event.sender) ||
    BrowserWindow.getFocusedWindow() ||
    mainWindow;
  const { canceled, filePaths } = await dialog.showOpenDialog(ownerWindow, {
    title: "Select image tile folder",
    message: `macOS blocked access to ${path.basename(dziPath)}. Select the folder containing the DZI file and its _files folder.`,
    defaultPath: path.dirname(dziPath),
    properties: ["openDirectory"],
  });

  if (canceled || !filePaths.length) {
    throw new Error(`Could not access DZI file: ${dziPath}`);
  }

  const selectedRoot = normalizeDziRoot(filePaths[0]);
  rememberLocalRoot(selectedRoot);
  const selectedDziPath = path.join(selectedRoot, path.basename(dziPath));
  return {
    dziPath: selectedDziPath,
    dziXml: await fs.readFile(selectedDziPath, "utf8"),
  };
}

async function readDziFromCachedRoot(dziPath) {
  for (const root of grantedLocalRoots) {
    const cachedDziPath = path.join(root, path.basename(dziPath));

    try {
      return {
        dziPath: cachedDziPath,
        dziXml: await fs.readFile(cachedDziPath, "utf8"),
      };
    } catch (error) {
      if (!["EACCES", "EPERM", "ENOENT"].includes(error.code)) {
        throw error;
      }
    }
  }

  return null;
}

function normalizeDziRoot(selectedPath) {
  return selectedPath.endsWith("_files") ? path.dirname(selectedPath) : selectedPath;
}

function rememberLocalRoot(rootPath) {
  if (!grantedLocalRoots.includes(rootPath)) {
    grantedLocalRoots.push(rootPath);
  }
}

async function getDziTileSource(event, dziPath) {
  dziPath = await resolveLibraryFilePath(dziPath);
  const result = await readDziXmlWithPermissionFallback(event, dziPath);
  const { dziXml } = result;
  dziPath = result.dziPath;
  const imageTag = dziXml.match(/<Image\b([^>]*)>/i);
  const sizeTag = dziXml.match(/<Size\b([^>]*)>/i);

  if (!imageTag || !sizeTag) {
    throw new Error(`Could not parse DZI file: ${path.basename(dziPath)}`);
  }

  const parsedPath = path.parse(dziPath);
  const tilesPath = path.join(parsedPath.dir, `${parsedPath.name}_files`);

  return {
    Image: {
      xmlns: "http://schemas.microsoft.com/deepzoom/2008",
      Url: localFileServerUrl(`${tilesPath}${path.sep}`),
      Format: getXmlAttribute(imageTag[1], "Format") || "jpg",
      Overlap: parseInt(getXmlAttribute(imageTag[1], "Overlap") || "1", 10),
      TileSize: parseInt(getXmlAttribute(imageTag[1], "TileSize") || "254", 10),
      Size: {
        Width: parseInt(getXmlAttribute(sizeTag[1], "Width"), 10),
        Height: parseInt(getXmlAttribute(sizeTag[1], "Height"), 10),
      },
    },
  };
}

async function resolveLibraryFilePath(filePath) {
  if (
    typeof filePath !== "string" ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(filePath) ||
    path.isAbsolute(filePath)
  ) {
    return filePath;
  }

  const settings = await readProjectSettings();
  const baseDirectory = settings.projectDirectory || path.dirname(settings.lastLibraryPath || "");

  return baseDirectory ? path.join(baseDirectory, filePath) : filePath;
}

function getXmlAttribute(attributes, name) {
  const match = attributes.match(new RegExp(`${name}="([^"]+)"`, "i"));
  return match ? match[1] : "";
}

function ensureJsonExtension(fileName) {
  return /\.json$/i.test(fileName) ? fileName : `${fileName}.json`;
}

ipcMain.handle("convert-jpg-to-dzi", async (event, sourcePath) => {
  const settings = await readProjectSettings();
  const outputDirectory = settings.projectDirectory
    ? path.join(settings.projectDirectory, DZI_FOLDER_NAME)
    : path.dirname(sourcePath);
  const result = await convertJpgToDzi(
    sourcePath,
    (progress) => {
      event.sender.send("dzi-conversion-progress", progress);
    },
    outputDirectory,
  );

  if (settings.projectDirectory) {
    result.relativeDziPath = path.relative(settings.projectDirectory, result.dziPath);
  }

  return result;
});

ipcMain.handle("complete-sample-import", (event, { jsonData, selectedTitle }) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("The main application window is not available.");
  }

  mainWindow.webContents.send("load-sample-json", {
    jsonData,
    selectedTitle,
  });
  mainWindow.focus();

  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (
    senderWindow &&
    senderWindow !== mainWindow &&
    !senderWindow.isDestroyed()
  ) {
    setTimeout(() => {
      if (!senderWindow.isDestroyed()) {
        senderWindow.close();
      }
    }, 0);
  }

  return { ok: true };
});

app.whenReady().then(async () => {
  await startLocalFileServer();
  createWindow();
});
