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

test("poly vertices require an active toolbar mode or held shortcut", () => {
  const { api } = loadKeyboardApi();

  assert.equal(api.isPolyVertexInputActive({}), false);
  assert.equal(
    api.isPolyVertexInputActive({ polygonShortcutPressed: true }),
    true,
  );
  assert.equal(api.isPolyVertexInputActive({ polylineMode: true }), true);
  assert.equal(
    api.isPolyVertexInputActive({
      polygonMode: false,
      polygonShortcutPressed: false,
      activeDraftMode: "polygon",
    }),
    false,
  );
  assert.equal(
    api.isPolyVertexInputActive({
      polylineShortcutPressed: true,
      polygonShortcutPressed: false,
      activeDraftMode: "polygon",
    }),
    false,
  );
});

test("Backspace undoes a draft point while Delete remains unassigned", () => {
  const { api } = loadKeyboardApi();
  assert.equal(
    api.getAnnotationDraftKeyAction({
      key: "Backspace",
      hasDraftUndo: true,
    }),
    "undo",
  );
  assert.equal(
    api.getAnnotationDraftKeyAction({ key: "Delete", hasDraftUndo: true }),
    null,
  );
});

test("Enter finishes only an active poly draft", () => {
  const { api } = loadKeyboardApi();
  assert.equal(
    api.getAnnotationDraftKeyAction({ key: "Enter", polyDraftActive: true }),
    "finish",
  );
  assert.equal(api.getAnnotationDraftKeyAction({ key: "Enter" }), null);
  assert.equal(
    api.getAnnotationDraftKeyAction({
      key: "Enter",
      polyDraftActive: true,
      textEntryActive: true,
    }),
    null,
  );
});

test("the Mac Delete key deletes completed annotations but preserves draft undo", () => {
  const { api } = loadKeyboardApi();
  assert.equal(api.isMacPlatform({ platform: "MacIntel" }), true);
  assert.equal(api.isMacPlatform({ platform: "Win32" }), false);
  assert.equal(
    api.isAnnotationDeleteKey({ key: "Backspace", isMac: true }),
    true,
  );
  assert.equal(
    api.isAnnotationDeleteKey({
      key: "Backspace",
      isMac: true,
      hasDraftUndo: true,
    }),
    false,
  );
  assert.equal(
    api.isAnnotationDeleteKey({ key: "Backspace", isMac: false }),
    false,
  );
  assert.equal(api.isAnnotationDeleteKey({ key: "Delete" }), true);
});
