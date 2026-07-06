import { app, BrowserWindow, ipcMain, dialog, screen } from "electron";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs/promises";
import { createReadStream } from "fs";
import { spawn } from "child_process";
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
let samWorker = null;
let activeSegmenteverygrainChild = null;
const localFileServerToken = randomUUID();
const grantedLocalRoots = [];
const APP_TITLE = "petro-image";
const WELCOME_LIBRARY_FILE_NAME = "welcome_library.json";
const USER_LIBRARY_FILE_NAME = "library.json";
const DZI_FOLDER_NAME = "dzi";
const SEGMENTEVERYGRAIN_MODEL_EXTENSIONS = new Set([".h5", ".keras"]);

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

function getBundledWelcomeLibraryPath() {
  return path.join(__dirname, WELCOME_LIBRARY_FILE_NAME);
}

async function ensureProjectStructure(projectDirectory) {
  await fs.mkdir(projectDirectory, { recursive: true });
  await fs.mkdir(path.join(projectDirectory, DZI_FOLDER_NAME), { recursive: true });

  const welcomeLibraryPath = path.join(projectDirectory, WELCOME_LIBRARY_FILE_NAME);
  if (!(await pathExists(welcomeLibraryPath))) {
    const welcomeLibraryText = await fs.readFile(
      getBundledWelcomeLibraryPath(),
      "utf8",
    );
    await fs.writeFile(welcomeLibraryPath, welcomeLibraryText, "utf8");
  }

  return welcomeLibraryPath;
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
    path.join(projectDirectory, WELCOME_LIBRARY_FILE_NAME);
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

function parseJsonProcessOutput(stdout) {
  const lines = String(stdout || "")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const jsonLine = [...lines].reverse().find((line) => line.startsWith("{"));
  if (!jsonLine) {
    throw new Error("Process did not write JSON.");
  }
  return JSON.parse(jsonLine);
}

function tryParseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
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

const SEGMENTEVERYGRAIN_PROBE_SCRIPT = String.raw`
import importlib
import importlib.util
import json
import os
import sys
import traceback

model_path = sys.argv[1] if len(sys.argv) > 1 else ""

result = {
    "ok": False,
    "pythonExecutable": sys.executable,
    "pythonVersion": sys.version.split()[0],
    "modelPath": model_path,
    "modelExists": False,
    "modelSizeBytes": None,
    "modules": {},
    "errors": [],
    "warnings": [],
}

def add_module(name, import_name=None, required=False):
    import_name = import_name or name
    available = importlib.util.find_spec(import_name) is not None
    module_result = {"available": available}
    result["modules"][name] = module_result
    if available:
        try:
            module = importlib.import_module(import_name)
            version = getattr(module, "__version__", "")
            if version:
                module_result["version"] = version
        except Exception as error:
            module_result["available"] = False
            module_result["importError"] = str(error)
            if required:
                result["errors"].append(f"{name} import failed: {error}")
            else:
                result["warnings"].append(f"{name} import failed: {error}")
            return False
    elif required:
        result["errors"].append(f"{name} is not importable.")
    return available and module_result.get("available", False)

try:
    if model_path:
        result["modelExists"] = os.path.isfile(model_path)
        if result["modelExists"]:
            result["modelSizeBytes"] = os.path.getsize(model_path)
        else:
            result["errors"].append("segmenteverygrain model file was not found.")
    else:
        result["errors"].append("No segmenteverygrain model path was provided.")
    if model_path and os.path.splitext(model_path)[1].lower() not in [".h5", ".keras"]:
        result["errors"].append("segmenteverygrain model must be a .h5 or .keras file.")
    seg_available = add_module("segmenteverygrain", required=True)
    add_module("tensorflow")
    add_module("torch")
    add_module("opencv-python", "cv2")
    add_module("scikit-image", "skimage")
    result["ok"] = (
        seg_available
        and result["modelExists"]
        and os.path.splitext(model_path)[1].lower() in [".h5", ".keras"]
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
    { timeoutMs: 120000 },
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
    ["-c", SEGMENTEVERYGRAIN_PROBE_SCRIPT, segSettings.modelPath],
    { timeoutMs: 60000 },
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
    return {
      ok: false,
      errors: ["Python did not return valid segmenteverygrain validation JSON."],
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

  const scriptPath = path.join(__dirname, "scripts", "sam2_worker.py");
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
    const message = `SAM worker exited${exitCode === null ? "" : ` with code ${exitCode}`}.`;
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
  const scriptPath = path.join(__dirname, "scripts", "segmenteverygrain_segment.py");

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
    const args = [
      scriptPath,
      "--model",
      segSettings.modelPath,
      "--simplify-epsilon",
      String(Number(request.simplifyEpsilon) || 0),
      "--min-area",
      String(Number(request.minArea) || 50),
      "--patch-size",
      String(Number(request.patchSize) || 2000),
      "--overlap",
      String(Number(request.overlap) || 300),
      "--dilation",
      String(Number(request.dilation) || 0),
    ];
    if (tileJobPath) {
      args.push("--tile-job", tileJobPath, "--stitch-output", cropPath);
    } else {
      args.push("--image", cropPath);
    }
    if (request.useSam !== false) {
      args.push(
        "--use-sam",
        "--sam-checkpoint",
        samSettings.checkpointPath,
        "--sam-model-type",
        samSettings.modelType || "base_plus",
        "--device",
        request.device || "auto",
      );
    }
    if (request.removeEdgeGrains) {
      args.push("--remove-edge-grains");
    }

    let lastSegmenteverygrainProgressAt = Date.now();
    const sendProgress = (payload, options = {}) => {
      if (!options.heartbeat) {
        lastSegmenteverygrainProgressAt = Date.now();
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
          message: `segmenteverygrain is still running... ${elapsedLabel} elapsed`,
        },
        { heartbeat: true },
      );
    }, 5000);
    let result;
    try {
      result = await runProcessWithProgress(samSettings.pythonPath, args, {
        timeoutMs: 30 * 60 * 1000,
        env: {
          MPLCONFIGDIR: tempDirectory,
          TF_CPP_MIN_LOG_LEVEL: "2",
        },
        onStdoutLine: (line) => {
          const parsed = tryParseJsonLine(line);
          if (parsed?.type === "progress") {
            sendProgress(parsed);
          }
        },
        onStderrLine: (line) => {
          const progress = parseSegmenteverygrainTextProgress(line);
          if (progress) sendProgress(progress);
        },
        onChild: (child) => {
          activeSegmenteverygrainChild = child;
        },
      });
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

    let parsed;
    try {
      parsed = parseJsonProcessOutput(result.stdout);
    } catch (error) {
      return {
        ok: false,
        error: "Python did not return valid segmenteverygrain JSON.",
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }

    return {
      ...parsed,
      exitCode: result.exitCode,
      stderr: result.stderr,
    };
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

ipcMain.handle("show-tile-load-warning", async (event, failure) => {
  const settings = await readProjectSettings();
  if (settings.suppressTileLoadWarning) {
    return { suppressed: true };
  }
  const ownerWindow =
    BrowserWindow.fromWebContents(event.sender) ||
    BrowserWindow.getFocusedWindow() ||
    mainWindow;
  const context = getTileLoadFailureContext(failure);
  const result = await dialog.showMessageBox(ownerWindow, {
    type: "info",
    buttons: ["OK", "Do Not Show Again"],
    defaultId: 0,
    cancelId: 0,
    message: context.message,
    detail: context.detail,
  });
  if (result.response === 1) {
    await writeProjectSettings({
      ...settings,
      suppressTileLoadWarning: true,
    });
  }
  return { suppressed: false, dontShowAgain: result.response === 1 };
});

function getTileLoadFailureContext(failure = {}) {
  const location = failure.tilePath || failure.tileUrl || "";
  const sample = failure.sampleTitle || "the selected sample";
  const requestMessage = failure.message || "One tile request failed.";
  const isRemote =
    typeof failure.tileUrl === "string" &&
    /^[a-z][a-z0-9+.-]*:\/\//i.test(failure.tileUrl) &&
    !/^https?:\/\/(127\.0\.0\.1|localhost|\[?::1\]?)([:/]|$)/i.test(
      failure.tileUrl
    );
  const cloudProvider = failure.tilePath
    ? getCloudProjectProvider(failure.tilePath)
    : "";

  if (isRemote) {
    return {
      message: "Some Web Image Tiles Did Not Load",
      detail:
        `petro-image could not load one or more web-hosted DZI image tiles for ${sample}.\n\n${location}\n\n${requestMessage}\n\nThis is usually a temporary network or hosting issue. The app can continue working, although parts of the image may appear blank until tiles load successfully.`,
    };
  }

  if (cloudProvider) {
    return {
      message: "Some Local Image Tiles Did Not Load",
      detail:
        `petro-image could not load one or more local DZI image tiles for ${sample}.\n\n${location}\n\n${requestMessage}\n\nThis path appears to be inside ${cloudProvider}. If tiles are stored in a cloud-synced folder, mark the project folder as available offline or move the project to local storage for more reliable loading.`,
    };
  }

  return {
    message: "Some Image Tiles Did Not Load",
    detail:
      `petro-image could not load one or more DZI image tiles for ${sample}.\n\n${location}\n\n${requestMessage}\n\nThe app can continue working, although parts of the image may appear blank until the missing tiles load successfully.`,
  };
}

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
  const tileUris = (tileSets || [])
    .flatMap((tileSet) => tileSet.tiles || [])
    .map((tile) => tile.uri)
    .filter((uri) => typeof uri === "string" && /\.dzi$/i.test(uri));

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

app.on("before-quit", () => {
  stopSamWorker();
});
