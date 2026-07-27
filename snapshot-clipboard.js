(function initializeSnapshotClipboard(globalObject) {
  "use strict";

  const PNG_MIME_TYPE = "image/png";

  function getImageClipboardUnavailableReason(
    environment = globalObject,
  ) {
    if (!environment?.isSecureContext) {
      return "Image copying requires HTTPS or localhost.";
    }

    const clipboard = environment.navigator?.clipboard;
    const ClipboardItemCtor = environment.ClipboardItem;
    if (!clipboard?.write || !ClipboardItemCtor) {
      return "Image copying is not supported by this browser.";
    }

    if (
      typeof ClipboardItemCtor.supports === "function" &&
      !ClipboardItemCtor.supports(PNG_MIME_TYPE)
    ) {
      return "PNG clipboard images are not supported by this browser.";
    }

    return "";
  }

  function writeBrowserImageToClipboard(
    pngBlobPromise,
    environment = globalObject,
  ) {
    const unavailableReason =
      getImageClipboardUnavailableReason(environment);
    if (unavailableReason) {
      return Promise.reject(new Error(unavailableReason));
    }

    try {
      const item = new environment.ClipboardItem({
        [PNG_MIME_TYPE]: pngBlobPromise,
      });

      // Start the write synchronously in the click handler. In particular,
      // Safari requires the user gesture to still be active when write() begins.
      return environment.navigator.clipboard.write([item]).catch((error) => {
        if (error?.name === "NotAllowedError") {
          throw new Error(
            "Clipboard permission was denied. Allow clipboard access and try again.",
          );
        }
        throw error;
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  globalObject.PetroImageSnapshotClipboard = {
    PNG_MIME_TYPE,
    getImageClipboardUnavailableReason,
    writeBrowserImageToClipboard,
  };
})(typeof window !== "undefined" ? window : globalThis);
