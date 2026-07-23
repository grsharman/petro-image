const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "keyboard-shortcuts.js"),
  "utf8",
);

function loadKeyboardApi(activeElement = null) {
  const window = { document: { activeElement } };
  vm.runInNewContext(source, { window, globalThis: window });
  return { api: window.PetroImageKeyboard, window };
}

function element(tagName, type = "") {
  return { tagName, type, isContentEditable: false };
}

test("annotation shortcuts are blocked for text-entry controls", () => {
  const textControls = [
    element("INPUT", "text"),
    element("INPUT", "number"),
    element("TEXTAREA"),
    element("SELECT"),
    { tagName: "DIV", isContentEditable: true },
  ];

  for (const control of textControls) {
    const { api } = loadKeyboardApi(control);
    assert.equal(api.isTextEntryElement(control), true);
    assert.equal(api.isTextEntryActive({ target: control }), true);
  }
});

test("focused text input blocks shortcuts even when the event target differs", () => {
  const activeInput = element("INPUT", "text");
  const { api, window } = loadKeyboardApi(activeInput);

  assert.equal(
    api.isTextEntryActive(
      { target: element("DIV") },
      window.document,
    ),
    true,
  );
});

test("non-text controls do not block annotation shortcuts", () => {
  const button = element("BUTTON");
  const checkbox = element("INPUT", "checkbox");
  const { api, window } = loadKeyboardApi(button);

  assert.equal(api.isTextEntryActive({ target: button }, window.document), false);
  assert.equal(api.isTextEntryElement(checkbox), false);
});
