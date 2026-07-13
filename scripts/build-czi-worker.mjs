import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const requirementsPath = path.join(
  scriptDirectory,
  "czi-worker-requirements.txt",
);
const workerSource = path.join(scriptDirectory, "axioscan_czi_worker.py");
const venvDirectory = path.join(projectDirectory, ".venv-czi-build");
const outputDirectory = path.join(projectDirectory, "build", "czi-worker");
const workDirectory = path.join(projectDirectory, "build", "czi-worker-work");
const specDirectory = path.join(projectDirectory, "build", "czi-worker-spec");
const cacheDirectory = path.join(projectDirectory, "build", "czi-worker-cache");
const executableName =
  process.platform === "win32"
    ? "axioscan-czi-worker.exe"
    : "axioscan-czi-worker";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectDirectory,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture
      ? String(result.stderr || result.stdout || "").trim()
      : "";
    throw new Error(
      `${path.basename(command)} exited with status ${result.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  return String(result.stdout || "").trim();
}

function getVenvPython() {
  return process.platform === "win32"
    ? path.join(venvDirectory, "Scripts", "python.exe")
    : path.join(venvDirectory, "bin", "python");
}

function preparePython() {
  const configuredPython =
    process.env.PETRO_IMAGE_CZI_BUILD_PYTHON ||
    process.env.PETRO_IMAGE_CZI_PYTHON;
  if (configuredPython) return configuredPython;

  const venvPython = getVenvPython();
  if (!fs.existsSync(venvPython)) {
    const bootstrapPython = process.platform === "win32" ? "python" : "python3";
    console.log(`Creating CZI build environment at ${venvDirectory}`);
    run(bootstrapPython, ["-m", "venv", venvDirectory]);
  }
  console.log("Installing pinned CZI worker build dependencies");
  run(venvPython, [
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "-r",
    requirementsPath,
  ]);
  return venvPython;
}

function copyDependencyLicenses(pythonPath, destination) {
  const licenseQuery = String.raw`
import importlib.metadata
import json

names = ["pylibCZIrw", "numpy", "Pillow", "PyInstaller", "pyinstaller-hooks-contrib"]
result = {}
for name in names:
    distribution = importlib.metadata.distribution(name)
    files = []
    for item in distribution.files or []:
        text = str(item).lower()
        if any(marker in text for marker in ("license", "copying", "notice")):
            source = distribution.locate_file(item)
            if source.is_file():
                files.append(str(source))
    result[name] = {"version": distribution.version, "files": files}
print(json.dumps(result))
`;
  const distributions = JSON.parse(
    run(pythonPath, ["-c", licenseQuery], { capture: true }),
  );
  const licenseDirectory = path.join(destination, "THIRD_PARTY_LICENSES");
  fs.mkdirSync(licenseDirectory, { recursive: true });
  const versions = {};
  for (const [name, metadata] of Object.entries(distributions)) {
    versions[name] = metadata.version;
    const packageDirectory = path.join(licenseDirectory, name);
    fs.mkdirSync(packageDirectory, { recursive: true });
    for (const [index, source] of metadata.files.entries()) {
      const targetName = `${String(index + 1).padStart(2, "0")}-${path.basename(source)}`;
      fs.copyFileSync(source, path.join(packageDirectory, targetName));
    }
  }
  return versions;
}

function main() {
  const pythonPath = preparePython();
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.mkdirSync(workDirectory, { recursive: true });
  fs.mkdirSync(specDirectory, { recursive: true });
  fs.mkdirSync(cacheDirectory, { recursive: true });

  console.log(`Building one-folder CZI worker with ${pythonPath}`);
  run(
    pythonPath,
    [
      "-m",
      "PyInstaller",
      "--noconfirm",
      "--clean",
      "--onedir",
      "--console",
      "--name",
      "axioscan-czi-worker",
      "--distpath",
      outputDirectory,
      "--workpath",
      workDirectory,
      "--specpath",
      specDirectory,
      "--collect-all",
      "pylibCZIrw",
      workerSource,
    ],
    { env: { PYINSTALLER_CONFIG_DIR: cacheDirectory } },
  );

  const bundleDirectory = path.join(outputDirectory, "axioscan-czi-worker");
  const executablePath = path.join(bundleDirectory, executableName);
  if (!fs.existsSync(executablePath)) {
    throw new Error(`CZI worker executable was not created: ${executablePath}`);
  }
  run(executablePath, ["--help"], { capture: true });
  const dependencies = copyDependencyLicenses(pythonPath, bundleDirectory);
  const manifest = {
    format: 1,
    platform: process.platform,
    architecture: process.arch,
    executable: `axioscan-czi-worker/${executableName}`,
    dependencies,
  };
  fs.writeFileSync(
    path.join(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(`CZI worker ready: ${executablePath}`);
}

try {
  main();
} catch (error) {
  console.error(`CZI worker build failed: ${error.message}`);
  process.exitCode = 1;
}
