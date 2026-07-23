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

  global.PetroImageKeyboard = Object.freeze({
    isTextEntryElement,
    isTextEntryActive,
  });
})(typeof window !== "undefined" ? window : globalThis);
