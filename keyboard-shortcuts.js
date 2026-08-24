(function initializePetroImageKeyboard(global) {
  "use strict";

  const TEXT_INPUT_TYPES = new Set([
    "",
    "email",
    "number",
    "password",
    "search",
    "tel",
    "text",
    "url",
  ]);

  function isTextEntryElement(element) {
    if (!element) return false;
    if (element.isContentEditable) return true;

    const tagName = String(element.tagName || "").toUpperCase();
    if (tagName === "TEXTAREA" || tagName === "SELECT") return true;
    if (tagName !== "INPUT") return false;
    return TEXT_INPUT_TYPES.has(String(element.type || "").toLowerCase());
  }

  function isTextEntryActive(event, documentObject = global.document) {
    return (
      isTextEntryElement(event?.target) ||
      isTextEntryElement(documentObject?.activeElement)
    );
  }

  function isPolyVertexInputActive(state = {}) {
    if (state.polylineMode || state.polygonMode) return true;
    if (state.activeDraftMode === "polyline") {
      return Boolean(state.polylineShortcutPressed);
    }
    if (state.activeDraftMode === "polygon") {
      return Boolean(state.polygonShortcutPressed);
    }
    return Boolean(
      state.polylineShortcutPressed || state.polygonShortcutPressed,
    );
  }

  function getAnnotationDraftKeyAction(state = {}) {
    if (
      state.defaultPrevented ||
      state.textEntryActive ||
      state.ctrlKey ||
      state.metaKey ||
      state.altKey
    ) {
      return null;
    }
    if (state.key === "Backspace" && state.hasDraftUndo) return "undo";
    if (state.key === "Enter" && state.polyDraftActive) return "finish";
    return null;
  }

  function isMacPlatform(navigatorObject = global.navigator) {
    const platform = String(
      navigatorObject?.userAgentData?.platform ||
        navigatorObject?.platform ||
        navigatorObject?.userAgent ||
        "",
    );
    return /Mac|iPhone|iPad|iPod/i.test(platform);
  }

  function isAnnotationDeleteKey(state = {}) {
    if (state.key === "Delete") return true;
    return (
      state.key === "Backspace" &&
      Boolean(state.isMac) &&
      !state.hasDraftUndo
    );
  }

  global.PetroImageKeyboard = Object.freeze({
    isTextEntryElement,
    isTextEntryActive,
    isPolyVertexInputActive,
    getAnnotationDraftKeyAction,
    isMacPlatform,
    isAnnotationDeleteKey,
  });
})(typeof window !== "undefined" ? window : globalThis);
