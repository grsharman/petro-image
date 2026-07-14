(function initializePetroImageMode(global) {
  "use strict";

  function getRequestedView(search = "") {
    const query = String(search).replace(/^\?/, "");
    for (const part of query.split("&")) {
      if (!part) continue;
      const [rawKey, rawValue = ""] = part.split("=", 2);
      if (decodeURIComponent(rawKey) !== "view") continue;
      return decodeURIComponent(rawValue).trim().toLowerCase();
    }
    return "";
  }

  function resolveMobileMode({
    search = "",
    hasElectronApi = false,
    coarsePointer = false,
    screenWidth = 0,
    screenHeight = 0,
  } = {}) {
    const requestedView = getRequestedView(search);
    if (requestedView === "mobile") return true;
    if (requestedView === "desktop") return false;
    if (hasElectronApi || !coarsePointer) return false;

    const dimensions = [Number(screenWidth), Number(screenHeight)].filter(
      (value) => Number.isFinite(value) && value > 0,
    );
    return dimensions.length === 2 && Math.min(...dimensions) <= 600;
  }

  function detectMobileMode(browser = global) {
    return resolveMobileMode({
      search: browser.location?.search || "",
      hasElectronApi: Boolean(browser.electronAPI),
      coarsePointer: Boolean(
        browser.matchMedia?.("(any-pointer: coarse)")?.matches,
      ),
      screenWidth: browser.screen?.width || browser.innerWidth || 0,
      screenHeight: browser.screen?.height || browser.innerHeight || 0,
    });
  }

  const api = Object.freeze({
    getRequestedView,
    resolveMobileMode,
    detectMobileMode,
  });
  global.PetroImageMode = api;

  const mobileMode = detectMobileMode(global);
  global.__PETRO_IMAGE_MOBILE_MODE__ = mobileMode;
  global.document?.documentElement?.classList.toggle("mobile-view", mobileMode);
  if (global.document?.documentElement) {
    global.document.documentElement.dataset.viewMode = mobileMode
      ? "mobile"
      : "desktop";
  }
})(typeof window !== "undefined" ? window : globalThis);
