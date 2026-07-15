import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  dialog,
  nativeImage,
  screen,
  shell,
} from "electron";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs/promises";
import { createReadStream, writeFileSync } from "fs";
import { spawn } from "child_process";
import http from "http";
import { randomUUID } from "crypto";
import { convertImageBufferToDzi, convertImageToDzi } from "./dzi-converter.js";
import {
  ANNOTATIONS_FOLDER_NAME,
  loadWorkingAnnotations,
  migrateLibrarySampleIds,
  normalizeLibrarySampleIds,
  saveWorkingAnnotations,
  writeJsonAtomic,
} from "./desktop-annotation-store.js";
import {
  convertJpeg2000ToDzi,
  isJpeg2000Path,
} from "./jpeg2000-converter.js";
import {
  parseJsonProcessOutput,
  tryParseJsonLine,
} from "./process-output.js";
import { buildPythonProcessEnv } from "./python-environment.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let importWizardWindow;
let hasUnsavedWork = false; // main process copy
let unsavedWorkDomains = [];
let unsavedWorkLabels = [];
let closeWarningInProgress = false;
let localFileServer;
let localFileServerPort;
let samWorker = null;
let segmenteverygrainWorker = null;
let activeSegmenteverygrainChild = null;
let activeCziConversionChild = null;
let activeCziConversionOutput = "";
let activeCziBenchmarkChild = null;
let activeJpeg2000ConversionChild = null;
let windowStateSaveTimer = null;
const localFileServerToken = randomUUID();
const grantedLocalRoots = [];
const APP_TITLE = "petro-image";
const PROJECT_LIBRARY_TEMPLATE_FILE_NAME = "default_library.json";
const USER_LIBRARY_FILE_NAME = "library.json";
const WINDOW_STATE_FILE_NAME = "window-state.json";
const DZI_FOLDER_NAME = "dzi";
const TUTORIAL_ASSETS_FOLDER_NAME = "tutorial-assets";
const CZI_RESOLUTION_SCALES = new Set([1, 0.5, 0.25, 0.125, 0.0625, 0.03125, 0.015625]);
const SEGMENTEVERYGRAIN_MODEL_EXTENSIONS = new Set([".h5", ".keras"]);

function getPythonWorkerPath(fileName) {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "scripts",
      fileName,
    );
  }
  return path.join(__dirname, "scripts", fileName);
}

async function getVipsWorkerRuntime() {
  const executableName = process.platform === "win32" ? "vips.exe" : "vips";
  const configuredExecutable = process.env.PETRO_IMAGE_VIPS_PATH || "";
  const bundledRoot = path.join(process.resourcesPath, "vips-worker");
  const bundledExecutable = path.join(bundledRoot, "bin", executableName);
  const stagedRoot = path.join(__dirname, "build", "vips-worker");
  const stagedExecutable = path.join(stagedRoot, "bin", executableName);
  const hasStagedExecutable = !app.isPackaged && (await pathExists(stagedExecutable));
  const command =
    configuredExecutable ||
    (app.isPackaged ? bundledExecutable : hasStagedExecutable ? stagedExecutable : "vips");

  if ((configuredExecutable || app.isPackaged) && !(await pathExists(command))) {
    throw new Error(
      app.isPackaged
        ? "The bundled JPEG 2000 converter is missing from this petro-image installation."
        : `The configured JPEG 2000 converter could not be found: ${command}`,
    );
  }

  const env = {};
  const runtimeRoot = app.isPackaged ? bundledRoot : hasStagedExecutable ? stagedRoot : "";
  if (runtimeRoot && !configuredExecutable) {
    const libraryDirectory = path.join(runtimeRoot, "lib");
    if (process.platform === "darwin") {
      env.DYLD_LIBRARY_PATH = [libraryDirectory, process.env.DYLD_LIBRARY_PATH]
        .filter(Boolean)
        .join(path.delimiter);
    } else if (process.platform === "linux") {
      env.LD_LIBRARY_PATH = [libraryDirectory, process.env.LD_LIBRARY_PATH]
        .filter(Boolean)
        .join(path.delimiter);
    } else if (process.platform === "win32") {
      env.PATH = [path.dirname(command), process.env.PATH]
        .filter(Boolean)
        .join(path.delimiter);
    }
  }

  return { command, env };
}

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

function getBundledProjectLibraryTemplatePath() {
  return path.join(__dirname, PROJECT_LIBRARY_TEMPLATE_FILE_NAME);
}

function getBundledTutorialAssetsPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, TUTORIAL_ASSETS_FOLDER_NAME)
    : path.join(__dirname, TUTORIAL_ASSETS_FOLDER_NAME);
}

async function ensureProjectStructure(projectDirectory) {
  await fs.mkdir(projectDirectory, { recursive: true });
  await fs.mkdir(path.join(projectDirectory, DZI_FOLDER_NAME), { recursive: true });
  await fs.mkdir(path.join(projectDirectory, ANNOTATIONS_FOLDER_NAME), {
    recursive: true,
  });

  const projectLibraryPath = path.join(projectDirectory, USER_LIBRARY_FILE_NAME);
  if (!(await pathExists(projectLibraryPath))) {
    const projectLibraryText = await fs.readFile(
      getBundledProjectLibraryTemplatePath(),
      "utf8",
    );
    await fs.writeFile(projectLibraryPath, projectLibraryText, "utf8");
  }

  return projectLibraryPath;
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

  const selectedPath = filePaths[0];
  const shouldUsePath = await confirmCloudProjectDirectory(selectedPath);
  if (!shouldUsePath) {
    return promptForProjectDirectory(mode);
  }

  return selectedPath;
}

function getCloudProjectProvider(projectDirectory) {
  const normalizedPath = projectDirectory.replace(/\\/g, "/");
  const cloudPathPatterns = [
    { provider: "OneDrive", pattern: /(^|\/)OneDrive([-/]|$)/i },
    { provider: "iCloud Drive", pattern: /(^|\/)(iCloud Drive|Mobile Documents)(\/|$)/i },
    { provider: "Dropbox", pattern: /(^|\/)Dropbox(\/|$)/i },
    { provider: "Google Drive", pattern: /(^|\/)(Google Drive|GoogleDrive)(\/|$)/i },
    { provider: "Box", pattern: /(^|\/)Box(\/|$)/i },
    { provider: "cloud-synced storage", pattern: /\/Library\/CloudStorage\//i },
  ];

  return cloudPathPatterns.find(({ pattern }) => pattern.test(normalizedPath))
    ?.provider;
}

async function confirmCloudProjectDirectory(projectDirectory) {
  const provider = getCloudProjectProvider(projectDirectory);
  if (!provider) {
    return true;
  }

  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["Choose Another Folder", "Use This Folder Anyway"],
    defaultId: 0,
    cancelId: 0,
    message: "Cloud-Synced Project Folder",
    detail:
      `This folder appears to be inside ${provider}. DZI tile files may be offloaded or slow to read, which can make image loading very slow or cause the app to become unresponsive.\n\nFor best performance, choose a folder stored on this computer, or mark the project folder as always available offline in your cloud storage app.`,
  });

  return result.response === 1;
}

async function confirmRememberedCloudProjectDirectory(projectDirectory) {
  const provider = getCloudProjectProvider(projectDirectory);
  if (!provider) {
    return true;
  }

  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["Choose Another Folder", "Open Anyway"],
    defaultId: 1,
    cancelId: 1,
    message: "Cloud-Synced Project Folder",
    detail:
      `The remembered Project Folder appears to be inside ${provider}. DZI tile files may be offloaded or slow to read, which can make image loading very slow or cause the app to become unresponsive.\n\nFor best performance, choose a folder stored on this computer, or mark the project folder as always available offline in your cloud storage app.`,
  });

  return result.response === 1;
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
  const jsonData = parseSampleJSON(jsonText, lastLibraryPath);
  await migrateLibrarySampleIds(lastLibraryPath, jsonData);
  return {
    projectDirectory,
    defaultLibraryPath,
    lastLibraryPath,
    filePath: lastLibraryPath,
    fileName: path.basename(lastLibraryPath),
    jsonData,
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

  if (!(await confirmRememberedCloudProjectDirectory(projectDirectory))) {
    const selectedProject = await selectProjectForChange(settings);
    if (!selectedProject.canceled) {
      return selectedProject;
    }
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
    path.join(projectDirectory, USER_LIBRARY_FILE_NAME);
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

function normalizeSamSettings(settings = {}) {
  const sam = settings.sam || {};
  const legacyModelTypeMap = {
    vit_b: "base_plus",
    vit_l: "large",
    vit_h: "large",
  };
  const allowedModelTypes = new Set(["tiny", "small", "base_plus", "large"]);
  const rawModelType =
    typeof sam.modelType === "string" ? sam.modelType : "base_plus";
  const modelType = legacyModelTypeMap[rawModelType] || rawModelType;
  const normalizedSettings = {
    pythonPath: typeof sam.pythonPath === "string" ? sam.pythonPath : "",
    checkpointPath:
      typeof sam.checkpointPath === "string" ? sam.checkpointPath : "",
    modelType: allowedModelTypes.has(modelType) ? modelType : "base_plus",
  };
  const validation = normalizeSamValidation(sam.validation, normalizedSettings);
  return {
    ...normalizedSettings,
    ...(validation ? { validation } : {}),
  };
}

function getSamSettingsFingerprint(settings = {}) {
  return JSON.stringify({
    pythonPath: settings.pythonPath || "",
    checkpointPath: settings.checkpointPath || "",
    modelType: settings.modelType || "base_plus",
  });
}

function getSegmenteverygrainModelPathError(modelPath, pythonPath = "") {
  if (!modelPath) return "Choose a segmenteverygrain model file.";

  const normalizedModelPath = path.resolve(modelPath);
  if (pythonPath && normalizedModelPath === path.resolve(pythonPath)) {
    return "The segmenteverygrain model path is set to the Python executable. Choose a trained .h5 or .keras model file instead.";
  }

  const extension = path.extname(modelPath).toLowerCase();
  if (!SEGMENTEVERYGRAIN_MODEL_EXTENSIONS.has(extension)) {
    return "Choose a segmenteverygrain model file with a .h5 or .keras extension.";
  }

  return "";
}

function normalizeSamValidation(validation, samSettings) {
  if (!validation || typeof validation !== "object") return null;

  const status = validation.status === "ready" ? "ready" : "error";
  const fingerprint =
    typeof validation.fingerprint === "string" ? validation.fingerprint : "";
  if (!fingerprint) return null;

  return {
    status,
    fingerprint,
    matchesCurrentSettings:
      fingerprint === getSamSettingsFingerprint(samSettings || {}),
    validatedAt:
      typeof validation.validatedAt === "string" ? validation.validatedAt : "",
  };
}

function normalizeSegmenteverygrainSettings(settings = {}) {
  const source = settings.segmenteverygrain || settings;
  const normalizedSettings = {
    modelPath: typeof source.modelPath === "string" ? source.modelPath : "",
  };
  const validation = normalizeSegmenteverygrainValidation(
    source.validation,
    normalizedSettings,
  );
  return {
    ...normalizedSettings,
    ...(validation ? { validation } : {}),
  };
}

function getSegmenteverygrainSettingsFingerprint(settings = {}) {
  return JSON.stringify({
    modelPath: settings.modelPath || "",
  });
}

function normalizeSegmenteverygrainValidation(validation, settings) {
  if (!validation || typeof validation !== "object") return null;

  const status = validation.status === "ready" ? "ready" : "error";
  const fingerprint =
    typeof validation.fingerprint === "string" ? validation.fingerprint : "";
  if (!fingerprint) return null;

  return {
    status,
    fingerprint,
    matchesCurrentSettings:
      fingerprint === getSegmenteverygrainSettingsFingerprint(settings || {}),
    validatedAt:
      typeof validation.validatedAt === "string" ? validation.validatedAt : "",
  };
}

async function writeSamSettings(nextSamSettings) {
  const settings = await readProjectSettings();
  const sam = normalizeSamSettings({
    sam: {
      ...settings.sam,
      ...nextSamSettings,
    },
  });

  await writeProjectSettings({
    ...settings,
    sam,
  });

  return sam;
}

async function writeSegmenteverygrainSettings(nextSettings) {
  const settings = await readProjectSettings();
  const segmenteverygrain = normalizeSegmenteverygrainSettings({
    segmenteverygrain: {
      ...settings.segmenteverygrain,
      ...nextSettings,
    },
  });

  await writeProjectSettings({
    ...settings,
    segmenteverygrain,
  });

  return segmenteverygrain;
}

function getOwnerWindow(event) {
  return (
    BrowserWindow.fromWebContents(event?.sender) ||
    BrowserWindow.getFocusedWindow() ||
    mainWindow
  );
}

function runProcess(command, args, options = {}) {
  const { timeoutMs = 120000, env = null } = options;

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: env ? { ...process.env, ...env } : process.env,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({
        exitCode: null,
        stdout,
        stderr,
        timedOut: true,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: null,
        stdout,
        stderr: stderr || error.message,
        error: error.message,
      });
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout,
        stderr,
        timedOut: false,
      });
    });
  });
}

function parseSegmenteverygrainTextProgress(line) {
  const text = String(line || "");
  const tqdmMatch = text.match(/(\d{1,3})%\|/);
  const labelMatch = text.match(/([^:\r\n]*):\s*(\d{1,3})%/);
  const countMatch = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (!tqdmMatch && !labelMatch) return null;

  const label = labelMatch
    ? labelMatch[1].trim().toLowerCase()
    : text.toLowerCase();
  const percent = Math.max(
    0,
    Math.min(100, Number(tqdmMatch?.[1] ?? labelMatch?.[2])),
  );
  if (!Number.isFinite(percent)) return null;

  const stage = label.includes("creating masks")
    ? "SAM refinement"
    : "Patch prediction";
  const base = stage === "SAM refinement" ? 55 : 20;
  const span = 35;
  const message = countMatch
    ? `${stage}: ${stage === "SAM refinement" ? "mask" : "patch"} ${countMatch[1]} of ${countMatch[2]} (${percent}%)`
    : `${stage}: ${percent}%`;
  return {
    type: "progress",
    stage,
    message,
    percent: base + (percent / 100) * span,
  };
}

function runProcessWithProgress(command, args, options = {}) {
  const {
    timeoutMs = 120000,
    env = null,
    onStdoutLine = null,
    onStderrLine = null,
    onChild = null,
  } = options;

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: env ? { ...process.env, ...env } : process.env,
    });
    onChild?.(child);
    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({
        exitCode: null,
        stdout,
        stderr,
        timedOut: true,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      stdoutBuffer += text;
      const lines = stdoutBuffer.split(/\r|\n/);
      stdoutBuffer = lines.pop() || "";
      lines.forEach((line) => {
        if (line.trim()) onStdoutLine?.(line.trim());
      });
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      stderrBuffer += text;
      const lines = stderrBuffer.split(/\r|\n/);
      stderrBuffer = lines.pop() || "";
      lines.forEach((line) => {
        if (line.trim()) onStderrLine?.(line.trim());
      });
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: null,
        stdout,
        stderr: stderr || error.message,
        error: error.message,
      });
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stdoutBuffer.trim()) onStdoutLine?.(stdoutBuffer.trim());
      if (stderrBuffer.trim()) onStderrLine?.(stderrBuffer.trim());
      resolve({
        exitCode,
        stdout,
        stderr,
        timedOut: false,
        canceled: child.killed || Boolean(child._petroImageCanceled),
      });
    });
  });
}

async function getCziWorkerRuntime() {
  const executableName =
    process.platform === "win32"
      ? "axioscan-czi-worker.exe"
      : "axioscan-czi-worker";
  const configuredWorker = process.env.PETRO_IMAGE_CZI_WORKER || "";
  const bundledWorker = path.join(
    process.resourcesPath,
    "czi-worker",
    "axioscan-czi-worker",
    executableName,
  );
  const standaloneWorker =
    configuredWorker || (app.isPackaged ? bundledWorker : "");
  if (standaloneWorker) {
    if (!(await pathExists(standaloneWorker))) {
      throw new Error(
        app.isPackaged
          ? "The bundled AxioScan CZI worker is missing from this petro-image installation."
          : `The configured AxioScan CZI worker could not be found: ${standaloneWorker}`,
      );
    }
    return {
      command: standaloneWorker,
      workerArgs: [],
      env: {},
      bundled: true,
    };
  }

  const settings = await readProjectSettings();
  const samSettings = normalizeSamSettings(settings);
  const pythonPath =
    process.env.PETRO_IMAGE_CZI_PYTHON ||
    settings.czi?.pythonPath ||
    samSettings.pythonPath ||
    (process.platform === "win32" ? "python" : "python3");
  const modulePath =
    process.env.PETRO_IMAGE_CZI_PYTHONPATH || settings.czi?.modulePath || "";
  const env = modulePath
    ? {
        PYTHONPATH: [modulePath, process.env.PYTHONPATH]
          .filter(Boolean)
          .join(path.delimiter),
        PYTHONPYCACHEPREFIX: path.join(app.getPath("temp"), "petro-image-pycache"),
      }
    : {
        PYTHONPYCACHEPREFIX: path.join(app.getPath("temp"), "petro-image-pycache"),
      };
  return {
    command: pythonPath,
    workerArgs: [getPythonWorkerPath("axioscan_czi_worker.py")],
    env,
    bundled: false,
  };
}

function getCziWorkerError(result, fallback) {
  const detail = String(result?.stderr || result?.error || "").trim();
  if (/pylibCZIrw|No module named ['\"]?(numpy|PIL)/i.test(detail)) {
    return "The AxioScan CZI reader is not installed for the configured Python environment. Install pylibCZIrw, numpy, and Pillow, then try again.";
  }
  if (result?.timedOut) return "CZI metadata inspection timed out.";
  return detail ? `${fallback}: ${detail.split(/\r?\n/).slice(-1)[0]}` : fallback;
}

async function inspectAxioScanCzi(sourcePath) {
  if (!sourcePath || path.extname(sourcePath).toLowerCase() !== ".czi") {
    throw new Error("Choose a .czi file.");
  }
  if (!(await pathExists(sourcePath))) {
    throw new Error("The selected CZI file could not be found.");
  }

  const runtime = await getCziWorkerRuntime();
  let inspection = null;
  const result = await runProcessWithProgress(
    runtime.command,
    [...runtime.workerArgs, sourcePath, "--inspect"],
    {
      timeoutMs: 120000,
      env: runtime.env,
      onStdoutLine: (line) => {
        const event = tryParseJsonLine(line);
        if (event?.type === "inspection") inspection = event.inspection;
      },
    },
  );

  if (result.exitCode !== 0 || !inspection) {
    throw new Error(getCziWorkerError(result, "Could not inspect the CZI file"));
  }
  return inspection;
}

async function benchmarkAxioScanCzi(request, event) {
  if (activeCziBenchmarkChild) {
    throw new Error("An AxioScan CZI benchmark is already running.");
  }
  if (activeCziConversionChild) {
    throw new Error("Wait for the CZI conversion to finish before benchmarking.");
  }
  const sourcePath = String(request?.sourcePath || "");
  if (!sourcePath || path.extname(sourcePath).toLowerCase() !== ".czi") {
    throw new Error("Choose a valid CZI source file.");
  }
  if (!(await pathExists(sourcePath))) {
    throw new Error("The selected CZI file could not be found.");
  }
  const channel = Math.floor(Number(request?.channel));
  if (!Number.isInteger(channel) || channel < 0) {
    throw new Error("Choose a valid CZI channel to benchmark.");
  }
  const resolutionScale = Number(request?.resolutionScale);
  if (!CZI_RESOLUTION_SCALES.has(resolutionScale)) {
    throw new Error("Choose a supported CZI benchmark resolution.");
  }

  const runtime = await getCziWorkerRuntime();
  let benchmark = null;
  try {
    const result = await runProcessWithProgress(
      runtime.command,
      [
        ...runtime.workerArgs,
        sourcePath,
        "--benchmark",
        "--channel",
        String(channel),
        "--downsample",
        String(resolutionScale),
      ],
      {
        timeoutMs: 20 * 60 * 1000,
        env: runtime.env,
        onChild: (child) => {
          activeCziBenchmarkChild = child;
        },
        onStdoutLine: (line) => {
          const workerEvent = tryParseJsonLine(line);
          if (workerEvent?.type === "benchmark") benchmark = workerEvent.benchmark;
          if (workerEvent?.type === "benchmark_progress") {
            event.sender.send("czi-benchmark-progress", workerEvent);
          }
        },
      },
    );
    const canceled = Boolean(
      result.canceled || activeCziBenchmarkChild?._petroImageCanceled,
    );
    if (canceled) throw new Error("CZI benchmark canceled.");
    if (result.exitCode !== 0 || !benchmark) {
      throw new Error(getCziWorkerError(result, "CZI benchmark failed"));
    }
    return { ok: true, benchmark };
  } finally {
    activeCziBenchmarkChild = null;
  }
}

function sanitizeCziOutputName(value) {
  return (
    String(value || "axioscan-czi")
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "axioscan-czi"
  );
}

async function getAvailableCziDestination(dziDirectory, fileName) {
  const parsed = path.parse(fileName);
  for (let index = 1; index < 10000; index += 1) {
    const suffix = index === 1 ? "" : `-${index}`;
    const baseName = `${parsed.name}${suffix}`;
    const descriptorPath = path.join(dziDirectory, `${baseName}${parsed.ext}`);
    const tileDirectory = path.join(dziDirectory, `${baseName}_files`);
    if (!(await pathExists(descriptorPath)) && !(await pathExists(tileDirectory))) {
      return { descriptorPath, tileDirectory };
    }
  }
  throw new Error(`Could not choose an available DZI name for ${fileName}.`);
}

async function moveCziSampleIntoProject(
  sample,
  stagingDirectory,
  projectDirectory,
  movedOutputPaths,
) {
  const rewritten = JSON.parse(JSON.stringify(sample));
  const projectDziDirectory = path.join(projectDirectory, DZI_FOLDER_NAME);
  for (const tileSet of rewritten.tileSets || []) {
    for (const tile of tileSet.tiles || []) {
      const fileName = path.basename(tile.uri || "");
      if (!fileName.toLowerCase().endsWith(".dzi")) {
        throw new Error(`The CZI worker returned an invalid DZI path: ${tile.uri}`);
      }
      const sourceDescriptor = path.join(
        stagingDirectory,
        DZI_FOLDER_NAME,
        fileName,
      );
      const sourceParsed = path.parse(sourceDescriptor);
      const sourceTileDirectory = path.join(
        sourceParsed.dir,
        `${sourceParsed.name}_files`,
      );
      if (
        !(await pathExists(sourceDescriptor)) ||
        !(await pathExists(sourceTileDirectory))
      ) {
        throw new Error(`The completed CZI output is missing files for ${fileName}.`);
      }

      const destination = await getAvailableCziDestination(
        projectDziDirectory,
        fileName,
      );
      await fs.rename(sourceDescriptor, destination.descriptorPath);
      movedOutputPaths.push(destination.descriptorPath);
      await fs.rename(sourceTileDirectory, destination.tileDirectory);
      movedOutputPaths.push(destination.tileDirectory);
      tile.uri = path
        .relative(projectDirectory, destination.descriptorPath)
        .split(path.sep)
        .join("/");
    }
  }
  return rewritten;
}

async function runAxioScanCziConversion(request, event) {
  if (activeCziConversionChild) {
    throw new Error("An AxioScan CZI conversion is already running.");
  }

  const settings = await readProjectSettings();
  const projectDirectory = settings.projectDirectory;
  if (!projectDirectory) {
    throw new Error("Open a petro-image project before importing a CZI file.");
  }

  const sourcePath = String(request?.sourcePath || "");
  const bounds = request?.bounds || {};
  const roi = [bounds.x, bounds.y, bounds.width, bounds.height].map(Number);
  if (!sourcePath || path.extname(sourcePath).toLowerCase() !== ".czi") {
    throw new Error("Choose a valid CZI source file.");
  }
  if (!roi.every(Number.isFinite) || roi[2] <= 0 || roi[3] <= 0) {
    throw new Error("The CZI conversion bounds are invalid.");
  }

  const resolutionScale = Number(request?.resolutionScale);
  if (!CZI_RESOLUTION_SCALES.has(resolutionScale)) {
    throw new Error("Choose a supported CZI output resolution.");
  }
  const quality = Math.max(1, Math.min(100, Math.round(Number(request?.quality) || 90)));
  const sourceName = path.basename(sourcePath);
  const stagingDirectory = path.join(
    projectDirectory,
    DZI_FOLDER_NAME,
    `.czi-import-${sanitizeCziOutputName(sourceName)}-${Date.now()}`,
  );
  const runtime = await getCziWorkerRuntime();
  let resultEvent = null;
  let canceled = false;
  const movedOutputPaths = [];
  activeCziConversionOutput = stagingDirectory;

  try {
    const result = await runProcessWithProgress(
      runtime.command,
      [
        ...runtime.workerArgs,
        sourcePath,
        stagingDirectory,
        "--roi",
        ...roi.map(String),
        "--downsample",
        String(resolutionScale),
        "--quality",
        String(quality),
      ],
      {
        timeoutMs: 24 * 60 * 60 * 1000,
        env: runtime.env,
        onChild: (child) => {
          activeCziConversionChild = child;
        },
        onStdoutLine: (line) => {
          const workerEvent = tryParseJsonLine(line);
          if (!workerEvent) return;
          if (workerEvent.type === "result") resultEvent = workerEvent;
          if (["channel", "progress", "performance"].includes(workerEvent.type)) {
            event.sender.send("czi-conversion-progress", workerEvent);
          }
        },
      },
    );
    canceled = Boolean(result.canceled || activeCziConversionChild?._petroImageCanceled);
    if (canceled) throw new Error("CZI conversion canceled.");
    if (result.exitCode !== 0 || !resultEvent?.libraryPath) {
      throw new Error(getCziWorkerError(result, "CZI conversion failed"));
    }

    const libraryText = await fs.readFile(resultEvent.libraryPath, "utf8");
    const generatedLibrary = JSON.parse(libraryText);
    const generatedSample = generatedLibrary.samples?.[0];
    if (!generatedSample) {
      throw new Error("The CZI worker did not return a sample.");
    }
    const sample = await moveCziSampleIntoProject(
      generatedSample,
      stagingDirectory,
      projectDirectory,
      movedOutputPaths,
    );
    sample.title = String(request?.title || sample.title || sourceName).trim();
    const requestedGroups = Array.isArray(request?.groups)
      ? [...new Set(
          request.groups
            .map((group) => String(group || "").trim())
            .filter(Boolean),
        )]
      : [];
    sample.groups = requestedGroups.length ? requestedGroups : ["Imported CZI"];

    const requestedOrder = Array.isArray(request?.tileSetOrder)
      ? request.tileSetOrder.map((key) => String(key))
      : [];
    const remainingTileSets = [...(sample.tileSets || [])];
    const orderedTileSets = [];
    for (const key of requestedOrder) {
      const index = remainingTileSets.findIndex(
        (tileSet) => tileSet._cziImportKey === key,
      );
      if (index >= 0) orderedTileSets.push(...remainingTileSets.splice(index, 1));
    }
    orderedTileSets.push(...remainingTileSets);
    orderedTileSets.forEach((tileSet) => delete tileSet._cziImportKey);
    sample.tileSets = orderedTileSets;
    sample.sampleId = randomUUID();
    await fs.rm(stagingDirectory, { recursive: true, force: true });
    return {
      ok: true,
      sample,
      outputDirectory: path.join(projectDirectory, DZI_FOLDER_NAME),
      width: resultEvent.width,
      height: resultEvent.height,
      totalTiles: resultEvent.totalTiles,
      performance: resultEvent.performance || null,
    };
  } catch (error) {
    for (const outputPath of movedOutputPaths.reverse()) {
      await fs.rm(outputPath, { recursive: true, force: true });
    }
    await fs.rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    activeCziConversionChild = null;
    activeCziConversionOutput = "";
  }
}

const SAM_PROBE_SCRIPT = String.raw`
import importlib.util
import json
import os
import sys
import traceback

checkpoint_path = sys.argv[1] if len(sys.argv) > 1 else ""
model_type = sys.argv[2] if len(sys.argv) > 2 else "base_plus"

model_configs = {
    "tiny": "configs/sam2.1/sam2.1_hiera_t.yaml",
    "small": "configs/sam2.1/sam2.1_hiera_s.yaml",
    "base_plus": "configs/sam2.1/sam2.1_hiera_b+.yaml",
    "large": "configs/sam2.1/sam2.1_hiera_l.yaml",
}

checkpoint_name_hints = {
    "tiny": ["tiny"],
    "small": ["small"],
    "base_plus": ["base_plus", "base-plus", "base"],
    "large": ["large"],
}

result = {
    "ok": False,
    "pythonExecutable": sys.executable,
    "pythonVersion": sys.version.split()[0],
    "modelType": model_type,
    "modelConfig": model_configs.get(model_type),
    "checkpointPath": checkpoint_path,
    "checkpointExists": False,
    "checkpointSizeBytes": None,
    "modules": {},
    "torch": {},
    "errors": [],
    "warnings": [],
}

def add_module(name, import_name=None):
    import_name = import_name or name
    available = importlib.util.find_spec(import_name) is not None
    result["modules"][name] = {"available": available}
    return available

try:
    if checkpoint_path:
        result["checkpointExists"] = os.path.isfile(checkpoint_path)
        if result["checkpointExists"]:
            result["checkpointSizeBytes"] = os.path.getsize(checkpoint_path)
        else:
            result["errors"].append("Checkpoint file was not found.")
    else:
        result["errors"].append("No checkpoint path was provided.")

    torch_available = add_module("torch")
    torchvision_available = add_module("torchvision")
    sam2_available = add_module("sam2")
    hydra_available = add_module("hydra-core", "hydra")
    omegaconf_available = add_module("omegaconf")
    cv2_available = add_module("opencv-python", "cv2")
    skimage_available = add_module("scikit-image", "skimage")

    result["availableModelTypes"] = list(model_configs.keys())
    if model_type not in model_configs:
        result["errors"].append(f"Model type '{model_type}' is not a supported SAM 2.1 model.")

    checkpoint_basename = os.path.basename(checkpoint_path).lower()
    expected_hints = checkpoint_name_hints.get(model_type, [])
    if result["checkpointExists"] and expected_hints and not any(hint in checkpoint_basename for hint in expected_hints):
        result["warnings"].append(
            f"Checkpoint filename does not look like the selected '{model_type}' model."
        )

    if not cv2_available and not skimage_available:
        result["warnings"].append(
            "Neither cv2 nor scikit-image is importable; mask-to-polygon conversion will need one of them."
        )

    if torch_available:
        import torch
        result["modules"]["torch"]["version"] = getattr(torch, "__version__", "")
        result["torch"]["cudaAvailable"] = bool(torch.cuda.is_available())
        result["torch"]["mpsAvailable"] = bool(
            hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
        )
        result["torch"]["deviceRecommendation"] = (
            "cuda" if result["torch"]["cudaAvailable"]
            else "mps" if result["torch"]["mpsAvailable"]
            else "cpu"
        )
    else:
        result["errors"].append("torch is not importable.")

    if torchvision_available:
        import torchvision
        result["modules"]["torchvision"]["version"] = getattr(torchvision, "__version__", "")
    else:
        result["errors"].append("torchvision is not importable.")

    if sam2_available:
        import sam2
        result["modules"]["sam2"]["version"] = getattr(sam2, "__version__", "")
        try:
            from sam2.build_sam import build_sam2
            result["modules"]["sam2.build_sam"] = {"available": True}
        except Exception as error:
            result["modules"]["sam2.build_sam"] = {"available": False}
            result["errors"].append(f"sam2.build_sam import failed: {error}")
        try:
            from sam2.sam2_image_predictor import SAM2ImagePredictor
            result["modules"]["sam2.sam2_image_predictor"] = {"available": True}
        except Exception as error:
            result["modules"]["sam2.sam2_image_predictor"] = {"available": False}
            result["errors"].append(f"sam2.sam2_image_predictor import failed: {error}")
    else:
        result["errors"].append("sam2 is not importable.")

    result["ok"] = (
        result["checkpointExists"]
        and torch_available
        and torchvision_available
        and sam2_available
        and result["modules"].get("sam2.build_sam", {}).get("available", False)
        and result["modules"].get("sam2.sam2_image_predictor", {}).get("available", False)
        and model_type in model_configs
    )
except Exception:
    result["errors"].append(traceback.format_exc())

print(json.dumps(result))
`;

async function validateSamSetup(settings) {
  const samSettings = normalizeSamSettings({ sam: settings });
  if (!samSettings.pythonPath) {
    return {
      ok: false,
      errors: ["Choose a Python executable."],
      settings: samSettings,
    };
  }

  const result = await runProcess(
    samSettings.pythonPath,
    ["-c", SAM_PROBE_SCRIPT, samSettings.checkpointPath, samSettings.modelType],
    {
      timeoutMs: 120000,
      env: buildPythonProcessEnv(samSettings.pythonPath),
    },
  );

  if (result.timedOut) {
    return {
      ok: false,
      errors: ["SAM validation timed out."],
      stderr: result.stderr,
      settings: samSettings,
    };
  }

  let parsed;
  try {
    parsed = parseJsonProcessOutput(result.stdout);
  } catch (error) {
    return {
      ok: false,
      errors: ["Python did not return valid SAM validation JSON."],
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      settings: samSettings,
    };
  }

  return {
    ...parsed,
    exitCode: result.exitCode,
    stderr: result.stderr,
    settings: samSettings,
  };
}

async function validateSegmenteverygrainSetup(settings = {}) {
  const samSettings = normalizeSamSettings({ sam: settings.sam || settings });
  const segSettings = normalizeSegmenteverygrainSettings(
    settings.segmenteverygrain || {},
  );
  if (!samSettings.pythonPath) {
    return {
      ok: false,
      errors: ["Choose a Python executable."],
      settings: samSettings,
      segmenteverygrainSettings: segSettings,
    };
  }
  const modelPathError = getSegmenteverygrainModelPathError(
    segSettings.modelPath,
    samSettings.pythonPath,
  );
  if (modelPathError) {
    return {
      ok: false,
      errors: [modelPathError],
      settings: samSettings,
      segmenteverygrainSettings: segSettings,
    };
  }

  const result = await runProcess(
    samSettings.pythonPath,
    [
      getPythonWorkerPath("segmenteverygrain_validate.py"),
      segSettings.modelPath,
    ],
    {
      timeoutMs: 240000,
      env: buildPythonProcessEnv(samSettings.pythonPath),
    },
  );

  if (result.timedOut) {
    return {
      ok: false,
      errors: ["segmenteverygrain validation timed out."],
      stderr: result.stderr,
      settings: samSettings,
      segmenteverygrainSettings: segSettings,
    };
  }

  let parsed;
  try {
    parsed = parseJsonProcessOutput(result.stdout);
  } catch (error) {
    const processDetail = String(
      result.stderr || result.stdout || result.error || "",
    ).trim();
    return {
      ok: false,
      errors: [
        "Python did not return valid segmenteverygrain validation JSON.",
        ...(processDetail
          ? [`Python process output: ${processDetail.slice(-4000)}`]
          : [`Python exited with code ${result.exitCode ?? "unknown"}.`]),
      ],
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      settings: samSettings,
      segmenteverygrainSettings: segSettings,
    };
  }

  return {
    ...parsed,
    exitCode: result.exitCode,
    stderr: result.stderr,
    settings: samSettings,
    segmenteverygrainSettings: segSettings,
  };
}

function decodePngDataUrl(dataUrl) {
  const match = /^data:image\/png;base64,(.+)$/i.exec(dataUrl || "");
  if (!match) {
    throw new Error("Segment crop was not a PNG data URL.");
  }

  return Buffer.from(match[1], "base64");
}

function getSamWorkerKey(settings, device = "auto") {
  return JSON.stringify({
    pythonPath: settings.pythonPath,
    checkpointPath: settings.checkpointPath,
    modelType: settings.modelType,
    device,
  });
}

function stopSamWorker() {
  if (!samWorker) return;

  const worker = samWorker;
  samWorker = null;
  for (const pending of worker.pending.values()) {
    clearTimeout(pending.timer);
    pending.resolve({
      ok: false,
      error: "SAM worker stopped.",
      stderr: worker.stderr,
    });
  }
  worker.pending.clear();
  if (!worker.child.killed) {
    try {
      worker.child.stdin.write(JSON.stringify({ type: "shutdown" }) + "\n");
      worker.child.stdin.end();
    } catch {
      worker.child.kill();
    }
  }
}

function rejectSamWorkerPending(worker, errorMessage) {
  for (const pending of worker.pending.values()) {
    clearTimeout(pending.timer);
    pending.resolve({
      ok: false,
      error: errorMessage,
      stderr: worker.stderr,
    });
  }
  worker.pending.clear();
}

function handleSamWorkerLine(worker, line) {
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    worker.stderr += `${line}\n`;
    return;
  }

  if (payload.type === "ready") {
    if (payload.ok) {
      worker.readyResolve(payload);
    } else {
      worker.readyReject(new Error(payload.error || "SAM worker failed to start."));
    }
    return;
  }

  const pending = worker.pending.get(payload.id);
  if (!pending) return;
  clearTimeout(pending.timer);
  worker.pending.delete(payload.id);
  pending.resolve({
    ...payload,
    stderr: worker.stderr,
  });
}

async function getSamWorker(settings, device = "auto") {
  const key = getSamWorkerKey(settings, device);
  if (samWorker && samWorker.key === key && !samWorker.exited) {
    await samWorker.ready;
    return samWorker;
  }

  stopSamWorker();

  const scriptPath = getPythonWorkerPath("sam2_worker.py");
  const child = spawn(
    settings.pythonPath,
    [
      scriptPath,
      "--checkpoint",
      settings.checkpointPath,
      "--model-type",
      settings.modelType,
      "--device",
      device,
    ],
    {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: buildPythonProcessEnv(settings.pythonPath),
    },
  );

  let readyResolve;
  let readyReject;
  const worker = {
    key,
    child,
    pending: new Map(),
    nextId: 1,
    stdoutBuffer: "",
    stderr: "",
    exited: false,
    ready: new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    }),
    readyResolve,
    readyReject,
  };
  samWorker = worker;

  child.stdout.on("data", (chunk) => {
    worker.stdoutBuffer += chunk.toString();
    const lines = worker.stdoutBuffer.split(/\r?\n/);
    worker.stdoutBuffer = lines.pop() || "";
    lines.map((line) => line.trim()).filter(Boolean).forEach((line) => {
      handleSamWorkerLine(worker, line);
    });
  });
  child.stderr.on("data", (chunk) => {
    worker.stderr += chunk.toString();
  });
  child.on("error", (error) => {
    worker.exited = true;
    worker.readyReject(error);
    rejectSamWorkerPending(worker, error.message);
  });
  child.on("close", (exitCode) => {
    worker.exited = true;
    const stderr = worker.stderr.trim();
    const message = `SAM worker exited${exitCode === null ? "" : ` with code ${exitCode}`}.${
      stderr ? ` ${stderr.split(/\r?\n/).slice(-1)[0]}` : ""
    }`;
    worker.readyReject(new Error(message));
    rejectSamWorkerPending(worker, message);
    if (samWorker === worker) samWorker = null;
  });

  await worker.ready;
  return worker;
}

function segmentWithSamWorker(worker, cropPath, box, options = {}) {
  return new Promise((resolve) => {
    const id = worker.nextId++;
    const timer = setTimeout(() => {
      worker.pending.delete(id);
      resolve({
        ok: false,
        error: "SAM segmentation timed out.",
        stderr: worker.stderr,
      });
    }, options.timeoutMs || 300000);
    worker.pending.set(id, { resolve, timer });
    worker.child.stdin.write(
      JSON.stringify({
        id,
        image: cropPath,
        box: box ? [box.x0, box.y0, box.x1, box.y1] : null,
        points: options.points || [],
        simplifyEpsilon: options.simplifyEpsilon ?? 2,
      }) + "\n",
    );
  });
}

async function runSamSegmentation(request = {}) {
  const settings = await writeSamSettings(request.samSettings || {});
  const tempDirectory = await fs.mkdtemp(
    path.join(app.getPath("temp"), "petro-image-sam-"),
  );
  const cropPath = path.join(tempDirectory, "crop.png");

  try {
    await fs.writeFile(cropPath, decodePngDataUrl(request.cropPngDataUrl));
    const box = request.box || null;
    const worker = await getSamWorker(settings, request.device || "auto");
    const result = await segmentWithSamWorker(worker, cropPath, box, {
      points: request.points || [],
      simplifyEpsilon: request.simplifyEpsilon,
    });
    return result;
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}

function getSegmenteverygrainWorkerKey(
  samSettings,
  segSettings,
  useSam,
  device = "auto",
) {
  return JSON.stringify({
    pythonPath: samSettings.pythonPath,
    modelPath: segSettings.modelPath,
    useSam,
    checkpointPath: useSam ? samSettings.checkpointPath : "",
    modelType: useSam ? samSettings.modelType : "",
    device: useSam ? device : "",
  });
}

function appendSegmenteverygrainWorkerStderr(worker, text) {
  worker.stderr += text;
  const maxLength = 200000;
  if (worker.stderr.length > maxLength) {
    worker.stderr = worker.stderr.slice(-maxLength);
  }
}

function resolveSegmenteverygrainWorkerPending(worker, result) {
  for (const pending of worker.pending.values()) {
    clearTimeout(pending.timer);
    pending.resolve({
      ...result,
      stderr: worker.stderr,
    });
  }
  worker.pending.clear();
  worker.activeJobId = null;
}

function stopSegmenteverygrainWorker(options = {}) {
  if (!segmenteverygrainWorker) return;

  const { force = false, reason = "segmenteverygrain worker stopped." } = options;
  const worker = segmenteverygrainWorker;
  segmenteverygrainWorker = null;
  resolveSegmenteverygrainWorkerPending(worker, { ok: false, error: reason });
  if (worker.child.killed) return;

  if (force) {
    worker.child.kill();
    return;
  }
  try {
    worker.child.stdin.write(JSON.stringify({ type: "shutdown" }) + "\n");
    worker.child.stdin.end();
  } catch {
    worker.child.kill();
  }
}

function getActiveSegmenteverygrainPending(worker) {
  return worker.activeJobId === null
    ? null
    : worker.pending.get(worker.activeJobId) || null;
}

function forwardSegmenteverygrainWorkerProgress(worker, payload) {
  const pending = getActiveSegmenteverygrainPending(worker);
  if (pending?.onProgress) {
    pending.onProgress(payload);
  } else {
    worker.startupProgress?.(payload);
  }
}

function handleSegmenteverygrainWorkerLine(worker, line) {
  const payload = tryParseJsonLine(line);
  if (!payload) {
    appendSegmenteverygrainWorkerStderr(worker, `${line}\n`);
    return;
  }

  if (payload.type === "progress") {
    const overallPatchCurrent = Number(payload.overallPatchCurrent);
    const overallPatchTotal = Number(payload.overallPatchTotal);
    if (
      Number.isFinite(overallPatchCurrent) &&
      Number.isFinite(overallPatchTotal) &&
      overallPatchTotal > 0
    ) {
      worker.overallPatchCurrent = overallPatchCurrent;
      worker.overallPatchTotal = overallPatchTotal;
      worker.announcedOverallPatch = overallPatchCurrent;
    }
    forwardSegmenteverygrainWorkerProgress(worker, payload);
    return;
  }
  if (payload.type === "ready") {
    clearTimeout(worker.readyTimer);
    worker.startupProgress = null;
    if (payload.ok) {
      worker.readyResolve(payload);
    } else {
      worker.readyReject(
        new Error(payload.error || "segmenteverygrain worker failed to start."),
      );
    }
    return;
  }

  const pending = worker.pending.get(payload.id);
  if (!pending) return;
  clearTimeout(pending.timer);
  worker.pending.delete(payload.id);
  worker.activeJobId = null;
  pending.resolve({
    ...payload,
    stderr: worker.stderr,
  });
}

async function getSegmenteverygrainWorker(
  samSettings,
  segSettings,
  useSam,
  device = "auto",
  onProgress = null,
) {
  const key = getSegmenteverygrainWorkerKey(
    samSettings,
    segSettings,
    useSam,
    device,
  );
  if (
    segmenteverygrainWorker &&
    segmenteverygrainWorker.key === key &&
    !segmenteverygrainWorker.exited
  ) {
    await segmenteverygrainWorker.ready;
    return segmenteverygrainWorker;
  }

  stopSegmenteverygrainWorker({ force: true });
  const scriptPath = getPythonWorkerPath("segmenteverygrain_worker.py");
  const args = [scriptPath, "--model", segSettings.modelPath];
  if (useSam) {
    args.push(
      "--use-sam",
      "--sam-checkpoint",
      samSettings.checkpointPath,
      "--sam-model-type",
      samSettings.modelType || "base_plus",
      "--device",
      device,
    );
  }
  const matplotlibConfigDirectory = path.join(
    app.getPath("temp"),
    "petro-image-matplotlib",
  );
  await fs.mkdir(matplotlibConfigDirectory, { recursive: true });
  const child = spawn(samSettings.pythonPath, args, {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: buildPythonProcessEnv(samSettings.pythonPath, {
      MPLCONFIGDIR: matplotlibConfigDirectory,
      TF_CPP_MIN_LOG_LEVEL: "2",
    }),
  });
  activeSegmenteverygrainChild = child;

  let readyResolve;
  let readyReject;
  const worker = {
    key,
    child,
    pending: new Map(),
    nextId: 1,
    activeJobId: null,
    stdoutBuffer: "",
    stderrBuffer: "",
    stderr: "",
    overallPatchCurrent: 0,
    overallPatchTotal: 0,
    announcedOverallPatch: 0,
    exited: false,
    startupProgress: onProgress,
    ready: new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    }),
    readyResolve,
    readyReject,
    readyTimer: null,
  };
  segmenteverygrainWorker = worker;
  worker.readyTimer = setTimeout(() => {
    worker.exited = true;
    worker.readyReject(
      new Error("segmenteverygrain worker did not become ready within 5 minutes."),
    );
    if (!worker.child.killed) worker.child.kill();
  }, 5 * 60 * 1000);

  child.stdout.on("data", (chunk) => {
    worker.stdoutBuffer += chunk.toString();
    const lines = worker.stdoutBuffer.split(/\r?\n/);
    worker.stdoutBuffer = lines.pop() || "";
    lines
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => handleSegmenteverygrainWorkerLine(worker, line));
  });
  child.stderr.on("data", (chunk) => {
    worker.stderrBuffer += chunk.toString();
    const lines = worker.stderrBuffer.split(/\r|\n/);
    worker.stderrBuffer = lines.pop() || "";
    lines
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        appendSegmenteverygrainWorkerStderr(worker, `${line}\n`);
        const progress = parseSegmenteverygrainTextProgress(line);
        if (!progress) return;
        if (worker.overallPatchTotal > 0) {
          const nextPatch = Math.min(
            worker.overallPatchCurrent + 1,
            worker.overallPatchTotal,
          );
          if (nextPatch === worker.announcedOverallPatch) return;
          worker.announcedOverallPatch = nextPatch;
          forwardSegmenteverygrainWorkerProgress(worker, {
            type: "progress",
            stage: "Segmentation",
            message: `Segmentation: processing patch ${nextPatch} of ${worker.overallPatchTotal}.`,
            percent:
              20 +
              (worker.overallPatchCurrent / worker.overallPatchTotal) * 70,
          });
          return;
        }
        forwardSegmenteverygrainWorkerProgress(worker, progress);
      });
  });
  child.on("error", (error) => {
    clearTimeout(worker.readyTimer);
    worker.exited = true;
    worker.readyReject(error);
    resolveSegmenteverygrainWorkerPending(worker, {
      ok: false,
      error: error.message,
    });
  });
  child.on("close", (exitCode) => {
    clearTimeout(worker.readyTimer);
    worker.exited = true;
    const canceled = Boolean(worker.child._petroImageCanceled);
    const message = canceled
      ? "segmenteverygrain canceled."
      : `segmenteverygrain worker exited${
          exitCode === null ? "" : ` with code ${exitCode}`
        }.`;
    worker.readyReject(new Error(message));
    resolveSegmenteverygrainWorkerPending(worker, {
      ok: false,
      canceled,
      error: message,
    });
    if (segmenteverygrainWorker === worker) {
      segmenteverygrainWorker = null;
    }
    if (activeSegmenteverygrainChild === worker.child) {
      activeSegmenteverygrainChild = null;
    }
  });

  await worker.ready;
  return worker;
}

function segmentWithSegmenteverygrainWorker(worker, job, options = {}) {
  return new Promise((resolve) => {
    if (worker.activeJobId !== null) {
      resolve({
        ok: false,
        error: "segmenteverygrain is already running.",
      });
      return;
    }
    const id = worker.nextId++;
    worker.activeJobId = id;
    worker.stderr = "";
    worker.overallPatchCurrent = 0;
    worker.overallPatchTotal = 0;
    worker.announcedOverallPatch = 0;
    const requestedTimeoutMs = Number(options.timeoutMs);
    const timer =
      Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
        ? setTimeout(() => {
            worker.pending.delete(id);
            worker.activeJobId = null;
            worker.exited = true;
            if (segmenteverygrainWorker === worker) {
              segmenteverygrainWorker = null;
            }
            resolve({
              ok: false,
              error: "segmenteverygrain timed out.",
              stderr: worker.stderr,
            });
            if (!worker.child.killed) worker.child.kill();
          }, requestedTimeoutMs)
        : null;
    worker.pending.set(id, {
      resolve,
      timer,
      onProgress: options.onProgress || null,
    });
    try {
      worker.child.stdin.write(JSON.stringify({ id, ...job }) + "\n");
    } catch (error) {
      clearTimeout(timer);
      worker.pending.delete(id);
      worker.activeJobId = null;
      resolve({ ok: false, error: error.message, stderr: worker.stderr });
    }
  });
}

async function runSegmenteverygrainSegmentation(request = {}, event = null) {
  const samSettings = await writeSamSettings(request.samSettings || {});
  const segSettings = await writeSegmenteverygrainSettings(
    request.segmenteverygrainSettings || {},
  );
  if (!samSettings.pythonPath) {
    return { ok: false, error: "Choose a Python executable." };
  }
  const modelPathError = getSegmenteverygrainModelPathError(
    segSettings.modelPath,
    samSettings.pythonPath,
  );
  if (modelPathError) {
    return { ok: false, error: modelPathError };
  }
  if (request.useSam !== false) {
    if (!samSettings.checkpointPath) {
      return { ok: false, error: "Choose a SAM 2.1 checkpoint for refinement." };
    }
    if (!(await pathExists(samSettings.checkpointPath))) {
      return { ok: false, error: "SAM 2.1 checkpoint file was not found." };
    }
  }

  const tempDirectory = await fs.mkdtemp(
    path.join(app.getPath("temp"), "petro-image-seg-"),
  );
  const cropPath = path.join(tempDirectory, "aoi.png");

  try {
    let tileJobPath = "";
    if (request.tileJob) {
      let tileJob;
      try {
        tileJob = await buildSegmenteverygrainTileJob(event, request.tileJob);
      } catch (error) {
        return {
          ok: false,
          error: error.message || "Could not prepare DZI tiles for segmentation.",
        };
      }
      if (!tileJob.tiles.length) {
        return { ok: false, error: "No visible local DZI tile source is available." };
      }
      tileJobPath = path.join(tempDirectory, "tile-job.json");
      await fs.writeFile(tileJobPath, JSON.stringify(tileJob), "utf8");
    } else {
      await fs.writeFile(cropPath, decodePngDataUrl(request.cropPngDataUrl));
    }

    let lastSegmenteverygrainProgressAt = Date.now();
    let latestSegmenteverygrainProgressMessage = "Starting segmenteverygrain...";
    const sendProgress = (payload, options = {}) => {
      if (!options.heartbeat) {
        lastSegmenteverygrainProgressAt = Date.now();
        if (payload?.message) {
          latestSegmenteverygrainProgressMessage = String(payload.message);
        }
      }
      const webContents = event?.sender || mainWindow?.webContents;
      if (!webContents || webContents.isDestroyed()) return;
      webContents.send("segmenteverygrain-progress", payload);
    };
    sendProgress({
      type: "progress",
      stage: "Starting",
      message: "Starting segmenteverygrain...",
      percent: 1,
    });
    const heartbeatStartedAt = Date.now();
    const heartbeat = setInterval(() => {
      if (Date.now() - lastSegmenteverygrainProgressAt < 20000) return;
      const elapsedSeconds = Math.max(
        1,
        Math.round((Date.now() - heartbeatStartedAt) / 1000),
      );
      const elapsedLabel =
        elapsedSeconds >= 60
          ? `${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`
          : `${elapsedSeconds}s`;
      sendProgress(
        {
          type: "progress",
          stage: "Running",
          message: `${latestSegmenteverygrainProgressMessage.replace(/[.\s]+$/, "")} — ${elapsedLabel} elapsed.`,
        },
        { heartbeat: true },
      );
    }, 5000);
    let result;
    try {
      const useSam = request.useSam !== false;
      const worker = await getSegmenteverygrainWorker(
        samSettings,
        segSettings,
        useSam,
        request.device || "auto",
        sendProgress,
      );
      activeSegmenteverygrainChild = worker.child;
      const numberOrDefault = (value, fallback) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
      };
      result = await segmentWithSegmenteverygrainWorker(worker, {
        image: tileJobPath ? "" : cropPath,
        tileJob: tileJobPath,
        stitchOutput: tileJobPath ? cropPath : "",
        simplifyEpsilon: numberOrDefault(request.simplifyEpsilon, 0),
        minArea: numberOrDefault(request.minArea, 400),
        patchSize: numberOrDefault(request.patchSize, 3000),
        overlap: numberOrDefault(request.overlap, 600),
        dilation: numberOrDefault(request.dilation, 3),
        dbsMaxDist: numberOrDefault(request.dbsMaxDist, 100),
        removeEdgeGrains: Boolean(request.removeEdgeGrains),
      }, {
        timeoutMs: 0,
        onProgress: sendProgress,
      });
    } catch (error) {
      result = {
        ok: false,
        error: error.message || "Could not start segmenteverygrain.",
      };
    } finally {
      clearInterval(heartbeat);
      activeSegmenteverygrainChild = null;
    }

    if (result.canceled) {
      return {
        ok: false,
        canceled: true,
        error: "segmenteverygrain canceled.",
      };
    }

    return result;
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
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

      const stats = await fs.stat(filePath);
      response.writeHead(200, {
        "Content-Type": getContentType(filePath),
        "Content-Length": stats.size,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      const stream = createReadStream(filePath);
      response.on("close", () => {
        if (!response.writableEnded) {
          stream.destroy();
        }
      });
      stream.on("error", (error) => {
        if (!response.headersSent) {
          response.writeHead(error.code === "ENOENT" ? 404 : 500);
        }
        response.end(error.message);
      });
      stream.pipe(response);
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

function getWindowStatePath() {
  return path.join(app.getPath("userData"), WINDOW_STATE_FILE_NAME);
}

function getRectIntersectionArea(first, second) {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

async function getRestoredWindowState() {
  try {
    const stored = JSON.parse(await fs.readFile(getWindowStatePath(), "utf8"));
    const values = [stored?.x, stored?.y, stored?.width, stored?.height];
    if (!values.every(Number.isFinite)) return null;

    const candidate = {
      x: Math.round(stored.x),
      y: Math.round(stored.y),
      width: Math.max(800, Math.round(stored.width)),
      height: Math.max(600, Math.round(stored.height)),
    };
    const displays = screen.getAllDisplays();
    const bestDisplay = displays
      .map((display) => ({
        display,
        area: getRectIntersectionArea(candidate, display.workArea),
      }))
      .sort((a, b) => b.area - a.area)[0];
    if (!bestDisplay || bestDisplay.area <= 0) return null;

    const workArea = bestDisplay.display.workArea;
    const width = Math.min(candidate.width, workArea.width);
    const height = Math.min(candidate.height, workArea.height);
    return {
      x: Math.min(
        Math.max(candidate.x, workArea.x),
        workArea.x + workArea.width - width,
      ),
      y: Math.min(
        Math.max(candidate.y, workArea.y),
        workArea.y + workArea.height - height,
      ),
      width,
      height,
      maximized: Boolean(stored.maximized),
    };
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn("Could not restore the main window state:", error);
    }
    return null;
  }
}

function saveMainWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = mainWindow.getNormalBounds();
    writeFileSync(
      getWindowStatePath(),
      JSON.stringify(
        {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          maximized: mainWindow.isMaximized(),
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch (error) {
    console.warn("Could not save the main window state:", error);
  }
}

function scheduleMainWindowStateSave() {
  if (windowStateSaveTimer !== null) clearTimeout(windowStateSaveTimer);
  windowStateSaveTimer = setTimeout(() => {
    windowStateSaveTimer = null;
    saveMainWindowState();
  }, 250);
}

const createWindow = async () => {
  const defaultBounds = getDefaultWindowBounds();
  const restoredState = await getRestoredWindowState();
  const initialBounds = restoredState
    ? {
        x: restoredState.x,
        y: restoredState.y,
        width: restoredState.width,
        height: restoredState.height,
      }
    : defaultBounds;

  mainWindow = new BrowserWindow({
    title: APP_TITLE,
    ...initialBounds,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (restoredState?.maximized) mainWindow.maximize();

  ["move", "resize", "maximize", "unmaximize"].forEach((eventName) => {
    mainWindow.on(eventName, scheduleMainWindowStateSave);
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const protocol = new URL(url).protocol;
      if (protocol === "http:" || protocol === "https:") {
        shell.openExternal(url);
      }
    } catch (error) {
      console.warn("Could not open external link:", error);
    }
    return { action: "deny" };
  });
  mainWindow.loadFile("index.html");

  mainWindow.on("close", async (e) => {
    if (windowStateSaveTimer !== null) {
      clearTimeout(windowStateSaveTimer);
      windowStateSaveTimer = null;
    }
    saveMainWindowState();
    console.log("closing window, unsaved work?", hasUnsavedWork);
    if (hasUnsavedWork) {
      e.preventDefault();
      if (closeWarningInProgress) return;
      closeWarningInProgress = true;
      try {
        if (unsavedWorkDomains.includes("annotations")) {
          try {
            const saved = await mainWindow.webContents.executeJavaScript(
              "window.flushAnnotationAutosave?.()",
            );
            if (saved === true) {
              unsavedWorkDomains = unsavedWorkDomains.filter(
                (domain) => domain !== "annotations",
              );
              unsavedWorkLabels = unsavedWorkLabels.filter(
                (label) => label !== "annotations",
              );
              hasUnsavedWork = unsavedWorkDomains.length > 0;
            }
          } catch (error) {
            console.warn("Could not flush working annotations before closing:", error);
          }
        }
        if (!hasUnsavedWork) {
          mainWindow.destroy();
          return;
        }
        const detail = unsavedWorkLabels.length
          ? `Unsaved: ${unsavedWorkLabels.join(", ")}.`
          : "";
        const result = await dialog.showMessageBox(mainWindow, {
          type: "warning",
          buttons: ["Cancel", "Quit Without Saving"],
          defaultId: 1,
          cancelId: 0,
          message: "You have unsaved changes. Are you sure you want to quit?",
          detail,
        });
        if (result.response === 1) {
          hasUnsavedWork = false; // allow closing next time
          unsavedWorkDomains = [];
          unsavedWorkLabels = [];
          mainWindow.destroy();
        }
      } finally {
        closeWarningInProgress = false;
      }
    }
  });
};

// IPC listener to update unsaved work state
ipcMain.on("set-unsaved-state", (event, state) => {
  const payload = state && typeof state === "object" ? state : null;
  hasUnsavedWork = payload ? Boolean(payload.dirty) : Boolean(state);
  unsavedWorkDomains = payload
    ? (payload.domains || []).filter((domain) => typeof domain === "string")
    : [];
  unsavedWorkLabels = payload
    ? (payload.labels || []).filter((label) => typeof label === "string")
    : [];
  console.log("Main process received unsaved state:", {
    dirty: hasUnsavedWork,
    labels: unsavedWorkLabels,
  });
});

ipcMain.handle("get-app-version", () => app.getVersion());

function getImportWizardContext(context = {}) {
  const filePath = typeof context.filePath === "string" ? context.filePath : "";
  const jsonData =
    context.jsonData && Array.isArray(context.jsonData.samples)
      ? context.jsonData
      : { format: "v1", samples: [] };
  const resolvedFilePath = filePath ? path.resolve(filePath) : "";
  const bundledLibraryPaths = new Set([
    path.resolve(getBundledDefaultLibraryPath()),
    path.resolve(getBundledProjectLibraryTemplatePath()),
  ]);

  return {
    filePath,
    fileName: filePath ? path.basename(filePath) : "",
    jsonData,
    canWriteCurrentLibrary:
      Boolean(resolvedFilePath) && !bundledLibraryPaths.has(resolvedFilePath),
  };
}

function sendImportWizardContext(context) {
  if (!importWizardWindow || importWizardWindow.isDestroyed()) return;
  importWizardWindow.webContents.send("import-wizard-context", context);
}

ipcMain.handle("open-import-wizard", (event, requestedContext) => {
  const context = getImportWizardContext(requestedContext);
  if (importWizardWindow && !importWizardWindow.isDestroyed()) {
    importWizardWindow.focus();
    sendImportWizardContext(context);
    return;
  }

  importWizardWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 900,
    minHeight: 520,
    parent: mainWindow,
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  importWizardWindow.setMenuBarVisibility(false);
  importWizardWindow.webContents.once("did-finish-load", () => {
    sendImportWizardContext(context);
  });
  importWizardWindow.loadFile("index_import_wizard.html");
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

ipcMain.handle("select-image-file", async () => {
  const ownerWindow = BrowserWindow.getFocusedWindow() || mainWindow;
  const { canceled, filePaths } = await dialog.showOpenDialog(ownerWindow, {
    title: "Select image file",
    properties: ["openFile"],
    filters: [
      {
        name: "Supported Images",
        extensions: [
          "jpg", "jpeg", "png", "tif", "tiff", "webp", "gif",
          "avif", "heif", "heic", "svg", "v", "vips",
          "jp2", "j2k", "j2c", "jpc", "jpf", "jpx",
        ],
      },
      { name: "JPEG", extensions: ["jpg", "jpeg"] },
      { name: "PNG", extensions: ["png"] },
      { name: "TIFF", extensions: ["tif", "tiff"] },
      { name: "WebP", extensions: ["webp"] },
      { name: "AVIF / HEIF", extensions: ["avif", "heif", "heic"] },
      { name: "GIF", extensions: ["gif"] },
      { name: "SVG", extensions: ["svg"] },
      {
        name: "JPEG 2000 / JPX",
        extensions: ["jp2", "j2k", "j2c", "jpc", "jpf", "jpx"],
      },
    ],
  });

  if (canceled || !filePaths.length) {
    return { canceled: true };
  }

  return {
    canceled: false,
    sourcePath: filePaths[0],
  };
});

ipcMain.handle("select-axioscan-czi", async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(
    getOwnerWindow(event),
    {
      title: "Select AxioScan 7 CZI file",
      properties: ["openFile"],
      filters: [
        { name: "Zeiss CZI", extensions: ["czi"] },
        { name: "All Files", extensions: ["*"] },
      ],
    },
  );
  if (canceled || !filePaths.length) return { canceled: true };
  return { canceled: false, sourcePath: filePaths[0] };
});

ipcMain.handle("inspect-axioscan-czi", async (event, sourcePath) => {
  return inspectAxioScanCzi(sourcePath);
});

ipcMain.handle("benchmark-axioscan-czi", async (event, request) => {
  return benchmarkAxioScanCzi(request || {}, event);
});

ipcMain.handle("cancel-axioscan-czi-benchmark", async () => {
  if (!activeCziBenchmarkChild || activeCziBenchmarkChild.killed) {
    return { ok: true, canceled: false };
  }
  activeCziBenchmarkChild._petroImageCanceled = true;
  activeCziBenchmarkChild.kill();
  return { ok: true, canceled: true };
});

ipcMain.handle("convert-axioscan-czi", async (event, request) => {
  return runAxioScanCziConversion(request || {}, event);
});

ipcMain.handle("cancel-axioscan-czi", async () => {
  if (!activeCziConversionChild || activeCziConversionChild.killed) {
    return { ok: true, canceled: false };
  }
  activeCziConversionChild._petroImageCanceled = true;
  activeCziConversionChild.kill();
  return { ok: true, canceled: true, outputDirectory: activeCziConversionOutput };
});

ipcMain.handle("initialize-project-library", async () => initializeProjectLibrary());

ipcMain.handle("change-project-library", async () => changeProjectLibrary());

ipcMain.handle("get-project-settings", async () => readProjectSettings());

ipcMain.handle("load-working-annotations", async (event, { sampleId } = {}) => {
  const settings = await readProjectSettings();
  if (!settings.projectDirectory) return { available: false, geoJSON: null };
  const geoJSON = await loadWorkingAnnotations(settings.projectDirectory, sampleId);
  return { available: true, geoJSON };
});

ipcMain.handle("save-working-annotations", async (event, request = {}) => {
  const settings = await readProjectSettings();
  if (!settings.projectDirectory) return { available: false };
  const result = await saveWorkingAnnotations(settings.projectDirectory, request);
  return { available: true, ...result };
});

ipcMain.handle("save-sam-settings", async (event, samSettings) => {
  return writeSamSettings(samSettings || {});
});

ipcMain.handle("save-segmenteverygrain-settings", async (event, settings) => {
  return writeSegmenteverygrainSettings(settings || {});
});

ipcMain.handle("select-sam-python", async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(getOwnerWindow(event), {
    title: "Select Python Executable",
    properties: ["openFile"],
  });

  if (canceled || !filePaths.length) {
    return { canceled: true };
  }

  const settings = await writeSamSettings({ pythonPath: filePaths[0] });
  return {
    canceled: false,
    filePath: filePaths[0],
    settings,
  };
});

ipcMain.handle("select-sam-checkpoint", async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(getOwnerWindow(event), {
    title: "Select SAM Checkpoint",
    properties: ["openFile"],
    filters: [
      { name: "SAM Checkpoints", extensions: ["pth", "pt"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (canceled || !filePaths.length) {
    return { canceled: true };
  }

  const settings = await writeSamSettings({ checkpointPath: filePaths[0] });
  return {
    canceled: false,
    filePath: filePaths[0],
    settings,
  };
});

ipcMain.handle("select-segmenteverygrain-model", async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(getOwnerWindow(event), {
    title: "Select segmenteverygrain Model",
    properties: ["openFile"],
    filters: [
      { name: "Keras Model Files", extensions: ["h5", "keras"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (canceled || !filePaths.length) {
    return { canceled: true };
  }

  const samSettings = normalizeSamSettings(await readProjectSettings());
  const modelPathError = getSegmenteverygrainModelPathError(
    filePaths[0],
    samSettings.pythonPath,
  );
  if (modelPathError) {
    return {
      canceled: false,
      filePath: filePaths[0],
      error: modelPathError,
      settings: await writeSegmenteverygrainSettings({}),
    };
  }

  const settings = await writeSegmenteverygrainSettings({
    modelPath: filePaths[0],
  });
  return {
    canceled: false,
    filePath: filePaths[0],
    settings,
  };
});

ipcMain.handle("validate-sam-setup", async (event, samSettings) => {
  const savedSettings = await writeSamSettings(samSettings || {});
  const result = await validateSamSetup(savedSettings);
  const settingsWithValidation = await writeSamSettings({
    ...savedSettings,
    validation: {
      status: result.ok ? "ready" : "error",
      fingerprint: getSamSettingsFingerprint(result.settings || savedSettings),
      validatedAt: new Date().toISOString(),
    },
  });
  return {
    ...result,
    settings: settingsWithValidation,
  };
});

ipcMain.handle("validate-segmenteverygrain-setup", async (event, samSettings) => {
  const savedSamSettings = await writeSamSettings(samSettings?.sam || samSettings || {});
  const savedSegSettings = await writeSegmenteverygrainSettings(
    samSettings?.segmenteverygrain || {},
  );
  const result = await validateSegmenteverygrainSetup({
    sam: savedSamSettings,
    segmenteverygrain: savedSegSettings,
  });
  const settingsWithValidation = await writeSegmenteverygrainSettings({
    ...savedSegSettings,
    validation: {
      status: result.ok ? "ready" : "error",
      fingerprint: JSON.stringify({
        pythonPath: savedSamSettings.pythonPath || "",
        modelPath:
          (result.segmenteverygrainSettings || savedSegSettings).modelPath || "",
      }),
      validatedAt: new Date().toISOString(),
    },
  });
  return {
    ...result,
    segmenteverygrainSettings: settingsWithValidation,
  };
});

ipcMain.handle("run-sam-segmentation", async (event, request) => {
  return runSamSegmentation(request || {});
});

ipcMain.handle("run-segmenteverygrain-segmentation", async (event, request) => {
  return runSegmenteverygrainSegmentation(request || {}, event);
});

ipcMain.handle("cancel-segmenteverygrain-segmentation", async () => {
  if (!activeSegmenteverygrainChild || activeSegmenteverygrainChild.killed) {
    return { ok: true, canceled: false };
  }
  activeSegmenteverygrainChild._petroImageCanceled = true;
  activeSegmenteverygrainChild.kill();
  return { ok: true, canceled: true };
});

ipcMain.handle("select-existing-json-file", async (event, options = {}) => {
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
    const normalization = normalizeLibrarySampleIds(jsonData);
    if (options.persistSampleIds === true && normalization.changed) {
      await writeJsonAtomic(filePath, jsonData);
    }
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

  normalizeLibrarySampleIds(jsonData);
  await writeJsonAtomic(filePath, jsonData);
  await rememberLastLibraryPath(filePath);
  return { ok: true, jsonData };
});

ipcMain.handle("choose-new-library-path", async (event, defaultFileName) => {
  const ownerWindow = BrowserWindow.getFocusedWindow() || mainWindow;
  const settings = await readProjectSettings();
  const { canceled, filePath } = await dialog.showSaveDialog(ownerWindow, {
    title: "Create library JSON",
    defaultPath: path.join(
      settings.projectDirectory || app.getPath("documents"),
      ensureJsonExtension(defaultFileName || USER_LIBRARY_FILE_NAME),
    ),
    filters: [{ name: "JSON Files", extensions: ["json"] }],
  });
  return canceled || !filePath
    ? { canceled: true }
    : { canceled: false, filePath };
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

  normalizeLibrarySampleIds(jsonData);
  await writeJsonAtomic(filePath, jsonData);
  await rememberLastLibraryPath(filePath);
  return {
    canceled: false,
    filePath,
    fileName: path.basename(filePath),
    jsonData,
  };
});

ipcMain.handle("get-local-dzi-tile-source", async (event, dziPath) => {
  return getDziTileSource(event, dziPath);
});

ipcMain.handle("validate-sample-tiles", async (event, tileSets) => {
  return validateSampleTiles(event, tileSets);
});

ipcMain.handle("confirm-slow-tiles", async (event, validationResult) => {
  const ownerWindow =
    BrowserWindow.fromWebContents(event.sender) ||
    BrowserWindow.getFocusedWindow() ||
    mainWindow;
  const checkedCount = validationResult?.checkedCount || 0;
  const issueCount = validationResult?.issues?.length || 0;
  const sampleIssues = (validationResult?.issues || [])
    .slice(0, 5)
    .map((issue) => `- ${issue.file || issue.dziPath}: ${issue.reason}`)
    .join("\n");
  const result = await dialog.showMessageBox(ownerWindow, {
    type: "warning",
    buttons: ["Cancel", "Try Loading Anyway"],
    defaultId: 0,
    cancelId: 0,
    message: "Image Tiles May Not Be Available",
    detail:
      `Some DZI tile files for this sample could not be read quickly from disk.\n\nChecked ${checkedCount} file${checkedCount === 1 ? "" : "s"} and found ${issueCount} issue${issueCount === 1 ? "" : "s"}.\n\n${sampleIssues}\n\nThis often happens when a project is stored in a cloud-synced folder and files are not available offline. Loading may be very slow or the app may become unresponsive.`,
  });

  return result.response === 1;
});

ipcMain.handle("copy-image-to-clipboard", async (event, imageBytes) => {
  if (!imageBytes) throw new Error("No snapshot image was provided.");

  const image = nativeImage.createFromBuffer(Buffer.from(imageBytes));
  if (image.isEmpty()) throw new Error("Could not prepare the snapshot image.");

  clipboard.writeImage(image);
  return true;
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
    message: `Select the project folder, DZI folder, or folder containing ${path.basename(dziPath)} and its _files folder.`,
    defaultPath: path.dirname(dziPath),
    properties: ["openDirectory"],
  });

  if (canceled || !filePaths.length) {
    throw new Error(`Could not access DZI file: ${dziPath}`);
  }

  const selectedRoot = normalizeDziRoot(filePaths[0]);
  rememberLocalRoot(selectedRoot);
  const selectedMatch = await readDziFromRoots([selectedRoot], dziPath);
  if (selectedMatch) {
    return selectedMatch;
  }

  throw new Error(
    `Could not find ${path.basename(dziPath)} in ${selectedRoot}, its ${DZI_FOLDER_NAME} folder, or the matching relative DZI path.`,
  );
}

async function readDziFromCachedRoot(dziPath) {
  return readDziFromRoots(grantedLocalRoots, dziPath);
}

function getDziRelativeCandidates(dziPath) {
  const normalizedPath = dziPath.replace(/\\/g, "/");
  const parts = normalizedPath.split("/").filter(Boolean);
  const basename = path.basename(dziPath);
  const candidates = new Set([basename, path.join(DZI_FOLDER_NAME, basename)]);
  const dziFolderIndex = parts.lastIndexOf(DZI_FOLDER_NAME);

  if (dziFolderIndex !== -1) {
    const tail = parts.slice(dziFolderIndex).join(path.sep);
    const tailInsideDzi = parts.slice(dziFolderIndex + 1).join(path.sep);
    if (tail) candidates.add(tail);
    if (tailInsideDzi) candidates.add(tailInsideDzi);
  }

  return [...candidates];
}

function getDziCandidatePaths(root, dziPath) {
  const candidates = new Set();
  if (path.isAbsolute(dziPath)) {
    candidates.add(dziPath);
  }

  for (const relativeCandidate of getDziRelativeCandidates(dziPath)) {
    candidates.add(path.join(root, relativeCandidate));
  }

  return [...candidates];
}

async function readDziFromRoots(roots, dziPath) {
  for (const root of roots) {
    for (const cachedDziPath of getDziCandidatePaths(root, dziPath)) {
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
  }

  return null;
}

function normalizeDziRoot(selectedPath) {
  return selectedPath.endsWith("_files") ? path.dirname(selectedPath) : selectedPath;
}

function isPathInside(parentPath, childPath) {
  const relativePath = path.relative(parentPath, childPath);
  return (
    relativePath === "" ||
    (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
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
  const dziInfo = parseDziInfo(dziPath, dziXml);

  const parsedPath = path.parse(dziPath);
  const tilesPath = path.join(parsedPath.dir, `${parsedPath.name}_files`);

  return {
    Image: {
      xmlns: "http://schemas.microsoft.com/deepzoom/2008",
      Url: localFileServerUrl(`${tilesPath}${path.sep}`),
      Format: dziInfo.format,
      Overlap: dziInfo.overlap,
      TileSize: dziInfo.tileSize,
      Size: {
        Width: dziInfo.width,
        Height: dziInfo.height,
      },
    },
  };
}

function parseDziInfo(dziPath, dziXml) {
  const imageTag = dziXml.match(/<Image\b([^>]*)>/i);
  const sizeTag = dziXml.match(/<Size\b([^>]*)>/i);

  if (!imageTag || !sizeTag) {
    throw new Error(`Could not parse DZI file: ${path.basename(dziPath)}`);
  }

  return {
    format: getXmlAttribute(imageTag[1], "Format") || "jpg",
    overlap: parseInt(getXmlAttribute(imageTag[1], "Overlap") || "1", 10),
    tileSize: parseInt(getXmlAttribute(imageTag[1], "TileSize") || "254", 10),
    width: parseInt(getXmlAttribute(sizeTag[1], "Width"), 10),
    height: parseInt(getXmlAttribute(sizeTag[1], "Height"), 10),
  };
}

async function buildSegmenteverygrainTileJob(event, tileJob = {}) {
  if (!Array.isArray(tileJob.tiles) || tileJob.tiles.length === 0) {
    throw new Error("No local DZI tile source is available for segmentation.");
  }

  const resolvedTiles = [];
  for (const tile of tileJob.tiles) {
    const resolvedUri = getLocalPathFromTileUri(tile?.uri || "");
    if (!resolvedUri || !/\.dzi$/i.test(resolvedUri)) {
      throw new Error("Python segmentation currently requires local DZI tile sources.");
    }
    const dziPath = await resolveLibraryFilePath(resolvedUri);
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(dziPath)) {
      throw new Error("Python segmentation cannot read remote tile sources.");
    }
    const result = await readDziXmlWithPermissionFallback(event, dziPath);
    const info = parseDziInfo(result.dziPath, result.dziXml);
    resolvedTiles.push({
      dziPath: result.dziPath,
      opacity: Math.max(0, Math.min(1, Number(tile.opacity) || 0)),
      ...info,
    });
  }

  return {
    imageRect: tileJob.imageRect || {},
    outputScale: Math.max(0.05, Math.min(1, Number(tileJob.outputScale) || 1)),
    tiles: resolvedTiles.filter((tile) => tile.opacity > 0),
  };
}

function getLocalPathFromTileUri(uri) {
  if (typeof uri !== "string" || !uri) return "";
  if (/^file:\/\//i.test(uri)) {
    try {
      return decodeURIComponent(new URL(uri).pathname);
    } catch {
      return "";
    }
  }
  if (/^https?:\/\//i.test(uri)) {
    try {
      const parsed = new URL(uri);
      if (
        parsed.hostname !== "127.0.0.1" &&
        parsed.hostname !== "localhost" &&
        parsed.hostname !== "::1"
      ) {
        return "";
      }
      if (parsed.pathname !== "/local-file") return "";
      return parsed.searchParams.get("path") || "";
    } catch {
      return "";
    }
  }
  return uri;
}

async function validateSampleTiles(event, tileSets) {
  const issues = [];
  let checkedCount = 0;
  const tileUris = [
    ...new Set(
      (tileSets || [])
        .flatMap((tileSet) => tileSet.tiles || [])
        .map((tile) => tile.uri)
        .filter((uri) => typeof uri === "string" && /\.dzi$/i.test(uri)),
    ),
  ];

  for (const uri of tileUris) {
    try {
      const dziPath = await resolveLibraryFilePath(uri);
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(dziPath)) continue;

      const result = await readDziXmlWithPermissionFallback(event, dziPath);
      checkedCount += 1;
      const cloudProvider = getCloudProjectProvider(result.dziPath);
      if (cloudProvider) {
        issues.push({
          dziPath: result.dziPath,
          reason:
            `DZI tiles are stored in ${cloudProvider}. Confirm the full tile folder is available offline before loading.`,
        });
        continue;
      }

      const dziInfo = parseDziInfo(result.dziPath, result.dziXml);
      const expectedTiles = getRepresentativeDziTilePaths(result.dziPath, dziInfo);

      for (const file of expectedTiles) {
        checkedCount += 1;
        const issue = await checkReadableQuickly(file);
        if (issue) {
          issues.push({ dziPath: result.dziPath, file, reason: issue });
        }
      }
    } catch (error) {
      issues.push({ dziPath: uri, reason: error.message || "Could not read DZI." });
    }
  }

  return {
    ok: issues.length === 0,
    checkedCount,
    issues,
  };
}

function getRepresentativeDziTilePaths(dziPath, dziInfo) {
  const parsedPath = path.parse(dziPath);
  const tilesPath = path.join(parsedPath.dir, `${parsedPath.name}_files`);
  const maxDimension = Math.max(dziInfo.width, dziInfo.height);
  const level = Math.ceil(Math.log2(maxDimension));
  const columns = Math.max(1, Math.ceil(dziInfo.width / dziInfo.tileSize));
  const rows = Math.max(1, Math.ceil(dziInfo.height / dziInfo.tileSize));
  const columnSamples = sampleTileIndexes(columns);
  const rowSamples = sampleTileIndexes(rows);
  const coordinates = columnSamples.flatMap((column) =>
    rowSamples.map((row) => [column, row]),
  );
  const uniqueCoordinates = Array.from(
    new Set(coordinates.map(([column, row]) => `${column}_${row}`)),
  );

  return uniqueCoordinates.map((coordinate) =>
    path.join(tilesPath, String(level), `${coordinate}.${dziInfo.format}`),
  );
}

function sampleTileIndexes(count) {
  return Array.from(
    new Set([0, Math.floor((count - 1) / 2), count - 1]),
  );
}

async function checkReadableQuickly(filePath, timeoutMs = 1500) {
  try {
    await readFirstChunkQuickly(filePath, timeoutMs);
    return "";
  } catch (error) {
    if (error.message === "Read check timed out.") {
      return `Read check exceeded ${timeoutMs} ms.`;
    }
    if (error.code === "ENOENT") {
      return "File is missing or not available offline.";
    }
    return error.message || "Could not read file quickly.";
  }
}

function readFirstChunkQuickly(filePath, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const stream = createReadStream(filePath, { start: 0, end: 65535 });
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stream.destroy();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const timeout = setTimeout(() => {
      finish(new Error("Read check timed out."));
    }, timeoutMs);

    stream.once("data", () => finish());
    stream.once("end", () => finish());
    stream.once("error", finish);
  });
}

async function resolveLibraryFilePath(filePath) {
  if (typeof filePath === "string") {
    const normalizedPath = filePath.replace(/\\/g, "/");
    const tutorialPrefix = `${TUTORIAL_ASSETS_FOLDER_NAME}/`;
    if (normalizedPath.startsWith(tutorialPrefix)) {
      const tutorialRoot = path.resolve(getBundledTutorialAssetsPath());
      const resolvedTutorialPath = path.resolve(
        tutorialRoot,
        normalizedPath.slice(tutorialPrefix.length),
      );
      if (!isPathInside(tutorialRoot, resolvedTutorialPath)) {
        throw new Error("Tutorial asset path is outside the bundled resource folder.");
      }
      return resolvedTutorialPath;
    }
  }

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

ipcMain.handle("convert-image-to-dzi", async (event, sourcePath) => {
  const settings = await readProjectSettings();
  const outputDirectory = settings.projectDirectory
    ? path.join(settings.projectDirectory, DZI_FOLDER_NAME)
    : path.dirname(sourcePath);
  const onProgress = (progress) => {
    event.sender.send("dzi-conversion-progress", progress);
  };
  let result;
  if (isJpeg2000Path(sourcePath)) {
    if (activeJpeg2000ConversionChild) {
      throw new Error("A JPEG 2000 conversion is already running.");
    }
    const runtime = await getVipsWorkerRuntime();
    try {
      result = await convertJpeg2000ToDzi(sourcePath, onProgress, outputDirectory, {
        command: runtime.command,
        env: runtime.env,
        onChild: (child) => {
          activeJpeg2000ConversionChild = child;
        },
      });
    } finally {
      activeJpeg2000ConversionChild = null;
    }
  } else {
    result = await convertImageToDzi(sourcePath, onProgress, outputDirectory);
  }

  if (settings.projectDirectory) {
    result.relativeDziPath = path.relative(settings.projectDirectory, result.dziPath);
  }

  return result;
});

ipcMain.handle("cancel-image-to-dzi", async () => {
  if (!activeJpeg2000ConversionChild || activeJpeg2000ConversionChild.killed) {
    return { ok: true, canceled: false };
  }
  activeJpeg2000ConversionChild._petroImageCanceled = true;
  activeJpeg2000ConversionChild.kill();
  return { ok: true, canceled: true };
});

ipcMain.handle("create-derived-dzi", async (event, { dataUrl, baseName }) => {
  const settings = await readProjectSettings();
  const outputDirectory = settings.projectDirectory
    ? path.join(settings.projectDirectory, DZI_FOLDER_NAME)
    : app.getPath("documents");
  const match = String(dataUrl || "").match(/^data:image\/png;base64,(.+)$/);

  if (!match) {
    throw new Error("The transformed image was not a PNG data URL.");
  }

  const imageBuffer = Buffer.from(match[1], "base64");
  const result = await convertImageBufferToDzi(
    imageBuffer,
    baseName || "derived-image",
    (progress) => {
      event.sender.send("derived-dzi-progress", progress);
    },
    outputDirectory,
  );

  if (settings.projectDirectory) {
    result.relativeDziPath = path.relative(settings.projectDirectory, result.dziPath);
  }

  return result;
});

ipcMain.handle("delete-project-dzi", async (event, { uris } = {}) => {
  const settings = await readProjectSettings();
  const projectDirectory = settings.projectDirectory;
  if (!projectDirectory) {
    throw new Error("DZI file deletion is only available for project libraries.");
  }

  const projectRoot = path.resolve(projectDirectory);
  const allowedDziRoot = path.resolve(projectRoot, DZI_FOLDER_NAME);
  const uniqueUris = [...new Set(Array.isArray(uris) ? uris : [])];
  const deleted = [];
  const skipped = [];

  for (const uri of uniqueUris) {
    try {
      if (typeof uri !== "string" || !/\.dzi$/i.test(uri)) {
        skipped.push({ uri, reason: "Not a DZI path." });
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) {
        skipped.push({ uri, reason: "Remote DZI paths cannot be deleted." });
        continue;
      }

      const resolvedDziPath = path.resolve(
        path.isAbsolute(uri) ? uri : path.join(projectRoot, uri),
      );
      if (
        !isPathInside(projectRoot, resolvedDziPath) ||
        !isPathInside(allowedDziRoot, resolvedDziPath)
      ) {
        skipped.push({ uri, reason: "DZI path is outside the project dzi folder." });
        continue;
      }

      const parsedPath = path.parse(resolvedDziPath);
      const tilesPath = path.join(parsedPath.dir, `${parsedPath.name}_files`);
      const pathsToTrash = [];

      if (await pathExists(resolvedDziPath)) {
        pathsToTrash.push(resolvedDziPath);
      }
      if (await pathExists(tilesPath)) {
        if (
          !isPathInside(projectRoot, tilesPath) ||
          !isPathInside(allowedDziRoot, tilesPath)
        ) {
          skipped.push({ uri, reason: "Tile folder is outside the project dzi folder." });
          continue;
        }
        pathsToTrash.push(tilesPath);
      }

      if (!pathsToTrash.length) {
        skipped.push({ uri, reason: "DZI file and tile folder were not found." });
        continue;
      }

      for (const targetPath of pathsToTrash) {
        await shell.trashItem(targetPath);
      }
      deleted.push({
        uri,
        paths: pathsToTrash.map((targetPath) => path.relative(projectRoot, targetPath)),
      });
    } catch (error) {
      skipped.push({ uri, reason: error.message || "Could not delete DZI files." });
    }
  }

  return { deleted, skipped };
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
  await createWindow();
});

app.on("before-quit", () => {
  stopSamWorker();
  stopSegmenteverygrainWorker({ force: true });
});
