(function initializePetroImageEmbedApi(global) {
  "use strict";

  const SOURCE = "petro-image-host";
  const VERSION = 1;
  const COMMANDS = Object.freeze([
    "viewer.setAnnotations",
    "viewer.setViewport",
    "viewer.focusAnnotation",
    "viewer.resetViewport",
  ]);

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function validateEnvelope(event, options = {}) {
    const parentWindow = options.parentWindow || global.parent;
    const parentOrigin = options.parentOrigin || null;
    if (!parentOrigin || event?.source !== parentWindow || event?.origin !== parentOrigin) {
      return { ok: false, ignored: true, code: "untrusted_sender" };
    }

    const message = event.data;
    if (!isObject(message) || message.source !== SOURCE) {
      return { ok: false, ignored: true, code: "invalid_source" };
    }
    if (message.version !== VERSION) {
      return {
        ok: false,
        ignored: false,
        code: "unsupported_version",
        message: `Unsupported embed API version: ${String(message.version)}`,
      };
    }
    if (!COMMANDS.includes(message.type)) {
      return {
        ok: false,
        ignored: false,
        code: "unsupported_command",
        message: `Unsupported embed command: ${String(message.type)}`,
      };
    }
    if (
      message.requestId !== undefined &&
      typeof message.requestId !== "string" &&
      typeof message.requestId !== "number"
    ) {
      return {
        ok: false,
        ignored: false,
        code: "invalid_request_id",
        message: "requestId must be a string or number.",
      };
    }
    return { ok: true, ignored: false, message };
  }

  function normalizeImageBounds(value) {
    const bounds = isObject(value) ? value : {};
    const normalized = {
      x: Number(bounds.x),
      y: Number(bounds.y),
      width: Number(bounds.width),
      height: Number(bounds.height),
    };
    if (
      !Number.isFinite(normalized.x) ||
      !Number.isFinite(normalized.y) ||
      !Number.isFinite(normalized.width) ||
      !Number.isFinite(normalized.height) ||
      normalized.width <= 0 ||
      normalized.height <= 0
    ) {
      throw Object.assign(
        new Error("Image bounds require finite x, y, width, and height values; width and height must be positive."),
        { code: "invalid_viewport" },
      );
    }
    return normalized;
  }

  function visitCoordinates(value, callback) {
    if (!Array.isArray(value)) return;
    if (
      value.length >= 2 &&
      Number.isFinite(Number(value[0])) &&
      Number.isFinite(Number(value[1]))
    ) {
      callback(Number(value[0]), Number(value[1]));
      return;
    }
    value.forEach((child) => visitCoordinates(child, callback));
  }

  function getFeatureBounds(feature) {
    const coordinates = feature?.geometry?.coordinates;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    visitCoordinates(coordinates, (x, y) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  function mergeBounds(boundsList) {
    const valid = boundsList.filter(Boolean);
    if (!valid.length) return null;
    const minX = Math.min(...valid.map((bounds) => bounds.x));
    const minY = Math.min(...valid.map((bounds) => bounds.y));
    const maxX = Math.max(...valid.map((bounds) => bounds.x + bounds.width));
    const maxY = Math.max(...valid.map((bounds) => bounds.y + bounds.height));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  function validateFeatureCollection(value) {
    if (!isObject(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) {
      throw Object.assign(
        new Error("annotations must be a GeoJSON FeatureCollection with a features array."),
        { code: "invalid_annotations" },
      );
    }
    return value;
  }

  function normalizeAnnotationCapabilities(options = {}) {
    const hasExplicitSelection = typeof options.canSelect === "boolean";
    const hasExplicitEditing = typeof options.canEdit === "boolean";
    const legacyReadOnly =
      options.readOnly === true && !hasExplicitSelection && !hasExplicitEditing;
    const readOnlyDefault = options.readOnly === true ? false : true;
    return {
      canSelect: hasExplicitSelection ? options.canSelect : readOnlyDefault,
      canEdit: hasExplicitEditing ? options.canEdit : readOnlyDefault,
      legacyLock: legacyReadOnly,
    };
  }

  function normalizeAnnotationSelectionMode(options = {}) {
    return options.selectionMode === "multiple" ? "multiple" : "single";
  }

  function createController(options = {}) {
    const handlers = options.handlers || {};
    const postEvent = options.postEvent;
    if (typeof postEvent !== "function") {
      throw new TypeError("createController requires a postEvent function.");
    }

    async function handleMessage(event) {
      const validation = validateEnvelope(event, options);
      if (!validation.ok) {
        if (!validation.ignored) {
          const data = isObject(event?.data) ? event.data : {};
          postEvent("viewer.commandFailed", {
            requestId: data.requestId ?? null,
            command: data.type || null,
            error: { code: validation.code, message: validation.message },
          });
        }
        return false;
      }

      const message = validation.message;
      const handler = handlers[message.type];
      if (typeof handler !== "function") {
        postEvent("viewer.commandFailed", {
          requestId: message.requestId ?? null,
          command: message.type,
          error: { code: "unsupported_command", message: `No handler is installed for ${message.type}.` },
        });
        return true;
      }

      try {
        const result = (await handler(message)) || {};
        postEvent("viewer.commandSucceeded", {
          requestId: message.requestId ?? null,
          command: message.type,
          ...result,
        });
      } catch (error) {
        postEvent("viewer.commandFailed", {
          requestId: message.requestId ?? null,
          command: message.type,
          error: {
            code: error?.code || "command_failed",
            message: error?.message || "The embed command failed.",
          },
        });
      }
      return true;
    }

    return { handleMessage };
  }

  global.PetroImageEmbedApi = Object.freeze({
    SOURCE,
    VERSION,
    COMMANDS,
    createController,
    getFeatureBounds,
    mergeBounds,
    normalizeAnnotationCapabilities,
    normalizeAnnotationSelectionMode,
    normalizeImageBounds,
    validateEnvelope,
    validateFeatureCollection,
  });
})(typeof window !== "undefined" ? window : globalThis);
