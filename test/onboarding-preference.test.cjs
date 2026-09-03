const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "index.js"),
  "utf8",
);

function extractFunction(name) {
  const functionStart = source.indexOf(`function ${name}(`);
  assert.notEqual(functionStart, -1, `${name} should exist`);
  const start = source.slice(functionStart - 6, functionStart) === "async "
    ? functionStart - 6
    : functionStart;
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function loadPreferenceApi(initialEntries = []) {
  const entries = new Map(initialEntries);
  const context = {
    ONBOARDING_STORAGE_KEY: "petro-image:onboarding:v1",
    dontShowWelcomeAgain: { checked: false },
    window: {},
    localStorage: {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, value),
      removeItem: (key) => entries.delete(key),
    },
    console,
  };
  vm.runInNewContext(
    `${extractFunction("getLocalOnboardingPreference")}\n` +
      `${extractFunction("getOnboardingPreference")}\n` +
      `${extractFunction("saveOnboardingPreference")}\n` +
      "this.preferenceApi = { getOnboardingPreference, saveOnboardingPreference };",
    context,
  );
  return { api: context.preferenceApi, context, entries };
}

test("checking the welcome opt-out persists it immediately", async () => {
  const { api, entries } = loadPreferenceApi();

  await api.saveOnboardingPreference(true);

  assert.equal((await api.getOnboardingPreference())?.dismissed, true);
  assert.equal(
    entries.get("petro-image:onboarding:v1"),
    JSON.stringify({ dismissed: true }),
  );
  assert.match(
    source,
    /dontShowWelcomeAgain\?\.addEventListener\("change", function \(\) \{\s*saveOnboardingPreference\(this\.checked\);/,
  );
});

test("unchecking the welcome opt-out removes the preference", async () => {
  const key = "petro-image:onboarding:v1";
  const { api, entries } = loadPreferenceApi([
    [key, JSON.stringify({ dismissed: true })],
  ]);

  await api.saveOnboardingPreference(false);

  assert.equal(entries.has(key), false);
  assert.equal(await api.getOnboardingPreference(), null);
});

test("Electron onboarding settings take precedence over local storage", async () => {
  const { api, context } = loadPreferenceApi([
    ["petro-image:onboarding:v1", JSON.stringify({ dismissed: false })],
  ]);
  const saved = [];
  context.window.electronAPI = {
    getOnboardingPreference: async () => ({ dismissed: true }),
    setOnboardingPreference: async (dismissed) => saved.push(dismissed),
  };

  assert.equal((await api.getOnboardingPreference()).dismissed, true);
  await api.saveOnboardingPreference(true);
  assert.deepEqual(saved, [true]);
});

test("an unset Electron preference falls back to the existing browser choice", async () => {
  const { api, context } = loadPreferenceApi([
    ["petro-image:onboarding:v1", JSON.stringify({ dismissed: true })],
  ]);
  context.window.electronAPI = {
    getOnboardingPreference: async () => ({ dismissed: null }),
  };

  assert.equal((await api.getOnboardingPreference()).dismissed, true);
});
