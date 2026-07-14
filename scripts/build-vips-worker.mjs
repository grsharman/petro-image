import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const environmentDirectory = path.join(projectDirectory, ".vips-worker-build");
const outputDirectory = path.join(projectDirectory, "build", "vips-worker");
const LIBVIPS_VERSION = "8.18.4";
const OPENJPEG_VERSION = "2.5.4";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectDirectory,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(
      `${path.basename(command)} exited with status ${result.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  return String(result.stdout || "").trim();
}

function findConda() {
  const candidates = [
    process.env.PETRO_IMAGE_CONDA,
    process.env.CONDA_EXE,
    path.join(os.homedir(), "miniconda3", "bin", "conda"),
    path.join(os.homedir(), "anaconda3", "bin", "conda"),
    process.platform === "win32"
      ? path.join(os.homedir(), "miniconda3", "Scripts", "conda.exe")
      : "conda",
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === "conda" || fs.existsSync(candidate));
}

function prepareEnvironment(conda) {
  const historyPath = path.join(environmentDirectory, "conda-meta", "history");
  if (fs.existsSync(historyPath)) {
    console.log("Reusing the pinned libvips build environment");
    return;
  }
  if (fs.existsSync(environmentDirectory) && !fs.existsSync(historyPath)) {
    console.log("Removing an incomplete libvips build environment");
    fs.rmSync(environmentDirectory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
  console.log(
    `Preparing libvips ${LIBVIPS_VERSION} with OpenJPEG ${OPENJPEG_VERSION}`,
  );
  run(conda, [
    "create",
    "--yes",
    "--prefix",
    environmentDirectory,
    "--override-channels",
    "--channel",
    "conda-forge",
    `libvips=${LIBVIPS_VERSION}`,
    `openjpeg=${OPENJPEG_VERSION}`,
  ]);
}

function copyRuntime() {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(path.join(outputDirectory, "bin"), { recursive: true });

  if (process.platform === "win32") {
    const sourceBin = path.join(environmentDirectory, "Library", "bin");
    fs.cpSync(sourceBin, path.join(outputDirectory, "bin"), {
      recursive: true,
      filter: (source) => !/\.(pdb|lib)$/i.test(source),
    });
    return;
  }

  fs.copyFileSync(
    path.join(environmentDirectory, "bin", "vips"),
    path.join(outputDirectory, "bin", "vips"),
  );
  fs.chmodSync(path.join(outputDirectory, "bin", "vips"), 0o755);
  if (process.platform === "darwin") {
    copyMacRuntimeDependencies();
    relocateMacLibraries();
  } else {
    fs.cpSync(
      path.join(environmentDirectory, "lib"),
      path.join(outputDirectory, "lib"),
      {
        recursive: true,
        filter: (source) =>
          !/\.(a|la)$/i.test(source) &&
          !/(?:^|\/)(?:cmake|pkgconfig)(?:\/|$)/i.test(source),
      },
    );
  }
}

function copyMacRuntimeDependencies() {
  const sourceExecutable = path.join(environmentDirectory, "bin", "vips");
  const queue = [sourceExecutable];
  const visited = new Set();
  fs.mkdirSync(path.join(outputDirectory, "lib"), { recursive: true });

  while (queue.length) {
    const source = queue.shift();
    const canonicalSource = fs.realpathSync(source);
    if (visited.has(canonicalSource)) continue;
    visited.add(canonicalSource);

    const dependencies = run("otool", ["-L", source], { capture: true })
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().split(/\s+\(/)[0])
      .filter(Boolean);
    for (const dependency of dependencies) {
      const resolved = resolveMacDependency(source, dependency);
      if (!resolved || !fs.existsSync(resolved)) continue;
      const destination = path.join(outputDirectory, "lib", path.basename(dependency));
      if (!fs.existsSync(destination)) {
        fs.copyFileSync(fs.realpathSync(resolved), destination);
      }
      queue.push(resolved);
    }
  }
}

function resolveMacDependency(source, dependency) {
  if (dependency.startsWith(environmentDirectory)) return dependency;
  if (dependency.startsWith("@rpath/")) {
    return path.join(environmentDirectory, "lib", dependency.slice(7));
  }
  if (dependency.startsWith("@loader_path/")) {
    const candidate = path.resolve(path.dirname(source), dependency.slice(13));
    return candidate.startsWith(environmentDirectory) ? candidate : "";
  }
  return "";
}

function relocateMacLibraries() {
  const runtimeFiles = listFiles(outputDirectory).filter((filePath) => {
    const output = run("file", [filePath], { capture: true });
    return /Mach-O/.test(output);
  });

  for (const target of runtimeFiles) {
    const dependencies = run("otool", ["-L", target], { capture: true })
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().split(/\s+\(/)[0])
      .filter(Boolean);
    for (const dependency of dependencies) {
      if (!dependency.startsWith(environmentDirectory)) continue;
      const relativeDependency = path.relative(environmentDirectory, dependency);
      const bundledDependency = path.join(outputDirectory, relativeDependency);
      const loaderRelative = path.relative(path.dirname(target), bundledDependency);
      run("install_name_tool", [
        "-change",
        dependency,
        `@loader_path/${loaderRelative}`,
        target,
      ]);
    }
    if (/\.dylib$/i.test(target)) {
      run("install_name_tool", ["-id", `@rpath/${path.basename(target)}`, target]);
    }
  }

  for (const target of runtimeFiles) {
    run("codesign", ["--force", "--sign", "-", "--timestamp=none", target]);
  }
}

function copyLicenses(conda) {
  const licenseDirectory = path.join(outputDirectory, "THIRD_PARTY_LICENSES");
  fs.mkdirSync(licenseDirectory, { recursive: true });
  const condaInfo = JSON.parse(run(conda, ["info", "--json"], { capture: true }));
  const packageDirectories = condaInfo.pkgs_dirs || [];
  const dependencies = [];

  for (const metadataPath of listFiles(path.join(environmentDirectory, "conda-meta"))) {
    if (!metadataPath.endsWith(".json")) continue;
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    dependencies.push({
      name: metadata.name,
      version: metadata.version,
      build: metadata.build,
      license: metadata.license || "unknown",
      channel: metadata.channel || metadata.url || "",
    });
    const packageName = `${metadata.name}-${metadata.version}-${metadata.build}`;
    const extractedPackage = packageDirectories
      .map((directory) => path.join(directory, packageName))
      .find((directory) => fs.existsSync(directory));
    const destination = path.join(licenseDirectory, packageName);
    fs.mkdirSync(destination, { recursive: true });
    fs.copyFileSync(metadataPath, path.join(destination, "conda-metadata.json"));
    const sourceLicenses = extractedPackage
      ? path.join(extractedPackage, "info", "licenses")
      : "";
    if (sourceLicenses && fs.existsSync(sourceLicenses)) {
      fs.cpSync(sourceLicenses, path.join(destination, "licenses"), {
        recursive: true,
      });
    }
  }
  return dependencies.sort((left, right) => left.name.localeCompare(right.name));
}

function validateRuntime() {
  const executable = path.join(
    outputDirectory,
    "bin",
    process.platform === "win32" ? "vips.exe" : "vips",
  );
  const env = runtimeEnvironment();
  const version = run(executable, ["--version"], { capture: true, env });
  const operation = run(executable, ["-l"], {
    capture: true,
    env,
  });
  if (!/jp2kload/i.test(operation)) {
    throw new Error("The staged libvips runtime does not provide jp2kload.");
  }
  return version;
}

function runtimeEnvironment() {
  const libraryDirectory = path.join(outputDirectory, "lib");
  if (process.platform === "darwin") {
    return { DYLD_LIBRARY_PATH: libraryDirectory };
  }
  if (process.platform === "linux") {
    return { LD_LIBRARY_PATH: libraryDirectory };
  }
  return { PATH: [path.join(outputDirectory, "bin"), process.env.PATH].join(path.delimiter) };
}

function listFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function main() {
  const conda = findConda();
  if (!conda) {
    throw new Error(
      "Conda was not found. Set PETRO_IMAGE_CONDA to a conda executable.",
    );
  }
  prepareEnvironment(conda);
  copyRuntime();
  const dependencies = copyLicenses(conda);
  const vipsVersion = validateRuntime();
  const manifest = {
    format: 1,
    platform: process.platform,
    architecture: process.arch,
    executable: `bin/${process.platform === "win32" ? "vips.exe" : "vips"}`,
    vipsVersion,
    requiredOperations: ["jp2kload", "dzsave"],
    dependencies,
  };
  fs.writeFileSync(
    path.join(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(`JPEG 2000 worker ready: ${outputDirectory}`);
}

try {
  main();
} catch (error) {
  console.error(`JPEG 2000 worker build failed: ${error.message}`);
  process.exitCode = 1;
}
