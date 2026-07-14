const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "mobile-mode.js"),
  "utf8",
);

function loadModeApi(browser = {}) {
  const classNames = new Set();
  const window = {
    location: { search: "" },
    screen: { width: 1440, height: 900 },
    matchMedia: () => ({ matches: false }),
    document: {
      documentElement: {
        classList: {
          toggle(name, enabled) {
            if (enabled) classNames.add(name);
            else classNames.delete(name);
          },
        },
        dataset: {},
      },
    },
    ...browser,
  };
  vm.runInNewContext(source, { window, globalThis: window });
  return { api: window.PetroImageMode, window, classNames };
}

test("view query parameter explicitly selects mobile or desktop mode", () => {
  const { api } = loadModeApi();
  assert.equal(api.resolveMobileMode({ search: "?view=mobile" }), true);
  assert.equal(
    api.resolveMobileMode({
      search: "?view=desktop",
      coarsePointer: true,
      screenWidth: 390,
      screenHeight: 844,
    }),
    false,
  );
});

test("automatic mode recognizes phone-sized coarse-pointer web devices", () => {
  const { api } = loadModeApi();
  assert.equal(
    api.resolveMobileMode({
      coarsePointer: true,
      screenWidth: 390,
      screenHeight: 844,
    }),
    true,
  );
  assert.equal(
    api.resolveMobileMode({
      coarsePointer: true,
      screenWidth: 768,
      screenHeight: 1024,
    }),
    false,
  );
  assert.equal(
    api.resolveMobileMode({
      coarsePointer: false,
      screenWidth: 390,
      screenHeight: 844,
    }),
    false,
  );
});

test("automatic mobile mode does not replace the Electron interface", () => {
  const { api } = loadModeApi();
  assert.equal(
    api.resolveMobileMode({
      hasElectronApi: true,
      coarsePointer: true,
      screenWidth: 390,
      screenHeight: 844,
    }),
    false,
  );
});

test("startup applies the mobile class for the desktop test override", () => {
  const { window, classNames } = loadModeApi({
    location: { search: "?view=mobile" },
  });
  assert.equal(window.__PETRO_IMAGE_MOBILE_MODE__, true);
  assert.equal(window.document.documentElement.dataset.viewMode, "mobile");
  assert.equal(classNames.has("mobile-view"), true);
});
