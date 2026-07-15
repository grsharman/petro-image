import path from "path";

export function buildPythonProcessEnv(
  pythonPath,
  overrides = {},
  { platform = process.platform, baseEnv = process.env } = {},
) {
  const env = { ...baseEnv, ...overrides };
  if (platform !== "win32" || !pythonPath) return env;

  const pythonDirectory = path.win32.dirname(pythonPath);
  const pathKeys = Object.keys(env).filter(
    (key) => key.toLowerCase() === "path",
  );
  const pathKey = pathKeys.at(-1) || "PATH";
  const existingPath = pathKeys
    .map((key) => env[key])
    .filter(Boolean)
    .join(";");
  pathKeys.forEach((key) => {
    if (key !== pathKey) delete env[key];
  });

  const condaPaths = [
    pythonDirectory,
    path.win32.join(pythonDirectory, "Library", "mingw-w64", "bin"),
    path.win32.join(pythonDirectory, "Library", "usr", "bin"),
    path.win32.join(pythonDirectory, "Library", "bin"),
    path.win32.join(pythonDirectory, "Scripts"),
    path.win32.join(pythonDirectory, "bin"),
  ];
  const seen = new Set();
  env[pathKey] = [...condaPaths, ...existingPath.split(";")]
    .map((entry) => entry.trim())
    .filter((entry) => {
      if (!entry) return false;
      const key = entry.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(";");

  return env;
}
