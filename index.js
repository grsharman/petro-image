"use strict";

// Index of the currently selected sample
let currentIndex = 0;
let samples = [];
let currentLibraryData = { samples: [] };
let currentLibraryPath = "";
let annotationFiles = {}; // For loading predefined annotations
let groupMapping = {}; // To map groups to sample indices
let scrollIndex = 1e6; // Prevents indexing error if starting at 0, due to negative numbers
let enableStageRotation = false;
let tileLoadGeneration = 0;
let measurementControlsInitialized = false;
let circleControlsInitialized = false;
let measurementModeActive = false;
let circleModeActive = false;
let tileLoadFailureWarningKey = "";
let tileLoadFailureWarningInFlight = false;

// Accessors for attributes of the current sample
const title = () => samples[currentIndex].title;
const tileSets = () => samples[currentIndex].tileSets;
const normalizePixelsPerMeter = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
};
const pixelsPerMeter = () => {
  return normalizePixelsPerMeter(samples[currentIndex]?.pixelsPerMeter);
};
const hasKnownScale = () => pixelsPerMeter() !== null;
const pixelsPerMicron = () => {
  const scale = pixelsPerMeter();
  if (scale === null) return null;
  const micronsPerMeter = 10 ** 6;
  return scale / micronsPerMeter;
};
const metersFromPixels = (pixels) => {
  const scale = pixelsPerMeter();
  return scale === null ? null : pixels / scale;
};
const squareMetersFromSquarePixels = (pixels2) => {
  const scale = pixelsPerMeter();
  return scale === null ? null : pixels2 / scale ** 2;
};

function serializeTileSetForLibrary(tileSet) {
  return {
    ...tileSet,
    tiles: (tileSet.tiles || []).map((tile) => {
      const { image, ...libraryTile } = tile;
      return libraryTile;
    }),
  };
}

function serializeSampleForLibrary(sample) {
  return {
    ...sample,
    tileSets: (sample.tileSets || []).map(serializeTileSetForLibrary),
  };
}

function serializeLibraryDataForSave() {
  return {
    ...(currentLibraryData || {}),
    samples: samples.map(serializeSampleForLibrary),
  };
}

function isTextEntryElement(element) {
  if (!element) return false;
  if (element.isContentEditable) return true;

  const tagName = element.tagName;
  if (tagName === "TEXTAREA" || tagName === "SELECT") return true;
  if (tagName !== "INPUT") return false;

  const textInputTypes = new Set([
    "",
    "email",
    "number",
    "password",
    "search",
    "tel",
    "text",
    "url",
  ]);
  return textInputTypes.has((element.type || "").toLowerCase());
}

// Global variables related to annotations
let hasAnnotationInJSON = false; // for keeping track of whether the selected sample has annotations in the JSON
// Function for making points
let annotateLabels = [];
let annotatePoints = [];
let annoJSON = {
  type: "FeatureCollection",
  features: [],
};
let countJSON = {
  type: "FeatureCollection",
  features: [],
};
let measureJSON = {
  type: "FeatureCollection",
  features: [],
};
let annoJSONTemp = {
  type: "FeatureCollection",
  features: [],
}; // For drawing temporary annotations
let selectedAnnotationUuid = null;
let selectedAnnotationUuids = new Set();
let annotationListSelectionAnchorUuid = null;
let suppressNextAnnotationClick = false;
let suppressNextAnnotationDoubleClick = false;

function suppressAnnotationClickBriefly() {
  suppressNextAnnotationClick = true;
  window.setTimeout(() => {
    suppressNextAnnotationClick = false;
  }, 300);
}

function suppressAnnotationDoubleClickBriefly() {
  suppressNextAnnotationDoubleClick = true;
  window.setTimeout(() => {
    suppressNextAnnotationDoubleClick = false;
  }, 350);
}
let selectImportedAnnotationsPreference = true;
const DEFAULT_ANNOTATION_GROUP = {
  groupId: "default",
  groupName: "Default",
  groupColor: "#ffcc00",
  groupVisible: true,
  groupLocked: false,
};
let measureJSONTemp = {
  type: "FeatureCollection",
  features: [],
}; // For drawing temporary measurements
let measureAreaJSONTemp = {
  type: "FeatureCollection",
  features: [],
}; // For drawing temporary measurements of area

function loadSampleJSON(input, options = {}) {
  if (typeof input === "string") {
    // Load necessary information from JSON
    return fetch(input)
      .then((response) => response.json())
      .then((data) => {
        return processJSON(data, options); // Process JSON data
      });
  } else if (typeof input === "object") {
    // Case 2: Input is already parsed JSON
    return processJSON(input, options);
  }

  return Promise.resolve();
}

async function processJSON(data, options = {}) {
  const { autoLoadSample = true } = options;
  currentIndex = 0;
  currentLibraryData = data;
  samples = data.samples;
  annotationFiles = {}; // For loading predefined annotations
  groupMapping = {}; // To map groups to sample indices

  samples.forEach((sample, index) => {
    annotationFiles[sample.title] = sample.annotations;

    // Ensure each tile set with angles is sorted ascending by angle.
    for (let tileSet of sample.tileSets) {
      if (tileSet.periodDegrees) {
        tileSet.tiles.sort((a, b) => a.angleDegrees - b.angleDegrees);
      }
    }

    // Map sample indices to their groups.
    if (sample.groups) {
      sample.groups.forEach((group) => {
        if (!groupMapping[group]) {
          groupMapping[group] = [];
        }
        groupMapping[group].push(index);
      });
    }
  });

  // Add a default "All" group containing all sample indices
  groupMapping["All"] = Array.from({ length: samples.length }, (_, i) => i);

  populateGroupDropdown();
  disableCountButtons();
  updateStageRotationCheck();

  const sampleParam = getQueryParameter("sample");
  if (sampleParam) {
    // const sampleIndex = samples.indexOf(sampleParam);
    const sampleIndex = samples.findIndex(
      (sample) => sample.title === sampleParam
    );
    if (sampleIndex !== -1) {
      // Select the correct group and sample
      const groupForSample = Object.keys(groupMapping).find((group) =>
        groupMapping[group].includes(sampleIndex)
      );
      document.getElementById("groupDropdown").value = groupForSample || "All";
      populateSampleDropdown(groupForSample || "All", { autoSelect: autoLoadSample });
      document.getElementById("sampleDropdown").value = sampleIndex;
      if (autoLoadSample) {
        document
          .getElementById("sampleDropdown")
          .dispatchEvent(new Event("change"));
      }
    }
  } else {
    // Default behavior if no sample is specified
    const firstGroup = Object.keys(groupMapping)[0];
    if (firstGroup) {
      document.getElementById("groupDropdown").value = firstGroup;
      populateSampleDropdown(firstGroup, { autoSelect: autoLoadSample });
    }
  }
}

// Automatically load the default JSON file when the page loads
document.addEventListener("DOMContentLoaded", async () => {
  if (window.electronAPI?.initializeProjectLibrary) {
    try {
      const result = await window.electronAPI.initializeProjectLibrary();
      currentLibraryPath = result?.filePath || "";
      await loadSampleJSON(result.jsonData);
      return;
    } catch (error) {
      console.error("Could not initialize project library:", error);
    }
  }

  loadSampleJSON("samples.json");
});

async function loadLibraryWithElectronDialog() {
  try {
    const result = await window.electronAPI.selectExistingJsonFile();
    if (result?.canceled) return;

    currentLibraryPath = result.filePath || "";
    await loadSampleJSON(result.jsonData);
  } catch (error) {
    console.error("Error loading library JSON:", error);
    alert(error.message || "Invalid library JSON file.");
  }

  const menu = document.getElementById("imageSettingsMenu");
  menu.style.display = "none";
}

async function changeProjectWithElectronDialog() {
  try {
    const result = await window.electronAPI.changeProjectLibrary();
    if (!result?.jsonData) return;

    currentLibraryPath = result.filePath || "";
    await loadSampleJSON(result.jsonData);
  } catch (error) {
    console.error("Error opening project:", error);
    alert(error.message || "Could not open the selected project.");
  }

  const menu = document.getElementById("imageSettingsMenu");
  menu.style.display = "none";
}

const loadLibraryInput = document.getElementById("load-sample-JSON");
const loadLibraryButton = document.getElementById("loadLibraryButton");
const actionLoadLibraryButton = document.getElementById("actionLoadLibraryButton");
const electronActionButton = document.getElementById("electronActionButton");
const electronActionTray = document.getElementById("electronActionTray");
const viewerToolsButton = document.getElementById("viewerToolsButton");
const viewerToolsTray = document.getElementById("viewerToolsTray");
const changeProjectButton = document.getElementById("changeProjectButton");
const controlsPanel = document.querySelector(".controls");
const minimizeControlsButton = document.getElementById(
  "minimizeControlsButton"
);
const openGridCountPaletteButton = document.getElementById(
  "openGridCountPaletteButton"
);
const openAnnotatePaletteButton = document.getElementById(
  "openAnnotatePaletteButton"
);
const openMeasurePaletteButton = document.getElementById(
  "openMeasurePaletteButton"
);
const openSnapshotPaletteButton = document.getElementById(
  "openSnapshotPaletteButton"
);
const gridCountPalette = document.getElementById("gridCountPalette");
const gridCountPaletteHeader = document.getElementById("gridCountPaletteHeader");
const gridCountPaletteBody = document.getElementById("gridCountPaletteBody");
const closeGridCountPaletteButton = document.getElementById(
  "closeGridCountPaletteButton"
);
const minimizeGridCountPaletteButton = document.getElementById(
  "minimizeGridCountPaletteButton"
);
const annotatePalette = document.getElementById("annotatePalette");
const annotatePaletteHeader = document.getElementById("annotatePaletteHeader");
const annotatePaletteBody = document.getElementById("annotatePaletteBody");
const closeAnnotatePaletteButton = document.getElementById(
  "closeAnnotatePaletteButton"
);
const minimizeAnnotatePaletteButton = document.getElementById(
  "minimizeAnnotatePaletteButton"
);
const measurePalette = document.getElementById("measurePalette");
const measurePaletteHeader = document.getElementById("measurePaletteHeader");
const measurePaletteBody = document.getElementById("measurePaletteBody");
const closeMeasurePaletteButton = document.getElementById(
  "closeMeasurePaletteButton"
);
const minimizeMeasurePaletteButton = document.getElementById(
  "minimizeMeasurePaletteButton"
);
const snapshotPalette = document.getElementById("snapshotPalette");
const snapshotPaletteHeader = document.getElementById("snapshotPaletteHeader");
const closeSnapshotPaletteButton = document.getElementById(
  "closeSnapshotPaletteButton"
);
const minimizeSnapshotPaletteButton = document.getElementById(
  "minimizeSnapshotPaletteButton"
);
const snapshotSelection = document.getElementById("snapshot-selection");
const snapshotSelectionBody = document.getElementById("snapshotSelectionBody");
const snapshotDrawButton = document.getElementById("snapshotDrawButton");
const snapshotClearButton = document.getElementById("snapshotClearButton");
const snapshotExportButton = document.getElementById("snapshotExportButton");
const snapshotStatus = document.getElementById("snapshotStatus");
const snapshotIncludeScalebar = document.getElementById(
  "snapshotIncludeScalebar"
);
const snapshotTileSetSelect = document.getElementById("snapshotTileSetSelect");
const snapshotContentMode = document.getElementById("snapshotContentMode");
const snapshotResolutionMode = document.getElementById("snapshotResolutionMode");
const snapshotJpegQuality = document.getElementById("snapshotJpegQuality");
const openScaleWizardButton = document.getElementById("openScaleWizardButton");
const openLibraryEditorButton = document.getElementById("openLibraryEditorButton");
const hasElectronActions = Boolean(window.electronAPI);
let gridCountPaletteControlsMoved = false;
let annotatePaletteControlsMoved = false;
let measurePaletteControlsMoved = false;
let snapshotModeActive = false;
let snapshotDragState = null;
let snapshotSelectionRect = null;
let snapshotAdjustState = null;
const SNAPSHOT_MAX_OUTPUT_DIMENSION = 16000;
const SNAPSHOT_MAX_OUTPUT_PIXELS = 100000000;
const TOOL_PALETTE_EDGE_MARGIN = 5;

function getPaletteBounds(left, top, paletteRect) {
  return {
    left,
    top,
    right: left + paletteRect.width,
    bottom: top + paletteRect.height,
  };
}

function rectsOverlap(a, b) {
  return (
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top
  );
}

function getControlsReservedRect() {
  const controls = controlsPanel || document.querySelector(".controls");
  const viewerContainer = document.getElementById("viewer-container");
  if (!controls || !viewerContainer) return null;

  const controlsRect = controls.getBoundingClientRect();
  const containerRect = viewerContainer.getBoundingClientRect();
  return {
    left: controlsRect.left - containerRect.left - TOOL_PALETTE_EDGE_MARGIN,
    top: controlsRect.top - containerRect.top - TOOL_PALETTE_EDGE_MARGIN,
    right: controlsRect.right - containerRect.left + TOOL_PALETTE_EDGE_MARGIN,
    bottom: controlsRect.bottom - containerRect.top + TOOL_PALETTE_EDGE_MARGIN,
  };
}

function resolveControlsDragCollision(
  left,
  top,
  paletteRect,
  reservedRect,
  previousPosition
) {
  if (!previousPosition) return { left, top };

  const previousBounds = getPaletteBounds(
    previousPosition.left,
    previousPosition.top,
    paletteRect
  );
  let nextLeft = left;
  let nextTop = top;

  if (previousBounds.bottom <= reservedRect.top) {
    nextTop = reservedRect.top - paletteRect.height;
  } else if (previousBounds.top >= reservedRect.bottom) {
    nextTop = reservedRect.bottom;
  } else if (previousBounds.right <= reservedRect.left) {
    nextLeft = reservedRect.left - paletteRect.width;
  } else if (previousBounds.left >= reservedRect.right) {
    nextLeft = reservedRect.right;
  }

  return { left: nextLeft, top: nextTop };
}

function resolveControlsAutoCollision(left, top, paletteRect, maxLeft, maxTop) {
  const reservedRect = getControlsReservedRect();
  if (!reservedRect) return { left, top };

  const belowControls = reservedRect.bottom;
  if (belowControls <= maxTop) {
    return { left, top: belowControls };
  }

  const aboveControls = reservedRect.top - paletteRect.height;
  if (aboveControls >= TOOL_PALETTE_EDGE_MARGIN) {
    return { left, top: aboveControls };
  }

  const rightOfControls = reservedRect.right;
  if (rightOfControls <= maxLeft) {
    return { left: rightOfControls, top };
  }

  return {
    left: Math.min(Math.max(left, TOOL_PALETTE_EDGE_MARGIN), maxLeft),
    top: Math.min(Math.max(top, TOOL_PALETTE_EDGE_MARGIN), maxTop),
  };
}

function avoidControlsOverlap(
  left,
  top,
  paletteRect,
  maxLeft,
  maxTop,
  options = {}
) {
  const reservedRect = getControlsReservedRect();
  if (!reservedRect) return { left, top };

  if (!rectsOverlap(getPaletteBounds(left, top, paletteRect), reservedRect)) {
    return { left, top };
  }

  if (options.previousPosition) {
    const dragPosition = resolveControlsDragCollision(
      left,
      top,
      paletteRect,
      reservedRect,
      options.previousPosition
    );

    return {
      left: Math.min(
        Math.max(dragPosition.left, TOOL_PALETTE_EDGE_MARGIN),
        maxLeft
      ),
      top: Math.min(
        Math.max(dragPosition.top, TOOL_PALETTE_EDGE_MARGIN),
        maxTop
      ),
    };
  }

  return resolveControlsAutoCollision(left, top, paletteRect, maxLeft, maxTop);
}

function clampToolPaletteToViewer(palette) {
  const viewerContainer = document.getElementById("viewer-container");
  if (!viewerContainer || !palette) return;

  const containerRect = viewerContainer.getBoundingClientRect();
  const paletteRect = palette.getBoundingClientRect();
  const maxLeft = Math.max(
    TOOL_PALETTE_EDGE_MARGIN,
    containerRect.width - paletteRect.width - TOOL_PALETTE_EDGE_MARGIN
  );
  const maxTop = Math.max(
    TOOL_PALETTE_EDGE_MARGIN,
    containerRect.height - paletteRect.height - TOOL_PALETTE_EDGE_MARGIN
  );
  const currentLeft = Number.parseFloat(
    palette.style.left || String(TOOL_PALETTE_EDGE_MARGIN)
  );
  const currentTop = Number.parseFloat(palette.style.top || "56");

  const nextLeft = Math.min(
    Math.max(currentLeft, TOOL_PALETTE_EDGE_MARGIN),
    maxLeft
  );
  const nextTop = Math.min(
    Math.max(currentTop, TOOL_PALETTE_EDGE_MARGIN),
    maxTop
  );
  const adjustedPosition = avoidControlsOverlap(
    nextLeft,
    nextTop,
    paletteRect,
    maxLeft,
    maxTop
  );

  palette.style.left = `${adjustedPosition.left}px`;
  palette.style.top = `${adjustedPosition.top}px`;
}

function setDefaultToolPalettePosition(palette) {
  const viewerContainer = document.getElementById("viewer-container");
  if (!viewerContainer || !palette) return;

  const containerRect = viewerContainer.getBoundingClientRect();
  const paletteRect = palette.getBoundingClientRect();
  const defaultPosition = palette.dataset.defaultPosition || "bottom-right";
  const bottomOffset = Number(palette.dataset.defaultBottomOffset || 12);
  const left =
    defaultPosition === "bottom-left"
      ? TOOL_PALETTE_EDGE_MARGIN
      : Math.max(
          TOOL_PALETTE_EDGE_MARGIN,
          containerRect.width - paletteRect.width - TOOL_PALETTE_EDGE_MARGIN
        );
  const top = Math.max(
    TOOL_PALETTE_EDGE_MARGIN,
    containerRect.height - paletteRect.height - bottomOffset
  );

  palette.style.left = `${left}px`;
  palette.style.top = `${top}px`;
}

function restoreToolPalettePosition(palette, storageKey) {
  if (!palette) return;

  try {
    const storedPosition = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (storedPosition) {
      palette.style.left = `${storedPosition.left}px`;
      palette.style.top = `${storedPosition.top}px`;
    } else {
      setDefaultToolPalettePosition(palette);
    }
  } catch (error) {
    console.warn("Could not restore tool palette position:", error);
    setDefaultToolPalettePosition(palette);
  }

  clampToolPaletteToViewer(palette);
}

function saveToolPalettePosition(palette, storageKey) {
  if (!palette) return;

  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        left: Number.parseFloat(
          palette.style.left || String(TOOL_PALETTE_EDGE_MARGIN)
        ),
        top: Number.parseFloat(palette.style.top || "56"),
      })
    );
  } catch (error) {
    console.warn("Could not save tool palette position:", error);
  }
}

function makeToolPaletteDraggable(palette, handle, storageKey) {
  if (!palette || !handle) return;

  let dragState = null;

  handle.addEventListener("pointerdown", function (event) {
    if (event.button !== 0 || event.target.closest("button")) return;

    const paletteRect = palette.getBoundingClientRect();
    dragState = {
      offsetX: event.clientX - paletteRect.left,
      offsetY: event.clientY - paletteRect.top,
      lastLeft: Number.parseFloat(
        palette.style.left || String(TOOL_PALETTE_EDGE_MARGIN)
      ),
      lastTop: Number.parseFloat(palette.style.top || "56"),
    };
    handle.setPointerCapture(event.pointerId);
  });

  handle.addEventListener("pointermove", function (event) {
    if (!dragState) return;

    const viewerContainer = document.getElementById("viewer-container");
    if (!viewerContainer) return;

    const containerRect = viewerContainer.getBoundingClientRect();
    const paletteRect = palette.getBoundingClientRect();
    const maxLeft = Math.max(
      TOOL_PALETTE_EDGE_MARGIN,
      containerRect.width - paletteRect.width - TOOL_PALETTE_EDGE_MARGIN
    );
    const maxTop = Math.max(
      TOOL_PALETTE_EDGE_MARGIN,
      containerRect.height - paletteRect.height - TOOL_PALETTE_EDGE_MARGIN
    );
    const nextLeft = event.clientX - containerRect.left - dragState.offsetX;
    const nextTop = event.clientY - containerRect.top - dragState.offsetY;

    const adjustedPosition = avoidControlsOverlap(
      Math.min(
        Math.max(nextLeft, TOOL_PALETTE_EDGE_MARGIN),
        maxLeft
      ),
      Math.min(
        Math.max(nextTop, TOOL_PALETTE_EDGE_MARGIN),
        maxTop
      ),
      paletteRect,
      maxLeft,
      maxTop,
      {
        previousPosition: {
          left: dragState.lastLeft,
          top: dragState.lastTop,
        },
      }
    );

    palette.style.left = `${adjustedPosition.left}px`;
    palette.style.top = `${adjustedPosition.top}px`;
    dragState.lastLeft = adjustedPosition.left;
    dragState.lastTop = adjustedPosition.top;
  });

  function stopDrag(event) {
    if (!dragState) return;
    dragState = null;
    saveToolPalettePosition(palette, storageKey);
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
  }

  handle.addEventListener("pointerup", stopDrag);
  handle.addEventListener("pointercancel", stopDrag);
}

function toggleToolPaletteMinimized(palette, button) {
  if (!palette || !button) return;

  const title =
    document.getElementById(palette.getAttribute("aria-labelledby"))
      ?.textContent || "panel";
  const isMinimized = palette.classList.toggle("tool-palette-minimized");
  button.setAttribute("aria-pressed", String(isMinimized));
  button.setAttribute(
    "aria-label",
    isMinimized ? `Expand ${title}` : `Minimize ${title}`
  );
  button.title = isMinimized ? "Expand" : "Minimize";
  clampToolPaletteToViewer(palette);
}

function restoreToolPaletteFromMinimized(palette, button) {
  if (!palette?.classList.contains("tool-palette-minimized")) return;
  toggleToolPaletteMinimized(palette, button);
}

function clampOpenToolPalettes() {
  [gridCountPalette, annotatePalette, measurePalette, snapshotPalette].forEach(
    (palette) => {
      if (palette && !palette.hidden) {
        clampToolPaletteToViewer(palette);
      }
    }
  );
}

function moveGridCountControlsToPalette() {
  if (
    gridCountPaletteControlsMoved ||
    !gridCountPaletteBody ||
    !document.getElementById("detailsMenu") ||
    !document.getElementById("countDetails")
  ) {
    return;
  }

  const gridDetails = document.getElementById("detailsMenu");
  const countDetails = document.getElementById("countDetails");
  gridDetails.open = true;
  countDetails.open = false;
  gridCountPaletteBody.append(gridDetails, countDetails);
  setupGridCountAccordion(gridDetails, countDetails);
  gridCountPaletteControlsMoved = true;
}

function moveAnnotateControlsToPalette() {
  if (
    annotatePaletteControlsMoved ||
    !annotatePaletteBody ||
    !document.getElementById("annotateDetails")
  ) {
    return;
  }

  const annotateDetails = document.getElementById("annotateDetails");
  annotateDetails.open = true;
  annotatePaletteBody.append(annotateDetails);
  annotatePaletteControlsMoved = true;
}

function updateToolsMenuVisibility() {
  const toolsMenu = document.getElementById("toolsMenu");
  if (!toolsMenu || !hasElectronActions) return;

  toolsMenu.hidden =
    gridCountPaletteControlsMoved &&
    annotatePaletteControlsMoved &&
    measurePaletteControlsMoved;
}

function moveMeasureControlsToPalette() {
  if (
    measurePaletteControlsMoved ||
    !measurePaletteBody ||
    !document.getElementById("measureDetails")
  ) {
    return;
  }

  const measureDetails = document.getElementById("measureDetails");
  measureDetails.open = true;
  measurePaletteBody.append(measureDetails);
  measurePaletteControlsMoved = true;
  updateToolsMenuVisibility();
}

function setupGridCountAccordion(gridDetails, countDetails) {
  if (!gridDetails || !countDetails || gridDetails.dataset.accordionReady) return;

  gridDetails.dataset.accordionReady = "true";
  countDetails.dataset.accordionReady = "true";

  gridDetails.addEventListener("toggle", function () {
    if (gridDetails.open && countDetails.open) {
      countDetails.open = false;
    }
  });

  countDetails.addEventListener("toggle", function () {
    if (countDetails.open && gridDetails.open) {
      gridDetails.open = false;
    }
  });
}

function openGridCountPalette() {
  if (!gridCountPalette) return;

  moveGridCountControlsToPalette();
  gridCountPalette.hidden = false;
  restoreToolPalettePosition(gridCountPalette, "petroImage.gridCountPalette");
  openGridCountPaletteButton?.setAttribute("aria-pressed", "true");
  clampToolPaletteToViewer(gridCountPalette);
  updateToolsMenuVisibility();
}

function closeGridCountPalette() {
  if (!gridCountPalette) return;

  closeCountDropdowns();
  gridCountPalette.hidden = true;
  openGridCountPaletteButton?.setAttribute("aria-pressed", "false");
}

function toggleGridCountPalette() {
  if (!gridCountPalette || gridCountPalette.hidden) {
    openGridCountPalette();
    return;
  }

  closeGridCountPalette();
}

function openAnnotatePalette() {
  if (!annotatePalette) return;

  moveAnnotateControlsToPalette();
  annotatePalette.hidden = false;
  restoreToolPalettePosition(annotatePalette, "petroImage.annotatePalette");
  openAnnotatePaletteButton?.setAttribute("aria-pressed", "true");
  clampToolPaletteToViewer(annotatePalette);
  updateToolsMenuVisibility();
}

function closeAnnotatePalette() {
  if (!annotatePalette) return;

  deactivateAnnotationModes();
  closeAnnotationSettingsPopover();
  closeCircleAnnotationOptionsPopover();
  annotatePalette.hidden = true;
  openAnnotatePaletteButton?.setAttribute("aria-pressed", "false");
}

function toggleAnnotatePalette() {
  if (!annotatePalette || annotatePalette.hidden) {
    openAnnotatePalette();
    return;
  }

  closeAnnotatePalette();
}

function openMeasurePalette() {
  if (!measurePalette) return;

  moveMeasureControlsToPalette();
  measurePalette.hidden = false;
  restoreToolPalettePosition(measurePalette, "petroImage.measurePalette");
  openMeasurePaletteButton?.setAttribute("aria-pressed", "true");
  clampToolPaletteToViewer(measurePalette);
}

function closeMeasurePalette() {
  if (!measurePalette) return;

  closeCircleSettingsPopover();
  measurePalette.hidden = true;
  openMeasurePaletteButton?.setAttribute("aria-pressed", "false");
}

function toggleMeasurePalette() {
  if (!measurePalette || measurePalette.hidden) {
    openMeasurePalette();
    return;
  }

  closeMeasurePalette();
}

function openSnapshotPalette() {
  if (!snapshotPalette) return;

  snapshotPalette.hidden = false;
  restoreToolPalettePosition(snapshotPalette, "petroImage.snapshotPalette");
  openSnapshotPaletteButton?.setAttribute("aria-pressed", "true");
  clampToolPaletteToViewer(snapshotPalette);
  updateSnapshotStatus();
}

function closeSnapshotPalette() {
  if (!snapshotPalette) return;

  stopSnapshotDrawMode({ clearSelection: true });
  snapshotPalette.hidden = true;
  openSnapshotPaletteButton?.setAttribute("aria-pressed", "false");
}

function toggleSnapshotPalette() {
  if (!snapshotPalette || snapshotPalette.hidden) {
    openSnapshotPalette();
    return;
  }

  closeSnapshotPalette();
}

function updateSnapshotScalebarAvailability() {
  if (!snapshotIncludeScalebar) return;

  const scaleAvailable = hasKnownScale();
  if (!scaleAvailable) {
    if (!snapshotIncludeScalebar.disabled) {
      snapshotIncludeScalebar.dataset.restoreChecked = String(
        snapshotIncludeScalebar.checked
      );
    }
    snapshotIncludeScalebar.checked = false;
    snapshotIncludeScalebar.disabled = true;
    snapshotIncludeScalebar.title = "Set an image scale before including a scalebar.";
    return;
  }

  if (snapshotIncludeScalebar.disabled) {
    snapshotIncludeScalebar.checked =
      snapshotIncludeScalebar.dataset.restoreChecked !== "false";
  }
  snapshotIncludeScalebar.disabled = false;
  snapshotIncludeScalebar.title = "";
}

function getSnapshotExportLimitError(exportSize) {
  if (!exportSize) return "";

  const totalPixels = exportSize.width * exportSize.height;
  if (
    exportSize.width > SNAPSHOT_MAX_OUTPUT_DIMENSION ||
    exportSize.height > SNAPSHOT_MAX_OUTPUT_DIMENSION
  ) {
    return `Output is too large (${exportSize.width} x ${exportSize.height}px). Maximum side length is ${SNAPSHOT_MAX_OUTPUT_DIMENSION}px.`;
  }
  if (totalPixels > SNAPSHOT_MAX_OUTPUT_PIXELS) {
    return `Output is too large (${exportSize.width} x ${exportSize.height}px). Maximum area is ${Math.round(
      SNAPSHOT_MAX_OUTPUT_PIXELS / 1000000
    )} megapixels.`;
  }
  return "";
}

function updateSnapshotStatus(message) {
  if (!snapshotStatus) return;

  updateSnapshotScalebarAvailability();

  let exportSize = null;
  let exportLimitError = "";
  if (snapshotSelectionRect) {
    const sourceCanvas = getOpenSeadragonImageCanvas();
    const sourceRect = sourceCanvas
      ? getSnapshotSourceRect(sourceCanvas, snapshotSelectionRect)
      : null;
    exportSize = getSnapshotExportSize(sourceRect);
    exportLimitError = getSnapshotExportLimitError(exportSize);
  }

  if (snapshotExportButton) {
    snapshotExportButton.disabled =
      !snapshotSelectionRect || snapshotModeActive || Boolean(exportLimitError);
    snapshotExportButton.title = exportLimitError || "";
  }

  if (message) {
    snapshotStatus.textContent = message;
    return;
  }

  if (snapshotModeActive) {
    snapshotStatus.textContent = "Drag a rectangle over the image.";
  } else if (snapshotSelectionRect) {
    if (exportLimitError) {
      snapshotStatus.textContent = `${exportLimitError} Zoom in or choose a lower resolution.`;
    } else if (exportSize) {
      snapshotStatus.textContent = `Ready to export ${exportSize.width} x ${exportSize.height}px.`;
    } else {
      const width = Math.round(snapshotSelectionRect.width);
      const height = Math.round(snapshotSelectionRect.height);
      snapshotStatus.textContent = `Ready to export ${width} x ${height}px.`;
    }
  } else {
    snapshotStatus.textContent = "Set options, then draw a rectangle.";
  }
}

function clearSnapshotSelection() {
  snapshotSelectionRect = null;
  snapshotAdjustState = null;
  if (snapshotSelection) {
    snapshotSelection.hidden = true;
    snapshotSelection.removeAttribute("style");
  }
  if (snapshotClearButton) {
    snapshotClearButton.disabled = true;
  }
  if (snapshotExportButton) {
    snapshotExportButton.disabled = true;
  }
  updateSnapshotStatus();
}

function startSnapshotDrawMode() {
  if (!snapshotSelection) return;

  deactivateAnnotationModes();
  closeAnnotationSettingsPopover();
  closeCircleAnnotationOptionsPopover();
  closeCircleSettingsPopover();
  stopSnapshotDrawMode({ clearSelection: false });
  clearSnapshotSelection();
  snapshotModeActive = true;
  snapshotDragState = null;
  snapshotSelection.style.pointerEvents = "none";
  document.getElementById("viewer-container")?.classList.add("snapshot-mode");
  updateSnapshotStatus();
}

function stopSnapshotDrawMode(options = {}) {
  snapshotModeActive = false;
  snapshotDragState = null;
  if (snapshotSelection) {
    snapshotSelection.style.pointerEvents = "auto";
  }
  document.getElementById("viewer-container")?.classList.remove("snapshot-mode");
  if (options.clearSelection) {
    clearSnapshotSelection();
  } else {
    updateSnapshotStatus();
  }
}

function normalizeSnapshotRect(startPixel, endPixel) {
  const left = Math.min(startPixel.x, endPixel.x);
  const top = Math.min(startPixel.y, endPixel.y);
  const right = Math.max(startPixel.x, endPixel.x);
  const bottom = Math.max(startPixel.y, endPixel.y);
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function updateSnapshotSelection(startPixel, endPixel) {
  renderSnapshotSelection(normalizeSnapshotRect(startPixel, endPixel));
}

function finishSnapshotSelection(endPixel) {
  if (!snapshotDragState) {
    stopSnapshotDrawMode();
    return;
  }

  const rect = normalizeSnapshotRect(snapshotDragState.startPixel, endPixel);
  stopSnapshotDrawMode();

  if (rect.width < 8 || rect.height < 8) {
    clearSnapshotSelection();
    updateSnapshotStatus("Draw a larger rectangle.");
    return;
  }

  snapshotSelectionRect = rect;
  renderSnapshotSelection(rect);
  updateSnapshotStatus();
}

function renderSnapshotSelection(rect = snapshotSelectionRect) {
  if (!snapshotSelection || !rect) return;

  snapshotSelectionRect = {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
  snapshotSelection.hidden = false;
  snapshotSelection.style.left = `${snapshotSelectionRect.left}px`;
  snapshotSelection.style.top = `${snapshotSelectionRect.top}px`;
  snapshotSelection.style.width = `${snapshotSelectionRect.width}px`;
  snapshotSelection.style.height = `${snapshotSelectionRect.height}px`;
  if (snapshotClearButton) {
    snapshotClearButton.disabled = false;
  }
  if (snapshotExportButton) {
    snapshotExportButton.disabled = false;
  }
  updateSnapshotStatus();
}

function getSnapshotViewerBounds() {
  const container = viewer?.container;
  if (!container) return null;
  return {
    width: container.clientWidth,
    height: container.clientHeight,
  };
}

function clampSnapshotRect(rect) {
  const bounds = getSnapshotViewerBounds();
  if (!bounds) return rect;

  const width = Math.min(Math.max(rect.width, 8), bounds.width);
  const height = Math.min(Math.max(rect.height, 8), bounds.height);
  const left = Math.min(Math.max(rect.left, 0), Math.max(bounds.width - width, 0));
  const top = Math.min(Math.max(rect.top, 0), Math.max(bounds.height - height, 0));
  return {
    left,
    top,
    width,
    height,
  };
}

function getSnapshotNormalizedRectFromEdges(left, top, right, bottom) {
  return clampSnapshotRect({
    left: Math.min(left, right),
    top: Math.min(top, bottom),
    width: Math.abs(right - left),
    height: Math.abs(bottom - top),
  });
}

function updateSnapshotRectFromAdjustment(pointerX, pointerY) {
  if (!snapshotAdjustState) return;

  const { mode, handle, startPointer, startRect } = snapshotAdjustState;
  const dx = pointerX - startPointer.x;
  const dy = pointerY - startPointer.y;

  if (mode === "move") {
    renderSnapshotSelection(
      clampSnapshotRect({
        left: startRect.left + dx,
        top: startRect.top + dy,
        width: startRect.width,
        height: startRect.height,
      })
    );
    return;
  }

  let left = startRect.left;
  let top = startRect.top;
  let right = startRect.left + startRect.width;
  let bottom = startRect.top + startRect.height;

  if (handle.includes("w")) left += dx;
  if (handle.includes("e")) right += dx;
  if (handle.includes("n")) top += dy;
  if (handle.includes("s")) bottom += dy;

  renderSnapshotSelection(
    getSnapshotNormalizedRectFromEdges(left, top, right, bottom)
  );
}

function finishSnapshotAdjustment() {
  snapshotAdjustState = null;
}

function startSnapshotAdjustment(event, mode, handle = "") {
  if (!snapshotSelectionRect || snapshotModeActive) return;

  event.preventDefault();
  event.stopPropagation();
  snapshotAdjustState = {
    mode,
    handle,
    startPointer: {
      x: event.clientX,
      y: event.clientY,
    },
    startRect: { ...snapshotSelectionRect },
  };
}

function getOpenSeadragonImageCanvas(targetViewer = viewer) {
  if (targetViewer.drawer?.canvas instanceof HTMLCanvasElement) {
    return targetViewer.drawer.canvas;
  }

  const ignoredCanvasIds = new Set([
    "annotation-overlay",
    "measurement-overlay",
    "circle-overlay",
    "scale-overlay",
  ]);
  return Array.from(targetViewer.container.querySelectorAll("canvas")).find(
    (canvas) => !ignoredCanvasIds.has(canvas.id)
  );
}

function getSnapshotSourceRect(sourceCanvas, selectionRect) {
  const canvasBounds = sourceCanvas.getBoundingClientRect();
  const viewerBounds = viewer.container.getBoundingClientRect();
  const scaleX = sourceCanvas.width / canvasBounds.width;
  const scaleY = sourceCanvas.height / canvasBounds.height;
  const selectionLeft = viewerBounds.left + selectionRect.left;
  const selectionTop = viewerBounds.top + selectionRect.top;
  const rawLeft = (selectionLeft - canvasBounds.left) * scaleX;
  const rawTop = (selectionTop - canvasBounds.top) * scaleY;
  const rawWidth = selectionRect.width * scaleX;
  const rawHeight = selectionRect.height * scaleY;
  const left = Math.max(0, Math.min(sourceCanvas.width, rawLeft));
  const top = Math.max(0, Math.min(sourceCanvas.height, rawTop));
  const right = Math.max(0, Math.min(sourceCanvas.width, rawLeft + rawWidth));
  const bottom = Math.max(0, Math.min(sourceCanvas.height, rawTop + rawHeight));

  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function renderVisibleSnapshotBaseCanvas(sourceCanvas, sourceRect, exportSize) {
  if (!sourceCanvas || !sourceRect || !sourceRect.width || !sourceRect.height) {
    return null;
  }

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = exportSize.width;
  outputCanvas.height = exportSize.height;
  const ctx = outputCanvas.getContext("2d");
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    sourceCanvas,
    sourceRect.left,
    sourceRect.top,
    sourceRect.width,
    sourceRect.height,
    0,
    0,
    outputCanvas.width,
    outputCanvas.height
  );
  return outputCanvas;
}

function getSnapshotViewportBounds(selectionRect) {
  const topLeft = viewer.viewport.pointFromPixel(
    new OpenSeadragon.Point(selectionRect.left, selectionRect.top),
    true
  );
  const bottomRight = viewer.viewport.pointFromPixel(
    new OpenSeadragon.Point(
      selectionRect.left + selectionRect.width,
      selectionRect.top + selectionRect.height
    ),
    true
  );

  return new OpenSeadragon.Rect(
    Math.min(topLeft.x, bottomRight.x),
    Math.min(topLeft.y, bottomRight.y),
    Math.abs(bottomRight.x - topLeft.x),
    Math.abs(bottomRight.y - topLeft.y)
  );
}

function getSnapshotScreenPointFromImagePoint(imagePoint) {
  const image = viewer.world.getItemAt(0);
  if (!image) return null;
  const viewportPoint = image.imageToViewportCoordinates(
    new OpenSeadragon.Point(imagePoint[0], imagePoint[1])
  );
  return viewer.viewport.viewportToViewerElementCoordinates(viewportPoint);
}

function drawSnapshotPath(ctx, coordinates, selectionRect, outputCanvas, closePath) {
  if (!coordinates?.length) return;
  const scaleX = outputCanvas.width / selectionRect.width;
  const scaleY = outputCanvas.height / selectionRect.height;
  let hasPoint = false;

  coordinates.forEach((coordinate, index) => {
    const screenPoint = getSnapshotScreenPointFromImagePoint(coordinate);
    if (!screenPoint) return;
    const x = (screenPoint.x - selectionRect.left) * scaleX;
    const y = (screenPoint.y - selectionRect.top) * scaleY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!hasPoint) {
      ctx.moveTo(x, y);
      hasPoint = true;
    } else if (index > 0) {
      ctx.lineTo(x, y);
    }
  });

  if (hasPoint && closePath) {
    ctx.closePath();
  }
}

function applySnapshotFeatureStroke(ctx, feature, selectionRect, outputCanvas) {
  const lineColor =
    feature.properties.lineColor || document.getElementById("lineColor").value;
  const lineOpacity = Number.isFinite(Number(feature.properties.lineOpacity))
    ? Number(feature.properties.lineOpacity)
    : getAnnotationOpacityValue("lineOpacity");
  const lineWeight = Number.isFinite(Number(feature.properties.lineWeight))
    ? Number(feature.properties.lineWeight)
    : Number(document.getElementById("lineWeight").value);
  const lineStyle =
    feature.properties.lineStyle || document.getElementById("lineStyle").value;

  ctx.strokeStyle = applyOpacityToColor(lineColor, lineOpacity);
  ctx.lineWidth = Math.max(
    1,
    lineWeight * (outputCanvas.width / selectionRect.width)
  );
  if (lineStyle === "dashed") {
    ctx.setLineDash([4, 2].map((value) => value * (outputCanvas.width / selectionRect.width)));
  } else if (lineStyle === "dotted") {
    ctx.setLineDash([2, 2].map((value) => value * (outputCanvas.width / selectionRect.width)));
  } else {
    ctx.setLineDash([]);
  }
}

function drawSnapshotAnnotationShapes(ctx, outputCanvas, selectionRect) {
  if (!document.getElementById("show-annotations").checked) return;

  annoJSON.features.forEach((feature) => {
    if (!isAnnotationFeatureVisible(feature)) return;
    if (!feature.geometry || !feature.properties) return;
    const { type, coordinates } = feature.geometry;

    if (type === "Polygon") {
      ctx.beginPath();
      coordinates.forEach((ring) => {
        drawSnapshotPath(ctx, ring, selectionRect, outputCanvas, true);
      });
      const fillColor =
        feature.properties.fillColor || document.getElementById("fillColor").value;
      const fillOpacity = Number.isFinite(Number(feature.properties.fillOpacity))
        ? Number(feature.properties.fillOpacity)
        : getAnnotationOpacityValue("fillOpacity");
      ctx.fillStyle = applyOpacityToColor(fillColor, fillOpacity);
      ctx.fill("evenodd");
      applySnapshotFeatureStroke(ctx, feature, selectionRect, outputCanvas);
      ctx.stroke();
      return;
    }

    if (type === "MultiPolygon") {
      ctx.beginPath();
      coordinates.forEach((polygon) => {
        polygon.forEach((ring) => {
          drawSnapshotPath(ctx, ring, selectionRect, outputCanvas, true);
        });
      });
      const fillColor =
        feature.properties.fillColor || document.getElementById("fillColor").value;
      const fillOpacity = Number.isFinite(Number(feature.properties.fillOpacity))
        ? Number(feature.properties.fillOpacity)
        : getAnnotationOpacityValue("fillOpacity");
      ctx.fillStyle = applyOpacityToColor(fillColor, fillOpacity);
      ctx.fill("evenodd");
      applySnapshotFeatureStroke(ctx, feature, selectionRect, outputCanvas);
      ctx.stroke();
      return;
    }

    if (type === "LineString") {
      ctx.beginPath();
      drawSnapshotPath(ctx, coordinates, selectionRect, outputCanvas, false);
      applySnapshotFeatureStroke(ctx, feature, selectionRect, outputCanvas);
      ctx.stroke();
      return;
    }

    if (type === "MultiLineString") {
      ctx.beginPath();
      coordinates.forEach((line) => {
        drawSnapshotPath(ctx, line, selectionRect, outputCanvas, false);
      });
      applySnapshotFeatureStroke(ctx, feature, selectionRect, outputCanvas);
      ctx.stroke();
    }
  });
}

function drawSnapshotPointAnnotations(ctx, outputCanvas, selectionRect) {
  if (!document.getElementById("show-annotations").checked) return;

  const scaleX = outputCanvas.width / selectionRect.width;
  const scaleY = outputCanvas.height / selectionRect.height;
  const crosshairSize = 12;

  annoJSON.features.forEach((feature) => {
    if (!isAnnotationFeatureVisible(feature)) return;
    if (feature.geometry?.type !== "Point") return;
    const coords = feature.geometry.coordinates;
    const screenPoint = getSnapshotScreenPointFromImagePoint(coords);
    if (!screenPoint) return;
    const x = (screenPoint.x - selectionRect.left) * scaleX;
    const y = (screenPoint.y - selectionRect.top) * scaleY;
    const lineWeight = Number(feature.properties.lineWeight) || 2;
    const color = feature.properties.lineColor || "rgb(0, 128, 0)";
    const opacity = Number.isFinite(Number(feature.properties.lineOpacity))
      ? Number(feature.properties.lineOpacity)
      : 1;
    const halfSize = (crosshairSize * scaleX) / 2;

    ctx.save();
    ctx.strokeStyle = applyOpacityToColor(color, opacity);
    ctx.lineWidth = Math.max(1, lineWeight * scaleX);
    ctx.beginPath();
    ctx.moveTo(x - halfSize, y);
    ctx.lineTo(x + halfSize, y);
    ctx.moveTo(x, y - halfSize);
    ctx.lineTo(x, y + halfSize);
    ctx.stroke();
    ctx.restore();
  });
}

function drawSnapshotLabelBubble(ctx, x, y, width, height, radius, color) {
  const right = x + width;
  const bottom = y + height;
  ctx.beginPath();
  ctx.moveTo(x, bottom);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.lineTo(right - radius, y);
  ctx.quadraticCurveTo(right, y, right, y + radius);
  ctx.lineTo(right, bottom - radius);
  ctx.quadraticCurveTo(right, bottom, right - radius, bottom);
  ctx.lineTo(x, bottom);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawSnapshotAnnotationLabels(ctx, outputCanvas, selectionRect) {
  const showAnnotations = document.getElementById("show-annotations").checked;
  const showLabels = document.getElementById("show-annotation-labels").checked;
  if (!showAnnotations || !showLabels) return;

  const scaleX = outputCanvas.width / selectionRect.width;
  const scaleY = outputCanvas.height / selectionRect.height;

  annoJSON.features.forEach((feature) => {
    if (!isAnnotationFeatureVisible(feature)) return;
    const label = feature.properties?.label;
    const labelX = Number(feature.properties?.xLabel);
    const labelY = Number(feature.properties?.yLabel);
    if (!label || !label.trim() || !Number.isFinite(labelX) || !Number.isFinite(labelY)) {
      return;
    }

    const screenPoint = getSnapshotScreenPointFromImagePoint([labelX, labelY]);
    if (!screenPoint) return;
    const anchorX = (screenPoint.x - selectionRect.left) * scaleX;
    const anchorY = (screenPoint.y - selectionRect.top) * scaleY;
    const fontSize =
      (Number(feature.properties.labelFontSize) || 16) * scaleX;
    const paddingX = Math.max(4, fontSize * 0.3);
    const textHeight = Math.max(fontSize * 1.2, 12);

    ctx.save();
    ctx.font = `${fontSize}px Arial, sans-serif`;
    const textWidth = ctx.measureText(label).width;
    const bubbleWidth = textWidth + paddingX * 2;
    const bubbleHeight = textHeight;
    const bubbleX = anchorX;
    const bubbleY = anchorY - bubbleHeight;
    drawSnapshotLabelBubble(
      ctx,
      bubbleX,
      bubbleY,
      bubbleWidth,
      bubbleHeight,
      Math.min(bubbleHeight / 2, 10 * scaleX),
      applyOpacityToColor(
        feature.properties.labelBackgroundColor || "#000000",
        Number.isFinite(Number(feature.properties.labelBackgroundOpacity))
          ? Number(feature.properties.labelBackgroundOpacity)
          : 0.5
      )
    );
    ctx.fillStyle = feature.properties.labelFontColor || "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, bubbleX + paddingX, bubbleY + bubbleHeight / 2);
    ctx.restore();
  });
}

function getSnapshotContentMode() {
  return snapshotContentMode?.value || "image";
}

function getSnapshotTileSetLabel(tileSet, index) {
  return tileSet?.label?.trim() || `Img ${index + 1}`;
}

function populateSnapshotTileSetSelect() {
  if (!snapshotTileSetSelect) return;

  const previousValue = snapshotTileSetSelect.value;
  snapshotTileSetSelect.innerHTML = "";
  tileSets().forEach((tileSet, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = getSnapshotTileSetLabel(tileSet, index);
    snapshotTileSetSelect.append(option);
  });

  const hasPrevious =
    previousValue !== "" &&
    Array.from(snapshotTileSetSelect.options).some(
      (option) => option.value === previousValue
    );
  if (hasPrevious) {
    snapshotTileSetSelect.value = previousValue;
    return;
  }

  const checkedIndex = Array.from(
    document.querySelectorAll(".image-checkbox")
  ).findIndex((checkbox) => checkbox.checked);
  snapshotTileSetSelect.value = String(checkedIndex >= 0 ? checkedIndex : 0);
}

function getSnapshotTileSetIndex() {
  const rawIndex = Number.parseInt(snapshotTileSetSelect?.value || "0", 10);
  if (!Number.isFinite(rawIndex)) return 0;
  return Math.min(Math.max(rawIndex, 0), Math.max(tileSets().length - 1, 0));
}

function getSnapshotSelectedTileSet() {
  return tileSets()[getSnapshotTileSetIndex()] || null;
}

function getSnapshotResolutionMode() {
  const mode = snapshotResolutionMode?.value || "current";
  return mode === "native" ? "full" : mode;
}

function getSnapshotImagePixelsPerScreenPixel(selectionRect) {
  const image = viewer.world.getItemAt(0);
  if (!image || !selectionRect) return null;

  const leftPoint = new OpenSeadragon.Point(
    selectionRect.left,
    selectionRect.top + selectionRect.height / 2
  );
  const rightPoint = new OpenSeadragon.Point(
    selectionRect.left + selectionRect.width,
    selectionRect.top + selectionRect.height / 2
  );
  const topPoint = new OpenSeadragon.Point(
    selectionRect.left + selectionRect.width / 2,
    selectionRect.top
  );
  const bottomPoint = new OpenSeadragon.Point(
    selectionRect.left + selectionRect.width / 2,
    selectionRect.top + selectionRect.height
  );

  const leftImage = image.viewportToImageCoordinates(
    viewer.viewport.pointFromPixel(leftPoint)
  );
  const rightImage = image.viewportToImageCoordinates(
    viewer.viewport.pointFromPixel(rightPoint)
  );
  const topImage = image.viewportToImageCoordinates(
    viewer.viewport.pointFromPixel(topPoint)
  );
  const bottomImage = image.viewportToImageCoordinates(
    viewer.viewport.pointFromPixel(bottomPoint)
  );

  return {
    x:
      Math.hypot(rightImage.x - leftImage.x, rightImage.y - leftImage.y) /
      selectionRect.width,
    y:
      Math.hypot(bottomImage.x - topImage.x, bottomImage.y - topImage.y) /
      selectionRect.height,
  };
}

function getSnapshotExportSize(sourceRect = null) {
  if (!snapshotSelectionRect) return null;

  const resolutionMode = getSnapshotResolutionMode();
  if (resolutionMode === "full") {
    const imagePixelsPerScreenPixel = getSnapshotImagePixelsPerScreenPixel(
      snapshotSelectionRect
    );
    if (!imagePixelsPerScreenPixel) return null;
    return {
      width: Math.max(
        1,
        Math.round(snapshotSelectionRect.width * imagePixelsPerScreenPixel.x)
      ),
      height: Math.max(
        1,
        Math.round(snapshotSelectionRect.height * imagePixelsPerScreenPixel.y)
      ),
    };
  }

  const baseWidth = Math.max(
    1,
    Math.round(sourceRect?.width || snapshotSelectionRect.width)
  );
  const baseHeight = Math.max(
    1,
    Math.round(sourceRect?.height || snapshotSelectionRect.height)
  );
  const scale = resolutionMode === "2x" ? 2 : 1;
  return {
    width: Math.max(1, Math.round(baseWidth * scale)),
    height: Math.max(1, Math.round(baseHeight * scale)),
  };
}

function getSnapshotMetersPerOutputPixel(selectionRect, outputWidth) {
  const image = viewer.world.getItemAt(0);
  const scale = pixelsPerMeter();
  if (!image || scale === null || !outputWidth) return null;

  const leftPoint = new OpenSeadragon.Point(
    selectionRect.left,
    selectionRect.top + selectionRect.height / 2
  );
  const rightPoint = new OpenSeadragon.Point(
    selectionRect.left + selectionRect.width,
    selectionRect.top + selectionRect.height / 2
  );
  const leftImage = image.viewportToImageCoordinates(
    viewer.viewport.pointFromPixel(leftPoint)
  );
  const rightImage = image.viewportToImageCoordinates(
    viewer.viewport.pointFromPixel(rightPoint)
  );
  const imagePixelDistance = Math.hypot(
    rightImage.x - leftImage.x,
    rightImage.y - leftImage.y
  );

  return imagePixelDistance / outputWidth / scale;
}

function getNiceSnapshotScaleLength(targetMeters) {
  if (!Number.isFinite(targetMeters) || targetMeters <= 0) return null;

  const exponent = Math.floor(Math.log10(targetMeters));
  const base = 10 ** exponent;
  const normalized = targetMeters / base;
  const niceFactor =
    normalized >= 5 ? 5 : normalized >= 2 ? 2 : normalized >= 1 ? 1 : 0.5;
  return niceFactor * base;
}

function formatSnapshotScaleLabel(meters) {
  if (meters < 0.001) {
    return `${Number((meters * 1e6).toPrecision(3))} um`;
  }
  if (meters < 1) {
    return `${Number((meters * 1000).toPrecision(3))} mm`;
  }
  if (meters < 1000) {
    return `${Number(meters.toPrecision(3))} m`;
  }
  return `${Number((meters / 1000).toPrecision(3))} km`;
}

function getSnapshotScalebarRenderer() {
  const mapper = {
    Metric: OpenSeadragon.ScalebarSizeAndTextRenderer.METRIC_LENGTH,
    Imperial: OpenSeadragon.ScalebarSizeAndTextRenderer.IMPERIAL_LENGTH,
    Astronomical: OpenSeadragon.ScalebarSizeAndTextRenderer.ASTRONOMY,
  };
  const unitSystem =
    document.getElementById("scalebarUnitSystem")?.value || "Metric";
  return mapper[unitSystem] || mapper.Metric;
}

function getSnapshotScalebarType() {
  return document.getElementById("scalebarType")?.value || "Map";
}

function getSnapshotScalebarLocation() {
  return document.getElementById("scalebarLocation")?.value || "Bottom left";
}

function getSnapshotScalebarNumber(id, fallback) {
  const value = Number(document.getElementById(id)?.value);
  return Number.isFinite(value) ? value : fallback;
}

function decodeSnapshotScalebarText(text) {
  const decoder = document.createElement("textarea");
  decoder.innerHTML = text;
  return decoder.value;
}

function getSnapshotScalebarFontSize() {
  const value = document.getElementById("scalebarFontSize")?.value || "medium";
  const mapper = {
    small: 12,
    medium: 14,
    large: 18,
  };
  return mapper[value] || Number.parseFloat(value) || 14;
}

function getSnapshotZoomedScalebarScale(selectionRect, outputCanvas) {
  const bounds = getSnapshotViewerBounds();
  if (!bounds || !selectionRect.width || !selectionRect.height) {
    return {
      x: outputCanvas.width / selectionRect.width,
      y: outputCanvas.height / selectionRect.height,
      ui: outputCanvas.width / selectionRect.width,
    };
  }

  const fitScale = Math.min(
    bounds.width / selectionRect.width,
    bounds.height / selectionRect.height
  );
  const zoomedSelectionWidth = selectionRect.width * fitScale;
  const zoomedSelectionHeight = selectionRect.height * fitScale;
  const x = outputCanvas.width / zoomedSelectionWidth;
  const y = outputCanvas.height / zoomedSelectionHeight;

  return {
    x,
    y,
    ui: Math.min(x, y),
  };
}

function drawSnapshotScalebar(ctx, outputCanvas, selectionRect) {
  if (getSnapshotScalebarType() === "None") return false;

  const metersPerPixel = getSnapshotMetersPerOutputPixel(
    selectionRect,
    outputCanvas.width
  );
  if (metersPerPixel === null) return false;

  const zoomedScale = getSnapshotZoomedScalebarScale(
    selectionRect,
    outputCanvas
  );
  const outputPixelsPerMeter = 1 / metersPerPixel;
  const minWidth =
    getSnapshotScalebarNumber("scalebarMinWidth", 75) * zoomedScale.x;
  const renderer = getSnapshotScalebarRenderer();
  const scalebarProps = renderer(outputPixelsPerMeter, minWidth);

  const barWidth = scalebarProps?.size;
  if (!Number.isFinite(barWidth) || barWidth < 12) return false;

  const lineColor = document.getElementById("scalebarColor")?.value || "#000000";
  const fontColor =
    document.getElementById("scalebarFontColor")?.value || "#000000";
  const backgroundColor =
    document.getElementById("scalebarBackgroundColor")?.value || "#ffffff";
  const backgroundOpacity = Number(
    document.getElementById("scalebarBackgroundOpacity")?.value || 0.65
  );
  const lineWeight =
    Math.max(1, getSnapshotScalebarNumber("scalebarLineWeight", 2)) *
    zoomedScale.ui;
  const fontSize = getSnapshotScalebarFontSize() * zoomedScale.ui;
  const label = decodeSnapshotScalebarText(scalebarProps.text || "");
  const xOffset =
    getSnapshotScalebarNumber("scalebarXOffset", 10) * zoomedScale.x;
  const yOffset =
    getSnapshotScalebarNumber("scalebarYOffset", 10) * zoomedScale.y;
  const textHeight = Math.max(fontSize * 1.25, 12 * zoomedScale.ui);
  const barHeight = textHeight + lineWeight * 2;
  const location = getSnapshotScalebarLocation();
  const x = location.includes("right")
    ? outputCanvas.width - xOffset - barWidth
    : xOffset;
  const y = location.includes("Top")
    ? yOffset
    : outputCanvas.height - yOffset - barHeight;
  const isMapScalebar = getSnapshotScalebarType() === "Map";

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x + barWidth > outputCanvas.width ||
    y + barHeight > outputCanvas.height
  ) {
    return false;
  }

  ctx.save();
  ctx.font = `${fontSize}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = applyOpacityToColor(
    backgroundColor,
    Number.isFinite(backgroundOpacity) ? backgroundOpacity : 0.5
  );
  ctx.fillRect(x, y, barWidth, barHeight);

  ctx.fillStyle = fontColor;
  ctx.fillText(label, x + barWidth / 2, y + textHeight / 2);
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = lineWeight;
  ctx.beginPath();
  if (isMapScalebar) {
    ctx.moveTo(x, y + textHeight);
    ctx.lineTo(x, y + barHeight);
    ctx.lineTo(x + barWidth, y + barHeight);
    ctx.lineTo(x + barWidth, y + textHeight);
  } else {
    const lineY = y + barHeight - lineWeight / 2;
    ctx.moveTo(x, lineY);
    ctx.lineTo(x + barWidth, lineY);
  }
  ctx.stroke();
  ctx.restore();
  return true;
}

function getSnapshotQuality() {
  const qualityValue = Number(snapshotJpegQuality?.value || 92);
  if (!Number.isFinite(qualityValue)) return 0.92;
  return Math.min(1, Math.max(0.5, qualityValue / 100));
}

function getSnapshotFilename() {
  const sampleTitle = (title?.() || "image")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${sampleTitle || "image"}-snapshot-${timestamp}.jpg`;
}

function downloadSnapshotBlob(blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = getSnapshotFilename();
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getTileOpacityGetterForViewer(targetViewer, tileSet, tileSetOpacity = 1) {
  const tiles = tileSet.tiles;
  const periodDegrees = tileSet.periodDegrees;
  if (!periodDegrees) {
    return (index) => (index === scrollIndex % tiles.length ? tileSetOpacity : 0);
  }

  let rotation;
  if (rotateWithStage.checked) {
    rotation =
      ((targetViewer.viewport.getRotation(true) % periodDegrees) + periodDegrees) %
      periodDegrees;
  } else {
    rotation =
      ((parseFloat(document.getElementById("stageRotation").value) % periodDegrees) +
        periodDegrees) %
      periodDegrees;
  }

  let supremumIndex = 0;
  let supremum;
  let infimumIndex;
  let infimum;
  for (let index = 0; index < tiles.length; ++index) {
    if (tiles[index].angleDegrees > rotation) {
      supremumIndex = index;
      break;
    }
  }
  supremum = tiles[supremumIndex].angleDegrees;
  if (supremumIndex === 0) {
    infimumIndex = tiles.length - 1;
    supremum += periodDegrees;
  } else {
    infimumIndex = supremumIndex - 1;
  }
  infimum = tiles[infimumIndex].angleDegrees;

  const infimumImage = tiles[infimumIndex].image;
  const supremumImage = tiles[supremumIndex].image;
  if (infimumImage && supremumImage) {
    const infimumWorldIndex = targetViewer.world.getIndexOfItem(infimumImage);
    const supremumWorldIndex = targetViewer.world.getIndexOfItem(supremumImage);
    const minWorldIndex = Math.min(infimumWorldIndex, supremumWorldIndex);
    const maxWorldIndex = Math.max(infimumWorldIndex, supremumWorldIndex);
    targetViewer.world.setItemIndex(infimumImage, minWorldIndex);
    targetViewer.world.setItemIndex(supremumImage, maxWorldIndex);
  }

  const t = (rotation - infimum) / (supremum - infimum);
  return (index) => {
    switch (index) {
      case infimumIndex:
        return (tileSetOpacity * (1 - t)) / (1 - tileSetOpacity * t);
      case supremumIndex:
        return tileSetOpacity * t;
      default:
        return 0;
    }
  };
}

function applySnapshotTileSetComposition(targetViewer, tileSet, tileSetOpacity = 1) {
  const activeTileImages = [];
  if (!tileSet) return activeTileImages;

  const getTileOpacity = getTileOpacityGetterForViewer(
    targetViewer,
    tileSet,
    tileSetOpacity
  );
  tileSet.tiles.forEach((tile, index) => {
    if (!tile.image) return;
    const tileOpacity = getTileOpacity(index);
    tile.image.setOpacity(tileOpacity);
    tile.image.resetCroppingPolygons();
    if (tileOpacity > 0) {
      activeTileImages.push(tile.image);
    }
  });
  targetViewer.forceRedraw();
  return activeTileImages;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForExportViewerReady(exportViewer, activeTileImages) {
  const startTime = Date.now();
  let lastActivity = Date.now();
  const markActivity = () => {
    lastActivity = Date.now();
  };

  exportViewer.addHandler("tile-loaded", markActivity);
  exportViewer.addHandler("tile-drawn", markActivity);
  exportViewer.addHandler("animation", markActivity);
  exportViewer.addHandler("animation-finish", markActivity);

  try {
    while (Date.now() - startTime < 30000) {
      const relevantTilesLoaded = activeTileImages.every((image) =>
        image && typeof image.getFullyLoaded === "function"
          ? image.getFullyLoaded()
          : Boolean(image)
      );
      if (
        relevantTilesLoaded &&
        !exportViewer.world.needsDraw() &&
        Date.now() - lastActivity > 250
      ) {
        return;
      }
      await wait(100);
    }
    throw new Error("Timed out while loading full-resolution tiles.");
  } finally {
    exportViewer.removeHandler("tile-loaded", markActivity);
    exportViewer.removeHandler("tile-drawn", markActivity);
    exportViewer.removeHandler("animation", markActivity);
    exportViewer.removeHandler("animation-finish", markActivity);
  }
}

async function renderFullResolutionSnapshotBaseCanvas(exportSize) {
  const pixelDensity =
    OpenSeadragon.pixelDensityRatio || window.devicePixelRatio || 1;
  const containerWidth = Math.max(1, Math.ceil(exportSize.width / pixelDensity));
  const containerHeight = Math.max(1, Math.ceil(exportSize.height / pixelDensity));
  const selectionViewportBounds = getSnapshotViewportBounds(snapshotSelectionRect);
  const selectedTileSet = getSnapshotSelectedTileSet();
  const selectedTileSetOpacity = 1;

  const exportContainer = document.createElement("div");
  exportContainer.id = `snapshot-export-${Date.now()}`;
  exportContainer.style.position = "fixed";
  exportContainer.style.left = "-100000px";
  exportContainer.style.top = "0";
  exportContainer.style.width = `${containerWidth}px`;
  exportContainer.style.height = `${containerHeight}px`;
  exportContainer.style.pointerEvents = "none";
  document.body.append(exportContainer);

  const exportViewer = OpenSeadragon({
    id: exportContainer.id,
    prefixUrl: "js/images/",
    showNavigationControl: false,
    mouseNavEnabled: false,
    animationTime: 0,
    blendTime: 0,
    immediateRender: true,
    minZoomImageRatio: 0,
    maxZoomPixelRatio: 100,
    visibilityRatio: 0,
    constrainDuringPan: false,
    crossOriginPolicy: "Anonymous",
  });

  const exportTileSet = selectedTileSet
    ? {
        ...selectedTileSet,
        tiles: selectedTileSet.tiles.map((tile) => ({
          ...tile,
          image: null,
        })),
      }
    : null;

  try {
    if (!exportTileSet) {
      throw new Error("No tile set is available for snapshot export.");
    }

    for (const tile of exportTileSet.tiles) {
        const tileSource = await getTileSource(tile.uri);
        await new Promise((resolve, reject) => {
          exportViewer.addTiledImage({
            tileSource,
            success: (event) => {
              tile.image = event.item;
              resolve();
            },
            error: (event) => {
              reject(
                new Error(event?.message || `Could not load tile source: ${tile.uri}`)
              );
            },
          });
        });
    }

    if (typeof exportViewer.viewport.setFlip === "function") {
      exportViewer.viewport.setFlip(viewer.viewport.getFlip());
    }
    exportViewer.viewport.setRotation(viewer.viewport.getRotation(true), true);
    exportViewer.viewport.fitBounds(selectionViewportBounds, true);

    const activeTileImages = applySnapshotTileSetComposition(
      exportViewer,
      exportTileSet,
      selectedTileSetOpacity
    );
    await waitForExportViewerReady(exportViewer, activeTileImages);
    const sourceCanvas = getOpenSeadragonImageCanvas(exportViewer);
    if (!sourceCanvas) {
      throw new Error("Could not render the full-resolution snapshot.");
    }

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = exportSize.width;
    outputCanvas.height = exportSize.height;
    const ctx = outputCanvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not create the full-resolution snapshot canvas.");
    }
    ctx.drawImage(
      sourceCanvas,
      0,
      0,
      sourceCanvas.width,
      sourceCanvas.height,
      0,
      0,
      outputCanvas.width,
      outputCanvas.height
    );
    return outputCanvas;
  } finally {
    exportViewer.destroy();
    exportContainer.remove();
  }
}

async function exportSnapshotSelection() {
  if (!snapshotSelectionRect) {
    updateSnapshotStatus("Draw a rectangle before exporting.");
    return;
  }

  let outputCanvas = null;
  let ctx = null;
  const sourceCanvas = getOpenSeadragonImageCanvas();
  const sourceRect = sourceCanvas
    ? getSnapshotSourceRect(sourceCanvas, snapshotSelectionRect)
    : null;
  const exportSize = getSnapshotExportSize(sourceRect);
  if (!exportSize) {
    updateSnapshotStatus("Could not determine the snapshot resolution.");
    return;
  }
  const exportLimitError = getSnapshotExportLimitError(exportSize);
  if (exportLimitError) {
    updateSnapshotStatus(
      `${exportLimitError} Zoom in or choose a lower resolution.`
    );
    return;
  }

  try {
    outputCanvas =
      getSnapshotResolutionMode() === "current"
        ? renderVisibleSnapshotBaseCanvas(sourceCanvas, sourceRect, exportSize)
        : await renderFullResolutionSnapshotBaseCanvas(exportSize);
    ctx = outputCanvas?.getContext("2d");
    if (!ctx || !outputCanvas) {
      updateSnapshotStatus("Could not create the snapshot canvas.");
      return;
    }

    const contentMode = getSnapshotContentMode();
    if (contentMode === "annotations" || contentMode === "labels") {
      drawSnapshotAnnotationShapes(ctx, outputCanvas, snapshotSelectionRect);
      drawSnapshotPointAnnotations(ctx, outputCanvas, snapshotSelectionRect);
    }
    if (contentMode === "labels") {
      drawSnapshotAnnotationLabels(ctx, outputCanvas, snapshotSelectionRect);
    }

    const scalebarRequested = Boolean(snapshotIncludeScalebar?.checked);
    const scalebarDrawn = scalebarRequested
      ? drawSnapshotScalebar(ctx, outputCanvas, snapshotSelectionRect)
      : false;

    outputCanvas.toBlob(
      (blob) => {
        if (!blob) {
          updateSnapshotStatus("Could not encode the JPG snapshot.");
          return;
        }
        downloadSnapshotBlob(blob);
        clearSnapshotSelection();
        updateSnapshotStatus(
          scalebarRequested && !scalebarDrawn
            ? "Snapshot exported without scalebar; scale unknown."
            : "Snapshot exported."
        );
      },
      "image/jpeg",
      getSnapshotQuality()
    );
  } catch (error) {
    console.error("Snapshot export failed:", error);
    updateSnapshotStatus("Snapshot export was blocked by image security.");
  }
}

function closeElectronActionTray() {
  if (!electronActionTray || !electronActionButton) return;

  electronActionTray.hidden = true;
  electronActionButton.setAttribute("aria-expanded", "false");
}

function closeViewerToolsTray() {
  if (!viewerToolsTray || !viewerToolsButton) return;

  viewerToolsTray.hidden = true;
  viewerToolsButton.setAttribute("aria-expanded", "false");
}

function toggleElectronActionTray() {
  if (!electronActionTray || !electronActionButton) return;

  const willOpen = electronActionTray.hidden;
  electronActionTray.hidden = !willOpen;
  electronActionButton.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) closeViewerToolsTray();

  if (willOpen) {
    const firstAction = electronActionTray.querySelector(
      ".electron-action-item:not([hidden])"
    );
    firstAction?.focus();
  }
}

function toggleViewerToolsTray() {
  if (!viewerToolsTray || !viewerToolsButton) return;

  const willOpen = viewerToolsTray.hidden;
  viewerToolsTray.hidden = !willOpen;
  viewerToolsButton.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) closeElectronActionTray();

  if (willOpen) {
    const firstTool = viewerToolsTray.querySelector(
      ".electron-action-item:not([hidden])"
    );
    firstTool?.focus();
  }
}

if (hasElectronActions && electronActionButton && electronActionTray) {
  loadLibraryButton.hidden = true;
  electronActionButton.hidden = false;
  if (viewerToolsButton) viewerToolsButton.hidden = false;
  moveGridCountControlsToPalette();
  moveAnnotateControlsToPalette();
  moveMeasureControlsToPalette();

  electronActionButton.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    toggleElectronActionTray();
  });

  viewerToolsButton?.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    toggleViewerToolsTray();
  });

  electronActionTray.addEventListener("click", function (event) {
    event.stopPropagation();
  });

  viewerToolsTray?.addEventListener("click", function (event) {
    event.stopPropagation();
  });

  document.addEventListener("click", function () {
    closeElectronActionTray();
    closeViewerToolsTray();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeElectronActionTray();
      closeViewerToolsTray();
      closeGridCountPalette();
      closeMeasurePalette();
      closeSnapshotPalette();
      closeScaleWizard();
      if (tileSetEditor && !tileSetEditor.hidden) {
        closeTileSetEditor();
        return;
      }
      closeLibraryEditor();
    }
  });
}

if (loadLibraryButton) {
  loadLibraryButton.addEventListener("click", function (event) {
    event.preventDefault();

    if (window.electronAPI?.selectExistingJsonFile) {
      loadLibraryWithElectronDialog();
      return;
    }

    loadLibraryInput.click();
  });
}

if (hasElectronActions && openGridCountPaletteButton && gridCountPalette) {
  openGridCountPaletteButton.hidden = false;
  openGridCountPaletteButton.setAttribute("aria-pressed", "false");
  openGridCountPaletteButton.addEventListener("click", function (event) {
    event.preventDefault();
    closeViewerToolsTray();
    toggleGridCountPalette();
  });
  closeGridCountPaletteButton?.addEventListener("click", function () {
    closeGridCountPalette();
  });
  minimizeGridCountPaletteButton?.addEventListener("click", function () {
    toggleToolPaletteMinimized(
      gridCountPalette,
      minimizeGridCountPaletteButton
    );
  });
  makeToolPaletteDraggable(
    gridCountPalette,
    gridCountPaletteHeader,
    "petroImage.gridCountPalette"
  );
  window.addEventListener("resize", function () {
    closeCountDropdowns();
    clampToolPaletteToViewer(gridCountPalette);
  });
}

if (window.ResizeObserver && controlsPanel) {
  const controlsResizeObserver = new ResizeObserver(() => {
    clampOpenToolPalettes();
  });
  controlsResizeObserver.observe(controlsPanel);
}

if (controlsPanel && minimizeControlsButton) {
  minimizeControlsButton.addEventListener("click", function () {
    const isMinimized = controlsPanel.classList.toggle("controls-minimized");
    minimizeControlsButton.setAttribute("aria-pressed", String(isMinimized));
    minimizeControlsButton.setAttribute(
      "aria-label",
      isMinimized ? "Expand image controls" : "Minimize image controls"
    );
    minimizeControlsButton.title = isMinimized
      ? "Expand image controls"
      : "Minimize image controls";
    if (isMinimized) {
      const imageSettingsMenu = document.getElementById("imageSettingsMenu");
      if (imageSettingsMenu) {
        imageSettingsMenu.style.display = "none";
      }
    }
    clampOpenToolPalettes();
  });
}

if (hasElectronActions && openAnnotatePaletteButton && annotatePalette) {
  openAnnotatePaletteButton.hidden = false;
  openAnnotatePaletteButton.setAttribute("aria-pressed", "false");
  openAnnotatePaletteButton.addEventListener("click", function (event) {
    event.preventDefault();
    closeViewerToolsTray();
    toggleAnnotatePalette();
  });
  closeAnnotatePaletteButton?.addEventListener("click", function () {
    closeAnnotatePalette();
  });
  minimizeAnnotatePaletteButton?.addEventListener("click", function () {
    toggleToolPaletteMinimized(annotatePalette, minimizeAnnotatePaletteButton);
  });
  makeToolPaletteDraggable(
    annotatePalette,
    annotatePaletteHeader,
    "petroImage.annotatePalette"
  );
  window.addEventListener("resize", function () {
    closeAnnotationSettingsPopover();
    clampToolPaletteToViewer(annotatePalette);
  });
}

if (hasElectronActions && openMeasurePaletteButton && measurePalette) {
  openMeasurePaletteButton.hidden = false;
  openMeasurePaletteButton.setAttribute("aria-pressed", "false");
  openMeasurePaletteButton.addEventListener("click", function (event) {
    event.preventDefault();
    closeViewerToolsTray();
    toggleMeasurePalette();
  });
  closeMeasurePaletteButton?.addEventListener("click", function () {
    closeMeasurePalette();
  });
  minimizeMeasurePaletteButton?.addEventListener("click", function () {
    toggleToolPaletteMinimized(measurePalette, minimizeMeasurePaletteButton);
  });
  makeToolPaletteDraggable(
    measurePalette,
    measurePaletteHeader,
    "petroImage.measurePalette"
  );
  window.addEventListener("resize", function () {
    closeCircleSettingsPopover();
    clampToolPaletteToViewer(measurePalette);
  });
}

if (hasElectronActions && openSnapshotPaletteButton && snapshotPalette) {
  openSnapshotPaletteButton.hidden = false;
  openSnapshotPaletteButton.setAttribute("aria-pressed", "false");
  openSnapshotPaletteButton.addEventListener("click", function (event) {
    event.preventDefault();
    closeViewerToolsTray();
    toggleSnapshotPalette();
  });
  closeSnapshotPaletteButton?.addEventListener("click", function () {
    closeSnapshotPalette();
  });
  minimizeSnapshotPaletteButton?.addEventListener("click", function () {
    toggleToolPaletteMinimized(snapshotPalette, minimizeSnapshotPaletteButton);
  });
  snapshotDrawButton?.addEventListener("click", function () {
    restoreToolPaletteFromMinimized(
      snapshotPalette,
      minimizeSnapshotPaletteButton
    );
    startSnapshotDrawMode();
  });
  snapshotClearButton?.addEventListener("click", function () {
    stopSnapshotDrawMode({ clearSelection: true });
  });
  snapshotExportButton?.addEventListener("click", function () {
    exportSnapshotSelection();
  });
  makeToolPaletteDraggable(
    snapshotPalette,
    snapshotPaletteHeader,
    "petroImage.snapshotPalette"
  );
  window.addEventListener("resize", function () {
    clampToolPaletteToViewer(snapshotPalette);
    if (snapshotSelectionRect) {
      clearSnapshotSelection();
      updateSnapshotStatus("Draw a new area after resizing the viewer.");
    }
  });
}

snapshotSelectionBody?.addEventListener("pointerdown", function (event) {
  startSnapshotAdjustment(event, "move");
});

snapshotSelection?.querySelectorAll("[data-handle]").forEach((handle) => {
  handle.addEventListener("pointerdown", function (event) {
    startSnapshotAdjustment(event, "resize", handle.dataset.handle || "");
  });
});

[
  snapshotTileSetSelect,
  snapshotContentMode,
  snapshotResolutionMode,
  snapshotIncludeScalebar,
].forEach((element) => {
  element?.addEventListener("change", function () {
    updateSnapshotStatus();
  });
});

window.addEventListener("pointermove", function (event) {
  if (!snapshotAdjustState) return;
  updateSnapshotRectFromAdjustment(event.clientX, event.clientY);
});

window.addEventListener("pointerup", function () {
  finishSnapshotAdjustment();
});

if (actionLoadLibraryButton && window.electronAPI?.selectExistingJsonFile) {
  actionLoadLibraryButton.addEventListener("click", function (event) {
    event.preventDefault();
    closeElectronActionTray();
    loadLibraryWithElectronDialog();
  });
}

if (changeProjectButton && window.electronAPI?.changeProjectLibrary) {
  changeProjectButton.hidden = false;
  changeProjectButton.addEventListener("click", function (event) {
    event.preventDefault();
    closeElectronActionTray();
    changeProjectWithElectronDialog();
  });
}

if (openScaleWizardButton && window.electronAPI) {
  openScaleWizardButton.hidden = false;
  openScaleWizardButton.addEventListener("click", function (event) {
    event.preventDefault();
    closeElectronActionTray();
    openScaleWizard();
  });
}

if (openLibraryEditorButton && window.electronAPI) {
  openLibraryEditorButton.hidden = false;
  openLibraryEditorButton.addEventListener("click", function (event) {
    event.preventDefault();
    closeElectronActionTray();
    openLibraryEditor();
  });
}

loadLibraryInput.addEventListener("change", function (event) {
  if (window.electronAPI?.selectExistingJsonFile) {
    event.target.value = "";
    return;
  }

  const fileInput = event.target;
  const file = fileInput.files[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = function (event) {
    const sampleJSON = event.target.result;

    try {
      const parsedJSON = JSON.parse(sampleJSON);
      loadSampleJSON(parsedJSON);
    } catch (error) {
      console.error("Error parsing JSON file:", error);
    }
    // Reset file input
    fileInput.value = "";
  };
  reader.readAsText(file);
  // Close the menu
  const menu = document.getElementById("imageSettingsMenu");
  menu.style.display = "none";
});

// Parse URL for query parameters
function getQueryParameter(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

function populateGroupDropdown() {
  const groupDropdown = document.getElementById("groupDropdown");
  groupDropdown.innerHTML = ""; // Clear existing
  const uniqueGroups = Object.keys(groupMapping);

  uniqueGroups.forEach((group) => {
    const option = document.createElement("option");
    option.value = group;
    option.textContent = group;
    groupDropdown.appendChild(option);
  });

  // Add event listener to update the sample dropdown on group change
  groupDropdown.addEventListener("change", function () {
    const selectedGroup = this.value;
    populateSampleDropdown(selectedGroup);
  });
}

// Function to populate sample dropdown based on the selected group
function populateSampleDropdown(selectedGroup, options = {}) {
  const { autoSelect = true } = options;
  const sampleDropdown = document.getElementById("sampleDropdown");
  sampleDropdown.innerHTML = ""; // Clear existing options

  if (groupMapping[selectedGroup]) {
    groupMapping[selectedGroup].forEach((index) => {
      const option = document.createElement("option");
      option.value = index; // Store index as value
      option.textContent = samples[index].title;
      sampleDropdown.appendChild(option);
    });
    // Automatically select the first sample in the group
    if (sampleDropdown.options.length > 0) {
      sampleDropdown.currentIndex = 0; // Select the first option
      if (autoSelect) {
        sampleDropdown.dispatchEvent(new Event("change")); // Trigger the change event
      }
    }
  }
}

// Initialize the OpenSeadragon viewer
const viewer = OpenSeadragon({
  maxZoomPixelRatio: 100,
  id: "viewer-container",
  prefixUrl: "js/images/",
  zoomPerClick: 1, // Disable zoom on click (or shift+click)
  sequenceMode: false,
  showNavigationControl: false, // Disable the default navigation controls
  crossOriginPolicy: "Anonymous",
});

viewer.addHandler("tile-load-failed", handleTileLoadFailed);

async function handleTileLoadFailed(event) {
  if (!window.electronAPI?.showTileLoadWarning) {
    return;
  }

  const warningKey = `${currentIndex}:${tileLoadGeneration}`;
  if (
    tileLoadFailureWarningInFlight ||
    tileLoadFailureWarningKey === warningKey
  ) {
    return;
  }

  tileLoadFailureWarningInFlight = true;
  tileLoadFailureWarningKey = warningKey;

  try {
    await window.electronAPI.showTileLoadWarning({
      sampleTitle: title(),
      tileUrl: event?.tile?.getUrl?.() || "",
      tilePath: getLocalTilePathFromUrl(event?.tile?.getUrl?.() || ""),
      message: event?.message || "",
    });
  } catch (error) {
    console.error("Could not show tile-load warning:", error);
  } finally {
    tileLoadFailureWarningInFlight = false;
  }
}

function getLocalTilePathFromUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.searchParams.get("path") || "";
  } catch {
    return "";
  }
}

/// Event listener for sample selection change (only add once)
document
  .getElementById("sampleDropdown")
  .addEventListener("change", async function () {
    try {
      currentIndex = Number(this.value);
      closeScaleWizard();
      stopSnapshotDrawMode({ clearSelection: true });
      buildImageCheckboxes();
      buildOpacitySliders();
      clearAnnotations();
      annotationHistory.reset();
      updateImageCheckboxLabels();
      clearGrid();
      enableGridButtons();
      disableCountButtons();
      removeAoiRectangle();
      resetOpacitySliders();
      resetLockStage();
      updateOpacityImageSliderVisibility();
      updateOpacitySliderLabels();
      if (measurementControlsInitialized) {
        resetMeasurements(true);
      }
      document.getElementById("enableDivideImages").checked = true;
      enableDivideImages = true;
      const canLoadTiles = await confirmSampleTilesAvailable();
      if (!canLoadTiles) {
        return;
      }
      await loadTileSet();
      displayImages();
      toggleOnImages();
      resetRotation();
      updateStageRotationCheck();
      updateScaleDependentControls();
      addScalebar();
    } catch (error) {
      console.error("[sample-switch] failed", error);
      throw error;
    }

    const annoJSONButtonContainer = document.getElementById("loadAnnoFromJSON");
    annoJSONButtonContainer.innerHTML = "";

    // Check if the selected sample has annotations
    const annotationFileOptions = normalizeAnnotationFileOptions(
      annotationFiles[title()]
    );
    if (annotationFileOptions.length > 0) {
      hasAnnotationInJSON = true;
      const button = document.createElement("button");
      button.textContent = "Load Existing Annotations";
      button.id = "loadAnnoFromJSONButton";
      button.className = "custom-button";
      button.style.setProperty("--button-width", "170px"); // button.style.display = "block"; // Make sure the button is visible
      annoJSONButtonContainer.appendChild(button);

      if (annotationFileOptions.length === 1) {
        button.onclick = () => loadAnnotationsFromJSON(annotationFileOptions[0]);
      } else {
        const dropdown = document.createElement("div");
        dropdown.id = "loadAnnoFromJSONDropdown";
        dropdown.className = "annotation-json-dropdown";
        dropdown.style.display = "none";

        annotationFileOptions.forEach((file, index) => {
          const optionButton = document.createElement("button");
          optionButton.type = "button";
          optionButton.textContent = getAnnotationFileLabel(
            file,
            index,
            annotationFileOptions.length
          );
          optionButton.title = file;
          optionButton.addEventListener("click", () => {
            dropdown.style.display = "none";
            loadAnnotationsFromJSON(file);
          });
          dropdown.appendChild(optionButton);
        });

        button.onclick = (event) => {
          event.stopPropagation();
          dropdown.style.display =
            dropdown.style.display === "block" ? "none" : "block";
        };

        annoJSONButtonContainer.appendChild(dropdown);
      }
    } else {
      hasAnnotationInJSON = false;
    }
  });

function normalizeAnnotationFileOptions(annotationEntry) {
  if (Array.isArray(annotationEntry)) {
    return annotationEntry.filter((file) => typeof file === "string" && file);
  }

  if (typeof annotationEntry === "string" && annotationEntry) {
    return [annotationEntry];
  }

  return [];
}

function getAnnotationFileLabel(file, index) {
  const pathWithoutQuery = file.split(/[?#]/)[0];
  const fileName = pathWithoutQuery.split(/[\\/]/).filter(Boolean).pop();

  if (!fileName) {
    return `Annotations ${index + 1}`;
  }

  return decodeURIComponent(fileName).replace(/\.(geo)?json$/i, "");
}

document.addEventListener("click", function (event) {
  const dropdown = document.getElementById("loadAnnoFromJSONDropdown");
  const button = document.getElementById("loadAnnoFromJSONButton");

  if (!dropdown || !button) return;

  if (!dropdown.contains(event.target) && event.target !== button) {
    dropdown.style.display = "none";
  }
});

// Function to update the image checkbox labels based on tileLabels array
function updateImageCheckboxLabels() {
  const checkboxes = document.querySelectorAll(".image-checkbox");

  checkboxes.forEach((checkbox, i) => {
    const label = checkbox.nextElementSibling;
    const tileSet = tileSets()[i];
    if (!tileSet || !label) return;

    const tiles = tileSet.tiles;
    if (!tiles || tiles.length === 0) return;

    const visibleTileIndex = scrollIndex % tiles.length;
    const tileLabel = tiles[visibleTileIndex]?.label;

    label.textContent = tileLabel || tileSet.label || `Img ${i + 1}`;
  });
}

function toggleOnImages() {
  const checkboxes = document.querySelectorAll(".image-checkbox");
  const count = tileSets().length;

  checkboxes.forEach((checkbox, i) => {
    if (i < count) {
      checkbox.checked = i === 0;
    }
  });

  displayImages();
}

// TODO: Only select the first image upon first load (not currently working
// because the image is undefined when toggleImage() is called)
function deselectAllButFirstImage() {
  for (let i = 1; i <= 4; i++) {
    const checkbox = document.getElementById(`image${i}`);
    if (checkbox) {
      if (i > 1 && checkbox.checked === true) {
        toggleImage(checkbox, i);
      }
    }
  }
}

// Function to update the label dynamically for opacity sliders
function updateOpacitySliderLabels() {
  const sliderRows = document.querySelectorAll(
    "#checkboxOpacityContainer > div"
  );

  sliderRows.forEach((row, i) => {
    const label = row.querySelector("label");
    const tileSet = tileSets()[i];

    if (!tileSet) {
      row.style.display = "none";
      return;
    }

    row.style.display = "";
    label.textContent = tileSet.label || `Img ${i + 1}`;
  });
}

const tooltip = document.getElementById("tooltip-desc");
const infoButton = document.getElementById("info-button-desc");
// Show tooltip with sample info on hover
function showTooltip() {
  const description = samples[currentIndex].description;
  if (description) {
    tooltip.textContent = description;
    tooltip.style.display = "block";
    const buttonRect = infoButton.getBoundingClientRect();
    // Wait for the tooltip to be displayed before calculating its height
    const tooltipHeight = tooltip.offsetHeight;
    // Align tooltip vertically centered with the button
    tooltip.style.top = `${buttonRect.top - tooltipHeight}px`;
    // Position tooltip directly to the right of the button
    tooltip.style.left = `${buttonRect.right + 2}px`; // Align to the right, accounting for scrolling
  }
}

// Hide tooltip when not hovering
function hideTooltip() {
  tooltip.style.display = "none";
}

// Event listeners for tooltip
infoButton.addEventListener("mouseenter", showTooltip);
infoButton.addEventListener("mouseleave", hideTooltip);

// TODO: Testing HTML pop-up when button is clicked
infoButton.addEventListener("click", function () {
  const info = samples[currentIndex].info;
  if (info) {
    fetch(info)
      .then((response) => response.text())
      .then((data) => {
        document.getElementById("info-modal-body").innerHTML = data;
        document.getElementById("info-modal").style.display = "block";
      });
  } else {
    return;
  }
});

document.querySelector(".close-btn").addEventListener("click", function () {
  document.getElementById("info-modal").style.display = "none";
});

// Close modal when clicking outside of content
window.onclick = function (event) {
  if (event.target === document.getElementById("info-modal")) {
    document.getElementById("info-modal").style.display = "none";
  }
};

// A message to discourage loss of data upon reload
// let hasUnsavedAnnotations = false;
// let hasUnsavedCounts = false;
window.appState = {
  hasUnsavedAnnotations: false,
  hasUnsavedCounts: false,
};

let suppressUnsavedAnnotationTracking = false;
let suppressUnsavedCountTracking = false;
let annotationHistoryPaused = false;
let activeAnnotationDraft = null;
let polyDraftRedoStack = [];
let ellipseDraftRedoStack = [];
let gridControlHistoryCommittedThisEvent = false;
let lastCommittedGridControlState = null;
const GRID_CONTROL_IDS = [
  "show-aoi",
  "grid-left",
  "grid-left-value",
  "grid-right",
  "grid-right-value",
  "grid-top",
  "grid-top-value",
  "grid-bottom",
  "grid-bottom-value",
  "step-size",
  "no-points",
  "gridLabelFontSize",
  "gridLabelFontSizeAfter",
  "gridLabelFontColor",
  "gridLabelFontColorAfter",
  "gridLabelBackgroundColor",
  "gridLabelBackgroundColorAfter",
  "gridLabelBackgroundOpacity",
  "gridLabelBackgroundOpacityAfter",
  "gridLineWeight",
  "gridLineWeightAfter",
  "gridLineOpacity",
  "gridLineOpacityAfter",
  "gridLineColor",
  "gridLineColorAfter",
];
const GRID_CONTROL_HISTORY_LABELS = {
  "show-aoi": "Change AOI visibility",
  "grid-left": "Change AOI",
  "grid-left-value": "Change AOI",
  "grid-right": "Change AOI",
  "grid-right-value": "Change AOI",
  "grid-top": "Change AOI",
  "grid-top-value": "Change AOI",
  "grid-bottom": "Change AOI",
  "grid-bottom-value": "Change AOI",
  "step-size": "Change grid step size",
  "no-points": "Change grid point count",
  gridLabelFontSize: "Change grid label style",
  gridLabelFontSizeAfter: "Change counted label style",
  gridLabelFontColor: "Change grid label style",
  gridLabelFontColorAfter: "Change counted label style",
  gridLabelBackgroundColor: "Change grid label style",
  gridLabelBackgroundColorAfter: "Change counted label style",
  gridLabelBackgroundOpacity: "Change grid label style",
  gridLabelBackgroundOpacityAfter: "Change counted label style",
  gridLineWeight: "Change grid point style",
  gridLineWeightAfter: "Change counted point style",
  gridLineOpacity: "Change grid point style",
  gridLineOpacityAfter: "Change counted point style",
  gridLineColor: "Change grid point style",
  gridLineColorAfter: "Change counted point style",
};

const annotationHistory = {
  limit: 100,
  undoStack: [],
  redoStack: [],

  push(label, state = cloneAnnotationState()) {
    if (annotationHistoryPaused || suppressUnsavedAnnotationTracking) return;

    this.undoStack.push({
      label,
      state,
    });

    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
    }

    this.redoStack = [];
    updateAnnotationHistoryControls();
  },

  reset() {
    this.undoStack = [];
    this.redoStack = [];
    updateAnnotationHistoryControls();
  },

  undo() {
    if (this.undoStack.length === 0) return;

    const previous = this.undoStack.pop();
    this.redoStack.push({
      label: previous.label,
      state: cloneAnnotationState(),
    });
    restoreAnnotationState(previous.state);
    unsavedAnnotations(true);
    unsavedCounts(true);
    updateAnnotationHistoryControls();
  },

  redo() {
    if (this.redoStack.length === 0) return;

    const next = this.redoStack.pop();
    this.undoStack.push({
      label: next.label,
      state: cloneAnnotationState(),
    });
    restoreAnnotationState(next.state);
    unsavedAnnotations(true);
    unsavedCounts(true);
    updateAnnotationHistoryControls();
  },
};

function cloneData(value) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // Some runtime objects in Electron cannot be structured-cloned; the app
      // state snapshots are JSON-like, so JSON cloning is the right fallback.
    }
  }
  return JSON.parse(JSON.stringify(value));
}

function cloneAnnotationState() {
  return {
    annoJSON: cloneData(annoJSON),
    annoJSONTemp: {
      type: "FeatureCollection",
      features: [],
    },
    countJSON: cloneData(countJSON),
    grid: cloneData(grid),
    gridApplied,
    gridControls: cloneGridControlState(),
    selectedAnnotationUuid,
    selectedAnnotationUuids: [...selectedAnnotationUuids],
    selectedCountId: document.getElementById("count-id")?.value || "1",
  };
}

function cloneGridControlState() {
  return Object.fromEntries(
    GRID_CONTROL_IDS.map((id) => {
      const element = document.getElementById(id);
      if (!element) return [id, undefined];
      if (element.type === "checkbox") return [id, element.checked];
      return [id, element.value];
    })
  );
}

function restoreGridControlState(values = {}) {
  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (!element || value === undefined) return;
    if (element.type === "checkbox") {
      element.checked = Boolean(value);
    } else {
      element.value = value;
    }
  });

  constrainGridSliders();
  updateAoiRectangle();
  lastCommittedGridControlState = cloneGridControlState();
}

function hasDraftUndo() {
  return (
    (activeAnnotationDraft === "poly" && clickImageCoordinates.length > 0) ||
    (activeAnnotationDraft === "ellipse" && ellipseImageCoordinates.length > 0)
  );
}

function hasDraftRedo() {
  return (
    (activeAnnotationDraft === "poly" && polyDraftRedoStack.length > 0) ||
    (activeAnnotationDraft === "ellipse" && ellipseDraftRedoStack.length > 0)
  );
}

function resetAnnotationDraftRedo() {
  polyDraftRedoStack = [];
  ellipseDraftRedoStack = [];
  updateAnnotationHistoryControls();
}

function clearAnnotationDraftState() {
  activeAnnotationDraft = null;
  resetAnnotationDraftRedo();
}

function clearTransientAnnotationShortcutState() {
  ["KeyQ", "KeyZ", "KeyX", "KeyC", "KeyV"].forEach((code) => {
    pressedKeys?.delete(code);
    if (typeof keyTimestamps !== "undefined") {
      delete keyTimestamps[code];
    }
  });

  isQPressed = false;
  isZPressed = false;
  isXPressed = false;
  isCPressed = false;
  isVPressed = false;

  if (!pointButton?.classList.contains("active")) {
    toggleCrosshairFloaterOn(false);
  }
  if (!rectButton?.classList.contains("active")) {
    toggleRectFloaterOn(false);
  }
  if (!polylineButton?.classList.contains("active")) {
    togglePolylineFloaterOn(false);
  }
  if (!polygonButton?.classList.contains("active")) {
    togglePolygonFloaterOn(false);
  }
  if (!ellipseButton?.classList.contains("active")) {
    toggleEllipseFloaterOn(false);
  }
  if (!circleAnnotationButton?.classList.contains("active")) {
    isCircleAnnotationMode = false;
    toggleCircleAnnotationFloaterOn(false);
  }
}

function getDraftCursorImagePoint() {
  const image = viewer.world.getItemAt(0);
  if (!image || !mousePos) return null;

  const rect = viewerContainer.getBoundingClientRect();
  const positionPoint = new OpenSeadragon.Point(
    mousePos.x - rect.left,
    mousePos.y - rect.top
  );
  const viewportPoint = viewer.viewport.pointFromPixel(positionPoint);
  const imagePoint = image.viewportToImageCoordinates(
    viewportPoint.x,
    viewportPoint.y
  );

  return [imagePoint.x, imagePoint.y];
}

function redrawAnnotationDraft() {
  annoJSONTemp = {
    type: "FeatureCollection",
    features: [],
  };

  const cursorImagePoint = getDraftCursorImagePoint();

  if (activeAnnotationDraft === "poly" && clickImageCoordinates.length > 0) {
    currentPolyStyleColors = getCurrentAnnotationStyleColors(
      currentPolyStyleColors
    );
    const draftCoordinates = cursorImagePoint
      ? [...clickImageCoordinates, cursorImagePoint]
      : clickImageCoordinates;
    addPolylineToGeoJSON(annoJSONTemp, draftCoordinates, {
      labelFontSize: Number(document.getElementById("annoLabelFontSize").value),
      labelFontColor: currentPolyStyleColors.labelFontColor,
      labelBackgroundColor: currentPolyStyleColors.labelBackgroundColor,
      labelBackgroundOpacity: getAnnotationOpacityValue(
        "annoLabelBackgroundOpacity"
      ),
      lineStyle: document.getElementById("lineStyle").value,
      lineWeight: Number(document.getElementById("lineWeight").value),
      lineColor: currentPolyStyleColors.lineColor,
      lineOpacity: getAnnotationOpacityValue("lineOpacity"),
    });
  }

  if (
    activeAnnotationDraft === "ellipse" &&
    ellipseImageCoordinates.length > 0 &&
    cursorImagePoint
  ) {
    currentEllipseStyleColors = getCurrentAnnotationStyleColors(
      currentEllipseStyleColors
    );
    const commonStyle = {
      labelFontSize: Number(document.getElementById("annoLabelFontSize").value),
      labelFontColor: currentEllipseStyleColors.labelFontColor,
      labelBackgroundColor: currentEllipseStyleColors.labelBackgroundColor,
      labelBackgroundOpacity: getAnnotationOpacityValue(
        "annoLabelBackgroundOpacity"
      ),
      lineStyle: document.getElementById("lineStyle").value,
      lineWeight: Number(document.getElementById("lineWeight").value),
      lineColor: currentEllipseStyleColors.lineColor,
      lineOpacity: getAnnotationOpacityValue("lineOpacity"),
    };

    if (ellipseImageCoordinates.length === 1) {
      const longAxisImagePoints = getLongAxisLine([
        ellipseImageCoordinates[0],
        cursorImagePoint,
      ]);
      addPolylineToGeoJSON(annoJSONTemp, [...longAxisImagePoints], commonStyle);
    }

    if (ellipseImageCoordinates.length === 2) {
      const ellipseTempPoints = getEllipsePoints([
        ellipseImageCoordinates[0],
        ellipseImageCoordinates[1],
        cursorImagePoint,
      ]);
      addPolygonToGeoJSON(annoJSONTemp, [...ellipseTempPoints], {
        ...commonStyle,
        fillColor: currentEllipseStyleColors.fillColor,
        fillOpacity: getAnnotationOpacityValue("fillOpacity"),
      });
    }
  }

  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
}

function undoAnnotationDraftPoint() {
  if (activeAnnotationDraft === "poly" && clickImageCoordinates.length > 0) {
    polyDraftRedoStack.push({
      viewport: clickCoordinates.pop(),
      image: clickImageCoordinates.pop(),
    });
    if (clickImageCoordinates.length === 0) {
      activelyMakingPoly = false;
      currentPolyStyleColors = null;
    }
    redrawAnnotationDraft();
    updateAnnotationHistoryControls();
    return true;
  }

  if (
    activeAnnotationDraft === "ellipse" &&
    ellipseImageCoordinates.length > 0
  ) {
    ellipseDraftRedoStack.push({
      viewport: ellipseCoordinates.pop(),
      image: ellipseImageCoordinates.pop(),
    });
    if (ellipseImageCoordinates.length === 0) {
      activelyMakingEllipse = false;
      currentEllipseStyleColors = null;
    }
    redrawAnnotationDraft();
    updateAnnotationHistoryControls();
    return true;
  }

  return false;
}

function redoAnnotationDraftPoint() {
  if (activeAnnotationDraft === "poly" && polyDraftRedoStack.length > 0) {
    const point = polyDraftRedoStack.pop();
    clickCoordinates.push(point.viewport);
    clickImageCoordinates.push(point.image);
    activelyMakingPoly = true;
    redrawAnnotationDraft();
    updateAnnotationHistoryControls();
    return true;
  }

  if (
    activeAnnotationDraft === "ellipse" &&
    ellipseDraftRedoStack.length > 0
  ) {
    const point = ellipseDraftRedoStack.pop();
    ellipseCoordinates.push(point.viewport);
    ellipseImageCoordinates.push(point.image);
    activelyMakingEllipse = true;
    redrawAnnotationDraft();
    updateAnnotationHistoryControls();
    return true;
  }

  return false;
}

function removeAnnotationOverlays() {
  removeAnnotationVertexHandles();

  [...document.getElementsByClassName("annotate-label")].forEach((label) => {
    const container = label.closest(".annotation-overlay");
    viewer.removeOverlay(container || label);
    container?.remove();
    label.remove();
  });

  [...document.getElementsByClassName("annotate-crosshairs")].forEach(
    (crosshair) => {
      viewer.removeOverlay(crosshair);
      crosshair.remove();
    }
  );

  annotateLabels = [];
  annotatePoints = [];
}

function applyAnnotationVisibilityState() {
  const showAnnotations = document.getElementById("show-annotations").checked;
  const showLabels = document.getElementById("show-annotation-labels").checked;

  for (let el of document.getElementsByClassName("annotate-crosshairs")) {
    const visible =
      showAnnotations && isAnnotationUuidVisible(el.dataset.annotationUuid);
    el.style.visibility = visible ? "visible" : "hidden";
  }

  for (let el of document.getElementsByClassName("annotate-label")) {
    const visible =
      showAnnotations &&
      showLabels &&
      isAnnotationUuidVisible(el.dataset.annotationUuid);
    el.style.visibility = visible ? "visible" : "hidden";
  }

  polyCanvas.style.display = showAnnotations ? "block" : "none";
}

function renderAnnotationOverlaysFromJSON() {
  const image = viewer.world.getItemAt(0);
  if (!image) return;

  annoJSON.features.forEach((feature) => {
    if (!feature.geometry || !feature.properties) return;

    const props = feature.properties;
    const viewportPoint = image.imageToViewportCoordinates(
      new OpenSeadragon.Point(props.xLabel, props.yLabel)
    );

    addText(
      props.uuid,
      props.label || "",
      viewportPoint,
      "anno",
      props.labelFontColor,
      Number(props.labelFontSize),
      props.labelBackgroundColor,
      Number(props.labelBackgroundOpacity)
    );

    if (feature.geometry.type === "Point") {
      addCrosshairs(
        props.uuid,
        viewportPoint,
        "anno",
        props.lineColor,
        Number(props.lineWeight),
        Number(props.lineOpacity)
      );
    }
  });

  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  applyAnnotationVisibilityState();
}

function removeCountOverlays() {
  [...document.getElementsByClassName("grid-label")].forEach((label) => {
    const container = label.closest(".annotation-overlay");
    viewer.removeOverlay(container || label);
    container?.remove();
    label.remove();
  });

  [...document.getElementsByClassName("grid-crosshairs")].forEach(
    (crosshair) => {
      viewer.removeOverlay(crosshair);
      crosshair.remove();
    }
  );
}

function applyGridVisibilityState() {
  const showGrid = document.getElementById("show-grid").checked;
  const showLabels = document.getElementById("show-grid-labels").checked;

  for (let el of document.getElementsByClassName("grid-crosshairs")) {
    el.style.visibility = showGrid ? "visible" : "hidden";
  }

  for (let el of document.getElementsByClassName("grid-label")) {
    el.style.visibility = showGrid && showLabels ? "visible" : "hidden";
  }
}

function renderCountOverlaysFromJSON() {
  const image = viewer.world.getItemAt(0);
  if (!image) return;

  countJSON.features.forEach((feature) => {
    if (!feature.geometry || !feature.properties) return;

    const props = feature.properties;
    const [x, y] = feature.geometry.coordinates;
    const viewportPoint = image.imageToViewportCoordinates(
      new OpenSeadragon.Point(x, y)
    );

    addText(
      props.uuid,
      props.label,
      viewportPoint,
      "grid",
      props.labelFontColor,
      props.labelFontSize,
      props.labelBackgroundColor,
      props.labelBackgroundOpacity
    );
    addCrosshairs(
      props.uuid,
      viewportPoint,
      "grid",
      props.lineColor,
      props.lineWeight,
      props.lineOpacity
    );
  });

  applyFormattingAfterCountAll(countJSON, "both");
  applyGridVisibilityState();
}

function restoreCountGridState(state) {
  suppressUnsavedCountTracking = true;
  try {
    removeCountOverlays();
    countJSON = cloneData(state.countJSON || { type: "FeatureCollection", features: [] });
    grid = new Grid(state.grid || {
      xMin: 20,
      yMin: 10,
      xMax: 80,
      yMax: 90,
      step: 1000,
      noPoints: 600,
    });
    gridApplied = Boolean(state.gridApplied);
    restoreGridControlState(state.gridControls);
    renderCountOverlaysFromJSON();

    const selectedId = Math.min(
      Number(state.selectedCountId) || 1,
      countJSON.features.length || 1
    );
    document.getElementById("count-id").value = selectedId;

    if (countJSON.features.length > 0) {
      enableCountButtons();
      disableGridOptions();
      document.getElementById("apply-grid-settings").disabled = true;
      document.getElementById("clear-grid").disabled = false;
      inputSampleLabelFromOverlay();
    } else {
      disableCountButtons();
      enableGridOptions();
      document.getElementById("apply-grid-settings").disabled = false;
      document.getElementById("clear-grid").disabled = true;
      document.getElementById("count-text").value = "";
      document.getElementById("count-notes").value = "";
    }

    populateDropdown();
    populateFilterDropdown();
    filterOverlays();
  } finally {
    suppressUnsavedCountTracking = false;
  }
}

function restoreAnnotationState(state) {
  suppressUnsavedAnnotationTracking = true;
  try {
    exitAnnotationVertexEditMode();
    exitAnnotationShapeEditMode();
    removeAnnotationOverlays();
    annoJSON = cloneData(state.annoJSON);
    annoJSON.features.forEach(normalizeAnnotationFeature);
    annoJSONTemp = cloneData(state.annoJSONTemp);
    renderAnnotationOverlaysFromJSON();
    renderAnnotationList();

    if (annoJSON.features.length > 0) {
      enableAnnoButtons();
      const restoredUuid =
        getAnnotationByUuid(state.selectedAnnotationUuid)?.properties.uuid ||
        null;
      const restoredUuids = Array.isArray(state.selectedAnnotationUuids)
        ? state.selectedAnnotationUuids
        : restoredUuid
          ? [restoredUuid]
          : [];
      setAnnotationSelection(restoredUuids, restoredUuid);
    } else {
      selectedAnnotationUuid = null;
      selectedAnnotationUuids = new Set();
      annotationListSelectionAnchorUuid = null;
      disableAnnoButtons();
      document.getElementById("anno-label").value = "";
      document.getElementById("anno-notes").value = "";
      syncSelectedAnnotationVisuals();
    }

    restoreCountGridState(state);
  } finally {
    suppressUnsavedAnnotationTracking = false;
  }
}

function updateAnnotationHistoryControls() {
  const undoButton = document.getElementById("undoButton");
  const redoButton = document.getElementById("redoButton");

  if (undoButton) {
    const canUndoDraft = hasDraftUndo();
    const canUndo = canUndoDraft || annotationHistory.undoStack.length > 0;
    undoButton.disabled = !canUndo;
    undoButton.title = canUndoDraft
      ? "Undo drawing point"
      : canUndo
      ? `Undo ${
          annotationHistory.undoStack[annotationHistory.undoStack.length - 1]
            .label
        }`
      : "Undo";
  }

  if (redoButton) {
    const canRedoDraft = hasDraftRedo();
    const canRedo = canRedoDraft || annotationHistory.redoStack.length > 0;
    redoButton.disabled = !canRedo;
    redoButton.title = canRedoDraft
      ? "Redo drawing point"
      : canRedo
      ? `Redo ${
          annotationHistory.redoStack[annotationHistory.redoStack.length - 1]
            .label
        }`
      : "Redo";
  }
}

function setupAnnotationHistoryControls() {
  const undoButton = document.getElementById("undoButton");
  const redoButton = document.getElementById("redoButton");

  undoButton?.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    clearTransientAnnotationShortcutState();
    if (!undoAnnotationDraftPoint()) {
      annotationHistory.undo();
    }
  });

  redoButton?.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    clearTransientAnnotationShortcutState();
    if (!redoAnnotationDraftPoint()) {
      annotationHistory.redo();
    }
  });

  updateAnnotationHistoryControls();
}

setupAnnotationHistoryControls();

// TOOD: A new function for changing hasUnsavedAnnotations
function unsavedAnnotations(value) {
  if (suppressUnsavedAnnotationTracking) return;

  if (value) {
    window.appState.hasUnsavedAnnotations = true;
  } else {
    window.appState.hasUnsavedAnnotations = false;
  }
  if (window.electronAPI) {
    const unsaved =
      window.appState.hasUnsavedAnnotations || window.appState.hasUnsavedCounts;
    window.electronAPI.setUnsavedState(unsaved);
  }
}

function unsavedCounts(value) {
  if (suppressUnsavedCountTracking) return;

  if (value) {
    window.appState.hasUnsavedCounts = true;
  } else {
    window.appState.hasUnsavedCounts = false;
  }
  if (window.electronAPI) {
    const unsaved =
      window.appState.hasUnsavedAnnotations || window.appState.hasUnsavedCounts;
    window.electronAPI.setUnsavedState(unsaved);
  }
}

window.addEventListener("beforeunload", function (e) {
  // Detect if running in Electron
  const isElectron = navigator.userAgent.toLowerCase().includes("electron");

  if (isElectron) {
    // Let Electron handle the close — do NOT block
    return;
  }

  // Check if there's unsaved data or any other condition for triggering the warning
  if (
    window.appState.hasUnsavedAnnotations ||
    window.appState.hasUnsavedCounts
  ) {
    // Browser case: warn the user
    e.preventDefault();
    e.returnValue = ""; // Required for Chrome to show the confirmation dialog
  }
});

//////////////
// Scalebar //
//////////////

// Initialize the scalebar, except for pixelsPerMeter, which depends on the grid
// settings.
function removeScalebar() {
  if (viewer.scalebarInstance) {
    viewer.scalebar({
      type: 0,
      pixelsPerMeter: null,
      location: 0,
    });
  }
  updateSnapshotStatus();
}

function addScalebar() {
  const scale = pixelsPerMeter();
  if (scale === null) {
    document.getElementById("scalebarType").value = "None";
    removeScalebar();
    return;
  }

  if (document.getElementById("scalebarType").value === "None") {
    document.getElementById("scalebarType").value = "Map";
  }
  const scalebarType = document.getElementById("scalebarType").value;

  const locationMapper = {
    "Top left": OpenSeadragon.ScalebarLocation.TOP_LEFT,
    "Top right": OpenSeadragon.ScalebarLocation.TOP_RIGHT,
    "Bottom left": OpenSeadragon.ScalebarLocation.BOTTOM_LEFT,
    "Bottom right": OpenSeadragon.ScalebarLocation.BOTTOM_RIGHT,
  };

  const typeMapper = {
    None: 0,
    Map: OpenSeadragon.ScalebarType.MAP,
    Microscopy: OpenSeadragon.ScalebarType.MICROSCOPY,
  };

  const systemMapper = {
    Metric: OpenSeadragon.ScalebarSizeAndTextRenderer.METRIC_LENGTH,
    Imperial: OpenSeadragon.ScalebarSizeAndTextRenderer.IMPERIAL_LENGTH,
    Astronomical: OpenSeadragon.ScalebarSizeAndTextRenderer.ASTRONOMY,
  };

  const scalebarUnitSystem =
    document.getElementById("scalebarUnitSystem").value;
  const scalebarMinWidth =
    document.getElementById("scalebarMinWidth").value || 75;
  const scalebarLocation = document.getElementById("scalebarLocation").value;
  const scalebarXOffset =
    document.getElementById("scalebarXOffset").value || 10;
  const scalebarYOffset =
    document.getElementById("scalebarYOffset").value || 10;
  const scalebarColor =
    document.getElementById("scalebarColor").value || "#000000";
  const scalebarFontColor =
    document.getElementById("scalebarFontColor").value || "#000000";
  const scalebarBackgroundColor =
    document.getElementById("scalebarBackgroundColor").value || "#ffffff";
  const scalebarBackgroundOpacity =
    document.getElementById("scalebarBackgroundOpacity").value || 0.5;
  const scalebarFontSize =
    document.getElementById("scalebarFontSize").value || "medium";
  const scalebarBarThickness =
    document.getElementById("scalebarLineWeight").value || 2;

  const scalebarBackgroundColorToPlot = applyOpacityToColor(
    scalebarBackgroundColor,
    scalebarBackgroundOpacity
  );

  // Remove previous scalebar DOM
  // const existingScalebar = document.querySelector(".openseadragon-scalebar");
  // if (existingScalebar) existingScalebar.remove();
  // if (existingScalebar) viewer.scalebarInstance = null;

  viewer.scalebar({
    type: typeMapper[scalebarType],
    unitSystem: systemMapper[scalebarUnitSystem],
    sizeAndTextRenderer: systemMapper[scalebarUnitSystem],
    minWidth: scalebarMinWidth + "px",
    location: locationMapper[scalebarLocation],
    xOffset: parseInt(scalebarXOffset),
    yOffset: parseInt(scalebarYOffset),
    stayInsideImage: false,
    color: scalebarColor,
    fontColor: scalebarFontColor,
    backgroundColor: scalebarBackgroundColorToPlot,
    fontSize: scalebarFontSize,
    barThickness: parseInt(scalebarBarThickness),
    pixelsPerMeter: scale,
  });
  updateSnapshotStatus();
}

function restoreScalebarDefaults() {
  const scalebarBackgroundColorToPlot = applyOpacityToColor("#ffffff", 0.5);
  const scale = pixelsPerMeter();
  const defaultScalebarType = scale === null ? "None" : "Map";

  // Reset scalebar settings to default values
  document.getElementById("scalebarType").value = defaultScalebarType;
  document.getElementById("scalebarUnitSystem").value = "Metric";
  document.getElementById("scalebarMinWidth").value = 75;
  document.getElementById("scalebarLocation").value = "Bottom left";
  document.getElementById("scalebarXOffset").value = 10;
  document.getElementById("scalebarYOffset").value = 10;
  document.getElementById("scalebarColor").value = "#000000";
  document.getElementById("scalebarFontColor").value = "#000000";
  document.getElementById("scalebarBackgroundColor").value = "#ffffff";
  document.getElementById("scalebarBackgroundOpacity").value = 0.5;
  document.getElementById("scalebarFontSize").value = "medium";
  document.getElementById("scalebarLineWeight").value = 2;

  viewer.scalebar({
    type: scale === null ? 0 : OpenSeadragon.ScalebarType.MAP,
    unitSystem: "Metric",
    sizeAndTextRenderer:
      OpenSeadragon.ScalebarSizeAndTextRenderer.METRIC_LENGTH,
    minWidth: "75px",
    location: OpenSeadragon.ScalebarLocation.BOTTOM_LEFT,
    xOffset: 10,
    yOffset: 10,
    stayInsideImage: false,
    color: "#000000",
    fontColor: "#000000",
    backgroundColor: scalebarBackgroundColorToPlot,
    fontSize: "medium",
    barThickness: 2,
    pixelsPerMeter: scale,
  });
  updateSnapshotStatus();
}

function setControlDisabled(id, disabled, disabledTitle = "") {
  const element = document.getElementById(id);
  if (!element) return;

  element.disabled = disabled;
  if (disabled) {
    if (!element.dataset.enabledTitle) {
      element.dataset.enabledTitle = element.title || "";
    }
    element.title = disabledTitle;
  } else if (element.dataset.enabledTitle !== undefined) {
    element.title = element.dataset.enabledTitle;
    delete element.dataset.enabledTitle;
  }
}

function setMeasurementControlsToIdle() {
  const showMeasure = document.getElementById("show-measure");
  const measurementButton = document.getElementById("toggleMeasurementButton");
  const circleButton = document.getElementById("toggleCircleButton");

  if (showMeasure) showMeasure.checked = false;
  if (measurementButton) {
    measurementButton.classList.remove("active");
    measurementButton.textContent = "Start Measuring";
  }
  if (circleButton) {
    circleButton.classList.remove("active");
    circleButton.textContent = "Draw Circle";
  }
  measurementModeActive = false;
  circleModeActive = false;
}

function updateScaleDependentControls() {
  const hasScale = hasKnownScale();
  const disabledTitle = "Requires a known image scale.";
  const scalebarControlIds = [
    "scalebarType",
    "scalebarUnitSystem",
    "scalebarLocation",
    "scalebarMinWidth",
    "scalebarXOffset",
    "scalebarYOffset",
    "scalebarColor",
    "scalebarFontColor",
    "scalebarBackgroundColor",
    "scalebarBackgroundOpacity",
    "scalebarFontSize",
    "scalebarLineWeight",
    "restoreScalebarDedfaults",
  ];
  const measurementControlIds = [
    "show-measure",
    "toggleMeasurementButton",
    "toggleCircleButton",
    "circleGearButton",
    "distanceUnits",
    "areaUnits",
    "ECDUnits",
    "circleUnits",
    "circle",
  ];

  scalebarControlIds.forEach((id) => {
    setControlDisabled(id, !hasScale, disabledTitle);
  });
  measurementControlIds.forEach((id) => {
    setControlDisabled(id, !hasScale, disabledTitle);
  });
  updateCircleAnnotationOptionsControls();

  if (!hasScale) {
    document.getElementById("scalebarType").value = "None";
    const showMeasure = document.getElementById("show-measure");
    if (showMeasure && showMeasure.checked) {
      showMeasure.dataset.disabledByNoScale = "true";
    }
    disableGridOptions();
    document.getElementById("apply-grid-settings").disabled = true;
    document.getElementById("clear-grid").disabled = true;
    disableCountButtons();
    setMeasurementControlsToIdle();
    if (measureCanvas) measureCanvas.style.display = "none";
  } else {
    const showMeasure = document.getElementById("show-measure");
    if (showMeasure?.dataset.disabledByNoScale === "true") {
      showMeasure.checked = true;
      delete showMeasure.dataset.disabledByNoScale;
    }
    if (measureCanvas && showMeasure) {
      measureCanvas.style.display = showMeasure.checked ? "block" : "none";
    }
    enableGridOptions();
    enableGridButtons();
  }
}

// Load the images for the tile set at the given index within the currently
// selected sample's tile sets.
async function confirmSampleTilesAvailable() {
  if (!window.electronAPI?.validateSampleTiles) {
    return true;
  }

  const validationResult = await window.electronAPI.validateSampleTiles(
    tileSets().map(serializeTileSetForLibrary)
  );
  if (validationResult.ok) {
    return true;
  }

  if (!window.electronAPI?.confirmSlowTiles) {
    return false;
  }

  return window.electronAPI.confirmSlowTiles(validationResult);
}

async function loadTileSet() {
  const loadGeneration = ++tileLoadGeneration;
  const sampleIndex = currentIndex;

  // Remove any previously loaded images from the viewer.
  viewer.world.removeAll();

  // Load and store tiled images.
  for (let tileSet of tileSets()) {
    for (let tile of tileSet.tiles) {
      tile.image = null;
      const tileSource = await getTileSource(tile.uri);
      if (loadGeneration !== tileLoadGeneration || sampleIndex !== currentIndex) {
        return;
      }

      viewer.addTiledImage({
        tileSource,
        success: (event) => {
          if (loadGeneration !== tileLoadGeneration || sampleIndex !== currentIndex) {
            return;
          }

          tile.image = event.item;
          displayImages();
        },
      });
    }
  }
}

async function getTileSource(uri) {
  if (
    typeof uri === "string" &&
    window.electronAPI?.getLocalDziTileSource &&
    isLocalTileSourcePath(uri)
  ) {
    return window.electronAPI.getLocalDziTileSource(uri);
  }

  return uri;
}

function isLocalTileSourcePath(uri) {
  return (
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(uri) &&
    (/\.dzi$/i.test(uri) || /^\/|^[A-Za-z]:[\\/]/.test(uri))
  );
}

const viewerContainer = document.getElementById("viewer-container");

// Share the mouse position between event handlers.
let mousePos = new OpenSeadragon.Point(0, 0);

// Update the appearance of the images for the currently selected sample. Note
// that all images in the sample must have the same position and size. For
// samples with multiple tile sets, the viewer will be divided into equal
// sectors (one for each tile set) centered at the current mouse position. This
// function also applies image opacity and blending.
const displayImages = () => {
  // Bail out if there are no images.
  if (viewer.world.getItemCount() === 0) {
    return;
  }

  const checkboxes = document.querySelectorAll(".image-checkbox");
  const sliders = document.querySelectorAll(".opacity-slider");

  // Determine the number of enabled tile sets ahead of time so we know how big
  // to make each sector.
  const isChecked = [];
  let totalChecked = 0;
  for (let i = 0; i < tileSets().length; ++i) {
    const checked = checkboxes[i]?.checked ?? false;
    isChecked.push(checked);
    if (checked) {
      ++totalChecked;
    }
  }

  // Guard against divide-by-zero if everything is unchecked
  if (totalChecked === 0) {
    tileSets().forEach((tileSet) => {
      tileSet.tiles.forEach((tile) => {
        if (tile.image) {
          tile.image.setOpacity(0);
          tile.image.resetCroppingPolygons();
        }
      });
    });
    viewer.forceRedraw();
    return;
  }

  // Set the radius of each sector's polygon to an arbitrary value large enough
  // that the sector's arc is outside the viewport.
  const radius = 4 * Math.max(window.innerWidth, window.innerHeight);
  // Place the first image in a sector with its most clockwise radius facing up.
  const startAngle = -Math.PI / 2 - (2 * Math.PI) / totalChecked;

  // Set the cropping polygon for each image.
  let sectionsLeft = totalChecked;

  tileSets().forEach((tileSet, i) => {
    const tiles = tileSet.tiles;

    const endAngle = (-2 * Math.PI * sectionsLeft) / totalChecked;
    const windowPolygon = [mousePos];
    // Define the sector's arc using four points to ensure the polygon is
    // well-formed even if the tile set has fewer than three tiles.
    for (let p = 0; p < 4; ++p) {
      const angle = startAngle + (p * endAngle) / 3;
      windowPolygon.push(
        new OpenSeadragon.Point(
          mousePos.x + radius * Math.cos(angle),
          mousePos.y + radius * Math.sin(angle)
        )
      );
    }

    if (isChecked[i]) {
      --sectionsLeft;
    }

    const sliderValue = sliders[i]?.value ?? 100;
    const tileSetOpacity = sliderValue / 100;
    // Disable slider if the corresponding checkbox is unchecked
    if (sliders[i]) {
      sliders[i].disabled = !isChecked[i];
    }
    const getTileOpacity = getTileOpacityGetter(tileSet, tileSetOpacity);

    tiles.forEach((tile, j) => {
      const image = tile.image;
      if (!image) {
        // Image is not loaded yet.
        return;
      }
      const tileOpacity = isChecked[i] ? getTileOpacity(j) : 0;
      image.setOpacity(tileOpacity);

      // Divide the tile sets into sectors, if image division is enabled.
      if (enableDivideImages) {
        image.setCroppingPolygons([
          windowPolygon.map((p) => image.viewerElementToImageCoordinates(p)),
        ]);
      } else {
        image.resetCroppingPolygons();
      }
    });
  });
  viewer.forceRedraw();
};

// Returns a function that can be used to set the opacity of each tile in the
// given tile set, according to its index.
const getTileOpacityGetter = (tileSet, tileSetOpacity) => {
  const tiles = tileSet.tiles;
  const periodDegrees = tileSet.periodDegrees;
  if (!periodDegrees) {
    // If the tile set does not have a period, the tiles are just independent
    // images that can be scrolled through. Only show the selected tile.
    return (index) =>
      index === scrollIndex % tiles.length ? tileSetOpacity : 0;
  }

  // If the tile set does have a period, its tiles should be treated as
  // different angles of the same image, and the displayed image should be
  // interpolated between the tiles closest to the current viewport angle.
  let rotation;
  if (rotateWithStage.checked) {
    rotation =
      ((viewer.viewport.getRotation(true) % periodDegrees) + periodDegrees) %
      periodDegrees;
  } else {
    rotation =
      ((parseFloat(document.getElementById("stageRotation").value) %
        periodDegrees) +
        periodDegrees) %
      periodDegrees;
  }
  let supremumIndex = 0;
  let supremum;
  let infimumIndex;
  let infimum;
  // Find the first tile whose angle is greater than the target.
  for (let j = 0; j < tiles.length; ++j) {
    if (tiles[j].angleDegrees > rotation) {
      supremumIndex = j;
      break;
    }
  }
  supremum = tiles[supremumIndex].angleDegrees;
  if (supremumIndex === 0) {
    // Wrap around the tile list.
    infimumIndex = tiles.length - 1;
    supremum += periodDegrees;
  } else {
    infimumIndex = supremumIndex - 1;
  }
  infimum = tiles[infimumIndex].angleDegrees;

  // TODO: Handle the case where the smallest available angle is not 0.

  // Ensure infimum image is underneath supremum image, if both are loaded.
  const infimumImage = tiles[infimumIndex].image;
  const supremumImage = tiles[supremumIndex].image;
  if (infimumImage && supremumImage) {
    const infimumWorldIndex = viewer.world.getIndexOfItem(infimumImage);
    const supremumWorldIndex = viewer.world.getIndexOfItem(supremumImage);
    const minWorldIndex = Math.min(infimumWorldIndex, supremumWorldIndex);
    const maxWorldIndex = Math.max(infimumWorldIndex, supremumWorldIndex);
    viewer.world.setItemIndex(infimumImage, minWorldIndex);
    viewer.world.setItemIndex(supremumImage, maxWorldIndex);
  }

  // Show the underlying tile at full opacity and the superimposed tile at the
  // interpolated opacity, and hide all other tiles.
  const t = (rotation - infimum) / (supremum - infimum);
  return (index) => {
    switch (index) {
      case infimumIndex:
        return (tileSetOpacity * (1 - t)) / (1 - tileSetOpacity * t);
      case supremumIndex:
        return tileSetOpacity * t;
      default:
        return 0;
    }
  };
};

const toggleGridCrosshairs = (event) => {
  for (let el of document.getElementsByClassName("grid-crosshairs")) {
    el.style.visibility = event.checked ? "visible" : "hidden";
  }
};

const toggleGridLabels = (event) => {
  for (let el of document.getElementsByClassName("grid-label")) {
    el.style.visibility = event.checked ? "visible" : "hidden";
  }
};

viewer.addHandler("animation", displayImages);

// Update grid slider values as slider moves
const slider_1 = document.getElementById("grid-left");
const sliderValue_1 = document.getElementById("grid-left-value");
const slider_2 = document.getElementById("grid-right");
const sliderValue_2 = document.getElementById("grid-right-value");
const slider_3 = document.getElementById("grid-top");
const sliderValue_3 = document.getElementById("grid-top-value");
const slider_4 = document.getElementById("grid-bottom");
const sliderValue_4 = document.getElementById("grid-bottom-value");

function normalizeGridValue(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(numericValue)));
}

function syncGridValueDisplay(slider, valueInput) {
  valueInput.value = slider.value;
}

function setGridSliderValue(slider, valueInput, value) {
  const previousSliderValue = slider.value;
  const nextValue = String(normalizeGridValue(value));
  if (previousSliderValue !== nextValue) {
    const undoState = cloneAnnotationState();
    undoState.gridControls[slider.id] = previousSliderValue;
    undoState.gridControls[valueInput.id] = previousSliderValue;
    annotationHistory.push("Change AOI", undoState);
  }

  slider.value = nextValue;
  syncGridValueDisplay(slider, valueInput);
  slider.dispatchEvent(new Event("input"));
  enableGridButtons();
  lastCommittedGridControlState = cloneGridControlState();
}

function setupUndoableGridControl(id, label) {
  const element = document.getElementById(id);
  if (!element) return;
  element.committedGridControls = cloneGridControlState();

  const capture = () => {
    element.undoState = cloneAnnotationState();
    element.undoValue =
      element.type === "checkbox" ? element.checked : element.value;
  };

  const commit = () => {
    const currentValue =
      element.type === "checkbox" ? element.checked : element.value;
    const previousValue =
      element.undoValue !== undefined
        ? element.undoValue
        : element.committedGridControls?.[id];

    if (currentValue !== previousValue) {
      const undoState = element.undoState || cloneAnnotationState();
      if (!element.undoState && element.committedGridControls) {
        undoState.gridControls = cloneData(element.committedGridControls);
      }
      annotationHistory.push(label, undoState);
      gridControlHistoryCommittedThisEvent = true;
    }
    element.committedGridControls = cloneGridControlState();
    element.undoState = null;
    element.undoValue = undefined;
  };

  element.addEventListener("pointerdown", capture);
  element.addEventListener("focusin", capture);
  element.addEventListener("beforeinput", function () {
    if (!element.undoState) {
      capture();
    }
  });
  element.addEventListener("keydown", function (event) {
    if (!element.undoState && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) {
      capture();
    }
    if (event.key === "Enter") {
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.blur();
    }
  });
  element.addEventListener("change", commit);
}

[
  ["show-aoi", "Change AOI visibility"],
  ["grid-left", "Change AOI"],
  ["grid-left-value", "Change AOI"],
  ["grid-right", "Change AOI"],
  ["grid-right-value", "Change AOI"],
  ["grid-top", "Change AOI"],
  ["grid-top-value", "Change AOI"],
  ["grid-bottom", "Change AOI"],
  ["grid-bottom-value", "Change AOI"],
  ["step-size", "Change grid step size"],
  ["no-points", "Change grid point count"],
  ["gridLabelFontSize", "Change grid label style"],
  ["gridLabelFontSizeAfter", "Change counted label style"],
  ["gridLabelFontColor", "Change grid label style"],
  ["gridLabelFontColorAfter", "Change counted label style"],
  ["gridLabelBackgroundColor", "Change grid label style"],
  ["gridLabelBackgroundColorAfter", "Change counted label style"],
  ["gridLabelBackgroundOpacity", "Change grid label style"],
  ["gridLabelBackgroundOpacityAfter", "Change counted label style"],
  ["gridLineWeight", "Change grid point style"],
  ["gridLineWeightAfter", "Change counted point style"],
  ["gridLineOpacity", "Change grid point style"],
  ["gridLineOpacityAfter", "Change counted point style"],
  ["gridLineColor", "Change grid point style"],
  ["gridLineColorAfter", "Change counted point style"],
].forEach(([id, label]) => setupUndoableGridControl(id, label));

lastCommittedGridControlState = cloneGridControlState();
document.addEventListener("change", function (event) {
  const id = event.target?.id;
  if (!GRID_CONTROL_IDS.includes(id)) return;

  if (gridControlHistoryCommittedThisEvent) {
    gridControlHistoryCommittedThisEvent = false;
    lastCommittedGridControlState = cloneGridControlState();
    return;
  }

  const currentState = cloneGridControlState();
  if (
    JSON.stringify(currentState) !== JSON.stringify(lastCommittedGridControlState)
  ) {
    const undoState = cloneAnnotationState();
    undoState.gridControls = cloneData(lastCommittedGridControlState);
    annotationHistory.push(
      GRID_CONTROL_HISTORY_LABELS[id] || "Change grid setting",
      undoState
    );
    lastCommittedGridControlState = currentState;
  }
});

function constrainGridSliders() {
  if (parseInt(slider_1.value) > parseInt(slider_2.value)) {
    slider_1.value = slider_2.value;
  }

  if (parseInt(slider_3.value) > parseInt(slider_4.value)) {
    slider_3.value = slider_4.value;
  }

  syncGridValueDisplay(slider_1, sliderValue_1);
  syncGridValueDisplay(slider_2, sliderValue_2);
  syncGridValueDisplay(slider_3, sliderValue_3);
  syncGridValueDisplay(slider_4, sliderValue_4);
}

sliderValue_1.addEventListener("change", () => {
  setGridSliderValue(slider_1, sliderValue_1, sliderValue_1.value);
});
sliderValue_2.addEventListener("change", () => {
  setGridSliderValue(slider_2, sliderValue_2, sliderValue_2.value);
});
sliderValue_3.addEventListener("change", () => {
  setGridSliderValue(slider_3, sliderValue_3, sliderValue_3.value);
});
sliderValue_4.addEventListener("change", () => {
  setGridSliderValue(slider_4, sliderValue_4, sliderValue_4.value);
});

function buildImageCheckboxes() {
  const numTileSets = tileSets().length;
  const container = document.getElementById("imageCheckboxContainer");
  container.innerHTML = "";

  for (let i = 0; i < numTileSets; i++) {
    const div = document.createElement("div");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = i === 0;
    checkbox.className = "image-checkbox";
    checkbox.dataset.index = i;
    checkbox.addEventListener("change", displayImages);

    const label = document.createElement("label");
    label.textContent = `Img ${i + 1}`;

    div.appendChild(checkbox);
    div.appendChild(label);
    container.appendChild(div);
  }
  populateSnapshotTileSetSelect();
}

function buildOpacitySliders() {
  const numTileSets = tileSets().length;
  const container = document.getElementById("checkboxOpacityContainer");
  container.innerHTML = "";

  for (let i = 0; i < numTileSets; i++) {
    const div = document.createElement("div");
    div.className = "opacity-slider-row";

    const label = document.createElement("label");
    label.className = "opacity-slider-label";
    label.textContent = `Img ${i + 1}`;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = 0;
    slider.max = 100;
    slider.value = 100;
    slider.className = "opacity-slider";
    slider.dataset.index = i;

    const valueInput = document.createElement("input");
    valueInput.type = "number";
    valueInput.min = 0;
    valueInput.max = 100;
    valueInput.step = 1;
    valueInput.value = 100;
    valueInput.className = "slider-value opacity-slider-value";
    valueInput.title = "Opacity percentage";

    const setOpacityValue = (value) => {
      const opacityValue = Math.max(0, Math.min(100, Number(value) || 0));
      slider.value = opacityValue;
      valueInput.value = opacityValue;
      displayImages();
    };

    slider.addEventListener("input", () => {
      valueInput.value = slider.value;
      displayImages();
    });

    valueInput.addEventListener("change", () => {
      setOpacityValue(valueInput.value);
    });

    div.appendChild(label);
    div.appendChild(slider);
    div.appendChild(valueInput);
    container.appendChild(div);
  }
}

function resetOpacitySliders() {
  // Find all range sliders inside the image settings menu
  const sliders = document.querySelectorAll(
    "#imageSettingsMenu input[type='range']"
  );

  sliders.forEach((sliderInput) => {
    sliderInput.value = 100; // Reset slider to 100%

    // If your slider is connected to an image opacity function:
    const imageIndex = sliderInput.dataset.imageIndex; // assuming you store index or ID
    if (imageIndex !== undefined) {
      updateImageOpacity(imageIndex, 1); // set actual image opacity to 1 (100%)
    }

    // Update the displayed slider value, if there’s an input next to it
    const sliderValueInput =
      sliderInput.parentElement.querySelector(".slider-value");
    if (sliderValueInput) {
      sliderValueInput.value = sliderInput.value;
    }
  });
}

// function updateOpacityImageSliderVisibility() {
//   // Get all slider container divs
//   const sliders = document.querySelectorAll("#imageSettingsMenu > div > div");

//   // Loop through all sliders and adjust visibility
//   sliders.forEach((slider, index) => {
//     if (index < tileSets().length) {
//       slider.style.display = "block"; // Show the slider
//       // Reset the slider value to 100
//       const sliderInput = slider.querySelector("input[type='range']");
//       const sliderValueSpan = slider.querySelector(".slider-value");
//       if (sliderInput) {
//         sliderInput.value = 100; // Reset slider to 100

//         // Attach an event listener to dynamically update opacity
//         sliderInput.addEventListener("input", () => {
//           setTileSetOpacity();
//           // Update the displayed slider value
//           if (sliderValueSpan) {
//             sliderValueSpan.textContent = `${sliderInput.value}%`;
//           }
//         });
//       }
//       if (sliderValueSpan) {
//         sliderValueSpan.textContent = "100%"; // Update displayed value
//       }
//     } else {
//       slider.style.display = "none"; // Hide the slider
//     }
//   });
// }

function updateOpacityImageSliderVisibility() {
  const sliderContainers = document.querySelectorAll(
    "#checkboxOpacityContainer > div"
  );

  sliderContainers.forEach((container, index) => {
    const sliderInput = container.querySelector("input.opacity-slider");
    const sliderValueInput = container.querySelector(".slider-value");

    if (index < tileSets().length) {
      container.style.display = "block";

      if (sliderInput) {
        sliderInput.value = 100;
      }
      if (sliderValueInput) {
        sliderValueInput.value = 100;
      }
    } else {
      container.style.display = "none";
    }
  });

  // Let displayImages handle actual opacity updates
  displayImages();
}

// Constrain values of sliders and update the value display for slider1
slider_1.addEventListener("input", function () {
  constrainGridSliders();
});
// Update the value display for slider2 and ensure slider1 stays within bounds
slider_2.addEventListener("input", function () {
  constrainGridSliders();
});
// Update the value display for slider3
slider_3.addEventListener("input", function () {
  constrainGridSliders();
});
// Update the value display for slider2 and ensure slider3 stays within bounds
slider_4.addEventListener("input", function () {
  constrainGridSliders();
});

///////////////////////////////////
//// Annotations functionality ////
///////////////////////////////////

let pointButton = document.getElementById("crosshairButton");
let polylineButton = document.getElementById("polylineButton");
let rectButton = document.getElementById("rectangleButton");
let repeatButton = document.getElementById("repeatButton");
let promptLabelButton = document.getElementById("promptLabelButton");
let moveAnnotationButton = document.getElementById("moveAnnotationButton");
let moveAnnotationLabelButton = document.getElementById(
  "moveAnnotationLabelButton"
);
let polygonButton = document.getElementById("polygonButton");
let ellipseButton = document.getElementById("ellipseButton");
let circleAnnotationButton = document.getElementById("circleAnnotationButton");

// Flags to track modes
let isPointMode = false;
let isPolylineMode = false;
let isRectangleMode = false;
let isRepeatMode = false;
let isPromptLabelMode = false;
let isAnnotationMoveMode = false;
let isAnnotationLabelMoveMode = false;
let isPolygonMode = false;
let isEllipseMode = false;
let isCircleAnnotationMode = false;
let circleAnnotationCenter = null;
let circleAnnotationCenterImage = null;
let currentCircleAnnotationUniqueId = null;
let currentCircleAnnotationStyleColors = null;
let activelyMakingCircleAnnotation = false;
let annotationMoveDragState = null;
let annotationLabelMoveDragState = null;
let activeVertexEditUuid = null;
let annotationVertexDragState = null;
let activeShapeEditUuid = null;
let annotationShapeDragState = null;
const CIRCLE_ANNOTATION_OPTIONS_STORAGE_KEY =
  "petroImage.circleAnnotationOptions";
let circleAnnotationOptions = {
  mode: "free",
  diameter: 100,
  units: "2",
};

function removeTemporaryPoints() {
  clickCoordinates = [];
  clickImageCoordinates = [];
  clickCoordinatesArray = [];
  ellipseCoordinates = [];
  ellipseImageCoordinates = [];
  circleAnnotationCenter = null;
  circleAnnotationCenterImage = null;
  currentCircleAnnotationUniqueId = null;
  currentEllipseStyleColors = null;
  currentCircleAnnotationStyleColors = null;
  currentPolyStyleColors = null;
  currentRectStyleColors = null;
  activelyMakingCircleAnnotation = false;
  annoJSONTemp = {
    type: "FeatureCollection",
    features: [],
  };
  clearAnnotationDraftState();
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
}

function deactivateAnnotationDrawingModes() {
  pointButton.classList.remove("active");
  polylineButton.classList.remove("active");
  rectButton.classList.remove("active");
  polygonButton.classList.remove("active");
  ellipseButton.classList.remove("active");
  circleAnnotationButton.classList.remove("active");

  isPointMode = false;
  isPolylineMode = false;
  isRectangleMode = false;
  isPolygonMode = false;
  isEllipseMode = false;
  isCircleAnnotationMode = false;
  removeTemporaryPoints();
}

function deactivateAnnotationModes() {
  deactivateAnnotationDrawingModes();
  repeatButton.classList.remove("active");
  promptLabelButton.classList.remove("active");
  promptLabelButton.setAttribute("aria-pressed", "false");
  setAnnotationMoveMode(false);
  setAnnotationLabelMoveMode(false);
  exitAnnotationVertexEditMode();

  isRepeatMode = false;
  isPromptLabelMode = false;
  isAnnotationMoveMode = false;
  isAnnotationLabelMoveMode = false;
}

pointButton.addEventListener("click", () => {
  // Deactivate rect and poly buttons
  setAnnotationMoveMode(false);
  setAnnotationLabelMoveMode(false);
  rectButton.classList.remove("active");
  isRectangleMode = false;
  polylineButton.classList.remove("active");
  isPolygonMode = false;
  polygonButton.classList.remove("active");
  isPolygonMode = false;
  ellipseButton.classList.remove("active");
  isEllipseMode = false;
  circleAnnotationButton.classList.remove("active");
  isCircleAnnotationMode = false;
  removeTemporaryPoints();
  // Remove any existing temporary points

  if (isPointMode === false) {
    pointButton.classList.add("active");
    isPointMode = true;
  } else {
    pointButton.classList.remove("active");
    isPointMode = false;
  }
});

polylineButton.addEventListener("click", () => {
  // Deactivate point and poly buttons
  setAnnotationMoveMode(false);
  setAnnotationLabelMoveMode(false);
  pointButton.classList.remove("active");
  isPointMode = false;
  rectButton.classList.remove("active");
  isRectangleMode = false;
  polygonButton.classList.remove("active");
  isPolygonMode = false;
  ellipseButton.classList.remove("active");
  isEllipseMode = false;
  circleAnnotationButton.classList.remove("active");
  isCircleAnnotationMode = false;
  removeTemporaryPoints();

  if (isPolylineMode === false) {
    polylineButton.classList.add("active");
    isPolylineMode = true;
  } else {
    polylineButton.classList.remove("active");
    isPolylineMode = false;
    removeTemporaryPoints();
  }
});

rectButton.addEventListener("click", () => {
  // Deactivate point and poly buttons
  setAnnotationMoveMode(false);
  setAnnotationLabelMoveMode(false);
  pointButton.classList.remove("active");
  isPointMode = false;
  polylineButton.classList.remove("active");
  isPolylineMode = false;
  polygonButton.classList.remove("active");
  isPolygonMode = false;
  ellipseButton.classList.remove("active");
  isEllipseMode = false;
  circleAnnotationButton.classList.remove("active");
  isCircleAnnotationMode = false;
  removeTemporaryPoints();

  if (isRectangleMode === false) {
    rectButton.classList.add("active");
    isRectangleMode = true;
  } else {
    rectButton.classList.remove("active");
    isRectangleMode = false;
  }
});

repeatButton.addEventListener("click", () => {
  if (isRepeatMode === false) {
    repeatButton.classList.add("active");
    isRepeatMode = true;
  } else {
    repeatButton.classList.remove("active");
    isRepeatMode = false;
  }
});

promptLabelButton.addEventListener("click", () => {
  isPromptLabelMode = !isPromptLabelMode;
  promptLabelButton.classList.toggle("active", isPromptLabelMode);
  promptLabelButton.setAttribute("aria-pressed", String(isPromptLabelMode));
});

moveAnnotationButton.addEventListener("click", () => {
  if (!isAnnotationMoveMode) {
    deactivateAnnotationDrawingModes();
  }
  setAnnotationMoveMode(!isAnnotationMoveMode);
});

moveAnnotationLabelButton.addEventListener("click", () => {
  if (!isAnnotationLabelMoveMode) {
    deactivateAnnotationDrawingModes();
  }
  setAnnotationLabelMoveMode(!isAnnotationLabelMoveMode);
});

polygonButton.addEventListener("click", () => {
  // Deactivate point and rect buttons
  setAnnotationMoveMode(false);
  setAnnotationLabelMoveMode(false);
  pointButton.classList.remove("active");
  isPointMode = false;
  rectButton.classList.remove("active");
  isRectangleMode = false;
  polylineButton.classList.remove("active");
  isPolylineMode = false;
  ellipseButton.classList.remove("active");
  isEllipseMode = false;
  circleAnnotationButton.classList.remove("active");
  isCircleAnnotationMode = false;
  removeTemporaryPoints();

  if (isPolygonMode === false) {
    polygonButton.classList.add("active");
    isPolygonMode = true;
  } else {
    polygonButton.classList.remove("active");
    isPolygonMode = false;
  }
});

ellipseButton.addEventListener("click", () => {
  // Deactivate point and rect buttons
  setAnnotationMoveMode(false);
  setAnnotationLabelMoveMode(false);
  pointButton.classList.remove("active");
  isPointMode = false;
  rectButton.classList.remove("active");
  isRectangleMode = false;
  polylineButton.classList.remove("active");
  isPolylineMode = false;
  polygonButton.classList.remove("active");
  isPolygonMode = false;
  circleAnnotationButton.classList.remove("active");
  isCircleAnnotationMode = false;
  removeTemporaryPoints();

  if (isEllipseMode === false) {
    ellipseButton.classList.add("active");
    isEllipseMode = true;
  } else {
    ellipseButton.classList.remove("active");
    isEllipseMode = false;
  }
});

circleAnnotationButton.addEventListener("click", () => {
  setAnnotationMoveMode(false);
  setAnnotationLabelMoveMode(false);
  pointButton.classList.remove("active");
  isPointMode = false;
  rectButton.classList.remove("active");
  isRectangleMode = false;
  polylineButton.classList.remove("active");
  isPolylineMode = false;
  polygonButton.classList.remove("active");
  isPolygonMode = false;
  ellipseButton.classList.remove("active");
  isEllipseMode = false;
  removeTemporaryPoints();

  if (isCircleAnnotationMode === false) {
    circleAnnotationButton.classList.add("active");
    isCircleAnnotationMode = true;
  } else {
    circleAnnotationButton.classList.remove("active");
    isCircleAnnotationMode = false;
  }
  refreshAnnotationFloaters();
});

// Show or hide the image menu when the gear button is clicked
document
  .getElementById("imageSettingsButton")
  .addEventListener("click", function (event) {
    event.stopPropagation(); // Prevent click from reaching the window listener
    const menu = document.getElementById("imageSettingsMenu");
    if (menu.style.display === "none" || menu.style.display === "") {
      menu.style.display = "block";
    } else {
      menu.style.display = "none";
    }
  });

// Close the menu if clicked outside
window.addEventListener("click", function (event) {
  const menu = document.getElementById("imageSettingsMenu");
  if (
    !event.target.closest("#imageSettingsButton") &&
    !event.target.closest("#imageSettingsMenu")
  ) {
    menu.style.display = "none";
  }
});

function positionAnnotationSettingsPopover(menu, button) {
  const buttonRect = button.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const margin = 8;
  const maxLeft = window.innerWidth - menuRect.width - margin;
  const left = Math.min(Math.max(buttonRect.left, margin), maxLeft);
  const spaceBelow = window.innerHeight - buttonRect.bottom - margin;
  const spaceAbove = buttonRect.top - margin;
  const opensUp = spaceBelow < menuRect.height && spaceAbove > spaceBelow;
  const top = opensUp
    ? Math.max(margin, buttonRect.top - menuRect.height - 4)
    : Math.min(
        buttonRect.bottom + 4,
        window.innerHeight - menuRect.height - margin
      );

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function openAnnotationSettingsPopover(button) {
  const menu = document.getElementById("annoSettingsMenu");
  if (!menu || !button) return;

  if (menu.parentElement !== document.body) {
    document.body.appendChild(menu);
  }

  menu.classList.add("annotation-settings-popover");
  menu.style.display = "block";
  positionAnnotationSettingsPopover(menu, button);
}

function closeAnnotationSettingsPopover() {
  const menu = document.getElementById("annoSettingsMenu");
  if (!menu) return;

  menu.style.display = "none";
  menu.classList.remove("annotation-settings-popover");
}

function openCircleSettingsPopover(button) {
  const menu = document.getElementById("circleSettingsMenu");
  if (!menu || !button) return;

  if (menu.parentElement !== document.body) {
    document.body.appendChild(menu);
  }

  menu.classList.add("measure-settings-popover");
  menu.style.display = "block";
  positionAnnotationSettingsPopover(menu, button);
}

function closeCircleSettingsPopover() {
  const menu = document.getElementById("circleSettingsMenu");
  if (!menu) return;

  menu.style.display = "none";
  menu.classList.remove("measure-settings-popover");
}

function getCircleAnnotationOptionsElements() {
  return {
    menu: document.getElementById("circleAnnotationOptionsMenu"),
    button: document.getElementById("circleAnnotationOptionsButton"),
    diameterInput: document.getElementById("circleAnnotationDiameter"),
    unitsSelect: document.getElementById("circleAnnotationUnits"),
    scaleNote: document.getElementById("circleAnnotationScaleNote"),
    modeInputs: [
      ...document.getElementsByName("circleAnnotationMode"),
    ],
  };
}

function loadCircleAnnotationOptions() {
  try {
    const stored = JSON.parse(
      localStorage.getItem(CIRCLE_ANNOTATION_OPTIONS_STORAGE_KEY) || "null"
    );
    if (!stored) return;
    circleAnnotationOptions = {
      mode: stored.mode === "fixed" ? "fixed" : "free",
      diameter:
        Number.isFinite(Number(stored.diameter)) && Number(stored.diameter) > 0
          ? Number(stored.diameter)
          : 100,
      units: ["0", "1", "2"].includes(String(stored.units))
        ? String(stored.units)
        : "2",
    };
  } catch (error) {
    console.warn("Could not load circle annotation options:", error);
  }
}

function saveCircleAnnotationOptions() {
  try {
    localStorage.setItem(
      CIRCLE_ANNOTATION_OPTIONS_STORAGE_KEY,
      JSON.stringify(circleAnnotationOptions)
    );
  } catch (error) {
    console.warn("Could not save circle annotation options:", error);
  }
}

function updateCircleAnnotationOptionsControls() {
  const { diameterInput, unitsSelect, scaleNote, modeInputs } =
    getCircleAnnotationOptionsElements();
  const hasScale = hasKnownScale();

  if (!hasScale && circleAnnotationOptions.mode === "fixed") {
    circleAnnotationOptions.mode = "free";
    saveCircleAnnotationOptions();
  }

  modeInputs.forEach((input) => {
    input.checked = input.value === circleAnnotationOptions.mode;
    if (input.value === "fixed") {
      input.disabled = !hasScale;
      input.title = hasScale ? "" : "Requires a known image scale.";
    }
  });

  if (diameterInput) {
    diameterInput.value = circleAnnotationOptions.diameter;
    diameterInput.disabled =
      !hasScale || circleAnnotationOptions.mode !== "fixed";
    diameterInput.title = hasScale ? "" : "Requires a known image scale.";
  }

  if (unitsSelect) {
    unitsSelect.value = circleAnnotationOptions.units;
    unitsSelect.disabled =
      !hasScale || circleAnnotationOptions.mode !== "fixed";
    unitsSelect.title = hasScale ? "" : "Requires a known image scale.";
  }

  if (scaleNote) {
    scaleNote.hidden = hasScale;
  }
}

function openCircleAnnotationOptionsPopover(button) {
  const { menu } = getCircleAnnotationOptionsElements();
  if (!menu || !button) return;

  if (menu.parentElement !== document.body) {
    document.body.appendChild(menu);
  }

  updateCircleAnnotationOptionsControls();
  menu.classList.add("circle-annotation-options-popover");
  menu.style.display = "block";
  positionAnnotationSettingsPopover(menu, button);
}

function closeCircleAnnotationOptionsPopover() {
  const { menu } = getCircleAnnotationOptionsElements();
  if (!menu) return;

  menu.style.display = "none";
  menu.classList.remove("circle-annotation-options-popover");
}

// Show or hide the annotations settings menu when the gear button is clicked
document.getElementById("gearButton").addEventListener("click", function (event) {
  event.stopPropagation(); // Prevent click from reaching the window listener
  const menu = document.getElementById("annoSettingsMenu");
  if (menu.style.display === "block") {
    closeAnnotationSettingsPopover();
  } else {
    openAnnotationSettingsPopover(event.currentTarget);
  }
});

// Show or hide the annotations settings menu when the circle gear button is clicked
document
  .getElementById("circleGearButton")
  .addEventListener("click", function (event) {
    event.stopPropagation(); // Prevent click from reaching the window listener
    const menu = document.getElementById("circleSettingsMenu");
    if (menu.style.display === "block") {
      closeCircleSettingsPopover();
    } else {
      openCircleSettingsPopover(event.currentTarget);
    }
  });

// Show or hide the grid settings menu when the gear button is clicked
document
  .getElementById("gridSettingsButton")
  .addEventListener("click", function (event) {
    event.stopPropagation(); // Prevent click from reaching the window listener
    const menu = document.getElementById("gridSettingsMenu");
    if (menu.style.display === "none" || menu.style.display === "") {
      menu.style.display = "block";
    } else {
      menu.style.display = "none";
    }
  });

document
  .getElementById("circleAnnotationOptionsButton")
  .addEventListener("click", function (event) {
    event.stopPropagation();
    const { menu } = getCircleAnnotationOptionsElements();
    if (menu?.style.display === "block") {
      closeCircleAnnotationOptionsPopover();
    } else {
      openCircleAnnotationOptionsPopover(event.currentTarget);
    }
  });

getCircleAnnotationOptionsElements().modeInputs.forEach((input) => {
  input.addEventListener("change", function (event) {
    if (event.target.value === "fixed" && !hasKnownScale()) {
      circleAnnotationOptions.mode = "free";
    } else {
      circleAnnotationOptions.mode = event.target.value;
    }
    saveCircleAnnotationOptions();
    updateCircleAnnotationOptionsControls();
  });
});

document
  .getElementById("circleAnnotationDiameter")
  .addEventListener("change", function (event) {
    const diameter = Number(event.target.value);
    circleAnnotationOptions.diameter =
      Number.isFinite(diameter) && diameter > 0 ? diameter : 100;
    saveCircleAnnotationOptions();
    updateCircleAnnotationOptionsControls();
  });

document
  .getElementById("circleAnnotationUnits")
  .addEventListener("change", function (event) {
    circleAnnotationOptions.units = event.target.value;
    saveCircleAnnotationOptions();
    updateCircleAnnotationOptionsControls();
  });

loadCircleAnnotationOptions();
updateCircleAnnotationOptionsControls();

// Close the menu if clicked outside (annotations menu)
window.addEventListener("click", function (event) {
  const menu = document.getElementById("annoSettingsMenu");
  if (
    !event.target.closest("#gearButton") &&
    !event.target.closest("#annoSettingsMenu")
  ) {
    closeAnnotationSettingsPopover();
  }

  const circleAnnotationMenu = document.getElementById(
    "circleAnnotationOptionsMenu"
  );
  if (
    circleAnnotationMenu?.style.display === "block" &&
    !event.target.closest("#circleAnnotationOptionsButton") &&
    !event.target.closest("#circleAnnotationOptionsMenu")
  ) {
    closeCircleAnnotationOptionsPopover();
  }
});

window.addEventListener("click", function (event) {
  const menu = document.getElementById("circleSettingsMenu");
  if (
    !event.target.closest("#circleGearButton") &&
    !event.target.closest("#circleSettingsMenu")
  ) {
    closeCircleSettingsPopover();
  }
});

const randomAnnotationColorInputs = [
  "annoLabelFontColor",
  "annoLabelBackgroundColor",
  "lineColor",
  "fillColor",
];
randomAnnotationColorInputs.forEach((inputId) => {
  const input = document.getElementById(inputId);
  const randomCheckbox = document.getElementById(`${inputId}Random`);
  if (input && randomCheckbox) {
    randomCheckbox.addEventListener("change", () => {
      input.disabled = randomCheckbox.checked;
    });
  }
});

function getAnnotationColor(inputId) {
  const colorInput = document.getElementById(inputId);
  const randomCheckbox = document.getElementById(`${inputId}Random`);
  if (randomCheckbox?.checked) {
    return getRandomAnnotationColor();
  }
  return colorInput?.value || "#FFFFFF";
}

function getAnnotationOpacityValue(inputId) {
  const input = document.getElementById(inputId);
  const percentValue = Number(input?.value);
  if (!Number.isFinite(percentValue)) return 0;

  return Math.min(100, Math.max(0, percentValue)) / 100;
}

function getCurrentAnnotationStyleColors(existingColors = {}) {
  existingColors = existingColors || {};
  return {
    labelFontColor:
      existingColors.labelFontColor || getAnnotationColor("annoLabelFontColor"),
    labelBackgroundColor:
      existingColors.labelBackgroundColor ||
      getAnnotationColor("annoLabelBackgroundColor"),
    lineColor: existingColors.lineColor || getAnnotationColor("lineColor"),
    fillColor: existingColors.fillColor || getAnnotationColor("fillColor"),
  };
}

function getRandomAnnotationColor() {
  const hue = Math.floor(Math.random() * 360);
  const saturation = 65 + Math.floor(Math.random() * 16);
  const lightness = 45 + Math.floor(Math.random() * 11);
  return hslToHex(hue, saturation, lightness);
}

function hslToHex(h, s, l) {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function getAnnotationFillColor() {
  return getAnnotationColor("fillColor");
}

function getAnnotationLineColor() {
  return getAnnotationColor("lineColor");
}

function getAnnotationLabelFontColor() {
  return getAnnotationColor("annoLabelFontColor");
}

function getAnnotationLabelBackgroundColor() {
  return getAnnotationColor("annoLabelBackgroundColor");
}

// Close the menu if clicked outside (grid menu)
window.addEventListener("click", function (event) {
  const menu = document.getElementById("gridSettingsMenu");
  if (
    !event.target.closest("#gridSettingsButton") &&
    !event.target.closest("#gridSettingsMenu")
  ) {
    menu.style.display = "none";
  }
});

const enableAnnoButtons = () => {
  document.getElementById("gearButton").disabled = false;
  document.getElementById("exportBtn").disabled = false;
  document.getElementById("clearBtn").disabled = false;
  updateSelectedAnnotationControls();
};

const disableAnnoButtons = () => {
  document.getElementById("anno-label").disabled = true;
  document.getElementById("anno-notes").disabled = true;
  document.getElementById("deleteButton").disabled = true;
  document.getElementById("moveAnnotationButton").disabled = true;
  document.getElementById("moveAnnotationLabelButton").disabled = true;
  document.getElementById("gearButton").disabled = false;
  document.getElementById("repeatButton").disabled = true;
  document.getElementById("exportBtn").disabled = true;
  document.getElementById("clearBtn").disabled = true;
  document.getElementById("annotationGroupSelect").disabled = true;
  document.getElementById("annotationGroupColorInput").disabled = true;
  document.getElementById("annotationGroupVisibilityButton").disabled = true;
  document.getElementById("annotationGroupLockButton").disabled = true;
  document.getElementById("renameAnnotationGroupButton").disabled = true;
  document.getElementById("newAnnotationGroupButton").disabled = true;
  isRepeatMode = false; // Reset repeat mode when disabling buttons
  repeatButton.classList.remove("active");
  setAnnotationMoveMode(false);
  setAnnotationLabelMoveMode(false);
};

function updateSelectedAnnotationControls() {
  const hasSelection = selectedAnnotationUuids.size > 0;
  const hasUnlockedSelection = getUnlockedSelectedAnnotationUuids().length > 0;
  document.getElementById("anno-label").disabled =
    !hasSelection || isAnnotationUuidLocked(selectedAnnotationUuid);
  document.getElementById("anno-notes").disabled =
    !hasSelection || isAnnotationUuidLocked(selectedAnnotationUuid);
  document.getElementById("deleteButton").disabled = !hasUnlockedSelection;
  document.getElementById("moveAnnotationButton").disabled = !hasUnlockedSelection;
  document.getElementById("moveAnnotationLabelButton").disabled =
    !hasUnlockedSelection;
  document.getElementById("repeatButton").disabled = !hasSelection;
  document.getElementById("newAnnotationGroupButton").disabled =
    !hasUnlockedSelection;

  if (!hasSelection || !hasUnlockedSelection) {
    isRepeatMode = false;
    repeatButton.classList.remove("active");
    setAnnotationMoveMode(false);
    setAnnotationLabelMoveMode(false);
  }
}

function setAnnotationMoveMode(enabled) {
  const hasSelection = getUnlockedSelectedAnnotationUuids().length > 0;
  isAnnotationMoveMode = Boolean(enabled && hasSelection);
  if (isAnnotationMoveMode) {
    setAnnotationLabelMoveMode(false);
    exitAnnotationVertexEditMode();
    exitAnnotationShapeEditMode();
  }
  moveAnnotationButton.classList.toggle("active", isAnnotationMoveMode);
  moveAnnotationButton.setAttribute("aria-pressed", String(isAnnotationMoveMode));
  viewerContainer?.classList.toggle("annotation-move-mode", isAnnotationMoveMode);
  if (!isAnnotationMoveMode) {
    annotationMoveDragState = null;
    viewerContainer?.classList.remove("annotation-moving");
  }
}

function setAnnotationLabelMoveMode(enabled) {
  const hasSelection = getUnlockedSelectedAnnotationUuids().length > 0;
  isAnnotationLabelMoveMode = Boolean(enabled && hasSelection);
  if (isAnnotationLabelMoveMode) {
    setAnnotationMoveMode(false);
    exitAnnotationVertexEditMode();
    exitAnnotationShapeEditMode();
  }
  moveAnnotationLabelButton.classList.toggle("active", isAnnotationLabelMoveMode);
  moveAnnotationLabelButton.setAttribute(
    "aria-pressed",
    String(isAnnotationLabelMoveMode)
  );
  viewerContainer?.classList.toggle(
    "annotation-label-move-mode",
    isAnnotationLabelMoveMode
  );
  if (!isAnnotationLabelMoveMode) {
    annotationLabelMoveDragState = null;
    viewerContainer?.classList.remove("annotation-label-moving");
    window.removeEventListener("pointermove", handleAnnotationLabelWindowPointerMove);
    window.removeEventListener("pointerup", handleAnnotationLabelWindowPointerUp);
    window.removeEventListener("pointercancel", handleAnnotationLabelWindowPointerUp);
  }
}

function getAnnotationIndexByUuid(uuid) {
  return annoJSON.features.findIndex(
    (feature) => feature.properties?.uuid === uuid
  );
}

function getAnnotationByUuid(uuid) {
  const index = getAnnotationIndexByUuid(uuid);
  return index >= 0 ? annoJSON.features[index] : null;
}

function getSelectedAnnotationUuids() {
  return [...selectedAnnotationUuids].filter(
    (uuid) => getAnnotationIndexByUuid(uuid) >= 0
  );
}

function getSelectedAnnotation() {
  return getAnnotationByUuid(selectedAnnotationUuid);
}

function getSelectedAnnotationUuid() {
  return getSelectedAnnotation()?.properties?.uuid || null;
}

function setAnnotationTextInputs(feature) {
  const annoLabel = document.getElementById("anno-label");
  const annoNotes = document.getElementById("anno-notes");
  annoLabel.value = feature?.properties?.label ?? "";
  annoNotes.value = feature?.properties?.notes ?? "";
}

function scrollSelectedAnnotationRowIntoView() {
  if (!selectedAnnotationUuid) return;
  const row = document.querySelector(
    `.annotation-list-row[data-annotation-uuid="${CSS.escape(
      selectedAnnotationUuid
    )}"]`
  );
  row?.scrollIntoView({ block: "nearest" });
}

function setAnnotationSelection(uuids, primaryUuid = null, options = {}) {
  const { pan = false, redraw = true, scroll = true } = options;
  const validUuids = uuids.filter(
    (uuid) => getAnnotationIndexByUuid(uuid) >= 0 && !isAnnotationUuidLocked(uuid)
  );
  selectedAnnotationUuids = new Set(validUuids);

  const primaryIsValid =
    primaryUuid &&
    selectedAnnotationUuids.has(primaryUuid) &&
    getAnnotationIndexByUuid(primaryUuid) >= 0 &&
    !isAnnotationUuidLocked(primaryUuid);
  selectedAnnotationUuid = primaryIsValid
    ? primaryUuid
    : validUuids[validUuids.length - 1] || null;

  if (activeVertexEditUuid && activeVertexEditUuid !== selectedAnnotationUuid) {
    exitAnnotationVertexEditMode();
  }
  if (activeShapeEditUuid && activeShapeEditUuid !== selectedAnnotationUuid) {
    exitAnnotationShapeEditMode();
  }

  setAnnotationTextInputs(getSelectedAnnotation());
  syncSelectedAnnotationVisuals();

  if (redraw) {
    drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  }

  if (scroll) {
    scrollSelectedAnnotationRowIntoView();
  }

  if (pan && selectedAnnotationUuid) {
    const feature = getSelectedAnnotation();
    const image = viewer.world.getItemAt(0);
    const viewportPoint = image.imageToViewportCoordinates(
      feature.properties.xLabel,
      feature.properties.yLabel
    );
    goToPoint(viewportPoint.x, viewportPoint.y);
  }

  if (selectedAnnotationUuid) {
    enableAnnoButtons();
  } else {
    updateSelectedAnnotationControls();
  }
}

function clearAnnotationSelection(options = {}) {
  annotationListSelectionAnchorUuid = null;
  setAnnotationSelection([], null, options);
}

function normalizeAnnotationProperties(properties = {}) {
  return {
    ...properties,
    uuid: properties.uuid || generateUniqueId(12),
    visible:
      properties.visible === undefined ? true : Boolean(properties.visible),
    locked:
      properties.locked === undefined ? false : Boolean(properties.locked),
    groupId: properties.groupId || DEFAULT_ANNOTATION_GROUP.groupId,
    groupName: properties.groupName || DEFAULT_ANNOTATION_GROUP.groupName,
    groupColor: properties.groupColor || DEFAULT_ANNOTATION_GROUP.groupColor,
    groupVisible:
      properties.groupVisible === undefined
        ? DEFAULT_ANNOTATION_GROUP.groupVisible
        : Boolean(properties.groupVisible),
    groupLocked:
      properties.groupLocked === undefined
        ? DEFAULT_ANNOTATION_GROUP.groupLocked
        : Boolean(properties.groupLocked),
  };
}

function normalizeAnnotationFeature(feature) {
  if (!feature?.properties) return feature;
  feature.properties = normalizeAnnotationProperties(feature.properties);
  return feature;
}

function getAnnotationGroups() {
  const groups = new Map();
  groups.set(DEFAULT_ANNOTATION_GROUP.groupId, { ...DEFAULT_ANNOTATION_GROUP });

  annoJSON.features.forEach((feature) => {
    const props = normalizeAnnotationFeature(feature)?.properties;
    if (!props) return;
    groups.set(props.groupId, {
      groupId: props.groupId,
      groupName: props.groupName,
      groupColor: props.groupColor,
      groupVisible: props.groupVisible,
      groupLocked: props.groupLocked,
    });
  });

  return [...groups.values()].sort((a, b) =>
    a.groupName.localeCompare(b.groupName)
  );
}

function isAnnotationFeatureVisible(feature) {
  if (!feature?.properties?.uuid) return true;
  const props = normalizeAnnotationFeature(feature).properties;
  return props.visible !== false && props.groupVisible !== false;
}

function isAnnotationFeatureLocked(feature) {
  if (!feature?.properties?.uuid) return false;
  const props = normalizeAnnotationFeature(feature).properties;
  return props.locked === true || props.groupLocked === true;
}

function isAnnotationUuidLocked(uuid) {
  return isAnnotationFeatureLocked(getAnnotationByUuid(uuid));
}

function getUnlockedSelectedAnnotationUuids() {
  return getSelectedAnnotationUuids().filter((uuid) => !isAnnotationUuidLocked(uuid));
}

function getUnlockedAnnotationUuids() {
  return annoJSON.features
    .filter((feature) => !isAnnotationFeatureLocked(feature))
    .map((feature) => feature.properties.uuid);
}

function getUnlockedAnnotationIds() {
  return annoJSON.features
    .map((feature, index) => ({ feature, id: index + 1 }))
    .filter(({ feature }) => !isAnnotationFeatureLocked(feature))
    .map(({ id }) => id);
}

function getUnlockedAnnotationIdsForGroup(groupId) {
  if (!groupId) return [];
  return annoJSON.features
    .map((feature, index) => ({ feature, id: index + 1 }))
    .filter(
      ({ feature }) =>
        feature.properties?.groupId === groupId &&
        !isAnnotationFeatureLocked(feature)
    )
    .map(({ id }) => id);
}

function isAnnotationUuidVisible(uuid) {
  return isAnnotationFeatureVisible(getAnnotationByUuid(uuid));
}

function getGeometryTypeLabel(type, shapeType) {
  if (shapeType === "circle") return "Circle";
  if (shapeType === "rectangle") return "Rectangle";
  if (shapeType === "ellipse") return "Ellipse";

  const labels = {
    Point: "Point",
    MultiPoint: "MultiPoint",
    LineString: "LineString",
    MultiLineString: "MultiLineString",
    Polygon: "Polygon",
    MultiPolygon: "MultiPolygon",
  };
  return labels[type] || "?";
}

function createGeometryTypeIcon(type, shapeType) {
  const icon = document.createElement("span");
  icon.className = "annotation-geometry-icon";
  icon.title = getGeometryTypeLabel(type, shapeType);
  icon.setAttribute("aria-label", getGeometryTypeLabel(type, shapeType));

  if (shapeType === "circle") {
    const circle = document.createElement("span");
    circle.className = "annotation-geometry-circle";
    icon.appendChild(circle);
  } else if (shapeType === "rectangle") {
    const rectangle = document.createElement("span");
    rectangle.className = "annotation-geometry-rectangle";
    icon.appendChild(rectangle);
  } else if (shapeType === "ellipse") {
    const ellipse = document.createElement("span");
    ellipse.className = "annotation-geometry-ellipse";
    icon.appendChild(ellipse);
  } else if (type === "Point" || type === "MultiPoint") {
    const dotCount = type === "MultiPoint" ? 3 : 1;
    for (let i = 0; i < dotCount; i++) {
      const dot = document.createElement("span");
      dot.className = "annotation-geometry-dot";
      icon.appendChild(dot);
    }
  } else if (type === "LineString" || type === "MultiLineString") {
    const line = document.createElement("span");
    line.className = "annotation-geometry-line";
    icon.appendChild(line);
    if (type === "MultiLineString") {
      const secondLine = document.createElement("span");
      secondLine.className = "annotation-geometry-line annotation-geometry-line-secondary";
      icon.appendChild(secondLine);
    }
  } else if (type === "Polygon" || type === "MultiPolygon") {
    const polygon = document.createElement("span");
    polygon.className = "annotation-geometry-polygon";
    icon.appendChild(polygon);
    if (type === "MultiPolygon") {
      const secondPolygon = document.createElement("span");
      secondPolygon.className =
        "annotation-geometry-polygon annotation-geometry-polygon-secondary";
      icon.appendChild(secondPolygon);
    }
  } else {
    icon.textContent = "?";
  }

  return icon;
}

function getAnnotationGroupColor(groupIndex) {
  const palette = [
    "#ffcc00",
    "#2f80ed",
    "#27ae60",
    "#eb5757",
    "#9b51e0",
    "#00a6a6",
    "#f2994a",
    "#4f4f4f",
  ];
  return palette[groupIndex % palette.length];
}

function getSafeGroupColor(color) {
  return /^#[0-9a-f]{6}$/i.test(color)
    ? color
    : DEFAULT_ANNOTATION_GROUP.groupColor;
}

function renderAnnotationGroupOptions() {
  const select = document.getElementById("annotationGroupSelect");
  if (!select) return;

  const selectedFeature = getSelectedAnnotation();
  const previousGroupId = select.value;
  const groups = getAnnotationGroups();
  const selectedGroupId =
    selectedFeature?.properties?.groupId ||
    (groups.some((group) => group.groupId === previousGroupId)
      ? previousGroupId
      : DEFAULT_ANNOTATION_GROUP.groupId);

  select.innerHTML = "";
  groups.forEach((group) => {
    const option = document.createElement("option");
    option.value = group.groupId;
    option.textContent = group.groupName;
    select.appendChild(option);
  });

  select.value = selectedGroupId;
  select.disabled = annoJSON.features.length === 0;
  updateGroupControls();

  const newGroupButton = document.getElementById("newAnnotationGroupButton");
  if (newGroupButton) {
    newGroupButton.disabled = getUnlockedSelectedAnnotationUuids().length === 0;
  }
  updateSelectedAnnotationControls();
}

function getSelectedGroupFromDropdown() {
  const select = document.getElementById("annotationGroupSelect");
  if (!select) return null;
  return getAnnotationGroups().find((group) => group.groupId === select.value);
}

function updateGroupControls() {
  const group = getSelectedGroupFromDropdown();
  const hasAnnotations = annoJSON.features.length > 0;
  const isEnabled = Boolean(group && hasAnnotations);

  const colorInput = document.getElementById("annotationGroupColorInput");
  if (colorInput) {
    colorInput.disabled = !isEnabled;
    colorInput.value = getSafeGroupColor(group?.groupColor);
    colorInput.title = group ? `Color: ${group.groupName}` : "Group Color";
  }

  const visibilityButton = document.getElementById(
    "annotationGroupVisibilityButton"
  );
  if (visibilityButton) {
    visibilityButton.innerHTML = "";
    visibilityButton.disabled = !isEnabled;
    if (isEnabled) {
      const isVisible = group.groupVisible !== false;
      visibilityButton.title = isVisible ? "Hide group" : "Show group";
      visibilityButton.setAttribute(
        "aria-label",
        isVisible ? "Hide group" : "Show group"
      );
      visibilityButton.appendChild(createVisibilityIcon(isVisible));
    }
  }

  const lockButton = document.getElementById("annotationGroupLockButton");
  if (lockButton) {
    lockButton.innerHTML = "";
    lockButton.disabled = !isEnabled;
    if (isEnabled) {
      const isLocked = group.groupLocked === true;
      lockButton.title = isLocked ? "Unlock group" : "Lock group";
      lockButton.setAttribute(
        "aria-label",
        isLocked ? "Unlock group" : "Lock group"
      );
      lockButton.appendChild(createLockIcon(isLocked));
    }
  }

  const renameButton = document.getElementById("renameAnnotationGroupButton");
  if (renameButton) {
    renameButton.disabled = !isEnabled;
    renameButton.title = group ? `Rename ${group.groupName}` : "Rename Group";
  }
}

function createVisibilityIcon(isVisible) {
  const icon = document.createElement("span");
  icon.className = "annotation-visibility-icon";
  icon.setAttribute("aria-hidden", "true");

  const eye = document.createElement("span");
  eye.className = "annotation-visibility-eye";
  icon.appendChild(eye);

  if (!isVisible) {
    const slash = document.createElement("span");
    slash.className = "annotation-visibility-slash";
    icon.appendChild(slash);
  }

  return icon;
}

function createLockIcon(isLocked) {
  const icon = document.createElement("span");
  icon.className = `annotation-lock-icon ${
    isLocked ? "annotation-lock-icon-locked" : "annotation-lock-icon-unlocked"
  }`;
  icon.setAttribute("aria-hidden", "true");

  const shackle = document.createElement("span");
  shackle.className = "annotation-lock-shackle";
  icon.appendChild(shackle);

  const body = document.createElement("span");
  body.className = "annotation-lock-body";
  icon.appendChild(body);

  return icon;
}

function syncAnnotationListSelection() {
  [...document.getElementsByClassName("annotation-list-row")].forEach((row) => {
    const isSelected = selectedAnnotationUuids.has(row.dataset.annotationUuid);
    row.classList.toggle("annotation-list-row-selected", isSelected);
    row.setAttribute("aria-selected", String(isSelected));
    row.classList.toggle(
      "annotation-list-row-primary",
      row.dataset.annotationUuid === selectedAnnotationUuid
    );
  });
}

function toggleAnnotationInSelection(uuid, options = {}) {
  if (isAnnotationUuidLocked(uuid)) return;
  const { pan = true } = options;
  const nextSelection = new Set(selectedAnnotationUuids);
  if (nextSelection.has(uuid)) {
    nextSelection.delete(uuid);
  } else {
    nextSelection.add(uuid);
  }
  annotationListSelectionAnchorUuid = uuid;
  setAnnotationSelection([...nextSelection], uuid, { pan });
}

function handleAnnotationListRowClick(event, uuid) {
  const clickedIndex = getAnnotationIndexByUuid(uuid);
  if (clickedIndex < 0) return;
  if (isAnnotationUuidLocked(uuid)) return;

  if (event.shiftKey && annotationListSelectionAnchorUuid) {
    const anchorIndex = getAnnotationIndexByUuid(annotationListSelectionAnchorUuid);
    if (anchorIndex >= 0) {
      const start = Math.min(anchorIndex, clickedIndex);
      const end = Math.max(anchorIndex, clickedIndex);
      const rangeUuids = annoJSON.features
        .slice(start, end + 1)
        .filter((feature) => !isAnnotationFeatureLocked(feature))
        .map((feature) => feature.properties.uuid);
      setAnnotationSelection(rangeUuids, uuid, { pan: true });
      return;
    }
  }

  if (event.ctrlKey || event.metaKey) {
    toggleAnnotationInSelection(uuid, { pan: true });
    return;
  }

  annotationListSelectionAnchorUuid = uuid;
  setAnnotationSelection([uuid], uuid, { pan: true });
}

function focusAnnotationListRow(uuid) {
  if (!uuid) return;
  const row = document.querySelector(
    `.annotation-list-row[data-annotation-uuid="${CSS.escape(uuid)}"]`
  );
  row?.focus({ preventScroll: true });
}

function handleAnnotationListArrowKey(event, uuid) {
  if (!["ArrowUp", "ArrowDown"].includes(event.key)) return false;
  if (annoJSON.features.length === 0) return false;

  event.preventDefault();
  event.stopPropagation();

  const selectableFeatures = annoJSON.features.filter(
    (feature) => !isAnnotationFeatureLocked(feature)
  );
  if (selectableFeatures.length === 0) return true;

  const currentIndex = Math.max(0, getAnnotationIndexByUuid(uuid));
  const direction = event.key === "ArrowDown" ? 1 : -1;
  let nextIndex = currentIndex;
  for (let i = 0; i < annoJSON.features.length; i++) {
    nextIndex =
      (nextIndex + direction + annoJSON.features.length) %
      annoJSON.features.length;
    if (!isAnnotationFeatureLocked(annoJSON.features[nextIndex])) break;
  }
  const nextUuid = annoJSON.features[nextIndex]?.properties?.uuid;
  if (!nextUuid) return true;

  if (event.shiftKey) {
    const anchorUuid = annotationListSelectionAnchorUuid || uuid || nextUuid;
    const anchorIndex = getAnnotationIndexByUuid(anchorUuid);
    if (anchorIndex >= 0) {
      const start = Math.min(anchorIndex, nextIndex);
      const end = Math.max(anchorIndex, nextIndex);
      const rangeUuids = annoJSON.features
        .slice(start, end + 1)
        .filter((feature) => !isAnnotationFeatureLocked(feature))
        .map((feature) => feature.properties.uuid);
      setAnnotationSelection(rangeUuids, nextUuid, { pan: false });
    }
  } else {
    annotationListSelectionAnchorUuid = nextUuid;
    setAnnotationSelection([nextUuid], nextUuid, { pan: false });
  }

  focusAnnotationListRow(nextUuid);
  return true;
}

document
  .getElementById("annotationList")
  ?.addEventListener("keydown", function (event) {
    if (event.target !== event.currentTarget) return;
    handleAnnotationListArrowKey(
      event,
      selectedAnnotationUuid || annoJSON.features[0]?.properties?.uuid
    );
  });

document.addEventListener(
  "keydown",
  function (event) {
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    if (!selectedAnnotationUuid || annotatePalette?.hidden) return;

    const tag = event.target?.tagName;
    if (
      ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tag) ||
      event.target?.isContentEditable
    ) {
      return;
    }

    handleAnnotationListArrowKey(event, selectedAnnotationUuid);
  },
  true
);

function refreshAnnotationVisibilityViews() {
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  applyAnnotationVisibilityState();
  renderAnnotationList();
  updateGroupControls();
}

function setAnnotationVisibility(uuid, visible) {
  const feature = getAnnotationByUuid(uuid);
  if (!feature) return;

  annotationHistory.push(visible ? "Show annotation" : "Hide annotation");
  feature.properties.visible = visible;
  refreshAnnotationVisibilityViews();
  unsavedAnnotations(true);
}

function setAnnotationLocked(uuid, locked) {
  const feature = getAnnotationByUuid(uuid);
  if (!feature) return;

  annotationHistory.push(locked ? "Lock annotation" : "Unlock annotation");
  feature.properties.locked = locked;
  if (locked && selectedAnnotationUuids.has(uuid)) {
    const nextSelection = getSelectedAnnotationUuids().filter(
      (selectedUuid) => selectedUuid !== uuid
    );
    setAnnotationSelection(nextSelection, nextSelection[nextSelection.length - 1], {
      redraw: true,
      scroll: false,
    });
  }
  renderAnnotationList();
  updateSelectedAnnotationControls();
  unsavedAnnotations(true);
}

function setAnnotationGroupVisibility(groupId, visible) {
  annotationHistory.push(visible ? "Show annotation group" : "Hide annotation group");
  annoJSON.features.forEach((feature) => {
    normalizeAnnotationFeature(feature);
    if (feature.properties.groupId === groupId) {
      feature.properties.groupVisible = visible;
    }
  });
  refreshAnnotationVisibilityViews();
  unsavedAnnotations(true);
}

function setAnnotationGroupLocked(groupId, locked) {
  annotationHistory.push(locked ? "Lock annotation group" : "Unlock annotation group");
  const lockedUuids = [];
  annoJSON.features.forEach((feature) => {
    normalizeAnnotationFeature(feature);
    if (feature.properties.groupId === groupId) {
      feature.properties.groupLocked = locked;
      if (locked) lockedUuids.push(feature.properties.uuid);
    }
  });
  if (locked && lockedUuids.length > 0) {
    const lockedSet = new Set(lockedUuids);
    const nextSelection = getSelectedAnnotationUuids().filter(
      (uuid) => !lockedSet.has(uuid)
    );
    setAnnotationSelection(nextSelection, nextSelection[nextSelection.length - 1], {
      redraw: true,
      scroll: false,
    });
  }
  renderAnnotationList();
  updateGroupControls();
  updateSelectedAnnotationControls();
  unsavedAnnotations(true);
}

function updateAnnotationGroupProperties(groupId, updates, historyLabel) {
  const group = getAnnotationGroups().find(
    (candidate) => candidate.groupId === groupId
  );
  if (!group) return false;

  annotationHistory.push(historyLabel);
  annoJSON.features.forEach((feature) => {
    normalizeAnnotationFeature(feature);
    if (feature.properties.groupId === groupId) {
      Object.assign(feature.properties, updates);
    }
  });
  renderAnnotationList();
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  applyAnnotationVisibilityState();
  unsavedAnnotations(true);
  return true;
}

function renameAnnotationGroup(groupId, groupName) {
  const trimmedName = groupName.trim();
  if (!trimmedName) return;

  const duplicateGroup = getAnnotationGroups().find(
    (group) =>
      group.groupId !== groupId &&
      group.groupName.toLowerCase() === trimmedName.toLowerCase()
  );
  if (duplicateGroup) {
    alert("A group with that name already exists.");
    return;
  }

  updateAnnotationGroupProperties(
    groupId,
    { groupName: trimmedName },
    "Rename annotation group"
  );
}

function setAnnotationGroupColor(groupId, groupColor) {
  updateAnnotationGroupProperties(
    groupId,
    { groupColor: getSafeGroupColor(groupColor) },
    "Recolor annotation group"
  );
}

function renderAnnotationList() {
  const list = document.getElementById("annotationList");
  if (!list) return;

  list.innerHTML = "";

  if (annoJSON.features.length === 0) {
    const empty = document.createElement("div");
    empty.className = "annotation-list-empty";
    empty.textContent = "No annotations";
    list.appendChild(empty);
    renderAnnotationGroupOptions();
    return;
  }

  annoJSON.features.forEach((feature, index) => {
    normalizeAnnotationFeature(feature);

    const props = feature.properties;
    const isVisible = isAnnotationFeatureVisible(feature);
    const isLocked = isAnnotationFeatureLocked(feature);
    const isGroupLocked = props.groupLocked === true;
    const row = document.createElement("div");
    row.className = "annotation-list-row";
    row.tabIndex = 0;
    row.setAttribute("role", "option");
    row.dataset.annotationUuid = props.uuid;
    row.setAttribute("aria-selected", "false");
    row.title = `${index + 1}. ${props.label || "(no label)"}`;
    row.addEventListener("click", function (event) {
      handleAnnotationListRowClick(event, props.uuid);
    });
    row.addEventListener("keydown", function (event) {
      if (handleAnnotationListArrowKey(event, props.uuid)) return;
      if (event.code === "Enter" || event.code === "Space") {
        event.preventDefault();
        handleAnnotationListRowClick(event, props.uuid);
      }
    });
    row.classList.toggle("annotation-row-hidden", !isVisible);
    row.classList.toggle("annotation-row-locked", isLocked);

    const indexCell = document.createElement("span");
    indexCell.className = "annotation-list-index";
    indexCell.textContent = String(index + 1);

    const typeCell = document.createElement("span");
    typeCell.className = "annotation-list-type";
    typeCell.appendChild(
      createGeometryTypeIcon(feature.geometry?.type, props.shapeType)
    );

    const labelCell = document.createElement("span");
    labelCell.className = "annotation-list-label";
    labelCell.textContent = props.label || "(no label)";

    const groupCell = document.createElement("span");
    groupCell.className = "annotation-list-group";
    groupCell.style.backgroundColor = props.groupColor;
    groupCell.title = props.groupName;

    const visibilityButton = document.createElement("button");
    visibilityButton.type = "button";
    visibilityButton.className = "annotation-visibility-button";
    visibilityButton.title = isVisible ? "Hide annotation" : "Show annotation";
    visibilityButton.setAttribute(
      "aria-label",
      isVisible ? "Hide annotation" : "Show annotation"
    );
    visibilityButton.appendChild(createVisibilityIcon(isVisible));
    visibilityButton.addEventListener("click", function (event) {
      event.stopPropagation();
      setAnnotationVisibility(props.uuid, !isVisible);
    });

    const lockButton = document.createElement("button");
    lockButton.type = "button";
    lockButton.className = "annotation-lock-button";
    lockButton.disabled = isGroupLocked;
    lockButton.title = isGroupLocked
      ? "Locked by group"
      : isLocked
        ? "Unlock annotation"
        : "Lock annotation";
    lockButton.setAttribute(
      "aria-label",
      isGroupLocked
        ? "Locked by group"
        : isLocked
          ? "Unlock annotation"
          : "Lock annotation"
    );
    lockButton.appendChild(createLockIcon(isLocked));
    lockButton.addEventListener("click", function (event) {
      event.stopPropagation();
      setAnnotationLocked(props.uuid, !props.locked);
    });

    row.append(
      indexCell,
      typeCell,
      labelCell,
      groupCell,
      visibilityButton,
      lockButton
    );
    list.appendChild(row);
  });

  syncAnnotationListSelection();
  renderAnnotationGroupOptions();
  updateSelectedAnnotationControls();
}

function assignSelectedAnnotationGroup(group) {
  const selectedUuids = getUnlockedSelectedAnnotationUuids();
  if (selectedUuids.length === 0 || !group) return;

  annotationHistory.push("Assign annotation group");
  selectedUuids.forEach((uuid) => {
    const feature = getAnnotationByUuid(uuid);
    if (!feature) return;
    feature.properties.groupId = group.groupId;
    feature.properties.groupName = group.groupName;
    feature.properties.groupColor = group.groupColor;
    feature.properties.groupVisible = group.groupVisible;
    feature.properties.groupLocked = group.groupLocked;
  });
  renderAnnotationList();
  unsavedAnnotations(true);
}

function createAnnotationGroupForSelection(groupName) {
  const trimmedName = groupName.trim();
  if (!trimmedName) return;

  const groups = getAnnotationGroups();
  const existingGroup = groups.find(
    (group) => group.groupName.toLowerCase() === trimmedName.toLowerCase()
  );

  assignSelectedAnnotationGroup(
    existingGroup || {
      groupId: `group-${generateUniqueId(8)}`,
      groupName: trimmedName,
      groupColor: getAnnotationGroupColor(groups.length),
      groupVisible: true,
      groupLocked: false,
    }
  );
}

function syncSelectedAnnotationVisuals() {
  [...document.getElementsByClassName("annotate-label")].forEach((label) => {
    label.classList.toggle(
      "annotation-selected",
      selectedAnnotationUuids.has(label.dataset.annotationUuid)
    );
  });

  [...document.getElementsByClassName("annotate-crosshairs")].forEach(
    (crosshair) => {
      crosshair.classList.toggle(
        "annotation-selected",
        selectedAnnotationUuids.has(crosshair.dataset.annotationUuid)
      );
    }
  );
  syncAnnotationListSelection();
  renderAnnotationGroupOptions();
  applyAnnotationVisibilityState();
}

function selectAnnotationByUuid(uuid, options = {}) {
  if (getAnnotationIndexByUuid(uuid) < 0) {
    clearAnnotationSelection(options);
    return null;
  }

  annotationListSelectionAnchorUuid = uuid;
  setAnnotationSelection([uuid], uuid, options);
  return getAnnotationByUuid(uuid);
}

function selectAnnotationById(id, options = {}) {
  const feature = annoJSON.features[id - 1];
  if (!feature) return selectAnnotationByUuid(null, options);
  return selectAnnotationByUuid(feature.properties.uuid, options);
}

document
  .getElementById("annotationGroupSelect")
  .addEventListener("change", function (event) {
    const group = getAnnotationGroups().find(
      (candidate) => candidate.groupId === event.target.value
    );
    if (getSelectedAnnotationUuids().length > 0) {
      assignSelectedAnnotationGroup(group);
    }
    updateGroupControls();
  });

document
  .getElementById("annotationGroupColorInput")
  .addEventListener("change", function (event) {
    const group = getSelectedGroupFromDropdown();
    if (!group) return;
    setAnnotationGroupColor(group.groupId, event.target.value);
  });

document
  .getElementById("annotationGroupVisibilityButton")
  .addEventListener("click", function () {
    const group = getSelectedGroupFromDropdown();
    if (!group) return;
    setAnnotationGroupVisibility(group.groupId, group.groupVisible === false);
  });

document
  .getElementById("annotationGroupLockButton")
  .addEventListener("click", function () {
    const group = getSelectedGroupFromDropdown();
    if (!group) return;
    setAnnotationGroupLocked(group.groupId, group.groupLocked !== true);
  });

document
  .getElementById("renameAnnotationGroupButton")
  .addEventListener("click", function () {
    const group = getSelectedGroupFromDropdown();
    if (!group) return;
    showPrompt("Rename group:", (value) => {
      renameAnnotationGroup(group.groupId, value);
    }, group.groupName);
  });

document
  .getElementById("newAnnotationGroupButton")
  .addEventListener("click", function () {
    if (getUnlockedSelectedAnnotationUuids().length === 0) return;
    showPrompt("Enter the group name:", createAnnotationGroupForSelection);
  });

renderAnnotationList();

// When the delete annotation button is clicked
document.getElementById("deleteButton").addEventListener("click", function () {
  const selectedUuids = getUnlockedSelectedAnnotationUuids();
  if (selectedUuids.length === 0) return;

  if (
    selectedUuids.length === annoJSON.features.length &&
    annoJSON.features.every((feature) => !isAnnotationFeatureLocked(feature))
  ) {
    annotationHistory.push("Delete annotations");
    clearAnnotations();
    unsavedAnnotations(true);
    disableAnnoButtons();
    return;
  }

  annotationHistory.push(
    selectedUuids.length === 1 ? "Delete annotation" : "Delete annotations"
  );

  const selectedSet = new Set(selectedUuids);
  selectedUuids.forEach((uuid) => {
    deleteText(uuid, "anno");
    deleteCrosshairs(uuid, "anno");
  });
  annoJSON.features = annoJSON.features.filter(
    (feature) => !selectedSet.has(feature.properties?.uuid)
  );
  clearAnnotationSelection({ redraw: false, scroll: false });
  drawShape(polyCanvas, [annoJSON]);
  renderAnnotationList();

  if (annoJSON.features.length === 0) {
    disableAnnoButtons();
  }
});

// labels could be changed without affecting the underlying color of the shapes
function applyCurrentAnno(id, changeLabel = false) {
  const feature = annoJSON.features[id - 1];
  if (!feature || isAnnotationFeatureLocked(feature)) return;

  const labelFontSize = Number(
    document.getElementById("annoLabelFontSize").value
  );
  const labelFontColor = getAnnotationLabelFontColor();
  const labelBackgroundColor = getAnnotationLabelBackgroundColor();
  const labelBackgroundOpacity = getAnnotationOpacityValue(
    "annoLabelBackgroundOpacity"
  );
  const lineWeight = Number(document.getElementById("lineWeight").value);
  const lineColor = getAnnotationLineColor();
  const lineOpacity = getAnnotationOpacityValue("lineOpacity");
  const lineStyle = document.getElementById("lineStyle").value;
  const fillColor = getAnnotationFillColor();
  const fillOpacity = getAnnotationOpacityValue("fillOpacity");
  const uuid = feature.properties.uuid;
  const type = feature.geometry.type;
  if (type === "Point") {
    if (changeLabel) {
      annoJSON.features[id - 1].properties.labelFontSize = labelFontSize;
      annoJSON.features[id - 1].properties.labelFontColor = labelFontColor;
      annoJSON.features[id - 1].properties.labelBackgroundColor =
        labelBackgroundColor;
      annoJSON.features[id - 1].properties.labelBackgroundOpacity =
        labelBackgroundOpacity;
      updateText(
        uuid,
        "anno",
        undefined,
        labelFontColor,
        labelFontSize,
        labelBackgroundColor,
        labelBackgroundOpacity
      );
    } else {
      annoJSON.features[id - 1].properties.lineWeight = lineWeight;
      annoJSON.features[id - 1].properties.lineColor = lineColor;
      annoJSON.features[id - 1].properties.lineOpacity = lineOpacity;
      updateCrosshair(uuid, "anno", lineColor, lineWeight, lineOpacity);
    }
  }
  if ((type === "Polygon") | (type === "MultiPolygon")) {
    if (changeLabel) {
      annoJSON.features[id - 1].properties.labelFontSize = labelFontSize;
      annoJSON.features[id - 1].properties.labelFontColor = labelFontColor;
      annoJSON.features[id - 1].properties.labelBackgroundColor =
        labelBackgroundColor;
      annoJSON.features[id - 1].properties.labelBackgroundOpacity =
        labelBackgroundOpacity;
      updateText(
        uuid,
        "anno",
        undefined,
        String(labelFontColor),
        labelFontSize,
        labelBackgroundColor,
        labelBackgroundOpacity
      );
    } else {
      annoJSON.features[id - 1].properties.lineStyle = lineStyle;
      annoJSON.features[id - 1].properties.lineWeight = lineWeight;
      annoJSON.features[id - 1].properties.lineColor = lineColor;
      annoJSON.features[id - 1].properties.lineOpacity = lineOpacity;
      annoJSON.features[id - 1].properties.fillColor = fillColor;
      annoJSON.features[id - 1].properties.fillOpacity = fillOpacity;
      drawShape(polyCanvas, [annoJSON]);
    }
  }
  if ((type === "LineString") | (type === "MultiLineString")) {
    if (changeLabel) {
      annoJSON.features[id - 1].properties.labelFontSize = labelFontSize;
      annoJSON.features[id - 1].properties.labelFontColor = labelFontColor;
      annoJSON.features[id - 1].properties.labelBackgroundColor =
        labelBackgroundColor;
      annoJSON.features[id - 1].properties.labelBackgroundOpacity =
        labelBackgroundOpacity;
      updateText(
        uuid,
        "anno",
        undefined,
        String(labelFontColor),
        labelFontSize,
        labelBackgroundColor,
        labelBackgroundOpacity
      );
    } else {
      annoJSON.features[id - 1].properties.lineStyle = lineStyle;
      annoJSON.features[id - 1].properties.lineWeight = lineWeight;
      annoJSON.features[id - 1].properties.lineColor = lineColor;
      annoJSON.features[id - 1].properties.lineOpacity = lineOpacity;
      drawShape(polyCanvas, [annoJSON]);
    }
  }
}

function applyCurrentGrid(id, changeLabel = false) {
  const labelFontSize = Number(
    document.getElementById("gridLabelFontSize").value
  );
  const labelFontSizeAfter = Number(
    document.getElementById("gridLabelFontSizeAfter").value
  );
  const labelFontColor = document.getElementById("gridLabelFontColor").value;
  const labelFontColorAfter = document.getElementById(
    "gridLabelFontColorAfter"
  ).value;
  const labelBackgroundColor = document.getElementById(
    "gridLabelBackgroundColor"
  ).value;
  const labelBackgroundColorAfter = document.getElementById(
    "gridLabelBackgroundColorAfter"
  ).value;
  const labelBackgroundOpacity = Number(
    document.getElementById("gridLabelBackgroundOpacity").value
  );
  const labelBackgroundOpacityAfter = Number(
    document.getElementById("gridLabelBackgroundOpacityAfter").value
  );
  const lineWeight = Number(document.getElementById("gridLineWeight").value);
  const lineWeightAfter = Number(
    document.getElementById("gridLineWeightAfter").value
  );
  const lineColor = document.getElementById("gridLineColor").value;
  const lineColorAfter = document.getElementById("gridLineColorAfter").value;
  const lineOpacity = Number(document.getElementById("gridLineOpacity").value);
  const lineOpacityAfter = Number(
    document.getElementById("gridLineOpacityAfter").value
  );
  const uuid = countJSON.features[id - 1].properties.uuid;
  const type = countJSON.features[id - 1].geometry.type;
  if (type === "Point") {
    if (changeLabel) {
      countJSON.features[id - 1].properties.labelFontSize = labelFontSize;
      countJSON.features[id - 1].properties.labelFontSizeAfter =
        labelFontSizeAfter;
      countJSON.features[id - 1].properties.labelFontColor = labelFontColor;
      countJSON.features[id - 1].properties.labelFontColorAfter =
        labelFontColorAfter;
      countJSON.features[id - 1].properties.labelBackgroundColor =
        labelBackgroundColor;
      countJSON.features[id - 1].properties.labelBackgroundColorAfter =
        labelBackgroundColorAfter;
      countJSON.features[id - 1].properties.labelBackgroundOpacity =
        labelBackgroundOpacity;
      countJSON.features[id - 1].properties.labelBackgroundOpacityAfter =
        labelBackgroundOpacityAfter;
      updateText(
        uuid,
        "grid",
        undefined,
        labelFontColor,
        labelFontSize,
        labelBackgroundColor,
        labelBackgroundOpacity
      );
    } else {
      countJSON.features[id - 1].properties.lineWeight = lineWeight;
      countJSON.features[id - 1].properties.lineWeightAfter = lineWeightAfter;
      countJSON.features[id - 1].properties.lineColor = lineColor;
      countJSON.features[id - 1].properties.lineColorAfter = lineColorAfter;
      countJSON.features[id - 1].properties.lineOpacity = lineOpacity;
      countJSON.features[id - 1].properties.lineOpacityAfter = lineOpacityAfter;
      updateCrosshair(uuid, "grid", lineColor, lineWeight, lineOpacity);
    }
  }
}

// Apply current annotation text label style
document
  .getElementById("applyCurrentAnnoLabel")
  .addEventListener("click", function () {
    const selectedUuids = getUnlockedSelectedAnnotationUuids();
    if (selectedUuids.length > 0) {
      annotationHistory.push("Style annotation label");
      selectedUuids.forEach((uuid) => {
        const id = getAnnotationIndexByUuid(uuid) + 1;
        if (id > 0) applyCurrentAnno(id, true);
      });
    }
  });

// Apply current annotation text label style to the selected group
document
  .getElementById("applyGroupAnnoLabel")
  .addEventListener("click", function () {
    const group = getSelectedGroupFromDropdown();
    const annoIds = getUnlockedAnnotationIdsForGroup(group?.groupId);
    if (annoIds.length > 0) {
      annotationHistory.push("Style annotation group labels");
    }
    for (let i = 0; i < annoIds.length; i++) {
      applyCurrentAnno(annoIds[i], true);
    }
  });

// Apply current grid text label style
document
  .getElementById("applyCurrentGridLabel")
  .addEventListener("click", function () {
    const id = parseInt(document.getElementById("count-id").value);
    if (countJSON.features[id - 1]) {
      annotationHistory.push("Style count label");
    }
    const uuid = countJSON.features[id - 1].properties.uuid;
    applyCurrentGrid(id, true);
    applyFormattingAfterCount(countJSON, uuid, "text");
  });

// Apply all annotations text label style
document
  .getElementById("applyAllAnnoLabel")
  .addEventListener("click", function () {
    const annoIds = getUnlockedAnnotationIds();
    if (annoIds.length > 0) {
      annotationHistory.push("Style annotation labels");
    }
    for (let i = 0; i < annoIds.length; i++) {
      applyCurrentAnno(annoIds[i], true);
    }
  });

// Apply all grid text label style
document
  .getElementById("applyAllGridLabel")
  .addEventListener("click", function () {
    if (countJSON.features.length > 0) {
      annotationHistory.push("Style count labels");
    }
    const gridIds = Array.from(
      { length: countJSON.features.length },
      (_, i) => i + 1
    );
    for (let i = 0; i < gridIds.length; i++) {
      applyCurrentGrid(gridIds[i], true);
      const uuid = countJSON.features[gridIds[i] - 1].properties.uuid;
      applyFormattingAfterCount(countJSON, uuid, "text");
    }
  });

// Apply current annotation feature style
document
  .getElementById("applyCurrentAnno")
  .addEventListener("click", function () {
    const selectedUuids = getUnlockedSelectedAnnotationUuids();
    if (selectedUuids.length > 0) {
      annotationHistory.push("Style annotation");
      selectedUuids.forEach((uuid) => {
        const id = getAnnotationIndexByUuid(uuid) + 1;
        if (id > 0) applyCurrentAnno(id, false);
      });
    }
  });

// Apply current annotation feature style to the selected group
document
  .getElementById("applyGroupAnno")
  .addEventListener("click", function () {
    const group = getSelectedGroupFromDropdown();
    const annoIds = getUnlockedAnnotationIdsForGroup(group?.groupId);
    if (annoIds.length > 0) {
      annotationHistory.push("Style annotation group");
    }
    for (let i = 0; i < annoIds.length; i++) {
      applyCurrentAnno(annoIds[i], false);
    }
  });

// Apply current grid feature style
document
  .getElementById("applyCurrentGrid")
  .addEventListener("click", function () {
    const id = parseInt(document.getElementById("count-id").value);
    if (countJSON.features[id - 1]) {
      annotationHistory.push("Style count point");
    }
    const uuid = countJSON.features[id - 1].properties.uuid;
    applyCurrentGrid(id, false);
    applyFormattingAfterCount(countJSON, uuid, "point");
  });

// Apply all annotations feature style
document.getElementById("applyAllAnno").addEventListener("click", function () {
  const annoIds = getUnlockedAnnotationIds();
  if (annoIds.length > 0) {
    annotationHistory.push("Style annotations");
  }
  for (let i = 0; i < annoIds.length; i++) {
    applyCurrentAnno(annoIds[i], false);
  }
});

// Apply all grid feature style
document.getElementById("applyAllGrid").addEventListener("click", function () {
  if (countJSON.features.length > 0) {
    annotationHistory.push("Style count points");
  }
  const gridIds = Array.from(
    { length: countJSON.features.length },
    (_, i) => i + 1
  );
  for (let i = 0; i < gridIds.length; i++) {
    applyCurrentGrid(gridIds[i], false);
    const uuid = countJSON.features[gridIds[i] - 1].properties.uuid;
    applyFormattingAfterCount(countJSON, uuid, "point");
  }
});

// Function to update the textbox with the JSON label
function annoLabelToText() {
  setAnnotationTextInputs(getSelectedAnnotation());
}

function focusSelectedAnnotationLabelInput() {
  const feature = getSelectedAnnotation();
  if (!feature || isAnnotationFeatureLocked(feature)) return false;

  openAnnotatePalette();
  restoreToolPaletteFromMinimized(
    annotatePalette,
    minimizeAnnotatePaletteButton
  );

  const annotateDetails = document.getElementById("annotateDetails");
  if (annotateDetails) annotateDetails.open = true;

  const annoLabel = document.getElementById("anno-label");
  if (!annoLabel || annoLabel.disabled) return false;

  requestAnimationFrame(() => {
    annoLabel.focus();
    annoLabel.select();
  });
  return true;
}

// Function to update the JSON based on the selected annotation text boxes
function annoTextToLabel() {
  const feature = getSelectedAnnotation();
  const annoLabel = document.getElementById("anno-label");
  const annoNotes = document.getElementById("anno-notes");
  if (feature && !isAnnotationFeatureLocked(feature)) {
    feature.properties.label = annoLabel.value;
    feature.properties.notes = annoNotes.value;
  }
}

function commitAnnotationTextInput(historyLabel) {
  const feature = getSelectedAnnotation();
  if (!feature) return;
  if (isAnnotationFeatureLocked(feature)) {
    setAnnotationTextInputs(feature);
    return;
  }

  const annoLabel = document.getElementById("anno-label");
  const annoNotes = document.getElementById("anno-notes");
  const labelChanged = feature.properties.label !== annoLabel.value;
  const notesChanged = feature.properties.notes !== annoNotes.value;
  if (!labelChanged && !notesChanged) return;

  annotationHistory.push(historyLabel);
  annoTextToLabel();
  updateText(feature.properties.uuid, "anno", annoLabel.value);
  renderAnnotationList();
}

// When Enter is pressed in the anno-label text box
document.addEventListener("keydown", function (event) {
  const textInput = document.getElementById("anno-label");
  // Check for Enter key in anno-label field
  if (event.code === "Enter" && document.activeElement === textInput) {
    event.preventDefault(); // Prevent any default action for Enter key
    commitAnnotationTextInput("Edit annotation label");
  } else if (event.key === "Escape" && document.activeElement === textInput) {
    event.preventDefault();
    textInput.blur();
  }
});

// When Enter is pressed in the anno-notes text box
document.addEventListener("keydown", function (event) {
  const textInput = document.getElementById("anno-notes");
  // Check for Enter key in anno-notes field
  if (event.code === "Enter" && document.activeElement === textInput) {
    event.preventDefault(); // Prevent any default action for Enter key
    commitAnnotationTextInput("Edit annotation notes");
  } else if (event.key === "Escape" && document.activeElement === textInput) {
    event.preventDefault();
    textInput.blur();
  }
});

document
  .getElementById("anno-label")
  ?.addEventListener("change", () =>
    commitAnnotationTextInput("Edit annotation label")
  );

document
  .getElementById("anno-notes")
  ?.addEventListener("change", () =>
    commitAnnotationTextInput("Edit annotation notes")
  );

document.addEventListener("keydown", function (event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (isTextEntryElement(event.target)) return;
  if (event.key !== "l" && event.key !== "L") return;
  if (!selectedAnnotationUuid) return;

  if (focusSelectedAnnotationLabelInput()) {
    event.preventDefault();
    event.stopPropagation();
  }
});

function goToPoint(x, y) {
  // Center the viewport on the specified coordinates without changing the zoom level
  viewer.viewport.panTo(
    new OpenSeadragon.Point(x, y),
    true // Animate the panning
  );
}

function isAnnotationDrawingActive() {
  return (
    isQPressed ||
    isPointMode ||
    isRectangleMode ||
    isZPressed ||
    isPolylineMode ||
    isXPressed ||
    isPolygonMode ||
    isCPressed ||
    isEllipseMode ||
    isVPressed ||
    isCircleAnnotationMode ||
    activelyMakingPoly ||
    activelyMakingEllipse ||
    activelyMakingCircleAnnotation ||
    startPoint
  );
}

function isAnnotationDraftActive() {
  return (
    activelyMakingPoly ||
    activelyMakingEllipse ||
    activelyMakingCircleAnnotation ||
    Boolean(startPoint) ||
    clickImageCoordinates.length > 0 ||
    ellipseImageCoordinates.length > 0 ||
    Boolean(circleAnnotationCenterImage)
  );
}

function imageCoordToViewerPixel(image, coord) {
  const viewportPoint = image.imageToViewportCoordinates(coord[0], coord[1]);
  return viewer.viewport.viewportToViewerElementCoordinates(viewportPoint);
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        (dx * dx + dy * dy)
    )
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function isImagePointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const crosses =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function isNearLineCoordinates(viewerPoint, image, coordinates, tolerance = 8) {
  for (let i = 1; i < coordinates.length; i++) {
    const start = imageCoordToViewerPixel(image, coordinates[i - 1]);
    const end = imageCoordToViewerPixel(image, coordinates[i]);
    if (distanceToSegment(viewerPoint, start, end) <= tolerance) {
      return true;
    }
  }
  return false;
}

function polygonContainsImagePoint(imagePoint, polygon) {
  if (!polygon.length || !isImagePointInRing(imagePoint, polygon[0])) {
    return false;
  }

  return !polygon.slice(1).some((hole) => isImagePointInRing(imagePoint, hole));
}

function imagePointFromCoord(coord) {
  return { x: coord[0], y: coord[1] };
}

function pointOnImageSegment(point, start, end) {
  const cross =
    (point.y - start.y) * (end.x - start.x) -
    (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > 1e-9) return false;

  return (
    point.x >= Math.min(start.x, end.x) - 1e-9 &&
    point.x <= Math.max(start.x, end.x) + 1e-9 &&
    point.y >= Math.min(start.y, end.y) - 1e-9 &&
    point.y <= Math.max(start.y, end.y) + 1e-9
  );
}

function getImageSegmentOrientation(a, b, c) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : 2;
}

function imageSegmentsIntersect(a, b, c, d) {
  const orientation1 = getImageSegmentOrientation(a, b, c);
  const orientation2 = getImageSegmentOrientation(a, b, d);
  const orientation3 = getImageSegmentOrientation(c, d, a);
  const orientation4 = getImageSegmentOrientation(c, d, b);

  if (orientation1 !== orientation2 && orientation3 !== orientation4) {
    return true;
  }

  return (
    (orientation1 === 0 && pointOnImageSegment(c, a, b)) ||
    (orientation2 === 0 && pointOnImageSegment(d, a, b)) ||
    (orientation3 === 0 && pointOnImageSegment(a, c, d)) ||
    (orientation4 === 0 && pointOnImageSegment(b, c, d))
  );
}

function getRingSegments(ring) {
  const segments = [];
  for (let i = 1; i < ring.length; i++) {
    segments.push([
      imagePointFromCoord(ring[i - 1]),
      imagePointFromCoord(ring[i]),
    ]);
  }
  return segments;
}

function imagePointInMarquee(point, marqueePolygon) {
  return isImagePointInRing(point, marqueePolygon);
}

function lineCoordinatesIntersectMarquee(coordinates, marqueePolygon) {
  const marqueeSegments = getRingSegments(marqueePolygon);
  const lineSegments = getRingSegments(coordinates);

  if (
    coordinates.some((coord) =>
      imagePointInMarquee(imagePointFromCoord(coord), marqueePolygon)
    )
  ) {
    return true;
  }

  return lineSegments.some(([lineStart, lineEnd]) =>
    marqueeSegments.some(([marqueeStart, marqueeEnd]) =>
      imageSegmentsIntersect(lineStart, lineEnd, marqueeStart, marqueeEnd)
    )
  );
}

function polygonIntersectsMarquee(polygon, marqueePolygon) {
  const marqueeSegments = getRingSegments(marqueePolygon);

  if (
    polygon.some((ring) =>
      ring.some((coord) =>
        imagePointInMarquee(imagePointFromCoord(coord), marqueePolygon)
      )
    )
  ) {
    return true;
  }

  if (
    marqueePolygon.some((coord) =>
      polygonContainsImagePoint(imagePointFromCoord(coord), polygon)
    )
  ) {
    return true;
  }

  return polygon.some((ring) =>
    getRingSegments(ring).some(([ringStart, ringEnd]) =>
      marqueeSegments.some(([marqueeStart, marqueeEnd]) =>
        imageSegmentsIntersect(ringStart, ringEnd, marqueeStart, marqueeEnd)
      )
    )
  );
}

function annotationFeatureIntersectsMarquee(feature, marqueePolygon) {
  if (!feature.geometry || !feature.properties?.uuid) return false;
  if (!isAnnotationFeatureVisible(feature)) return false;

  const { type, coordinates } = feature.geometry;
  if (type === "Point") {
    return imagePointInMarquee(imagePointFromCoord(coordinates), marqueePolygon);
  }
  if (type === "MultiPoint") {
    return coordinates.some((coord) =>
      imagePointInMarquee(imagePointFromCoord(coord), marqueePolygon)
    );
  }
  if (type === "LineString") {
    return lineCoordinatesIntersectMarquee(coordinates, marqueePolygon);
  }
  if (type === "MultiLineString") {
    return coordinates.some((line) =>
      lineCoordinatesIntersectMarquee(line, marqueePolygon)
    );
  }
  if (type === "Polygon") {
    return polygonIntersectsMarquee(coordinates, marqueePolygon);
  }
  if (type === "MultiPolygon") {
    return coordinates.some((polygon) =>
      polygonIntersectsMarquee(polygon, marqueePolygon)
    );
  }
  return false;
}

function findAnnotationUuidAtViewerPoint(viewerPoint, options = {}) {
  const lineTolerance = options.lineTolerance ?? 8;
  const image = viewer.world.getItemAt(0);
  if (!image) return null;

  const viewportPoint = viewer.viewport.pointFromPixel(viewerPoint);
  const imagePoint = image.viewportToImageCoordinates(viewportPoint);

  for (let i = annoJSON.features.length - 1; i >= 0; i--) {
    const feature = annoJSON.features[i];
    if (!feature.geometry || !feature.properties?.uuid) continue;
    if (!isAnnotationFeatureVisible(feature)) continue;
    if (isAnnotationFeatureLocked(feature)) continue;

    const { type, coordinates } = feature.geometry;
    if (type === "Point") {
      const pointPixel = imageCoordToViewerPixel(image, coordinates);
      if (Math.hypot(viewerPoint.x - pointPixel.x, viewerPoint.y - pointPixel.y) <= 10) {
        return feature.properties.uuid;
      }
    } else if (type === "LineString") {
      if (isNearLineCoordinates(viewerPoint, image, coordinates, lineTolerance)) {
        return feature.properties.uuid;
      }
    } else if (type === "MultiLineString") {
      if (
        coordinates.some((line) =>
          isNearLineCoordinates(viewerPoint, image, line, lineTolerance)
        )
      ) {
        return feature.properties.uuid;
      }
    } else if (type === "Polygon") {
      if (
        polygonContainsImagePoint(imagePoint, coordinates) ||
        coordinates.some((ring) =>
          isNearLineCoordinates(viewerPoint, image, ring, lineTolerance)
        )
      ) {
        return feature.properties.uuid;
      }
    } else if (type === "MultiPolygon") {
      if (
        coordinates.some(
          (polygon) =>
            polygonContainsImagePoint(imagePoint, polygon) ||
            polygon.some((ring) =>
              isNearLineCoordinates(viewerPoint, image, ring, lineTolerance)
            )
        )
      ) {
        return feature.properties.uuid;
      }
    }
  }

  return null;
}

function getImagePointFromViewerPixel(pixelPoint) {
  const image = viewer.world.getItemAt(0);
  if (!image) return null;

  const viewportPoint = viewer.viewport.pointFromPixel(pixelPoint);
  return image.viewportToImageCoordinates(viewportPoint);
}

function getImagePointFromPointerEvent(event) {
  return getImagePointFromViewerPixel(
    new OpenSeadragon.Point(event.clientX, event.clientY)
  );
}

function translateCoordinateArray(coordinates, dx, dy) {
  if (!Array.isArray(coordinates)) return coordinates;
  if (
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    coordinates[0] += dx;
    coordinates[1] += dy;
    return coordinates;
  }

  coordinates.forEach((coordinate) => translateCoordinateArray(coordinate, dx, dy));
  return coordinates;
}

function translateAnnotationFeature(feature, dx, dy) {
  if (!feature?.geometry?.coordinates || !feature.properties) return;

  translateCoordinateArray(feature.geometry.coordinates, dx, dy);

  ["xLabel", "circleCenterX"].forEach((property) => {
    if (typeof feature.properties[property] === "number") {
      feature.properties[property] += dx;
    }
  });
  ["yLabel", "circleCenterY"].forEach((property) => {
    if (typeof feature.properties[property] === "number") {
      feature.properties[property] += dy;
    }
  });
}

function refreshAnnotationAfterMove({ updateList = false } = {}) {
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  removeAnnotationOverlays();
  renderAnnotationOverlaysFromJSON();
  applyAnnotationVisibilityState();
  syncSelectedAnnotationVisuals();
  if (updateList) renderAnnotationList();
}

function startAnnotationMoveDrag(event) {
  if (!isAnnotationMoveMode || getUnlockedSelectedAnnotationUuids().length === 0) {
    return false;
  }
  if (isAnnotationDrawingActive()) return false;

  const delta = event.delta || new OpenSeadragon.Point(0, 0);
  const startPixel = new OpenSeadragon.Point(
    event.position.x - delta.x,
    event.position.y - delta.y
  );
  const uuidAtStart = findAnnotationUuidAtViewerPoint(startPixel);
  if (!uuidAtStart) return false;

  if (isAnnotationUuidLocked(uuidAtStart)) return false;

  if (!selectedAnnotationUuids.has(uuidAtStart)) {
    selectAnnotationByUuid(uuidAtStart, { pan: false, scroll: false });
  }

  const startImagePoint = getImagePointFromViewerPixel(startPixel);
  const currentImagePoint = getImagePointFromViewerPixel(event.position);
  if (!startImagePoint || !currentImagePoint) return false;

  annotationHistory.push(
    selectedAnnotationUuids.size === 1 ? "Move annotation" : "Move annotations"
  );
  annotationMoveDragState = {
    lastImagePoint: startImagePoint,
    moved: false,
  };
  viewerContainer?.classList.add("annotation-moving");

  moveSelectedAnnotationsToImagePoint(currentImagePoint);
  return true;
}

function moveSelectedAnnotationsToImagePoint(imagePoint) {
  if (!annotationMoveDragState || !imagePoint) return false;

  const dx = imagePoint.x - annotationMoveDragState.lastImagePoint.x;
  const dy = imagePoint.y - annotationMoveDragState.lastImagePoint.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
    return true;
  }

  getUnlockedSelectedAnnotationUuids().forEach((uuid) => {
    translateAnnotationFeature(getAnnotationByUuid(uuid), dx, dy);
  });
  annotationMoveDragState.lastImagePoint = imagePoint;
  annotationMoveDragState.moved = true;
  refreshAnnotationAfterMove();
  return true;
}

function finishAnnotationMoveDrag() {
  if (!annotationMoveDragState) return false;

  const moved = annotationMoveDragState.moved;
  annotationMoveDragState = null;
  viewerContainer?.classList.remove("annotation-moving");
  if (moved) {
    refreshAnnotationAfterMove({ updateList: true });
    unsavedAnnotations(true);
    suppressAnnotationClickBriefly();
  }
  return true;
}

function updateAnnotationLabelOverlayPosition(uuid) {
  const feature = getAnnotationByUuid(uuid);
  const label = document.getElementById(`annotate-label-${uuid}`);
  const container = label?.closest(".annotation-overlay");
  const image = viewer.world.getItemAt(0);
  if (!feature?.properties || !container || !image) return;

  const viewportPoint = image.imageToViewportCoordinates(
    new OpenSeadragon.Point(feature.properties.xLabel, feature.properties.yLabel)
  );
  viewer.updateOverlay(container, viewportPoint);
}

function startAnnotationLabelMoveDrag(event, uuid) {
  if (!isAnnotationLabelMoveMode || !uuid) return false;
  const feature = getAnnotationByUuid(uuid);
  if (!feature) return false;
  if (isAnnotationFeatureLocked(feature)) return false;

  const imagePoint = getImagePointFromPointerEvent(event);
  if (!imagePoint) return false;

  if (!selectedAnnotationUuids.has(uuid)) {
    selectAnnotationByUuid(uuid, { pan: false, scroll: false });
  }

  annotationHistory.push("Move annotation label");
  annotationLabelMoveDragState = {
    uuid,
    lastImagePoint: imagePoint,
    moved: false,
  };
  viewerContainer?.classList.add("annotation-label-moving");
  window.addEventListener("pointermove", handleAnnotationLabelWindowPointerMove);
  window.addEventListener("pointerup", handleAnnotationLabelWindowPointerUp);
  window.addEventListener("pointercancel", handleAnnotationLabelWindowPointerUp);
  return true;
}

function moveAnnotationLabelToImagePoint(imagePoint) {
  if (!annotationLabelMoveDragState || !imagePoint) return false;

  const feature = getAnnotationByUuid(annotationLabelMoveDragState.uuid);
  if (!feature?.properties) return false;

  const dx = imagePoint.x - annotationLabelMoveDragState.lastImagePoint.x;
  const dy = imagePoint.y - annotationLabelMoveDragState.lastImagePoint.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
    return true;
  }

  feature.properties.xLabel = Number(feature.properties.xLabel) + dx;
  feature.properties.yLabel = Number(feature.properties.yLabel) + dy;
  annotationLabelMoveDragState.lastImagePoint = imagePoint;
  annotationLabelMoveDragState.moved = true;
  updateAnnotationLabelOverlayPosition(annotationLabelMoveDragState.uuid);
  return true;
}

function finishAnnotationLabelMoveDrag() {
  if (!annotationLabelMoveDragState) return false;

  const moved = annotationLabelMoveDragState.moved;
  annotationLabelMoveDragState = null;
  viewerContainer?.classList.remove("annotation-label-moving");
  window.removeEventListener("pointermove", handleAnnotationLabelWindowPointerMove);
  window.removeEventListener("pointerup", handleAnnotationLabelWindowPointerUp);
  window.removeEventListener("pointercancel", handleAnnotationLabelWindowPointerUp);
  if (moved) {
    unsavedAnnotations(true);
    suppressAnnotationClickBriefly();
  }
  return true;
}

function isVertexEditableAnnotation(feature) {
  if (!feature?.geometry || !feature.properties?.uuid) return false;
  if (feature.geometry.type === "LineString") return true;
  if (feature.geometry.type !== "Polygon") return false;

  return !["rectangle", "ellipse", "circle"].includes(feature.properties.shapeType);
}

function isShapeEditableAnnotation(feature) {
  return (
    feature?.geometry?.type === "Point" ||
    (feature?.geometry?.type === "Polygon" &&
      ["rectangle", "ellipse", "circle"].includes(feature.properties?.shapeType))
  );
}

function isRotationEditableAnnotation(feature) {
  if (!feature?.geometry || !feature.properties?.uuid) return false;
  if (feature.geometry.type === "LineString") return true;
  if (feature.geometry.type !== "Polygon") return false;

  const shapeType = feature.properties?.shapeType;
  return shapeType !== "circle";
}

function getEditableVertexCoordinates(feature) {
  if (!isVertexEditableAnnotation(feature)) return [];
  if (feature.geometry.type === "LineString") return feature.geometry.coordinates;

  const ring = feature.geometry.coordinates?.[0] || [];
  const isClosed = ring.length > 1 && coordinatesMatch(ring[0], ring[ring.length - 1]);
  return isClosed ? ring.slice(0, -1) : ring;
}

function removeAnnotationVertexHandles() {
  [...document.getElementsByClassName("annotation-vertex-handle")].forEach(
    (handle) => {
      viewer.removeOverlay(handle);
      handle.remove();
    }
  );
}

function addAnnotationEditMoveHandle(uuid, coordinate, image) {
  if (!uuid || !coordinate || !image) return;
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className =
    "annotation-vertex-handle annotation-shape-handle annotation-shape-handle-center";
  handle.title = "Move annotation";
  handle.setAttribute("aria-label", "Move annotation");
  handle.dataset.annotationUuid = uuid;
  handle.dataset.handleType = "center";
  handle.addEventListener("pointerdown", function (event) {
    handleAnnotationShapePointerDown(event, uuid, "center");
  });

  viewer.addOverlay({
    element: handle,
    location: image.imageToViewportCoordinates(
      new OpenSeadragon.Point(coordinate.x, coordinate.y)
    ),
    checkResize: false,
    rotationMode: OpenSeadragon.OverlayRotationMode.NO_ROTATION,
  });
}

function renderAnnotationVertexHandles() {
  removeAnnotationVertexHandles();

  const feature = getAnnotationByUuid(activeVertexEditUuid);
  if (!isVertexEditableAnnotation(feature)) return;

  const image = viewer.world.getItemAt(0);
  if (!image) return;

  addAnnotationEditMoveHandle(
    activeVertexEditUuid,
    getFeatureEditMoveCoordinate(feature),
    image
  );

  const rotationHandleCoordinate = getRotationHandleCoordinate(feature);
  if (rotationHandleCoordinate) {
    const rotateHandle = document.createElement("button");
    rotateHandle.type = "button";
    rotateHandle.className =
      "annotation-vertex-handle annotation-shape-handle annotation-shape-handle-rotate";
    rotateHandle.title = "Rotate annotation. Hold Shift to snap.";
    rotateHandle.setAttribute(
      "aria-label",
      "Rotate annotation. Hold Shift to snap."
    );
    rotateHandle.dataset.annotationUuid = activeVertexEditUuid;
    rotateHandle.dataset.handleType = "rotate";
    rotateHandle.addEventListener("pointerdown", function (event) {
      handleAnnotationShapePointerDown(event, activeVertexEditUuid, "rotate");
    });

    viewer.addOverlay({
      element: rotateHandle,
      location: image.imageToViewportCoordinates(
        new OpenSeadragon.Point(
          rotationHandleCoordinate[0],
          rotationHandleCoordinate[1]
        )
      ),
      checkResize: false,
      rotationMode: OpenSeadragon.OverlayRotationMode.NO_ROTATION,
    });
  }

  getEditableVertexCoordinates(feature).forEach((coordinate, vertexIndex) => {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "annotation-vertex-handle";
    handle.title = "Drag vertex. Option-click to delete.";
    handle.setAttribute(
      "aria-label",
      `Move vertex ${vertexIndex + 1}. Option-click to delete.`
    );
    handle.dataset.annotationUuid = activeVertexEditUuid;
    handle.dataset.vertexIndex = String(vertexIndex);
    handle.addEventListener("pointerdown", function (event) {
      handleAnnotationVertexPointerDown(event, activeVertexEditUuid, vertexIndex);
    });

    viewer.addOverlay({
      element: handle,
      location: image.imageToViewportCoordinates(
        new OpenSeadragon.Point(coordinate[0], coordinate[1])
      ),
      checkResize: false,
      rotationMode: OpenSeadragon.OverlayRotationMode.NO_ROTATION,
    });
  });
  updateAnnotationOverlayRotation();
}

function enterAnnotationVertexEditMode(uuid) {
  const feature = getAnnotationByUuid(uuid);
  if (!isVertexEditableAnnotation(feature)) return false;
  if (isAnnotationFeatureLocked(feature)) return false;

  exitAnnotationShapeEditMode();
  setAnnotationMoveMode(false);
  setAnnotationLabelMoveMode(false);
  activeVertexEditUuid = uuid;
  viewerContainer?.classList.add("annotation-vertex-editing");
  renderAnnotationVertexHandles();
  return true;
}

function exitAnnotationVertexEditMode() {
  if (!activeVertexEditUuid && !annotationVertexDragState) return;

  activeVertexEditUuid = null;
  annotationVertexDragState = null;
  removeAnnotationVertexHandles();
  viewerContainer?.classList.remove(
    "annotation-vertex-editing",
    "annotation-vertex-dragging"
  );
  window.removeEventListener("pointermove", handleAnnotationVertexWindowPointerMove);
  window.removeEventListener("pointerup", handleAnnotationVertexWindowPointerUp);
  window.removeEventListener("pointercancel", handleAnnotationVertexWindowPointerUp);
}

function coordinatesMatch(a, b) {
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    Math.abs(Number(a[0]) - Number(b[0])) < 1e-6 &&
    Math.abs(Number(a[1]) - Number(b[1])) < 1e-6
  );
}

function getCoordinatesWithoutTrailingDuplicate(coordinates) {
  const cleanedCoordinates = coordinates.map((coordinate) => [...coordinate]);
  while (
    cleanedCoordinates.length > 1 &&
    coordinatesMatch(
      cleanedCoordinates[cleanedCoordinates.length - 1],
      cleanedCoordinates[cleanedCoordinates.length - 2]
    )
  ) {
    cleanedCoordinates.pop();
  }
  return cleanedCoordinates;
}

function setAnnotationVertexCoordinate(feature, vertexIndex, imagePoint) {
  if (!isVertexEditableAnnotation(feature) || !imagePoint) return;

  const nextCoordinate = [imagePoint.x, imagePoint.y];
  let oldCoordinate = null;

  if (feature.geometry.type === "LineString") {
    oldCoordinate = [...feature.geometry.coordinates[vertexIndex]];
    feature.geometry.coordinates[vertexIndex] = nextCoordinate;
  } else if (feature.geometry.type === "Polygon") {
    const ring = feature.geometry.coordinates?.[0];
    if (!ring?.[vertexIndex]) return;
    const closingIndex = ring.length - 1;
    const isClosed = ring.length > 1 && coordinatesMatch(ring[0], ring[closingIndex]);

    oldCoordinate = [...ring[vertexIndex]];
    ring[vertexIndex] = nextCoordinate;
    if (isClosed && (vertexIndex === 0 || vertexIndex === closingIndex)) {
      ring[0] = [...nextCoordinate];
      ring[closingIndex] = [...nextCoordinate];
    }
  }

  if (
    oldCoordinate &&
    coordinatesMatch(
      [feature.properties.xLabel, feature.properties.yLabel],
      oldCoordinate
    )
  ) {
    feature.properties.xLabel = nextCoordinate[0];
    feature.properties.yLabel = nextCoordinate[1];
    updateAnnotationLabelOverlayPosition(feature.properties.uuid);
  }
}

function getMinimumEditableVertexCount(feature) {
  if (feature?.geometry?.type === "Polygon") return 3;
  if (feature?.geometry?.type === "LineString") return 2;
  return 0;
}

function setEditableVertexCoordinates(feature, coordinates) {
  if (!isVertexEditableAnnotation(feature)) return false;

  if (feature.geometry.type === "LineString") {
    feature.geometry.coordinates = coordinates.map((coordinate) => [...coordinate]);
    return true;
  }

  if (feature.geometry.type === "Polygon") {
    const ring = coordinates.map((coordinate) => [...coordinate]);
    if (
      ring.length > 0 &&
      !coordinatesMatch(ring[0], ring[ring.length - 1])
    ) {
      ring.push([...ring[0]]);
    }
    feature.geometry.coordinates[0] = ring;
    return true;
  }

  return false;
}

function finishAnnotationVertexGeometryEdit(uuid, historyLabel, undoState) {
  annotationHistory.push(historyLabel, undoState);
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  renderAnnotationVertexHandles();
  renderAnnotationList();
  syncSelectedAnnotationVisuals();
  unsavedAnnotations(true);
  suppressAnnotationClickBriefly();
}

function getVectorLength(vector) {
  return Math.hypot(vector.x, vector.y);
}

function normalizeVector(vector) {
  const length = getVectorLength(vector);
  if (length === 0) return null;
  return { x: vector.x / length, y: vector.y / length };
}

function dotVector(a, b) {
  return a.x * b.x + a.y * b.y;
}

function addScaledVector(point, vector, scale) {
  return [point.x + vector.x * scale, point.y + vector.y * scale];
}

function rotatePointAroundCenter(point, center, angleRadians) {
  const cosAngle = Math.cos(angleRadians);
  const sinAngle = Math.sin(angleRadians);
  const dx = Number(point[0]) - center.x;
  const dy = Number(point[1]) - center.y;
  return [
    center.x + dx * cosAngle - dy * sinAngle,
    center.y + dx * sinAngle + dy * cosAngle,
  ];
}

function rotateVector(vector, angleRadians) {
  const cosAngle = Math.cos(angleRadians);
  const sinAngle = Math.sin(angleRadians);
  return {
    x: vector.x * cosAngle - vector.y * sinAngle,
    y: vector.x * sinAngle + vector.y * cosAngle,
  };
}

function snapAngleRadians(angleRadians, snapDegrees = 15) {
  const snapRadians = (snapDegrees * Math.PI) / 180;
  return Math.round(angleRadians / snapRadians) * snapRadians;
}

function coordToPoint(coord) {
  return { x: Number(coord[0]), y: Number(coord[1]) };
}

function getVisiblePolygonRing(feature) {
  const ring = getCoordinatesWithoutTrailingDuplicate(
    feature.geometry.coordinates?.[0] || []
  );
  if (ring.length > 1 && coordinatesMatch(ring[0], ring[ring.length - 1])) {
    ring.pop();
  }
  return ring;
}

function getCoordinateCenter(coordinates) {
  if (!coordinates.length) return null;
  const center = coordinates.reduce(
    (acc, coord) => ({
      x: acc.x + Number(coord[0]) / coordinates.length,
      y: acc.y + Number(coord[1]) / coordinates.length,
    }),
    { x: 0, y: 0 }
  );
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return null;
  return center;
}

function getFeatureEditMoveCoordinate(feature) {
  if (!feature?.geometry) return null;
  if (feature.geometry.type === "Point") {
    return coordToPoint(feature.geometry.coordinates);
  }
  if (feature.geometry.type === "LineString") {
    return getCoordinateCenter(feature.geometry.coordinates || []);
  }
  if (feature.geometry.type === "Polygon") {
    if (feature.properties?.shapeType === "rectangle") {
      return getRectangleEditModel(feature)?.center || null;
    }
    if (feature.properties?.shapeType === "ellipse") {
      return getEllipseEditModel(feature)?.center || null;
    }
    if (feature.properties?.shapeType === "circle") {
      return getCircleEditModel(feature)?.center || null;
    }
    return getCoordinateCenter(getVisiblePolygonRing(feature));
  }
  return null;
}

function getFeatureRotationCoordinates(feature) {
  if (!feature?.geometry) return [];
  if (feature.geometry.type === "LineString") {
    return (feature.geometry.coordinates || []).filter(Array.isArray);
  }
  if (feature.geometry.type === "Polygon") {
    return getVisiblePolygonRing(feature);
  }
  return [];
}

function getImageDistanceForViewerPixels(center, pixelDistance) {
  const image = viewer.world.getItemAt(0);
  if (!image || !center) return pixelDistance;

  const centerViewport = image.imageToViewportCoordinates(
    new OpenSeadragon.Point(center.x, center.y)
  );
  const centerPixel =
    viewer.viewport.viewportToViewerElementCoordinates(centerViewport);
  const offsetViewport = viewer.viewport.viewerElementToViewportCoordinates(
    new OpenSeadragon.Point(centerPixel.x, centerPixel.y - pixelDistance)
  );
  const offsetImage = image.viewportToImageCoordinates(offsetViewport);
  return Math.hypot(offsetImage.x - center.x, offsetImage.y - center.y);
}

function getRotationHandleCoordinate(feature) {
  if (!isRotationEditableAnnotation(feature)) return null;

  const center = getFeatureEditMoveCoordinate(feature);
  const coordinates = getFeatureRotationCoordinates(feature);
  if (!center || coordinates.length < 2) return null;

  const maxRadius = coordinates.reduce((maxDistance, coordinate) => {
    const distance = Math.hypot(
      Number(coordinate[0]) - center.x,
      Number(coordinate[1]) - center.y
    );
    return Number.isFinite(distance) ? Math.max(maxDistance, distance) : maxDistance;
  }, 0);
  const handleOffset = getImageDistanceForViewerPixels(center, 28);
  return [center.x, center.y - maxRadius - handleOffset];
}

function getRectangleEditModel(feature) {
  const ring = getVisiblePolygonRing(feature);
  if (ring.length < 4) return null;

  const p0 = coordToPoint(ring[0]);
  const p1 = coordToPoint(ring[1]);
  const p3 = coordToPoint(ring[3]);
  const u = normalizeVector({ x: p1.x - p0.x, y: p1.y - p0.y });
  const v = normalizeVector({ x: p3.x - p0.x, y: p3.y - p0.y });
  if (!u || !v) return null;

  const center = ring.slice(0, 4).reduce(
    (acc, coord) => ({
      x: acc.x + Number(coord[0]) / 4,
      y: acc.y + Number(coord[1]) / 4,
    }),
    { x: 0, y: 0 }
  );
  const projections = ring.slice(0, 4).map((coord) => {
    const point = coordToPoint(coord);
    const relative = { x: point.x - center.x, y: point.y - center.y };
    return {
      u: dotVector(relative, u),
      v: dotVector(relative, v),
    };
  });

  return {
    center,
    u,
    v,
    minU: Math.min(...projections.map((point) => point.u)),
    maxU: Math.max(...projections.map((point) => point.u)),
    minV: Math.min(...projections.map((point) => point.v)),
    maxV: Math.max(...projections.map((point) => point.v)),
  };
}

function getRectangleCoordinatesFromModel(model) {
  return [
    addScaledVector(
      { x: model.center.x + model.v.x * model.minV, y: model.center.y + model.v.y * model.minV },
      model.u,
      model.minU
    ),
    addScaledVector(
      { x: model.center.x + model.v.x * model.minV, y: model.center.y + model.v.y * model.minV },
      model.u,
      model.maxU
    ),
    addScaledVector(
      { x: model.center.x + model.v.x * model.maxV, y: model.center.y + model.v.y * model.maxV },
      model.u,
      model.maxU
    ),
    addScaledVector(
      { x: model.center.x + model.v.x * model.maxV, y: model.center.y + model.v.y * model.maxV },
      model.u,
      model.minU
    ),
  ];
}

function getEllipseEditModel(feature) {
  const ring = getVisiblePolygonRing(feature);
  if (ring.length < 8) return null;

  const center = ring.reduce(
    (acc, coord) => ({
      x: acc.x + Number(coord[0]) / ring.length,
      y: acc.y + Number(coord[1]) / ring.length,
    }),
    { x: 0, y: 0 }
  );
  const majorEndpoint = coordToPoint(ring[0]);
  const u = normalizeVector({
    x: majorEndpoint.x - center.x,
    y: majorEndpoint.y - center.y,
  });
  if (!u) return null;

  const v = { x: -u.y, y: u.x };
  const projections = ring.map((coord) => {
    const point = coordToPoint(coord);
    const relative = { x: point.x - center.x, y: point.y - center.y };
    return {
      u: Math.abs(dotVector(relative, u)),
      v: Math.abs(dotVector(relative, v)),
    };
  });

  return {
    center,
    u,
    v,
    majorRadius: Math.max(...projections.map((point) => point.u)),
    minorRadius: Math.max(...projections.map((point) => point.v)),
  };
}

function cloneEllipseEditModel(model) {
  if (!model) return null;
  return {
    center: { ...model.center },
    u: { ...model.u },
    v: { ...model.v },
    majorRadius: model.majorRadius,
    minorRadius: model.minorRadius,
  };
}

function cloneRectangleEditModel(model) {
  if (!model) return null;
  return {
    center: { ...model.center },
    u: { ...model.u },
    v: { ...model.v },
    minU: model.minU,
    maxU: model.maxU,
    minV: model.minV,
    maxV: model.maxV,
  };
}

function getCircleEditModel(feature) {
  const props = feature.properties || {};
  const ring = getVisiblePolygonRing(feature);
  let center = {
    x: Number(props.circleCenterX),
    y: Number(props.circleCenterY),
  };
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) {
    center = ring.reduce(
      (acc, coord) => ({
        x: acc.x + Number(coord[0]) / ring.length,
        y: acc.y + Number(coord[1]) / ring.length,
      }),
      { x: 0, y: 0 }
    );
  }

  let radius = Number(props.circleRadiusPixels);
  if (!Number.isFinite(radius) || radius <= 0) {
    const firstPoint = ring[0];
    if (!firstPoint) return null;
    radius = getVectorLength({
      x: Number(firstPoint[0]) - center.x,
      y: Number(firstPoint[1]) - center.y,
    });
  }
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y) || radius <= 0) {
    return null;
  }

  return { center, radius };
}

function getShapeEditHandles(feature) {
  if (!isShapeEditableAnnotation(feature)) return [];
  if (feature.geometry.type === "Point") {
    const center = getFeatureEditMoveCoordinate(feature);
    return center ? [{ handleType: "center", coordinate: [center.x, center.y] }] : [];
  }
  const shapeType = feature.properties.shapeType;

  if (shapeType === "rectangle") {
    const model = getRectangleEditModel(feature);
    if (!model) return [];
    const { minU, maxU, minV, maxV, u, v, center } = model;
    const point = (uValue, vValue) =>
      addScaledVector(
        {
          x: center.x + v.x * vValue,
          y: center.y + v.y * vValue,
        },
        u,
        uValue
      );
    const handles = [
      { handleType: "center", coordinate: [center.x, center.y] },
      { handleType: "top-left", coordinate: point(minU, minV) },
      { handleType: "top", coordinate: point((minU + maxU) / 2, minV) },
      { handleType: "top-right", coordinate: point(maxU, minV) },
      { handleType: "right", coordinate: point(maxU, (minV + maxV) / 2) },
      { handleType: "bottom-right", coordinate: point(maxU, maxV) },
      { handleType: "bottom", coordinate: point((minU + maxU) / 2, maxV) },
      { handleType: "bottom-left", coordinate: point(minU, maxV) },
      { handleType: "left", coordinate: point(minU, (minV + maxV) / 2) },
    ];
    const rotationHandleCoordinate = getRotationHandleCoordinate(feature);
    if (rotationHandleCoordinate) {
      handles.push({ handleType: "rotate", coordinate: rotationHandleCoordinate });
    }
    return handles;
  }

  if (shapeType === "ellipse") {
    const model = getEllipseEditModel(feature);
    if (!model) return [];
    const { center, u, v, majorRadius, minorRadius } = model;
    const handles = [
      { handleType: "center", coordinate: [center.x, center.y] },
      { handleType: "major-radius", coordinate: addScaledVector(center, u, majorRadius) },
      { handleType: "minor-radius", coordinate: addScaledVector(center, v, minorRadius) },
    ];
    const rotationHandleCoordinate = getRotationHandleCoordinate(feature);
    if (rotationHandleCoordinate) {
      handles.push({ handleType: "rotate", coordinate: rotationHandleCoordinate });
    }
    return handles;
  }

  if (shapeType === "circle") {
    const model = getCircleEditModel(feature);
    if (!model) return [];
    const handles = [
      { handleType: "center", coordinate: [model.center.x, model.center.y] },
    ];
    if (feature.properties.circleMode !== "fixed") {
      handles.push({
        handleType: "radius",
        coordinate: [model.center.x + model.radius, model.center.y],
      });
    }
    return handles;
  }

  return [];
}

function getShapeHandleLabel(shapeType, handleType) {
  if (handleType === "center") return "Move annotation";
  if (handleType === "rotate") return "Rotate annotation. Hold Shift to snap.";
  if (shapeType === "ellipse") {
    if (handleType === "major-radius") return "Adjust ellipse long axis";
    if (handleType === "minor-radius") return "Adjust ellipse short axis";
  }
  if (shapeType === "circle") {
    if (handleType === "radius") return "Adjust circle radius";
  }
  return `Drag ${handleType} handle`;
}

function removeAnnotationShapeHandles() {
  [...document.getElementsByClassName("annotation-shape-handle")].forEach(
    (handle) => {
      viewer.removeOverlay(handle);
      handle.remove();
    }
  );
}

function renderAnnotationShapeHandles() {
  removeAnnotationShapeHandles();
  const feature = getAnnotationByUuid(activeShapeEditUuid);
  if (!isShapeEditableAnnotation(feature)) return;

  const image = viewer.world.getItemAt(0);
  if (!image) return;

  getShapeEditHandles(feature).forEach(({ handleType, coordinate }) => {
    const handle = document.createElement("button");
    const handleLabel = getShapeHandleLabel(feature.properties.shapeType, handleType);
    handle.type = "button";
    handle.className = `annotation-vertex-handle annotation-shape-handle annotation-shape-handle-${handleType}`;
    handle.title = handleLabel;
    handle.setAttribute("aria-label", handleLabel);
    handle.dataset.annotationUuid = activeShapeEditUuid;
    handle.dataset.handleType = handleType;
    handle.addEventListener("pointerdown", function (event) {
      handleAnnotationShapePointerDown(event, activeShapeEditUuid, handleType);
    });

    viewer.addOverlay({
      element: handle,
      location: image.imageToViewportCoordinates(
        new OpenSeadragon.Point(coordinate[0], coordinate[1])
      ),
      checkResize: false,
      rotationMode: OpenSeadragon.OverlayRotationMode.NO_ROTATION,
    });
  });
  updateAnnotationOverlayRotation();
}

function enterAnnotationShapeEditMode(uuid) {
  const feature = getAnnotationByUuid(uuid);
  if (!isShapeEditableAnnotation(feature)) return false;
  if (isAnnotationFeatureLocked(feature)) return false;

  exitAnnotationVertexEditMode();
  setAnnotationMoveMode(false);
  setAnnotationLabelMoveMode(false);
  removeAnnotationShapeHandles();
  activeShapeEditUuid = uuid;
  viewerContainer?.classList.add("annotation-shape-editing");
  renderAnnotationShapeHandles();
  return true;
}

function exitAnnotationShapeEditMode() {
  if (!activeShapeEditUuid && !annotationShapeDragState) return;

  activeShapeEditUuid = null;
  annotationShapeDragState = null;
  removeAnnotationShapeHandles();
  viewerContainer?.classList.remove(
    "annotation-shape-editing",
    "annotation-shape-dragging"
  );
  window.removeEventListener("pointermove", handleAnnotationShapeWindowPointerMove);
  window.removeEventListener("pointerup", handleAnnotationShapeWindowPointerUp);
  window.removeEventListener("pointercancel", handleAnnotationShapeWindowPointerUp);
}

function updatePolygonFeatureCoordinates(feature, coordinates) {
  const ring = coordinates.map((coordinate) => [...coordinate]);
  if (ring.length > 0 && !coordinatesMatch(ring[0], ring[ring.length - 1])) {
    ring.push([...ring[0]]);
  }
  feature.geometry.coordinates[0] = ring;
  feature.properties.area_m2 = squareMetersFromSquarePixels(
    calculatePolygonArea([ring])
  );
  feature.properties.perimeter_m = metersFromPixels(
    calculatePolygonExteriorPerimeter([ring])
  );
}

function updateDefaultShapeLabelPosition(feature, oldLabelPoint, newLabelPoint) {
  const currentLabelPoint = [feature.properties.xLabel, feature.properties.yLabel];
  if (coordinatesMatch(currentLabelPoint, oldLabelPoint)) {
    feature.properties.xLabel = newLabelPoint[0];
    feature.properties.yLabel = newLabelPoint[1];
    updateAnnotationLabelOverlayPosition(feature.properties.uuid);
  }
}

function getDefaultShapeLabelPoint(feature) {
  const shapeType = feature.properties?.shapeType;
  if (feature.geometry?.type === "Point") return feature.geometry.coordinates;
  if (feature.geometry?.type === "LineString") return feature.geometry.coordinates?.[0];

  const ring = getVisiblePolygonRing(feature);
  if (shapeType === "rectangle") return ring[0];
  if (shapeType === "ellipse") return getTopmostPoint(ring);
  if (shapeType === "circle") return getTopCenterPoint(ring);
  return ring[0];
}

function updateAnnotationPointOverlayPosition(uuid) {
  const feature = getAnnotationByUuid(uuid);
  const crosshair = document.getElementById(`annotate-crosshair-${uuid}`);
  const image = viewer.world.getItemAt(0);
  if (!feature?.geometry || feature.geometry.type !== "Point" || !crosshair || !image) {
    return;
  }

  viewer.updateOverlay(
    crosshair,
    image.imageToViewportCoordinates(
      new OpenSeadragon.Point(
        feature.geometry.coordinates[0],
        feature.geometry.coordinates[1]
      )
    )
  );
}

function moveAnnotationFeatureCenterToImagePoint(feature, imagePoint) {
  const currentCenter = getFeatureEditMoveCoordinate(feature);
  if (!currentCenter || !imagePoint) return false;

  const pointerOffset = annotationShapeDragState?.pointerOffset || { x: 0, y: 0 };
  const targetCenter = {
    x: imagePoint.x - pointerOffset.x,
    y: imagePoint.y - pointerOffset.y,
  };
  translateAnnotationFeature(
    feature,
    targetCenter.x - currentCenter.x,
    targetCenter.y - currentCenter.y
  );
  updateAnnotationLabelOverlayPosition(feature.properties.uuid);
  updateAnnotationPointOverlayPosition(feature.properties.uuid);
  return true;
}

function updateRectangleShapeFromDrag(feature, handleType, imagePoint) {
  if (handleType === "center") {
    return moveAnnotationFeatureCenterToImagePoint(feature, imagePoint);
  }

  const model = getRectangleEditModel(feature);
  if (!model) return false;

  const oldLabelPoint = getDefaultShapeLabelPoint(feature);
  const relativePoint = {
    x: imagePoint.x - model.center.x,
    y: imagePoint.y - model.center.y,
  };
  const projectedU = dotVector(relativePoint, model.u);
  const projectedV = dotVector(relativePoint, model.v);
  const minSize = 1;

  if (handleType.includes("left")) model.minU = Math.min(projectedU, model.maxU - minSize);
  if (handleType.includes("right")) model.maxU = Math.max(projectedU, model.minU + minSize);
  if (handleType.includes("top")) model.minV = Math.min(projectedV, model.maxV - minSize);
  if (handleType.includes("bottom")) model.maxV = Math.max(projectedV, model.minV + minSize);

  const coordinates = getRectangleCoordinatesFromModel(model);
  updatePolygonFeatureCoordinates(feature, coordinates);
  updateDefaultShapeLabelPosition(
    feature,
    oldLabelPoint,
    getDefaultShapeLabelPoint(feature)
  );
  return true;
}

function updateEllipseShapeFromDrag(feature, handleType, imagePoint) {
  if (handleType === "center") {
    return moveAnnotationFeatureCenterToImagePoint(feature, imagePoint);
  }

  const model =
    annotationShapeDragState?.uuid === feature.properties.uuid &&
    annotationShapeDragState.shapeModel
      ? cloneEllipseEditModel(annotationShapeDragState.shapeModel)
      : getEllipseEditModel(feature);
  if (!model) return false;

  const oldLabelPoint = getDefaultShapeLabelPoint(feature);
  const minRadius = 1;

  if (handleType === "major-radius") {
    const relativePoint = {
      x: imagePoint.x - model.center.x,
      y: imagePoint.y - model.center.y,
    };
    model.majorRadius = Math.max(minRadius, Math.abs(dotVector(relativePoint, model.u)));
  } else if (handleType === "minor-radius") {
    const relativePoint = {
      x: imagePoint.x - model.center.x,
      y: imagePoint.y - model.center.y,
    };
    model.minorRadius = Math.max(minRadius, Math.abs(dotVector(relativePoint, model.v)));
  }

  const coordinates = getEllipsePoints([
    [model.center.x, model.center.y],
    addScaledVector(model.center, model.u, model.majorRadius),
    addScaledVector(model.center, model.v, model.minorRadius),
  ]);
  updatePolygonFeatureCoordinates(feature, coordinates);
  updateDefaultShapeLabelPosition(
    feature,
    oldLabelPoint,
    getDefaultShapeLabelPoint(feature)
  );
  return true;
}

function updateCircleShapeFromDrag(feature, handleType, imagePoint) {
  if (handleType === "center") {
    return moveAnnotationFeatureCenterToImagePoint(feature, imagePoint);
  }

  const model = getCircleEditModel(feature);
  if (!model) return false;

  const oldLabelPoint = getDefaultShapeLabelPoint(feature);
  if (handleType === "radius") {
    model.radius = Math.max(
      1,
      getVectorLength({
        x: imagePoint.x - model.center.x,
        y: imagePoint.y - model.center.y,
      })
    );
  }

  const coordinates = getCircleCoordinatesInImageSpace(
    model.center.x,
    model.center.y,
    model.radius * 2
  );
  updatePolygonFeatureCoordinates(feature, coordinates);
  feature.properties.circleCenterX = model.center.x;
  feature.properties.circleCenterY = model.center.y;
  feature.properties.circleRadiusPixels = model.radius;
  feature.properties.circleDiameterPixels = model.radius * 2;
  updateDefaultShapeLabelPosition(
    feature,
    oldLabelPoint,
    getDefaultShapeLabelPoint(feature)
  );
  return true;
}

function getAnnotationRotationStartState(feature, center, startImagePoint) {
  if (!isRotationEditableAnnotation(feature) || !center || !startImagePoint) {
    return null;
  }

  const startAngle = Math.atan2(
    startImagePoint.y - center.y,
    startImagePoint.x - center.x
  );

  return {
    center: { ...center },
    startAngle,
    coordinates: cloneData(feature.geometry.coordinates),
    rectangleModel:
      feature.properties?.shapeType === "rectangle"
        ? cloneRectangleEditModel(getRectangleEditModel(feature))
        : null,
    ellipseModel:
      feature.properties?.shapeType === "ellipse"
        ? cloneEllipseEditModel(getEllipseEditModel(feature))
        : null,
  };
}

function rotateLineStringFeature(feature, startCoordinates, center, angleRadians) {
  feature.geometry.coordinates = startCoordinates.map((coordinate) =>
    rotatePointAroundCenter(coordinate, center, angleRadians)
  );
}

function rotatePolygonFeature(feature, startCoordinates, center, angleRadians) {
  const ring = startCoordinates?.[0];
  if (!Array.isArray(ring)) return false;

  const coordinates = getCoordinatesWithoutTrailingDuplicate(ring).map((coordinate) =>
    rotatePointAroundCenter(coordinate, center, angleRadians)
  );
  updatePolygonFeatureCoordinates(feature, coordinates);
  return true;
}

function rotateAnnotationFeatureFromDrag(feature, imagePoint, options = {}) {
  const rotationState = annotationShapeDragState?.rotationState;
  if (!rotationState || !imagePoint) return false;

  const currentAngle = Math.atan2(
    imagePoint.y - rotationState.center.y,
    imagePoint.x - rotationState.center.x
  );
  let angleDelta = currentAngle - rotationState.startAngle;
  if (options.snap) {
    angleDelta = snapAngleRadians(angleDelta);
  }

  const oldLabelPoint = getDefaultShapeLabelPoint(feature);

  if (feature.geometry.type === "LineString") {
    rotateLineStringFeature(
      feature,
      rotationState.coordinates,
      rotationState.center,
      angleDelta
    );
  } else if (feature.properties?.shapeType === "rectangle") {
    const model = cloneRectangleEditModel(rotationState.rectangleModel);
    if (!model) return false;
    model.u = rotateVector(model.u, angleDelta);
    model.v = rotateVector(model.v, angleDelta);
    updatePolygonFeatureCoordinates(feature, getRectangleCoordinatesFromModel(model));
  } else if (feature.properties?.shapeType === "ellipse") {
    const model = cloneEllipseEditModel(rotationState.ellipseModel);
    if (!model) return false;
    model.u = rotateVector(model.u, angleDelta);
    model.v = rotateVector(model.v, angleDelta);
    const coordinates = getEllipsePoints([
      [model.center.x, model.center.y],
      addScaledVector(model.center, model.u, model.majorRadius),
      addScaledVector(model.center, model.v, model.minorRadius),
    ]);
    updatePolygonFeatureCoordinates(feature, coordinates);
  } else if (feature.geometry.type === "Polygon") {
    if (
      !rotatePolygonFeature(
        feature,
        rotationState.coordinates,
        rotationState.center,
        angleDelta
      )
    ) {
      return false;
    }
  } else {
    return false;
  }

  updateDefaultShapeLabelPosition(
    feature,
    oldLabelPoint,
    getDefaultShapeLabelPoint(feature)
  );
  return true;
}

function updateShapeFromDrag(feature, handleType, imagePoint, options = {}) {
  if (feature.geometry.type === "Point" && handleType === "center") {
    return moveAnnotationFeatureCenterToImagePoint(feature, imagePoint);
  }
  if (handleType === "center" && isVertexEditableAnnotation(feature)) {
    return moveAnnotationFeatureCenterToImagePoint(feature, imagePoint);
  }
  if (handleType === "rotate") {
    return rotateAnnotationFeatureFromDrag(feature, imagePoint, options);
  }
  if (feature.properties.shapeType === "rectangle") {
    return updateRectangleShapeFromDrag(feature, handleType, imagePoint);
  }
  if (feature.properties.shapeType === "ellipse") {
    return updateEllipseShapeFromDrag(feature, handleType, imagePoint);
  }
  if (feature.properties.shapeType === "circle") {
    return updateCircleShapeFromDrag(feature, handleType, imagePoint);
  }
  return false;
}

function startAnnotationShapeDrag(event, uuid, handleType) {
  const feature = getAnnotationByUuid(uuid);
  if (isAnnotationFeatureLocked(feature)) return false;
  if (
    !isShapeEditableAnnotation(feature) &&
    !(handleType === "center" && isVertexEditableAnnotation(feature)) &&
    !(handleType === "rotate" && isRotationEditableAnnotation(feature))
  ) {
    return false;
  }

  const imagePoint = getImagePointFromPointerEvent(event);
  if (!imagePoint) return false;
  const moveCenter = handleType === "center"
    ? getFeatureEditMoveCoordinate(feature)
    : null;
  const rotationCenter = handleType === "rotate"
    ? getFeatureEditMoveCoordinate(feature)
    : null;
  const ellipseModel =
    feature.properties.shapeType === "ellipse"
      ? getEllipseEditModel(feature)
      : null;
  const rotationState =
    handleType === "rotate"
      ? getAnnotationRotationStartState(feature, rotationCenter, imagePoint)
      : null;
  if (handleType === "rotate" && !rotationState) return false;

  annotationShapeDragState = {
    uuid,
    handleType,
    shapeModel: cloneEllipseEditModel(ellipseModel),
    rotationState,
    pointerOffset:
      handleType === "center" && moveCenter
        ? {
            x: imagePoint.x - moveCenter.x,
            y: imagePoint.y - moveCenter.y,
          }
        : { x: 0, y: 0 },
    undoState: cloneAnnotationState(),
    moved: false,
  };
  viewerContainer?.classList.add("annotation-shape-dragging");
  window.addEventListener("pointermove", handleAnnotationShapeWindowPointerMove);
  window.addEventListener("pointerup", handleAnnotationShapeWindowPointerUp);
  window.addEventListener("pointercancel", handleAnnotationShapeWindowPointerUp);
  return true;
}

function moveAnnotationShapeHandleToImagePoint(imagePoint, options = {}) {
  if (!annotationShapeDragState || !imagePoint) return false;

  const { uuid, handleType } = annotationShapeDragState;
  const feature = getAnnotationByUuid(uuid);
  if (
    !isShapeEditableAnnotation(feature) &&
    !(handleType === "center" && isVertexEditableAnnotation(feature)) &&
    !(handleType === "rotate" && isRotationEditableAnnotation(feature))
  ) {
    return false;
  }

  if (!annotationShapeDragState.moved) {
    annotationHistory.push(
      handleType === "rotate" ? "Rotate annotation" : "Edit annotation shape",
      annotationShapeDragState.undoState
    );
  }
  if (!updateShapeFromDrag(feature, handleType, imagePoint, options)) return false;
  annotationShapeDragState.moved = true;
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  if (activeVertexEditUuid === uuid && !activeShapeEditUuid) {
    renderAnnotationVertexHandles();
  } else {
    renderAnnotationShapeHandles();
  }
  return true;
}

function finishAnnotationShapeDrag() {
  if (!annotationShapeDragState) return false;

  const moved = annotationShapeDragState.moved;
  annotationShapeDragState = null;
  viewerContainer?.classList.remove("annotation-shape-dragging");
  window.removeEventListener("pointermove", handleAnnotationShapeWindowPointerMove);
  window.removeEventListener("pointerup", handleAnnotationShapeWindowPointerUp);
  window.removeEventListener("pointercancel", handleAnnotationShapeWindowPointerUp);
  if (moved) {
    unsavedAnnotations(true);
    renderAnnotationList();
    syncSelectedAnnotationVisuals();
    suppressAnnotationClickBriefly();
  }
  return true;
}

function handleAnnotationShapePointerDown(event, uuid, handleType) {
  if (!startAnnotationShapeDrag(event, uuid, handleType)) return;

  event.preventDefault();
  event.stopPropagation();
}

function handleAnnotationShapeWindowPointerMove(event) {
  if (!annotationShapeDragState) return;

  event.preventDefault();
  event.stopPropagation();
  moveAnnotationShapeHandleToImagePoint(getImagePointFromPointerEvent(event), {
    snap: event.shiftKey,
  });
}

function handleAnnotationShapeWindowPointerUp(event) {
  if (!annotationShapeDragState) return;

  event.preventDefault();
  event.stopPropagation();
  finishAnnotationShapeDrag();
}

function deleteAnnotationVertex(uuid, vertexIndex) {
  const feature = getAnnotationByUuid(uuid);
  if (!isVertexEditableAnnotation(feature)) return false;
  if (isAnnotationFeatureLocked(feature)) return false;

  const coordinates = getEditableVertexCoordinates(feature).map((coordinate) => [
    ...coordinate,
  ]);
  if (coordinates.length <= getMinimumEditableVertexCount(feature)) return false;
  if (!coordinates[vertexIndex]) return false;

  const undoState = cloneAnnotationState();
  coordinates.splice(vertexIndex, 1);
  setEditableVertexCoordinates(feature, coordinates);
  finishAnnotationVertexGeometryEdit(uuid, "Delete annotation vertex", undoState);
  return true;
}

function getNearestEditableSegmentAtViewerPoint(feature, viewerPoint, tolerance = 10) {
  if (!isVertexEditableAnnotation(feature)) return null;

  const image = viewer.world.getItemAt(0);
  if (!image) return null;

  const coordinates = getEditableVertexCoordinates(feature);
  const segmentCount =
    feature.geometry.type === "Polygon"
      ? coordinates.length
      : Math.max(0, coordinates.length - 1);
  let nearestSegment = null;

  for (let i = 0; i < segmentCount; i++) {
    const startCoordinate = coordinates[i];
    const endCoordinate =
      feature.geometry.type === "Polygon"
        ? coordinates[(i + 1) % coordinates.length]
        : coordinates[i + 1];
    if (!startCoordinate || !endCoordinate) continue;

    const distance = distanceToSegment(
      viewerPoint,
      imageCoordToViewerPixel(image, startCoordinate),
      imageCoordToViewerPixel(image, endCoordinate)
    );

    if (distance <= tolerance && (!nearestSegment || distance < nearestSegment.distance)) {
      nearestSegment = {
        distance,
        insertIndex: i + 1,
      };
    }
  }

  return nearestSegment;
}

function insertAnnotationVertexAtViewerPoint(uuid, viewerPoint) {
  const feature = getAnnotationByUuid(uuid);
  if (!isVertexEditableAnnotation(feature)) return false;
  if (isAnnotationFeatureLocked(feature)) return false;

  const nearestSegment = getNearestEditableSegmentAtViewerPoint(
    feature,
    viewerPoint,
    12
  );
  if (!nearestSegment) return false;

  const imagePoint = getImagePointFromViewerPixel(viewerPoint);
  if (!imagePoint) return false;

  const coordinates = getEditableVertexCoordinates(feature).map((coordinate) => [
    ...coordinate,
  ]);
  const undoState = cloneAnnotationState();
  coordinates.splice(nearestSegment.insertIndex, 0, [imagePoint.x, imagePoint.y]);
  setEditableVertexCoordinates(feature, coordinates);
  finishAnnotationVertexGeometryEdit(uuid, "Add annotation vertex", undoState);
  return true;
}

function updateAnnotationVertexHandlePosition(uuid, vertexIndex) {
  const feature = getAnnotationByUuid(uuid);
  const coordinate = getEditableVertexCoordinates(feature)[vertexIndex];
  const handle = document.querySelector(
    `.annotation-vertex-handle[data-annotation-uuid="${CSS.escape(
      uuid
    )}"][data-vertex-index="${vertexIndex}"]`
  );
  const image = viewer.world.getItemAt(0);
  if (!coordinate || !handle || !image) return;

  viewer.updateOverlay(
    handle,
    image.imageToViewportCoordinates(
      new OpenSeadragon.Point(coordinate[0], coordinate[1])
    )
  );
}

function updateAnnotationEditMoveHandlePosition(uuid) {
  const feature = getAnnotationByUuid(uuid);
  const coordinate = getFeatureEditMoveCoordinate(feature);
  const handle = document.querySelector(
    `.annotation-shape-handle-center[data-annotation-uuid="${CSS.escape(uuid)}"]`
  );
  const image = viewer.world.getItemAt(0);
  if (!coordinate || !handle || !image) return;

  viewer.updateOverlay(
    handle,
    image.imageToViewportCoordinates(
      new OpenSeadragon.Point(coordinate.x, coordinate.y)
    )
  );
}

function startAnnotationVertexDrag(event, uuid, vertexIndex) {
  const feature = getAnnotationByUuid(uuid);
  if (!isVertexEditableAnnotation(feature)) return false;
  if (isAnnotationFeatureLocked(feature)) return false;

  const imagePoint = getImagePointFromPointerEvent(event);
  if (!imagePoint) return false;
  const coordinate = getEditableVertexCoordinates(feature)[vertexIndex];
  if (!coordinate) return false;

  annotationVertexDragState = {
    uuid,
    vertexIndex,
    offsetX: imagePoint.x - coordinate[0],
    offsetY: imagePoint.y - coordinate[1],
    undoState: cloneAnnotationState(),
    moved: false,
  };
  viewerContainer?.classList.add("annotation-vertex-dragging");
  window.addEventListener("pointermove", handleAnnotationVertexWindowPointerMove);
  window.addEventListener("pointerup", handleAnnotationVertexWindowPointerUp);
  window.addEventListener("pointercancel", handleAnnotationVertexWindowPointerUp);
  return true;
}

function moveAnnotationVertexToImagePoint(imagePoint) {
  if (!annotationVertexDragState || !imagePoint) return false;

  const { uuid, vertexIndex } = annotationVertexDragState;
  const feature = getAnnotationByUuid(uuid);
  if (!isVertexEditableAnnotation(feature)) return false;

  const adjustedImagePoint = {
    x: imagePoint.x - annotationVertexDragState.offsetX,
    y: imagePoint.y - annotationVertexDragState.offsetY,
  };
  if (!annotationVertexDragState.moved) {
    annotationHistory.push(
      "Move annotation vertex",
      annotationVertexDragState.undoState
    );
  }
  setAnnotationVertexCoordinate(feature, vertexIndex, adjustedImagePoint);
  annotationVertexDragState.moved = true;
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  updateAnnotationVertexHandlePosition(uuid, vertexIndex);
  updateAnnotationEditMoveHandlePosition(uuid);
  return true;
}

function finishAnnotationVertexDrag() {
  if (!annotationVertexDragState) return false;

  const moved = annotationVertexDragState.moved;
  annotationVertexDragState = null;
  viewerContainer?.classList.remove("annotation-vertex-dragging");
  window.removeEventListener("pointermove", handleAnnotationVertexWindowPointerMove);
  window.removeEventListener("pointerup", handleAnnotationVertexWindowPointerUp);
  window.removeEventListener("pointercancel", handleAnnotationVertexWindowPointerUp);
  if (moved) {
    unsavedAnnotations(true);
    renderAnnotationList();
    suppressAnnotationClickBriefly();
  }
  return true;
}

function handleAnnotationVertexPointerDown(event, uuid, vertexIndex) {
  if (event.altKey) {
    event.preventDefault();
    event.stopPropagation();
    deleteAnnotationVertex(uuid, vertexIndex);
    return;
  }

  if (!startAnnotationVertexDrag(event, uuid, vertexIndex)) return;

  event.preventDefault();
  event.stopPropagation();
}

function handleAnnotationVertexWindowPointerMove(event) {
  if (!annotationVertexDragState) return;

  event.preventDefault();
  event.stopPropagation();
  moveAnnotationVertexToImagePoint(getImagePointFromPointerEvent(event));
}

function handleAnnotationVertexWindowPointerUp(event) {
  if (!annotationVertexDragState) return;

  event.preventDefault();
  event.stopPropagation();
  finishAnnotationVertexDrag();
}

function handleAnnotationLabelPointerDown(event, uuid) {
  if (!startAnnotationLabelMoveDrag(event, uuid)) return;

  event.preventDefault();
  event.stopPropagation();
}

function handleAnnotationLabelWindowPointerMove(event) {
  if (!annotationLabelMoveDragState) return;

  event.preventDefault();
  event.stopPropagation();
  moveAnnotationLabelToImagePoint(getImagePointFromPointerEvent(event));
}

function handleAnnotationLabelWindowPointerUp(event) {
  if (!annotationLabelMoveDragState) return;

  event.preventDefault();
  event.stopPropagation();
  finishAnnotationLabelMoveDrag();
}

function resolveNewAnnotationLabel(callback) {
  if (isRepeatMode) {
    callback(getSelectedAnnotation()?.properties?.label || "");
    return;
  }

  if (isPromptLabelMode) {
    showPrompt("Enter the annotation label:", (value) => {
      callback(value || "");
    });
    return;
  }

  callback("");
}

// Function to add a point to the annoJSON
function addPointToGeoJSON(x, y, metadata) {
  annotationHistory.push("Add annotation");
  const properties = normalizeAnnotationProperties(
    applyActiveAnnotationGroup(metadata)
  );

  // Create a GeoJSON point feature
  // x, y = coordinates in image (pixel) coordinates
  // metadata = dictionary with feature labels and values, e.g., { uuid: 'abc', label: 'Hello World'}
  const pointFeature = {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [x, y], // [x, y] format for coordinates
    },
    properties: properties, // metadata like label, description, etc.
  };

  // Add the point feature to the annoJSON under the provided id
  annoJSON.features.push(pointFeature);
  renderAnnotationList();
  selectAnnotationByUuid(properties.uuid, { redraw: false });
}

// Function to add a point to the annoJSON
function addPolylineToGeoJSON(JSON, coordinates, metadata) {
  if (JSON === annoJSON) {
    annotationHistory.push("Add annotation");
  }
  const properties =
    JSON === annoJSON
      ? normalizeAnnotationProperties(applyActiveAnnotationGroup(metadata))
      : metadata;

  // Create a GeoJSON point feature
  // coordinates = array of x,y values in image (pixel) coordinates
  // metadata = dictionary with feature labels and values, e.g., { uuid: 'abc', label: 'Hello World'}
  const polylineFeature = {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: coordinates, // [[x0, y0],[x1,y1]] format for coordinates
    },
    properties: properties, // metadata like label, description, etc.
  };
  // Add the point feature to the annoJSON under the provided id
  JSON.features.push(polylineFeature);
  if (JSON === annoJSON) {
    renderAnnotationList();
    selectAnnotationByUuid(properties.uuid, { redraw: false });
  }
}

// Function to add a point to the annoJSON
function addPolygonToGeoJSON(JSON, coordinates, metadata) {
  if (JSON === annoJSON) {
    annotationHistory.push("Add annotation");
  }
  const properties =
    JSON === annoJSON
      ? normalizeAnnotationProperties(applyActiveAnnotationGroup(metadata))
      : metadata;

  // Create a GeoJSON polygon feature
  // coordinates = array of x,y values in image (pixel) coordinates
  // metadata = dictionary with feature labels and values, e.g., { uuid: 'abc', label: 'Hello World'}
  const polygonFeature = {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [coordinates], // [[[x0, y0],[x1,y1]]] format for coordinates
    },
    properties: properties, // metadata like label, description, etc.
  };
  // Add the point feature to the annoJSON under the provided id
  JSON.features.push(polygonFeature);
  if (JSON === annoJSON) {
    renderAnnotationList();
    selectAnnotationByUuid(properties.uuid, { redraw: false });
  }
}

// Function to delete an entry in the JSON
function deleteFromGeoJSON(id) {
  if (annoJSON.features[id - 1]) {
    annoJSON.features.splice(id - 1, 1);
  }
}

// Generate unique ID
function generateUniqueId(length = 8) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";

  // Add a timestamp for uniqueness
  result += Date.now().toString(36);

  // Add random characters to meet the desired length
  for (let i = result.length; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    result += chars.charAt(randomIndex);
  }

  return result;
}

let enableDivideImages = true;
const toggleDivideImages = (event) => {
  if (event.checked) {
    enableDivideImages = true;
  } else {
    enableDivideImages = false;
  }
  displayImages();
};

// Import, add, and export points with labels
const toggleAnnotation = (event) => {
  applyAnnotationVisibilityState();
};

// Import, add, and export points with labels
const toggleAnnotationLabels = (event) => {
  applyAnnotationVisibilityState();
};

function disableOtherAnnoModes(mode) {
  setAnnotationMoveMode(false);
  setAnnotationLabelMoveMode(false);
  exitAnnotationVertexEditMode();
  exitAnnotationShapeEditMode();
  if (mode !== "point") {
    isQPressed = false;
    pointButton.classList.remove("active");
    isPointMode = false;
    toggleCrosshairFloaterOn(false);
  }
  if (mode !== "rect") {
    rectButton.classList.remove("active");
    isRectangleMode = false;
    toggleRectFloaterOn(false);
  }
  if (mode !== "polyline") {
    isZPressed = false;
    polylineButton.classList.remove("active");
    isPolylineMode = false;
    togglePolylineFloaterOn(false);
  }
  if (mode !== "polygon") {
    isXPressed = false;
    polygonButton.classList.remove("active");
    isPolygonMode = false;
    togglePolygonFloaterOn(false);
  }
  if (mode !== "ellipse") {
    isCPressed = false;
    ellipseButton.classList.remove("active");
    isEllipseMode = false;
    toggleEllipseFloaterOn(false);
  }
  if (mode !== "circle") {
    circleAnnotationButton.classList.remove("active");
    isCircleAnnotationMode = false;
    toggleCircleAnnotationFloaterOn(false);
  }
}

// Functions for detecting when q, z, anc x are pressed and released
let isQPressed = false;
let isZPressed = false;
let isXPressed = false;
let isCPressed = false;
let isVPressed = false;
document.addEventListener("keydown", function (event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (isTextEntryElement(event.target)) return;

  if (event.key === "q" || event.key === "Q") {
    isQPressed = true;
    toggleCrosshairFloaterOn(true);
    disableOtherAnnoModes("point");
  }
  if (event.key === "z" || event.key === "Z") {
    isZPressed = true;
    togglePolylineFloaterOn(true);
    disableOtherAnnoModes("polyline");
  }
  if (event.key === "x" || event.key === "X") {
    isXPressed = true;
    togglePolygonFloaterOn(true);
    disableOtherAnnoModes("polygon");
  }
  if (event.key === "c" || event.key === "C") {
    isCPressed = true;
    toggleEllipseFloaterOn(true);
    disableOtherAnnoModes("ellipse");
  }
  if (event.key === "v" || event.key === "V") {
    isVPressed = true;
    disableOtherAnnoModes("circle");
    refreshAnnotationFloaters();
  }
});
document.addEventListener("keyup", function (event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (isTextEntryElement(event.target)) return;

  if (event.key === "q" || event.key === "Q") {
    isQPressed = false;
    if (!pointButton.classList.contains("active")) {
      // Only toggle off if the button is not also pressed
      toggleCrosshairFloaterOn(false);
    }
  }
  if (event.key === "z" || event.key === "Z") {
    isZPressed = false;
    if (!polylineButton.classList.contains("active")) {
      // Only toggle off if the button is not also pressed
      togglePolylineFloaterOn(false);
    }
  }
  if (event.key === "x" || event.key === "X") {
    isXPressed = false;
    if (!polygonButton.classList.contains("active")) {
      togglePolygonFloaterOn(false);
    }
  }
  if (event.key === "c" || event.key === "C") {
    isCPressed = false;
    if (!ellipseButton.classList.contains("active")) {
      toggleEllipseFloaterOn(false);
    }
  }
  if (event.key === "v" || event.key === "V") {
    isVPressed = false;
    refreshAnnotationFloaters();
  }
});

// Handler for adding point annotations
viewer.addHandler("canvas-click", function (event) {
  if (isQPressed || isPointMode) {
    event.preventDefaultAction = true;
    const image = viewer.world.getItemAt(0);
    const imageSize = image.getContentSize();
    let viewportPoint = viewer.viewport.pointFromPixel(event.position); // Get viewport coordinates
    let imagePoint = image.viewportToImageCoordinates(
      viewportPoint.x,
      viewportPoint.y
    ); // Get image coordinates
    const uniqueID = generateUniqueId(8);
    const labelFontSize = Number(
      document.getElementById("annoLabelFontSize").value
    );
    const labelFontColor = getAnnotationLabelFontColor();
    const labelBackgroundColor = getAnnotationLabelBackgroundColor();
    const labelBackgroundOpacity = getAnnotationOpacityValue("annoLabelBackgroundOpacity");
    const lineWeight = Number(document.getElementById("lineWeight").value);
    const lineColor = getAnnotationLineColor();
    const lineOpacity = getAnnotationOpacityValue("lineOpacity");

    resolveNewAnnotationLabel((constPointLabel) => {
      addPointToGeoJSON(imagePoint.x, imagePoint.y, {
        uuid: uniqueID,
        label: constPointLabel,
        xLabel: imagePoint.x,
        yLabel: imagePoint.y,
        imageTitle: title(),
        pixelsPerMeter: pixelsPerMeter(),
        imageWidth: imageSize.x,
        imageHeight: imageSize.y,
        labelFontSize: labelFontSize,
        labelFontColor: labelFontColor,
        labelBackgroundColor: labelBackgroundColor,
        labelBackgroundOpacity: labelBackgroundOpacity,
        lineWeight: lineWeight,
        lineColor: lineColor,
        lineOpacity: lineOpacity,
      });
      addText(
        uniqueID,
        constPointLabel,
        viewportPoint,
        "anno",
        labelFontColor,
        labelFontSize,
        labelBackgroundColor,
        labelBackgroundOpacity
      );

      addCrosshairs(
        uniqueID,
        viewportPoint,
        "anno",
        lineColor,
        lineWeight,
        lineOpacity
      );
    });
    // Store annotation
    isQPressed = false; // Reset
    if (!pointButton.classList.contains("active")) {
      toggleCrosshairFloaterOn(false);
    }
    enableAnnoButtons();
    // window.appState.hasUnsavedAnnotations = true;
    unsavedAnnotations(true);
  }
});

viewer.addHandler("canvas-click", function (event) {
  if (suppressNextAnnotationClick) {
    suppressNextAnnotationClick = false;
    event.preventDefaultAction = true;
    return;
  }
  if (event.preventDefaultAction) return;
  if (isAnnotationDrawingActive()) return;
  if (event.originalEvent?.altKey) return;
  if (event.quick === false) return;

  const uuid = findAnnotationUuidAtViewerPoint(event.position);
  if (uuid) {
    if (event.originalEvent?.ctrlKey || event.originalEvent?.metaKey) {
      toggleAnnotationInSelection(uuid, { pan: false });
    } else {
      selectAnnotationByUuid(uuid);
    }
  } else {
    selectAnnotationByUuid(null);
  }
});

// Function where the first click is the first point of long axis,
// the second is the end of long axis, and the third is the short axis
// I find this less intuitive than the first click defining the center
// function getEllipsePoints(points, numPoints = 100) {
//   let [[x1, y1], [x2, y2], [x3, y3]] = points;

//   // Calculate center as midpoint of long axis
//   let centerX = (x1 + x2) / 2;
//   let centerY = (y1 + y2) / 2;

//   // Calculate major axis length
//   let majorAxis = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) / 2;

//   // Calculate rotation angle in radians
//   let angle = Math.atan2(y2 - y1, x2 - x1);

//   // Calculate minor axis using perpendicular distance from center to p3
//   let dx = x3 - centerX;
//   let dy = y3 - centerY;
//   let minorAxis = Math.abs(dx * Math.sin(angle) - dy * Math.cos(angle));

//   // Generate ellipse points
//   let ellipsePoints = [];
//   for (let i = 0; i < numPoints; i++) {
//     let theta = (i / numPoints) * 2 * Math.PI; // Angle around ellipse

//     // Unrotated ellipse point
//     let x = centerX + majorAxis * Math.cos(theta);
//     let y = centerY + minorAxis * Math.sin(theta);

//     // Apply rotation transformation
//     let rotatedX =
//       centerX +
//       (x - centerX) * Math.cos(angle) -
//       (y - centerY) * Math.sin(angle);
//     let rotatedY =
//       centerY +
//       (x - centerX) * Math.sin(angle) +
//       (y - centerY) * Math.cos(angle);

//     ellipsePoints.push([rotatedX, rotatedY]);
//   }

//   return ellipsePoints;
// }

function getLongAxisLine(points) {
  let [[cx, cy], [lx, ly]] = points;

  // Compute vector from center to lx, ly
  let dx = lx - cx;
  let dy = ly - cy;

  // Compute the second endpoint by mirroring the first endpoint across the center
  let x2 = cx - dx;
  let y2 = cy - dy;

  return [
    [lx, ly],
    [x2, y2],
  ]; // Return endpoints of the long axis
}

// Function where the first click is the center, the second is the long axis, and the third is the short axis
function getEllipsePoints(points, numPoints = 50) {
  let [[cx, cy], [lx, ly], [sx, sy]] = points;

  // Compute major axis length (distance from center to lx, ly)
  let majorAxis = Math.sqrt((lx - cx) ** 2 + (ly - cy) ** 2);

  // Compute minor axis length (distance from center to sx, sy)
  let minorAxis = Math.sqrt((sx - cx) ** 2 + (sy - cy) ** 2);

  // Compute rotation angle (angle of long axis)
  let angle = Math.atan2(ly - cy, lx - cx); // Angle in radians

  // Generate ellipse points
  let ellipsePoints = [];
  for (let i = 0; i <= numPoints; i++) {
    let theta = (i / numPoints) * 2 * Math.PI; // Angle around ellipse

    // Unrotated ellipse point
    let x = cx + majorAxis * Math.cos(theta);
    let y = cy + minorAxis * Math.sin(theta);

    // Apply rotation transformation
    let rotatedX = cx + (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle);
    let rotatedY = cy + (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle);

    ellipsePoints.push([rotatedX, rotatedY]);
  }

  return ellipsePoints;
}

function getTopCenterPoint(points) {
  const bounds = points.reduce(
    (acc, point) => ({
      minX: Math.min(acc.minX, point[0]),
      maxX: Math.max(acc.maxX, point[0]),
      minY: Math.min(acc.minY, point[1]),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity }
  );

  return [(bounds.minX + bounds.maxX) / 2, bounds.minY];
}

function getTopmostPoint(points) {
  return points.reduce((topmostPoint, point) =>
    point[1] < topmostPoint[1] ? point : topmostPoint
  );
}

// TODO: There is a fair bit of code redundancy between ellipse and polyline/
// polygon drawing. Could be refactored to reduce redundancy.
let ellipseCoordinates = []; // Array to store ellipse viewport coordinates
let ellipseImageCoordinates = []; // Array to store ellipse image coordinates
let activelyMakingEllipse = false;
let currentEllipseStyleColors = null;
// Event listener to add ellipse annotations
viewer.addHandler("canvas-click", function (event) {
  if (isEllipseMode || isCPressed) {
    activelyMakingEllipse = true;
    const image = viewer.world.getItemAt(0);
    const imageSize = image.getContentSize();
    const viewportPoint = viewer.viewport.pointFromPixel(event.position);
    const imagePoint = image.viewportToImageCoordinates(
      viewportPoint.x,
      viewportPoint.y
    );
    const x = viewportPoint.x;
    const y = viewportPoint.y;
    const uniqueID = generateUniqueId(8);
    const labelFontSize = Number(
      document.getElementById("annoLabelFontSize").value
    );
    currentEllipseStyleColors = getCurrentAnnotationStyleColors(
      currentEllipseStyleColors
    );
    const labelFontColor = currentEllipseStyleColors.labelFontColor;
    const labelBackgroundColor = currentEllipseStyleColors.labelBackgroundColor;
    const labelBackgroundOpacity = getAnnotationOpacityValue("annoLabelBackgroundOpacity");
    const lineWeight = Number(document.getElementById("lineWeight").value);
    const lineColor = currentEllipseStyleColors.lineColor;
    const lineStyle = document.getElementById("lineStyle").value;
    const lineOpacity = getAnnotationOpacityValue("lineOpacity");
    const fillColor = currentEllipseStyleColors.fillColor;
    const fillOpacity = getAnnotationOpacityValue("fillOpacity");
    ellipseCoordinates.push({ x, y });
    ellipseImageCoordinates.push([imagePoint.x, imagePoint.y]);
    activeAnnotationDraft = "ellipse";
    resetAnnotationDraftRedo();

    document.addEventListener("keydown", function (event) {
      // Check if the Escape key was pressed
      if (event.key === "Escape") {
        removeTemporaryPoints();
      }
    });

    // Continually update the annoJSONTemp with the latest coordinates
    viewerContainer.addEventListener("mousemove", function (subevent) {
      if (activelyMakingEllipse) {
        // Draw a line that represents the long axis of the ellipse
        if (ellipseCoordinates.length === 1) {
          // Clear to avoid duplicating lines
          annoJSONTemp = {
            type: "FeatureCollection",
            features: [],
          };
          const rect = viewerContainer.getBoundingClientRect(); // Get container bounds
          const position = {
            x: subevent.clientX - rect.left,
            y: subevent.clientY - rect.top,
          };
          const positionPoint = new OpenSeadragon.Point(position.x, position.y);
          const subeventViewportPoint =
            viewer.viewport.pointFromPixel(positionPoint);
          const subeventImagePoint = image.viewportToImageCoordinates(
            subeventViewportPoint.x,
            subeventViewportPoint.y
          );

          const points = [
            ellipseImageCoordinates[0],
            [subeventImagePoint.x, subeventImagePoint.y],
          ];
          const longAxisImagePoints = getLongAxisLine(points);
          addPolylineToGeoJSON(annoJSONTemp, [...longAxisImagePoints], {
            labelFontSize: labelFontSize,
            labelFontColor: labelFontColor,
            labelBackgroundColor: labelBackgroundColor,
            labelBackgroundOpacity: labelBackgroundOpacity,
            lineStyle: lineStyle,
            lineWeight: lineWeight,
            lineColor: lineColor,
            lineOpacity: lineOpacity,
            // canvasDraw: true,
          });
          drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
        }
        // Draw a preliminary ellipse
        if (ellipseCoordinates.length === 2) {
          // Clear to avoid duplicating lines
          annoJSONTemp = {
            type: "FeatureCollection",
            features: [],
          };
          const rect = viewerContainer.getBoundingClientRect(); // Get container bounds
          const position = {
            x: subevent.clientX - rect.left,
            y: subevent.clientY - rect.top,
          };
          const positionPoint = new OpenSeadragon.Point(position.x, position.y);
          const subeventViewportPoint =
            viewer.viewport.pointFromPixel(positionPoint);
          const subeventImagePoint = image.viewportToImageCoordinates(
            subeventViewportPoint.x,
            subeventViewportPoint.y
          );
          const ellipseTempCoordinates = [
            ellipseImageCoordinates[0],
            ellipseImageCoordinates[1],
            [subeventImagePoint.x, subeventImagePoint.y],
          ];
          const ellipseTempPoints = getEllipsePoints(ellipseTempCoordinates);
          addPolygonToGeoJSON(annoJSONTemp, [...ellipseTempPoints], {
            labelFontSize: labelFontSize,
            labelFontColor: labelFontColor,
            labelBackgroundColor: labelBackgroundColor,
            labelBackgroundOpacity: labelBackgroundOpacity,
            lineStyle: lineStyle,
            lineWeight: lineWeight,
            lineColor: lineColor,
            lineOpacity: lineOpacity,
            fillColor: fillColor,
            fillOpacity: fillOpacity,
          });
          drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
        }
      }
    });

    if (ellipseCoordinates.length === 3) {
      resolveNewAnnotationLabel((constEllipseLabel) => {
        finalizeEllipseAnnotation(
          constEllipseLabel,
          image,
          imageSize,
          uniqueID,
          labelFontSize,
          labelFontColor,
          labelBackgroundColor,
          labelBackgroundOpacity,
          lineStyle,
          lineWeight,
          lineColor,
          lineOpacity,
          fillColor,
          fillOpacity
        );
        drawPath(polyCanvas, [annoJSON]);
      });
    }
  }
});

function finalizeEllipseAnnotation(
  label,
  image,
  imageSize,
  uniqueID,
  labelFontSize,
  labelFontColor,
  labelBackgroundColor,
  labelBackgroundOpacity,
  lineStyle,
  lineWeight,
  lineColor,
  lineOpacity,
  fillColor,
  fillOpacity
) {
  const ellipsePoints = getEllipsePoints(ellipseImageCoordinates);
  const labelImagePoint = getTopmostPoint(ellipsePoints);
  const labelViewportPoint = image.imageToViewportCoordinates(
    labelImagePoint[0],
    labelImagePoint[1]
  );
  const areaPixels2 = calculatePolygonArea([ellipsePoints]);
  const areaM2 = squareMetersFromSquarePixels(areaPixels2);
  const perimeterPixels = calculatePolygonExteriorPerimeter([ellipsePoints]);
  const perimeterM = metersFromPixels(perimeterPixels);

  addPolygonToGeoJSON(annoJSON, [...ellipsePoints], {
    uuid: uniqueID,
    label: label,
    shapeType: "ellipse",
    xLabel: labelImagePoint[0],
    yLabel: labelImagePoint[1],
    imageTitle: title(),
    pixelsPerMeter: pixelsPerMeter(),
    imageWidth: imageSize.x,
    imageHeight: imageSize.y,
    labelFontSize: labelFontSize,
    labelFontColor: labelFontColor,
    labelBackgroundColor: labelBackgroundColor,
    labelBackgroundOpacity: labelBackgroundOpacity,
    lineStyle: lineStyle,
    lineWeight: lineWeight,
    lineColor: lineColor,
    lineOpacity: lineOpacity,
    fillColor: fillColor,
    fillOpacity: fillOpacity,
    area_m2: areaM2,
    perimeter_m: perimeterM,
  });

  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);

  addText(
    uniqueID,
    label,
    labelViewportPoint,
    "anno",
    labelFontColor,
    labelFontSize,
    labelBackgroundColor,
    labelBackgroundOpacity
  );

  ellipseCoordinates = [];
  ellipseImageCoordinates = [];
  currentEllipseStyleColors = null;
  clearAnnotationDraftState();
  annoJSONTemp = {
    type: "FeatureCollection",
    features: [],
  };
  // window.appState.hasUnsavedAnnotations = true;
  unsavedAnnotations(true);

  if (!ellipseButton.classList.contains("active")) {
    toggleEllipseFloaterOn(false);
  }

  activelyMakingEllipse = false;
  isCPressed = false;
  enableAnnoButtons();
}

function getCircleRadiusPixels(center, perimeterPoint) {
  return Math.hypot(perimeterPoint[0] - center[0], perimeterPoint[1] - center[1]);
}

function getCircleAnnotationUnitConversion() {
  const conversions = {
    0: 1,
    1: 1e3,
    2: 1e6,
  };
  return conversions[Number(circleAnnotationOptions.units)] || 1e6;
}

function getFixedCircleAnnotationDiameterPixels() {
  if (!hasKnownScale() || circleAnnotationOptions.mode !== "fixed") return null;
  const diameter = Number(circleAnnotationOptions.diameter);
  if (!Number.isFinite(diameter) || diameter <= 0) return null;
  return diameter * (pixelsPerMeter() / getCircleAnnotationUnitConversion());
}

function getAnnotationCircleStyle() {
  currentCircleAnnotationStyleColors = getCurrentAnnotationStyleColors(
    currentCircleAnnotationStyleColors
  );

  return {
    labelFontSize: Number(document.getElementById("annoLabelFontSize").value),
    labelFontColor: currentCircleAnnotationStyleColors.labelFontColor,
    labelBackgroundColor:
      currentCircleAnnotationStyleColors.labelBackgroundColor,
    labelBackgroundOpacity: getAnnotationOpacityValue(
      "annoLabelBackgroundOpacity"
    ),
    lineStyle: document.getElementById("lineStyle").value,
    lineWeight: Number(document.getElementById("lineWeight").value),
    lineColor: currentCircleAnnotationStyleColors.lineColor,
    lineOpacity: getAnnotationOpacityValue("lineOpacity"),
    fillColor: currentCircleAnnotationStyleColors.fillColor,
    fillOpacity: getAnnotationOpacityValue("fillOpacity"),
  };
}

function previewCircleAnnotation(perimeterImagePoint) {
  if (!circleAnnotationCenterImage) return;

  const radiusPixels = getCircleRadiusPixels(
    circleAnnotationCenterImage,
    perimeterImagePoint
  );
  const coordinates = getCircleCoordinatesInImageSpace(
    circleAnnotationCenterImage[0],
    circleAnnotationCenterImage[1],
    radiusPixels * 2
  );
  const style = getAnnotationCircleStyle();

  annoJSONTemp = {
    type: "FeatureCollection",
    features: [],
  };

  addPolygonToGeoJSON(annoJSONTemp, coordinates, {
    uuid: currentCircleAnnotationUniqueId,
    labelFontSize: style.labelFontSize,
    labelFontColor: style.labelFontColor,
    labelBackgroundColor: style.labelBackgroundColor,
    labelBackgroundOpacity: style.labelBackgroundOpacity,
    lineStyle: style.lineStyle,
    lineWeight: style.lineWeight,
    lineColor: style.lineColor,
    lineOpacity: style.lineOpacity,
    fillColor: style.fillColor,
    fillOpacity: style.fillOpacity,
  });
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
}

function finalizeCircleAnnotation(
  label,
  image,
  imageSize,
  perimeterImagePoint,
  options = {}
) {
  const style = getAnnotationCircleStyle();
  const fixedDiameterPixels = Number(options.fixedDiameterPixels);
  const radiusPixels =
    Number.isFinite(fixedDiameterPixels) && fixedDiameterPixels > 0
      ? fixedDiameterPixels / 2
      : getCircleRadiusPixels(circleAnnotationCenterImage, perimeterImagePoint);
  const coordinates = getCircleCoordinatesInImageSpace(
    circleAnnotationCenterImage[0],
    circleAnnotationCenterImage[1],
    radiusPixels * 2
  );
  const labelImagePoint = getTopCenterPoint(coordinates);
  const labelViewportPoint = image.imageToViewportCoordinates(
    labelImagePoint[0],
    labelImagePoint[1]
  );
  const areaPixels2 = calculatePolygonArea([coordinates]);
  const areaM2 = squareMetersFromSquarePixels(areaPixels2);
  const perimeterPixels = calculatePolygonExteriorPerimeter([coordinates]);
  const perimeterM = metersFromPixels(perimeterPixels);

  addPolygonToGeoJSON(annoJSON, coordinates, {
    uuid: currentCircleAnnotationUniqueId,
    label: label,
    shapeType: "circle",
    circleMode: options.circleMode || "free",
    circleCenterX: circleAnnotationCenterImage[0],
    circleCenterY: circleAnnotationCenterImage[1],
    circleRadiusPixels: radiusPixels,
    circleDiameterPixels: radiusPixels * 2,
    circleFixedDiameter:
      options.circleMode === "fixed"
        ? circleAnnotationOptions.diameter
        : undefined,
    circleFixedDiameterUnits:
      options.circleMode === "fixed"
        ? circleAnnotationOptions.units
        : undefined,
    xLabel: labelImagePoint[0],
    yLabel: labelImagePoint[1],
    imageTitle: title(),
    pixelsPerMeter: pixelsPerMeter(),
    imageWidth: imageSize.x,
    imageHeight: imageSize.y,
    labelFontSize: style.labelFontSize,
    labelFontColor: style.labelFontColor,
    labelBackgroundColor: style.labelBackgroundColor,
    labelBackgroundOpacity: style.labelBackgroundOpacity,
    lineStyle: style.lineStyle,
    lineWeight: style.lineWeight,
    lineColor: style.lineColor,
    lineOpacity: style.lineOpacity,
    fillColor: style.fillColor,
    fillOpacity: style.fillOpacity,
    area_m2: areaM2,
    perimeter_m: perimeterM,
  });

  addText(
    currentCircleAnnotationUniqueId,
    label,
    labelViewportPoint,
    "anno",
    style.labelFontColor,
    style.labelFontSize,
    style.labelBackgroundColor,
    style.labelBackgroundOpacity
  );

  circleAnnotationCenter = null;
  circleAnnotationCenterImage = null;
  currentCircleAnnotationUniqueId = null;
  currentCircleAnnotationStyleColors = null;
  activelyMakingCircleAnnotation = false;
  annoJSONTemp = {
    type: "FeatureCollection",
    features: [],
  };
  drawShape(polyCanvas, [annoJSON]);
  unsavedAnnotations(true);
  isVPressed = false;
  enableAnnoButtons();
}

viewer.addHandler("canvas-click", function (event) {
  if (!isCircleAnnotationMode && !isVPressed) {
    return;
  }

  event.preventDefaultAction = true;
  const image = viewer.world.getItemAt(0);
  if (!image) return;

  const imageSize = image.getContentSize();
  const viewportPoint = viewer.viewport.pointFromPixel(event.position);
  const imagePoint = image.viewportToImageCoordinates(
    viewportPoint.x,
    viewportPoint.y
  );
  const imageCoordinates = [imagePoint.x, imagePoint.y];
  const fixedDiameterPixels = getFixedCircleAnnotationDiameterPixels();

  if (fixedDiameterPixels) {
    circleAnnotationCenter = { x: viewportPoint.x, y: viewportPoint.y };
    circleAnnotationCenterImage = imageCoordinates;
    currentCircleAnnotationUniqueId = generateUniqueId(8);
    currentCircleAnnotationStyleColors = null;
    resolveNewAnnotationLabel((circleLabel) => {
      finalizeCircleAnnotation(circleLabel, image, imageSize, imageCoordinates, {
        circleMode: "fixed",
        fixedDiameterPixels,
      });
    });
    return;
  }

  if (!circleAnnotationCenterImage) {
    circleAnnotationCenter = { x: viewportPoint.x, y: viewportPoint.y };
    circleAnnotationCenterImage = imageCoordinates;
    currentCircleAnnotationUniqueId = generateUniqueId(8);
    currentCircleAnnotationStyleColors = null;
    getAnnotationCircleStyle();
    activelyMakingCircleAnnotation = true;
    return;
  }

  resolveNewAnnotationLabel((circleLabel) => {
    finalizeCircleAnnotation(circleLabel, image, imageSize, imageCoordinates);
  });
});

viewerContainer.addEventListener("mousemove", function (event) {
  if (!activelyMakingCircleAnnotation || !circleAnnotationCenterImage) return;

  const image = viewer.world.getItemAt(0);
  if (!image) return;

  const rect = viewerContainer.getBoundingClientRect();
  const positionPoint = new OpenSeadragon.Point(
    event.clientX - rect.left,
    event.clientY - rect.top
  );
  const viewportPoint = viewer.viewport.pointFromPixel(positionPoint);
  const imagePoint = image.viewportToImageCoordinates(
    viewportPoint.x,
    viewportPoint.y
  );
  previewCircleAnnotation([imagePoint.x, imagePoint.y]);
});

// Event listener to add polyline and polygon annotations
let clickCoordinates = []; // Array to store viewport coordinates
let clickImageCoordinates = []; // Array to store image coordinates
let clickCoordinatesArray = []; // Array to store arrays of coordinates
let clickTimeout; // Timeout reference to detect double-click
const clickDelay = 300; // Maximum delay between clicks for detecting double-click
let lastClickTime = 0; // Timestamp of the last click
let currentPolyStyleColors = null;
const polyCanvas = document.getElementById("annotation-overlay"); // Includes polyline and polygon
const circleCanvas = document.getElementById("circle-overlay"); // Includes circles
const measureCanvas = document.getElementById("measurement-overlay"); // Includes polyline and polygon
const scaleCanvas = document.getElementById("scale-overlay"); // Scale wizard calibration line
const annotationMarquee = document.getElementById("annotation-marquee");
const scaleWizard = document.getElementById("scaleWizard");
const scaleWizardStatus = document.getElementById("scaleWizardStatus");
const scaleWizardLength = document.getElementById("scaleWizardLength");
const scaleWizardUnits = document.getElementById("scaleWizardUnits");
const scaleWizardResult = document.getElementById("scaleWizardResult");
const applyScaleWizardButton = document.getElementById("applyScaleWizardButton");
const resetScaleWizardButton = document.getElementById("resetScaleWizardButton");
const cancelScaleWizardButton = document.getElementById("cancelScaleWizardButton");
const closeScaleWizardButton = document.getElementById("closeScaleWizardButton");
const libraryEditor = document.getElementById("libraryEditor");
const libraryEditorSummary = document.getElementById("libraryEditorSummary");
const libraryEditorRows = document.getElementById("libraryEditorRows");
const libraryEditorSearch = document.getElementById("libraryEditorSearch");
const libraryEditorForm = document.getElementById("libraryEditorForm");
const libraryEditorTitleInput = document.getElementById("libraryEditorTitleInput");
const libraryEditorDescriptionInput = document.getElementById(
  "libraryEditorDescriptionInput"
);
const libraryEditorGroupsInput = document.getElementById("libraryEditorGroupsInput");
const libraryEditorScaleInput = document.getElementById("libraryEditorScaleInput");
const libraryEditorAnnotationsInput = document.getElementById(
  "libraryEditorAnnotationsInput"
);
const libraryEditorTileSetCount = document.getElementById("libraryEditorTileSetCount");
const libraryEditorDeleteButton = document.getElementById("libraryEditorDeleteButton");
const libraryEditorStatus = document.getElementById("libraryEditorStatus");
const cancelLibraryEditorButton = document.getElementById("cancelLibraryEditorButton");
const saveAsLibraryEditorButton = document.getElementById("saveAsLibraryEditorButton");
const saveLibraryEditorButton = document.getElementById("saveLibraryEditorButton");
const applyCloseLibraryEditorButton = document.getElementById(
  "applyCloseLibraryEditorButton"
);
const closeLibraryEditorButton = document.getElementById("closeLibraryEditorButton");
const openTileSetEditorButton = document.getElementById("openTileSetEditorButton");
const tileSetEditor = document.getElementById("tileSetEditor");
const tileSetEditorTitle = document.getElementById("tileSetEditorTitle");
const tileSetEditorSummary = document.getElementById("tileSetEditorSummary");
const tileSetEditorRows = document.getElementById("tileSetEditorRows");
const tileSetEditorStatus = document.getElementById("tileSetEditorStatus");
const cancelTileSetEditorButton = document.getElementById("cancelTileSetEditorButton");
const saveTileSetEditorButton = document.getElementById("saveTileSetEditorButton");
const closeTileSetEditorButton = document.getElementById("closeTileSetEditorButton");
const scaleWizardState = {
  active: false,
  points: [],
  calculatedPixelsPerMeter: null,
  saving: false,
};
const libraryEditorState = {
  samples: [],
  selectedIndex: 0,
  saving: false,
};
const tileSetEditorState = {
  sampleIndex: -1,
  convertingRow: null,
  progressUnsubscribe: null,
};
let activelyMakingPoly = false; // Either polyline or polygon

function cloneLibraryValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function openLibraryEditor() {
  if (!window.electronAPI || !libraryEditor) return;

  stopMeasurementMode();
  stopCircleMode();
  closeScaleWizard();

  const libraryData = serializeLibraryDataForSave();
  libraryEditorState.samples = cloneLibraryValue(libraryData.samples || []);
  libraryEditorState.selectedIndex = Math.min(
    Math.max(currentIndex, 0),
    Math.max(libraryEditorState.samples.length - 1, 0)
  );
  if (libraryEditorSearch) libraryEditorSearch.value = "";
  setLibraryEditorStatus("");
  libraryEditor.hidden = false;
  renderLibraryEditor();
  libraryEditorSearch?.focus();
}

function closeLibraryEditor() {
  if (!libraryEditor || libraryEditorState.saving) return;
  if (tileSetEditorState.convertingRow) return;
  closeTileSetEditor();
  libraryEditor.hidden = true;
}

function getLibraryEditorSelectedSample() {
  return libraryEditorState.samples[libraryEditorState.selectedIndex] || null;
}

function formatLibraryEditorGroups(sample) {
  return Array.isArray(sample?.groups) ? sample.groups.join("; ") : "";
}

function formatLibraryEditorAnnotations(sample) {
  return normalizeAnnotationFileOptions(sample?.annotations).join("\n");
}

function getLibraryEditorSearchText() {
  return (libraryEditorSearch?.value || "").trim().toLowerCase();
}

function renderLibraryEditor() {
  renderLibraryEditorRows();
  renderLibraryEditorForm();

  if (libraryEditorSummary) {
    const count = libraryEditorState.samples.length;
    libraryEditorSummary.textContent = `${count} sample${count === 1 ? "" : "s"}`;
  }
}

function renderLibraryEditorRows() {
  if (!libraryEditorRows) return;

  const query = getLibraryEditorSearchText();
  libraryEditorRows.innerHTML = "";

  libraryEditorState.samples.forEach((sample, index) => {
    const searchableText = [
      sample.title,
      sample.description,
      formatLibraryEditorGroups(sample),
    ]
      .join(" ")
      .toLowerCase();
    if (query && !searchableText.includes(query)) return;

    const row = document.createElement("tr");
    row.className = "library-editor-row";
    row.dataset.index = String(index);
    if (index === libraryEditorState.selectedIndex) {
      row.classList.add("selected");
    }

    const sampleCell = document.createElement("td");
    const titleElement = document.createElement("div");
    titleElement.className = "library-editor-row-title";
    titleElement.textContent = sample.title || "(Untitled sample)";
    const descriptionElement = document.createElement("div");
    descriptionElement.className = "library-editor-row-description";
    descriptionElement.textContent = sample.description || "";
    sampleCell.append(titleElement, descriptionElement);

    const groupsCell = document.createElement("td");
    groupsCell.className = "library-editor-row-groups";
    groupsCell.textContent = formatLibraryEditorGroups(sample);

    const tileSetsCell = document.createElement("td");
    tileSetsCell.textContent = String((sample.tileSets || []).length);

    const moveCell = document.createElement("td");
    const moveActions = document.createElement("div");
    moveActions.className = "library-editor-row-actions";
    [
      ["top", "Move to top", "assets/2_go_to_first.png"],
      ["up", "Move up", "assets/2_go_to_previous.png"],
      ["down", "Move down", "assets/2_go_to_next.png"],
      ["bottom", "Move to bottom", "assets/2_go_to_last.png"],
    ].forEach(([action, titleText, iconPath]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = action;
      button.dataset.index = String(index);
      button.title = titleText;
      button.setAttribute("aria-label", `${titleText}: ${sample.title || "sample"}`);
      const icon = document.createElement("img");
      icon.src = iconPath;
      icon.alt = "";
      icon.className = `library-editor-move-icon-${action}`;
      button.appendChild(icon);
      button.disabled =
        (index === 0 && (action === "top" || action === "up")) ||
        (index === libraryEditorState.samples.length - 1 &&
          (action === "down" || action === "bottom"));
      moveActions.appendChild(button);
    });
    moveCell.appendChild(moveActions);

    row.append(sampleCell, groupsCell, tileSetsCell, moveCell);
    libraryEditorRows.appendChild(row);
  });
}

function renderLibraryEditorForm() {
  const selectedSample = getLibraryEditorSelectedSample();
  const hasSample = Boolean(selectedSample);

  [
    libraryEditorTitleInput,
    libraryEditorDescriptionInput,
    libraryEditorGroupsInput,
    libraryEditorScaleInput,
    libraryEditorAnnotationsInput,
    openTileSetEditorButton,
    libraryEditorDeleteButton,
  ].forEach((element) => {
    if (element) element.disabled = !hasSample;
  });

  if (!hasSample) {
    if (libraryEditorTitleInput) libraryEditorTitleInput.value = "";
    if (libraryEditorDescriptionInput) libraryEditorDescriptionInput.value = "";
    if (libraryEditorGroupsInput) libraryEditorGroupsInput.value = "";
    if (libraryEditorScaleInput) libraryEditorScaleInput.value = "";
    if (libraryEditorAnnotationsInput) libraryEditorAnnotationsInput.value = "";
    if (libraryEditorTileSetCount) libraryEditorTileSetCount.textContent = "0";
    return;
  }

  if (libraryEditorTitleInput) libraryEditorTitleInput.value = selectedSample.title || "";
  if (libraryEditorDescriptionInput) {
    libraryEditorDescriptionInput.value = selectedSample.description || "";
  }
  if (libraryEditorGroupsInput) {
    libraryEditorGroupsInput.value = formatLibraryEditorGroups(selectedSample);
  }
  if (libraryEditorScaleInput) {
    libraryEditorScaleInput.value =
      selectedSample.pixelsPerMeter === undefined ||
      selectedSample.pixelsPerMeter === null
        ? ""
        : String(selectedSample.pixelsPerMeter);
  }
  if (libraryEditorAnnotationsInput) {
    libraryEditorAnnotationsInput.value = formatLibraryEditorAnnotations(selectedSample);
  }
  if (libraryEditorTileSetCount) {
    libraryEditorTileSetCount.textContent = String((selectedSample.tileSets || []).length);
  }
}

function updateLibraryEditorSelectedSample() {
  const selectedSample = getLibraryEditorSelectedSample();
  if (!selectedSample) return;

  selectedSample.title = libraryEditorTitleInput?.value.trim() || "";
  selectedSample.description = libraryEditorDescriptionInput?.value.trim() || "";

  const groups = (libraryEditorGroupsInput?.value || "")
    .split(";")
    .map((group) => group.trim())
    .filter(Boolean);
  if (groups.length) {
    selectedSample.groups = groups;
  } else {
    delete selectedSample.groups;
  }

  const pixelsPerMeter = libraryEditorScaleInput?.value.trim() || "";
  if (pixelsPerMeter) {
    selectedSample.pixelsPerMeter = pixelsPerMeter;
  } else {
    delete selectedSample.pixelsPerMeter;
  }

  const annotationFiles = (libraryEditorAnnotationsInput?.value || "")
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
  if (annotationFiles.length === 1) {
    selectedSample.annotations = annotationFiles[0];
  } else if (annotationFiles.length > 1) {
    selectedSample.annotations = annotationFiles;
  } else {
    delete selectedSample.annotations;
  }
}

function selectLibraryEditorSample(index) {
  updateLibraryEditorSelectedSample();
  libraryEditorState.selectedIndex = Math.min(
    Math.max(index, 0),
    Math.max(libraryEditorState.samples.length - 1, 0)
  );
  setLibraryEditorStatus("");
  renderLibraryEditor();
}

function moveLibraryEditorSample(fromIndex, toIndex) {
  updateLibraryEditorSelectedSample();
  const maxIndex = libraryEditorState.samples.length - 1;
  const clampedToIndex = Math.min(Math.max(toIndex, 0), maxIndex);
  if (fromIndex === clampedToIndex) return;

  const [sample] = libraryEditorState.samples.splice(fromIndex, 1);
  libraryEditorState.samples.splice(clampedToIndex, 0, sample);
  libraryEditorState.selectedIndex = clampedToIndex;
  renderLibraryEditor();
}

function deleteLibraryEditorSample() {
  const selectedSample = getLibraryEditorSelectedSample();
  if (!selectedSample) return;
  if (libraryEditorState.samples.length <= 1) {
    setLibraryEditorStatus("A library must contain at least one sample.", true);
    return;
  }

  const titleText = selectedSample.title || "this sample";
  const shouldDelete = window.confirm(
    `Delete "${titleText}" from this library? Image and annotation files will not be deleted.`
  );
  if (!shouldDelete) return;

  libraryEditorState.samples.splice(libraryEditorState.selectedIndex, 1);
  libraryEditorState.selectedIndex = Math.min(
    libraryEditorState.selectedIndex,
    libraryEditorState.samples.length - 1
  );
  setLibraryEditorStatus(`Deleted "${titleText}". Apply to keep this change.`);
  renderLibraryEditor();
}

function validateLibraryEditorSamples() {
  if (!libraryEditorState.samples.length) {
    return "A library must contain at least one sample.";
  }

  for (const [index, sample] of libraryEditorState.samples.entries()) {
    const rowNumber = index + 1;
    if (!sample.title || !sample.title.trim()) {
      return `Sample ${rowNumber} needs a title.`;
    }

    if (sample.pixelsPerMeter !== undefined && sample.pixelsPerMeter !== "") {
      const scale = Number(sample.pixelsPerMeter);
      if (!Number.isFinite(scale) || scale <= 0) {
        return `"${sample.title}" needs a positive pixels-per-meter value.`;
      }
    }

    if (!Array.isArray(sample.tileSets) || sample.tileSets.length === 0) {
      return `"${sample.title}" needs at least one tile set.`;
    }
  }

  return "";
}

function setLibraryEditorStatus(message, isError = false) {
  if (!libraryEditorStatus) return;
  libraryEditorStatus.textContent = message;
  libraryEditorStatus.classList.toggle("error", isError);
}

async function saveLibraryEditor({
  forceSaveAs = false,
  closeAfterSave = false,
} = {}) {
  if (libraryEditorState.saving) return;

  updateLibraryEditorSelectedSample();
  const validationMessage = validateLibraryEditorSamples();
  if (validationMessage) {
    setLibraryEditorStatus(validationMessage, true);
    return;
  }

  const previousTitle = samples[currentIndex]?.title || "";
  const jsonData = {
    ...(currentLibraryData || {}),
    samples: cloneLibraryValue(libraryEditorState.samples),
  };

  libraryEditorState.saving = true;
  [
    saveLibraryEditorButton,
    saveAsLibraryEditorButton,
    applyCloseLibraryEditorButton,
  ].forEach((button) => {
    if (button) button.disabled = true;
  });
  setLibraryEditorStatus("Applying library changes...");

  try {
    await saveLibraryData(jsonData, {
      forceSaveAs,
      canceledMessage: "Library changes were not saved.",
    });
    await loadSampleJSON(jsonData, { autoLoadSample: false });
    selectSampleAfterLibraryEdit(previousTitle);
    if (closeAfterSave) {
      setLibraryEditorStatus("");
      libraryEditorState.saving = false;
      closeLibraryEditor();
    } else {
      setLibraryEditorStatus("Library changes applied.");
    }
  } catch (error) {
    console.error("Could not save library edits:", error);
    setLibraryEditorStatus(error.message || "Could not save library changes.", true);
  } finally {
    libraryEditorState.saving = false;
    [
      saveLibraryEditorButton,
      saveAsLibraryEditorButton,
      applyCloseLibraryEditorButton,
    ].forEach((button) => {
      if (button) button.disabled = false;
    });
  }
}

function selectSampleAfterLibraryEdit(previousTitle) {
  const sampleDropdown = document.getElementById("sampleDropdown");
  const groupDropdown = document.getElementById("groupDropdown");
  if (!sampleDropdown || !groupDropdown || samples.length === 0) return;

  const nextIndex = Math.max(
    samples.findIndex((sample) => sample.title === previousTitle),
    0
  );
  const groupForSample =
    Object.keys(groupMapping).find((group) => groupMapping[group].includes(nextIndex)) ||
    "All";
  groupDropdown.value = groupForSample;
  populateSampleDropdown(groupForSample, { autoSelect: false });
  sampleDropdown.value = String(nextIndex);
  sampleDropdown.dispatchEvent(new Event("change"));
}

async function saveLibraryData(
  jsonData,
  { forceSaveAs = false, canceledMessage = "Library was not saved." } = {}
) {
  currentLibraryData = jsonData;

  if (!forceSaveAs && currentLibraryPath && window.electronAPI?.writeJsonFile) {
    try {
      await window.electronAPI.writeJsonFile(currentLibraryPath, jsonData);
      window.electronAPI.setUnsavedState?.(
        window.appState.hasUnsavedAnnotations || window.appState.hasUnsavedCounts
      );
      return;
    } catch (error) {
      console.warn("Could not write current library; falling back to Save As.", error);
    }
  }

  if (!window.electronAPI?.saveJsonFileAs) {
    throw new Error("No Electron save API is available.");
  }

  const result = await window.electronAPI.saveJsonFileAs("library.json", jsonData);
  if (result?.canceled) {
    throw new Error(canceledMessage);
  }
  currentLibraryPath = result.filePath || currentLibraryPath;
  window.electronAPI.setUnsavedState?.(
    window.appState.hasUnsavedAnnotations || window.appState.hasUnsavedCounts
  );
}

function inferTileSetEditorType(tileSet) {
  const tiles = tileSet?.tiles || [];
  if (
    tileSet?.periodDegrees !== undefined ||
    tiles.some((tile) => tile?.angleDegrees !== undefined)
  ) {
    return "rotation";
  }
  return tiles.length > 1 ? "multiple" : "individual";
}

function getTileSetEditorSelectedSample() {
  return libraryEditorState.samples[tileSetEditorState.sampleIndex] || null;
}

function openTileSetEditor() {
  updateLibraryEditorSelectedSample();
  const selectedSample = getLibraryEditorSelectedSample();
  if (!selectedSample || !tileSetEditor || !tileSetEditorRows) return;

  tileSetEditorState.sampleIndex = libraryEditorState.selectedIndex;
  setTileSetEditorStatus("");
  if (tileSetEditorTitle) {
    tileSetEditorTitle.textContent = "Edit Tile Sets";
  }
  if (tileSetEditorSummary) {
    tileSetEditorSummary.textContent = selectedSample.title || "(Untitled sample)";
  }

  tileSetEditor.hidden = false;
  renderTileSetEditor(selectedSample.tileSets || []);
}

function closeTileSetEditor() {
  if (!tileSetEditor) return;
  if (tileSetEditorState.convertingRow) return;

  tileSetEditor.hidden = true;
  tileSetEditorState.sampleIndex = -1;
  setTileSetEditorStatus("");
}

function setTileSetEditorStatus(message, isError = false) {
  if (!tileSetEditorStatus) return;
  tileSetEditorStatus.textContent = message;
  tileSetEditorStatus.classList.toggle("error", isError);
}

function renderTileSetEditor(tileSets) {
  if (!tileSetEditorRows) return;

  tileSetEditorRows.innerHTML = "";
  const rows = tileSets.length ? tileSets : [{ label: "", tiles: [{ uri: "" }] }];
  rows.forEach((tileSet) => {
    tileSetEditorRows.appendChild(createTileSetEditorRow(tileSet));
  });
  renumberTileSetEditorRows();
}

function createTileSetEditorRow(tileSet = {}) {
  const row = document.createElement("section");
  row.className = "tile-set-editor-row";
  row.dataset.originalTileSet = JSON.stringify(tileSet || {});

  const header = document.createElement("div");
  header.className = "tile-set-editor-row-header";

  const heading = document.createElement("h3");
  heading.textContent = "Tile Set";

  const headerActions = document.createElement("div");
  headerActions.className = "tile-set-editor-row-actions";
  [
    ["move-tile-set-top", "Move tile set to top", "assets/2_go_to_first.png", "top"],
    ["move-tile-set-up", "Move tile set up", "assets/2_go_to_previous.png", "up"],
    ["move-tile-set-down", "Move tile set down", "assets/2_go_to_next.png", "down"],
    ["move-tile-set-bottom", "Move tile set to bottom", "assets/2_go_to_last.png", "bottom"],
  ].forEach(([action, titleText, iconPath, iconClass]) => {
    const button = createTileSetEditorButton(titleText, "", action);
    const icon = document.createElement("img");
    icon.src = iconPath;
    icon.alt = "";
    icon.className = `library-editor-move-icon-${iconClass}`;
    button.appendChild(icon);
    headerActions.appendChild(button);
  });
  const addButton = createTileSetEditorButton("Add tile set", "+", "add-tile-set");
  const removeButton = createTileSetEditorButton(
    "Remove tile set",
    "-",
    "remove-tile-set"
  );
  headerActions.append(addButton, removeButton);
  header.append(heading, headerActions);

  const typeSelect = document.createElement("select");
  typeSelect.className = "tile-set-editor-type";
  typeSelect.setAttribute("aria-label", "Tile set type");
  [
    ["individual", "Individual"],
    ["multiple", "Multiple"],
    ["rotation", "Multiple (rotation enabled)"],
  ].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    typeSelect.appendChild(option);
  });
  typeSelect.value = inferTileSetEditorType(tileSet);

  const labelWrap = document.createElement("label");
  labelWrap.className = "tile-set-editor-label-wrap";
  labelWrap.textContent = "Tile set label";
  const labelInput = document.createElement("input");
  labelInput.className = "tile-set-editor-label-input";
  labelInput.type = "text";
  labelInput.value = tileSet.label || "";
  labelInput.placeholder = "PPL";
  labelWrap.appendChild(labelInput);

  const periodWrap = document.createElement("label");
  periodWrap.className = "tile-set-editor-period-wrap";
  periodWrap.textContent = "Angle periodicity";
  const periodInput = document.createElement("input");
  periodInput.className = "tile-set-editor-period-input";
  periodInput.type = "number";
  periodInput.min = "1";
  periodInput.max = "360";
  periodInput.step = "any";
  periodInput.value =
    tileSet.periodDegrees === undefined || tileSet.periodDegrees === null
      ? "90"
      : String(tileSet.periodDegrees);
  periodWrap.appendChild(periodInput);

  const images = document.createElement("div");
  images.className = "tile-set-editor-images";
  const tiles = tileSet.tiles?.length ? tileSet.tiles : [{ uri: "" }];
  tiles.forEach((tile) => {
    images.appendChild(createTileImageEditorRow(tile, typeSelect.value));
  });

  row.append(header, typeSelect, labelWrap, periodWrap, images);
  updateTileSetEditorType(row);
  return row;
}

function createTileImageEditorRow(tile = {}, type = "individual") {
  const row = document.createElement("div");
  row.className = "tile-image-editor-row";
  row.dataset.originalTile = JSON.stringify(tile || {});

  const labelInput = document.createElement("input");
  labelInput.className = "tile-image-editor-label-input";
  labelInput.type = "text";
  labelInput.placeholder = "Image label";
  labelInput.value = tile.label || "";

  const angleLabel = document.createElement("label");
  angleLabel.className = "tile-image-editor-angle-wrap";
  angleLabel.textContent = "Angle";
  const angleInput = document.createElement("input");
  angleInput.className = "tile-image-editor-angle-input";
  angleInput.type = "number";
  angleInput.min = "0";
  angleInput.max = "360";
  angleInput.step = "any";
  angleInput.value =
    tile.angleDegrees === undefined || tile.angleDegrees === null
      ? "0"
      : String(tile.angleDegrees);
  angleLabel.appendChild(angleInput);

  const uriInput = document.createElement("input");
  uriInput.className = "tile-image-editor-uri-input";
  uriInput.type = "text";
  uriInput.placeholder = "images/sample.dzi";
  uriInput.value = tile.uri || "";

  const chooseButton = createTileSetEditorButton("Choose JPG", "Choose JPG", "choose-jpg");
  chooseButton.disabled =
    !window.electronAPI?.selectJpgFile || !window.electronAPI?.convertJpgToDzi;

  const addButton = createTileSetEditorButton("Add image", "+", "add-image");
  const removeButton = createTileSetEditorButton("Remove image", "-", "remove-image");

  const status = document.createElement("div");
  status.className = "tile-image-editor-status";

  row.append(labelInput, angleLabel, uriInput, chooseButton, addButton, removeButton, status);
  updateTileImageEditorRowForType(row, type);
  return row;
}

function createTileSetEditorButton(title, text, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.action = action;
  button.title = title;
  button.textContent = text;
  return button;
}

function updateTileSetEditorType(tileSetRow) {
  const type = tileSetRow.querySelector(".tile-set-editor-type")?.value || "individual";
  const labelWrap = tileSetRow.querySelector(".tile-set-editor-label-wrap");
  const periodWrap = tileSetRow.querySelector(".tile-set-editor-period-wrap");
  const images = tileSetRow.querySelector(".tile-set-editor-images");

  if (labelWrap) labelWrap.hidden = type === "multiple";
  if (periodWrap) periodWrap.hidden = type !== "rotation";

  const imageRows = Array.from(images?.querySelectorAll(".tile-image-editor-row") || []);
  if (type === "individual") {
    imageRows.slice(1).forEach((row) => row.remove());
  } else if (imageRows.length < 2) {
    images.appendChild(createTileImageEditorRow({}, type));
  }

  Array.from(images?.querySelectorAll(".tile-image-editor-row") || []).forEach((row) => {
    updateTileImageEditorRowForType(row, type);
  });
  updateTileSetEditorButtons();
}

function updateTileImageEditorRowForType(row, type) {
  const labelInput = row.querySelector(".tile-image-editor-label-input");
  const angleWrap = row.querySelector(".tile-image-editor-angle-wrap");

  if (labelInput) labelInput.hidden = type !== "multiple";
  if (angleWrap) angleWrap.hidden = type !== "rotation";
}

function renumberTileSetEditorRows() {
  const rows = Array.from(tileSetEditorRows?.querySelectorAll(".tile-set-editor-row") || []);
  rows.forEach((row, index) => {
    const heading = row.querySelector("h3");
    if (heading) heading.textContent = `Tile Set ${index + 1}`;
  });
  updateTileSetEditorButtons();
}

function updateTileSetEditorButtons() {
  const tileSetRows = Array.from(
    tileSetEditorRows?.querySelectorAll(".tile-set-editor-row") || []
  );
  tileSetRows.forEach((tileSetRow, index) => {
    const removeTileSetButton = tileSetRow.querySelector(
      'button[data-action="remove-tile-set"]'
    );
    if (removeTileSetButton) {
      removeTileSetButton.hidden = index === 0;
      removeTileSetButton.disabled = tileSetRows.length <= 1;
    }
    [
      ["move-tile-set-top", index === 0],
      ["move-tile-set-up", index === 0],
      ["move-tile-set-down", index === tileSetRows.length - 1],
      ["move-tile-set-bottom", index === tileSetRows.length - 1],
    ].forEach(([action, disabled]) => {
      const button = tileSetRow.querySelector(`button[data-action="${action}"]`);
      if (button) button.disabled = disabled;
    });

    const imageRows = Array.from(
      tileSetRow.querySelectorAll(".tile-image-editor-row")
    );
    const type = tileSetRow.querySelector(".tile-set-editor-type")?.value || "individual";
    imageRows.forEach((imageRow) => {
      const addButton = imageRow.querySelector('button[data-action="add-image"]');
      const removeButton = imageRow.querySelector('button[data-action="remove-image"]');
      if (addButton) addButton.hidden = type === "individual";
      if (removeButton) {
        removeButton.hidden = type === "individual";
        removeButton.disabled = imageRows.length <= 1;
      }
    });
  });
}

function addTileSetEditorRow(afterRow) {
  const row = createTileSetEditorRow({ label: "", tiles: [{ uri: "" }] });
  afterRow.after(row);
  renumberTileSetEditorRows();
}

function removeTileSetEditorRow(row) {
  if (!tileSetEditorRows || tileSetEditorRows.children.length <= 1) return;
  row.remove();
  renumberTileSetEditorRows();
}

function moveTileSetEditorRow(row, targetIndex) {
  if (!tileSetEditorRows || !row) return;

  const rows = Array.from(tileSetEditorRows.querySelectorAll(".tile-set-editor-row"));
  const currentIndex = rows.indexOf(row);
  if (currentIndex === -1) return;

  const clampedTargetIndex = Math.min(Math.max(targetIndex, 0), rows.length - 1);
  if (currentIndex === clampedTargetIndex) return;

  row.remove();
  const remainingRows = Array.from(
    tileSetEditorRows.querySelectorAll(".tile-set-editor-row")
  );
  if (clampedTargetIndex >= remainingRows.length) {
    tileSetEditorRows.appendChild(row);
  } else {
    tileSetEditorRows.insertBefore(row, remainingRows[clampedTargetIndex]);
  }
  renumberTileSetEditorRows();
}

function addTileImageEditorRow(afterRow) {
  const tileSetRow = afterRow.closest(".tile-set-editor-row");
  const type = tileSetRow.querySelector(".tile-set-editor-type")?.value || "individual";
  const row = createTileImageEditorRow({}, type);
  afterRow.after(row);
  updateTileSetEditorType(tileSetRow);
}

function removeTileImageEditorRow(row) {
  const tileSetRow = row.closest(".tile-set-editor-row");
  const imageRows = tileSetRow?.querySelectorAll(".tile-image-editor-row") || [];
  if (imageRows.length <= 1) return;
  row.remove();
  updateTileSetEditorType(tileSetRow);
}

function parseTileSetEditorJson(datasetValue) {
  if (!datasetValue) return {};
  try {
    return JSON.parse(datasetValue);
  } catch {
    return {};
  }
}

function collectTileSetsFromEditor() {
  const tileSetRows = Array.from(
    tileSetEditorRows?.querySelectorAll(".tile-set-editor-row") || []
  );

  return tileSetRows.map((tileSetRow) => {
    const type = tileSetRow.querySelector(".tile-set-editor-type")?.value || "individual";
    const originalTileSet = parseTileSetEditorJson(tileSetRow.dataset.originalTileSet);
    const tileSet = { ...originalTileSet };
    delete tileSet.tiles;
    delete tileSet.label;
    delete tileSet.periodDegrees;

    const label = tileSetRow.querySelector(".tile-set-editor-label-input")?.value.trim();
    const periodValue = tileSetRow
      .querySelector(".tile-set-editor-period-input")
      ?.value.trim();

    if (type !== "multiple" && label) {
      tileSet.label = label;
    }
    if (type === "rotation") {
      tileSet.periodDegrees = Number(periodValue || 90);
    }

    tileSet.tiles = Array.from(
      tileSetRow.querySelectorAll(".tile-image-editor-row")
    ).map((imageRow) => {
      const originalTile = parseTileSetEditorJson(imageRow.dataset.originalTile);
      const tile = { ...originalTile };
      delete tile.uri;
      delete tile.label;
      delete tile.angleDegrees;

      tile.uri =
        imageRow.querySelector(".tile-image-editor-uri-input")?.value.trim() || "";
      if (type === "multiple") {
        const imageLabel = imageRow
          .querySelector(".tile-image-editor-label-input")
          ?.value.trim();
        if (imageLabel) tile.label = imageLabel;
      }
      if (type === "rotation") {
        tile.angleDegrees = Number(
          imageRow.querySelector(".tile-image-editor-angle-input")?.value || 0
        );
      }
      return tile;
    });

    return tileSet;
  });
}

function validateTileSetsForEditor(tileSets) {
  if (!tileSets.length) return "Add at least one tile set.";

  for (const [tileSetIndex, tileSet] of tileSets.entries()) {
    const label = `Tile Set ${tileSetIndex + 1}`;
    if (!Array.isArray(tileSet.tiles) || tileSet.tiles.length === 0) {
      return `${label} needs at least one image.`;
    }

    if (tileSet.periodDegrees !== undefined) {
      const period = Number(tileSet.periodDegrees);
      if (!Number.isFinite(period) || period <= 0 || period > 360) {
        return `${label} needs an angle periodicity from 1 to 360.`;
      }
    }

    for (const [tileIndex, tile] of tileSet.tiles.entries()) {
      if (!tile.uri) {
        return `${label}, image ${tileIndex + 1} needs a URI or converted JPG.`;
      }
      if (tile.angleDegrees !== undefined) {
        const angle = Number(tile.angleDegrees);
        if (!Number.isFinite(angle) || angle < 0 || angle > 360) {
          return `${label}, image ${tileIndex + 1} needs an angle from 0 to 360.`;
        }
      }
    }
  }

  return "";
}

function saveTileSetEditorDraft() {
  const selectedSample = getTileSetEditorSelectedSample();
  if (!selectedSample) return;
  if (tileSetEditorState.convertingRow) {
    setTileSetEditorStatus("Wait for the JPG conversion to finish.", true);
    return;
  }

  const tileSets = collectTileSetsFromEditor();
  const validationMessage = validateTileSetsForEditor(tileSets);
  if (validationMessage) {
    setTileSetEditorStatus(validationMessage, true);
    return;
  }

  selectedSample.tileSets = tileSets;
  setTileSetEditorStatus("");
  closeTileSetEditor();
  renderLibraryEditorRows();
  renderLibraryEditorForm();
  setLibraryEditorStatus("Tile set changes saved to the draft. Apply to write them.");
}

function setTileImageRowStatus(row, message, isError = false) {
  const status = row.querySelector(".tile-image-editor-status");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function chooseAndConvertTileImage(row) {
  if (!window.electronAPI?.selectJpgFile || !window.electronAPI?.convertJpgToDzi) {
    setTileImageRowStatus(row, "JPG conversion is unavailable.", true);
    return;
  }
  if (tileSetEditorState.convertingRow) return;

  const chooseButton = row.querySelector('button[data-action="choose-jpg"]');
  try {
    tileSetEditorState.convertingRow = row;
    if (chooseButton) chooseButton.disabled = true;
    if (saveTileSetEditorButton) saveTileSetEditorButton.disabled = true;
    setTileImageRowStatus(row, "Selecting JPG...");
    const result = await window.electronAPI.selectJpgFile();
    if (result?.canceled || !result?.sourcePath) {
      setTileImageRowStatus(row, "");
      return;
    }

    setTileImageRowStatus(row, "Converting JPG to DZI...");
    const conversion = await window.electronAPI.convertJpgToDzi(result.sourcePath);
    const uri = conversion?.relativeDziPath || conversion?.dziPath || "";
    row.querySelector(".tile-image-editor-uri-input").value = uri;
    setTileImageRowStatus(row, "Converted.");
  } catch (error) {
    console.error("Could not convert JPG:", error);
    setTileImageRowStatus(row, error.message || "Conversion failed.", true);
  } finally {
    tileSetEditorState.convertingRow = null;
    if (chooseButton) chooseButton.disabled = false;
    if (saveTileSetEditorButton) saveTileSetEditorButton.disabled = false;
  }
}

function handleTileSetEditorConversionProgress(progress) {
  const row = tileSetEditorState.convertingRow;
  if (!row || !progress) return;

  const percent = Number(progress.percent);
  const percentLabel = Number.isFinite(percent) ? ` ${Math.round(percent)}%` : "";
  setTileImageRowStatus(row, `Converting JPG to DZI...${percentLabel}`);
}

if (window.electronAPI?.onDziConversionProgress) {
  tileSetEditorState.progressUnsubscribe = window.electronAPI.onDziConversionProgress(
    handleTileSetEditorConversionProgress
  );
}

tileSetEditorRows?.addEventListener("change", function (event) {
  const typeSelect = event.target.closest(".tile-set-editor-type");
  if (typeSelect) {
    updateTileSetEditorType(typeSelect.closest(".tile-set-editor-row"));
  }
});

tileSetEditorRows?.addEventListener("click", function (event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const action = button.dataset.action;
  if (action === "add-tile-set") {
    addTileSetEditorRow(button.closest(".tile-set-editor-row"));
  } else if (action === "remove-tile-set") {
    removeTileSetEditorRow(button.closest(".tile-set-editor-row"));
  } else if (action.startsWith("move-tile-set-")) {
    const row = button.closest(".tile-set-editor-row");
    if (!row) return;
    const rows = Array.from(tileSetEditorRows.querySelectorAll(".tile-set-editor-row"));
    const index = rows.indexOf(row);
    const lastIndex = rows.length - 1;
    const targetIndex =
      action === "move-tile-set-top"
        ? 0
        : action === "move-tile-set-up"
          ? index - 1
          : action === "move-tile-set-down"
            ? index + 1
            : lastIndex;
    moveTileSetEditorRow(row, targetIndex);
  } else if (action === "add-image") {
    addTileImageEditorRow(button.closest(".tile-image-editor-row"));
  } else if (action === "remove-image") {
    removeTileImageEditorRow(button.closest(".tile-image-editor-row"));
  } else if (action === "choose-jpg") {
    chooseAndConvertTileImage(button.closest(".tile-image-editor-row"));
  }
});

libraryEditorRows?.addEventListener("click", function (event) {
  const moveButton = event.target.closest("button[data-action]");
  if (moveButton) {
    event.stopPropagation();
    const index = Number(moveButton.dataset.index);
    const action = moveButton.dataset.action;
    const lastIndex = libraryEditorState.samples.length - 1;
    const nextIndex =
      action === "top"
        ? 0
        : action === "up"
          ? index - 1
          : action === "down"
            ? index + 1
            : lastIndex;
    moveLibraryEditorSample(index, nextIndex);
    return;
  }

  const row = event.target.closest(".library-editor-row");
  if (row) {
    selectLibraryEditorSample(Number(row.dataset.index));
  }
});

[
  libraryEditorTitleInput,
  libraryEditorDescriptionInput,
  libraryEditorGroupsInput,
  libraryEditorScaleInput,
  libraryEditorAnnotationsInput,
].forEach((element) =>
  element?.addEventListener("input", function () {
    updateLibraryEditorSelectedSample();
    renderLibraryEditorRows();
  })
);
libraryEditorSearch?.addEventListener("input", renderLibraryEditorRows);
libraryEditorForm?.addEventListener("submit", (event) => event.preventDefault());
libraryEditorDeleteButton?.addEventListener("click", deleteLibraryEditorSample);
cancelLibraryEditorButton?.addEventListener("click", closeLibraryEditor);
closeLibraryEditorButton?.addEventListener("click", closeLibraryEditor);
openTileSetEditorButton?.addEventListener("click", openTileSetEditor);
cancelTileSetEditorButton?.addEventListener("click", closeTileSetEditor);
closeTileSetEditorButton?.addEventListener("click", closeTileSetEditor);
saveTileSetEditorButton?.addEventListener("click", saveTileSetEditorDraft);
saveLibraryEditorButton?.addEventListener("click", () => saveLibraryEditor());
saveAsLibraryEditorButton?.addEventListener("click", () =>
  saveLibraryEditor({ forceSaveAs: true })
);
applyCloseLibraryEditorButton?.addEventListener("click", () =>
  saveLibraryEditor({ closeAfterSave: true })
);

function openScaleWizard() {
  if (!window.electronAPI || !scaleWizard) return;

  stopMeasurementMode();
  stopCircleMode();
  scaleWizard.hidden = false;
  scaleWizardState.active = true;
  resetScaleWizard(false);
  scaleWizardLength?.focus();
}

function closeScaleWizard() {
  if (!scaleWizard) return;

  scaleWizard.hidden = true;
  scaleWizardState.active = false;
  scaleWizardState.points = [];
  scaleWizardState.calculatedPixelsPerMeter = null;
  drawScaleWizardOverlay();
}

function resetScaleWizard(keepLength = true) {
  scaleWizardState.points = [];
  scaleWizardState.calculatedPixelsPerMeter = null;
  if (!keepLength && scaleWizardLength) {
    scaleWizardLength.value = "";
  }
  updateScaleWizardStatus();
  drawScaleWizardOverlay();
}

function updateScaleWizardStatus() {
  if (!scaleWizardStatus || !scaleWizardResult || !applyScaleWizardButton) return;

  const selectedCount = scaleWizardState.points.length;
  const nextPoint = selectedCount === 0 ? "start" : "end";
  scaleWizardStatus.textContent =
    selectedCount < 2
      ? `Click the ${nextPoint} of the image scalebar.`
      : "Enter the scalebar length, then apply the scale.";

  const scale = calculateScaleWizardPixelsPerMeter();
  scaleWizardState.calculatedPixelsPerMeter = scale;
  scaleWizardResult.classList.remove("error");

  if (scale === null) {
    scaleWizardResult.textContent =
      selectedCount < 2
        ? "Select two points to calculate scale."
        : "Enter a positive length to calculate scale.";
    applyScaleWizardButton.disabled = true;
    return;
  }

  scaleWizardResult.textContent = `Calculated scale: ${formatScaleValue(scale)} pixels/m`;
  applyScaleWizardButton.disabled = false;
}

function formatScaleValue(value) {
  if (!Number.isFinite(value)) return "";
  if (value >= 100) return Math.round(value).toLocaleString();
  return value.toPrecision(6);
}

function calculateScaleWizardPixelsPerMeter() {
  if (scaleWizardState.points.length !== 2) return null;

  const lengthValue = Number(scaleWizardLength?.value);
  const unitsPerMeter = Number(scaleWizardUnits?.value);
  if (!Number.isFinite(lengthValue) || lengthValue <= 0) return null;
  if (!Number.isFinite(unitsPerMeter) || unitsPerMeter <= 0) return null;

  const pixelLength = calculateDistance(
    scaleWizardState.points[0],
    scaleWizardState.points[1]
  );
  if (!Number.isFinite(pixelLength) || pixelLength <= 0) return null;

  return pixelLength / (lengthValue / unitsPerMeter);
}

function drawScaleWizardOverlay() {
  if (!scaleCanvas) return;

  const container = viewer.container;
  scaleCanvas.width = container.clientWidth;
  scaleCanvas.height = container.clientHeight;

  const ctx = scaleCanvas.getContext("2d");
  ctx.clearRect(0, 0, scaleCanvas.width, scaleCanvas.height);
  if (!scaleWizardState.active || scaleWizardState.points.length === 0) return;

  const image = viewer.world.getItemAt(0);
  if (!image) return;

  const screenPoints = scaleWizardState.points.map(([x, y]) => {
    const viewportPoint = image.imageToViewportCoordinates(x, y);
    return viewer.viewport.pixelFromPoint(viewportPoint, true);
  });

  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#f4c542";
  ctx.fillStyle = "#f4c542";
  ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
  ctx.shadowBlur = 3;

  if (screenPoints.length === 2) {
    ctx.beginPath();
    ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
    ctx.lineTo(screenPoints[1].x, screenPoints[1].y);
    ctx.stroke();
  }

  screenPoints.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

async function applyScaleWizard() {
  if (scaleWizardState.saving) return;

  const scale = calculateScaleWizardPixelsPerMeter();
  if (scale === null) {
    showScaleWizardError("Select two points and enter a positive length.");
    return;
  }

  scaleWizardState.saving = true;
  applyScaleWizardButton.disabled = true;
  if (scaleWizardStatus) {
    scaleWizardStatus.textContent = "Applying scale...";
  }
  if (scaleWizardResult) {
    scaleWizardResult.classList.remove("error");
    scaleWizardResult.textContent = "Saving scale to the library JSON...";
  }
  const previousPixelsPerMeter = samples[currentIndex].pixelsPerMeter;
  try {
    samples[currentIndex].pixelsPerMeter = scale;
    updateScaleDependentControls();
    addScalebar();
    closeScaleWizard();
    window.electronAPI?.setUnsavedState?.(true);
    await saveCurrentLibraryForScaleUpdate();
  } catch (error) {
    samples[currentIndex].pixelsPerMeter = previousPixelsPerMeter;
    updateScaleDependentControls();
    addScalebar();
    console.error("Could not save scale:", error);
    openScaleWizard();
    showScaleWizardError(error.message || "Could not apply the scale.");
  } finally {
    scaleWizardState.saving = false;
    updateScaleWizardStatus();
  }
}

function showScaleWizardError(message) {
  if (!scaleWizardResult) return;
  scaleWizardResult.textContent = message;
  scaleWizardResult.classList.add("error");
}

async function saveCurrentLibraryForScaleUpdate() {
  const jsonData = serializeLibraryDataForSave();
  await saveLibraryData(jsonData, { canceledMessage: "Scale was not saved." });
}

viewer.addHandler("canvas-click", function (event) {
  if (!scaleWizardState.active) return;

  event.preventDefaultAction = true;
  const image = viewer.world.getItemAt(0);
  if (!image) return;

  const viewportPoint = viewer.viewport.pointFromPixel(event.position);
  const imagePoint = image.viewportToImageCoordinates(
    viewportPoint.x,
    viewportPoint.y
  );

  if (scaleWizardState.points.length >= 2) {
    scaleWizardState.points = [];
  }
  scaleWizardState.points.push([imagePoint.x, imagePoint.y]);
  updateScaleWizardStatus();
  drawScaleWizardOverlay();
});

[
  scaleWizardLength,
  scaleWizardUnits,
].forEach((element) => element?.addEventListener("input", updateScaleWizardStatus));
resetScaleWizardButton?.addEventListener("click", () => resetScaleWizard(true));
cancelScaleWizardButton?.addEventListener("click", closeScaleWizard);
closeScaleWizardButton?.addEventListener("click", closeScaleWizard);
applyScaleWizardButton?.addEventListener("click", applyScaleWizard);

viewer.addHandler("canvas-click", function (event) {
  if (scaleWizardState.active) return;
  if (isPolylineMode || isPolygonMode || isZPressed || isXPressed) {
    activelyMakingPoly = true;
    const image = viewer.world.getItemAt(0);
    const imageSize = image.getContentSize();
    const viewportPoint = viewer.viewport.pointFromPixel(event.position);
    const imagePoint = image.viewportToImageCoordinates(
      viewportPoint.x,
      viewportPoint.y
    );
    const x = viewportPoint.x;
    const y = viewportPoint.y;
    const uniqueID = generateUniqueId(8);
    const labelFontSize = Number(
      document.getElementById("annoLabelFontSize").value
    );
    currentPolyStyleColors = getCurrentAnnotationStyleColors(
      currentPolyStyleColors
    );
    const labelFontColor = currentPolyStyleColors.labelFontColor;
    const labelBackgroundColor = currentPolyStyleColors.labelBackgroundColor;
    const labelBackgroundOpacity = getAnnotationOpacityValue("annoLabelBackgroundOpacity");
    const lineWeight = Number(document.getElementById("lineWeight").value);
    const lineColor = currentPolyStyleColors.lineColor;
    const lineStyle = document.getElementById("lineStyle").value;
    const lineOpacity = getAnnotationOpacityValue("lineOpacity");
    const fillColor = currentPolyStyleColors.fillColor;
    const fillOpacity = getAnnotationOpacityValue("fillOpacity");
    clickCoordinates.push({ x, y });
    clickImageCoordinates.push([imagePoint.x, imagePoint.y]);
    activeAnnotationDraft = "poly";
    resetAnnotationDraftRedo();
    if (clickCoordinates.length > 1) {
      for (let i = 0; i < clickCoordinates.length; i++) {
        const viewportPoint = new OpenSeadragon.Point(
          clickCoordinates[i].x,
          clickCoordinates[i].y
        );
      }
      // Draw the polyline (polyline or polygon)
      drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
    }

    // document.addEventListener("keydown", function (event) {
    //   // Check if the Escape key was pressed
    //   if (event.key === "Escape") {
    //     removeTemporaryPoints();
    //   }
    // });

    // Continually update the annoJSONTemp with the latest coordinates
    // viewerContainer.addEventListener("mousemove", function (subevent) {
    //   if (activelyMakingPoly) {
    //     // Clear to avoid duplicating lines
    //     annoJSONTemp = {
    //       type: "FeatureCollection",
    //       features: [],
    //     };
    //     const rect = viewerContainer.getBoundingClientRect(); // Get container bounds
    //     const position = {
    //       x: subevent.clientX - rect.left,
    //       y: subevent.clientY - rect.top,
    //     };
    //     const positionPoint = new OpenSeadragon.Point(position.x, position.y);
    //     const subeventViewportPoint =
    //       viewer.viewport.pointFromPixel(positionPoint);
    //     const subeventImagePoint = image.viewportToImageCoordinates(
    //       subeventViewportPoint.x,
    //       subeventViewportPoint.y
    //     );
    //     addPolylineToGeoJSON(
    //       annoJSONTemp,
    //       [
    //         ...clickImageCoordinates,
    //         [subeventImagePoint.x, subeventImagePoint.y],
    //       ],
    //       {
    //         labelFontSize: labelFontSize,
    //         labelFontColor: labelFontColor,
    //         labelBackgroundColor: labelBackgroundColor,
    //         labelBackgroundOpacity: labelBackgroundOpacity,
    //         lineStyle: lineStyle,
    //         lineWeight: lineWeight,
    //         lineColor: lineColor,
    //         lineOpacity: lineOpacity,
    //       }
    //     );
    //     drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
    //   }
    // });

    // If the time between this click and the last click is shorter than clickDelay, it's a double-click
    const currentTime = new Date().getTime();
    if (currentTime - lastClickTime < clickDelay) {
      suppressAnnotationDoubleClickBriefly();
      clickImageCoordinates = getCoordinatesWithoutTrailingDuplicate(clickImageCoordinates);
      clickCoordinates = clickCoordinates.slice(0, clickImageCoordinates.length);
      // Check whether z or x keys were being held at time of double click
      let ZWasPressed = false;
      let XWasPressed = false;
      if (isZPressed) {
        ZWasPressed = true;
      }
      if (isXPressed) {
        XWasPressed = true;
      }

      // It's a double-click, so stop the timeout and end collection
      activelyMakingPoly = false;
      clearTimeout(clickTimeout);

      // Calculate the stuff we need
      const uuid = generateUniqueId(8);
      const image = viewer.world.getItemAt(0);
      const labelViewportPoint = new OpenSeadragon.Point(
        clickCoordinates[0].x,
        clickCoordinates[0].y
      );
      const labelImagePoint = image.viewportToImageCoordinates(
        labelViewportPoint.x,
        labelViewportPoint.y
      );

      const rectAreaPixels2 = calculatePolygonArea([clickImageCoordinates]);
      const rectAreaM2 = squareMetersFromSquarePixels(rectAreaPixels2);
      const rectPerimeterPixels = calculatePolygonExteriorPerimeter([
        clickImageCoordinates,
      ]);
      const rectPerimeterM = metersFromPixels(rectPerimeterPixels);
      const lineLengthPixels = calculateLineStringLength(clickImageCoordinates);
      const lineLengthM = metersFromPixels(lineLengthPixels);

      resolveNewAnnotationLabel((constPolylineLabel) => {
        finalizePolyAnnotation(
          constPolylineLabel,
          labelImagePoint,
          imageSize,
          uuid,
          labelViewportPoint,
          labelFontSize,
          labelFontColor,
          labelBackgroundColor,
          labelBackgroundOpacity,
          lineStyle,
          lineWeight,
          lineColor,
          lineOpacity,
          fillColor,
          fillOpacity,
          rectAreaM2,
          rectPerimeterM,
          lineLengthM,
          isPolygonMode,
          XWasPressed,
          isPolylineMode,
          ZWasPressed,
          clickImageCoordinates
        );
        drawPath(polyCanvas, [annoJSON]);
        // Reset the coordinates array for the next set of clicks
        clickCoordinatesArray.push(clickCoordinates);
        clickCoordinates = [];
        clickImageCoordinates = []; // Clear
        currentPolyStyleColors = null;
        clearAnnotationDraftState();

        annoJSONTemp = {
          type: "FeatureCollection",
          features: [],
        };
        // window.appState.hasUnsavedAnnotations = true;
        unsavedAnnotations(true);
        enableAnnoButtons();
        isXPressed = false; // reset (because keyup not detected)
        XWasPressed = false; // reset
        isZPressed = false; // reset (because keyup not detected)
        ZWasPressed = false; // reset
        if (!polylineButton.classList.contains("active")) {
          togglePolylineFloaterOn(false);
        }
        activelyMakingPoly = false;
        enableAnnoButtons();
      });
    } else {
      // It's a single click, so set a timeout to handle it
      clickTimeout = setTimeout(function () {
        // Single click detected, continuing collection...
      }, clickDelay);
    }

    // Update the last click timestamp
    lastClickTime = currentTime;
  }
});

function finalizePolyAnnotation(
  constPolylineLabel,
  labelImagePoint,
  imageSize,
  uuid,
  labelViewportPoint,
  labelFontSize,
  labelFontColor,
  labelBackgroundColor,
  labelBackgroundOpacity,
  lineStyle,
  lineWeight,
  lineColor,
  lineOpacity,
  fillColor,
  fillOpacity,
  rectAreaM2,
  rectPerimeterM,
  lineLengthM,
  isPolygonMode,
  XWasPressed,
  isPolylineMode,
  ZWasPressed,
  clickImageCoordinates
) {
  if (isPolygonMode || XWasPressed) {
    const polygonCoordinates =
      getCoordinatesWithoutTrailingDuplicate(clickImageCoordinates);
    if (
      polygonCoordinates.length > 1 &&
      !coordinatesMatch(
        polygonCoordinates[0],
        polygonCoordinates[polygonCoordinates.length - 1]
      )
    ) {
      polygonCoordinates.push([...polygonCoordinates[0]]);
    }
    addPolygonToGeoJSON(annoJSON, polygonCoordinates, {
      uuid: uuid,
      label: constPolylineLabel,
      xLabel: labelImagePoint.x,
      yLabel: labelImagePoint.y,
      imageTitle: title(),
      pixelsPerMeter: pixelsPerMeter(),
      imageWidth: imageSize.x,
      imageHeight: imageSize.y,
      labelFontSize: labelFontSize,
      labelFontColor: labelFontColor,
      labelBackgroundColor: labelBackgroundColor,
      labelBackgroundOpacity: labelBackgroundOpacity,
      lineStyle: lineStyle,
      lineWeight: lineWeight,
      lineColor: lineColor,
      lineOpacity: lineOpacity,
      fillColor: fillColor,
      fillOpacity: fillOpacity,
      area_m2: rectAreaM2,
      perimeter_m: rectPerimeterM,
    });

    if (!polygonButton.classList.contains("active")) {
      togglePolygonFloaterOn(false);
    }
  }
  if (isPolylineMode || ZWasPressed) {
    const polylineCoordinates =
      getCoordinatesWithoutTrailingDuplicate(clickImageCoordinates);
    addPolylineToGeoJSON(
      annoJSON,
      polylineCoordinates,
      {
        uuid: uuid,
        label: constPolylineLabel,
        xLabel: labelImagePoint.x,
        yLabel: labelImagePoint.y,
        imageTitle: title(),
        pixelsPerMeter: pixelsPerMeter(),
        imageWidth: imageSize.x,
        imageHeight: imageSize.y,
        labelFontSize: labelFontSize,
        labelFontColor: labelFontColor,
        labelBackgroundColor: labelBackgroundColor,
        labelBackgroundOpacity: labelBackgroundOpacity,
        lineStyle: lineStyle,
        lineWeight: lineWeight,
        lineColor: lineColor,
        lineOpacity: lineOpacity,
        length_m: lineLengthM,
        // canvasDraw: true,
      }
    );
  }
  drawShape(polyCanvas, [annoJSON]);

  // Make text and crosshairs
  addText(
    uuid,
    constPolylineLabel,
    labelViewportPoint,
    "anno",
    labelFontColor,
    labelFontSize,
    labelBackgroundColor,
    labelBackgroundOpacity
  );
}

// Function that updates x, y coordinates in viewer element space
function updateViewerElementCoordinates(canvas, viewportPoint) {
  const viewportWidth = viewer.viewport.containerSize.x;
  const viewportHeight = viewer.viewport.containerSize.y;
  canvas.width = viewportWidth;
  canvas.height = viewportHeight;
  if (viewportPoint) {
    const viewerElementPoint =
      viewer.viewport.viewportToViewerElementCoordinates(viewportPoint);
    return viewerElementPoint;
  }
}

// Update previously draw lines
viewer.addHandler("viewport-change", () => {
  drawShape(polyCanvas, [annoJSONTemp, annoJSON]);
  drawShape(circleCanvas, [circleJSON]);
  drawShape(measureCanvas, [measureJSONTemp, measureAreaJSONTemp, measureJSON]);
  drawScaleWizardOverlay();
});

// TOOD: Is this necessary? Could be partially redundant with the above function
viewerContainer.addEventListener("mousemove", () => {
  drawShape(polyCanvas, [annoJSONTemp, annoJSON]);
  drawShape(circleCanvas, [circleJSON]);
  drawShape(measureCanvas, [measureJSONTemp, measureAreaJSONTemp, measureJSON]);
  drawScaleWizardOverlay();
});

// Event listener for double-click to edit existing vertices or end collection
viewer.addHandler("canvas-double-click", function (event) {
  if (suppressNextAnnotationDoubleClick) {
    suppressNextAnnotationDoubleClick = false;
    event.preventDefaultAction = true;
    return;
  }

  if (activeVertexEditUuid && !isAnnotationDraftActive()) {
    if (insertAnnotationVertexAtViewerPoint(activeVertexEditUuid, event.position)) {
      event.preventDefaultAction = true;
      suppressAnnotationClickBriefly();
      return;
    }
  }

  if (!isAnnotationDraftActive()) {
    const uuid = findAnnotationUuidAtViewerPoint(event.position, {
      lineTolerance: 14,
    });
    const feature = getAnnotationByUuid(uuid);
    if (isShapeEditableAnnotation(feature)) {
      event.preventDefaultAction = true;
      selectAnnotationByUuid(uuid, { pan: false });
      enterAnnotationShapeEditMode(uuid);
      suppressAnnotationClickBriefly();
      return;
    }
    if (isVertexEditableAnnotation(feature)) {
      event.preventDefaultAction = true;
      selectAnnotationByUuid(uuid, { pan: false });
      enterAnnotationVertexEditMode(uuid);
      suppressAnnotationClickBriefly();
      return;
    }
  }

  if (isPolylineMode) {
    // Double-click detected, stop collecting points
    const viewportPoint = viewer.viewport.pointFromPixel(event.position);
    const x = viewportPoint.x;
    const y = viewportPoint.y;

    clickCoordinates.push({ x, y });

    // Reset the coordinates array
    clickCoordinates = [];
  }
});

// Testing new function
function drawShape(canvas, JSONArray) {
  // Update canvas size dynamically
  const viewerContainer = viewer.container;
  canvas.width = viewerContainer.clientWidth;
  canvas.height = viewerContainer.clientHeight;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear the canvas

  const image = viewer.world.getItemAt(0); // Get image to use for drawing

  // Flatten the geoJSON array into a single array of features
  const allFeatures = JSONArray.flatMap((geoJSON) => geoJSON.features);

  allFeatures.forEach((feature) => {
    // Only process features that have geometry and properties
    if (feature.geometry && feature.properties) {
      if (!isAnnotationFeatureVisible(feature)) return;
      const coordinates = feature.geometry.coordinates;
      const type = feature.geometry.type;

      if (type === "Polygon") {
        drawPolygon(ctx, coordinates, image, feature);
      } else if (type === "MultiPolygon") {
        coordinates.forEach((polygon) => {
          drawPolygon(ctx, [polygon], image, feature);
        });
      } else if (type === "LineString") {
        drawLineString(ctx, coordinates, image, feature);
      } else if (type === "MultiLineString") {
        coordinates.forEach((line) => {
          drawLineString(ctx, line, image, feature);
        });
      }
    }
  });
}

function drawPolygon(ctx, coordinates, image, feature) {
  // Begin a new path for the entire polygon (outer ring + holes)
  ctx.beginPath();
  coordinates.forEach((ring, index) => {
    const isOuterBoundary = index === 0;
    drawPath(ctx, ring, image, feature, isOuterBoundary);
  });

  // Use "evenodd" fill rule to create the donut effect
  if (
    feature.properties.hasOwnProperty("fillColor") &&
    feature.properties.hasOwnProperty("fillOpacity")
  ) {
    const fillColorToPlot = applyOpacityToColor(
      feature.properties.fillColor,
      feature.properties.fillOpacity
    );
    ctx.fillStyle = fillColorToPlot;
    ctx.fill("evenodd");
  } else {
    // Apply current annotation style
    const fillColor = document.getElementById("fillColor").value;
    const fillOpacity = getAnnotationOpacityValue("fillOpacity");
    const fillColorToPlot = applyOpacityToColor(fillColor, fillOpacity);
    ctx.fillStyle = fillColorToPlot;
    ctx.fill("evenodd");
  }

  // Stroke the outline of the polygon
  if (feature.properties.lineColor && feature.properties.lineOpacity) {
    const lineColorToPlot = applyOpacityToColor(
      feature.properties.lineColor,
      feature.properties.lineOpacity
    );
    ctx.strokeStyle = lineColorToPlot;
  } else {
    // Apply current annotation style
    const lineColor = document.getElementById("lineColor").value;
    const lineOpacity = getAnnotationOpacityValue("lineOpacity");
    const lineColorToPlot = applyOpacityToColor(lineColor, lineOpacity);
    ctx.strokeStyle = lineColorToPlot;
  }
  if (feature.properties.lineWeight) {
    ctx.lineWidth = feature.properties.lineWeight;
  } else {
    const lineWeight = Number(document.getElementById("lineWeight").value);
    ctx.lineWidth = lineWeight;
  }
  // Set line style
  if (feature.properties.lineStyle) {
    // Apply line styles
    if (feature.properties.lineStyle === "dashed") {
      ctx.setLineDash([4, 2]);
    } else if (feature.properties.lineStyle === "dotted") {
      ctx.setLineDash([2, 2]);
    } else {
      ctx.setLineDash([]); // Reset to solid line
    }
  } else {
    // Apply current annotation style
    const lineStyle = document.getElementById("lineStyle").value;
    // Apply line styles
    if (lineStyle === "dashed") {
      ctx.setLineDash([4, 2]);
    } else if (lineStyle === "dotted") {
      ctx.setLineDash([2, 2]);
    } else {
      ctx.setLineDash([]); // Reset to solid line
    }
  }
  ctx.stroke();

  if (selectedAnnotationUuids.has(feature.properties.uuid)) {
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(255, 204, 0, 0.95)";
    ctx.lineWidth = Math.max(Number(ctx.lineWidth) + 4, 6);
    ctx.stroke();
    ctx.restore();
  }
}

function drawLineString(ctx, coordinates, image, feature) {
  ctx.beginPath();
  drawPath(ctx, coordinates, image, feature, false); // 'false' for open paths (LineString)
}

function drawPath(ctx, coordinates, image, shape, closePath) {
  if (coordinates.length < 2) {
    return; // Skip paths with less than 2 points
  }

  const startingViewportPoint = image.imageToViewportCoordinates(
    coordinates[0][0],
    coordinates[0][1]
  );
  const startingViewerElementPoint =
    viewer.viewport.viewportToViewerElementCoordinates(startingViewportPoint);
  ctx.moveTo(startingViewerElementPoint.x, startingViewerElementPoint.y);

  for (let i = 1; i < coordinates.length; i++) {
    const nextViewportPoint = image.imageToViewportCoordinates(
      coordinates[i][0],
      coordinates[i][1]
    );
    const nextViewerElementPoint =
      viewer.viewport.viewportToViewerElementCoordinates(nextViewportPoint);
    ctx.lineTo(nextViewerElementPoint.x, nextViewerElementPoint.y);
  }

  if (closePath) {
    ctx.closePath(); // Close the shape for polygons
  }

  // Set line color
  if (shape.properties.lineColor && shape.properties.lineOpacity) {
    const lineColorToPlot = applyOpacityToColor(
      shape.properties.lineColor,
      shape.properties.lineOpacity
    );
    ctx.strokeStyle = lineColorToPlot;
  } else {
    // Apply current annotation style
    const lineColor = document.getElementById("lineColor").value;
    const lineOpacity = getAnnotationOpacityValue("lineOpacity");
    const lineColorToPlot = applyOpacityToColor(lineColor, lineOpacity);
    ctx.strokeStyle = lineColorToPlot;
  }
  // Set line weight
  if (shape.properties.lineWeight) {
    ctx.lineWidth = shape.properties.lineWeight;
  } else {
    const lineWeight = Number(document.getElementById("lineWeight").value);
    ctx.lineWidth = lineWeight;
  }
  // Set line style
  if (shape.properties.lineStyle) {
    // Apply line styles
    if (shape.properties.lineStyle === "dashed") {
      ctx.setLineDash([4, 2]);
    } else if (shape.properties.lineStyle === "dotted") {
      ctx.setLineDash([2, 2]);
    } else {
      ctx.setLineDash([]); // Reset to solid line
    }
  } else {
    // Apply current annotation style
    const lineStyle = document.getElementById("lineStyle").value;
    // Apply line styles
    if (lineStyle === "dashed") {
      ctx.setLineDash([4, 2]);
    } else if (lineStyle === "dotted") {
      ctx.setLineDash([2, 2]);
    } else {
      ctx.setLineDash([]); // Reset to solid line
    }
  }
  ctx.stroke();

  if (selectedAnnotationUuids.has(shape.properties.uuid)) {
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(255, 204, 0, 0.95)";
    ctx.lineWidth = Math.max(Number(ctx.lineWidth) + 4, 6);
    ctx.stroke();
    ctx.restore();
  }
}

let startPoint = null;
let startPixel;
let startPointImage = null;
let overlayElement = null;
let currentRectUniqueId;
let currentRectStyleColors = null;
let isDrawingRectangle = false;
let annotationMarqueeState = null;

function isRectangleDrawGesture(event) {
  return isRectangleMode || event.originalEvent?.altKey;
}

function getImageMarqueePolygon(startPixel, endPixel) {
  const image = viewer.world.getItemAt(0);
  if (!image) return null;

  const left = Math.min(startPixel.x, endPixel.x);
  const top = Math.min(startPixel.y, endPixel.y);
  const right = Math.max(startPixel.x, endPixel.x);
  const bottom = Math.max(startPixel.y, endPixel.y);

  const corners = [
    new OpenSeadragon.Point(left, top),
    new OpenSeadragon.Point(right, top),
    new OpenSeadragon.Point(right, bottom),
    new OpenSeadragon.Point(left, bottom),
  ].map((pixelPoint) => {
    const viewportPoint = viewer.viewport.pointFromPixel(pixelPoint);
    const imagePoint = image.viewportToImageCoordinates(viewportPoint);
    return [imagePoint.x, imagePoint.y];
  });

  corners.push(corners[0]);
  return corners;
}

function updateAnnotationMarquee(startPixel, endPixel) {
  if (!annotationMarquee) return;

  const left = Math.min(startPixel.x, endPixel.x);
  const top = Math.min(startPixel.y, endPixel.y);
  const width = Math.abs(endPixel.x - startPixel.x);
  const height = Math.abs(endPixel.y - startPixel.y);

  annotationMarquee.hidden = false;
  annotationMarquee.style.left = `${left}px`;
  annotationMarquee.style.top = `${top}px`;
  annotationMarquee.style.width = `${width}px`;
  annotationMarquee.style.height = `${height}px`;
}

function hideAnnotationMarquee() {
  if (annotationMarquee) {
    annotationMarquee.hidden = true;
  }
  annotationMarqueeState = null;
}

function toggleAnnotationsInMarquee(marqueePolygon) {
  const touchedUuids = annoJSON.features
    .filter((feature) =>
      !isAnnotationFeatureLocked(feature) &&
      annotationFeatureIntersectsMarquee(feature, marqueePolygon)
    )
    .map((feature) => feature.properties.uuid);

  if (touchedUuids.length === 0) return;

  const nextSelection = new Set(selectedAnnotationUuids);
  touchedUuids.forEach((uuid) => {
    if (nextSelection.has(uuid)) {
      nextSelection.delete(uuid);
    } else {
      nextSelection.add(uuid);
    }
  });

  const primaryUuid = touchedUuids[touchedUuids.length - 1];
  annotationListSelectionAnchorUuid = primaryUuid;
  setAnnotationSelection([...nextSelection], primaryUuid, {
    pan: false,
    scroll: false,
  });
}

viewer.addHandler("canvas-drag", function (event) {
  if (snapshotModeActive) {
    event.preventDefaultAction = true;
    const delta = event.delta || new OpenSeadragon.Point(0, 0);
    if (!snapshotDragState) {
      snapshotDragState = {
        startPixel: new OpenSeadragon.Point(
          event.position.x - delta.x,
          event.position.y - delta.y
        ),
      };
    }
    updateSnapshotSelection(snapshotDragState.startPixel, event.position);
    return;
  }

  if (isAnnotationMoveMode) {
    const imagePoint = getImagePointFromViewerPixel(event.position);
    if (annotationMoveDragState) {
      event.preventDefaultAction = true;
      moveSelectedAnnotationsToImagePoint(imagePoint);
      return;
    }
    if (startAnnotationMoveDrag(event)) {
      event.preventDefaultAction = true;
      return;
    }
  }

  if (event.originalEvent.shiftKey && !isAnnotationDrawingActive()) {
    event.preventDefaultAction = true;
    suppressAnnotationClickBriefly();

    if (!annotationMarqueeState) {
      annotationMarqueeState = {
        startPixel: event.position,
      };
    }

    updateAnnotationMarquee(annotationMarqueeState.startPixel, event.position);
    return;
  }

  if (isRectangleDrawGesture(event)) {
    event.preventDefaultAction = true; // Prevent default behavior (like panning)
    isDrawingRectangle = true;

    const canvasPoint = event.position;
    const viewportPoint = viewer.viewport.pointFromPixel(event.position);

    const labelFontSize = Number(
      document.getElementById("annoLabelFontSize").value
    );
    currentRectStyleColors = getCurrentAnnotationStyleColors(
      currentRectStyleColors
    );
    const labelFontColor = currentRectStyleColors.labelFontColor;
    const labelBackgroundColor = currentRectStyleColors.labelBackgroundColor;
    const labelBackgroundOpacity = getAnnotationOpacityValue(
      "annoLabelBackgroundOpacity"
    );
    const lineWeight = Number(document.getElementById("lineWeight").value);
    const lineColor = currentRectStyleColors.lineColor;
    const lineStyle = document.getElementById("lineStyle").value;
    const lineOpacity = getAnnotationOpacityValue("lineOpacity");
    const fillColor = currentRectStyleColors.fillColor;
    const fillOpacity = getAnnotationOpacityValue("fillOpacity");

    if (!startPoint) {
      // Mouse down - initialize start point and overlay
      startPoint = viewportPoint;
      startPixel = canvasPoint;
      // startPointImage = image.viewportToImageCoordinates(
      //   startPoint.x,
      //   startPoint.y
      // );
      currentRectUniqueId = generateUniqueId(8);
    } else {
      // Clear to avoid duplicating lines
      annoJSONTemp = {
        type: "FeatureCollection",
        features: [],
      };

      const left = Math.min(startPixel.x, canvasPoint.x);
      const top = Math.min(startPixel.y, canvasPoint.y);
      const right = Math.max(startPixel.x, canvasPoint.x);
      const bottom = Math.max(startPixel.y, canvasPoint.y);

      const topLeftVP = viewer.viewport.pointFromPixel(
        new OpenSeadragon.Point(left, top)
      );
      const topRightVP = viewer.viewport.pointFromPixel(
        new OpenSeadragon.Point(right, top)
      );
      const bottomRightVP = viewer.viewport.pointFromPixel(
        new OpenSeadragon.Point(right, bottom)
      );
      const bottomLeftVP = viewer.viewport.pointFromPixel(
        new OpenSeadragon.Point(left, bottom)
      );

      // 4. Convert to image coordinates if needed
      const image = viewer.world.getItemAt(0);
      const topLeft = image.viewportToImageCoordinates(topLeftVP);
      const topRight = image.viewportToImageCoordinates(topRightVP);
      const bottomRight = image.viewportToImageCoordinates(bottomRightVP);
      const bottomLeft = image.viewportToImageCoordinates(bottomLeftVP);

      const rectCoordinates = [
        [topLeft.x, topLeft.y],
        [topRight.x, topRight.y],
        [bottomRight.x, bottomRight.y],
        [bottomLeft.x, bottomLeft.y],
        [topLeft.x, topLeft.y], // close polygon
      ];

      // const rectCoordinates = [
      //   [startPointImage.x, startPointImage.y],
      //   [startPointImage.x, imagePoint.y],
      //   [imagePoint.x, imagePoint.y],
      //   [imagePoint.x, startPointImage.y],
      //   [startPointImage.x, startPointImage.y],
      // ];

      addPolygonToGeoJSON(annoJSONTemp, rectCoordinates, {
        uuid: currentRectUniqueId,
        labelFontSize: labelFontSize,
        labelFontColor: labelFontColor,
        labelBackgroundColor: labelBackgroundColor,
        labelBackgroundOpacity: labelBackgroundOpacity,
        lineStyle: lineStyle,
        lineWeight: lineWeight,
        lineColor: lineColor,
        lineOpacity: lineOpacity,
        fillColor: fillColor,
        fillOpacity: fillOpacity,
      });
      drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
    }
  }
});

// Finalize the rectangle on mouseup
viewer.addHandler("canvas-release", function (event) {
  if (snapshotModeActive) {
    event.preventDefaultAction = true;
    finishSnapshotSelection(event.position);
    return;
  }

  if (finishAnnotationMoveDrag()) {
    event.preventDefaultAction = true;
    return;
  }

  if (annotationMarqueeState) {
    event.preventDefaultAction = true;
    suppressAnnotationClickBriefly();
    const marqueePolygon = getImageMarqueePolygon(
      annotationMarqueeState.startPixel,
      event.position
    );
    if (marqueePolygon) {
      toggleAnnotationsInMarquee(marqueePolygon);
    }
    hideAnnotationMarquee();
    return;
  }

  if (isDrawingRectangle && startPoint) {
    // Capture the final rectangle's coordinates and size
    const image = viewer.world.getItemAt(0);
    const imageSize = image.getContentSize();

    const left = Math.min(startPixel.x, event.position.x);
    const top = Math.min(startPixel.y, event.position.y);
    const right = Math.max(startPixel.x, event.position.x);
    const bottom = Math.max(startPixel.y, event.position.y);

    const topLeftVP = viewer.viewport.pointFromPixel(
      new OpenSeadragon.Point(left, top)
    );
    const topRightVP = viewer.viewport.pointFromPixel(
      new OpenSeadragon.Point(right, top)
    );
    const bottomRightVP = viewer.viewport.pointFromPixel(
      new OpenSeadragon.Point(right, bottom)
    );
    const bottomLeftVP = viewer.viewport.pointFromPixel(
      new OpenSeadragon.Point(left, bottom)
    );

    // 4. Convert to image coordinates if needed
    const topLeft = image.viewportToImageCoordinates(topLeftVP);
    const topRight = image.viewportToImageCoordinates(topRightVP);
    const bottomRight = image.viewportToImageCoordinates(bottomRightVP);
    const bottomLeft = image.viewportToImageCoordinates(bottomLeftVP);

    const rectCoordinates = [
      [topLeft.x, topLeft.y],
      [topRight.x, topRight.y],
      [bottomRight.x, bottomRight.y],
      [bottomLeft.x, bottomLeft.y],
      [topLeft.x, topLeft.y], // close polygon
    ];

    // Convert drag endpoints into image coords
    const endPoint = viewer.viewport.pointFromPixel(event.position);
    const imageStartPoint = image.viewportToImageCoordinates(
      startPoint.x,
      startPoint.y
    ); // Get image coordinates
    const imageEndPoint = image.viewportToImageCoordinates(
      endPoint.x,
      endPoint.y
    );

    const width = imageEndPoint.x - imageStartPoint.x;
    const height = imageEndPoint.y - imageStartPoint.y;

    // Normalize the coordinates so the top-left is always the starting point
    const x = Math.min(imageStartPoint.x, imageStartPoint.x + width);
    const y = Math.min(imageStartPoint.y, imageStartPoint.y + height);
    // const finalPoint = image.imageToViewportCoordinates(x, y);
    // var finalPoint = viewer.viewport.imageToViewportCoordinates(x, y);
    // const finalWidth = Math.abs(width);
    // const finalHeight = Math.abs(height);

    // Get a uniqueID to store
    // const uniqueID = generateUniqueId(8);

    // Get the plotting options
    const labelFontSize = Number(
      document.getElementById("annoLabelFontSize").value
    );
    currentRectStyleColors = getCurrentAnnotationStyleColors(
      currentRectStyleColors
    );
    const labelFontColor = currentRectStyleColors.labelFontColor;
    const labelBackgroundColor = currentRectStyleColors.labelBackgroundColor;
    const labelBackgroundOpacity = getAnnotationOpacityValue("annoLabelBackgroundOpacity");
    const lineWeight = Number(document.getElementById("lineWeight").value);
    const lineColor = currentRectStyleColors.lineColor;
    const lineStyle = document.getElementById("lineStyle").value;
    const lineOpacity = getAnnotationOpacityValue("lineOpacity");
    const fillColor = currentRectStyleColors.fillColor;
    const fillOpacity = getAnnotationOpacityValue("fillOpacity");

    drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
    resolveNewAnnotationLabel((constRectLabel) => {
      finalizeRectAnnotationWithCoords(
        rectCoordinates,
        title(),
        currentRectUniqueId,
        constRectLabel,
        imageSize,
        labelFontSize,
        labelFontColor,
        labelBackgroundColor,
        labelBackgroundOpacity,
        lineStyle,
        lineWeight,
        lineColor,
        lineOpacity,
        fillColor,
        fillOpacity
      );
      annoJSONTemp = {
        type: "FeatureCollection",
        features: [],
      };
      drawShape(polyCanvas, [annoJSON]);
    });
  }
  enableAnnoButtons();
  window.appState.hasUnsavedAnnotations = true; // TODO: Turn off button between each annotation???
  if (!rectButton.classList.contains("active")) {
    toggleRectFloaterOn(false);
  }
  isDrawingRectangle = false;
});

function finalizeRectAnnotationWithCoords(
  coordinates, // array of 5 [x,y] points, top-left first, closed loop
  sampleName,
  currentRectUniqueId,
  constRectLabel,
  imageSize,
  labelFontSize,
  labelFontColor,
  labelBackgroundColor,
  labelBackgroundOpacity,
  lineStyle,
  lineWeight,
  lineColor,
  lineOpacity,
  fillColor,
  fillOpacity
) {
  const image = viewer.world.getItemAt(0); // Get image to use for drawing

  // Calculate area and perimeter
  const rectAreaPixels2 = calculatePolygonArea([coordinates]);
  const rectAreaM2 = squareMetersFromSquarePixels(rectAreaPixels2);
  const rectPerimeterPixels = calculatePolygonExteriorPerimeter([coordinates]);
  const rectPerimeterM = metersFromPixels(rectPerimeterPixels);

  // Add the rectangle to geoJSON
  addPolygonToGeoJSON(annoJSON, coordinates, {
    uuid: currentRectUniqueId,
    label: constRectLabel,
    shapeType: "rectangle",
    xLabel: coordinates[0][0], // top-left corner
    yLabel: coordinates[0][1],
    imageTitle: sampleName,
    pixelsPerMeter: pixelsPerMeter(),
    imageWidth: imageSize.x,
    imageHeight: imageSize.y,
    labelFontSize: labelFontSize,
    labelFontColor: labelFontColor,
    labelBackgroundColor: labelBackgroundColor,
    labelBackgroundOpacity: labelBackgroundOpacity,
    lineStyle: lineStyle,
    lineWeight: Number(lineWeight),
    lineColor: lineColor,
    lineOpacity: Number(lineOpacity),
    fillColor: fillColor,
    fillOpacity: fillOpacity,
    area_m2: rectAreaM2,
    perimeter_m: rectPerimeterM,
  });
  drawShape(polyCanvas, [annoJSON]);

  // Reset start point
  startPoint = null;
  overlayElement = null;
  currentRectStyleColors = null;

  // Add label at top-left point
  const finalPoint = image.imageToViewportCoordinates(
    coordinates[0][0],
    coordinates[0][1]
  );
  addText(
    currentRectUniqueId,
    constRectLabel,
    finalPoint,
    "anno",
    labelFontColor,
    labelFontSize,
    labelBackgroundColor,
    labelBackgroundOpacity
  );
}

// Clear annotations & grid
document.getElementById("clearBtn").addEventListener("click", function () {
  showAnnotationClearDialog();
});

// New function to allow rotation of text labels to keep them upright
function addText(
  i,
  label,
  location,
  type = "anno", // Options: "grid", "anno"
  color = "#FFFFFF",
  fontSize = 16,
  backgroundColor = "#000000",
  backgroundOpacity = 0.5
) {
  const labelText = label === undefined || label === null ? "" : String(label);
  if (type === "anno" && labelText.trim() === "") {
    unsavedAnnotations(true);
    updateRepeatButton();
    syncSelectedAnnotationVisuals();
    return;
  }

  let className;
  if (type === "anno") {
    className = "annotate-label";
  } else if (type === "grid") {
    className = "grid-label";
  }

  // Outer container — this is the element OSD will position (do NOT rotate this)
  const container = document.createElement("div");
  container.className = "annotation-overlay"; // optional helper class

  // Inner element — put your actual text here and rotate this to cancel viewer rotation
  const pointLabel = document.createElement("div");
  pointLabel.textContent = labelText;
  pointLabel.className = `${className}`;
  pointLabel.id = `${className}-${i}`;
  if (type === "anno") {
    pointLabel.dataset.annotationUuid = i;
    pointLabel.addEventListener("pointerdown", function (event) {
      handleAnnotationLabelPointerDown(event, i);
    });
    pointLabel.addEventListener("click", function (event) {
      event.stopPropagation();
      if (suppressNextAnnotationClick) {
        suppressNextAnnotationClick = false;
        return;
      }
      selectAnnotationByUuid(i);
    });
  }

  const backgroundColorToPlot = applyOpacityToColor(
    backgroundColor,
    backgroundOpacity
  );

  // CSS custom properties for styling; applied to the inner label
  pointLabel.style.setProperty("--color", color);
  pointLabel.style.setProperty("--font-size", `${fontSize}px`);
  pointLabel.style.setProperty("--background-color", backgroundColorToPlot);

  // Important: make the inner element inline-block so transform-origin behaves
  pointLabel.style.display = "inline-block";
  pointLabel.style.transformOrigin = "top left";
  pointLabel.style.willChange = "transform"; // performance hint

  // assemble and add overlay
  container.appendChild(pointLabel);
  viewer.addOverlay({
    element: container,
    location: location,
    checkResize: false,
    rotationMode: OpenSeadragon.OverlayRotationMode.NO_ROTATION,
  });

  // keep reference to the INNER label so we can rotate it later
  if (type === "anno") {
    annotateLabels.push(pointLabel);
    unsavedAnnotations(true);
    updateRepeatButton();
  }
  syncSelectedAnnotationVisuals();

  updateAnnotationOverlayRotation();
}

// // OG Functions to add annotation test and crosshairs
// function addText(
//   i,
//   label,
//   location,
//   type = "anno", // Options: "grid", "anno"
//   color = "#FFFFFF",
//   fontSize = 16,
//   backgroundColor = "#000000",
//   backgroundOpacity = 0.5
// ) {
//   let className;
//   if (type === "anno") {
//     className = "annotate-label";
//   } else if (type === "grid") {
//     className = "grid-label";
//   }

//   const pointLabel = document.createElement("div");

//   pointLabel.innerHTML = `${label}`;
//   pointLabel.className = `${className}`;
//   // pointLabel.className = "annotate-label";
//   pointLabel.id = `${className}-${i}`;
//   // pointLabel.id = `annotate-label-${i}`;

//   const backgroundColorToPlot = applyOpacityToColor(
//     backgroundColor,
//     backgroundOpacity
//   );

//   // Apply inline styles for customization
//   pointLabel.style.setProperty("--color", color);
//   pointLabel.style.setProperty("--font-size", `${fontSize}px`);
//   pointLabel.style.setProperty("--background-color", backgroundColorToPlot);

//   const overlay = viewer.addOverlay({
//     element: pointLabel,
//     location: location,
//     checkResize: false,
//   });
//   if (type === "anno") {
//     annotateLabels.push(pointLabel);
//     // window.appState.hasUnsavedAnnotations = true;
//     unsavedAnnotations(true);
//     updateRepeatButton();
//   }
// }

// Function to delete the text of an existing annotation label
function deleteText(uuid, type = "anno") {
  // let overlayElement;
  let overlayId;
  if (type === "anno") {
    // overlayElement = document.getElementById(`annotate-label-${uuid}`);
    overlayId = `annotate-label-${uuid}`;
  } else if (type === "grid") {
    // overlayElement = document.getElementById(`grid-label-${uuid}`);
    overlayId = `grid-label-${uuid}`;
  }

  const overlayElement = document.getElementById(overlayId);

  if (overlayElement) {
    const overlayContainer = overlayElement.closest(".annotation-overlay");
    viewer.removeOverlay(overlayContainer || overlayElement); // Remove the overlay using the element
    if (type === "anno") {
      // TODO: Is this code necessary?
      annotateLabels = annotateLabels.filter(
        (label) => label.id !== `annotate-label-${uuid}`
      ); // Clean up the array
      // window.appState.hasUnsavedAnnotations = true;
      unsavedAnnotations(true);
    }
    // Finally remove the element from DOM
    overlayContainer?.remove();
    overlayElement.remove();
  }
}

// Function to update the text of an existing annotation label
function updateText(
  uuid,
  type = "anno", // Options: "anno", "grid"
  newLabel = undefined,
  color = undefined,
  fontSize = undefined,
  backgroundColor = undefined,
  backgroundOpacity = undefined
) {
  // Find the label element by id
  let pointLabel;
  if (type === "anno") {
    pointLabel = document.getElementById(`annotate-label-${uuid}`);
  } else if (type === "grid") {
    pointLabel = document.getElementById(`grid-label-${uuid}`);
  }

  if (type === "anno" && newLabel !== undefined) {
    const nextLabel = newLabel === null ? "" : String(newLabel);
    if (nextLabel.trim() === "") {
      if (pointLabel) {
        deleteText(uuid, type);
      }
      return;
    }

    if (!pointLabel) {
      const feature = getAnnotationByUuid(uuid);
      const image = viewer.world.getItemAt(0);
      const labelX = Number(feature?.properties?.xLabel);
      const labelY = Number(feature?.properties?.yLabel);
      if (
        feature?.properties &&
        image &&
        Number.isFinite(labelX) &&
        Number.isFinite(labelY)
      ) {
        const labelFontSize = fontSize ?? Number(feature.properties.labelFontSize);
        addText(
          uuid,
          nextLabel,
          image.imageToViewportCoordinates(new OpenSeadragon.Point(labelX, labelY)),
          type,
          color ?? feature.properties.labelFontColor ?? "#FFFFFF",
          Number.isFinite(labelFontSize) ? labelFontSize : 16,
          backgroundColor ?? feature.properties.labelBackgroundColor ?? "#000000",
          backgroundOpacity ?? feature.properties.labelBackgroundOpacity ?? 0.5
        );
      }
      return;
    }
  }

  if (pointLabel) {
    if (newLabel !== undefined && newLabel !== null) {
      pointLabel.textContent = String(newLabel);
    }

    if (type === "anno") {
      // window.appState.hasUnsavedAnnotations = true;
      unsavedAnnotations(true);
    }

    // Update the CSS variables if new values are provided
    if (color !== undefined) {
      const colorToPlot = applyOpacityToColor(color, 1.0);
      pointLabel.style.setProperty("--color", colorToPlot);
    }
    if (fontSize !== undefined) {
      pointLabel.style.setProperty("--font-size", `${fontSize}px`);
    }
    if (backgroundColor !== undefined && backgroundOpacity !== undefined) {
      const backgroundColorToPlot = applyOpacityToColor(
        backgroundColor,
        backgroundOpacity
      );
      pointLabel.style.setProperty("--background-color", backgroundColorToPlot);
    }
  }
}

function addCrosshairs(
  uuid,
  location,
  type = "anno", // Options: "anno", "grid"
  color = "purple",
  lineWeight = 2,
  opacity = 1
) {
  const crosshair = document.createElement("div");
  if (type === "anno") {
    crosshair.className = "annotate-crosshairs"; // Used for css styling
    crosshair.id = `annotate-crosshair-${uuid}`;
    crosshair.dataset.annotationUuid = uuid;
    crosshair.addEventListener("click", function (event) {
      event.stopPropagation();
      selectAnnotationByUuid(uuid);
    });
    crosshair.addEventListener("dblclick", function (event) {
      event.preventDefault();
      event.stopPropagation();
      selectAnnotationByUuid(uuid, { pan: false });
      enterAnnotationShapeEditMode(uuid);
      suppressAnnotationClickBriefly();
    });
  } else if (type === "grid") {
    crosshair.className = "grid-crosshairs"; // Used for css styling
    crosshair.id = `grid-crosshair-${uuid}`;
  }

  // Apply inline styles for customization
  crosshair.style.setProperty("--crosshair-color", color);
  crosshair.style.setProperty(
    "--crosshair-line-weight",
    `${Number(lineWeight)}px`
  );
  crosshair.style.setProperty("--crosshair-opacity", Number(opacity));

  const overlay = viewer.addOverlay({
    element: crosshair,
    location: location,
    checkResize: false,
  });
  if (type === "anno") {
    annotatePoints.push(crosshair);
    // window.appState.hasUnsavedAnnotations = true;
    unsavedAnnotations(true);
    updateRepeatButton();
  }
  syncSelectedAnnotationVisuals();
}

// TOOD: update this function
function updateCrosshair(
  uuid,
  type = "anno",
  newColor,
  newLineWeight,
  newOpacity
) {
  // Find the existing crosshair element by its ID
  let crosshairElement;
  if (type === "anno") {
    crosshairElement = document.getElementById(`annotate-crosshair-${uuid}`);
  } else if (type === "grid") {
    crosshairElement = document.getElementById(`grid-crosshair-${uuid}`);
  }

  if (!crosshairElement) {
    return;
  }

  // Update the CSS variables if new values are provided
  if (newColor !== undefined) {
    crosshairElement.style.setProperty("--crosshair-color", newColor);
  }
  if (newLineWeight !== undefined) {
    crosshairElement.style.setProperty(
      "--crosshair-line-weight",
      `${newLineWeight}px`
    );
  }
  if (newOpacity !== undefined) {
    crosshairElement.style.setProperty("--crosshair-opacity", newOpacity);
  }
}

function deleteCrosshairs(uuid, type = "anno") {
  let overlayElement;
  if (type === "anno") {
    overlayElement = document.getElementById(`annotate-crosshair-${uuid}`);
  } else if (type === "grid") {
    overlayElement = document.getElementById(`grid-crosshair-${uuid}`);
  }
  if (overlayElement) {
    viewer.removeOverlay(overlayElement); // Remove the overlay using the element
    if (type === "anno") {
      annotatePoints = annotatePoints.filter(
        (label) => label.id !== `annotate-crosshair-${uuid}`
      ); // Clean up the array
    }
  }
  if (type === "anno") {
    updateRepeatButton();
  }
}

async function loadAnnotationsFromJSON(file) {
  try {
    const data =
      window.electronAPI?.readLocalJsonFile && isLocalAnnotationJSONPath(file)
        ? await window.electronAPI.readLocalJsonFile(file)
        : await fetchAnnotationJSON(file);

    showAnnotationImportDialog(data, {
      sourceName: getAnnotationFileLabel(file, 0),
    });
    updateRepeatButton();
  } catch (error) {
    console.error("Error loading GeoJSON:", error);
    alert(error.message || "Could not load annotation GeoJSON.");
  }
}

async function fetchAnnotationJSON(file) {
  const response = await fetch(file);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

function isLocalAnnotationJSONPath(file) {
  return typeof file === "string" && !/^[a-z][a-z0-9+.-]*:\/\//i.test(file);
}

function loadCounts(geoJSONData) {
  const geoJSON = parseJSON(geoJSONData);

  const features = geoJSON.features || Object.values(geoJSON); // Supports both formats
  features.forEach((feature) => {
    const geometry = feature.geometry;
    const properties = feature.properties;

    if (!geometry || !properties) {
      // Invalid feature, skipping
      return;
    }

    const { type, coordinates } = geometry;

    if (type !== "Point") {
      // Skipping non-point feature
      return;
    }

    handleCount(coordinates, properties);
  });
  enableCountButtons();
  populateDropdown(); // Repopulate dropdown for filtering
  populateFilterDropdown(); // Repopulate filter dropdown
  applyFormattingAfterCountAll(countJSON, "both");
}

// Helper functions for specific geometry types
function handleCount(coords, properties) {
  const [x, y] = coords;
  if (isNaN(x) || isNaN(y)) {
    return;
  }
  const image = viewer.world.getItemAt(0);
  const viewportPoint = image.imageToViewportCoordinates(
    new OpenSeadragon.Point(x, y)
  );

  const fontColor =
    properties.labelFontColor || document.getElementById("gridLabelFontColor");
  const fontSize =
    properties.labelFontSize || document.getElementById("gridLabelFontSize");
  const fontBackgroundColor =
    properties.labelBackgroundColor ||
    document.getElementById("gridLabelBackgroundColor");
  const fontBackgroundOpacity =
    properties.labelBackgroundOpacity ||
    document.getElementById("gridLabelBackgroundOpacity");

  const crosshairColor =
    properties.lineColor || document.getElementById("gridLineColor");
  const crosshairOpacity =
    properties.lineOpacity || document.getElementById("gridLineOpacity");
  const crosshairLineWeight =
    properties.lineWeight || document.getElementById("gridLineWeight");

  addText(
    properties.uuid,
    properties.label, // This shoud be a number that corresponds to the count number
    viewportPoint,
    "grid",
    fontColor, // Font color
    fontSize, // Font size
    fontBackgroundColor, // Background color
    fontBackgroundOpacity // Background size
  );
  addCrosshairs(
    properties.uuid,
    viewportPoint,
    "grid",
    crosshairColor, // lineColor
    crosshairLineWeight, // lineWeight
    crosshairOpacity // lineOpacity
  );
  saveCountToJSON("Point", coords, properties);
}

// Save the annotation as GeoJSON
function saveCountToJSON(type, coordinates, properties) {
  const geoJSONFeature = {
    type: "Feature",
    geometry: { type, coordinates },
    properties: {
      ...properties,
    },
  };
  countJSON.features.push(geoJSONFeature);
}

function parseJSON(geoJSONData) {
  let geoJSON;

  // Parse the GeoJSON data
  if (typeof geoJSONData === "string") {
    try {
      geoJSON = JSON.parse(geoJSONData);
    } catch (error) {
      console.error("Error parsing GeoJSON:", error);
      return; // Exit if parsing fails
    }
  } else {
    geoJSON = geoJSONData;
  }
  return geoJSON;
}

let pendingAnnotationImport = null;

function getOrCreateAnnotationGroup(groupName) {
  const trimmedName = (groupName || DEFAULT_ANNOTATION_GROUP.groupName).trim();
  const existingGroup = getAnnotationGroups().find(
    (group) => group.groupName.toLowerCase() === trimmedName.toLowerCase()
  );
  if (existingGroup) return existingGroup;

  const groups = getAnnotationGroups();
  return {
    groupId: `group-${generateUniqueId(8)}`,
    groupName: trimmedName,
    groupColor: getAnnotationGroupColor(groups.length),
    groupVisible: true,
    groupLocked: false,
  };
}

function hasExplicitAnnotationGroup(properties = {}) {
  return [
    "groupId",
    "groupName",
    "groupColor",
    "groupVisible",
    "groupLocked",
  ].some((key) => Object.prototype.hasOwnProperty.call(properties, key));
}

function applyAnnotationGroupToProperties(properties, group) {
  return {
    ...properties,
    groupId: group.groupId,
    groupName: group.groupName,
    groupColor: group.groupColor,
    groupVisible: group.groupVisible,
    groupLocked: group.groupLocked,
  };
}

function applyActiveAnnotationGroup(properties = {}) {
  if (hasExplicitAnnotationGroup(properties)) return properties;
  const group = getSelectedGroupFromDropdown();
  return group ? applyAnnotationGroupToProperties(properties, group) : properties;
}

function getPreservedImportGroup(properties = {}, preservedGroups) {
  if (!hasExplicitAnnotationGroup(properties)) return null;

  const groupName =
    properties.groupName ||
    (properties.groupId
      ? `Imported group ${properties.groupId}`
      : DEFAULT_ANNOTATION_GROUP.groupName);
  const key = properties.groupId || groupName.toLowerCase();
  if (preservedGroups.has(key)) return preservedGroups.get(key);

  const existingGroup = getAnnotationGroups().find(
    (group) =>
      (properties.groupId && group.groupId === properties.groupId) ||
      group.groupName.toLowerCase() === groupName.toLowerCase()
  );
  const group =
    existingGroup || {
      groupId: properties.groupId || `group-${generateUniqueId(8)}`,
      groupName,
      groupColor:
        properties.groupColor ||
        getAnnotationGroupColor(getAnnotationGroups().length),
      groupVisible:
        properties.groupVisible === undefined
          ? true
          : Boolean(properties.groupVisible),
      groupLocked:
        properties.groupLocked === undefined
          ? false
          : Boolean(properties.groupLocked),
    };

  preservedGroups.set(key, group);
  return group;
}

function getAnnotationFeaturesFromGeoJSON(geoJSONData) {
  const geoJSON = parseJSON(geoJSONData);
  if (!geoJSON) return [];
  const features = geoJSON.features || Object.values(geoJSON);
  return Array.isArray(features) ? features.filter(Boolean) : [];
}

function annotationImportHasExplicitGroups(features) {
  return features.some((feature) =>
    hasExplicitAnnotationGroup(feature.properties)
  );
}

function getDefaultImportGroupName(sourceName) {
  return (sourceName || "Imported annotations").trim();
}

function showAnnotationImportDialog(geoJSONData, options = {}) {
  const features = getAnnotationFeaturesFromGeoJSON(geoJSONData);
  if (features.length === 0) {
    alert("No annotation features were found in that GeoJSON file.");
    return;
  }

  const sourceName = options.sourceName || "Imported annotations";
  const hasGroups = annotationImportHasExplicitGroups(features);
  pendingAnnotationImport = { geoJSONData, sourceName };

  document.getElementById(
    "annotationImportSource"
  ).textContent = `${features.length} feature${features.length === 1 ? "" : "s"} from ${sourceName}`;

  const groupSelect = document.getElementById("annotationImportGroupSelect");
  groupSelect.innerHTML = "";
  getAnnotationGroups().forEach((group) => {
    const option = document.createElement("option");
    option.value = group.groupId;
    option.textContent = group.groupName;
    groupSelect.appendChild(option);
  });
  const newOption = document.createElement("option");
  newOption.value = "__new__";
  newOption.textContent = "New group...";
  groupSelect.appendChild(newOption);
  groupSelect.value = DEFAULT_ANNOTATION_GROUP.groupId;

  const assignMode = document.querySelector(
    'input[name="annotationImportMode"][value="assign"]'
  );
  const preserveMode = document.querySelector(
    'input[name="annotationImportMode"][value="preserve"]'
  );
  preserveMode.disabled = !hasGroups;
  preserveMode.checked = hasGroups;
  assignMode.checked = !hasGroups;
  updateAnnotationImportGroupInputs();

  document.getElementById("annotationImportSelectAfter").checked =
    selectImportedAnnotationsPreference;
  document.getElementById("annotationImportDialog").classList.remove(
    "modal-prompt-hidden"
  );
  document
    .getElementById("annotationImportDialog")
    .classList.add("modal-prompt-visible");
}

function hideAnnotationImportDialog() {
  pendingAnnotationImport = null;
  document.getElementById("annotationImportDialog").classList.remove(
    "modal-prompt-visible"
  );
  document
    .getElementById("annotationImportDialog")
    .classList.add("modal-prompt-hidden");
}

function confirmAnnotationImport() {
  if (!pendingAnnotationImport) return;

  const mode =
    document.querySelector('input[name="annotationImportMode"]:checked')
      ?.value || "assign";
  const selectImported = document.getElementById(
    "annotationImportSelectAfter"
  ).checked;
  selectImportedAnnotationsPreference = selectImported;
  const loadOptions = {
    groupMode: "preserve",
    selectImported,
  };

  if (mode === "assign") {
    const groupSelect = document.getElementById("annotationImportGroupSelect");
    const selectedGroupId = groupSelect.value;
    const group =
      selectedGroupId === "__new__"
        ? getOrCreateAnnotationGroup(
            pendingAnnotationImport.newGroupName ||
              getDefaultImportGroupName(pendingAnnotationImport.sourceName)
          )
        : getAnnotationGroups().find(
            (candidate) => candidate.groupId === selectedGroupId
          );
    loadOptions.groupMode = "assign";
    loadOptions.group = group;
  }

  const importData = pendingAnnotationImport.geoJSONData;
  hideAnnotationImportDialog();
  loadAnnotations(importData, loadOptions);
  updateRepeatButton();
}

function promptForAnnotationImportGroupName() {
  if (!pendingAnnotationImport) return;

  showPrompt(
    "Enter the group name:",
    (value) => {
      const groupName =
        value.trim() ||
        getDefaultImportGroupName(pendingAnnotationImport.sourceName);
      pendingAnnotationImport.newGroupName = groupName;
      const groupSelect = document.getElementById("annotationImportGroupSelect");
      const newGroupOption = groupSelect.querySelector('option[value="__new__"]');
      if (newGroupOption) {
        newGroupOption.textContent = `New group: ${groupName}`;
      }
      groupSelect.value = "__new__";
      document.querySelector(
        'input[name="annotationImportMode"][value="assign"]'
      ).checked = true;
      updateAnnotationImportGroupInputs();
      document
        .getElementById("annotationImportDialog")
        .classList.remove("modal-prompt-hidden");
      document
        .getElementById("annotationImportDialog")
        .classList.add("modal-prompt-visible");
    },
    getDefaultImportGroupName(pendingAnnotationImport.sourceName)
  );
}

function updateAnnotationImportGroupInputs() {
  const mode =
    document.querySelector('input[name="annotationImportMode"]:checked')
      ?.value || "assign";
  const isNewGroup =
    document.getElementById("annotationImportGroupSelect").value === "__new__";
  document.getElementById("annotationImportGroupSelect").disabled =
    mode !== "assign";
  if (mode === "assign" && isNewGroup && pendingAnnotationImport?.newGroupName) {
    document.getElementById("annotationImportGroupSelect").title =
      pendingAnnotationImport.newGroupName;
  } else {
    document.getElementById("annotationImportGroupSelect").title = "";
  }
}

// New loadAnnotations() for testing
function loadAnnotations(geoJSONData, options = {}) {
  const features = getAnnotationFeaturesFromGeoJSON(geoJSONData);
  const assignedGroup =
    options.groupMode === "assign" && options.group
      ? options.group
      : null;
  const preservedImportGroups = new Map();
  const existingUuids = new Set(
    annoJSON.features.map((feature) => feature.properties.uuid)
  );
  const addedUuids = [];
  annotationHistory.push("Import annotations");
  annotationHistoryPaused = true;
  try {
    features.forEach((feature) => {
      if (!feature) return;

      const geometry = feature.geometry;
      const sourceProperties = feature.properties || {};
      const preservedGroup = assignedGroup
        ? null
        : getPreservedImportGroup(sourceProperties, preservedImportGroups);
      const properties = normalizeAnnotationProperties(
        assignedGroup
          ? applyAnnotationGroupToProperties(sourceProperties, assignedGroup)
          : preservedGroup
            ? applyAnnotationGroupToProperties(sourceProperties, preservedGroup)
          : sourceProperties
      );
      if (!geometry || !properties) {
        // Invalid feature, skipping
        return;
      }

      // Skip duplicate UUIDs
      if (existingUuids.has(properties.uuid)) {
        // Annotation already exists, skipping
        return;
      }

      const { type, coordinates } = geometry;
      const featureCountBefore = annoJSON.features.length;

      // Handle different geometry types
      if (type === "Point") {
        handlePoint(coordinates, properties);
      } else if (type === "MultiPoint") {
        handleMultiPoint(coordinates, properties);
      } else if (type === "LineString") {
        handleLineString(coordinates, properties);
      } else if (type === "MultiLineString") {
        handleMultiLineString(coordinates, properties);
      } else if (type === "Polygon") {
        handlePolygon(coordinates, properties);
      } else if (type === "MultiPolygon") {
        handleMultiPolygon(coordinates, properties);
      }

      annoJSON.features.slice(featureCountBefore).forEach((addedFeature) => {
        normalizeAnnotationFeature(addedFeature);
        existingUuids.add(addedFeature.properties.uuid);
        addedUuids.push(addedFeature.properties.uuid);
      });

      // Redraw the shapes and enable annotation features
      drawShape(polyCanvas, [annoJSON]);
      enableAnnoButtons();
      annoLabelToText();
    });
    renderAnnotationList();
  if (addedUuids.length > 0 && options.selectImported !== false) {
      setAnnotationSelection(addedUuids, addedUuids[addedUuids.length - 1]);
    } else if (addedUuids.length > 0 && options.selectImported === false) {
      clearAnnotationSelection({ redraw: true, scroll: false });
    } else if (
      annoJSON.features.length > 0 &&
      getAnnotationIndexByUuid(selectedAnnotationUuid) < 0
    ) {
      selectAnnotationByUuid(annoJSON.features[0].properties.uuid);
    }
  } finally {
    annotationHistoryPaused = false;
    updateAnnotationHistoryControls();
  }
}

// Helper functions for specific geometry types
function handlePoint(coords, properties) {
  const [x, y] = coords;
  if (isNaN(x) || isNaN(y)) {
    // Invalid point geometry, skipping
    return;
  }
  const image = viewer.world.getItemAt(0);
  const viewportPoint = image.imageToViewportCoordinates(
    new OpenSeadragon.Point(x, y)
  );
  addText(
    properties.uuid,
    properties.label,
    viewportPoint,
    "anno",
    properties.labelFontColor,
    Number(properties.labelFontSize),
    properties.labelBackgroundColor,
    Number(properties.labelBackgroundOpacity)
  );
  addCrosshairs(
    properties.uuid,
    viewportPoint,
    "anno",
    properties.lineColor,
    Number(properties.lineWeight),
    Number(properties.lineOpacity)
  );
  saveAnnotationToJSON("Point", coords, properties);
}

// Helper functions for specific geometry types
function handleMultiPoint(coords, properties) {
  if (!Array.isArray(coords) || coords.length === 0) {
    // Invalid MultiPoint geometry, skipping
    return;
  }

  const image = viewer.world.getItemAt(0);

  // Loop through each coordinate in the MultiPoint geometry
  let c = 0; // Counter variable
  coords.forEach((pointCoords) => {
    const [x, y] = pointCoords; // Extract x, y from the coordinates array

    const newUUID = `${properties.uuid}-${c}`;
    const newProperties = { ...properties }; // Spread operator to create a shallow copy
    newProperties.uuid = newUUID;
    newProperties.xLabel = x;
    newProperties.yLabel = y;

    c = c + 1;

    if (isNaN(x) || isNaN(y)) {
      // Invalid point geometry, skipping
      return;
    }

    // Convert the point to viewport coordinates
    const viewportPoint = image.imageToViewportCoordinates(
      new OpenSeadragon.Point(x, y)
    );

    // Add text annotation
    addText(
      newUUID,
      properties.label,
      viewportPoint,
      "anno",
      properties.labelFontColor,
      Number(properties.labelFontSize),
      properties.labelBackgroundColor,
      Number(properties.labelBackgroundOpacity)
    );

    // Add crosshairs for the point
    addCrosshairs(
      newUUID,
      viewportPoint,
      "anno",
      properties.lineColor,
      Number(properties.lineWeight),
      Number(properties.lineOpacity)
    );

    // Save annotation data as GeoJSON
    saveAnnotationToJSON("Point", pointCoords, newProperties);
  });
}

// TODO: These functions could be combined a bit
function handleLineString(coords, properties) {
  const image = viewer.world.getItemAt(0);
  const viewportPoint = image.imageToViewportCoordinates(
    new OpenSeadragon.Point(properties.xLabel, properties.yLabel)
  );
  addText(
    properties.uuid,
    properties.label,
    viewportPoint,
    "anno",
    properties.labelFontColor,
    Number(properties.labelFontSize),
    properties.labelBackgroundColor,
    Number(properties.labelBackgroundOpacity)
  );
  saveAnnotationToJSON("LineString", coords, properties);
}

function handleMultiLineString(coords, properties) {
  const image = viewer.world.getItemAt(0);
  const viewportPoint = image.imageToViewportCoordinates(
    new OpenSeadragon.Point(properties.xLabel, properties.yLabel)
  );
  addText(
    properties.uuid,
    properties.label,
    viewportPoint,
    "anno",
    properties.labelFontColor,
    Number(properties.labelFontSize),
    properties.labelBackgroundColor,
    Number(properties.labelBackgroundOpacity)
  );
  saveAnnotationToJSON("MultiLineString", coords, properties);
}

function handlePolygon(coords, properties) {
  const image = viewer.world.getItemAt(0);
  const viewportPoint = image.imageToViewportCoordinates(
    new OpenSeadragon.Point(properties.xLabel, properties.yLabel)
  );
  addText(
    properties.uuid,
    properties.label,
    viewportPoint,
    "anno",
    properties.labelFontColor,
    Number(properties.labelFontSize),
    properties.labelBackgroundColor,
    Number(properties.labelBackgroundOpacity)
  );
  saveAnnotationToJSON("Polygon", coords, properties);
}

function handleMultiPolygon(coords, properties) {
  const image = viewer.world.getItemAt(0);
  const viewportPoint = image.imageToViewportCoordinates(
    new OpenSeadragon.Point(properties.xLabel, properties.yLabel)
  );
  addText(
    properties.uuid,
    properties.label,
    viewportPoint,
    "anno",
    properties.labelFontColor,
    Number(properties.labelFontSize),
    properties.labelBackgroundColor,
    Number(properties.labelBackgroundOpacity)
  );
  saveAnnotationToJSON("MultiPolygon", coords, properties);
}

// Save the annotation as GeoJSON
function saveAnnotationToJSON(type, coordinates, properties) {
  annotationHistory.push("Add annotation");
  const normalizedProperties = normalizeAnnotationProperties(
    applyActiveAnnotationGroup(properties)
  );

  const geoJSONFeature = {
    type: "Feature",
    geometry: { type, coordinates },
    properties: {
      ...normalizedProperties,
      pixelsPerMeter: normalizePixelsPerMeter(normalizedProperties.pixelsPerMeter),
      imageWidth: Number(normalizedProperties.imageWidth),
      imageHeight: Number(normalizedProperties.imageHeight),
      labelFontSize: Number(normalizedProperties.labelFontSize),
      labelBackgroundOpacity: Number(normalizedProperties.labelBackgroundOpacity),
      lineWeight: Number(normalizedProperties.lineWeight),
      lineOpacity: Number(normalizedProperties.lineOpacity),
      fillOpacity: Number(normalizedProperties.fillOpacity),
    },
  };
  annoJSON.features.push(geoJSONFeature);
}

// New loading code
document
  .getElementById("loadAnnotationsBtn")
  .addEventListener("change", function (event) {
    const fileInput = event.target;
    const file = fileInput.files[0];
    if (!file) {
      return;
    }

    if (file) {
      const reader = new FileReader();
      reader.onload = function (event) {
        const geoJSONData = event.target.result;
        showAnnotationImportDialog(geoJSONData, {
          sourceName: file.name.replace(/\.(geo)?json$/i, ""),
        });
        fileInput.value = "";
      };
      reader.readAsText(file);
    } else {
      alert("Please select a GeoJSON file to load annotations.");
    }
  });

document
  .getElementById("annotationImportGroupSelect")
  .addEventListener("change", function () {
    document.querySelector(
      'input[name="annotationImportMode"][value="assign"]'
    ).checked = true;
    if (this.value === "__new__") {
      document.getElementById("annotationImportDialog").classList.remove(
        "modal-prompt-visible"
      );
      document
        .getElementById("annotationImportDialog")
        .classList.add("modal-prompt-hidden");
      promptForAnnotationImportGroupName();
      return;
    }
    updateAnnotationImportGroupInputs();
  });

[...document.getElementsByName("annotationImportMode")].forEach((input) => {
  input.addEventListener("change", updateAnnotationImportGroupInputs);
});

document
  .getElementById("annotationImportConfirmButton")
  .addEventListener("click", confirmAnnotationImport);

document
  .getElementById("annotationImportCancelButton")
  .addEventListener("click", hideAnnotationImportDialog);

function getAnnotationGroupCounts() {
  const counts = new Map();
  annoJSON.features.forEach((feature) => {
    const props = normalizeAnnotationFeature(feature)?.properties;
    if (!props) return;
    counts.set(props.groupId, (counts.get(props.groupId) || 0) + 1);
  });
  return counts;
}

function showAnnotationExportDialog() {
  const groups = getAnnotationGroups();
  const counts = getAnnotationGroupCounts();
  const list = document.getElementById("annotationExportGroupList");
  list.innerHTML = "";

  groups.forEach((group) => {
    const row = document.createElement("label");
    row.className = "annotation-export-group-row";
    row.classList.toggle(
      "annotation-export-group-row-hidden",
      group.groupVisible === false
    );

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "annotation-export-group-checkbox";
    checkbox.value = group.groupId;
    checkbox.checked = true;

    const swatch = document.createElement("span");
    swatch.className = "annotation-export-group-color";
    swatch.style.backgroundColor = group.groupColor;

    const name = document.createElement("span");
    name.className = "annotation-export-group-name";
    name.textContent = group.groupName;

    const count = document.createElement("span");
    count.className = "annotation-export-group-count";
    count.textContent = String(counts.get(group.groupId) || 0);

    row.append(checkbox, swatch, name, count);
    list.appendChild(row);
  });

  const selectedUuids = getSelectedAnnotationUuids();
  const selectionOption = document.querySelector(
    'input[name="annotationExportScope"][value="selection"]'
  );
  selectionOption.disabled = selectedUuids.length === 0;
  selectionOption.parentElement.title =
    selectedUuids.length === 0 ? "No annotations are selected" : "";
  document.querySelector(
    'input[name="annotationExportScope"][value="groups"]'
  ).checked = true;
  document.getElementById("annotationExportIncludeHidden").checked = true;

  document.getElementById("annotationExportDialog").classList.remove(
    "modal-prompt-hidden"
  );
  document
    .getElementById("annotationExportDialog")
    .classList.add("modal-prompt-visible");
}

function hideAnnotationExportDialog() {
  document.getElementById("annotationExportDialog").classList.remove(
    "modal-prompt-visible"
  );
  document
    .getElementById("annotationExportDialog")
    .classList.add("modal-prompt-hidden");
}

function getAnnotationExportFeatures() {
  const scope =
    document.querySelector('input[name="annotationExportScope"]:checked')
      ?.value || "groups";
  const includeHidden = document.getElementById(
    "annotationExportIncludeHidden"
  ).checked;

  if (scope === "selection") {
    const selectedUuids = new Set(getSelectedAnnotationUuids());
    return annoJSON.features.filter((feature) => {
      normalizeAnnotationFeature(feature);
      return (
        selectedUuids.has(feature.properties.uuid) &&
        (includeHidden || isAnnotationFeatureVisible(feature))
      );
    });
  }

  const selectedGroupIds = new Set(
    [...document.getElementsByClassName("annotation-export-group-checkbox")]
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => checkbox.value)
  );
  return annoJSON.features.filter((feature) => {
    normalizeAnnotationFeature(feature);
    return (
      selectedGroupIds.has(feature.properties.groupId) &&
      (includeHidden || isAnnotationFeatureVisible(feature))
    );
  });
}

function exportAnnotations(features) {
  const isFullExport = features.length === annoJSON.features.length;
  const geoJSON = {
    type: "FeatureCollection",
    features: cloneData(features),
  };
  const geoJSONBlob = new Blob([JSON.stringify(geoJSON, null, 2)], {
    type: "application/geo+json",
  });
  saveAs(geoJSONBlob, "annotations.geojson");
  if (isFullExport) {
    unsavedAnnotations(false);
  }
}

function confirmAnnotationExport() {
  const features = getAnnotationExportFeatures();
  if (features.length === 0) {
    alert("No annotations match the export options.");
    return;
  }
  hideAnnotationExportDialog();
  exportAnnotations(features);
}

document
  .getElementById("annotationExportSelectAllButton")
  .addEventListener("click", function () {
    [...document.getElementsByClassName("annotation-export-group-checkbox")].forEach(
      (checkbox) => {
        checkbox.checked = true;
      }
    );
    document.querySelector(
      'input[name="annotationExportScope"][value="groups"]'
    ).checked = true;
  });

document
  .getElementById("annotationExportSelectNoneButton")
  .addEventListener("click", function () {
    [...document.getElementsByClassName("annotation-export-group-checkbox")].forEach(
      (checkbox) => {
        checkbox.checked = false;
      }
    );
    document.querySelector(
      'input[name="annotationExportScope"][value="groups"]'
    ).checked = true;
  });

document
  .getElementById("annotationExportGroupList")
  .addEventListener("change", function (event) {
    if (event.target.classList.contains("annotation-export-group-checkbox")) {
      document.querySelector(
        'input[name="annotationExportScope"][value="groups"]'
      ).checked = true;
    }
  });

document
  .getElementById("annotationExportConfirmButton")
  .addEventListener("click", confirmAnnotationExport);

document
  .getElementById("annotationExportCancelButton")
  .addEventListener("click", hideAnnotationExportDialog);

function createAnnotationGroupChecklistRow(group, count, checkboxClass) {
  const row = document.createElement("label");
  row.className = "annotation-export-group-row";
  row.classList.toggle(
    "annotation-export-group-row-hidden",
    group.groupVisible === false
  );

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = checkboxClass;
  checkbox.value = group.groupId;
  checkbox.checked = true;

  const swatch = document.createElement("span");
  swatch.className = "annotation-export-group-color";
  swatch.style.backgroundColor = group.groupColor;

  const name = document.createElement("span");
  name.className = "annotation-export-group-name";
  name.textContent = group.groupName;

  const countEl = document.createElement("span");
  countEl.className = "annotation-export-group-count";
  countEl.textContent = String(count);

  row.append(checkbox, swatch, name, countEl);
  return row;
}

function showAnnotationClearDialog() {
  const groups = getAnnotationGroups();
  const counts = getAnnotationGroupCounts();
  const list = document.getElementById("annotationClearGroupList");
  list.innerHTML = "";

  groups.forEach((group) => {
    list.appendChild(
      createAnnotationGroupChecklistRow(
        group,
        counts.get(group.groupId) || 0,
        "annotation-clear-group-checkbox"
      )
    );
  });

  const selectedUuids = getSelectedAnnotationUuids();
  const selectionOption = document.querySelector(
    'input[name="annotationClearScope"][value="selection"]'
  );
  selectionOption.disabled = selectedUuids.length === 0;
  selectionOption.parentElement.title =
    selectedUuids.length === 0 ? "No annotations are selected" : "";
  document.querySelector(
    'input[name="annotationClearScope"][value="groups"]'
  ).checked = true;

  document.getElementById("annotationClearDialog").classList.remove(
    "modal-prompt-hidden"
  );
  document
    .getElementById("annotationClearDialog")
    .classList.add("modal-prompt-visible");
}

function hideAnnotationClearDialog() {
  document.getElementById("annotationClearDialog").classList.remove(
    "modal-prompt-visible"
  );
  document
    .getElementById("annotationClearDialog")
    .classList.add("modal-prompt-hidden");
}

function removeAnnotationFeatureOverlays(feature) {
  const uuid = feature?.properties?.uuid;
  if (!uuid) return;
  deleteText(uuid, "anno");
  if (feature.geometry?.type === "Point") {
    deleteCrosshairs(uuid, "anno");
  }
}

function clearAnnotationFeatures(featuresToClear) {
  featuresToClear = featuresToClear.filter(
    (feature) => !isAnnotationFeatureLocked(feature)
  );
  if (featuresToClear.length === 0) return;

  if (
    featuresToClear.length === annoJSON.features.length &&
    annoJSON.features.every((feature) => !isAnnotationFeatureLocked(feature))
  ) {
    clearAnnotations();
    unsavedAnnotations(true);
    disableAnnoButtons();
    return;
  }

  const clearSet = new Set(
    featuresToClear.map((feature) => feature.properties?.uuid).filter(Boolean)
  );
  featuresToClear.forEach(removeAnnotationFeatureOverlays);
  annoJSON.features = annoJSON.features.filter(
    (feature) => !clearSet.has(feature.properties?.uuid)
  );
  clearAnnotationSelection({ redraw: false, scroll: false });
  drawShape(polyCanvas, [annoJSON]);
  renderAnnotationList();
  unsavedAnnotations(true);
}

function getAnnotationClearFeatures() {
  const scope =
    document.querySelector('input[name="annotationClearScope"]:checked')
      ?.value || "groups";

  if (scope === "selection") {
    const selectedUuids = new Set(getSelectedAnnotationUuids());
    return annoJSON.features.filter((feature) =>
      selectedUuids.has(feature.properties?.uuid)
    );
  }

  const selectedGroupIds = new Set(
    [...document.getElementsByClassName("annotation-clear-group-checkbox")]
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => checkbox.value)
  );
  return annoJSON.features.filter((feature) => {
    normalizeAnnotationFeature(feature);
    return selectedGroupIds.has(feature.properties.groupId);
  });
}

function confirmAnnotationClear() {
  const features = getAnnotationClearFeatures();
  if (features.length === 0) {
    alert("No annotations match the clear options.");
    return;
  }
  const unlockedFeatures = features.filter(
    (feature) => !isAnnotationFeatureLocked(feature)
  );
  if (unlockedFeatures.length === 0) {
    alert("The matching annotations are locked.");
    return;
  }

  annotationHistory.push(
    unlockedFeatures.length === annoJSON.features.length
      ? "Clear annotations"
      : "Clear annotation group"
  );
  hideAnnotationClearDialog();
  clearAnnotationFeatures(unlockedFeatures);
}

document
  .getElementById("annotationClearSelectAllButton")
  .addEventListener("click", function () {
    [...document.getElementsByClassName("annotation-clear-group-checkbox")].forEach(
      (checkbox) => {
        checkbox.checked = true;
      }
    );
    document.querySelector(
      'input[name="annotationClearScope"][value="groups"]'
    ).checked = true;
  });

document
  .getElementById("annotationClearSelectNoneButton")
  .addEventListener("click", function () {
    [...document.getElementsByClassName("annotation-clear-group-checkbox")].forEach(
      (checkbox) => {
        checkbox.checked = false;
      }
    );
    document.querySelector(
      'input[name="annotationClearScope"][value="groups"]'
    ).checked = true;
  });

document
  .getElementById("annotationClearGroupList")
  .addEventListener("change", function (event) {
    if (event.target.classList.contains("annotation-clear-group-checkbox")) {
      document.querySelector(
        'input[name="annotationClearScope"][value="groups"]'
      ).checked = true;
    }
  });

document
  .getElementById("annotationClearConfirmButton")
  .addEventListener("click", confirmAnnotationClear);

document
  .getElementById("annotationClearCancelButton")
  .addEventListener("click", hideAnnotationClearDialog);

// Attach export functionality to the button (GeoJSON version)
document.getElementById("exportBtn").addEventListener("click", function () {
  showAnnotationExportDialog();
});

// Attach export functionality to the button (GeoJSON version)
document.getElementById("save-counts").addEventListener("click", function () {
  const geoJSON = countJSON;
  // Create a Blob from the GeoJSON object
  const geoJSONBlob = new Blob([JSON.stringify(geoJSON, null, 2)], {
    type: "application/geo+json",
  });
  // Trigger the download with 'saveAs'
  saveAs(geoJSONBlob, "counts.geojson");
  unsavedCounts(false);
});

const clearAnnotations = () => {
  exitAnnotationVertexEditMode();
  exitAnnotationShapeEditMode();
  const annoIds = Array.from(
    { length: annoJSON.features.length },
    (_, i) => i + 1
  );
  if (annoIds.length === 0) {
    return; // Nothing to remove
  } else {
    for (let i = 0; i < annoIds.length; i++) {
      const type = annoJSON.features[annoIds[i] - 1].geometry.type;
      deleteText(annoJSON.features[annoIds[i] - 1].properties.uuid, "anno");
      if (type === "Point") {
        deleteCrosshairs(
          annoJSON.features[annoIds[i] - 1].properties.uuid,
          "anno"
        );
      }
    }
  }
  const geoJSON = {};
  annoJSON = {
    type: "FeatureCollection",
    features: [],
  };
  annoJSONTemp = {
    type: "FeatureCollection",
    features: [],
  };
  selectedAnnotationUuid = null;
  selectedAnnotationUuids = new Set();
  annotationListSelectionAnchorUuid = null;
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  const annoLabel = document.getElementById("anno-label");
  const annoNotes = document.getElementById("anno-notes");
  annoLabel.value = "";
  annoNotes.value = "";
  syncSelectedAnnotationVisuals();
  renderAnnotationList();
  // window.appState.hasUnsavedAnnotations = false;
  unsavedAnnotations(false);
};

viewerContainer.addEventListener("pointermove", (event) => {
  mousePos = new OpenSeadragon.Point(event.clientX, event.clientY);
  if (enableDivideImages) {
    displayImages();
  }
});

////////////////////////
// Keyboard Shortcuts //
////////////////////////

document.addEventListener("keydown", (event) => {
  const isUndoKey = event.code === "KeyZ" && (event.ctrlKey || event.metaKey);
  const isRedoKey =
    (event.code === "KeyZ" &&
      event.shiftKey &&
      (event.ctrlKey || event.metaKey)) ||
    (event.code === "KeyY" && event.ctrlKey);

  if (!isUndoKey && !isRedoKey) return;

  const tag = event.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  event.preventDefault();
  clearTransientAnnotationShortcutState();
  if (isRedoKey) {
    if (!redoAnnotationDraftPoint()) {
      annotationHistory.redo();
    }
  } else {
    if (!undoAnnotationDraftPoint()) {
      annotationHistory.undo();
    }
  }
});

// Keyboard shortcut handler to toggle checkboxes
const toggleCheckbox = (id) => {
  const checkbox = document.getElementById(id);
  checkbox.click(); // Trigger the onclick handler for each checkbox
};

document.addEventListener("keydown", (event) => {
  if (!event.ctrlKey && !event.altKey) return;
  // Disable shortcuts when typing in input fields
  const tag = event.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  const checkboxes = document.querySelectorAll(".image-checkbox");

  // Handle number keys 1–9
  if (event.code.startsWith("Digit")) {
    const digit = Number(event.code.replace("Digit", ""));
    const index = digit - 1;

    if (digit >= 1 && digit <= 9 && index < checkboxes.length) {
      // If Shift is held, select only that checkbox
      if (event.shiftKey) {
        checkboxes.forEach((cb, i) => {
          cb.checked = i === index;
        });
      }
      // If Alt or Ctrl is held, deselect only that checkbox
      else {
        checkboxes[index].checked = !checkboxes[index].checked;
      }

      displayImages();
      event.preventDefault();
      return;
    }
  }

  // Handle non-numeric shortcuts
  switch (event.code) {
    case "KeyG":
      toggleCheckbox("show-grid");
      event.preventDefault();
      break;

    case "KeyD":
      toggleCheckbox("enableDivideImages");
      event.preventDefault();
      break;

    case "Digit0": // Ctrl+0 to deselect all
      if (event.altKey) {
        checkboxes.forEach((cb) => (cb.checked = false));
        displayImages();
        event.preventDefault();
      }
      break;

    default:
      break;
  }
});

////////////////////////
// Grid functionality //
////////////////////////

const Grid = class {
  // All units are in microns.
  constructor({ xMin, yMin, xMax, yMax, step, noPoints }) {
    this.xMin = xMin;
    this.yMin = yMin;
    this.xMax = xMax;
    this.yMax = yMax;
    this.step = step;
    this.noPoints = noPoints;
  }
};

const MIN_GRID_STEP_MICRONS = 2;
const MIN_GRID_POINTS = 2;
const MAX_GRID_POINTS = 5000;
const MAX_GRID_CANDIDATE_POINTS = 250000;

// Initialize grid with default settings.
let grid = new Grid({
  xMin: 20,
  yMin: 10,
  xMax: 80,
  yMax: 90,
  step: 1000,
  noPoints: 600,
});
let gridApplied = false;

const enableGridButtons = () => {
  document.getElementById("apply-grid-settings").disabled = !hasKnownScale();
  // document.getElementById("restore-grid-settings").disabled = false;
};

// Empty arrays to store points and crosshairs
let gridOverlayPoints = []; ///
let gridOverlayCrosshairs = []; ///

// TODO: Could combine enableGridButtons() and disableGridButtons() into a single function
function enableCountButtons() {
  if (!hasKnownScale()) {
    disableCountButtons();
    return;
  }
  // Enable buttons and input fields
  document.getElementById("count-first").disabled = false;
  document.getElementById("count-prev").disabled = false;
  document.getElementById("count-next").disabled = false;
  document.getElementById("count-last").disabled = false;
  document.getElementById("count-id").disabled = false;
  document.getElementById("count-text").disabled = false;
  document.getElementById("count-notes").disabled = false;
  document.getElementById("count-export").disabled = false;
  document.getElementById("save-counts").disabled = false;
  document.getElementById("count-geojson-input").disabled = false;
  document.getElementById("count-file-input").disabled = false;
  document.getElementById("filterButton").disabled = false;
  document.getElementById("countFilterButton").disabled = false;
  document.getElementById("summarizeButton").disabled = false;
}

function disableCountButtons() {
  // Enable buttons and input fields
  document.getElementById("count-first").disabled = true;
  document.getElementById("count-prev").disabled = true;
  document.getElementById("count-next").disabled = true;
  document.getElementById("count-last").disabled = true;
  document.getElementById("count-id").disabled = true;
  document.getElementById("count-text").disabled = true;
  document.getElementById("count-notes").disabled = true;
  document.getElementById("count-export").disabled = true;
  document.getElementById("save-counts").disabled = true;
  document.getElementById("count-geojson-input").disabled = true;
  document.getElementById("count-file-input").disabled = true;
  document.getElementById("filterButton").disabled = true;
  document.getElementById("countFilterButton").disabled = true;
  document.getElementById("summarizeButton").disabled = true;
}

document
  .getElementById("apply-grid-settings")
  .addEventListener("click", function () {
    const preparedGrid = prepareGridSettings();
    if (!preparedGrid) return;

    annotationHistory.push("Apply grid");
    applyGridSettings(preparedGrid);
  });

function getNumericGridInput(id) {
  return Number(document.getElementById(id).value);
}

function validateGridSettings(nextGrid) {
  if (
    !Number.isFinite(nextGrid.xMin) ||
    !Number.isFinite(nextGrid.yMin) ||
    !Number.isFinite(nextGrid.xMax) ||
    !Number.isFinite(nextGrid.yMax) ||
    nextGrid.xMin >= nextGrid.xMax ||
    nextGrid.yMin >= nextGrid.yMax
  ) {
    return "Choose a valid area of interest before applying the grid.";
  }

  if (
    !Number.isInteger(nextGrid.step) ||
    nextGrid.step < MIN_GRID_STEP_MICRONS
  ) {
    return `Step size must be at least ${MIN_GRID_STEP_MICRONS} micrometers.`;
  }

  if (
    !Number.isInteger(nextGrid.noPoints) ||
    nextGrid.noPoints < MIN_GRID_POINTS ||
    nextGrid.noPoints > MAX_GRID_POINTS
  ) {
    return `Number of points must be between ${MIN_GRID_POINTS} and ${MAX_GRID_POINTS}.`;
  }

  return "";
}

function prepareGridSettings() {
  const image = viewer.world.getItemAt(0);
  if (!image) {
    alert("Load an image before applying the grid.");
    return null;
  }

  const nextGrid = new Grid({
    xMin: getNumericGridInput("grid-left"),
    yMin: getNumericGridInput("grid-top"),
    xMax: getNumericGridInput("grid-right"),
    yMax: getNumericGridInput("grid-bottom"),
    step: Math.trunc(getNumericGridInput("step-size")),
    noPoints: Math.trunc(getNumericGridInput("no-points")),
  });

  const validationMessage = validateGridSettings(nextGrid);
  if (validationMessage) {
    alert(validationMessage);
    return null;
  }

  const imageSize = image.getContentSize();
  const micronsPerPixel = pixelsPerMicron();
  if (!Number.isFinite(micronsPerPixel) || micronsPerPixel <= 0) {
    alert("Set a valid image scale before applying the grid.");
    return null;
  }

  const x_min_um = ((nextGrid.xMin / 100) * imageSize.x) / micronsPerPixel;
  const x_max_um = ((nextGrid.xMax / 100) * imageSize.x) / micronsPerPixel;
  const y_min_um = ((nextGrid.yMin / 100) * imageSize.y) / micronsPerPixel;
  const y_max_um = ((nextGrid.yMax / 100) * imageSize.y) / micronsPerPixel;

  try {
    const points = makePoints(
      x_min_um,
      x_max_um,
      y_min_um,
      y_max_um,
      nextGrid.step,
      nextGrid.noPoints
    );
    return { image, imageSize, grid: nextGrid, points };
  } catch (error) {
    alert(error.message || "Could not create grid points.");
    return null;
  }
}

const applyGridSettings = (preparedGrid) => {
  clearGrid();

  // Enable buttons and input field after settings are applied
  enableCountButtons();

  const { image, imageSize } = preparedGrid;
  grid = preparedGrid.grid;
  const [X, Y, A] = preparedGrid.points;

  for (let i = 0; i < X.length; i++) {
    // Get the coordinates in microns.
    const xMicrons = X[i];
    const yMicrons = Y[i];

    // Convert to coordinates in pixels.
    const xPixels = xMicrons * pixelsPerMicron();
    const yPixels = yMicrons * pixelsPerMicron();

    // Convert to view-space coordinates, measuring from the top-left of the
    // first image.
    const location = image.imageToViewportCoordinates(xPixels, yPixels);

    const labelFontSize = document.getElementById("gridLabelFontSize").value;
    const labelFontColor = document.getElementById("gridLabelFontColor").value;
    const labelBackgroundColor = document.getElementById(
      "gridLabelBackgroundColor"
    ).value;
    const labelBackgroundOpacity = document.getElementById(
      "gridLabelBackgroundOpacity"
    ).value;
    const lineWeight = document.getElementById("gridLineWeight").value;
    const lineColor = document.getElementById("gridLineColor").value;
    const lineOpacity = document.getElementById("gridLineOpacity").value;

    const coords = [xPixels, yPixels];
    const properties = {
      uuid: generateUniqueId(16),
      label: `${A[i]}`,
      id: "",
      notes: "",
      xLabel: xPixels,
      yLabel: yPixels,
      imageTitle: title(),
      pixelsPerMeter: pixelsPerMeter(),
      imageWidth: imageSize.x,
      imageHeight: imageSize.y,
      xMin: parseFloat(document.getElementById("grid-left").value),
      yMin: parseFloat(document.getElementById("grid-top").value),
      xMax: parseFloat(document.getElementById("grid-right").value),
      yMax: parseFloat(document.getElementById("grid-bottom").value),
      step: parseInt(document.getElementById("step-size").value),
      noPoints: parseInt(document.getElementById("no-points").value),
      labelFontSize: labelFontSize,
      labelFontColor: labelFontColor,
      labelBackgroundColor: labelBackgroundColor,
      labelBackgroundOpacity: labelBackgroundOpacity,
      lineWeight: lineWeight,
      lineColor: lineColor,
      lineOpacity: lineOpacity,
    };
    saveCountToJSON("Point", coords, properties);

    // Make text and crosshairs
    addText(
      properties.uuid,
      `${A[i]}`,
      location,
      "grid",
      labelFontColor,
      labelFontSize,
      labelBackgroundColor,
      labelBackgroundOpacity
    );
    addCrosshairs(
      properties.uuid,
      location,
      "grid",
      lineColor,
      lineWeight,
      lineOpacity
    );
  }

  // Always show the grid right after generating it. (The newly added overlay
  // elements will be visible by default, so checking the box here doesn't
  // actually affect them - it just makes the checkbox state consistent with the
  // visibility states.)
  document.getElementById("show-grid").checked = true;
  document.getElementById("apply-grid-settings").disabled = true;
  // document.getElementById("restore-grid-settings").disabled = true;
  document.getElementById("clear-grid").disabled = false;
  gridApplied = true;

  // Update AOI rectangle after grid is applied
  updateAoiRectangle();
};

const clearGrid = () => {
  const gridIds = Array.from(
    { length: countJSON.features.length },
    (_, i) => i + 1
  );
  if (gridIds.length === 0) {
    return; // Nothing to remove
  } else {
    for (let i = 0; i < gridIds.length; i++) {
      const type = countJSON.features[gridIds[i] - 1].geometry.type;
      deleteText(countJSON.features[gridIds[i] - 1].properties.uuid, "grid");
      if (type === "Point") {
        deleteCrosshairs(
          countJSON.features[gridIds[i] - 1].properties.uuid,
          "grid"
        );
      }
    }
  }
  countJSON = {
    type: "FeatureCollection",
    features: [],
  };

  document.getElementById("count-id").innerHTML = 1;
  document.getElementById("count-text").value = "";
  document.getElementById("count-notes").value = "";
  disableCountButtons();
  document.getElementById("apply-grid-settings").disabled = false;
  // document.getElementById("restore-grid-settings").disabled = false;
  document.getElementById("clear-grid").disabled = true;
  enableGridOptions();
};

const clearGridOverlayPoints = () => {
  // Loop through each overlay in the array and remove it from the viewer
  gridOverlayPoints.forEach((_, i) => {
    viewer.removeOverlay(`grid-label-${i}`);
  });

  // Clear the overlayPoints array
  gridOverlayPoints = [];
};

const clearGridOverlayCrosshairs = () => {
  // Loop through each overlay in the array and remove it from the viewer
  gridOverlayCrosshairs.forEach((_, i) => {
    viewer.removeOverlay(`crosshair-${i}`);
  });

  // Clear the overlayPoints array
  gridOverlayCrosshairs = [];
};

document.getElementById("clear-grid").addEventListener("click", function () {
  annotationHistory.push("Clear grid");
  clearGrid();
  unsavedCounts(true);
});

// const restoreGridSettings = () => {
//   document.getElementById("grid-left").value = grid.xMin;
//   document.getElementById("grid-top").value = grid.yMin;
//   document.getElementById("grid-right").value = grid.xMax;
//   document.getElementById("grid-bottom").value = grid.yMax;
//   document.getElementById("step-size").value = grid.step;
//   document.getElementById("no-points").value = grid.noPoints;

//   // Leave the Apply button enabled unless the grid has been generated at least
//   // once.
//   if (gridApplied) {
//     document.getElementById("apply-grid-settings").disabled = true;
//   }
//   document.getElementById("restore-grid-settings").disabled = true;
// };

// // Initialize grid setting elements.
// restoreGridSettings();

const initializeGridSettings = () => {
  document.getElementById("grid-left").value = grid.xMin;
  document.getElementById("grid-top").value = grid.yMin;
  document.getElementById("grid-right").value = grid.xMax;
  document.getElementById("grid-bottom").value = grid.yMax;
  document.getElementById("step-size").value = grid.step;
  document.getElementById("no-points").value = grid.noPoints;
  constrainGridSliders();
};

initializeGridSettings();

// Point counting function (Oct 14, 2024)
function pointMatrix(
  x_min,
  x_max,
  y_min,
  y_max,
  step_size,
  i_ini = 1,
  reverse = false
) {
  // Return x coordinates, y coordinates, and point count labels
  // Units of x and y must be same as step_size
  // i_ini is starting point count ID label (default=1)
  // reverse (bool) indicates whether starting in top left (false) or bottom right (true)
  if (!Number.isFinite(step_size) || step_size <= 0) {
    throw new Error("Step size must be a positive number.");
  }

  // Start at top-left pixel and progress to the bottom-right in snake-like pattern
  let n_y_rows = Math.floor((y_max - y_min) / step_size) + 1;
  let n_x_cols = Math.floor((x_max - x_min) / step_size) + 1;

  if (
    !Number.isFinite(n_y_rows) ||
    !Number.isFinite(n_x_cols) ||
    n_y_rows <= 0 ||
    n_x_cols <= 0
  ) {
    throw new Error("Grid area and step size must produce valid point rows.");
  }

  if (n_y_rows * n_x_cols > MAX_GRID_CANDIDATE_POINTS) {
    throw new Error(
      "Grid step size is too small for this image scale and area. Increase the step size or reduce the area of interest."
    );
  }

  // Make 1D x-axis array that reflects snaking increments from top left to bottom right
  let x_vals = Array.from(
    { length: n_x_cols },
    (_, i) => x_min + i * step_size
  );
  let X = Array(n_y_rows)
    .fill(0)
    .map((_, rowIndex) => {
      let row = [...x_vals];
      return rowIndex % 2 === 0 ? row : row.reverse();
    })
    .flat();

  // Make 1D y-axis values for the same array
  let y_vals = Array.from(
    { length: n_y_rows },
    (_, i) => y_min + i * step_size
  );
  let Y = [].concat(...y_vals.map((y) => Array(n_x_cols).fill(y)));

  // Define 1D array with point count labels
  let A = Array.from({ length: n_y_rows * n_x_cols }, (_, i) => i + i_ini);

  if (reverse) {
    return [X.reverse(), Y.reverse(), A];
  } else {
    return [X, Y, A];
  }
}

function makePoints(x_min, x_max, y_min, y_max, step_size, num_points) {
  if (!Number.isInteger(num_points) || num_points < MIN_GRID_POINTS) {
    throw new Error(
      `Number of points must be at least ${MIN_GRID_POINTS}.`
    );
  }

  let c = 0; // Counter for total number of points logged
  let d = 1.0; // Counter that reflects decreasing step count
  let e = 0; // Counter to control snake pattern direction (normal or reversed)

  let Xs = [];
  let Ys = [];
  let As = [];
  let legend = [];

  while (c < num_points) {
    let reverse = e % 2 !== 0;

    let [X, Y, A] = pointMatrix(
      x_min,
      x_max,
      y_min,
      y_max,
      step_size * d,
      c,
      reverse
    );

    // Remove overlapping points
    let newPoints = X.map((x, i) => [x, Y[i]]);
    let existingPoints = Xs.map((x, i) => [x, Ys[i]]);
    let idxToRemove = newPoints.filter((p) =>
      existingPoints.some((e) => e[0] === p[0] && e[1] === p[1])
    );
    let filteredPoints = newPoints.filter((p) => !idxToRemove.includes(p));

    X = filteredPoints.map((p) => p[0]);
    Y = filteredPoints.map((p) => p[1]);
    A = Array.from({ length: X.length }, (_, i) => i + 1 + c);

    if (X.length === 0) {
      throw new Error("Grid settings could not produce enough unique points.");
    }

    const remainingPoints = num_points - c;
    const pointsToAdd = Math.min(remainingPoints, X.length);
    Xs = [...Xs, ...X.slice(0, pointsToAdd)];
    Ys = [...Ys, ...Y.slice(0, pointsToAdd)];
    As = [...As, ...A.slice(0, pointsToAdd)];
    legend = [...legend, ...Array(pointsToAdd).fill(e + 1)];

    c += pointsToAdd;
    if (c >= num_points) break;

    d /= 2.0;
    e += 1;
  }

  return [Xs, Ys, As];
}

let aoiOverlay = null; // Store the AOI overlay element

// Function to create or update the AOI rectangle
function updateAoiRectangle() {
  const showAoi = document.getElementById("show-aoi").checked;
  if (!showAoi) {
    removeAoiRectangle();
    return;
  }
  const xMin = parseFloat(document.getElementById("grid-left").value);
  const xMax = parseFloat(document.getElementById("grid-right").value);
  const yMin = parseFloat(document.getElementById("grid-top").value);
  const yMax = parseFloat(document.getElementById("grid-bottom").value);

  // Ensure viewer and first image are available
  const image = viewer.world.getItemAt(0);
  if (!image) {
    console.error("No image loaded in OpenSeadragon viewer.");
    return;
  }

  // Convert percentage grid coordinates to image pixel coordinates
  const imageSize = image.getContentSize();
  const xMinPx = (xMin / 100) * imageSize.x;
  const xMaxPx = (xMax / 100) * imageSize.x;
  const yMinPx = (yMin / 100) * imageSize.y;
  const yMaxPx = (yMax / 100) * imageSize.y;

  // Convert pixel coordinates to viewport coordinates
  const topLeft = image.imageToViewportCoordinates(xMinPx, yMinPx);
  const bottomRight = image.imageToViewportCoordinates(xMaxPx, yMaxPx);

  const width = bottomRight.x - topLeft.x;
  const height = bottomRight.y - topLeft.y;

  if (!aoiOverlay) {
    // Create the AOI overlay if it doesn't exist
    const aoiElement = document.createElement("div");
    aoiElement.className = "aoi-rectangle";
    viewer.addOverlay({
      element: aoiElement,
      location: new OpenSeadragon.Rect(topLeft.x, topLeft.y, width, height),
    });
    aoiOverlay = aoiElement;
  } else {
    // Update the existing AOI overlay
    viewer.updateOverlay(
      aoiOverlay,
      new OpenSeadragon.Rect(topLeft.x, topLeft.y, width, height)
    );
  }
}

// Function to remove the AOI rectangle
function removeAoiRectangle() {
  if (aoiOverlay) {
    viewer.removeOverlay(aoiOverlay);
    aoiOverlay = null;
  }
}

// Attach event listeners to the sliders
["grid-left", "grid-right", "grid-top", "grid-bottom"].forEach((id) => {
  document.getElementById(id).addEventListener("input", updateAoiRectangle);
});

// Attach an event listener to the "Show AOI" checkbox
document
  .getElementById("show-aoi")
  .addEventListener("change", updateAoiRectangle);

// Functionality for applying specific formatting for annotations
function applyAllAnnoLabel(idBase) {
  const unlockedUuids = getUnlockedAnnotationUuids();
  if (unlockedUuids.length > 0) {
    annotationHistory.push("Style annotation labels");
  }

  unlockedUuids.forEach((uuid) => applyAnnoLabel(idBase, uuid));
}

// Functionality for applying specific formatting for annotations
function applyAllAnnoFeature(idBase) {
  const unlockedUuids = getUnlockedAnnotationUuids();
  if (unlockedUuids.length > 0) {
    annotationHistory.push("Style annotations");
  }

  unlockedUuids.forEach((uuid) => applyAnnoFeature(idBase, uuid));
}

function applyCurrentAnnoLabel(idBase) {
  const selectedUuids = getUnlockedSelectedAnnotationUuids();
  if (selectedUuids.length === 0) {
    return;
  }
  annotationHistory.push("Style annotation label");
  selectedUuids.forEach((uuid) => applyAnnoLabel(idBase, uuid));
}

function applyCurrentAnnoFeature(idBase) {
  const selectedUuids = getUnlockedSelectedAnnotationUuids();
  if (selectedUuids.length === 0) {
    return;
  }
  annotationHistory.push("Style annotation");
  selectedUuids.forEach((uuid) => applyAnnoFeature(idBase, uuid));
}

function applyAnnoLabel(idBase, uuid) {
  const formattingMap = {
    annoLabelFontSize: "labelFontSize",
    annoLabelFontColor: "labelFontColor",
    annoLabelBackgroundColor: "labelBackgroundColor",
    annoLabelBackgroundOpacity: "labelBackgroundOpacity",
  };

  const feature = annoJSON.features.find((f) => f.properties.uuid === uuid);
  if (!feature || isAnnotationFeatureLocked(feature)) return;
  const props = feature.properties;
  const input = document.getElementById(idBase);
  const value =
    idBase === "annoLabelFontColor" ||
    idBase === "annoLabelBackgroundColor"
      ? getAnnotationColor(idBase)
      : idBase === "annoLabelBackgroundOpacity"
        ? getAnnotationOpacityValue(idBase)
      : input.value;
  feature.properties[formattingMap[idBase]] = value;

  // Apply visual formatting immediately
  if (idBase === "annoLabelFontSize") {
    updateText(
      uuid,
      "anno",
      undefined,
      undefined,
      input.value,
      undefined,
      undefined
    );
  } else if (idBase === "annoLabelFontColor") {
    updateText(
      uuid,
      "anno",
      undefined,
      value,
      undefined,
      undefined,
      undefined
    );
  } else if (idBase === "annoLabelBackgroundColor") {
    // Need both backgroundColor and backgroundOpacity to apply background
    const bgColor = value;
    const bgOpacity = props["labelBackgroundOpacity"];
    if (!bgOpacity) {
      // Background opacity is not set, cannot apply background color.
      return;
    }
    updateText(
      uuid,
      "anno",
      undefined,
      undefined,
      undefined,
      bgColor,
      bgOpacity
    );
  } else if (idBase === "annoLabelBackgroundOpacity") {
    // Need both backgroundColor and backgroundOpacity to apply background
    const bgOpacity = value;
    const bgColor = props["labelBackgroundColor"];
    if (!bgColor) {
      // Background color is not set, cannot apply background opacity.
      return;
    }

    updateText(
      uuid,
      "anno",
      undefined,
      undefined,
      undefined,
      bgColor,
      bgOpacity
    );
  }
}

function applyAnnoFeature(idBase, uuid) {
  const feature = annoJSON.features.find((f) => f.properties.uuid === uuid);
  if (!feature || isAnnotationFeatureLocked(feature)) return;
  const props = feature.properties;
  const input = document.getElementById(idBase);
  props[idBase] =
    idBase === "fillColor" || idBase === "lineColor"
      ? getAnnotationColor(idBase)
      : idBase === "lineOpacity" || idBase === "fillOpacity"
        ? getAnnotationOpacityValue(idBase)
      : input.value;
  if (feature.geometry.type === "Point") {
    // Update crosshair if the feature is a Point
    const lineWeight = props.lineWeight;
    const lineColor = props.lineColor;
    const lineOpacity = props.lineOpacity;
    updateCrosshair(uuid, "anno", lineColor, lineWeight, lineOpacity);
  } else {
    drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  }
}

// Functionality for applying specific formatting for grid attributes
function applyAllGridLabel(idBase) {
  if (countJSON.features.length > 0) {
    annotationHistory.push("Style count labels");
  }

  // Loop through all features in the countJSON
  countJSON.features.forEach((feature) => {
    const props = feature.properties;
    const id = props.label;
    applyGridLabel(idBase, id);
  });
}

function applyAllGridCrosshair(idBase) {
  if (countJSON.features.length > 0) {
    annotationHistory.push("Style count points");
  }

  // Loop through all features in the countJSON
  countJSON.features.forEach((feature) => {
    const props = feature.properties;
    const id = props.label;
    applyGridCrosshair(idBase, id);
  });

  const formattingMap = {
    lineColor: "lineColor",
    gridLabelFontColor: "labelFontColorAfter",
    gridLabelBackgroundColor: "labelBackgroundColorAfter",
    gridLabelBackgroundOpacity: "labelBackgroundOpacityAfter",
  };
}

function applyCurrentGridLabel(idBase) {
  const id = document.getElementById("count-id").value;
  if (countJSON.features[id - 1]) {
    annotationHistory.push("Style count label");
  }
  applyGridLabel(idBase, id);
}

function applyCurrentGridCrosshair(idBase) {
  const id = document.getElementById("count-id").value;
  if (countJSON.features[id - 1]) {
    annotationHistory.push("Style count point");
  }
  applyGridCrosshair(idBase, id);
}

// Functionality for applying specific formatting for grid attributes
function applyGridLabel(idBase, id) {
  if (isNaN(id) || id < 1 || id > countJSON.features.length) {
    // Invalid ID selected.
    return;
  }

  const feature = countJSON.features[id - 1];
  const uuid = feature.properties.uuid;
  const props = feature.properties;

  const useAfter = props.id && props.id.trim() !== "";

  let formattingMap;
  if (useAfter) {
    formattingMap = {
      gridLabelFontSize: "labelFontSizeAfter",
      gridLabelFontColor: "labelFontColorAfter",
      gridLabelBackgroundColor: "labelBackgroundColorAfter",
      gridLabelBackgroundOpacity: "labelBackgroundOpacityAfter",
    };
  } else {
    formattingMap = {
      gridLabelFontSize: "labelFontSize",
      gridLabelFontColor: "labelFontColor",
      gridLabelBackgroundColor: "labelBackgroundColor",
      gridLabelBackgroundOpacity: "labelBackgroundOpacity",
    };
  }

  let input;
  if (useAfter) {
    input = document.getElementById(idBase + "After");
    feature.properties[formattingMap[idBase + "After"]] = input.value;
  } else {
    input = document.getElementById(idBase);
    feature.properties[formattingMap[idBase]] = input.value;
  }

  if (!input) {
    return;
  }

  // Apply visual formatting immediately
  if (idBase === "gridLabelFontSize") {
    updateText(uuid, "grid", undefined, undefined, input.value);
  } else if (idBase === "gridLabelFontColor") {
    updateText(uuid, "grid", undefined, input.value);
  } else if (idBase === "gridLabelBackgroundColor") {
    // Need both backgroundColor and backgroundOpacity to apply background
    const bgColor = input.value;
    let bgOpacity;
    if (useAfter) {
      bgOpacity = props["labelBackgroundOpacityAfter"];
    } else {
      bgOpacity = props["labelBackgroundOpacity"];
    }
    if (!bgOpacity) {
      // Background opacity is not set, cannot apply background color.
      return;
    }

    updateText(
      uuid,
      "grid",
      undefined,
      undefined,
      undefined,
      bgColor,
      bgOpacity
    );
  } else if (idBase === "gridLabelBackgroundOpacity") {
    // Need both backgroundColor and backgroundOpacity to apply background
    const bgOpacity = input.value;
    let bgColor;
    if (useAfter) {
      bgColor = props["labelBackgroundColorAfter"];
    } else {
      bgColor = props["labelBackgroundColor"];
    }
    if (!bgColor) {
      // Background color is not set, cannot apply background opacity.
      return;
    }

    updateText(
      uuid,
      "grid",
      undefined,
      undefined,
      undefined,
      bgColor,
      bgOpacity
    );
  }
}

// Functionality for applying specific formatting for grid attributes
function applyGridCrosshair(idBase, id) {
  if (isNaN(id) || id < 1 || id > countJSON.features.length) {
    return;
  }

  const feature = countJSON.features[id - 1];
  const uuid = feature.properties.uuid;
  const props = feature.properties;

  const useAfter = props.id && props.id.trim() !== "";

  let formattingMap;
  if (useAfter) {
    formattingMap = {
      gridLineWeight: "lineWeightAfter",
      gridLineColor: "lineColorAfter",
      gridLineOpacity: "lineOpacityAfter",
    };
  } else {
    formattingMap = {
      gridLineWeight: "lineWeight",
      gridLineColor: "lineColor",
      gridLineOpacity: "lineOpacity",
    };
  }

  let input;
  if (useAfter) {
    input = document.getElementById(idBase + "After");
    feature.properties[formattingMap[idBase + "After"]] = input.value;
  } else {
    input = document.getElementById(idBase);
    feature.properties[formattingMap[idBase]] = input.value;
  }

  if (!input) {
    return;
  }

  // Apply visual formatting immediately
  if (idBase === "gridLineWeight") {
    updateCrosshair(uuid, "grid", undefined, input.value, undefined);
  } else if (idBase === "gridLineColor") {
    updateCrosshair(uuid, "grid", input.value, undefined, undefined);
  } else if (idBase === "gridLineOpacity") {
    updateCrosshair(uuid, "grid", undefined, undefined, input.value);
  }
}

//////////////////////////////////////////
//// Point counting functionality ////////
//////////////////////////////////////////

function applyFormattingAfterCountAll(countJSON, what = "both") {
  // Loop through all features in the countJSON
  countJSON.features.forEach((feature) => {
    const props = feature.properties;
    const uuid = props.uuid;
    applyFormattingAfterCount(countJSON, uuid, what);
  });
}

function applyFormattingAfterCount(countJSON, uuid, what = "both") {
  const feature = countJSON.features.find((f) => f.properties.uuid === uuid);
  if (!feature) {
    return;
  }

  const props = feature.properties;

  // Mapping of property names to corresponding HTML element IDs
  const formattingMap = {
    labelFontSizeAfter: "gridLabelFontSizeAfter",
    labelFontColorAfter: "gridLabelFontColorAfter",
    labelBackgroundColorAfter: "gridLabelBackgroundColorAfter",
    labelBackgroundOpacityAfter: "gridLabelBackgroundOpacityAfter",
    lineWeightAfter: "gridLineWeightAfter",
    lineColorAfter: "gridLineColorAfter",
    lineOpacityAfter: "gridLineOpacityAfter",
  };

  const useAfter = props.id && props.id.trim() !== "";

  // If useAfter, assign After values if missing
  if (useAfter) {
    for (const [key, htmlId] of Object.entries(formattingMap)) {
      if (!props.hasOwnProperty(key)) {
        const htmlElement = document.getElementById(htmlId);
        if (htmlElement) {
          props[key] = htmlElement.value;
        }
      }
    }
  }

  // Choose appropriate values to use — either After or original
  const labelFontSize = useAfter
    ? props.labelFontSizeAfter
    : props.labelFontSize;
  const labelFontColor = useAfter
    ? props.labelFontColorAfter
    : props.labelFontColor;
  const labelBackgroundColor = useAfter
    ? props.labelBackgroundColorAfter
    : props.labelBackgroundColor;
  const labelBackgroundOpacity = useAfter
    ? props.labelBackgroundOpacityAfter
    : props.labelBackgroundOpacity;
  const lineColor = useAfter ? props.lineColorAfter : props.lineColor;
  const lineWeight = useAfter ? props.lineWeightAfter : props.lineWeight;
  const lineOpacity = useAfter ? props.lineOpacityAfter : props.lineOpacity;

  if (what === "both" || what === "text") {
    updateText(
      uuid,
      "grid",
      props.label,
      labelFontColor,
      labelFontSize,
      labelBackgroundColor,
      labelBackgroundOpacity
    );
  }

  if (what === "both" || what === "point") {
    updateCrosshair(uuid, "grid", lineColor, lineWeight, lineOpacity);
  }
}

document.getElementById("count-first").addEventListener("click", function () {
  const input = document.getElementById("count-id");
  input.value = 1;

  const image = viewer.world.getItemAt(0);
  const imagePoint = countJSON.features[0].geometry.coordinates;
  const viewportPoint = image.imageToViewportCoordinates(
    imagePoint[0],
    imagePoint[1]
  );
  goToPoint(viewportPoint.x, viewportPoint.y);
  inputSampleLabelFromOverlay();
});

document.getElementById("count-prev").addEventListener("click", function () {
  const input = document.getElementById("count-id");
  let value = parseInt(input.value, 10) || 0; // Parse current value or default to 0
  const min = parseInt(input.min, 10);

  if (value > min) {
    input.value = value - 1;
    const image = viewer.world.getItemAt(0);
    const imagePoint = countJSON.features[input.value - 1].geometry.coordinates;
    const viewportPoint = image.imageToViewportCoordinates(
      imagePoint[0],
      imagePoint[1]
    );
    // const overlay = viewer.getOverlayById(`grid-label-${input.value - 1}`);
    goToPoint(viewportPoint.x, viewportPoint.y);
  }
  inputSampleLabelFromOverlay();
});

document.getElementById("count-next").addEventListener("click", function () {
  const input = document.getElementById("count-id");
  let value = parseInt(input.value, 10) || 0; // Parse current value or default to 0
  // const max = parseInt(document.getElementById("no-points").value);
  const max = parseInt(countJSON.features.length);

  if (value < max) {
    input.value = value + 1;
  } else {
    input.value = max;
  }

  const image = viewer.world.getItemAt(0);
  const imagePoint = countJSON.features[input.value - 1].geometry.coordinates;
  const viewportPoint = image.imageToViewportCoordinates(
    imagePoint[0],
    imagePoint[1]
  );
  // const overlay = viewer.getOverlayById(`grid-label-${gridInput.value - 1}`);
  goToPoint(viewportPoint.x, viewportPoint.y);
  inputSampleLabelFromOverlay();
});

document.getElementById("count-last").addEventListener("click", function () {
  const input = document.getElementById("count-id");
  // const noPoints = parseInt(document.getElementById("no-points").value);
  const noPoints = parseInt(countJSON.features.length);
  input.value = noPoints;

  const image = viewer.world.getItemAt(0);
  const imagePoint =
    countJSON.features[parseInt(input.value) - 1].geometry.coordinates;
  const viewportPoint = image.imageToViewportCoordinates(
    imagePoint[0],
    imagePoint[1]
  );
  goToPoint(viewportPoint.x, viewportPoint.y);

  // const overlay = viewer.getOverlayById(`grid-label-${parseInt(noPoints) - 1}`);
  inputSampleLabelFromOverlay();
});

// When you get hit Enter on the count-id field
document.addEventListener("keydown", function (event) {
  // Check for Enter key in count-id field
  const gridInput = document.getElementById("count-id");
  if (event.code === "Enter" && document.activeElement === gridInput) {
    event.preventDefault(); // Prevent any default action for Enter key

    const image = viewer.world.getItemAt(0);
    const imagePoint =
      countJSON.features[parseInt(gridInput.value) - 1].geometry.coordinates;
    const viewportPoint = image.imageToViewportCoordinates(
      imagePoint[0],
      imagePoint[1]
    );
    // const overlay = viewer.getOverlayById(`grid-label-${gridInput.value - 1}`);

    goToPoint(viewportPoint.x, viewportPoint.y);
    inputSampleLabelFromOverlay();
  }
});

// When you hit Enter on the count-notes field
document.addEventListener("keydown", function (event) {
  // Check for Enter key in count-notes field
  const notesInput = document.getElementById("count-notes");
  if (event.code === "Enter" && document.activeElement === notesInput) {
    event.preventDefault(); // Prevent any default action for Enter key
    inputNotesText();
  }
});

// Function to handle keyboard shortcuts
document.addEventListener("keydown", function (event) {
  // Check for Enter key in count-text field
  const textInput = document.getElementById("count-text");
  const id = document.getElementById("count-id");
  // const gridInput = document.getElementById('count-id'); // Placeholder for changing color of crosshairs
  if (event.code === "Enter" && document.activeElement === textInput) {
    event.preventDefault(); // Prevent any default action for Enter key
    inputSampleLabel();
    // updateGridCrosshair(gridInput.value); // Placeholder for changing color of crosshairs
    const uuid = countJSON.features[parseInt(id.value) - 1].properties["uuid"];
    applyFormattingAfterCount(countJSON, uuid, "both");
  }
});

// Shortcuts for going to next (space) or previous (shift+space)
document.addEventListener("keydown", function (event) {
  const textInput = document.getElementById("count-text");
  const activeElement = document.activeElement;
  const allowCountTextShortcut = activeElement === textInput;

  // Check if the space bar is pressed without modifiers
  if (
    event.code === "Space" &&
    (allowCountTextShortcut || !isTextEntryElement(activeElement))
  ) {
    event.preventDefault();
    if (event.shiftKey) {
      const prevButton = document.getElementById("count-prev");
      prevButton.click(); // Simulate a click on the next button
    } else {
      const nextButton = document.getElementById("count-next");
      nextButton.click(); // Simultae a click on the next button
    }
  }
});

// Function to update the count-text input based on the current overlay
function inputSampleLabelFromOverlay() {
  const input = document.getElementById("count-id");
  let value = parseInt(input.value, 10);
  const textInput = document.getElementById("count-text");
  const notesInput = document.getElementById("count-notes");

  // Populate the count-text with the text and notes of the current count
  textInput.value = countJSON.features[value - 1].properties.id || "";
  notesInput.value = countJSON.features[value - 1].properties.notes || "";
}

function inputSampleLabel() {
  const input = document.getElementById("count-id");
  let id = parseInt(input.value, 10);
  const textInput = document.getElementById("count-text");
  const feature = countJSON.features[id - 1];
  if (!feature) return;

  if (feature.properties.id !== textInput.value) {
    annotationHistory.push("Edit count identifier");
  }

  // Store the text in the geoJSON
  feature.properties.id = textInput.value;
  // window.appState.hasUnsavedCounts = true;
  unsavedCounts(true);
}

function inputNotesText() {
  const input = document.getElementById("count-id");
  let value = parseInt(input.value, 10);
  const textInput = document.getElementById("count-notes");
  const feature = countJSON.features[value - 1];
  if (!feature) return;

  if (feature.properties.notes !== textInput.value) {
    annotationHistory.push("Edit count notes");
  }

  // Store the text in the object with sampleNumber as key
  feature.properties.notes = textInput.value;
  // window.appState.hasUnsavedCounts = true;
  unsavedCounts(true);
}

// Function to update repeatButton state
function updateRepeatButton() {
  repeatButton.disabled = !selectedAnnotationUuid;
  if (!selectedAnnotationUuid) {
    isRepeatMode = false;
    repeatButton.classList.remove("active");
  }
}

// Shortcut for entering labels and notes
document.addEventListener("keydown", function (event) {
  // Check for Enter key in count-text field
  const textInput = document.getElementById("count-text");
  const notesInput = document.getElementById("count-notes");
  if (event.code === "Enter" && document.activeElement === textInput) {
    event.preventDefault(); // Prevent any default action for Enter key
    inputSampleLabel();

    // Provide visual feedback by changing the border color
    textInput.style.borderColor = "green";
    textInput.style.outline = "none"; // Removes the default focus outline

    setTimeout(() => {
      textInput.style.borderColor = ""; // Revert to original after 1 second
    }, 1000);
    populateDropdown(); // Repopulate dropdown for filtering
    populateFilterDropdown(); // Repopulate filter dropdown
  }
  if (event.code === "Enter" && document.activeElement === notesInput) {
    event.preventDefault(); // Prevent any default action for Enter key
    inputNotesText();

    // Provide visual feedback by changing the border color
    notesInput.style.borderColor = "green";
    notesInput.style.outline = "none"; // Removes the default focus outline

    setTimeout(() => {
      notesInput.style.borderColor = ""; // Revert to original after 1 second
    }, 1000);
  }
});

// Export a CSV of point counts when the Export button is clicked
document.getElementById("count-export").addEventListener("click", function () {
  let csvContent = "Sample,Number,X_px,Y_px,Label,Notes\n";
  const noPoints = countJSON.features.length;
  for (let i = 0; i < noPoints; i++) {
    const pointNumber = countJSON.features[i].properties.label;
    const x_px = countJSON.features[i].geometry.coordinates[0];
    const y_px = countJSON.features[i].geometry.coordinates[1];
    const label = countJSON.features[i].properties.id || "";
    const notes = countJSON.features[i].properties.notes || "";

    // Append the row as a CSV line
    csvContent += `${title()},${pointNumber},${x_px},${y_px},"${label}","${notes}"\n`;
  }

  // Create a blob and trigger a download
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "count_data_export.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // window.appState.hasUnsavedCounts = false;
  unsavedCounts(false);
});

// Import CSV of previously generated point-count data
// saved as a geoJSON
// New loading code
document
  .getElementById("count-geojson-input")
  .addEventListener("change", function (event) {
    const fileInput = event.target;
    const file = fileInput.files[0];
    if (!file) {
      return;
    }

    annotationHistory.push("Import count JSON");
    clearGrid();

    if (file) {
      const reader = new FileReader();
      reader.onload = function (event) {
        const geoJSONData = event.target.result;
        loadCounts(geoJSONData);
        fileInput.value = "";
      };
      reader.readAsText(file);
    } else {
      alert("Please select a GeoJSON file to load counts.");
    }
    document.getElementById("apply-grid-settings").disabled = true;
    // document.getElementById("restore-grid-settings").disabled = true;
    document.getElementById("clear-grid").disabled = false;
    disableGridOptions();
    populateFilterDropdown();
    getSelectedLabels();
  });

document
  .getElementById("count-file-input")
  .addEventListener("change", function (event) {
    const fileInput = event.target;
    const file = fileInput.files[0];
    if (!file) return;

    annotationHistory.push("Import count CSV");
    // Clear existing grid
    clearGrid();

    const reader = new FileReader();
    reader.onload = function (e) {
      const content = e.target.result;
      // Parse CSV using PapaParse
      Papa.parse(content, {
        header: true, // Treats the first row as headers
        skipEmptyLines: true,
        complete: function (results) {
          const parsedData = results.data;
          processCSVData(parsedData);
        },
      });
      // Reset file input to allow reloading the same file
      fileInput.value = "";
    };
    reader.readAsText(file);

    enableCountButtons();

    disableGridOptions();
    document.getElementById("apply-grid-settings").disabled = true;
    // document.getElementById("restore-grid-settings").disabled = true;
    document.getElementById("clear-grid").disabled = false;
    populateFilterDropdown();
    getSelectedLabels();
  });

function disableGridOptions() {
  document.getElementById("show-aoi").disabled = true;
  document.getElementById("grid-left").disabled = true;
  document.getElementById("grid-right").disabled = true;
  document.getElementById("grid-top").disabled = true;
  document.getElementById("grid-bottom").disabled = true;
  document.getElementById("step-size").disabled = true;
  document.getElementById("no-points").disabled = true;
}

function enableGridOptions() {
  if (!hasKnownScale()) {
    disableGridOptions();
    return;
  }
  document.getElementById("show-aoi").disabled = false;
  document.getElementById("grid-left").disabled = false;
  document.getElementById("grid-right").disabled = false;
  document.getElementById("grid-top").disabled = false;
  document.getElementById("grid-bottom").disabled = false;
  document.getElementById("step-size").disabled = false;
  document.getElementById("no-points").disabled = false;
}

// Function to process parsed CSV data
function processCSVData(data) {
  const filteredData = data.map((row) => ({
    Number: row["Number"],
    X_px: parseFloat(row["X_px"]), // Convert to number if needed
    Y_px: parseFloat(row["Y_px"]),
    Label: row["Label"],
    Notes: row["Notes"],
  }));

  let image = viewer.world.getItemAt(0);
  const imageSize = image.getContentSize();

  filteredData.forEach((row) => {
    const viewportPoint = image.imageToViewportCoordinates(
      row["X_px"],
      row["Y_px"]
    );
    const properties = {
      uuid: generateUniqueId(16),
      label: row["Number"],
      id: row["Label"],
      notes: row["Notes"],
      xLabel: row["X_px"],
      yLabel: row["Y_px"],
      imageTitle: title(),
      pixelsPerMeter: pixelsPerMeter(),
      imageWidth: imageSize.x,
      imageHeight: imageSize.y,
      labelFontSize: parseFloat(
        document.getElementById("gridLabelFontSize").value
      ),
      labelFontColor: document.getElementById("gridLabelFontColor").value,
      labelBackgroundColor: document.getElementById("gridLabelBackgroundColor")
        .value,
      labelBackgroundOpacity: parseFloat(
        document.getElementById("gridLabelBackgroundOpacity").value
      ),
      lineColor: document.getElementById("gridLineColor").value,
      lineWeight: parseFloat(document.getElementById("gridLineWeight").value),
      lineOpacity: parseFloat(document.getElementById("gridLineOpacity").value),
    };
    saveCountToJSON("Point", [row["X_px"], row["Y_px"]], properties);
    // Make text and crosshairs
    addText(
      properties.uuid,
      properties.label,
      viewportPoint,
      "grid",
      properties.labelFontColor,
      properties.labelFontSize,
      properties.labelBackgroundColor,
      properties.labelBackgroundOpacity
    );
    addCrosshairs(
      properties.uuid,
      viewportPoint,
      "grid",
      properties.lineColor,
      properties.lineWeight,
      properties.lineOpacity
    );
  });
  applyFormattingAfterCountAll(countJSON, "both");
}

// Function to count labels dynamically
function getLabelCounts(noPoints) {
  const labelCounts = {};
  let totalCount = 0;
  for (let value = 1; value <= noPoints; value++) {
    const label = countJSON.features[value - 1].properties.id;

    if (label) {
      labelCounts[label] = (labelCounts[label] || 0) + 1;
      totalCount++;
    }
  }
  return { labelCounts, totalCount };
}

// For keeping track of which unique labels are checked
const checkboxStates = {};
const countFilterStates = {};
const NULL_COUNT_FILTER_KEY = "__petro_image_null_count__";

// Function to populate the dropdown with unique labels and checkboxes
function populateFilterDropdown() {
  const filterDropdown = document.getElementById("includeDropdown");
  const uniqueLabels = getUniqueLabels();

  // Clear existing options
  filterDropdown.innerHTML = "";

  // Add checkboxes for each unique label
  uniqueLabels.forEach((label) => {
    const isChecked =
      checkboxStates[label] !== undefined ? checkboxStates[label] : true;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = label;
    checkbox.id = `checkbox-${label}`;
    checkbox.checked = isChecked; // Default to checked

    checkbox.addEventListener("change", () => {
      checkboxStates[label] = checkbox.checked;
    });

    const labelElement = document.createElement("label");
    labelElement.textContent = label;
    labelElement.htmlFor = `checkbox-${label}`;

    const wrapper = document.createElement("div");
    wrapper.appendChild(checkbox);
    wrapper.appendChild(labelElement);

    filterDropdown.appendChild(wrapper);

    // Store the current state in `checkboxStates`
    checkboxStates[label] = isChecked;
  });
}

function populateCountFilterDropdown() {
  const filterDropdown = document.getElementById("countFilterDropdown");
  const uniqueLabels = getUniqueFilterLabels();

  filterDropdown.innerHTML = "";

  uniqueLabels.forEach(({ label, value, stateKey }) => {
    const isChecked =
      countFilterStates[stateKey] !== undefined
        ? countFilterStates[stateKey]
        : true;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = value;
    checkbox.id = `filter-checkbox-${stateKey}`;
    checkbox.checked = isChecked;

    checkbox.addEventListener("change", () => {
      countFilterStates[stateKey] = checkbox.checked;
      filterOverlays();
    });

    const labelElement = document.createElement("label");
    labelElement.textContent = label;
    labelElement.htmlFor = `filter-checkbox-${stateKey}`;

    const wrapper = document.createElement("div");
    wrapper.appendChild(checkbox);
    wrapper.appendChild(labelElement);

    filterDropdown.appendChild(wrapper);
    countFilterStates[stateKey] = isChecked;
  });
}

// Function to get selected labels from the dropdown
function getSelectedLabels() {
  const filterDropdown = document.getElementById("includeDropdown");
  const checkboxes = filterDropdown.querySelectorAll("input[type='checkbox']");
  const selectedLabels = [];

  checkboxes.forEach((checkbox) => {
    if (checkbox.checked) {
      selectedLabels.push(checkbox.value);
    }
  });

  return selectedLabels;
}

function getSelectedFilterLabels() {
  const filterDropdown = document.getElementById("countFilterDropdown");
  const checkboxes = filterDropdown.querySelectorAll("input[type='checkbox']");
  const selectedLabels = [];

  checkboxes.forEach((checkbox) => {
    if (checkbox.checked) {
      selectedLabels.push(checkbox.value);
    }
  });

  return selectedLabels;
}

// Modified getResults function to calculate statistics based on selected labels
function getResults(noPoints) {
  const { labelCounts, totalCount } = getLabelCounts(noPoints);
  const selectedLabels = getSelectedLabels();

  // Filter labelCounts to include only selected labels
  const filteredCounts = Object.entries(labelCounts).filter(([label]) =>
    selectedLabels.includes(label)
  );

  // Calculate total count for selected labels
  const filteredTotalCount = filteredCounts.reduce(
    (sum, [, count]) => sum + count,
    0
  );

  // Header with total count
  const results = [`N= ${filteredTotalCount}`];

  // Generate sorted results for selected labels
  filteredCounts
    .sort((a, b) => b[1] - a[1]) // Sort by count in descending order
    .forEach(([label, count]) => {
      const percentage = ((count / filteredTotalCount) * 100).toFixed(1);
      results.push(`${label}: ${count} (${percentage}%)`);
    });

  return results.join("<br>");
}

// Function to display summary results
function showResults() {
  // const noPoints = parseInt(document.getElementById("no-points").value);
  const noPoints = parseInt(countJSON.features.length);

  //const noPoints = viewer.overlays.length; // Total number of overlays
  const resultsContent = document.getElementById("resultsContent");
  resultsContent.innerHTML = getResults(noPoints);
  document.getElementById("resultsModal").style.display = "block";
}

function closeCountDropdown(dropdown) {
  if (!dropdown) return;

  dropdown.style.display = "none";
  dropdown.classList.remove("count-dropdown-popover");
}

function closeCountDropdowns() {
  closeCountDropdown(document.getElementById("includeDropdown"));
  closeCountDropdown(document.getElementById("countFilterDropdown"));
}

function positionCountDropdown(dropdown, button) {
  const buttonRect = button.getBoundingClientRect();
  const dropdownRect = dropdown.getBoundingClientRect();
  const margin = 8;
  const maxLeft = window.innerWidth - dropdownRect.width - margin;
  const left = Math.min(Math.max(buttonRect.left, margin), maxLeft);
  const spaceBelow = window.innerHeight - buttonRect.bottom - margin;
  const spaceAbove = buttonRect.top - margin;
  const opensUp = spaceBelow < dropdownRect.height && spaceAbove > spaceBelow;
  const top = opensUp
    ? Math.max(margin, buttonRect.top - dropdownRect.height - 4)
    : Math.min(
        buttonRect.bottom + 4,
        window.innerHeight - dropdownRect.height - margin
      );

  dropdown.style.left = `${left}px`;
  dropdown.style.top = `${top}px`;
}

function openCountDropdown(dropdown, button) {
  if (!dropdown || !button) return;

  if (dropdown.parentElement !== document.body) {
    document.body.appendChild(dropdown);
  }

  dropdown.classList.add("count-dropdown-popover");
  dropdown.style.display = "block";
  positionCountDropdown(dropdown, button);
}

// Attach event listener to the filterButton
document.getElementById("filterButton").addEventListener("click", function (event) {
  event.stopPropagation();
  populateFilterDropdown();
  const includeDropdown = document.getElementById("includeDropdown");
  const countFilterDropdown = document.getElementById("countFilterDropdown");
  closeCountDropdown(countFilterDropdown);

  // Toggle visibility of the dropdown menu
  if (includeDropdown.style.display === "block") {
    closeCountDropdown(includeDropdown);
  } else {
    openCountDropdown(includeDropdown, event.currentTarget);
  }
});

document
  .getElementById("countFilterButton")
  .addEventListener("click", function (event) {
    event.stopPropagation();
    populateCountFilterDropdown();
    const countFilterDropdown = document.getElementById("countFilterDropdown");
    const includeDropdown = document.getElementById("includeDropdown");
    closeCountDropdown(includeDropdown);

    if (countFilterDropdown.style.display === "block") {
      closeCountDropdown(countFilterDropdown);
    } else {
      openCountDropdown(countFilterDropdown, event.currentTarget);
    }
  });

// Optional: Close the dropdown when clicking outside
document.addEventListener("click", function (event) {
  const includeDropdown = document.getElementById("includeDropdown");
  const filterButton = document.getElementById("filterButton");
  const countFilterDropdown = document.getElementById("countFilterDropdown");
  const countFilterButton = document.getElementById("countFilterButton");

  // Check if the click is outside the dropdown and button
  if (
    !includeDropdown.contains(event.target) &&
    event.target !== filterButton
  ) {
    closeCountDropdown(includeDropdown);
  }

  if (
    !countFilterDropdown.contains(event.target) &&
    event.target !== countFilterButton
  ) {
    closeCountDropdown(countFilterDropdown);
  }
});

// Function to close the modal
function closeModal() {
  document.getElementById("resultsModal").style.display = "none";
}

// Function to get unique labels from the overlays
function getUniqueLabels() {
  // const noPoints = parseInt(document.getElementById("no-points").value);
  const noPoints = parseInt(countJSON.features.length);
  if (noPoints === 0) {
    return [];
  }
  const labels = new Set();

  for (let value = 1; value <= noPoints; value++) {
    const label = countJSON.features[value - 1].properties.id;
    if (label !== "") {
      // Don't count uncounted locations
      labels.add(label); // Add label to the Set (automatically ensures uniqueness)
    }
  }
  return Array.from(labels); // Convert Set to Array
}

function getUniqueFilterLabels() {
  const noPoints = parseInt(countJSON.features.length);
  if (noPoints === 0) {
    return [];
  }

  const filterLabels = new Map();

  for (let value = 1; value <= noPoints; value++) {
    const label = countJSON.features[value - 1].properties.id;
    const stateKey = label === "" ? NULL_COUNT_FILTER_KEY : label;
    const displayLabel = label === "" ? "null" : label;
    filterLabels.set(stateKey, {
      label: displayLabel,
      value: label,
      stateKey,
    });
  }

  return Array.from(filterLabels.values());
}

// Function to populate the dropdown with unique labels from overlays
function populateDropdown() {
  populateCountFilterDropdown();
}

function filterOverlays() {
  const filterDropdown = document.getElementById("countFilterDropdown");
  const hasFilterOptions =
    filterDropdown.querySelectorAll("input[type='checkbox']").length > 0;
  const selectedLabels = getSelectedFilterLabels();
  const showGrid = document.getElementById("show-grid").checked;
  const showGridLabels = document.getElementById("show-grid-labels").checked;
  const noPoints = countJSON.features.length;

  for (let value = 1; value <= noPoints; value++) {
    const label = countJSON.features[value - 1].properties.id;
    const uuid = countJSON.features[value - 1].properties.uuid;
    const textOverlay = document.getElementById(`grid-label-${uuid}`);
    const crosshairOverlay = document.getElementById(`grid-crosshair-${uuid}`);
    const matchesFilter = !hasFilterOptions || selectedLabels.includes(label);

    if (textOverlay) {
      textOverlay.style.visibility =
        matchesFilter && showGrid && showGridLabels ? "visible" : "hidden";
    }

    if (crosshairOverlay) {
      crosshairOverlay.style.visibility =
        matchesFilter && showGrid ? "visible" : "hidden";
    }
  }
}

// Ensure overlays respect the filter on each viewport update (for panning, zooming, etc.)
function enforceOverlayVisibility() {
  filterOverlays();
}

// Attach the enforceOverlayVisibility function to OpenSeadragon's update-viewport event
viewer.addHandler("update-viewport", () => {
  enforceOverlayVisibility();
});

/////////////////////////
//// Color functions ////
/////////////////////////

function hexToRgba(hex, opacity) {
  if (hex.startsWith("#")) {
    if (hex.length === 4) {
      // Short HEX (e.g., #f53) - expand to 6 digits
      hex =
        "#" +
        Array.from(hex.slice(1))
          .map((x) => x + x)
          .join("");
    }
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  return hex; // If it's not a valid hex, return as is
}

function rgbToRgba(rgb, opacity) {
  const rgbMatch = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (rgbMatch) {
    const r = rgbMatch[1];
    const g = rgbMatch[2];
    const b = rgbMatch[3];
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  return rgb; // If it's not a valid rgb, return as is
}

function hslToHsla(hsl, opacity) {
  const hslMatch = hsl.match(/^hsl\((\d+),\s*(\d+)%?,\s*(\d+)%?\)$/);
  if (hslMatch) {
    const h = hslMatch[1];
    const s = hslMatch[2];
    const l = hslMatch[3];
    return `hsla(${h}, ${s}%, ${l}%, ${opacity})`;
  }
  return hsl; // If it's not a valid hsl, return as is
}

function applyOpacityToColor(color, opacity) {
  // Check if the color is in HEX, RGB, or HSL format
  if (/^#[0-9A-F]{3,6}$/i.test(color)) {
    // HEX format
    return hexToRgba(color, opacity);
  } else if (/^rgb\(\d+,\s*\d+,\s*\d+\)$/.test(color)) {
    // RGB format
    return rgbToRgba(color, opacity);
  } else if (/^hsl\(\d+,\s*\d+%?,\s*\d+%?\)$/.test(color)) {
    // HSL format
    return hslToHsla(color, opacity);
  }
  return color; // If the color format isn't recognized, return as is
}

/////////////////////////////////
//// Measuring functionality ////
/////////////////////////////////

// Import, add, and export points with labels
const toggleMeasurement = (checkbox) => {
  if (!measureCanvas) return;
  if (!hasKnownScale()) {
    checkbox.checked = false;
    measureCanvas.style.display = "none";
    return;
  }
  measureCanvas.style.display = checkbox.checked ? "block" : "none";
};

const measurementButton = document.getElementById("toggleMeasurementButton");
const circleButton = document.getElementById("toggleCircleButton");

function stopMeasurementMode() {
  if (!measurementButton) return;
  measurementButton.classList.remove("active");
  measurementButton.textContent = "Start Measuring";
  measurementModeActive = false;
}

function toggleMeasurementMode() {
  if (!hasKnownScale()) return;
  const isMeasuring = measurementButton.classList.contains("active");

  // Toggle the active state of the button
  measurementButton.classList.toggle("active");

  if (isMeasuring) {
    // Disable measurement mode
    stopMeasurementMode();
    resetMeasurements();
  } else {
    // Enable measurement mode
    measurementButton.textContent = "Stop Measuring";
    measurementModeActive = true;
  }
}

///////////////////////////////////////////////////
//// Functions for plotting measurement circle ////
///////////////////////////////////////////////////

let circleJSON = {
  type: "FeatureCollection",
  features: [],
};
circleControlsInitialized = true;
function stopCircleMode() {
  if (!circleControlsInitialized || !circleButton) return;
  circleButton.classList.remove("active");
  circleButton.textContent = "Draw Circle";
  circleModeActive = false;
  circleJSON = {
    type: "FeatureCollection",
    features: [],
  };
  drawShape(circleCanvas, [circleJSON]);
}

function toggleCircleMode() {
  if (!hasKnownScale()) return;
  const isMeasuring = circleButton.classList.contains("active");

  // Toggle the active state of the button
  circleButton.classList.toggle("active");

  if (isMeasuring) {
    // Disable measurement mode
    stopCircleMode();
  } else {
    // Enable measurement mode
    circleButton.textContent = "Stop";
    circleModeActive = true;
  }
}

function getCircleCoordinatesInImageSpace(centerX, centerY, diameter) {
  const radius = diameter / 2;
  const coordinates = [];

  for (let angle = 0; angle <= 360; angle += 5) {
    const radians = (Math.PI / 180) * angle; // Convert degrees to radians

    // Calculate the x and y offsets from the center
    const offsetX = radius * Math.cos(radians);
    const offsetY = radius * Math.sin(radians);

    // Calculate the coordinates of each point along the circle's perimeter
    const x = centerX + offsetX;
    const y = centerY + offsetY;

    coordinates.push([x, y]);
  }

  return coordinates;
}

let circleConversion = 0;
viewerContainer.addEventListener("mousemove", function (event) {
  if (!circleModeActive) return; // Only draw when mode is active
  if (!hasKnownScale()) {
    stopCircleMode();
    return;
  }

  circleJSON = {
    type: "FeatureCollection",
    features: [],
  };

  const circleDiameter = parseFloat(document.getElementById("circle").value);
  const scale = pixelsPerMeter();
  const circleUnits = parseInt(document.getElementById("circleUnits").value);
  if (circleUnits === 0) {
    circleConversion = 1;
  } else if (circleUnits === 1) {
    circleConversion = 1000;
  } else if (circleUnits === 2) {
    circleConversion = 1000000;
  }

  const image = viewer.world.getItemAt(0);
  const positionPoint = new OpenSeadragon.Point(event.clientX, event.clientY);
  const viewportPoint = viewer.viewport.pointFromPixel(positionPoint);
  const imagePoint = image.viewportToImageCoordinates(
    viewportPoint.x,
    viewportPoint.y
  );
  const coordinates = getCircleCoordinatesInImageSpace(
    imagePoint.x,
    imagePoint.y,
    circleDiameter * (scale / circleConversion) // Convert physical units to pixels
  );

  const lineColor = document.getElementById("circleLineColor").value;
  const lineWeight = parseFloat(
    document.getElementById("circleLineWeight").value
  );
  const lineOpacity = parseFloat(
    document.getElementById("circleLineOpacity").value
  );
  const lineStyle = document.getElementById("circleLineStyle").value;
  const fillColor = document.getElementById("circleFillColor").value;
  const fillOpacity = parseFloat(
    document.getElementById("circleFillOpacity").value
  );

  const properties = {
    uuid: generateUniqueId(16),
    label: "circle",
    lineColor: lineColor,
    lineWeight: lineWeight,
    lineOpacity: lineOpacity,
    lineStyle: lineStyle,
    fillColor: fillColor,
    fillOpacity: fillOpacity,
  };

  addPolygonToGeoJSON(circleJSON, coordinates, properties);
  drawShape(circleCanvas, [circleJSON]);
});

// When Enter is pressed in the circle text box
document.addEventListener("keydown", function (event) {
  const circleValueInput = document.getElementById("circle");
  if (event.code === "Enter" && document.activeElement === circleValueInput) {
    event.preventDefault(); // Prevent any default action for Enter key
    drawShape(circleCanvas, [circleJSON]);
  }
});

////////////////////////////////////////////////////////////
//// Helper functions for calculating distance and area ////
////////////////////////////////////////////////////////////

// Helper function to calculate the distance between two points
function calculateDistance([x1, y1], [x2, y2]) {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

// Calculate perimeter of a polygon ring
function calculatePerimeter(ring) {
  let perimeter = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    let [x1, y1] = ring[i];
    let [x2, y2] = ring[i + 1];
    // perimeter += Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    perimeter += calculateDistance([x1, y1], [x2, y2]);
  }
  return perimeter;
}

// Calculate the area of a ring (array of coordinates)
function calculateArea(ring) {
  // Input is coordinates of a polygon ring
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    let [x1, y1] = ring[i];
    let [x2, y2] = ring[i + 1];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

function calculateLineStringLength(coordinates) {
  // Initialize total length to 0
  let totalLength = 0;

  // Loop through the coordinates and calculate the distance between consecutive points
  for (let i = 0; i < coordinates.length - 1; i++) {
    totalLength += calculateDistance(coordinates[i], coordinates[i + 1]);
  }

  return totalLength;
}

function calculatePolygonArea(coordinates) {
  // Calculate the perimeter and area of the exterior ring (first ring)
  let exteriorRing = coordinates[0];
  let exteriorPerimeter = calculatePerimeter(exteriorRing);
  let exteriorArea = calculateArea(exteriorRing);

  let interiorArea = 0;
  for (let i = 1; i < coordinates.length; i++) {
    let interiorRing = coordinates[i];
    interiorArea += calculateArea(interiorRing);
  }

  let totalArea = exteriorArea - interiorArea;

  return totalArea;
}

function calculatePolygonExteriorPerimeter(coordinates) {
  let exteriorRing = coordinates[0];
  let exteriorPerimeter = calculatePerimeter(exteriorRing);
  return exteriorPerimeter;
}

///////////////////////////////////////
//// Updated Measurement functions ////
///////////////////////////////////////

const distanceElement = document.getElementById("distance");
const areaElement = document.getElementById("area");
const ECDElement = document.getElementById("ECD");

// Event listener to add polyline annotations
let measureCoordinates = []; // Array to store viewport coordinates
let measureImageCoordinates = []; // Array to store image coordinates
let measureCoordinatesArray = []; // Array to store arrays of coordinates
let measureTimeout; // Timeout reference to detect double-click
const measureClickDelay = 300; // Maximum delay between clicks for detecting double-click
let measureLastClickTime = 0; // Timestamp of the last click
let distanceConversion = 0; // 0 = 1, 1 = 1000, 2 = 1000000
let distanceInM = 0;
let areaConversion = 0; // 0 = 1, 1 = 1e6, 2 = 1e12
let areaInM2;
let ECDConversion = 0;
let ECDInM;
let polylineCoords = [];
let polygonCoords = [];
measurementControlsInitialized = true;
// let activeMeasurement = false;
viewer.addHandler("canvas-click", function (event) {
  if (scaleWizardState.active) return;
  const isMeasuring = measurementButton.classList.contains("active");
  if (measurementModeActive && hasKnownScale()) {
    const distanceUnits = parseInt(
      document.getElementById("distanceUnits").value
    );
    const areaUnits = parseInt(document.getElementById("areaUnits").value);
    const ECDUnits = parseInt(document.getElementById("ECDUnits").value);
    if (distanceUnits === 0) {
      distanceConversion = 1;
    } else if (distanceUnits === 1) {
      distanceConversion = 1e3;
    } else if (distanceUnits === 2) {
      distanceConversion = 1e6;
    }
    if (areaUnits === 0) {
      areaConversion = 1;
    } else if (areaUnits === 1) {
      areaConversion = 1e6;
    } else if (areaUnits === 2) {
      areaConversion = 1e12;
    }
    if (ECDUnits === 0) {
      ECDConversion = 1;
    } else if (ECDUnits === 1) {
      ECDConversion = 1e3;
    } else if (ECDUnits === 2) {
      ECDConversion = 1e6;
    }
    measureJSON = {
      type: "FeatureCollection",
      features: [],
    };
    // activeMeasurement = true;
    const image = viewer.world.getItemAt(0);
    const imageSize = image.getContentSize();
    const viewportPoint = viewer.viewport.pointFromPixel(event.position);
    const imagePoint = image.viewportToImageCoordinates(
      viewportPoint.x,
      viewportPoint.y
    );
    const x = viewportPoint.x;
    const y = viewportPoint.y;
    const lineWeight = Number(
      document.getElementById("circleLineWeight").value
    );
    const lineColor = document.getElementById("circleLineColor").value;
    const lineStyle = document.getElementById("circleLineStyle").value;
    const lineOpacity = Number(
      document.getElementById("circleLineOpacity").value
    );
    const fillColor = document.getElementById("circleFillColor").value;
    const fillOpacity = Number(
      document.getElementById("circleFillOpacity").value
    );
    measureCoordinates.push({ x, y });
    measureImageCoordinates.push([imagePoint.x, imagePoint.y]);
    if (measureCoordinates.length > 1) {
      // Draw the polyline (polyline or polygon)
      drawShape(measureCanvas, [
        measureJSON,
        measureAreaJSONTemp,
        measureJSONTemp,
      ]);
    }

    // Continually update the measureJSONTemp with the latest coordinates
    viewerContainer.addEventListener("mousemove", function (subevent) {
      if (measurementModeActive) {
        // Clear to avoid duplicating lines
        measureJSONTemp = {
          type: "FeatureCollection",
          features: [],
        };
        measureAreaJSONTemp = {
          type: "FeatureCollection",
          features: [],
        };

        const rect = viewerContainer.getBoundingClientRect(); // Get container bounds
        const position = {
          x: subevent.clientX - rect.left,
          y: subevent.clientY - rect.top,
        };
        const positionPoint = new OpenSeadragon.Point(position.x, position.y);
        const subeventViewportPoint =
          viewer.viewport.pointFromPixel(positionPoint);
        const subeventImagePoint = image.viewportToImageCoordinates(
          subeventViewportPoint.x,
          subeventViewportPoint.y
        );

        polylineCoords = [
          ...measureImageCoordinates,
          [subeventImagePoint.x, subeventImagePoint.y],
        ];
        polygonCoords = [
          ...measureImageCoordinates,
          [subeventImagePoint.x, subeventImagePoint.y],
        ];

        addPolylineToGeoJSON(
          measureJSONTemp,
          polylineCoords,
          // [
          //   ...measureImageCoordinates,
          //   [subeventImagePoint.x, subeventImagePoint.y],
          // ],
          {
            lineStyle: lineStyle,
            lineWeight: lineWeight,
            lineColor: lineColor,
            lineOpacity: lineOpacity,
          }
        );

        if (
          polylineCoords.length > 2 &&
          (polylineCoords[0][0] !==
            polylineCoords[polylineCoords.length - 1][0] ||
            polylineCoords[0][1] !==
              polylineCoords[polylineCoords.length - 1][1])
        ) {
          polygonCoords.push(polygonCoords[0]);
        }

        addPolygonToGeoJSON(measureAreaJSONTemp, polygonCoords, {
          lineStyle: "dashed",
          lineWeight: lineWeight,
          lineColor: lineColor,
          lineOpacity: lineOpacity,
          fillColor: fillColor,
          fillOpacity: fillOpacity,
        });

        updateSelfIntersectionWarning(polygonCoords);

        const currentMeasureImageCoordinates = [
          ...measureImageCoordinates,
          [subeventImagePoint.x, subeventImagePoint.y],
        ];

        const measurePerimeterPixels = calculatePolygonExteriorPerimeter([
          currentMeasureImageCoordinates,
        ]);
        distanceInM = metersFromPixels(measurePerimeterPixels);
        const measurePerimeter = distanceInM * distanceConversion;
        distanceElement.value = measurePerimeter.toFixed(2);

        if (measureImageCoordinates.length >= 2) {
          // Close the polygon by adding the first point to the end
          const currentMeasureImageCoordinatesPolygon = [
            ...measureImageCoordinates,
            [subeventImagePoint.x, subeventImagePoint.y],
            [measureImageCoordinates[0][0], measureImageCoordinates[0][1]],
          ];

          const measureAreaPixels = calculatePolygonArea([
            currentMeasureImageCoordinatesPolygon,
          ]);
          areaInM2 = squareMetersFromSquarePixels(measureAreaPixels);
          const measureArea = areaInM2 * areaConversion;
          areaElement.value = measureArea.toFixed(2);

          ECDInM = areaInM2 === null
            ? null
            : 2 * Math.sqrt(areaInM2 / Math.PI);
          const ECD = ECDInM * ECDConversion;
          ECDElement.value = ECD.toFixed(2);
        } else {
          areaElement.value = 0.0; // Reset
          ECDElement.value = 0; // Reset
        }

        drawShape(measureCanvas, [
          measureJSON,
          measureAreaJSONTemp,
          measureJSONTemp,
        ]);
      }
    });

    // If the time between this click and the last click is shorter than clickDelay, it's a double-click
    const measureCurrentTime = new Date().getTime();
    if (measureCurrentTime - measureLastClickTime < clickDelay) {
      // It's a double-click, so stop the timeout and end collection
      clearTimeout(measureTimeout);

      const measurePerimeterPixels = calculatePolygonExteriorPerimeter([
        measureImageCoordinates,
      ]);
      const measurePerimeter =
        metersFromPixels(measurePerimeterPixels) * distanceConversion;

      // Close the polygon by adding the first point to the end
      const finalMeasureImageCoordinatesPolygon = [
        ...measureImageCoordinates,
        [measureImageCoordinates[0][0], measureImageCoordinates[0][1]],
      ];

      const measureAreaPixels = calculatePolygonArea([
        finalMeasureImageCoordinatesPolygon,
      ]);
      areaInM2 = squareMetersFromSquarePixels(measureAreaPixels);
      const measureArea = areaInM2 * areaConversion;

      ECDInM = areaInM2 === null ? null : 2 * Math.sqrt(areaInM2 / Math.PI);
      const ECD = ECDInM * ECDConversion;
      ECDElement.value = ECD.toFixed(2);

      addPolylineToGeoJSON(measureJSON, measureImageCoordinates, {
        label: "measurement",
        pixelsPerMeter: pixelsPerMeter(),
        imageWidth: imageSize.x,
        imageHeight: imageSize.y,
        lineStyle: lineStyle,
        lineWeight: lineWeight,
        lineColor: lineColor,
        lineOpacity: lineOpacity, // No line plotted, only fill (if any)
      });

      if (measurePerimeter > 0) {
        distanceElement.value = measurePerimeter.toFixed(2);
      }
      if (measureArea > 0) {
        areaElement.value = measureArea.toFixed(2);
      }

      // Reset the coordinates array for the next set of clicks
      resetMeasurements();
      // Disable the active measurement mode
      toggleMeasurementMode();
    } else {
      // It's a single click, so set a timeout to handle it
      measureTimeout = setTimeout(function () {
        // Single click detected, continuing collection...
      }, clickDelay);
    }

    // Update the last click timestamp
    measureLastClickTime = measureCurrentTime;
  }
});

function resetMeasurements(hardReset = false) {
  if (hardReset) {
    stopMeasurementMode();
    clearTimeout(measureTimeout);
    measureLastClickTime = 0;
  }

  measureCoordinates = [];
  measureImageCoordinates = []; // Clear
  measureJSONTemp = {
    type: "FeatureCollection",
    features: [],
  };
  measureAreaJSONTemp = {
    type: "FeatureCollection",
    features: [],
  };
  if (hardReset) {
    measureJSON = {
      type: "FeatureCollection",
      features: [],
    };
    distanceElement.value = 0;
    areaElement.value = 0;
    ECDElement.value = 0;
    drawShape(measureCanvas, [measureJSON, measureAreaJSONTemp, measureJSONTemp]);
  }
}

// Update measurement values upon change of units
document.getElementById("areaUnits").addEventListener("change", function () {
  const areaInput = document.getElementById("area");
  const newUnit = parseInt(this.value, 10);

  // Define conversion factors relative to square meters
  const conversionFactors = {
    0: 1, // m² (base)
    1: 1e6, // mm²
    2: 1e12, // µm²
  };

  const newArea = areaInM2 * conversionFactors[newUnit];

  // Update the area field
  areaInput.value = newArea.toFixed(2);
});

// Update measurement values upon change of units
document
  .getElementById("distanceUnits")
  .addEventListener("change", function () {
    const distanceInput = document.getElementById("distance");
    const newUnit = parseInt(this.value, 10);

    // Define conversion factors relative to square meters
    const conversionFactors = {
      0: 1, // m
      1: 1e3, // mm
      2: 1e6, // µm
    };

    const newDistance = distanceInM * conversionFactors[newUnit];

    // Update the area field
    distanceInput.value = newDistance.toFixed(2);
  });

// Update measurement values upon change of units
document.getElementById("ECDUnits").addEventListener("change", function () {
  const distanceInput = document.getElementById("ECD");
  const newUnit = parseInt(this.value, 10);

  // Define conversion factors relative to square meters
  const conversionFactors = {
    0: 1, // m
    1: 1e3, // mm
    2: 1e6, // µm
  };

  const newECD = ECDInM * conversionFactors[newUnit];

  // Update the area field
  ECD.value = newECD.toFixed(2);
});

///////////////////////////////////////////
//// Floating elements when annotating ////
///////////////////////////////////////////

// Tracking the current mouse position
let lastMousePosition = { x: 0, y: 0 }; // Store last known mouse position
document.addEventListener("mousemove", (event) => {
  lastMousePosition.x = event.clientX;
  lastMousePosition.y = event.clientY;
});

function getMousePosition() {
  return { x: lastMousePosition.x, y: lastMousePosition.y };
}

const crosshairFloater = document.getElementById("anno-point-floater");
const polylineFloater = document.getElementById("anno-polyline-floater");
const rectFloater = document.getElementById("anno-rect-floater");
const polygonFloater = document.getElementById("anno-polygon-floater");
const ellipseFloater = document.getElementById("anno-ellipse-floater");
const circleAnnotationFloater = document.getElementById("anno-circle-floater");

// This keeps track of key presses and releases, in case the keyup event listener is missed
const pressedKeys = new Set();
const keyTimestamps = {};

const KEY_TIMEOUT_MS = 500; // 0.5 seconds

window.addEventListener("keydown", (event) => {
  const code = event.code;
  if (
    (event.ctrlKey || event.metaKey || event.altKey) &&
    ["KeyQ", "KeyZ", "KeyX", "KeyC", "KeyV"].includes(code)
  ) {
    pressedKeys.delete(code);
    delete keyTimestamps[code];
    return;
  }

  pressedKeys.add(code);
  keyTimestamps[code] = Date.now();
});

window.addEventListener("keyup", (event) => {
  const code = event.code;
  pressedKeys.delete(code);
  delete keyTimestamps[code];
  if (code === "KeyV") {
    isVPressed = false;
    refreshAnnotationFloaters();
  }
});

setInterval(() => {
  const now = Date.now();
  for (const code of pressedKeys) {
    if (now - keyTimestamps[code] > KEY_TIMEOUT_MS) {
      pressedKeys.delete(code);
      delete keyTimestamps[code];
    }
  }
}, 250); // check four times a second

document.addEventListener("mousemove", (event) => {
  isCPressed = pressedKeys.has("KeyC");
  isXPressed = pressedKeys.has("KeyX");
  isQPressed = pressedKeys.has("KeyQ");
  isZPressed = pressedKeys.has("KeyZ");
  isVPressed = pressedKeys.has("KeyV");
  refreshAnnotationFloaters(event);
});

function refreshAnnotationFloaters(event = {}) {
  if (isQPressed || isPointMode) {
    // crosshairFloater.style.display = "block";
    // document.body.style.cursor = "default"; // Hide system cursor when crosshair is active
    toggleCrosshairFloaterOn(true);
    // crosshairFloater.style.left = `${event.clientX + 5}px`;
    // crosshairFloater.style.top = `${event.clientY - 5}px`;
  } else if (isZPressed || isPolylineMode) {
    togglePolylineFloaterOn(true);
  } else if (event.altKey || isRectangleMode) {
    toggleRectFloaterOn(true);
  } else if (isXPressed || isPolygonMode) {
    togglePolygonFloaterOn(true);
  } else if (isCPressed || isEllipseMode) {
    toggleEllipseFloaterOn(true);
  } else if (isVPressed || isCircleAnnotationMode) {
    toggleCircleAnnotationFloaterOn(true);
  } else {
    toggleCrosshairFloaterOn(false);
    togglePolylineFloaterOn(false);
    toggleRectFloaterOn(false);
    togglePolygonFloaterOn(false);
    toggleEllipseFloaterOn(false);
    toggleCircleAnnotationFloaterOn(false);
  }
}

viewer.addHandler("canvas-drag", function (event) {
  if (isRectangleDrawGesture(event)) {
    const x = event.position.x;
    const y = event.position.y;
    rectFloater.setAttribute(
      "points",
      `${x + 5},${y + -5} ${x + 15},${y + -5} ${x + 15},${y + 5} ${x + 5},${
        y + 5
      } ${x + 5},${y + -5}`
    );
  }
});

window.addEventListener("keydown", function (event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  if (event.key === "x" || event.key === "X") {
    togglePolygonFloaterOn(true);
  }
  if (event.key === "c" || event.key === "C") {
    toggleEllipseFloaterOn(true);
  }
});

function toggleCrosshairFloaterOn(enable) {
  crosshairFloater.style.display = enable ? "block" : "none";
  if (enable) {
    const currentMousePos = getMousePosition();
    crosshairFloater.style.left = `${currentMousePos.x + 5}px`;
    crosshairFloater.style.top = `${currentMousePos.y - 5}px`;
  }
  // document.body.style.cursor = enable ? "default" : "default"; // Hide system cursor when crosshair is active
}

function togglePolylineFloaterOn(enable) {
  polylineFloater.style.visibility = enable ? "visible" : "hidden";
  if (enable) {
    const currentMousePos = getMousePosition();
    const x = currentMousePos.x;
    const y = currentMousePos.y;
    polylineFloater.setAttribute(
      "points",
      `${x + 5},${y + -5} ${x + 15},${y + 5}`
    );
  }
}

function toggleRectFloaterOn(enable) {
  rectFloater.style.visibility = enable ? "visible" : "hidden";
  if (enable) {
    const currentMousePos = getMousePosition();
    const x = currentMousePos.x;
    const y = currentMousePos.y;
    rectFloater.setAttribute(
      "points",
      `${x + 5},${y + -5} ${x + 15},${y + -5} ${x + 15},${y + 5} ${x + 5},${
        y + 5
      } ${x + 5},${y + -5}`
    );
  }
}

function toggleCircleAnnotationFloaterOn(enable) {
  circleAnnotationFloater.style.visibility = enable ? "visible" : "hidden";
  if (enable) {
    const currentMousePos = getMousePosition();
    circleAnnotationFloater.setAttribute("cx", `${currentMousePos.x + 10}`);
    circleAnnotationFloater.setAttribute("cy", `${currentMousePos.y}`);
    circleAnnotationFloater.setAttribute("r", "6");
  }
}

function togglePolygonFloaterOn(enable) {
  polygonFloater.style.visibility = enable ? "visible" : "hidden";
  if (enable) {
    const currentMousePos = getMousePosition();
    const x = currentMousePos.x;
    const y = currentMousePos.y;
    polygonFloater.setAttribute(
      "points",
      `${x + 5},${y + -5} ${x + 20},${y + -5} ${x + 15},${y + 5} ${x + 5},${
        y + 5
      } ${x + 5},${y + -5}`
    );
  }
}

function toggleEllipseFloaterOn(enable) {
  polygonFloater.style.visibility = enable ? "visible" : "hidden";
  if (enable) {
    const currentMousePos = getMousePosition();
    const x = currentMousePos.x;
    const y = currentMousePos.y;
    const yoffset = -2;
    const xoffset = 8;
    polygonFloater.setAttribute(
      "points",
      `${x + 7.07 + xoffset},${y + 7.07 + yoffset}
       ${x + 5.02 + xoffset},${y + 7.9 + yoffset}
       ${x + 2.1 + xoffset},${y + 7.36 + yoffset}
       ${x + -1.18 + xoffset},${y + 5.55 + yoffset}
       ${x + -4.26 + xoffset},${y + 2.78 + yoffset}
       ${x + -6.6 + xoffset},${y + -0.47 + yoffset}
       ${x + -7.8 + xoffset},${y + -3.64 + yoffset}
       ${x + -7.65 + xoffset},${y + -6.18 + yoffset}
       ${x + -6.18 + xoffset},${y + -7.65 + yoffset}
       ${x + -3.64 + xoffset},${y + -7.8 + yoffset}
       ${x + -0.47 + xoffset},${y + -6.6 + yoffset}
       ${x + 2.78 + xoffset},${y + -4.26 + yoffset}
       ${x + 5.55 + xoffset},${y + -1.18 + yoffset}
       ${x + 7.36 + xoffset},${y + 2.1 + yoffset}
       ${x + 7.9 + xoffset},${y + 5.02 + yoffset}
       ${x + 7.07 + xoffset},${y + 7.07 + yoffset}`
    );
  }
}

// TODO: Disable this behavior in text boxes? This would prevent the view from
// changing when typing > or < into a text box
// Listen for keydown events
document.addEventListener("keydown", function (event) {
  if (event.shiftKey && event.key === "<") {
    scrollIndex--; // Move backward
  } else if (event.shiftKey && event.key === ">") {
    scrollIndex++; // Move forward
  }

  displayImages();
  updateImageCheckboxLabels();
  updateOpacitySliderLabels();
});

// Function to check if a polygon is self-intersecting
function isSelfIntersecting(coords) {
  // Ensure the polygon is closed
  const points = coords.slice();
  if (
    points.length > 2 &&
    (points[0][0] !== points[points.length - 1][0] ||
      points[0][1] !== points[points.length - 1][1])
  ) {
    points.push(points[0]);
  }

  function segmentsIntersect(p1, p2, q1, q2) {
    function ccw(a, b, c) {
      return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0]);
    }

    return (
      ccw(p1, q1, q2) !== ccw(p2, q1, q2) && ccw(p1, p2, q1) !== ccw(p1, p2, q2)
    );
  }

  const n = points.length - 1;
  for (let i = 0; i < n; i++) {
    const a1 = points[i];
    const a2 = points[i + 1];

    for (let j = i + 1; j < n; j++) {
      // Skip adjacent edges and wrap-around neighbors
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;

      const b1 = points[j];
      const b2 = points[j + 1];

      if (segmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }

  return false;
}

function updateSelfIntersectionWarning(coords) {
  const isIntersecting = isSelfIntersecting(coords);
  const banner = document.getElementById("selfIntersectWarning");

  if (isIntersecting) {
    banner.style.display = "block";
  } else {
    banner.style.display = "none";
  }
}

let promptCallback = null;

function showPrompt(message, callback, defaultValue = "") {
  const promptBox = document.getElementById("customPrompt");
  const promptInput = document.getElementById("promptInput");
  const promptMessage = document.getElementById("promptMessage");

  promptMessage.textContent = message;
  promptBox.classList.remove("modal-prompt-hidden");
  promptBox.classList.add("modal-prompt-visible");

  promptInput.value = defaultValue;
  // promptInput.focus();

  // Use setTimeout to defer focus until after rendering
  setTimeout(() => {
    promptInput.focus();
    promptInput.select(); // Optional: highlights existing text if any
  }, 50);

  promptInput.onkeydown = function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitPrompt();
    }
  };

  promptCallback = callback;
}

function submitPrompt() {
  const value = document.getElementById("promptInput").value;
  hidePrompt();
  if (promptCallback) {
    promptCallback(value);
    promptCallback = null;
  }
}

function cancelPrompt() {
  hidePrompt();
  if (promptCallback) {
    promptCallback(""); // treat cancel as empty string
    promptCallback = null;
  }
}

function hidePrompt() {
  const promptBox = document.getElementById("customPrompt");
  const promptInput = document.getElementById("promptInput");
  promptBox.classList.remove("modal-prompt-visible");
  promptBox.classList.add("modal-prompt-hidden");
  promptInput.onkeydown = null;
}

/////////////////////////////////
//// Image rotation controls ////
/////////////////////////////////

const imageRotater = document.getElementById("imageRotation");
// const rotationAngle = document.getElementById("imageRotationValue");
const imageRotationValue = document.getElementById("imageRotationValue");

function normalizeAngleDegrees(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.min(360, Math.round(numericValue)));
}

function setRotationValueDisplay(element, angle) {
  const normalizedAngle = normalizeAngleDegrees(angle);

  if ("value" in element) {
    element.value = normalizedAngle;
  } else {
    element.textContent = `${normalizedAngle}°`;
  }
}

function setImageRotationAngle(angle, syncStage = true) {
  const normalizedAngle = normalizeAngleDegrees(angle);

  imageRotater.value = normalizedAngle;
  setRotationValueDisplay(imageRotationValue, normalizedAngle);
  viewer.viewport.setRotation(normalizedAngle);

  if (syncStage && rotateWithStage.checked) {
    stageRotater.value = normalizedAngle;
    setRotationValueDisplay(stageRotationValue, normalizedAngle);
  }

  displayImages();
}

function setStageRotationAngle(angle, syncImage = true) {
  const normalizedAngle = normalizeAngleDegrees(angle);

  stageRotater.value = normalizedAngle;
  setRotationValueDisplay(stageRotationValue, normalizedAngle);

  if (syncImage && rotateWithStage.checked) {
    imageRotater.value = normalizedAngle;
    setRotationValueDisplay(imageRotationValue, normalizedAngle);
    viewer.viewport.setRotation(normalizedAngle);
  }

  displayImages();
}

// Update value in real time
imageRotater.addEventListener("input", () => {
  setImageRotationAngle(imageRotater.value);
});

imageRotationValue.addEventListener("change", () => {
  setImageRotationAngle(imageRotationValue.value);
});

// Listen for R key press → rotate +90°
document.addEventListener("keydown", (event) => {
  if (event.key === "r" || event.key === "R") {
    const currentRotation = viewer.viewport.getRotation();
    const newRotation = currentRotation % 360;
    viewer.viewport.setRotation(newRotation);

    // Sync slider + text
    setImageRotationAngle(newRotation);
  }
});

//// Code for keeping HTML annotation overlays upright when rotating ////

function updateAnnotationOverlayRotation() {
  document
    .querySelectorAll(".annotate-label, .grid-label")
    .forEach((labelEl) => {
      labelEl.style.transform = "";
      labelEl.style.transformOrigin = "top left";
    });

  document.querySelectorAll(".annotation-vertex-handle").forEach((handle) => {
    handle.style.transform = "translate(-50%, -50%)";
    handle.style.transformOrigin = "center center";
  });
}

viewer.addHandler("rotate", updateAnnotationOverlayRotation);
viewer.addHandler("animation", updateAnnotationOverlayRotation);
viewer.addHandler("animation-finish", updateAnnotationOverlayRotation);

updateAnnotationOverlayRotation();

// //////////////////////////////////////////////////////
// //// Controls for zoom/rotation with mouse scroll ////
// //////////////////////////////////////////////////////

// const ROTATION_SENSITIVITY = 0.15; // degrees per scroll unit
// const ZOOM_SENSITIVITY = 1; // zoom factor per scroll unit

// // Disable OSD’s default scroll zoom
// viewer.gestureSettingsMouse.scrollToZoom = false;

// viewer.addHandler("canvas-scroll", function (event) {
//   const e = event.originalEvent;
//   e.preventDefault();
//   e.stopPropagation();

//   if (e.ctrlKey) {
//     // Ctrl held → rotate

//     const delta = e.deltaY;
//     const currentRotation = viewer.viewport.getRotation();
//     const newRotation = currentRotation + delta * ROTATION_SENSITIVITY;
//     viewer.viewport.setRotation(newRotation);

//     // update slider/value if you have them
//     const rotationSlider = document.getElementById("imageRotation");
//     const rotationValue = document.getElementById("imageRotationValue");
//     if (rotationSlider && rotationValue) {
//       const positiveRotation = ((newRotation % 360) + 360) % 360;
//       rotationSlider.value = positiveRotation;
//       rotationValue.textContent = Math.round(positiveRotation) + "°";
//     }
//   } else {
//     // No Ctrl → zoom normally
//     e.preventDefault();
//     e.stopPropagation();

//     const zoom = viewer.viewport.getZoom();
//     //const factor = 1 - e.deltaY * ZOOM_SENSITIVITY * 0.01; // adjust sensitivity

//     const factor = Math.pow(1.2, -e.deltaY / 50); // adjust sensitivity if needed

//     let newZoom = zoom * factor;

//     // Clamp to min/max
//     const minZoom = viewer.viewport.getMinZoom();
//     const maxZoom = viewer.viewport.getMaxZoom();
//     newZoom = Math.max(minZoom, Math.min(newZoom, maxZoom));

//     // Get the mouse position relative to the viewport
//     const webPoint = new OpenSeadragon.Point(e.clientX, e.clientY);
//     const viewportPoint = viewer.viewport.pointFromPixel(webPoint);

//     viewer.viewport.zoomTo(zoom * factor, viewportPoint);
//   }
// });

function resetRotation() {
  const rotationSlider = document.getElementById("imageRotation");
  const rotationValue = document.getElementById("imageRotationValue");
  if (rotationSlider && rotationValue) {
    rotationSlider.value = 0;
    setRotationValueDisplay(rotationValue, 0);
  }
  viewer.viewport.setRotation(0, true);
  const stageRotationSlider = document.getElementById("stageRotation");
  const stageRotationValue = document.getElementById("stageRotationValue");
  if (stageRotationSlider && stageRotationValue) {
    stageRotationSlider.value = 0;
    setRotationValueDisplay(stageRotationValue, 0);
  }
}

const toggleImageRotationWithStage = () => {
  if (rotateWithStage.checked) {
    // Sync stage to image
    const imageAngle = parseInt(document.getElementById("imageRotation").value);
    stageRotater.value = imageAngle;
    setRotationValueDisplay(stageRotationValue, imageAngle);
    displayImages();
  }
};

/////////////////////////////////
//// Stage rotation controls ////
/////////////////////////////////

const stageRotater = document.getElementById("stageRotation");
const rotateWithStage = document.getElementById("rotateWithStage");
const stageRotationValue = document.getElementById("stageRotationValue");

stageRotater.addEventListener("input", () => {
  setRotationValueDisplay(stageRotationValue, stageRotater.value);
  stageRotationValue.classList.add("updating");
  setTimeout(() => stageRotationValue.classList.remove("updating"), 150);
});

// Update value in real time
stageRotater.addEventListener("input", () => {
  setStageRotationAngle(stageRotater.value);
});

stageRotationValue.addEventListener("change", () => {
  setStageRotationAngle(stageRotationValue.value);
});

function updateStageRotationCheck() {
  enableStageRotation = samples[currentIndex].tileSets.some(
    (tileSet) => "periodDegrees" in tileSet
  );

  const stageSliderValue = document.getElementById("stageRotationValue");
  const stageSliderUnit = document.getElementById("stageRotationUnit");
  const stageLabel = document.getElementById("stageRotationLabel");
  const lockCheckbox = document.getElementById("rotateWithStage");
  const lockCheckboxLabel = document.getElementById("rotateWithStageLabel");

  if (enableStageRotation) {
    stageRotater.style.display = "block"; // Show the slider
    stageSliderValue.style.display = "block"; // Show the value
    stageSliderUnit.style.display = "block"; // Show the unit
    stageLabel.style.display = "block"; // Show the label
    lockCheckbox.style.display = "block"; // Show the checkbox
    lockCheckboxLabel.style.display = "block"; // Show the checkbox label
  } else {
    stageRotater.style.display = "none"; // Hide it
    stageSliderValue.style.display = "none"; // Hide it
    stageSliderUnit.style.display = "none"; // Hide the unit
    stageLabel.style.display = "none"; // Hide the label
    lockCheckbox.style.display = "none"; // Hide the checkbox
    lockCheckboxLabel.style.display = "none"; // Hide the checkbox label
  }
}

function resetLockStage() {
  rotateWithStage.checked = false;
}

//////////////////////////////////////////////////////
//// Controls for stage rotation with mouse scroll ////
//////////////////////////////////////////////////////

const ROTATION_SENSITIVITY = 0.15; // degrees per scroll unit
const ZOOM_SENSITIVITY = 1; // zoom factor per scroll unit

// Disable OSD’s default scroll zoom
viewer.gestureSettingsMouse.scrollToZoom = false;

viewer.addHandler("canvas-scroll", function (event) {
  const e = event.originalEvent;
  e.preventDefault();
  e.stopPropagation();

  if (e.ctrlKey) {
    // Ctrl held → rotate

    const delta = e.deltaY;
    const currentRotation = parseInt(
      document.getElementById("stageRotation").value
    );
    const newRotation = currentRotation + delta * ROTATION_SENSITIVITY;
    const positiveRotation = ((newRotation % 360) + 360) % 360;
    setStageRotationAngle(positiveRotation, false);

    // If checkbox is checked, sync image rotation
    if (rotateWithStage.checked) {
      imageRotater.value = positiveRotation;
      setRotationValueDisplay(imageRotationValue, positiveRotation);
      viewer.viewport.setRotation(positiveRotation);
    }
    displayImages();
  } else {
    // No Ctrl → zoom normally
    e.preventDefault();
    e.stopPropagation();

    const zoom = viewer.viewport.getZoom();
    //const factor = 1 - e.deltaY * ZOOM_SENSITIVITY * 0.01; // adjust sensitivity

    const factor = Math.pow(1.2, -e.deltaY / 50); // adjust sensitivity if needed

    let newZoom = zoom * factor;

    // Clamp to min/max
    const minZoom = viewer.viewport.getMinZoom();
    const maxZoom = viewer.viewport.getMaxZoom();
    newZoom = Math.max(minZoom, Math.min(newZoom, maxZoom));

    // Get the mouse position relative to the viewport
    const webPoint = new OpenSeadragon.Point(e.clientX, e.clientY);
    const viewportPoint = viewer.viewport.pointFromPixel(webPoint);

    viewer.viewport.zoomTo(zoom * factor, viewportPoint);
  }
});

// Attempt to improve performance when adding annotations
// Only once during initialization:
document.addEventListener("keydown", function (event) {
	  if (event.key === "Escape") {
	    setAnnotationMoveMode(false);
	    setAnnotationLabelMoveMode(false);
	    exitAnnotationVertexEditMode();
	    exitAnnotationShapeEditMode();
	    removeTemporaryPoints();
	  }
});

viewerContainer.addEventListener("mousemove", function (subevent) {
  if (!activelyMakingPoly) return;

  // Clear temporary JSON
  annoJSONTemp = { type: "FeatureCollection", features: [] };

  const rect = viewerContainer.getBoundingClientRect();
  const position = {
    x: subevent.clientX - rect.left,
    y: subevent.clientY - rect.top,
  };
  const positionPoint = new OpenSeadragon.Point(position.x, position.y);
  const viewportPoint = viewer.viewport.pointFromPixel(positionPoint);
  const image = viewer.world.getItemAt(0);
  const imagePoint = image.viewportToImageCoordinates(
    viewportPoint.x,
    viewportPoint.y
  );

  const labelFontSize = Number(
    document.getElementById("annoLabelFontSize").value
  );
  currentPolyStyleColors = getCurrentAnnotationStyleColors(
    currentPolyStyleColors
  );
  const labelFontColor = currentPolyStyleColors.labelFontColor;
  const labelBackgroundColor = currentPolyStyleColors.labelBackgroundColor;
  const labelBackgroundOpacity = getAnnotationOpacityValue("annoLabelBackgroundOpacity");
  const lineWeight = Number(document.getElementById("lineWeight").value);
  const lineColor = currentPolyStyleColors.lineColor;
  const lineStyle = document.getElementById("lineStyle").value;
  const lineOpacity = getAnnotationOpacityValue("lineOpacity");

  addPolylineToGeoJSON(
    annoJSONTemp,
    [...clickImageCoordinates, [imagePoint.x, imagePoint.y]],
    {
      labelFontSize,
      labelFontColor,
      labelBackgroundColor,
      labelBackgroundOpacity,
      lineStyle,
      lineWeight,
      lineColor,
      lineOpacity,
    }
  );

  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
});

function recordGridControlHistory(label = "Change grid setting") {
  const currentState = cloneGridControlState();
  if (!lastCommittedGridControlState) {
    lastCommittedGridControlState = currentState;
    return;
  }

  if (
    JSON.stringify(currentState) === JSON.stringify(lastCommittedGridControlState)
  ) {
    return;
  }

  const undoState = cloneAnnotationState();
  undoState.gridControls = cloneData(lastCommittedGridControlState);
  annotationHistory.push(label, undoState);
  lastCommittedGridControlState = currentState;
}

setTimeout(() => {
  lastCommittedGridControlState = cloneGridControlState();
  GRID_CONTROL_IDS.forEach((id) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.addEventListener("change", () => {
      recordGridControlHistory(
        GRID_CONTROL_HISTORY_LABELS[id] || "Change grid setting"
      );
    });
  });
}, 0);
