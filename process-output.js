export function tryParseJsonLine(line) {
  const text = String(line);
  try {
    return JSON.parse(text);
  } catch {
    // Recover protocol messages if a third-party library wrote an unterminated
    // stdout message immediately before our JSON payload.
    for (
      let index = text.indexOf("{");
      index >= 0;
      index = text.indexOf("{", index + 1)
    ) {
      try {
        return JSON.parse(text.slice(index));
      } catch {
        // Keep looking for the beginning of the outer JSON object.
      }
    }
    return null;
  }
}

export function parseJsonProcessOutput(stdout) {
  const lines = String(stdout || "")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = tryParseJsonLine(lines[index]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  }

  throw new Error("Process did not write JSON.");
}
