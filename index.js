"use strict";

// Index of the currently selected sample
let currentIndex = 0;
let samples = [];
let currentLibraryData = { samples: [] };
let currentLibraryPath = "";
let annotationFiles = {}; // For loading predefined annotations
let groupMapping = {}; // To map groups to sample indices
let lastSelectedSampleByGroup = {};
let scrollIndex = 1e6; // Prevents indexing error if starting at 0, due to negative numbers
let tileSetScrollIndices = [];
let enableStageRotation = false;
let tileLoadGeneration = 0;
let measurementControlsInitialized = false;
let circleControlsInitialized = false;
let measurementModeActive = false;
let activeMeasureTool = null;
let circleModeActive = false;
let tileLoadFailureWarningKey = "";
let tileLoadFailureWarningInFlight = false;

// Accessors for attributes of the current sample
const title = () => samples[currentIndex].title;
const tileSets = () => samples[currentIndex]?.tileSets || [];
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
  return scale === null || pixels === null || pixels === undefined ? null : pixels / scale;
};
const squareMetersFromSquarePixels = (pixels2) => {
  const scale = pixelsPerMeter();
  return scale === null || pixels2 === null || pixels2 === undefined
    ? null
    : pixels2 / scale ** 2;
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
let pendingAnnotationTextEdit = null;
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
  lastSelectedSampleByGroup = {};

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
      rememberSelectedSampleForGroup(groupForSample || "All", sampleIndex);
      populateSampleDropdown(groupForSample || "All", { autoSelect: false });
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
const openPorosityEstimatorButton = document.getElementById(
  "openPorosityEstimatorButton"
);
const openSegmentPaletteButton = document.getElementById(
  "openSegmentPaletteButton"
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
const porosityPalette = document.getElementById("porosityPalette");
const porosityPaletteHeader = document.getElementById("porosityPaletteHeader");
const closePorosityPaletteButton = document.getElementById(
  "closePorosityPaletteButton"
);
const minimizePorosityPaletteButton = document.getElementById(
  "minimizePorosityPaletteButton"
);
const segmentPalette = document.getElementById("segmentPalette");
const segmentPaletteHeader = document.getElementById("segmentPaletteHeader");
const closeSegmentPaletteButton = document.getElementById(
  "closeSegmentPaletteButton"
);
const minimizeSegmentPaletteButton = document.getElementById(
  "minimizeSegmentPaletteButton"
);
const samPythonPathInput = document.getElementById("samPythonPath");
const samCheckpointPathInput = document.getElementById("samCheckpointPath");
const samModelTypeSelect = document.getElementById("samModelType");
const chooseSamPythonButton = document.getElementById("chooseSamPythonButton");
const chooseSamCheckpointButton = document.getElementById(
  "chooseSamCheckpointButton"
);
const saveSamSettingsButton = document.getElementById("saveSamSettingsButton");
const testSamSetupButton = document.getElementById("testSamSetupButton");
const samSetupStatus = document.getElementById("samSetupStatus");
const samSetupReadiness = document.getElementById("samSetupReadiness");
const testSegmenteverygrainSetupButton = document.getElementById(
  "testSegmenteverygrainSetupButton"
);
const segmenteverygrainSetupStatus = document.getElementById(
  "segmenteverygrainSetupStatus"
);
const segmenteverygrainSetupReadiness = document.getElementById(
  "segmenteverygrainSetupReadiness"
);
const segmenteverygrainModelPathInput = document.getElementById(
  "segmenteverygrainModelPath"
);
const chooseSegmenteverygrainModelButton = document.getElementById(
  "chooseSegmenteverygrainModelButton"
);
const segmentTileSetSelect = document.getElementById("segmentTileSetSelect");
const segmentResolutionSelect = document.getElementById("segmentResolutionSelect");
const unsupervisedSegmentTileSetSelect = document.getElementById(
  "unsupervisedSegmentTileSetSelect"
);
const segmentPaddingPercentInput = document.getElementById(
  "segmentPaddingPercent"
);
const segmentPaddingMinInput = document.getElementById("segmentPaddingMin");
const segmentPaddingMaxInput = document.getElementById("segmentPaddingMax");
const segmentPaddingStatus = document.getElementById("segmentPaddingStatus");
const segmentSimplifyEnabledInput = document.getElementById(
  "segmentSimplifyEnabled"
);
const segmentSimplifyEpsilonInput = document.getElementById(
  "segmentSimplifyEpsilon"
);
const segmentAnnotationGroupInput = document.getElementById(
  "segmentAnnotationGroup"
);
const segmentAnnotationGroupOptions = document.getElementById(
  "segmentAnnotationGroupOptions"
);
const segmentModeToggle = document.getElementById("segmentModeToggle");
const segmentAutoAddCheckbox = document.getElementById("segmentAutoAdd");
const segmentDrawBoxButton = document.getElementById("segmentDrawBoxButton");
const segmentClearButton = document.getElementById("segmentClearButton");
const segmentAddPositivePointButton = document.getElementById(
  "segmentAddPositivePointButton"
);
const segmentAddNegativePointButton = document.getElementById(
  "segmentAddNegativePointButton"
);
const segmentAddAnnotationButton = document.getElementById(
  "segmentAddAnnotationButton"
);
const unsupervisedSimplifyEnabledInput = document.getElementById(
  "unsupervisedSimplifyEnabled"
);
const unsupervisedSimplifyEpsilonInput = document.getElementById(
  "unsupervisedSimplifyEpsilon"
);
const unsupervisedUseSamRefinementInput = document.getElementById(
  "unsupervisedUseSamRefinement"
);
const unsupervisedMinAreaInput = document.getElementById("unsupervisedMinArea");
const unsupervisedPatchSizeInput = document.getElementById(
  "unsupervisedPatchSize"
);
const unsupervisedOverlapInput = document.getElementById("unsupervisedOverlap");
const unsupervisedDilationInput = document.getElementById(
  "unsupervisedDilation"
);
const unsupervisedShowPatchGridInput = document.getElementById(
  "unsupervisedShowPatchGrid"
);
const unsupervisedRemoveEdgeGrainsInput = document.getElementById(
  "unsupervisedRemoveEdgeGrains"
);
const unsupervisedResolutionSelect = document.getElementById(
  "unsupervisedResolutionSelect"
);
const unsupervisedAoiSourcePixels = document.getElementById(
  "unsupervisedAoiSourcePixels"
);
const unsupervisedAoiProcessedPixels = document.getElementById(
  "unsupervisedAoiProcessedPixels"
);
const unsupervisedAoiPixelCount = document.getElementById(
  "unsupervisedAoiPixelCount"
);
const unsupervisedSegmentStatus = document.getElementById(
  "unsupervisedSegmentStatus"
);
const unsupervisedSegmentProgress = document.getElementById(
  "unsupervisedSegmentProgress"
);
const unsupervisedSegmentProgressBar = document.getElementById(
  "unsupervisedSegmentProgressBar"
);
const unsupervisedDrawAoiButton = document.getElementById(
  "unsupervisedDrawAoiButton"
);
const unsupervisedClearAoiButton = document.getElementById(
  "unsupervisedClearAoiButton"
);
const runUnsupervisedSegmentationButton = document.getElementById(
  "runUnsupervisedSegmentationButton"
);
const cancelUnsupervisedSegmentationButton = document.getElementById(
  "cancelUnsupervisedSegmentationButton"
);
const segmentStatus = document.getElementById("segmentStatus");
const segmentReticle = document.getElementById("segment-reticle");
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
const porosityOverlay = document.getElementById("porosity-overlay");
const porosityTypeSelect = document.getElementById("porosityTypeSelect");
const porosityAddTypeButton = document.getElementById("porosityAddTypeButton");
const porosityRenameTypeButton = document.getElementById(
  "porosityRenameTypeButton"
);
const porosityDeleteTypeButton = document.getElementById(
  "porosityDeleteTypeButton"
);
const porosityTileSetSelect = document.getElementById("porosityTileSetSelect");
const porosityDrawAoiButton = document.getElementById("porosityDrawAoiButton");
const porosityToggleAoiButton = document.getElementById(
  "porosityToggleAoiButton"
);
const porosityPickColorButton = document.getElementById("porosityPickColorButton");
const porosityUndoColorButton = document.getElementById("porosityUndoColorButton");
const porosityEstimateViewButton = document.getElementById(
  "porosityEstimateViewButton"
);
const porosityEstimateButton = document.getElementById("porosityEstimateButton");
const porosityResolutionMode = document.getElementById("porosityResolutionMode");
const porosityResolutionStatus = document.getElementById(
  "porosityResolutionStatus"
);
const porosityClearButton = document.getElementById("porosityClearButton");
const porosityTolerance = document.getElementById("porosityTolerance");
const porosityToleranceValue = document.getElementById("porosityToleranceValue");
const porosityOverlayColor = document.getElementById("porosityOverlayColor");
const porosityOverlayOpacity = document.getElementById("porosityOverlayOpacity");
const porosityOverlayOpacityValue = document.getElementById(
  "porosityOverlayOpacityValue"
);
const porositySamples = document.getElementById("porositySamples");
const porosityResults = document.getElementById("porosityResults");
const porosityStatus = document.getElementById("porosityStatus");
const porosityProgress = document.getElementById("porosityProgress");
const porosityProgressLabel = document.getElementById("porosityProgressLabel");
const porosityProgressBar = document.getElementById("porosityProgressBar");
const porosityActivityStatus = document.getElementById("porosityActivityStatus");
const openScaleWizardButton = document.getElementById("openScaleWizardButton");
const openLibraryEditorButton = document.getElementById("openLibraryEditorButton");
const hasElectronActions = Boolean(window.electronAPI);
const hasSharedViewerMenus = Boolean(
  electronActionButton &&
    electronActionTray &&
    viewerToolsButton &&
    viewerToolsTray
);
let gridCountPaletteControlsMoved = false;
let annotatePaletteControlsMoved = false;
let measurePaletteControlsMoved = false;
let snapshotModeActive = false;
let snapshotDragState = null;
let snapshotSelectionRect = null;
let snapshotAdjustState = null;
let porosityAoiModeActive = false;
let porosityPickModeActive = false;
let porosityAoiImagePoints = [];
let porosityAoiComplete = false;
let porosityAoiMousePoint = null;
let porosityAoiSelectedVertexIndex = null;
let porosityAoiDragState = null;
let porosityAoiVisible = true;
let porosityAoiConstrainSegment = false;
let porosityTypes = [];
let activePorosityTypeId = "";
let porosityRecolorFrame = null;
let porosityActivityClearTimer = null;
let porosityProgressClearTimer = null;
let porosityUndoState = null;
let porosityEstimateGeneration = 0;
let porosityToleranceReestimateTimer = null;
let porositySelectedTileSetIndices = [];
let porosityAnalysisResolutionMode = "balanced";
let samValidationState = {
  status: "untested",
  fingerprint: "",
};
let samAutoValidationStarted = false;
let segmenteverygrainValidationState = {
  status: "untested",
  fingerprint: "",
};
let unsupervisedAoiModeActive = false;
let unsupervisedAoiDragState = null;
let unsupervisedAoiRect = null;
let unsupervisedSegmentIsRunning = false;
let unsupervisedSegmentCancelRequested = false;
let unsupervisedSegmentRunId = 0;
let unsupervisedSegmentLastProgressPercent = 0;
let segmentBoxModeActive = false;
let segmentBoxDragState = null;
let segmentPromptBox = null;
let segmentPromptPoints = [];
let segmentPointMode = null;
let segmentPreviewFeature = null;
let segmentIsRunning = false;
let segmentActiveRunCount = 0;
let segmentModeActive = false;
let segmentAutoAddUserChecked = false;
const SNAPSHOT_MAX_OUTPUT_DIMENSION = 16000;
const SNAPSHOT_MAX_OUTPUT_PIXELS = 100000000;
const POROSITY_MAX_ANALYSIS_DIMENSION = 12000;
const POROSITY_MAX_ANALYSIS_PIXELS = 36000000;
const POROSITY_ANALYSIS_RESOLUTION_MODES = {
  preview: {
    label: "Fast preview",
    targetScale: 0.25,
    maxDimension: 3000,
    maxPixels: 4000000,
  },
  balanced: {
    label: "Balanced",
    targetScale: 0.5,
    maxDimension: 6000,
    maxPixels: 12000000,
  },
  high: {
    label: "High detail",
    targetScale: 0.75,
    maxDimension: 9000,
    maxPixels: 24000000,
  },
  maximum: {
    label: "Maximum available",
    targetScale: 1,
    maxDimension: POROSITY_MAX_ANALYSIS_DIMENSION,
    maxPixels: POROSITY_MAX_ANALYSIS_PIXELS,
  },
};
const TOOL_PALETTE_EDGE_MARGIN = 5;
const TOOL_PALETTE_MIN_VISIBLE_WIDTH = 80;
const TOOL_PALETTE_MIN_VISIBLE_HEIGHT = 32;
const TOOL_PALETTE_EDGE_SNAP_DISTANCE = 18;
let toolPaletteClampFrame = null;

function getToolPaletteEdgeAffinity(palette, containerRect, paletteRect) {
  const left = Number.parseFloat(
    palette.style.left || String(TOOL_PALETTE_EDGE_MARGIN)
  );
  const top = Number.parseFloat(palette.style.top || "56");
  const rightGap = containerRect.width - left - paletteRect.width;
  const bottomGap = containerRect.height - top - paletteRect.height;

  return {
    horizontal:
      rightGap <= TOOL_PALETTE_EDGE_SNAP_DISTANCE &&
      rightGap <= left
        ? "right"
        : "left",
    vertical:
      bottomGap <= TOOL_PALETTE_EDGE_SNAP_DISTANCE &&
      bottomGap <= top
        ? "bottom"
        : "top",
  };
}

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

function getReservedRectForElement(element, containerRect, kind = "generic") {
  if (!element || element.hidden) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const leftMargin =
    kind === "corner-actions"
      ? Math.max(1, Math.floor(TOOL_PALETTE_EDGE_MARGIN / 2))
      : TOOL_PALETTE_EDGE_MARGIN;
  return {
    kind,
    left: rect.left - containerRect.left - leftMargin,
    top: rect.top - containerRect.top - TOOL_PALETTE_EDGE_MARGIN,
    right: rect.right - containerRect.left + TOOL_PALETTE_EDGE_MARGIN,
    bottom: rect.bottom - containerRect.top + TOOL_PALETTE_EDGE_MARGIN,
  };
}

function getToolPaletteReservedRects() {
  const viewerContainer = document.getElementById("viewer-container");
  if (!viewerContainer) return [];

  const containerRect = viewerContainer.getBoundingClientRect();
  return [
    {
      element: controlsPanel || document.querySelector(".controls"),
      kind: "controls",
    },
    {
      element: document.querySelector(".viewer-corner-actions"),
      kind: "corner-actions",
    },
  ]
    .map(({ element, kind }) =>
      getReservedRectForElement(element, containerRect, kind)
    )
    .filter(Boolean);
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

  if (reservedRect.kind === "corner-actions") {
    const wasHorizontallyOverlapping =
      previousBounds.right > reservedRect.left &&
      previousBounds.left < reservedRect.right;
    const wasVerticallyOverlapping =
      previousBounds.bottom > reservedRect.top &&
      previousBounds.top < reservedRect.bottom;

    if (!wasHorizontallyOverlapping && wasVerticallyOverlapping) {
      if (previousBounds.right <= reservedRect.left) {
        nextLeft = reservedRect.left - paletteRect.width;
      } else if (previousBounds.left >= reservedRect.right) {
        nextLeft = reservedRect.right;
      }
      return { left: nextLeft, top: nextTop };
    }

    if (wasHorizontallyOverlapping && !wasVerticallyOverlapping) {
      if (previousBounds.bottom <= reservedRect.top) {
        nextTop = reservedRect.top - paletteRect.height;
      } else if (previousBounds.top >= reservedRect.bottom) {
        nextTop = reservedRect.bottom;
      }
      return { left: nextLeft, top: nextTop };
    }
  }

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
  const reservedRects = getToolPaletteReservedRects();
  const reservedRect = reservedRects.find((rect) =>
    rectsOverlap(getPaletteBounds(left, top, paletteRect), rect)
  );
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
  const reservedRects = getToolPaletteReservedRects();
  if (reservedRects.length === 0) return { left, top };

  let nextLeft = left;
  let nextTop = top;
  for (const reservedRect of reservedRects) {
    if (!rectsOverlap(getPaletteBounds(nextLeft, nextTop, paletteRect), reservedRect)) {
      continue;
    }

    if (options.previousPosition) {
      const previousBounds = getPaletteBounds(
        options.previousPosition.left,
        options.previousPosition.top,
        paletteRect
      );
      if (
        reservedRect.kind === "corner-actions" &&
        !rectsOverlap(previousBounds, reservedRect)
      ) {
        return {
          left: Math.min(
            Math.max(options.previousPosition.left, TOOL_PALETTE_EDGE_MARGIN),
            maxLeft
          ),
          top: Math.min(
            Math.max(options.previousPosition.top, TOOL_PALETTE_EDGE_MARGIN),
            maxTop
          ),
        };
      }

      const dragPosition = resolveControlsDragCollision(
        nextLeft,
        nextTop,
        paletteRect,
        reservedRect,
        options.previousPosition
      );
      nextLeft = dragPosition.left;
      nextTop = dragPosition.top;
    } else {
      const autoPosition = resolveControlsAutoCollision(
        nextLeft,
        nextTop,
        paletteRect,
        maxLeft,
        maxTop
      );
      nextLeft = autoPosition.left;
      nextTop = autoPosition.top;
    }

    nextLeft = Math.min(Math.max(nextLeft, TOOL_PALETTE_EDGE_MARGIN), maxLeft);
    nextTop = Math.min(Math.max(nextTop, TOOL_PALETTE_EDGE_MARGIN), maxTop);
  }

  return { left: nextLeft, top: nextTop };
}

function clampToolPaletteToViewer(palette) {
  const viewerContainer = document.getElementById("viewer-container");
  if (!viewerContainer || !palette) return;

  const containerRect = viewerContainer.getBoundingClientRect();
  const paletteRect = palette.getBoundingClientRect();
  const edgeAffinity =
    palette.dataset.edgeHorizontal && palette.dataset.edgeVertical
      ? {
          horizontal: palette.dataset.edgeHorizontal,
          vertical: palette.dataset.edgeVertical,
        }
      : getToolPaletteEdgeAffinity(palette, containerRect, paletteRect);
  const paletteFitsX =
    paletteRect.width + TOOL_PALETTE_EDGE_MARGIN * 2 <= containerRect.width;
  const paletteFitsY =
    paletteRect.height + TOOL_PALETTE_EDGE_MARGIN * 2 <= containerRect.height;
  const maxLeft = Math.max(
    TOOL_PALETTE_EDGE_MARGIN,
    paletteFitsX
      ? containerRect.width - paletteRect.width - TOOL_PALETTE_EDGE_MARGIN
      : containerRect.width - TOOL_PALETTE_MIN_VISIBLE_WIDTH
  );
  const maxTop = Math.max(
    TOOL_PALETTE_EDGE_MARGIN,
    paletteFitsY
      ? containerRect.height - paletteRect.height - TOOL_PALETTE_EDGE_MARGIN
      : containerRect.height - TOOL_PALETTE_MIN_VISIBLE_HEIGHT
  );
  const currentLeft = Number.parseFloat(
    palette.style.left || String(TOOL_PALETTE_EDGE_MARGIN)
  );
  const currentTop = Number.parseFloat(palette.style.top || "56");
  const preferredLeft =
    edgeAffinity.horizontal === "right" && paletteFitsX
      ? containerRect.width - paletteRect.width - TOOL_PALETTE_EDGE_MARGIN
      : currentLeft;
  const preferredTop =
    edgeAffinity.vertical === "bottom" && paletteFitsY
      ? containerRect.height - paletteRect.height - TOOL_PALETTE_EDGE_MARGIN
      : currentTop;

  const nextLeft = Math.min(
    Math.max(preferredLeft, TOOL_PALETTE_EDGE_MARGIN),
    maxLeft
  );
  const nextTop = Math.min(
    Math.max(preferredTop, TOOL_PALETTE_EDGE_MARGIN),
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
  palette.dataset.edgeHorizontal = edgeAffinity.horizontal;
  palette.dataset.edgeVertical = edgeAffinity.vertical;
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
  palette.dataset.edgeHorizontal =
    defaultPosition === "bottom-left" ? "left" : "right";
  palette.dataset.edgeVertical = "bottom";
}

function restoreToolPalettePosition(palette, storageKey) {
  if (!palette) return;

  try {
    const storedPosition = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (storedPosition) {
      palette.style.left = `${storedPosition.left}px`;
      palette.style.top = `${storedPosition.top}px`;
      palette.dataset.edgeHorizontal = storedPosition.edgeHorizontal || "";
      palette.dataset.edgeVertical = storedPosition.edgeVertical || "";
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
    const viewerContainer = document.getElementById("viewer-container");
    const containerRect = viewerContainer?.getBoundingClientRect();
    const paletteRect = palette.getBoundingClientRect();
    const affinity = containerRect
      ? getToolPaletteEdgeAffinity(palette, containerRect, paletteRect)
      : {
          horizontal: palette.dataset.edgeHorizontal || "left",
          vertical: palette.dataset.edgeVertical || "top",
        };
    palette.dataset.edgeHorizontal = affinity.horizontal;
    palette.dataset.edgeVertical = affinity.vertical;
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        left: Number.parseFloat(
          palette.style.left || String(TOOL_PALETTE_EDGE_MARGIN)
        ),
        top: Number.parseFloat(palette.style.top || "56"),
        edgeHorizontal: affinity.horizontal,
        edgeVertical: affinity.vertical,
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
    palette.dataset.edgeHorizontal = "";
    palette.dataset.edgeVertical = "";
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
  [
    gridCountPalette,
    annotatePalette,
    measurePalette,
    snapshotPalette,
    porosityPalette,
    segmentPalette,
  ].forEach((palette) => {
      if (palette && !palette.hidden) {
        clampToolPaletteToViewer(palette);
      }
    });
}

function scheduleClampOpenToolPalettes() {
  if (toolPaletteClampFrame !== null) return;
  toolPaletteClampFrame = requestAnimationFrame(() => {
    toolPaletteClampFrame = null;
    clampOpenToolPalettes();
  });
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
  if (!toolsMenu || !hasSharedViewerMenus) return;

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

  closeReferenceCircleSettingsPopover();
  closeMeasureColumnsMenu();
  closeMeasureHistogramMenu();
  closeMeasureScatterMenu();
  closeMeasureRoseMenu();
  closeMeasureParticleSizeMenu();
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

function openPorosityEstimator() {
  if (!porosityPalette) return;

  porosityPalette.hidden = false;
  restoreToolPalettePosition(porosityPalette, "petroImage.porosityPalette");
  openPorosityEstimatorButton?.setAttribute("aria-pressed", "true");
  restoreToolPaletteFromMinimized(
    porosityPalette,
    minimizePorosityPaletteButton
  );
  clampToolPaletteToViewer(porosityPalette);
  updatePorosityControls();
}

function closePorosityEstimator() {
  if (!porosityPalette) return;

  stopPorosityAoiMode();
  stopPorosityPickMode();
  porosityPalette.hidden = true;
  openPorosityEstimatorButton?.setAttribute("aria-pressed", "false");
}

function togglePorosityEstimator() {
  if (!porosityPalette || porosityPalette.hidden) {
    openPorosityEstimator();
    return;
  }

  closePorosityEstimator();
}

function getSamSettingsFromInputs() {
  return {
    pythonPath: samPythonPathInput?.value.trim() || "",
    checkpointPath: samCheckpointPathInput?.value.trim() || "",
    modelType: samModelTypeSelect?.value || "base_plus",
  };
}

function getSegmenteverygrainSettingsFromInputs() {
  return {
    modelPath: segmenteverygrainModelPathInput?.value.trim() || "",
  };
}

function getSamSettingsFingerprint(settings = getSamSettingsFromInputs()) {
  return JSON.stringify({
    pythonPath: settings.pythonPath || "",
    checkpointPath: settings.checkpointPath || "",
    modelType: settings.modelType || "base_plus",
  });
}

function updateSamReadinessIndicator(status = samValidationState.status) {
  if (!samSetupReadiness) return;

  const settings = getSamSettingsFromInputs();
  const currentFingerprint = getSamSettingsFingerprint(settings);
  let effectiveStatus = status;
  if (!settings.pythonPath || !settings.checkpointPath) {
    effectiveStatus = "error";
  } else if (
    samValidationState.status === "ready" &&
    samValidationState.fingerprint !== currentFingerprint
  ) {
    effectiveStatus = "changed";
  } else if (
    samValidationState.status === "error" &&
    samValidationState.fingerprint !== currentFingerprint
  ) {
    effectiveStatus = "untested";
  }

  const readinessByStatus = {
    ready: {
      text: "✓",
      label: "SAM setup ready",
      className: "sam-readiness-ready",
    },
    error: {
      text: "X",
      label: "SAM setup needs attention",
      className: "sam-readiness-error",
    },
    testing: {
      text: "...",
      label: "Testing SAM setup",
      className: "sam-readiness-testing",
    },
    changed: {
      text: "?",
      label: "SAM settings changed. Test SAM again.",
      className: "sam-readiness-untested",
    },
    untested: {
      text: "?",
      label: "SAM setup has not been tested",
      className: "sam-readiness-untested",
    },
  };
  const readiness =
    readinessByStatus[effectiveStatus] || readinessByStatus.untested;

  samSetupReadiness.textContent = readiness.text;
  samSetupReadiness.setAttribute("aria-label", readiness.label);
  samSetupReadiness.title = readiness.label;
  samSetupReadiness.className = `sam-readiness ${readiness.className}`;
}

function getSegmenteverygrainSettingsFingerprint() {
  const settings = getSegmenteverygrainSettingsFromInputs();
  return JSON.stringify({
    pythonPath: getSamSettingsFromInputs().pythonPath || "",
    modelPath: settings.modelPath || "",
  });
}

function updateSegmenteverygrainReadinessIndicator(
  status = segmenteverygrainValidationState.status
) {
  if (!segmenteverygrainSetupReadiness) return;

  const settings = getSamSettingsFromInputs();
  const currentFingerprint = getSegmenteverygrainSettingsFingerprint();
  let effectiveStatus = status;
  if (!settings.pythonPath) {
    effectiveStatus = "error";
  } else if (
    ["ready", "error"].includes(segmenteverygrainValidationState.status) &&
    segmenteverygrainValidationState.fingerprint !== currentFingerprint
  ) {
    effectiveStatus = "untested";
  }

  const readinessByStatus = {
    ready: {
      text: "✓",
      label: "segmenteverygrain setup ready",
      className: "sam-readiness-ready",
    },
    error: {
      text: "X",
      label: "segmenteverygrain setup needs attention",
      className: "sam-readiness-error",
    },
    testing: {
      text: "...",
      label: "Testing segmenteverygrain setup",
      className: "sam-readiness-testing",
    },
    untested: {
      text: "?",
      label: "segmenteverygrain setup has not been tested",
      className: "sam-readiness-untested",
    },
  };
  const readiness =
    readinessByStatus[effectiveStatus] || readinessByStatus.untested;

  segmenteverygrainSetupReadiness.textContent = readiness.text;
  segmenteverygrainSetupReadiness.setAttribute("aria-label", readiness.label);
  segmenteverygrainSetupReadiness.title = readiness.label;
  segmenteverygrainSetupReadiness.className = `sam-readiness ${readiness.className}`;
}

function shouldAutoValidateSamSetup() {
  if (samAutoValidationStarted || !window.electronAPI?.validateSamSetup) {
    return false;
  }

  const settings = getSamSettingsFromInputs();
  if (!settings.pythonPath || !settings.checkpointPath) return false;

  const currentFingerprint = getSamSettingsFingerprint(settings);
  if (samValidationState.fingerprint === currentFingerprint) {
    return samValidationState.status === "untested";
  }

  return true;
}

function normalizeSamModelTypeForUi(modelType) {
  const legacyModelTypes = {
    vit_b: "base_plus",
    vit_l: "large",
    vit_h: "large",
  };
  const normalizedModelType = legacyModelTypes[modelType] || modelType;
  return ["tiny", "small", "base_plus", "large"].includes(normalizedModelType)
    ? normalizedModelType
    : "base_plus";
}

function getSamValidationStateFromSettings(settings = {}) {
  const validation = settings.validation || {};
  if (
    !["ready", "error"].includes(validation.status) ||
    typeof validation.fingerprint !== "string" ||
    !validation.fingerprint
  ) {
    return {
      status: "untested",
      fingerprint: "",
    };
  }

  return {
    status: validation.status,
    fingerprint: validation.fingerprint,
  };
}

function getSegmenteverygrainValidationStateFromSettings(settings = {}) {
  const validation = settings.validation || {};
  if (
    !["ready", "error"].includes(validation.status) ||
    typeof validation.fingerprint !== "string" ||
    !validation.fingerprint
  ) {
    return {
      status: "untested",
      fingerprint: "",
    };
  }

  return {
    status: validation.status,
    fingerprint: validation.fingerprint,
  };
}

function setSamInputs(settings = {}) {
  if (samPythonPathInput) samPythonPathInput.value = settings.pythonPath || "";
  if (samCheckpointPathInput) {
    samCheckpointPathInput.value = settings.checkpointPath || "";
  }
  if (samModelTypeSelect) {
    samModelTypeSelect.value = normalizeSamModelTypeForUi(settings.modelType);
  }
  samValidationState = getSamValidationStateFromSettings(settings);
  updateSamReadinessIndicator();
  updateSegmenteverygrainReadinessIndicator();
}

function setSegmenteverygrainInputs(settings = {}) {
  if (segmenteverygrainModelPathInput) {
    segmenteverygrainModelPathInput.value = settings.modelPath || "";
  }
  segmenteverygrainValidationState =
    getSegmenteverygrainValidationStateFromSettings(settings);
  updateSegmenteverygrainReadinessIndicator();
  updateUnsupervisedSegmentControls();
}

function setSamSetupStatus(message, state = "") {
  if (!samSetupStatus) return;

  samSetupStatus.textContent = message;
  samSetupStatus.classList.toggle("segment-status-ok", state === "ok");
  samSetupStatus.classList.toggle("segment-status-error", state === "error");
}

function formatSamProbeResult(result) {
  const lines = [];
  if (result.pythonExecutable) {
    lines.push(`Python: ${result.pythonExecutable}`);
  }
  if (result.pythonVersion) lines.push(`Version: ${result.pythonVersion}`);
  if (result.modelType) lines.push(`Model: ${result.modelType}`);
  if (result.checkpointExists) {
    const sizeMb = result.checkpointSizeBytes
      ? `${(result.checkpointSizeBytes / 1024 / 1024).toFixed(1)} MB`
      : "found";
    lines.push(`Checkpoint: ${sizeMb}`);
  }
  const modules = result.modules || {};
  if (result.modelConfig) lines.push(`Config: ${result.modelConfig}`);
  [
    "torch",
    "torchvision",
    "sam2",
    "sam2.build_sam",
    "sam2.sam2_image_predictor",
    "hydra-core",
    "omegaconf",
    "opencv-python",
    "scikit-image",
  ].forEach((name) => {
    const moduleResult = modules[name];
    if (!moduleResult) return;
    const version = moduleResult.version ? ` ${moduleResult.version}` : "";
    lines.push(`${name}: ${moduleResult.available ? "ok" : "missing"}${version}`);
  });
  if (result.torch?.deviceRecommendation) {
    lines.push(`Device: ${result.torch.deviceRecommendation}`);
  }
  if (Array.isArray(result.warnings) && result.warnings.length > 0) {
    lines.push("", "Warnings:", ...result.warnings.map((warning) => `- ${warning}`));
  }
  if (Array.isArray(result.errors) && result.errors.length > 0) {
    lines.push("", "Errors:", ...result.errors.map((error) => `- ${error}`));
  }
  if (result.stderr) {
    lines.push("", "Python stderr:", result.stderr.trim());
  }
  return lines.join("\n");
}

function setSegmenteverygrainSetupStatus(message, state = "") {
  if (!segmenteverygrainSetupStatus) return;

  segmenteverygrainSetupStatus.textContent = message;
  segmenteverygrainSetupStatus.classList.toggle(
    "segment-status-ok",
    state === "ok"
  );
  segmenteverygrainSetupStatus.classList.toggle(
    "segment-status-error",
    state === "error"
  );
}

function formatSegmenteverygrainProbeResult(result) {
  const lines = [];
  if (result.pythonExecutable) {
    lines.push(`Python: ${result.pythonExecutable}`);
  }
  if (result.pythonVersion) lines.push(`Version: ${result.pythonVersion}`);
  if (result.modelExists) {
    const sizeMb = result.modelSizeBytes
      ? `${(result.modelSizeBytes / 1024 / 1024).toFixed(1)} MB`
      : "found";
    lines.push(`Model: ${sizeMb}`);
  }
  const modules = result.modules || {};
  ["segmenteverygrain", "tensorflow", "torch", "opencv-python", "scikit-image"].forEach(
    (name) => {
      const moduleResult = modules[name];
      if (!moduleResult) return;
      const version = moduleResult.version ? ` ${moduleResult.version}` : "";
      lines.push(`${name}: ${moduleResult.available ? "ok" : "missing"}${version}`);
    }
  );
  if (Array.isArray(result.warnings) && result.warnings.length > 0) {
    lines.push("", "Warnings:", ...result.warnings.map((warning) => `- ${warning}`));
  }
  if (Array.isArray(result.errors) && result.errors.length > 0) {
    lines.push("", "Errors:", ...result.errors.map((error) => `- ${error}`));
  }
  if (result.stderr) {
    lines.push("", "Python stderr:", result.stderr.trim());
  }
  return lines.join("\n");
}

async function testSegmenteverygrainSetup() {
  if (!window.electronAPI?.validateSegmenteverygrainSetup) return;

  const requestedSettings = getSamSettingsFromInputs();
  const requestedFingerprint = getSegmenteverygrainSettingsFingerprint();
  if (testSegmenteverygrainSetupButton) {
    testSegmenteverygrainSetupButton.disabled = true;
  }
  segmenteverygrainValidationState = {
    status: "testing",
    fingerprint: requestedFingerprint,
  };
  updateSegmenteverygrainReadinessIndicator("testing");
  setSegmenteverygrainSetupStatus("Testing segmenteverygrain setup...");
  try {
    const result =
      await window.electronAPI.validateSegmenteverygrainSetup({
        sam: requestedSettings,
        segmenteverygrain: getSegmenteverygrainSettingsFromInputs(),
      });
    if (result.segmenteverygrainSettings) {
      setSegmenteverygrainInputs(result.segmenteverygrainSettings);
    }
    segmenteverygrainValidationState = {
      status: result.ok ? "ready" : "error",
      fingerprint: requestedFingerprint,
    };
    updateSegmenteverygrainReadinessIndicator();
    setSegmenteverygrainSetupStatus(
      `${result.ok ? "segmenteverygrain looks ready." : "segmenteverygrain needs attention."}\n\n${formatSegmenteverygrainProbeResult(result)}`,
      result.ok ? "ok" : "error"
    );
  } catch (error) {
    console.error("segmenteverygrain setup test failed:", error);
    segmenteverygrainValidationState = {
      status: "error",
      fingerprint: requestedFingerprint,
    };
    updateSegmenteverygrainReadinessIndicator();
    setSegmenteverygrainSetupStatus(
      error.message || "segmenteverygrain setup test failed.",
      "error"
    );
  } finally {
    if (testSegmenteverygrainSetupButton) {
      testSegmenteverygrainSetupButton.disabled = false;
    }
  }
}

async function loadSamSettings() {
  if (!window.electronAPI?.getProjectSettings) return;

  try {
    const settings = await window.electronAPI.getProjectSettings();
    setSamInputs(settings.sam || {});
    setSegmenteverygrainInputs(settings.segmenteverygrain || {});
    if (shouldAutoValidateSamSetup()) {
      samAutoValidationStarted = true;
      testSamSetup({ automatic: true });
    }
  } catch (error) {
    console.warn("Could not load SAM settings:", error);
    setSamSetupStatus("Could not load SAM settings.", "error");
  }
}

async function saveSegmenteverygrainSettings(
  message = "segmenteverygrain settings saved."
) {
  if (!window.electronAPI?.saveSegmenteverygrainSettings) return null;

  const settings = getSegmenteverygrainSettingsFromInputs();
  try {
    const savedSettings =
      await window.electronAPI.saveSegmenteverygrainSettings(settings);
    setSegmenteverygrainInputs(savedSettings);
    setSegmenteverygrainSetupStatus(message);
    return savedSettings;
  } catch (error) {
    console.error("Could not save segmenteverygrain settings:", error);
    setSegmenteverygrainSetupStatus(
      error.message || "Could not save segmenteverygrain settings.",
      "error"
    );
    return null;
  }
}

async function saveSamSettings(message = "SAM settings saved.") {
  if (!window.electronAPI?.saveSamSettings) return null;

  const settings = getSamSettingsFromInputs();
  try {
    const savedSettings = await window.electronAPI.saveSamSettings(settings);
    setSamInputs(savedSettings);
    updateSamReadinessIndicator();
    setSamSetupStatus(message);
    return savedSettings;
  } catch (error) {
    console.error("Could not save SAM settings:", error);
    setSamSetupStatus(error.message || "Could not save SAM settings.", "error");
    return null;
  }
}

async function chooseSegmenteverygrainModel() {
  if (!window.electronAPI?.selectSegmenteverygrainModel) return;

  try {
    const result = await window.electronAPI.selectSegmenteverygrainModel();
    if (result?.canceled) return;
    if (result?.error) {
      setSegmenteverygrainSetupStatus(result.error, "error");
      return;
    }
    setSegmenteverygrainInputs(
      result.settings || {
        ...getSegmenteverygrainSettingsFromInputs(),
        modelPath: result.filePath,
      }
    );
    setSegmenteverygrainSetupStatus("segmenteverygrain model selected.");
  } catch (error) {
    console.error("Could not choose segmenteverygrain model:", error);
    setSegmenteverygrainSetupStatus(
      error.message || "Could not choose segmenteverygrain model.",
      "error"
    );
  }
}

async function chooseSamPython() {
  if (!window.electronAPI?.selectSamPython) return;

  try {
    const result = await window.electronAPI.selectSamPython();
    if (result?.canceled) return;
    setSamInputs(result.settings || { ...getSamSettingsFromInputs(), pythonPath: result.filePath });
    updateSamReadinessIndicator();
    setSamSetupStatus("Python executable selected.");
  } catch (error) {
    console.error("Could not choose SAM Python:", error);
    setSamSetupStatus(error.message || "Could not choose Python.", "error");
  }
}

async function chooseSamCheckpoint() {
  if (!window.electronAPI?.selectSamCheckpoint) return;

  try {
    const result = await window.electronAPI.selectSamCheckpoint();
    if (result?.canceled) return;
    setSamInputs(
      result.settings || { ...getSamSettingsFromInputs(), checkpointPath: result.filePath }
    );
    updateSamReadinessIndicator();
    setSamSetupStatus("SAM checkpoint selected.");
  } catch (error) {
    console.error("Could not choose SAM checkpoint:", error);
    setSamSetupStatus(error.message || "Could not choose checkpoint.", "error");
  }
}

async function testSamSetup(options = {}) {
  if (!window.electronAPI?.validateSamSetup) return;

  const requestedSettings = getSamSettingsFromInputs();
  const requestedFingerprint = getSamSettingsFingerprint(requestedSettings);
  testSamSetupButton.disabled = true;
  samValidationState = {
    status: "testing",
    fingerprint: requestedFingerprint,
  };
  updateSamReadinessIndicator("testing");
  setSamSetupStatus(
    options.automatic ? "Checking saved SAM setup..." : "Testing SAM setup..."
  );
  try {
    const result = await window.electronAPI.validateSamSetup(requestedSettings);
    const resultSettings = result.settings || requestedSettings;
    const resultFingerprint = getSamSettingsFingerprint(resultSettings);
    const currentFingerprint = getSamSettingsFingerprint();
    const settingsStillCurrent = currentFingerprint === requestedFingerprint;
    if (settingsStillCurrent) {
      setSamInputs(resultSettings);
    }
    samValidationState = {
      status: result.ok ? "ready" : "error",
      fingerprint: resultFingerprint,
    };
    updateSamReadinessIndicator();
    if (settingsStillCurrent) {
      setSamSetupStatus(
        `${result.ok ? "SAM setup looks ready." : "SAM setup needs attention."}\n\n${formatSamProbeResult(result)}`,
        result.ok ? "ok" : "error"
      );
    } else {
      setSamSetupStatus("SAM settings changed. Test SAM again.");
    }
  } catch (error) {
    console.error("SAM setup test failed:", error);
    samValidationState = {
      status: "error",
      fingerprint: getSamSettingsFingerprint(),
    };
    updateSamReadinessIndicator();
    setSamSetupStatus(error.message || "SAM setup test failed.", "error");
  } finally {
    testSamSetupButton.disabled = false;
  }
}

function setSegmentStatus(message, state = "") {
  if (!segmentStatus) return;

  segmentStatus.textContent = message;
  segmentStatus.classList.toggle("segment-status-ok", state === "ok");
  segmentStatus.classList.toggle("segment-status-error", state === "error");
}

function setUnsupervisedSegmentStatus(message, state = "") {
  if (!unsupervisedSegmentStatus) return;

  unsupervisedSegmentStatus.textContent = message;
  unsupervisedSegmentStatus.classList.toggle(
    "segment-status-ok",
    state === "ok"
  );
  unsupervisedSegmentStatus.classList.toggle(
    "segment-status-error",
    state === "error"
  );
}

function setUnsupervisedSegmentProgress(percent, options = {}) {
  if (!unsupervisedSegmentProgress || !unsupervisedSegmentProgressBar) return;

  const { indeterminate = false } = options;
  unsupervisedSegmentProgress.hidden = false;
  unsupervisedSegmentProgress.classList.toggle(
    "segment-progress-indeterminate",
    indeterminate
  );
  if (!indeterminate) {
    const clampedPercent = Math.max(0, Math.min(100, Number(percent) || 0));
    unsupervisedSegmentProgressBar.style.width = `${clampedPercent}%`;
  }
}

function hideUnsupervisedSegmentProgress() {
  if (!unsupervisedSegmentProgress || !unsupervisedSegmentProgressBar) return;
  unsupervisedSegmentProgress.hidden = true;
  unsupervisedSegmentProgress.classList.remove("segment-progress-indeterminate");
  unsupervisedSegmentProgressBar.style.width = "0%";
  unsupervisedSegmentLastProgressPercent = 0;
}

function handleSegmenteverygrainProgress(payload = {}) {
  if (!unsupervisedSegmentIsRunning) return;

  const percent = Number(payload.percent);
  const hasPercent = Number.isFinite(percent);
  const nextPercent = hasPercent
    ? Math.max(unsupervisedSegmentLastProgressPercent, percent)
    : 0;
  if (hasPercent) {
    unsupervisedSegmentLastProgressPercent = nextPercent;
  }
  setUnsupervisedSegmentProgress(nextPercent, {
    indeterminate: !hasPercent,
  });
  if (payload.message) {
    setUnsupervisedSegmentStatus(payload.message);
  }
}

function updateSegmentControls() {
  if (segmentDrawBoxButton) {
    segmentDrawBoxButton.disabled = segmentModeActive || segmentIsRunning;
    segmentDrawBoxButton.textContent = segmentBoxModeActive ? "Drawing..." : "+ Box";
  }
  if (segmentModeToggle) {
    segmentModeToggle.checked = segmentModeActive;
  }
  if (segmentAutoAddCheckbox) {
    segmentAutoAddCheckbox.disabled = segmentModeActive;
    segmentAutoAddCheckbox.checked = segmentModeActive || segmentAutoAddUserChecked;
  }
  if (segmentClearButton) {
    segmentClearButton.disabled =
      segmentModeActive ||
      segmentIsRunning ||
      (!segmentBoxModeActive &&
        !segmentPreviewFeature &&
        !segmentPromptBox &&
        segmentPromptPoints.length === 0);
  }
  if (segmentAddPositivePointButton) {
    segmentAddPositivePointButton.disabled = segmentModeActive || segmentIsRunning;
    segmentAddPositivePointButton.classList.toggle(
      "active",
      segmentPointMode === "positive"
    );
  }
  if (segmentAddNegativePointButton) {
    segmentAddNegativePointButton.disabled = segmentModeActive || segmentIsRunning;
    segmentAddNegativePointButton.classList.toggle(
      "active",
      segmentPointMode === "negative"
    );
  }
  if (segmentAddAnnotationButton) {
    segmentAddAnnotationButton.disabled =
      segmentModeActive || segmentIsRunning || !segmentPreviewFeature;
  }
  updateUnsupervisedSegmentControls();
}

function updateUnsupervisedSegmentControls() {
  const setupReady = segmenteverygrainValidationState.status === "ready";
  const hasAoi = Boolean(unsupervisedAoiRect);
  updateUnsupervisedAoiStats();
  if (unsupervisedDrawAoiButton) {
    unsupervisedDrawAoiButton.disabled = unsupervisedSegmentIsRunning;
    unsupervisedDrawAoiButton.textContent = unsupervisedAoiModeActive
      ? "Drawing..."
      : "Draw AOI";
  }
  if (unsupervisedClearAoiButton) {
    unsupervisedClearAoiButton.disabled =
      unsupervisedSegmentIsRunning || (!hasAoi && !unsupervisedAoiModeActive);
  }
  if (runUnsupervisedSegmentationButton) {
    runUnsupervisedSegmentationButton.disabled =
      unsupervisedSegmentIsRunning || !setupReady || !hasAoi;
  }
  if (cancelUnsupervisedSegmentationButton) {
    cancelUnsupervisedSegmentationButton.hidden = !unsupervisedSegmentIsRunning;
    cancelUnsupervisedSegmentationButton.disabled =
      !unsupervisedSegmentIsRunning || unsupervisedSegmentCancelRequested;
  }
}

function refreshUnsupervisedAoiPreviewAndControls() {
  if (unsupervisedAoiRect) {
    updateUnsupervisedAoiPreview();
  } else {
    updateUnsupervisedSegmentControls();
  }
}

async function cancelUnsupervisedSegmentation() {
  if (!unsupervisedSegmentIsRunning || unsupervisedSegmentCancelRequested) return;
  unsupervisedSegmentCancelRequested = true;
  setUnsupervisedSegmentStatus("Canceling segmenteverygrain...");
  updateUnsupervisedSegmentControls();
  try {
    await window.electronAPI?.cancelSegmenteverygrainSegmentation?.();
  } catch (error) {
    console.error("Could not cancel segmenteverygrain:", error);
  }
}

function throwIfUnsupervisedSegmentationCanceled(runId) {
  if (
    unsupervisedSegmentCancelRequested ||
    runId !== unsupervisedSegmentRunId
  ) {
    throw new Error("segmenteverygrain canceled.");
  }
}

function shouldAutoAddSegment() {
  return segmentModeActive || segmentAutoAddUserChecked;
}

function updateSegmentRunningState(delta) {
  segmentActiveRunCount = Math.max(0, segmentActiveRunCount + delta);
  segmentIsRunning = segmentActiveRunCount > 0;
  updateSegmentControls();
}

function getSegmentNumberInput(input, fallback, min, max) {
  const value = Number(input?.value);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function getSegmentPadding(promptRect) {
  const percent = getSegmentNumberInput(segmentPaddingPercentInput, 50, 0, 300);
  const minPadding = getSegmentNumberInput(segmentPaddingMinInput, 256, 0, 2048);
  const maxPadding = Math.max(
    minPadding,
    getSegmentNumberInput(segmentPaddingMaxInput, 512, 0, 4096)
  );
  const boxSize = Math.max(promptRect?.width || 0, promptRect?.height || 0);
  const relativePadding = boxSize * (percent / 100);
  return Math.round(Math.min(maxPadding, Math.max(minPadding, relativePadding)));
}

function updateSegmentPaddingStatus(promptRect = segmentPromptBox) {
  if (!segmentPaddingStatus) return;

  if (promptRect) {
    segmentPaddingStatus.textContent = `Current box padding: ${getSegmentPadding(
      promptRect
    )} px.`;
  } else {
    segmentPaddingStatus.textContent =
      "Padding is based on the larger box dimension.";
  }
}

function getSegmentSimplifyEpsilon() {
  if (!segmentSimplifyEnabledInput?.checked) return 0;

  const value = getSegmentNumberInput(segmentSimplifyEpsilonInput, 2, 0, 100);
  return Number(value.toFixed(3));
}

function updateSegmentSimplifyControls() {
  if (!segmentSimplifyEpsilonInput) return;
  segmentSimplifyEpsilonInput.disabled = !segmentSimplifyEnabledInput?.checked;
  if (unsupervisedSimplifyEpsilonInput) {
    unsupervisedSimplifyEpsilonInput.disabled =
      !unsupervisedSimplifyEnabledInput?.checked;
  }
}

function populateSegmentTileSetSelect() {
  if (!segmentTileSetSelect && !unsupervisedSegmentTileSetSelect) return;

  const selects = [
    segmentTileSetSelect,
    unsupervisedSegmentTileSetSelect,
  ].filter(Boolean);
  const previousValues = new Map(
    selects.map((select) => [select, select.value])
  );
  selects.forEach((select) => {
    select.innerHTML = "";
    tileSets().forEach((tileSet, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = getSnapshotTileSetLabel(tileSet, index);
      select.append(option);
    });
  });

  const checkedIndex = Array.from(
    document.querySelectorAll(".image-checkbox")
  ).findIndex((checkbox) => checkbox.checked);
  const fallbackValue = String(checkedIndex >= 0 ? checkedIndex : 0);

  selects.forEach((select) => {
    const previousValue = previousValues.get(select);
    const hasPrevious =
      previousValue !== "" &&
      Array.from(select.options).some((option) => option.value === previousValue);
    select.value = hasPrevious ? previousValue : fallbackValue;
  });
}

function getSegmentTileSetIndex() {
  const rawIndex = Number.parseInt(segmentTileSetSelect?.value || "0", 10);
  if (!Number.isFinite(rawIndex)) return 0;
  return Math.min(Math.max(rawIndex, 0), Math.max(tileSets().length - 1, 0));
}

function getUnsupervisedSegmentTileSetIndex() {
  const rawIndex = Number.parseInt(
    unsupervisedSegmentTileSetSelect?.value || "0",
    10
  );
  if (!Number.isFinite(rawIndex)) return 0;
  return Math.min(Math.max(rawIndex, 0), Math.max(tileSets().length - 1, 0));
}

function getViewerResolutionScaleForImageRect(imageRect) {
  const image = viewer.world.getItemAt(0);
  if (!image || !imageRect) return 1;

  const topLeft = image.imageToViewportCoordinates(imageRect.x, imageRect.y);
  const bottomRight = image.imageToViewportCoordinates(
    imageRect.x + imageRect.width,
    imageRect.y + imageRect.height
  );
  const screenTopLeft =
    viewer.viewport.viewportToViewerElementCoordinates(topLeft);
  const screenBottomRight =
    viewer.viewport.viewportToViewerElementCoordinates(bottomRight);
  const screenWidth = Math.abs(screenBottomRight.x - screenTopLeft.x);
  const screenHeight = Math.abs(screenBottomRight.y - screenTopLeft.y);
  const scaleX = screenWidth / Math.max(1, imageRect.width);
  const scaleY = screenHeight / Math.max(1, imageRect.height);
  const scale = Math.min(scaleX, scaleY);
  return Math.max(0.05, Math.min(1, scale || 1));
}

function getResolutionScaleFromSelect(select, imageRect) {
  const value = select?.value || "1";
  if (value === "viewer") return getViewerResolutionScaleForImageRect(imageRect);
  const scale = Number(value);
  return Number.isFinite(scale) ? Math.max(0.05, Math.min(1, scale)) : 1;
}

function getSegmentResolutionScale(imageRect) {
  return getResolutionScaleFromSelect(segmentResolutionSelect, imageRect);
}

function getUnsupervisedSimplifyEpsilon() {
  if (!unsupervisedSimplifyEnabledInput?.checked) return 0;

  const value = getSegmentNumberInput(
    unsupervisedSimplifyEpsilonInput,
    2,
    0,
    100
  );
  return Number(value.toFixed(3));
}

function getUnsupervisedViewerResolutionScale() {
  if (!unsupervisedAoiRect) return 1;
  return getViewerResolutionScaleForImageRect(unsupervisedAoiRect);
}

function getUnsupervisedResolutionScale() {
  return getResolutionScaleFromSelect(unsupervisedResolutionSelect, unsupervisedAoiRect);
}

function getUnsupervisedProcessingSize() {
  if (!unsupervisedAoiRect) {
    return {
      sourceWidth: 0,
      sourceHeight: 0,
      processedWidth: 0,
      processedHeight: 0,
      pixelCount: 0,
      scale: getUnsupervisedResolutionScale(),
    };
  }
  const scale = getUnsupervisedResolutionScale();
  const sourceWidth = Math.max(1, Math.round(unsupervisedAoiRect.width));
  const sourceHeight = Math.max(1, Math.round(unsupervisedAoiRect.height));
  const processedWidth = Math.max(1, Math.round(sourceWidth * scale));
  const processedHeight = Math.max(1, Math.round(sourceHeight * scale));
  return {
    sourceWidth,
    sourceHeight,
    processedWidth,
    processedHeight,
    pixelCount: processedWidth * processedHeight,
    scale,
  };
}

function formatSegmentPixels(value) {
  const number = Number(value) || 0;
  if (number >= 1000000) return `${(number / 1000000).toFixed(1)} MP`;
  return number.toLocaleString();
}

function getSegmentProcessingLoadClass(pixelCount) {
  const megapixels = (Number(pixelCount) || 0) / 1000000;
  if (megapixels > 100) return "segment-load-high";
  if (megapixels >= 20) return "segment-load-medium";
  return "segment-load-low";
}

function setSegmentProcessingLoadClass(elements, className = "") {
  elements.forEach((element) => {
    if (!element) return;
    element.classList.remove(
      "segment-load-low",
      "segment-load-medium",
      "segment-load-high"
    );
    if (className) element.classList.add(className);
  });
}

function updateUnsupervisedAoiStats() {
  if (
    !unsupervisedAoiSourcePixels ||
    !unsupervisedAoiProcessedPixels ||
    !unsupervisedAoiPixelCount
  ) {
    return;
  }

  if (!unsupervisedAoiRect) {
    unsupervisedAoiSourcePixels.textContent = "Draw AOI";
    unsupervisedAoiProcessedPixels.textContent = "-";
    unsupervisedAoiPixelCount.textContent = "-";
    setSegmentProcessingLoadClass([
      unsupervisedAoiProcessedPixels,
      unsupervisedAoiPixelCount,
    ]);
    return;
  }

  const size = getUnsupervisedProcessingSize();
  unsupervisedAoiSourcePixels.textContent = `${size.sourceWidth} x ${size.sourceHeight}`;
  unsupervisedAoiProcessedPixels.textContent = `${size.processedWidth} x ${size.processedHeight}`;
  unsupervisedAoiPixelCount.textContent = formatSegmentPixels(size.pixelCount);
  setSegmentProcessingLoadClass(
    [unsupervisedAoiProcessedPixels, unsupervisedAoiPixelCount],
    getSegmentProcessingLoadClass(size.pixelCount)
  );
}

function getUnsupervisedSegmentationOptions() {
  const patchSize = Math.round(
    getSegmentNumberInput(unsupervisedPatchSizeInput, 2000, 256, 8000)
  );
  const overlap = Math.round(
    getSegmentNumberInput(
      unsupervisedOverlapInput,
      300,
      0,
      Math.max(0, patchSize - 1)
    )
  );
  const minArea = getSegmentNumberInput(
    unsupervisedMinAreaInput,
    50,
    0,
    1000000
  );
  const dilation = Math.round(
    getSegmentNumberInput(unsupervisedDilationInput, 0, 0, 25)
  );

  return {
    useSam: unsupervisedUseSamRefinementInput?.checked !== false,
    minArea,
    patchSize,
    overlap,
    dilation,
    removeEdgeGrains: Boolean(unsupervisedRemoveEdgeGrainsInput?.checked),
  };
}

const UNSUPERVISED_PATCH_PREVIEW_MAX_PATCHES = 600;

function getPatchStartPositions(size, patchSize, stepSize) {
  const starts = [];
  for (let position = 0; position < size; position += stepSize) {
    starts.push(position);
    if (starts.length > UNSUPERVISED_PATCH_PREVIEW_MAX_PATCHES) break;
  }
  return starts;
}

function addUnsupervisedPatchGridPreview() {
  if (!unsupervisedShowPatchGridInput?.checked || !unsupervisedAoiRect) return;

  const size = getUnsupervisedProcessingSize();
  const options = getUnsupervisedSegmentationOptions();
  const scale = Math.max(0.05, size.scale || 1);
  const patchSize = Math.max(1, options.patchSize);
  const stepSize = Math.max(1, patchSize - options.overlap);
  const xStarts = getPatchStartPositions(size.processedWidth, patchSize, stepSize);
  const yStarts = getPatchStartPositions(size.processedHeight, patchSize, stepSize);
  const patchCount = xStarts.length * yStarts.length;

  if (patchCount > UNSUPERVISED_PATCH_PREVIEW_MAX_PATCHES) {
    return;
  }

  let patchIndex = 0;
  yStarts.forEach((processedY) => {
    xStarts.forEach((processedX) => {
      const processedWidth = Math.min(patchSize, size.processedWidth - processedX);
      const processedHeight = Math.min(patchSize, size.processedHeight - processedY);
      if (processedWidth <= 0 || processedHeight <= 0) return;
      patchIndex += 1;
      addPolygonToGeoJSON(
        annoJSONTemp,
        imageRectToPolygon({
          x: unsupervisedAoiRect.x + processedX / scale,
          y: unsupervisedAoiRect.y + processedY / scale,
          width: processedWidth / scale,
          height: processedHeight / scale,
        }),
        {
          uuid: `segmenteverygrain-patch-${patchIndex}`,
          label: "segmenteverygrain patch",
          shapeType: "segment-patch-preview",
          lineStyle: "solid",
          lineWeight: 1,
          lineColor: "#555555",
          lineOpacity: 0.32,
          fillColor: "#777777",
          fillOpacity: 0.075,
        }
      );
    });
  });
}

function getSegmentTileSetActiveTileDescriptors(tileSet, tileSetIndex = 0) {
  if (!tileSet?.tiles?.length) return [];
  const tiles = tileSet.tiles;
  const periodDegrees = tileSet.periodDegrees;

  if (!periodDegrees) {
    const index = getTileSetVisibleTileIndex(tileSetIndex);
    const tile = tiles[index];
    return tile?.uri ? [{ uri: tile.uri, opacity: 1 }] : [];
  }

  const stageRotationInput = document.getElementById("stageRotation");
  const rawRotation = rotateWithStage?.checked
    ? viewer.viewport.getRotation(true)
    : Number(stageRotationInput?.value || 0);
  const rotation = ((rawRotation % periodDegrees) + periodDegrees) % periodDegrees;
  let supremumIndex = 0;
  for (let index = 0; index < tiles.length; index += 1) {
    if (Number(tiles[index].angleDegrees || 0) > rotation) {
      supremumIndex = index;
      break;
    }
  }
  const infimumIndex = supremumIndex === 0 ? tiles.length - 1 : supremumIndex - 1;
  const supremum = Number(tiles[supremumIndex]?.angleDegrees || 0) +
    (supremumIndex === 0 ? periodDegrees : 0);
  const infimum = Number(tiles[infimumIndex]?.angleDegrees || 0);
  const t = (rotation - infimum) / Math.max(1, supremum - infimum);

  return [
    { tile: tiles[infimumIndex], opacity: 1 - t },
    { tile: tiles[supremumIndex], opacity: t },
  ]
    .filter(({ tile, opacity }) => tile?.uri && opacity > 0)
    .map(({ tile, opacity }) => ({ uri: tile.uri, opacity }));
}

function getUnsupervisedTileJob(resolutionScale) {
  const tileSetIndex = getUnsupervisedSegmentTileSetIndex();
  const tileSet = tileSets()[tileSetIndex] || null;
  return {
    imageRect: {
      x: unsupervisedAoiRect.x,
      y: unsupervisedAoiRect.y,
      width: unsupervisedAoiRect.width,
      height: unsupervisedAoiRect.height,
    },
    outputScale: resolutionScale,
    tiles: getSegmentTileSetActiveTileDescriptors(tileSet, tileSetIndex),
  };
}

function canUsePythonTileStitching(tileJob) {
  return (
    tileJob?.tiles?.length > 0 &&
    tileJob.tiles.every((tile) => isPythonStitchableTileUri(tile.uri))
  );
}

function isPythonStitchableTileUri(uri) {
  if (isLocalTileSourcePath(uri)) return true;
  if (typeof uri !== "string") return false;
  if (/^file:\/\//i.test(uri)) return /\.dzi$/i.test(uri);
  if (!/^https?:\/\//i.test(uri)) return false;
  try {
    const parsed = new URL(uri);
    const isLocalHost =
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "::1";
    return isLocalHost && parsed.pathname === "/local-file";
  } catch {
    return false;
  }
}

function populateSegmentAnnotationGroupOptions() {
  if (!segmentAnnotationGroupOptions) return;

  const previousValue = segmentAnnotationGroupInput?.value.trim() || "";
  const selectedGroupName = getSelectedGroupFromDropdown()?.groupName || "";
  segmentAnnotationGroupOptions.innerHTML = "";
  getAnnotationGroups().forEach((group) => {
    const option = document.createElement("option");
    option.value = group.groupName;
    option.label = group.groupName;
    segmentAnnotationGroupOptions.append(option);
  });

  if (segmentAnnotationGroupInput && !previousValue && selectedGroupName) {
    segmentAnnotationGroupInput.value = selectedGroupName;
  }
}

function getSegmentAnnotationGroup() {
  const groupName = segmentAnnotationGroupInput?.value.trim() || "";
  if (!groupName) return getSelectedGroupFromDropdown();

  return getOrCreateAnnotationGroup(groupName);
}

function imageRectFromPixelBox(startPixel, endPixel) {
  const image = viewer.world.getItemAt(0);
  if (!image) return null;

  const left = Math.min(startPixel.x, endPixel.x);
  const top = Math.min(startPixel.y, endPixel.y);
  const right = Math.max(startPixel.x, endPixel.x);
  const bottom = Math.max(startPixel.y, endPixel.y);

  const topLeft = image.viewportToImageCoordinates(
    viewer.viewport.pointFromPixel(new OpenSeadragon.Point(left, top))
  );
  const bottomRight = image.viewportToImageCoordinates(
    viewer.viewport.pointFromPixel(new OpenSeadragon.Point(right, bottom))
  );
  const x0 = Math.min(topLeft.x, bottomRight.x);
  const y0 = Math.min(topLeft.y, bottomRight.y);
  const x1 = Math.max(topLeft.x, bottomRight.x);
  const y1 = Math.max(topLeft.y, bottomRight.y);
  return {
    x: x0,
    y: y0,
    width: x1 - x0,
    height: y1 - y0,
  };
}

function imageRectToPolygon(rect) {
  return [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height],
    [rect.x, rect.y + rect.height],
    [rect.x, rect.y],
  ];
}

function getSegmentPromptBounds(promptRect, promptPoints = segmentPromptPoints) {
  const xs = [];
  const ys = [];
  if (promptRect) {
    xs.push(promptRect.x, promptRect.x + promptRect.width);
    ys.push(promptRect.y, promptRect.y + promptRect.height);
  }
  promptPoints.forEach((point) => {
    xs.push(point.x);
    ys.push(point.y);
  });
  if (xs.length === 0 || ys.length === 0) return null;

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function getPaddedSegmentCropRect(promptRect) {
  const image = viewer.world.getItemAt(0);
  const promptBounds = getSegmentPromptBounds(promptRect);
  if (!image || !promptBounds) return null;

  const imageSize = image.getContentSize();
  const padding = getSegmentPadding(promptBounds);
  const x = Math.max(0, Math.floor(promptBounds.x - padding));
  const y = Math.max(0, Math.floor(promptBounds.y - padding));
  const right = Math.min(
    imageSize.x,
    Math.ceil(promptBounds.x + promptBounds.width + padding)
  );
  const bottom = Math.min(
    imageSize.y,
    Math.ceil(promptBounds.y + promptBounds.height + padding)
  );
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

function addSegmentPromptPointFeatures() {
  segmentPromptPoints.forEach((point, index) => {
    annoJSONTemp.features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [point.x, point.y],
      },
      properties: {
        uuid: `segment-prompt-point-${index}`,
        shapeType: "segment-prompt-point",
        pointLabel: point.label,
        lineColor: point.label === 1 ? "#0f9d58" : "#d93025",
        fillColor: point.label === 1 ? "#0f9d58" : "#d93025",
      },
    });
  });
}

function canvasToPngDataUrl(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not encode the segmentation crop."));
        return;
      }
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(reader.result));
      reader.addEventListener("error", () =>
        reject(new Error("Could not read the segmentation crop."))
      );
      reader.readAsDataURL(blob);
    }, "image/png");
  });
}

function clearSegmentPreview(options = {}) {
  const { message = "Draw a box around one feature.", keepMode = true } = options;
  segmentBoxModeActive = false;
  segmentBoxDragState = null;
  segmentPromptBox = null;
  segmentPromptPoints = [];
  segmentPointMode = null;
  segmentPreviewFeature = null;
  if (!keepMode) {
    segmentModeActive = false;
  }
  updateSegmentPaddingStatus(null);
  annoJSONTemp = {
    type: "FeatureCollection",
    features: [],
  };
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  setSegmentStatus(message);
  updateSegmentControls();
}

function updateSegmentPromptPreview(promptRect = segmentPromptBox) {
  updateSegmentPaddingStatus(promptRect);
  annoJSONTemp = {
    type: "FeatureCollection",
    features: [],
  };
  if (promptRect) {
    addPolygonToGeoJSON(annoJSONTemp, imageRectToPolygon(promptRect), {
      uuid: "segment-prompt-box",
      label: "SAM prompt",
      shapeType: "segment-prompt",
      lineStyle: "dashed",
      lineWeight: 2,
      lineColor: "#00a6d6",
      lineOpacity: 0.95,
      fillColor: "#00a6d6",
      fillOpacity: 0.08,
    });
  }
  if (segmentPreviewFeature) {
    annoJSONTemp.features.push(segmentPreviewFeature);
  }
  addSegmentPromptPointFeatures();
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
}

function buildSegmentFeature(fullImagePolygon, result) {
  const style = getCurrentAnnotationStyleColors();
  const labelFontSize = Number(document.getElementById("annoLabelFontSize").value);
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [fullImagePolygon],
    },
    properties: {
      uuid: "segment-preview",
      label: "Segment preview",
      shapeType: "segment",
      labelFontSize,
      labelFontColor: style.labelFontColor,
      labelBackgroundColor: style.labelBackgroundColor,
      labelBackgroundOpacity: getAnnotationOpacityValue("annoLabelBackgroundOpacity"),
      lineStyle: "solid",
      lineWeight: Math.max(2, Number(document.getElementById("lineWeight").value)),
      lineColor: "#00d6d6",
      lineOpacity: 0.95,
      fillColor: "#00d6d6",
      fillOpacity: 0.22,
      segmentationBackend: "sam2",
      segmentationModel: result.modelType || getSamSettingsFromInputs().modelType,
      segmentationModelConfig: result.modelConfig || "",
      segmentationPromptType: "box",
      segmentationScore: result.score,
    },
  };
}

function previewSegmentPolygon(fullImagePolygon, result) {
  const feature = buildSegmentFeature(fullImagePolygon, result);

  segmentPreviewFeature = feature;
  annoJSONTemp = {
    type: "FeatureCollection",
    features: [],
  };
  if (segmentPromptBox) {
    addPolygonToGeoJSON(annoJSONTemp, imageRectToPolygon(segmentPromptBox), {
      uuid: "segment-prompt-box",
      label: "SAM prompt",
      shapeType: "segment-prompt",
      lineStyle: "dashed",
      lineWeight: 2,
      lineColor: "#00a6d6",
      lineOpacity: 0.65,
      fillColor: "#00a6d6",
      fillOpacity: 0.04,
    });
  }
  annoJSONTemp.features.push(feature);
  addSegmentPromptPointFeatures();
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
}

function getSegmentPromptSummary() {
  const positiveCount = segmentPromptPoints.filter((point) => point.label === 1).length;
  const negativeCount = segmentPromptPoints.filter((point) => point.label === 0).length;
  const parts = [];
  if (segmentPromptBox) parts.push("box");
  if (positiveCount > 0) parts.push(`${positiveCount} + point${positiveCount === 1 ? "" : "s"}`);
  if (negativeCount > 0) parts.push(`${negativeCount} - point${negativeCount === 1 ? "" : "s"}`);
  return parts.length ? ` Prompts: ${parts.join(", ")}.` : "";
}

function startSegmentBoxMode() {
  if (segmentIsRunning) return;

  clearSegmentPreview({ message: "Drag a box around one feature.", keepMode: true });
  segmentBoxModeActive = true;
  deactivateAnnotationModes();
  stopSnapshotDrawMode({ clearSelection: false });
  if (typeof stopMeasurementMode === "function") stopMeasurementMode();
  setSegmentStatus("Drag a box around one feature.");
  updateSegmentControls();
}

function setSegmentPointMode(mode) {
  if (segmentModeActive || segmentIsRunning) return;

  segmentPointMode = segmentPointMode === mode ? null : mode;
  if (segmentPointMode) {
    deactivateAnnotationModes();
    stopSnapshotDrawMode({ clearSelection: false });
    if (typeof stopMeasurementMode === "function") stopMeasurementMode();
    setSegmentStatus(
      segmentPointMode === "positive"
        ? "Click inside the feature to add a positive point."
        : "Click outside the feature to add a negative point."
    );
  } else {
    setSegmentStatus("Draw a box around one feature.");
  }
  updateSegmentControls();
}

function getSegmentImagePointFromCanvasEvent(event) {
  const image = viewer.world.getItemAt(0);
  if (!image) return null;

  const viewportPoint = viewer.viewport.pointFromPixel(event.position);
  const imagePoint = image.viewportToImageCoordinates(
    viewportPoint.x,
    viewportPoint.y
  );
  return {
    x: imagePoint.x,
    y: imagePoint.y,
  };
}

function addSegmentPromptPoint(event) {
  if (!segmentPointMode || segmentModeActive || segmentIsRunning) return false;

  const imagePoint = getSegmentImagePointFromCanvasEvent(event);
  if (!imagePoint) return false;

  event.preventDefaultAction = true;
  segmentPromptPoints.push({
    ...imagePoint,
    label: segmentPointMode === "positive" ? 1 : 0,
  });
  updateSegmentPromptPreview();
  setSegmentStatus(`Running SAM 2.1 segmentation...${getSegmentPromptSummary()}`);
  runSegmentForPromptBox(segmentPromptBox);
  return true;
}

function setSegmentModeActive(active) {
  segmentModeActive = Boolean(active);
  if (segmentModeActive) {
    deactivateAnnotationModes();
    stopSnapshotDrawMode({ clearSelection: false });
    if (typeof stopMeasurementMode === "function") stopMeasurementMode();
    clearSegmentPreview({
      message: "Fast mode: Option-drag to add annotations.",
      keepMode: true,
    });
    segmentModeActive = true;
  } else {
    segmentBoxModeActive = false;
    segmentBoxDragState = null;
    setSegmentStatus("Draw a box around one feature.");
  }
  updateSegmentReticleVisibility();
  updateSegmentControls();
}

function updateSegmentReticleVisibility() {
  if (!segmentReticle) return;

  segmentReticle.hidden = true;
  const container = document.getElementById("viewer-container");
  container?.classList.toggle("segment-mode-active", segmentModeActive);
}

function updateSegmentReticlePosition(event) {
  if (!segmentReticle || !segmentModeActive) return;

  const rect = viewerContainer.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const isInside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
  segmentReticle.hidden = !isInside;
  if (!isInside) return;

  segmentReticle.style.transform = `translate(${x}px, ${y}px)`;
}

function hideSegmentReticle() {
  if (segmentReticle) segmentReticle.hidden = true;
}

function updateUnsupervisedAoiPreview(rect = unsupervisedAoiRect) {
  annoJSONTemp = {
    type: "FeatureCollection",
    features: [],
  };
  if (rect) {
    addUnsupervisedPatchGridPreview();
    addPolygonToGeoJSON(annoJSONTemp, imageRectToPolygon(rect), {
      uuid: "segmenteverygrain-aoi",
      label: "segmenteverygrain AOI",
      shapeType: "segment-prompt",
      lineStyle: "dashed",
      lineWeight: 2,
      lineColor: "#9c27b0",
      lineOpacity: 0.95,
      fillColor: "#9c27b0",
      fillOpacity: 0.08,
    });
  }
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  updateUnsupervisedAoiStats();
}

function startUnsupervisedAoiMode() {
  if (unsupervisedSegmentIsRunning) return;

  clearSegmentPreview({
    message: "Draw a box around one feature.",
    keepMode: true,
  });
  unsupervisedAoiModeActive = true;
  unsupervisedAoiDragState = null;
  unsupervisedAoiRect = null;
  deactivateAnnotationModes();
  stopSnapshotDrawMode({ clearSelection: false });
  if (typeof stopMeasurementMode === "function") stopMeasurementMode();
  setUnsupervisedSegmentStatus("Drag an AOI around the grains to segment.");
  updateUnsupervisedSegmentControls();
}

function clearUnsupervisedAoi(message = "Draw an AOI before running segmentation.") {
  unsupervisedAoiModeActive = false;
  unsupervisedAoiDragState = null;
  unsupervisedAoiRect = null;
  annoJSONTemp = {
    type: "FeatureCollection",
    features: [],
  };
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  setUnsupervisedSegmentStatus(message);
  updateUnsupervisedSegmentControls();
}

function clearUnsupervisedAoiForSampleChange() {
  const hasAoiPreview =
    annoJSONTemp?.features?.some(
      (feature) => feature?.properties?.uuid === "segmenteverygrain-aoi"
    ) || false;

  if (!unsupervisedAoiModeActive && !unsupervisedAoiRect && !hasAoiPreview) {
    return;
  }

  clearUnsupervisedAoi("AOI cleared after sample change.");
}

function buildUnsupervisedSegmentFeature(fullImagePolygon, result = {}) {
  const style = getCurrentAnnotationStyleColors();
  const labelFontSize = Number(document.getElementById("annoLabelFontSize").value);
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [fullImagePolygon],
    },
    properties: {
      uuid: "segmenteverygrain-preview",
      label: "segmenteverygrain segment",
      shapeType: "segment",
      labelFontSize,
      labelFontColor: style.labelFontColor,
      labelBackgroundColor: style.labelBackgroundColor,
      labelBackgroundOpacity: getAnnotationOpacityValue("annoLabelBackgroundOpacity"),
      lineStyle: "solid",
      lineWeight: Math.max(2, Number(document.getElementById("lineWeight").value)),
      segmentationBackend: "segmenteverygrain",
      segmentationModel: result.modelPath || "",
      segmentationSamRefined: Boolean(result.useSam),
      segmentationSamModel: result.samModelType || "",
      segmentationPromptType: "aoi",
    },
  };
}

function commitUnsupervisedSegmentFeatures(features, statusMessage) {
  if (!Array.isArray(features) || features.length === 0) return;

  const image = viewer.world.getItemAt(0);
  const imageSize = image?.getContentSize() || { x: null, y: null };
  const segmentGroup = getSegmentAnnotationGroup();
  const label = document.getElementById("anno-label")?.value || "";

  annotationHistory.push("Add segmenteverygrain annotations");
  const usedUuids = new Set(
    annoJSON.features
      .map((existingFeature) => existingFeature.properties?.uuid)
      .filter(Boolean)
  );
  const getUniqueAnnotationUuid = () => {
    let uuid = generateUniqueId(12);
    while (usedUuids.has(uuid)) {
      uuid = generateUniqueId(12);
    }
    usedUuids.add(uuid);
    return uuid;
  };
  features.forEach((feature) => {
    const style = getCurrentAnnotationStyleColors();
    const coordinates = roundCoordinateTree(feature.geometry.coordinates[0]);
    const areaPixels2 = calculatePolygonArea([coordinates]);
    const perimeterPixels = calculatePolygonExteriorPerimeter([coordinates]);
    const segmentProperties = {
      ...feature.properties,
      uuid: getUniqueAnnotationUuid(),
      label,
      imageTitle: title(),
      pixelsPerMeter: pixelsPerMeter(),
      imageWidth: imageSize.x,
      imageHeight: imageSize.y,
      xLabel: coordinates[0][0],
      yLabel: coordinates[0][1],
      labelFontColor: style.labelFontColor,
      labelBackgroundColor: style.labelBackgroundColor,
      lineColor: style.lineColor,
      fillColor: style.fillColor,
      fillOpacity: getAnnotationOpacityValue("fillOpacity"),
      area_m2: squareMetersFromSquarePixels(areaPixels2),
      perimeter_m: metersFromPixels(perimeterPixels),
    };
    const properties = normalizeAnnotationProperties(
      segmentGroup
        ? applyAnnotationGroupToProperties(segmentProperties, segmentGroup)
        : applyActiveAnnotationGroup(segmentProperties)
    );
    annoJSON.features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [coordinates],
      },
      properties,
    });
  });

  annoJSONTemp = {
    type: "FeatureCollection",
    features: [],
  };
  unsupervisedAoiModeActive = false;
  unsupervisedAoiDragState = null;
  unsupervisedAoiRect = null;
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  renderAnnotationList();
  renderAnnotationGroupOptions();
  clearAnnotationSelection({ redraw: false, scroll: false });
  enableAnnoButtons();
  populateSegmentAnnotationGroupOptions();
  unsavedAnnotations(true);
  setUnsupervisedSegmentStatus(statusMessage, "ok");
  updateUnsupervisedSegmentControls();
}

async function runUnsupervisedSegmentation() {
  if (unsupervisedSegmentIsRunning || !unsupervisedAoiRect) return;
  if (!window.electronAPI?.runSegmenteverygrainSegmentation) {
    setUnsupervisedSegmentStatus(
      "segmenteverygrain segmentation is only available in the Electron app.",
      "error"
    );
    return;
  }

  unsupervisedSegmentIsRunning = true;
  unsupervisedSegmentCancelRequested = false;
  const runId = ++unsupervisedSegmentRunId;
  unsupervisedSegmentLastProgressPercent = 0;
  updateUnsupervisedSegmentControls();
  setUnsupervisedSegmentStatus("Rendering AOI for segmenteverygrain...");
  setUnsupervisedSegmentProgress(0, { indeterminate: true });
  try {
    const resolutionScale = getUnsupervisedResolutionScale();
    const options = getUnsupervisedSegmentationOptions();
    const tileJob = getUnsupervisedTileJob(resolutionScale);
    const usePythonTileStitching = canUsePythonTileStitching(tileJob);
    let requestImage = { tileJob };
    let fallbackScaleX = resolutionScale;
    let fallbackScaleY = resolutionScale;
    if (!usePythonTileStitching) {
      const cropCanvas = await renderFullResolutionImageRectCanvas(
        unsupervisedAoiRect,
        getUnsupervisedSegmentTileSetIndex(),
        resolutionScale
      );
      fallbackScaleX = cropCanvas.width / Math.max(1, unsupervisedAoiRect.width);
      fallbackScaleY = cropCanvas.height / Math.max(1, unsupervisedAoiRect.height);
      requestImage = {
        cropPngDataUrl: await canvasToPngDataUrl(cropCanvas),
      };
    }
    throwIfUnsupervisedSegmentationCanceled(runId);
    setUnsupervisedSegmentProgress(1);
    setUnsupervisedSegmentStatus(
      options.useSam
        ? "Running segmenteverygrain with SAM refinement..."
        : "Running segmenteverygrain U-Net pass..."
    );
    const result = await window.electronAPI.runSegmenteverygrainSegmentation({
      samSettings: getSamSettingsFromInputs(),
      segmenteverygrainSettings: getSegmenteverygrainSettingsFromInputs(),
      ...requestImage,
      simplifyEpsilon: getUnsupervisedSimplifyEpsilon(),
      minArea: options.minArea,
      patchSize: options.patchSize,
      overlap: options.overlap,
      dilation: options.dilation,
      removeEdgeGrains: options.removeEdgeGrains,
      useSam: options.useSam,
      device: "auto",
    });
    throwIfUnsupervisedSegmentationCanceled(runId);

    if (!result?.ok) {
      if (result?.canceled) {
        setUnsupervisedSegmentStatus("segmenteverygrain canceled.");
        return;
      }
      setUnsupervisedSegmentStatus(
        result?.error || result?.stderr || "segmenteverygrain could not segment the AOI.",
        "error"
      );
      return;
    }

    const features = (result.polygons || [])
      .map((polygon) =>
        polygon.coordinates.map(([x, y]) => [
          x /
            (usePythonTileStitching && Number.isFinite(Number(result.scaleX))
              ? Number(result.scaleX)
              : fallbackScaleX) +
            unsupervisedAoiRect.x,
          y /
            (usePythonTileStitching && Number.isFinite(Number(result.scaleY))
              ? Number(result.scaleY)
              : fallbackScaleY) +
            unsupervisedAoiRect.y,
        ])
      )
      .filter((coordinates) => coordinates.length >= 4)
      .map((coordinates) =>
        buildUnsupervisedSegmentFeature(coordinates, {
          modelPath: getSegmenteverygrainSettingsFromInputs().modelPath,
          useSam: result.useSam,
          samModelType: result.samModelType,
        })
      );

    if (features.length === 0) {
      setUnsupervisedSegmentStatus(
        "segmenteverygrain did not return any polygons for this AOI.",
        "error"
      );
      return;
    }

    setUnsupervisedSegmentProgress(100);
    commitUnsupervisedSegmentFeatures(
      features,
      `Added ${features.length} segmenteverygrain annotation${features.length === 1 ? "" : "s"}.`
    );
  } catch (error) {
    if (
      unsupervisedSegmentCancelRequested ||
      error.message === "segmenteverygrain canceled."
    ) {
      setUnsupervisedSegmentStatus("segmenteverygrain canceled.");
      return;
    }
    console.error("segmenteverygrain segmentation failed:", error);
    setUnsupervisedSegmentStatus(
      error.message || "segmenteverygrain segmentation failed.",
      "error"
    );
  } finally {
    if (runId === unsupervisedSegmentRunId) {
      unsupervisedSegmentIsRunning = false;
      unsupervisedSegmentCancelRequested = false;
      window.setTimeout(hideUnsupervisedSegmentProgress, 900);
      updateUnsupervisedSegmentControls();
    }
  }
}

async function runSegmentForPromptBox(promptRect) {
  const cropRect = getPaddedSegmentCropRect(promptRect);
  if (!cropRect) {
    setSegmentStatus("Could not prepare the segmentation crop.", "error");
    return;
  }

  updateSegmentRunningState(1);
  setSegmentStatus(`Rendering crop for SAM 2.1...${getSegmentPromptSummary()}`);
  try {
    const resolutionScale = getSegmentResolutionScale(cropRect);
    const cropCanvas = await renderFullResolutionImageRectCanvas(
      cropRect,
      getSegmentTileSetIndex(),
      resolutionScale
    );
    const scaleX = cropCanvas.width / Math.max(1, cropRect.width);
    const scaleY = cropCanvas.height / Math.max(1, cropRect.height);
    const cropBox = promptRect
      ? {
          x0: (promptRect.x - cropRect.x) * scaleX,
          y0: (promptRect.y - cropRect.y) * scaleY,
          x1: (promptRect.x + promptRect.width - cropRect.x) * scaleX,
          y1: (promptRect.y + promptRect.height - cropRect.y) * scaleY,
        }
      : null;
    const cropPoints = segmentPromptPoints.map((point) => ({
      x: (point.x - cropRect.x) * scaleX,
      y: (point.y - cropRect.y) * scaleY,
      label: point.label,
    }));
    const cropPngDataUrl = await canvasToPngDataUrl(cropCanvas);
    setSegmentStatus(`Running SAM 2.1 segmentation...${getSegmentPromptSummary()}`);
    const result = await window.electronAPI.runSamSegmentation({
      samSettings: getSamSettingsFromInputs(),
      cropPngDataUrl,
      box: cropBox,
      points: cropPoints,
      device: "auto",
      simplifyEpsilon: getSegmentSimplifyEpsilon(),
    });

    if (!result?.ok) {
      setSegmentStatus(
        result?.error || result?.stderr || "SAM 2.1 could not segment the box.",
        "error"
      );
      return;
    }

    const fullImagePolygon = result.polygon.map(([x, y]) => [
      x / scaleX + cropRect.x,
      y / scaleY + cropRect.y,
    ]);
    const scoreText =
      Number.isFinite(Number(result.score))
        ? ` Score: ${Number(result.score).toFixed(3)}.`
        : "";
    if (shouldAutoAddSegment()) {
      const feature = buildSegmentFeature(fullImagePolygon, result);
      commitSegmentFeature(feature, {
        statusMessage: `Segment auto-added.${scoreText}`,
        select: false,
        clearPrompts: true,
      });
    } else {
      previewSegmentPolygon(fullImagePolygon, result);
      setSegmentStatus(
        `Segment preview ready.${scoreText}${getSegmentPromptSummary()}`,
        "ok"
      );
    }
  } catch (error) {
    console.error("SAM segmentation failed:", error);
    setSegmentStatus(error.message || "SAM segmentation failed.", "error");
  } finally {
    updateSegmentRunningState(-1);
  }
}

function commitSegmentPreview(options = {}) {
  if (!segmentPreviewFeature) return;

  const feature = segmentPreviewFeature;
  segmentPreviewFeature = null;
  segmentPromptBox = null;
  segmentPromptPoints = [];
  segmentPointMode = null;
  annoJSONTemp = {
    type: "FeatureCollection",
    features: [],
  };
  commitSegmentFeature(feature, options);
}

function commitSegmentFeature(feature, options = {}) {
  if (!feature) return;

  const image = viewer.world.getItemAt(0);
  const imageSize = image?.getContentSize() || { x: null, y: null };
  const coordinates = roundCoordinateTree(feature.geometry.coordinates[0]);
  const areaPixels2 = calculatePolygonArea([coordinates]);
  const perimeterPixels = calculatePolygonExteriorPerimeter([coordinates]);
  const areaM2 = squareMetersFromSquarePixels(areaPixels2);
  const perimeterM = metersFromPixels(perimeterPixels);
  const style = getCurrentAnnotationStyleColors();
  const segmentGroup = getSegmentAnnotationGroup();
  const segmentProperties = {
    ...feature.properties,
    uuid: generateUniqueId(8),
    label: document.getElementById("anno-label")?.value || "",
    imageTitle: title(),
    pixelsPerMeter: pixelsPerMeter(),
    imageWidth: imageSize.x,
    imageHeight: imageSize.y,
    xLabel: coordinates[0][0],
    yLabel: coordinates[0][1],
    labelFontColor: style.labelFontColor,
    labelBackgroundColor: style.labelBackgroundColor,
    lineColor: style.lineColor,
    fillColor: style.fillColor,
    fillOpacity: getAnnotationOpacityValue("fillOpacity"),
    area_m2: areaM2,
    perimeter_m: perimeterM,
  };
  const properties = normalizeAnnotationProperties(
    segmentGroup
      ? applyAnnotationGroupToProperties(segmentProperties, segmentGroup)
      : applyActiveAnnotationGroup(segmentProperties)
  );

  annotationHistory.push("Add segmented annotation");
  annoJSON.features.push({
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [coordinates],
    },
    properties,
  });
  if (options.clearPrompts) {
    segmentPromptBox = null;
    segmentPromptPoints = [];
    segmentPointMode = null;
    annoJSONTemp = {
      type: "FeatureCollection",
      features: [],
    };
  }
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  renderAnnotationList();
  renderAnnotationGroupOptions();
  if (options.select === false) {
    clearAnnotationSelection({ redraw: false, scroll: false });
  } else {
    selectAnnotationByUuid(properties.uuid, { redraw: false });
  }
  addText(
    properties.uuid,
    properties.label,
    image.imageToViewportCoordinates(properties.xLabel, properties.yLabel),
    "anno",
    properties.labelFontColor,
    properties.labelFontSize,
    properties.labelBackgroundColor,
    properties.labelBackgroundOpacity
  );
  enableAnnoButtons();
  populateSegmentAnnotationGroupOptions();
  unsavedAnnotations(true);
  setSegmentStatus(options.statusMessage || "Segment added as an annotation.", "ok");
  updateSegmentControls();
}

function initializeSegmentPrimaryAccordion() {
  if (!segmentPalette) return;
  const details = [
    ...segmentPalette.querySelectorAll(".segment-primary-details"),
  ];
  details.forEach((detail) => {
    if (detail.dataset.accordionInitialized === "true") return;
    detail.dataset.accordionInitialized = "true";
    detail.addEventListener("toggle", function (event) {
      if (event.target !== detail) return;
      if (!detail.open) return;
      details.forEach((otherDetail) => {
        if (otherDetail !== detail) {
          otherDetail.open = false;
        }
      });
    });
  });
}

function openSegmentPalette() {
  if (!segmentPalette) return;

  segmentPalette.hidden = false;
  initializeSegmentPrimaryAccordion();
  populateSegmentTileSetSelect();
  populateSegmentAnnotationGroupOptions();
  updateSegmentSimplifyControls();
  updateUnsupervisedSegmentControls();
  restoreToolPalettePosition(segmentPalette, "petroImage.segmentPalette");
  openSegmentPaletteButton?.setAttribute("aria-pressed", "true");
  clampToolPaletteToViewer(segmentPalette);
  loadSamSettings();
}

function closeSegmentPalette() {
  if (!segmentPalette) return;

  clearSegmentPreview({ keepMode: false });
  segmentPalette.hidden = true;
  openSegmentPaletteButton?.setAttribute("aria-pressed", "false");
}

function toggleSegmentPalette() {
  if (!segmentPalette || segmentPalette.hidden) {
    openSegmentPalette();
    return;
  }

  closeSegmentPalette();
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
  closeReferenceCircleSettingsPopover();
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
    "porosity-overlay",
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

function resizePorosityOverlay() {
  const container = document.getElementById("viewer-container");
  if (!porosityOverlay || !container) return;

  const width = container.clientWidth;
  const height = container.clientHeight;
  if (porosityOverlay.width !== width || porosityOverlay.height !== height) {
    porosityOverlay.width = width;
    porosityOverlay.height = height;
  }
  porosityOverlay.style.width = `${width}px`;
  porosityOverlay.style.height = `${height}px`;
}

function clearPorosityOverlay() {
  if (!porosityOverlay) return;

  resizePorosityOverlay();
  const ctx = porosityOverlay.getContext("2d");
  ctx?.clearRect(0, 0, porosityOverlay.width, porosityOverlay.height);
}

function createPorosityType(name, options = {}) {
  return {
    id: `porosity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    colorSamples: [],
    result: null,
    tolerance: options.tolerance ?? 35,
    overlayColor: options.overlayColor || "#ff0000",
    overlayOpacity: options.overlayOpacity ?? 100,
    visible: options.visible ?? true,
  };
}

function ensurePorosityTypes() {
  if (porosityTypes.length === 0) {
    const defaultType = createPorosityType("Porosity");
    porosityTypes.push(defaultType);
    activePorosityTypeId = defaultType.id;
  }
  if (!porosityTypes.some((type) => type.id === activePorosityTypeId)) {
    activePorosityTypeId = porosityTypes[0]?.id || "";
  }
}

function getActivePorosityType() {
  ensurePorosityTypes();
  return porosityTypes.find((type) => type.id === activePorosityTypeId) || null;
}

function clonePorosityMask(mask) {
  if (!mask?.canvas) return null;

  const canvas = document.createElement("canvas");
  canvas.width = mask.canvas.width;
  canvas.height = mask.canvas.height;
  const ctx = canvas.getContext("2d");
  ctx?.drawImage(mask.canvas, 0, 0);
  return {
    canvas,
    rect: mask.rect ? { ...mask.rect } : null,
    imageCorners: mask.imageCorners
      ? {
          topLeft: { ...mask.imageCorners.topLeft },
          topRight: { ...mask.imageCorners.topRight },
          bottomLeft: { ...mask.imageCorners.bottomLeft },
        }
      : null,
    alphaData: mask.alphaData ? new Uint8Array(mask.alphaData) : null,
  };
}

function clonePorosityResult(result) {
  if (!result) return null;

  return {
    mask: clonePorosityMask(result.mask),
    porePixels: result.porePixels,
    totalPixels: result.totalPixels,
    percent: result.percent,
    analysisScale: result.analysisScale,
    analysisWidth: result.analysisWidth,
    analysisHeight: result.analysisHeight,
    analysisResolutionMode: result.analysisResolutionMode || "balanced",
    analysisResolutionLabel: result.analysisResolutionLabel || "",
    tileSetIndices: result.tileSetIndices ? [...result.tileSetIndices] : null,
    scope: result.scope || "aoi",
  };
}

function clonePorosityState() {
  return {
    aoiModeActive: porosityAoiModeActive,
    pickModeActive: porosityPickModeActive,
    aoiImagePoints: porosityAoiImagePoints.map((point) => ({ ...point })),
    aoiComplete: porosityAoiComplete,
    aoiVisible: porosityAoiVisible,
    activeTypeId: activePorosityTypeId,
    selectedTileSetIndices: [...getPorositySelectedTileSetIndices()],
    analysisResolutionMode: getPorosityAnalysisResolutionMode(),
    types: porosityTypes.map((type) => ({
      id: type.id,
      name: type.name,
      colorSamples: type.colorSamples.map((sample) => ({ ...sample })),
      result: clonePorosityResult(type.result),
      tolerance: type.tolerance,
      overlayColor: type.overlayColor,
      overlayOpacity: type.overlayOpacity,
      visible: type.visible !== false,
    })),
  };
}

function restorePorosityState(state, message = "") {
  if (!state) return;

  porosityAoiModeActive = state.aoiModeActive;
  porosityPickModeActive = state.pickModeActive;
  porosityAoiMousePoint = null;
  porosityAoiImagePoints = state.aoiImagePoints.map((point) => ({ ...point }));
  porosityAoiComplete = state.aoiComplete;
  porosityAoiVisible = state.aoiVisible !== false;
  porositySelectedTileSetIndices = [...(state.selectedTileSetIndices || [])];
  porosityAnalysisResolutionMode =
    POROSITY_ANALYSIS_RESOLUTION_MODES[state.analysisResolutionMode]
      ? state.analysisResolutionMode
      : getPorosityAnalysisResolutionMode();
  if (porosityResolutionMode) {
    porosityResolutionMode.value = porosityAnalysisResolutionMode;
  }
  porosityTypes = state.types.map((type) => ({
    ...type,
    colorSamples: type.colorSamples.map((sample) => ({ ...sample })),
    result: clonePorosityResult(type.result),
  }));
  activePorosityTypeId = state.activeTypeId;
  ensurePorosityTypes();
  renderPorosityTileSetSelect();
  renderPorositySamples();
  syncPorosityControlsFromActiveType();
  drawPorosityOverlay();
  updatePorosityResolutionStatus();
  updatePorosityControls(message);
}

function renderPorosityTypeSelect(preferredValue = activePorosityTypeId) {
  if (!porosityTypeSelect) return;

  ensurePorosityTypes();
  const targetValue = preferredValue || activePorosityTypeId;
  porosityTypeSelect.innerHTML = "";
  porosityTypes.forEach((type) => {
    const option = document.createElement("option");
    option.value = type.id;
    option.textContent = type.name;
    porosityTypeSelect.append(option);
  });
  porosityTypeSelect.value = porosityTypes.some(
    (type) => type.id === targetValue
  )
    ? targetValue
    : activePorosityTypeId;
}

function normalizePorosityTileSetIndex(index) {
  const parsedIndex = Number(index);
  if (!Number.isInteger(parsedIndex)) return null;
  if (parsedIndex < 0 || parsedIndex >= tileSets().length) return null;
  return parsedIndex;
}

function getDefaultPorosityTileSetIndices() {
  return tileSets().length > 0 ? [getSnapshotTileSetIndex()] : [];
}

function getPorositySelectedTileSetIndices() {
  let selectedIndices;
  if (porosityTileSetSelect && porosityTileSetSelect.options.length > 0) {
    selectedIndices = Array.from(porosityTileSetSelect.selectedOptions)
      .map((option) => normalizePorosityTileSetIndex(option.value))
      .filter((index) => index !== null);
    porositySelectedTileSetIndices = [...new Set(selectedIndices)];
    return porositySelectedTileSetIndices;
  }

  selectedIndices = porositySelectedTileSetIndices
    .map(normalizePorosityTileSetIndex)
    .filter((index) => index !== null);
  porositySelectedTileSetIndices =
    selectedIndices.length > 0
      ? [...new Set(selectedIndices)]
      : getDefaultPorosityTileSetIndices();
  return porositySelectedTileSetIndices;
}

function renderPorosityTileSetSelect() {
  if (!porosityTileSetSelect) return;

  const selectedIndices = new Set(getPorositySelectedTileSetIndices());
  porosityTileSetSelect.innerHTML = "";
  tileSets().forEach((tileSet, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = tileSet.label || `Tile set ${index + 1}`;
    option.selected = selectedIndices.has(index);
    porosityTileSetSelect.append(option);
  });
  porosityTileSetSelect.size = Math.max(
    1,
    Math.min(3, Math.max(tileSets().length, 1))
  );
}

function getPorosityTileSetLabel(index) {
  const tileSet = tileSets()[index];
  return tileSet?.label || `Tile set ${Number(index) + 1}`;
}

function normalizePorosityTypeSamples(type) {
  if (!type) return;

  const defaultTileSetIndex = getPorositySelectedTileSetIndices()[0] ?? 0;
  type.colorSamples = (type.colorSamples || [])
    .map((sample, index) => {
      const tileSetIndex =
        normalizePorosityTileSetIndex(sample.tileSetIndex) ?? defaultTileSetIndex;
      return {
        ...sample,
        sampleSetId: sample.sampleSetId || `legacy-sample-${index}`,
        tileSetIndex,
      };
    })
    .filter((sample) => normalizePorosityTileSetIndex(sample.tileSetIndex) !== null);
}

function getPorosityAnalysisResolutionMode() {
  const mode = porosityResolutionMode?.value || porosityAnalysisResolutionMode;
  return POROSITY_ANALYSIS_RESOLUTION_MODES[mode] ? mode : "balanced";
}

function getPorosityAnalysisResolutionSettings() {
  const mode = getPorosityAnalysisResolutionMode();
  return {
    mode,
    ...POROSITY_ANALYSIS_RESOLUTION_MODES[mode],
  };
}

function formatPorosityResolutionPercent(scale) {
  if (!Number.isFinite(scale)) return "";
  return `${Math.max(1, Math.round(scale * 100))}%`;
}

function updatePorosityResolutionStatus(exportSize = null) {
  if (!porosityResolutionStatus) return;

  const exportMode = exportSize?.mode;
  const settings = exportMode && POROSITY_ANALYSIS_RESOLUTION_MODES[exportMode]
    ? { mode: exportMode, ...POROSITY_ANALYSIS_RESOLUTION_MODES[exportMode] }
    : getPorosityAnalysisResolutionSettings();
  if (!exportSize) {
    porosityResolutionStatus.textContent = `${settings.label} analysis resolution.`;
    return;
  }

  const requestedScale = formatPorosityResolutionPercent(settings.targetScale);
  const effectiveScale = formatPorosityResolutionPercent(exportSize.scale);
  const dimensions = `${exportSize.width.toLocaleString()} x ${exportSize.height.toLocaleString()} px`;
  porosityResolutionStatus.textContent =
    effectiveScale === requestedScale
      ? `${settings.label}: ${effectiveScale} source resolution (${dimensions}).`
      : `${settings.label}: ${effectiveScale} source resolution after safety caps (${dimensions}).`;
}

function getPorosityResultExportSize(result) {
  if (!result?.analysisWidth || !result?.analysisHeight) return null;

  return {
    width: result.analysisWidth,
    height: result.analysisHeight,
    scale: result.analysisScale,
    mode: result.analysisResolutionMode || getPorosityAnalysisResolutionMode(),
    label: result.analysisResolutionLabel || "",
  };
}

function showPorosityActivityStatus(message) {
  if (!porosityActivityStatus) return;

  if (porosityActivityClearTimer !== null) {
    window.clearTimeout(porosityActivityClearTimer);
    porosityActivityClearTimer = null;
  }
  porosityActivityStatus.textContent = message;
  porosityActivityStatus.hidden = !message;
}

function clearPorosityActivityStatus(delayMs = 600) {
  if (!porosityActivityStatus) return;

  if (porosityActivityClearTimer !== null) {
    window.clearTimeout(porosityActivityClearTimer);
  }
  porosityActivityClearTimer = window.setTimeout(() => {
    porosityActivityClearTimer = null;
    porosityActivityStatus.textContent = "";
    porosityActivityStatus.hidden = true;
  }, delayMs);
}

function setPorosityProgress(message, percent = null) {
  if (!porosityProgress) return;

  if (porosityProgressClearTimer !== null) {
    window.clearTimeout(porosityProgressClearTimer);
    porosityProgressClearTimer = null;
  }
  porosityProgress.hidden = false;
  if (porosityProgressLabel) {
    porosityProgressLabel.textContent = message || "";
  }
  if (porosityProgressBar) {
    const width = Number.isFinite(percent)
      ? Math.max(0, Math.min(100, percent))
      : 100;
    porosityProgressBar.style.width = `${width}%`;
    porosityProgressBar.classList.toggle(
      "porosity-progress-bar-indeterminate",
      !Number.isFinite(percent)
    );
  }
}

function clearPorosityProgress(delayMs = 600) {
  if (!porosityProgress) return;

  if (porosityProgressClearTimer !== null) {
    window.clearTimeout(porosityProgressClearTimer);
  }
  porosityProgressClearTimer = window.setTimeout(() => {
    porosityProgressClearTimer = null;
    porosityProgress.hidden = true;
    if (porosityProgressLabel) porosityProgressLabel.textContent = "";
    if (porosityProgressBar) {
      porosityProgressBar.style.width = "0%";
      porosityProgressBar.classList.remove("porosity-progress-bar-indeterminate");
    }
  }, delayMs);
}

function syncPorosityControlsFromActiveType() {
  const type = getActivePorosityType();
  if (!type) return;

  renderPorosityTileSetSelect();
  normalizePorosityTypeSamples(type);
  if (porosityTolerance) {
    const min = Number(porosityTolerance.min || 5);
    const max = Number(porosityTolerance.max || 100);
    type.tolerance = Math.max(min, Math.min(max, Number(type.tolerance) || 35));
    porosityTolerance.value = String(type.tolerance);
  }
  if (porosityToleranceValue) {
    porosityToleranceValue.value = String(type.tolerance);
  }
  if (porosityOverlayColor) porosityOverlayColor.value = type.overlayColor;
  setPorosityOverlayOpacityControlValue(type.overlayOpacity);
  renderPorositySamples();
  updatePorosityControls();
}

function clampPorosityOverlayOpacity(value) {
  const min = Number(porosityOverlayOpacity?.min || 5);
  const max = Number(porosityOverlayOpacity?.max || 100);
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return max;
  return Math.max(min, Math.min(max, Math.round(numericValue)));
}

function setPorosityOverlayOpacityControlValue(value) {
  const opacity = clampPorosityOverlayOpacity(value);
  if (porosityOverlayOpacity) porosityOverlayOpacity.value = String(opacity);
  if (porosityOverlayOpacityValue) {
    porosityOverlayOpacityValue.value = String(opacity);
  }
  return opacity;
}

function syncActivePorosityTypeFromControls() {
  const type = getActivePorosityType();
  if (!type) return null;

  type.tolerance = Number(porosityTolerance?.value || type.tolerance);
  if (porosityToleranceValue) {
    porosityToleranceValue.value = String(type.tolerance);
  }
  type.overlayColor = porosityOverlayColor?.value || type.overlayColor;
  type.overlayOpacity = clampPorosityOverlayOpacity(
    porosityOverlayOpacity?.value || type.overlayOpacity
  );
  setPorosityOverlayOpacityControlValue(type.overlayOpacity);
  return type;
}

function setPorosityToleranceControlValue(value) {
  const min = Number(porosityTolerance?.min || 5);
  const max = Number(porosityTolerance?.max || 100);
  const numericValue = Number(value);
  const tolerance = Number.isFinite(numericValue)
    ? Math.max(min, Math.min(max, Math.round(numericValue)))
    : 35;
  if (porosityTolerance) porosityTolerance.value = String(tolerance);
  if (porosityToleranceValue) porosityToleranceValue.value = String(tolerance);
  const activeType = getActivePorosityType();
  if (activeType) activeType.tolerance = tolerance;
  return activeType;
}

function addPorosityType(name) {
  const trimmedName = (name || "").trim();
  if (!trimmedName) return;

  const type = createPorosityType(trimmedName, {
    overlayColor: porosityTypes.length === 0 ? "#ff0000" : "#00d46a",
    overlayOpacity: 100,
  });
  porosityTypes.push(type);
  activePorosityTypeId = type.id;
  renderPorosityTypeSelect(type.id);
  syncPorosityControlsFromActiveType();
  drawPorosityOverlay();
}

function renamePorosityType(typeId, name) {
  const trimmedName = (name || "").trim();
  if (!trimmedName) return;

  const duplicateType = porosityTypes.find(
    (type) =>
      type.id !== typeId &&
      type.name.toLowerCase() === trimmedName.toLowerCase()
  );
  if (duplicateType) {
    alert("A porosity type with that name already exists.");
    return;
  }

  const type = porosityTypes.find((candidate) => candidate.id === typeId);
  if (!type) return;
  type.name = trimmedName;
  renderPorosityTypeSelect(type.id);
  updatePorosityControls(`${type.name} renamed.`);
}

function deletePorosityType(typeId = activePorosityTypeId) {
  if (porosityTypes.length <= 1) {
    updatePorosityControls("At least one porosity type is required.");
    return;
  }

  const typeIndex = porosityTypes.findIndex((type) => type.id === typeId);
  if (typeIndex < 0) return;

  const [removedType] = porosityTypes.splice(typeIndex, 1);
  if (activePorosityTypeId === typeId) {
    const nextType = porosityTypes[Math.min(typeIndex, porosityTypes.length - 1)];
    activePorosityTypeId = nextType?.id || "";
  }
  porosityPickModeActive = false;
  renderPorosityTypeSelect(activePorosityTypeId);
  syncPorosityControlsFromActiveType();
  drawPorosityOverlay();
  updatePorosityControls(`${removedType.name} deleted.`);
}

function drawPorosityMask(ctx, mask) {
  if (!ctx || !mask?.canvas) return;

  ctx.imageSmoothingEnabled = false;
  if (mask.imageCorners) {
    const topLeft = getPorosityScreenPointFromImagePoint(
      mask.imageCorners.topLeft
    );
    const topRight = getPorosityScreenPointFromImagePoint(
      mask.imageCorners.topRight
    );
    const bottomLeft = getPorosityScreenPointFromImagePoint(
      mask.imageCorners.bottomLeft
    );
    if (topLeft && topRight && bottomLeft) {
      ctx.save();
      ctx.setTransform(
        (topRight.x - topLeft.x) / mask.canvas.width,
        (topRight.y - topLeft.y) / mask.canvas.width,
        (bottomLeft.x - topLeft.x) / mask.canvas.height,
        (bottomLeft.y - topLeft.y) / mask.canvas.height,
        topLeft.x,
        topLeft.y
      );
      ctx.drawImage(mask.canvas, 0, 0);
      ctx.restore();
    }
    return;
  }

  if (mask.rect) {
    ctx.drawImage(mask.canvas, mask.rect.left, mask.rect.top);
  }
}

function drawPorosityOverlay() {
  if (!porosityOverlay) return;

  clearPorosityOverlay();
  const ctx = porosityOverlay.getContext("2d");
  if (!ctx) return;

  porosityTypes.forEach((type) => {
    if (type.visible !== false) drawPorosityMask(ctx, type.result?.mask);
  });

  if (!porosityAoiVisible && !porosityAoiModeActive) return;

  const points = getPorosityAoiScreenPoints();
  if (points.length === 0) return;

  ctx.save();
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  if (
    porosityAoiModeActive &&
    !porosityAoiComplete &&
    porosityAoiMousePoint &&
    points.length > 0
  ) {
    ctx.lineTo(porosityAoiMousePoint.x, porosityAoiMousePoint.y);
  }
  if (porosityAoiComplete && points.length >= 3) {
    ctx.closePath();
  }
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = porosityAoiComplete ? 5 : 4;
  ctx.strokeStyle = "#111111";
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = porosityAoiComplete ? "#ffcc00" : "#2f80ed";
  ctx.stroke();

  points.forEach((point, index) => {
    ctx.beginPath();
    ctx.arc(
      point.x,
      point.y,
      index === porosityAoiSelectedVertexIndex ? 5.5 : 4,
      0,
      Math.PI * 2
    );
    ctx.fillStyle =
      index === porosityAoiSelectedVertexIndex ? "#2f80ed" : "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
  ctx.restore();
}

function removeDuplicatePorosityAoiFinishPoint() {
  if (porosityAoiImagePoints.length < 2) return;

  const points = getPorosityAoiScreenPoints();
  const lastPoint = points[points.length - 1];
  const previousPoint = points[points.length - 2];
  if (!lastPoint || !previousPoint) return;
  if (Math.hypot(lastPoint.x - previousPoint.x, lastPoint.y - previousPoint.y) <= 3) {
    porosityAoiImagePoints.pop();
  }
}

function getPorosityToleranceValue() {
  const activeType = syncActivePorosityTypeFromControls();
  return getPorosityToleranceValueForType(activeType);
}

function getPorosityToleranceValueForType(type) {
  const value = Number(type?.tolerance ?? 35);
  return Number.isFinite(value) ? value : 35;
}

function getPorosityOverlayColorRgb() {
  const activeType = syncActivePorosityTypeFromControls();
  return getPorosityOverlayColorRgbForType(activeType);
}

function getPorosityOverlayColorRgbForType(type) {
  const rgba = hexToRgba(type?.overlayColor || "#ff0000", 1);
  const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return { r: 255, g: 112, b: 36 };
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
  };
}

function getPorosityOverlayAlpha() {
  const activeType = syncActivePorosityTypeFromControls();
  return getPorosityOverlayAlphaForType(activeType);
}

function getPorosityOverlayAlphaForType(type) {
  const value = Number(type?.overlayOpacity ?? 100);
  const percent = Number.isFinite(value) ? value : 100;
  return Math.max(0, Math.min(255, Math.round((percent / 100) * 255)));
}

function recolorPorosityMask() {
  const activeType = getActivePorosityType();
  const mask = activeType?.result?.mask;
  if (!mask?.canvas) return false;

  const ctx = mask.canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;

  const imageData = ctx.getImageData(0, 0, mask.canvas.width, mask.canvas.height);
  const overlayColor = getPorosityOverlayColorRgb();
  const overlayAlpha = getPorosityOverlayAlpha();

  for (let index = 0; index < imageData.data.length; index += 4) {
    if (imageData.data[index + 3] === 0) continue;
    imageData.data[index] = overlayColor.r;
    imageData.data[index + 1] = overlayColor.g;
    imageData.data[index + 2] = overlayColor.b;
    imageData.data[index + 3] = overlayAlpha;
  }

  ctx.putImageData(imageData, 0, 0);
  drawPorosityOverlay();
  renderPorosityResults();
  return true;
}

function schedulePorosityMaskRecolor() {
  if (!getActivePorosityType()?.result) {
    drawPorosityOverlay();
    return;
  }

  if (porosityRecolorFrame !== null) {
    cancelAnimationFrame(porosityRecolorFrame);
  }
  porosityRecolorFrame = requestAnimationFrame(() => {
    porosityRecolorFrame = null;
    recolorPorosityMask();
  });
}

function formatPorosityColorSample(sample) {
  return `rgb(${sample.r}, ${sample.g}, ${sample.b})`;
}

function renderPorositySamples() {
  if (!porositySamples) return;

  const activeType = getActivePorosityType();
  normalizePorosityTypeSamples(activeType);
  const samples = activeType?.colorSamples || [];
  const selectedTileSetIndices = getPorositySelectedTileSetIndices();
  porositySamples.innerHTML = "";

  selectedTileSetIndices.forEach((tileSetIndex) => {
    const row = document.createElement("div");
    row.className = "porosity-sample-row";
    const label = document.createElement("span");
    label.className = "porosity-sample-label";
    label.textContent = getPorosityTileSetLabel(tileSetIndex);
    row.append(label);

    const swatches = document.createElement("span");
    swatches.className = "porosity-sample-swatches";
    samples
      .filter((sample) => sample.tileSetIndex === tileSetIndex)
      .forEach((sample, index) => {
        const swatch = document.createElement("span");
        swatch.className = "porosity-sample";
        swatch.style.backgroundColor = formatPorosityColorSample(sample);
        swatch.title = `${getPorosityTileSetLabel(tileSetIndex)} sample ${
          index + 1
        }: ${formatPorosityColorSample(sample)}`;
        swatches.append(swatch);
      });
    row.append(swatches);
    porositySamples.append(row);
  });
}

function formatPorosityResultPercent(result) {
  return result ? `${result.percent.toFixed(1)}%` : "Not estimated";
}

function createPorosityResultBar(percent, color) {
  const bar = document.createElement("span");
  bar.className = "porosity-result-bar";
  const fill = document.createElement("span");
  fill.className = "porosity-result-bar-fill";
  fill.style.width = `${Math.max(0, Math.min(100, percent || 0))}%`;
  fill.style.backgroundColor = color || "#ff0000";
  bar.append(fill);
  return bar;
}

function renderPorosityResults() {
  if (!porosityResults) return;

  ensurePorosityTypes();
  porosityResults.innerHTML = "";

  const estimatedResults = porosityTypes
    .map((type) => type.result)
    .filter(Boolean);
  const resultScopes = new Set(
    estimatedResults.map((result) => result.scope || "aoi")
  );
  const hasMixedResultScopes = resultScopes.size > 1;
  let totalPorePixels = 0;
  let totalPixels = 0;
  porosityTypes.forEach((type) => {
    const row = document.createElement("div");
    row.className = "porosity-result-row";
    if (type.id === activePorosityTypeId) row.classList.add("is-active");
    if (type.visible === false) row.classList.add("is-hidden-type");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.title = `Select ${type.name}`;
    row.addEventListener("click", () => {
      activePorosityTypeId = type.id;
      porosityPickModeActive = false;
      syncPorosityControlsFromActiveType();
      drawPorosityOverlay();
    });
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      row.click();
    });

    const visibilityButton = document.createElement("button");
    visibilityButton.type = "button";
    visibilityButton.className = "annotation-visibility-button";
    const isVisible = type.visible !== false;
    visibilityButton.title = isVisible
      ? `Hide ${type.name} overlay`
      : `Show ${type.name} overlay`;
    visibilityButton.setAttribute(
      "aria-label",
      isVisible ? `Hide ${type.name} overlay` : `Show ${type.name} overlay`
    );
    visibilityButton.appendChild(createVisibilityIcon(isVisible));
    visibilityButton.addEventListener("click", (event) => {
      event.stopPropagation();
      type.visible = !isVisible;
      drawPorosityOverlay();
      updatePorosityControls(
        `${type.name} overlay ${type.visible ? "shown" : "hidden"}.`
      );
    });

    const nameCell = document.createElement("span");
    nameCell.className = "porosity-result-name-cell";
    const swatch = document.createElement("span");
    swatch.className = "porosity-result-swatch";
    swatch.style.backgroundColor = type.overlayColor || "#ff0000";
    const name = document.createElement("span");
    name.className = "porosity-result-name";
    name.textContent = type.name;
    nameCell.append(swatch, name);
    if (type.result) {
      const scopeBadge = document.createElement("span");
      scopeBadge.className = "porosity-result-scope";
      scopeBadge.textContent = type.result.scope === "view" ? "View" : "AOI";
      nameCell.append(scopeBadge);
    }

    const areaCell = document.createElement("span");
    areaCell.className = "porosity-result-area-cell";
    const percentText = document.createElement("span");
    percentText.textContent = formatPorosityResultPercent(type.result);
    areaCell.append(percentText);
    if (type.result && !hasMixedResultScopes) {
      areaCell.append(createPorosityResultBar(type.result.percent, type.overlayColor));
      totalPorePixels += type.result.porePixels;
      totalPixels = Math.max(totalPixels, type.result.totalPixels || 0);
    } else if (type.result) {
      areaCell.append(createPorosityResultBar(type.result.percent, type.overlayColor));
    }

    row.append(visibilityButton, nameCell, areaCell);
    porosityResults.append(row);
  });

  const totalRow = document.createElement("div");
  totalRow.className = "porosity-result-total-row";
  const totalSpacer = document.createElement("span");
  const totalNameCell = document.createElement("span");
  totalNameCell.textContent = "Total";
  const totalAreaCell = document.createElement("span");
  totalAreaCell.className = "porosity-result-area-cell";
  const totalPercent =
    !hasMixedResultScopes && totalPixels > 0
      ? (totalPorePixels / totalPixels) * 100
      : null;
  const totalPercentText = document.createElement("span");
  totalPercentText.textContent = hasMixedResultScopes
    ? "Mixed scopes"
    : totalPercent === null
      ? "Not estimated"
      : `${totalPercent.toFixed(1)}%`;
  totalAreaCell.append(totalPercentText);
  if (totalPercent !== null) {
    totalAreaCell.append(createPorosityResultBar(totalPercent, "#333333"));
  }
  totalRow.append(totalSpacer, totalNameCell, totalAreaCell);
  porosityResults.append(totalRow);
}

function updatePorosityControls(message) {
  if (porosityResolutionMode) {
    porosityResolutionMode.value = getPorosityAnalysisResolutionMode();
  }
  renderPorosityTypeSelect(activePorosityTypeId);
  renderPorosityResults();
  const activeType = getActivePorosityType();
  const hasAoi = porosityAoiComplete && porosityAoiImagePoints.length >= 3;
  const hasDraftAoi = porosityAoiImagePoints.length > 0;
  const hasSelectedTileSets = getPorositySelectedTileSetIndices().length > 0;
  const hasAnySamples = (activeType?.colorSamples || []).length > 0;
  const hasSamples = hasPorositySamplesForSelectedTileSets(activeType);
  const canAnalyze = hasAoi && hasSamples;
  const workflowEnabled = hasAoi;
  const porosityViewerContainer = document.getElementById("viewer-container");

  porosityPalette?.classList.toggle("porosity-workflow-disabled", !workflowEnabled);
  porosityViewerContainer?.classList.toggle(
    "porosity-pick-cursor",
    porosityPickModeActive
  );
  porosityViewerContainer?.classList.toggle(
    "porosity-aoi-editing",
    hasAoi && !porosityPickModeActive && !porosityAoiModeActive
  );

  if (porosityDrawAoiButton) {
    porosityDrawAoiButton.classList.toggle(
      "porosity-pick-active",
      porosityAoiModeActive
    );
    porosityDrawAoiButton.textContent = porosityAoiModeActive
      ? "Drawing..."
      : "Draw AOI";
  }
  if (porosityRenameTypeButton) {
    porosityRenameTypeButton.disabled = !workflowEnabled || !activeType;
    porosityRenameTypeButton.title = activeType
      ? `Rename ${activeType.name}`
      : "Rename porosity type";
  }
  if (porosityDeleteTypeButton) {
    porosityDeleteTypeButton.disabled = !workflowEnabled || porosityTypes.length <= 1;
    porosityDeleteTypeButton.title =
      porosityTypes.length <= 1
        ? "At least one porosity type is required"
        : `Delete ${activeType?.name || "porosity type"}`;
  }
  if (porosityToggleAoiButton) {
    porosityToggleAoiButton.disabled = !hasAoi;
    porosityToggleAoiButton.setAttribute(
      "aria-pressed",
      porosityAoiVisible ? "true" : "false"
    );
    porosityToggleAoiButton.title = porosityAoiVisible ? "Hide AOI" : "Show AOI";
    porosityToggleAoiButton.setAttribute(
      "aria-label",
      porosityAoiVisible ? "Hide AOI" : "Show AOI"
    );
    porosityToggleAoiButton.classList.toggle(
      "is-off",
      !porosityAoiVisible
    );
  }

  if (porosityPickColorButton) {
    porosityPickColorButton.disabled = !hasAoi || !hasSelectedTileSets;
    porosityPickColorButton.classList.toggle(
      "porosity-pick-active",
      porosityPickModeActive
    );
    porosityPickColorButton.textContent = porosityPickModeActive
      ? "Picking..."
      : "Pick Porosity";
  }
  if (porosityTypeSelect) porosityTypeSelect.disabled = !workflowEnabled;
  if (porosityAddTypeButton) porosityAddTypeButton.disabled = !workflowEnabled;
  if (porosityTileSetSelect) porosityTileSetSelect.disabled = !workflowEnabled;
  if (porosityEstimateButton) {
    porosityEstimateButton.disabled = !canAnalyze;
  }
  if (porosityEstimateViewButton) {
    porosityEstimateViewButton.disabled = !canAnalyze;
  }
  const activeResultExportSize = getPorosityResultExportSize(activeType?.result);
  updatePorosityResolutionStatus(activeResultExportSize);
  if (porosityUndoColorButton) {
    porosityUndoColorButton.disabled = !hasAnySamples && !porosityUndoState;
    porosityUndoColorButton.textContent =
      !hasAnySamples && porosityUndoState ? "Undo Reset" : "Undo";
  }
  if (porosityClearButton) {
    porosityClearButton.disabled =
      !hasDraftAoi &&
      porosityTypes.every(
        (type) => type.colorSamples.length === 0 && !type.result
      ) &&
      !porosityPickModeActive &&
      !porosityAoiModeActive;
  }
  [
    porosityTolerance,
    porosityToleranceValue,
    porosityOverlayColor,
    porosityOverlayOpacity,
    porosityOverlayOpacityValue,
  ].forEach((control) => {
    if (control) control.disabled = !workflowEnabled;
  });

  if (!porosityStatus) return;
  if (message) {
    porosityStatus.textContent = message;
  } else if (activeType?.result) {
    porosityStatus.textContent = `${activeType.name}: ${activeType.result.percent.toFixed(
      1
    )}% (${activeType.result.porePixels.toLocaleString()} of ${activeType.result.totalPixels.toLocaleString()} pixels).`;
  } else if (porosityAoiModeActive) {
    porosityStatus.textContent =
      porosityAoiImagePoints.length < 3
        ? "Click at least three AOI vertices. Drag to pan and scroll to zoom."
        : "Double-click to finish the AOI, or keep adding vertices.";
  } else if (!hasAoi) {
    porosityStatus.textContent = "Draw a polygon AOI, then pick pore colors.";
  } else if (!hasSelectedTileSets) {
    porosityStatus.textContent = "Select at least one tile set.";
  } else if (!hasSamples) {
    porosityStatus.textContent =
      "Pick pore colors for each selected tile set.";
  } else {
    const sampleCount = activeType?.colorSamples.length || 0;
    porosityStatus.textContent = `${activeType?.name || "Porosity"}: ${sampleCount} color sample${
      sampleCount === 1 ? "" : "s"
    }. Estimate when ready.`;
  }
}

function resetPorosityAnalysis(options = {}) {
  const {
    keepAoi = false,
    keepSamples = false,
    message = "",
    undoable = false,
  } = options;
  if (undoable) {
    porosityUndoState = clonePorosityState();
  } else {
    porosityUndoState = null;
  }
  porosityAoiModeActive = false;
  porosityPickModeActive = false;
  porosityAoiMousePoint = null;
  porosityAoiSelectedVertexIndex = null;
  porosityAoiDragState = null;
  porosityAoiVisible = true;
  porosityEstimateGeneration += 1;
  if (porosityToleranceReestimateTimer !== null) {
    window.clearTimeout(porosityToleranceReestimateTimer);
    porosityToleranceReestimateTimer = null;
  }
  if (porosityActivityClearTimer !== null) {
    window.clearTimeout(porosityActivityClearTimer);
    porosityActivityClearTimer = null;
  }
  if (porosityActivityStatus) {
    porosityActivityStatus.textContent = "";
    porosityActivityStatus.hidden = true;
  }
  if (porosityProgress) {
    if (porosityProgressClearTimer !== null) {
      window.clearTimeout(porosityProgressClearTimer);
      porosityProgressClearTimer = null;
    }
    porosityProgress.hidden = true;
  }
  if (porosityRecolorFrame !== null) {
    cancelAnimationFrame(porosityRecolorFrame);
    porosityRecolorFrame = null;
  }
  if (!keepAoi) {
    porosityAoiImagePoints = [];
    porosityAoiComplete = false;
  }
  if (!keepSamples) {
    porosityTypes.forEach((type) => {
      type.colorSamples = [];
      type.result = null;
    });
    renderPorositySamples();
  } else {
    porosityTypes.forEach((type) => {
      type.result = null;
    });
  }
  clearPorosityOverlay();
  drawPorosityOverlay();
  updatePorosityControls(message);
}

function undoPorosityReset() {
  if (!porosityUndoState) return false;

  const state = porosityUndoState;
  porosityUndoState = null;
  restorePorosityState(state, "Reset undone.");
  return true;
}

function stopPorosityAoiMode() {
  porosityAoiModeActive = false;
  porosityAoiDragState = null;
  updatePorosityControls();
}

function stopPorosityPickMode() {
  porosityPickModeActive = false;
  updatePorosityControls();
}

function refreshPorosityOverlayForViewportChange() {
  drawPorosityOverlay();
}

function invalidatePorosityResultsForAoiEdit() {
  porosityEstimateGeneration += 1;
  porosityTypes.forEach((type) => {
    type.result = null;
  });
}

function getPorosityViewerPixelFromClientPoint(clientX, clientY) {
  if (!viewerContainer) return null;

  const rect = viewerContainer.getBoundingClientRect();
  return new OpenSeadragon.Point(clientX - rect.left, clientY - rect.top);
}

function getPorosityImagePointFromClientPoint(clientX, clientY) {
  const viewerPixel = getPorosityViewerPixelFromClientPoint(clientX, clientY);
  return viewerPixel ? getPorosityImagePointFromViewerPixel(viewerPixel) : null;
}

function getPorosityAoiVertexHit(viewerPixel, maxDistance = 9) {
  if (!porosityAoiComplete || !viewerPixel) return null;

  const points = getPorosityAoiScreenPoints();
  let bestHit = null;
  points.forEach((point, index) => {
    const distance = Math.hypot(point.x - viewerPixel.x, point.y - viewerPixel.y);
    if (distance <= maxDistance && (!bestHit || distance < bestHit.distance)) {
      bestHit = { index, distance };
    }
  });
  return bestHit;
}

function getPointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
  );
  const projection = {
    x: start.x + t * dx,
    y: start.y + t * dy,
  };
  return Math.hypot(point.x - projection.x, point.y - projection.y);
}

function getPorosityAoiEdgeHit(viewerPixel, maxDistance = 8) {
  if (!porosityAoiComplete || !viewerPixel || porosityAoiImagePoints.length < 3) {
    return null;
  }

  const points = getPorosityAoiScreenPoints();
  let bestHit = null;
  points.forEach((point, index) => {
    const nextIndex = (index + 1) % points.length;
    const distance = getPointToSegmentDistance(
      viewerPixel,
      point,
      points[nextIndex]
    );
    if (distance <= maxDistance && (!bestHit || distance < bestHit.distance)) {
      bestHit = {
        insertIndex: nextIndex,
        distance,
      };
    }
  });
  return bestHit;
}

function deletePorosityAoiVertex(index) {
  if (
    !porosityAoiComplete ||
    index === null ||
    index < 0 ||
    index >= porosityAoiImagePoints.length ||
    porosityAoiImagePoints.length <= 3
  ) {
    updatePorosityControls("AOI needs at least three vertices.");
    return false;
  }

  porosityAoiImagePoints.splice(index, 1);
  porosityAoiSelectedVertexIndex = null;
  invalidatePorosityResultsForAoiEdit();
  drawPorosityOverlay();
  updatePorosityControls("AOI vertex deleted. Estimate again when ready.");
  return true;
}

function insertPorosityAoiVertex(viewerPixel) {
  const edgeHit = getPorosityAoiEdgeHit(viewerPixel);
  if (!edgeHit) return false;

  const imagePoint = getPorosityImagePointFromViewerPixel(viewerPixel);
  if (!imagePoint) return false;

  porosityAoiImagePoints.splice(edgeHit.insertIndex, 0, imagePoint);
  porosityAoiSelectedVertexIndex = edgeHit.insertIndex;
  invalidatePorosityResultsForAoiEdit();
  drawPorosityOverlay();
  updatePorosityControls("AOI vertex added. Estimate again when ready.");
  return true;
}

function constrainPorosityAoiPointToPrevious(imagePoint) {
  const previousPoint = porosityAoiImagePoints[porosityAoiImagePoints.length - 1];
  if (!imagePoint || !previousPoint) return imagePoint;

  const dx = Math.abs(imagePoint.x - previousPoint.x);
  const dy = Math.abs(imagePoint.y - previousPoint.y);
  return dx >= dy
    ? { x: imagePoint.x, y: previousPoint.y }
    : { x: previousPoint.x, y: imagePoint.y };
}

function startPorosityAoiVertexDrag(event) {
  if (!porosityAoiComplete || porosityPickModeActive || porosityAoiModeActive) {
    return false;
  }

  const viewerPixel = getPorosityViewerPixelFromClientPoint(
    event.clientX,
    event.clientY
  );
  const vertexHit = getPorosityAoiVertexHit(viewerPixel);
  if (!vertexHit) return false;

  event.preventDefault();
  event.stopPropagation();
  if (event.altKey) {
    deletePorosityAoiVertex(vertexHit.index);
    return true;
  }

  porosityAoiSelectedVertexIndex = vertexHit.index;
  porosityAoiDragState = {
    pointerId: event.pointerId,
    vertexIndex: vertexHit.index,
    moved: false,
  };
  viewerContainer?.setPointerCapture?.(event.pointerId);
  drawPorosityOverlay();
  updatePorosityControls("Drag AOI vertex, or press Delete to remove it.");
  return true;
}

function updatePorosityAoiVertexDrag(event) {
  if (!porosityAoiDragState) return;

  event.preventDefault();
  event.stopPropagation();
  const imagePoint = getPorosityImagePointFromClientPoint(
    event.clientX,
    event.clientY
  );
  if (!imagePoint) return;

  porosityAoiImagePoints[porosityAoiDragState.vertexIndex] = imagePoint;
  porosityAoiDragState.moved = true;
  invalidatePorosityResultsForAoiEdit();
  drawPorosityOverlay();
}

function finishPorosityAoiVertexDrag(event) {
  if (!porosityAoiDragState) return;

  event.preventDefault();
  event.stopPropagation();
  viewerContainer?.releasePointerCapture?.(porosityAoiDragState.pointerId);
  const moved = porosityAoiDragState.moved;
  porosityAoiDragState = null;
  updatePorosityControls(
    moved ? "AOI vertex moved. Estimate again when ready." : undefined
  );
}

async function reestimatePorosityTypesWithResults(options = {}) {
  showPorosityActivityStatus("Updating porosity estimation...");
  const estimateGeneration = options.estimateGeneration ?? porosityEstimateGeneration;
  const typesToEstimate = porosityTypes.filter(
    (type) => type.result || type.id === activePorosityTypeId
  );
  const nextResults = new Map();
  for (const type of typesToEstimate) {
    if (type.colorSamples.length > 0) {
      const result = await estimatePorosity({
        ...options,
        dryRun: true,
        typeId: type.id,
        resultOverrides: nextResults,
        estimateGeneration,
        scope: options.scope || type.result?.scope || "aoi",
      });
      if (estimateGeneration !== porosityEstimateGeneration) return;
      if (result) {
        nextResults.set(type.id, result);
      }
    }
  }
  nextResults.forEach((result, typeId) => {
    const type = porosityTypes.find((candidate) => candidate.id === typeId);
    if (type) type.result = result;
  });
  drawPorosityOverlay();
  renderPorosityResults();
  if (!options.preserveStatus) {
    updatePorosityControls();
  }
  clearPorosityActivityStatus();
}

function startPorosityAoiMode() {
  deactivateAnnotationModes();
  closeAnnotationSettingsPopover();
  closeCircleAnnotationOptionsPopover();
  closeReferenceCircleSettingsPopover();
  closeScaleWizard();
  if (typeof stopMeasurementMode === "function") {
    stopMeasurementMode();
  }

  porosityAoiModeActive = true;
  porosityPickModeActive = false;
  porosityAoiSelectedVertexIndex = null;
  porosityAoiDragState = null;
  porosityAoiVisible = true;
  porosityAoiImagePoints = [];
  porosityAoiComplete = false;
  porosityTypes.forEach((type) => {
    type.result = null;
  });
  if (porosityToleranceReestimateTimer !== null) {
    window.clearTimeout(porosityToleranceReestimateTimer);
    porosityToleranceReestimateTimer = null;
  }
  if (porosityRecolorFrame !== null) {
    cancelAnimationFrame(porosityRecolorFrame);
    porosityRecolorFrame = null;
  }
  drawPorosityOverlay();
  updatePorosityControls();
}

function finishPorosityAoi() {
  removeDuplicatePorosityAoiFinishPoint();
  if (porosityAoiImagePoints.length < 3) {
    updatePorosityControls("Add at least three AOI vertices.");
    return;
  }

  porosityAoiModeActive = false;
  porosityAoiComplete = true;
  porosityAoiSelectedVertexIndex = null;
  porosityTypes.forEach((type) => {
    type.result = null;
  });
  drawPorosityOverlay();
  updatePorosityControls("AOI ready. Pick pore colors inside it.");
}

function getPorosityImagePointFromViewerPixel(viewerPixel) {
  const image = viewer.world.getItemAt(0);
  if (!image) return null;

  const viewportPoint = viewer.viewport.pointFromPixel(viewerPixel);
  const imagePoint = image.viewportToImageCoordinates(viewportPoint);
  return { x: imagePoint.x, y: imagePoint.y };
}

function getPorosityScreenPointFromImagePoint(imagePoint) {
  const image = viewer.world.getItemAt(0);
  if (!image || !imagePoint) return null;

  const viewportPoint = image.imageToViewportCoordinates(imagePoint.x, imagePoint.y);
  return viewer.viewport.viewportToViewerElementCoordinates(viewportPoint);
}

function getPorosityAoiScreenPoints() {
  return porosityAoiImagePoints
    .map(getPorosityScreenPointFromImagePoint)
    .filter(Boolean);
}

function getPorosityAoiImageBounds() {
  if (porosityAoiImagePoints.length < 3) return null;

  const minX = Math.floor(Math.min(...porosityAoiImagePoints.map((point) => point.x)));
  const minY = Math.floor(Math.min(...porosityAoiImagePoints.map((point) => point.y)));
  const maxX = Math.ceil(Math.max(...porosityAoiImagePoints.map((point) => point.x)));
  const maxY = Math.ceil(Math.max(...porosityAoiImagePoints.map((point) => point.y)));
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < 1 || height < 1) return null;
  return { minX, minY, maxX, maxY, width, height };
}

function getPorosityCurrentViewImagePolygon() {
  const container = viewer?.container;
  if (!container) return [];

  return [
    new OpenSeadragon.Point(0, 0),
    new OpenSeadragon.Point(container.clientWidth, 0),
    new OpenSeadragon.Point(container.clientWidth, container.clientHeight),
    new OpenSeadragon.Point(0, container.clientHeight),
  ]
    .map(getPorosityImagePointFromViewerPixel)
    .filter(Boolean);
}

function getPorosityImageBoundsForPoints(points) {
  if (!points?.length) return null;

  const minX = Math.floor(Math.min(...points.map((point) => point.x)));
  const minY = Math.floor(Math.min(...points.map((point) => point.y)));
  const maxX = Math.ceil(Math.max(...points.map((point) => point.x)));
  const maxY = Math.ceil(Math.max(...points.map((point) => point.y)));
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < 1 || height < 1) return null;
  return { minX, minY, maxX, maxY, width, height };
}

function getPorosityViewImageBounds(aoiBounds, viewPolygon) {
  const viewBounds = getPorosityImageBoundsForPoints(viewPolygon);
  if (!aoiBounds || !viewBounds) return null;

  const minX = Math.max(aoiBounds.minX, viewBounds.minX);
  const minY = Math.max(aoiBounds.minY, viewBounds.minY);
  const maxX = Math.min(aoiBounds.maxX, viewBounds.maxX);
  const maxY = Math.min(aoiBounds.maxY, viewBounds.maxY);
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < 1 || height < 1) return null;
  return { minX, minY, maxX, maxY, width, height };
}

function getPorosityAoiViewportBounds(imageBounds) {
  const image = viewer.world.getItemAt(0);
  if (!image || !imageBounds) return null;

  const topLeft = image.imageToViewportCoordinates(
    new OpenSeadragon.Point(imageBounds.minX, imageBounds.minY)
  );
  const bottomRight = image.imageToViewportCoordinates(
    new OpenSeadragon.Point(imageBounds.maxX, imageBounds.maxY)
  );
  return new OpenSeadragon.Rect(
    Math.min(topLeft.x, bottomRight.x),
    Math.min(topLeft.y, bottomRight.y),
    Math.abs(bottomRight.x - topLeft.x),
    Math.abs(bottomRight.y - topLeft.y)
  );
}

function getPorosityAnalysisExportSize(imageBounds) {
  if (!imageBounds) return null;

  const settings = getPorosityAnalysisResolutionSettings();
  const sourceWidth = Math.max(1, Math.round(imageBounds.width));
  const sourceHeight = Math.max(1, Math.round(imageBounds.height));
  let width = Math.max(1, Math.round(sourceWidth * settings.targetScale));
  let height = Math.max(1, Math.round(sourceHeight * settings.targetScale));
  const sideScale = Math.min(
    1,
    settings.maxDimension / width,
    settings.maxDimension / height
  );
  const areaScale = Math.min(
    1,
    Math.sqrt(settings.maxPixels / (width * height))
  );
  const capScale = Math.min(sideScale, areaScale);
  if (capScale < 1) {
    width = Math.max(1, Math.round(width * capScale));
    height = Math.max(1, Math.round(height * capScale));
  }
  return {
    width,
    height,
    scale: Math.min(1, width / sourceWidth, height / sourceHeight),
    requestedScale: settings.targetScale,
    mode: settings.mode,
    label: settings.label,
  };
}

async function renderPorosityAnalysisCanvas(imageBounds, exportSize, tileSetIndex) {
  const pixelDensity =
    OpenSeadragon.pixelDensityRatio || window.devicePixelRatio || 1;
  const containerWidth = Math.max(1, Math.ceil(exportSize.width / pixelDensity));
  const containerHeight = Math.max(1, Math.ceil(exportSize.height / pixelDensity));
  const viewportBounds = getPorosityAoiViewportBounds(imageBounds);
  const selectedTileSet = tileSets()[tileSetIndex];

  if (!viewportBounds || !selectedTileSet) {
    throw new Error("No tile set is available for porosity estimation.");
  }

  const exportContainer = document.createElement("div");
  exportContainer.id = `porosity-export-${Date.now()}`;
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

  const exportTileSet = {
    ...selectedTileSet,
    tiles: selectedTileSet.tiles.map((tile) => ({ ...tile, image: null })),
  };

  try {
    for (const tile of exportTileSet.tiles) {
      const tileSource = await getTileSourceForExport(tile);
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
    exportViewer.viewport.fitBounds(viewportBounds, true);

    const activeTileImages = applySnapshotTileSetComposition(
      exportViewer,
      exportTileSet,
      1,
      tileSetIndex
    );
    await waitForExportViewerReady(exportViewer, activeTileImages, {
      outputPixels: exportSize.width * exportSize.height,
    });
    const sourceCanvas = getOpenSeadragonImageCanvas(exportViewer);
    if (!sourceCanvas) {
      throw new Error("Could not render porosity analysis canvas.");
    }

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = exportSize.width;
    outputCanvas.height = exportSize.height;
    const ctx = outputCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("Could not create porosity analysis canvas.");
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

function isPointInPolygon(point, polygon) {
  if (!point || polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function addPorosityAoiPoint(event) {
  let imagePoint = getPorosityImagePointFromViewerPixel(event.position);
  if (!imagePoint) return;
  if (event.originalEvent?.shiftKey) {
    imagePoint = constrainPorosityAoiPointToPrevious(imagePoint);
  }

  porosityAoiImagePoints.push(imagePoint);
  porosityTypes.forEach((type) => {
    type.result = null;
  });
  drawPorosityOverlay();
  updatePorosityControls();
}

function getPorosityCanvasPointFromViewerPixel(sourceCanvas, viewerPixel) {
  const canvasBounds = sourceCanvas.getBoundingClientRect();
  const viewerBounds = viewer.container.getBoundingClientRect();
  const scaleX = sourceCanvas.width / canvasBounds.width;
  const scaleY = sourceCanvas.height / canvasBounds.height;
  const pageX = viewerBounds.left + viewerPixel.x;
  const pageY = viewerBounds.top + viewerPixel.y;

  return {
    x: Math.floor((pageX - canvasBounds.left) * scaleX),
    y: Math.floor((pageY - canvasBounds.top) * scaleY),
  };
}

function getPorosityColorDistanceSquared(pixel, sample) {
  const dr = pixel.r - sample.r;
  const dg = pixel.g - sample.g;
  const db = pixel.b - sample.b;
  return dr * dr + dg * dg + db * db;
}

function isPorosityPixel(pixel, toleranceSquared) {
  const activeType = getActivePorosityType();
  return isPorosityPixelForType(pixel, activeType, toleranceSquared);
}

function isPorosityPixelForType(pixel, type, toleranceSquared) {
  return (type?.colorSamples || []).some(
    (sample) => getPorosityColorDistanceSquared(pixel, sample) <= toleranceSquared
  );
}

function isPorosityPixelForTileSet(pixel, type, tileSetIndex, toleranceSquared) {
  return (type?.colorSamples || []).some(
    (sample) =>
      sample.tileSetIndex === tileSetIndex &&
      getPorosityColorDistanceSquared(pixel, sample) <= toleranceSquared
  );
}

function getPorosityLinkedSampleSetsForTileSets(type, tileSetIndices) {
  normalizePorosityTypeSamples(type);
  const requiredTileSetIndices = [...new Set(tileSetIndices || [])];
  const groups = new Map();
  (type?.colorSamples || []).forEach((sample) => {
    if (!requiredTileSetIndices.includes(sample.tileSetIndex)) return;
    const sampleSetId = sample.sampleSetId || `legacy-${sample.tileSetIndex}`;
    if (!groups.has(sampleSetId)) {
      groups.set(sampleSetId, new Map());
    }
    groups.get(sampleSetId).set(sample.tileSetIndex, sample);
  });

  return Array.from(groups.values())
    .filter((samplesByTileSet) =>
      requiredTileSetIndices.every((tileSetIndex) =>
        samplesByTileSet.has(tileSetIndex)
      )
    )
    .map((samplesByTileSet) => ({
      samplesByTileSet,
    }));
}

function doesPixelMatchPorositySampleSet(
  pixelsByTileSet,
  sampleSet,
  tileSetIndices,
  toleranceSquared
) {
  return tileSetIndices.every((tileSetIndex) => {
    const pixel = pixelsByTileSet.get(tileSetIndex);
    const sample = sampleSet.samplesByTileSet.get(tileSetIndex);
    return (
      pixel &&
      sample &&
      getPorosityColorDistanceSquared(pixel, sample) <= toleranceSquared
    );
  });
}

function doesPixelMatchLinkedPorositySamples(
  pixelsByTileSet,
  sampleSets,
  tileSetIndices,
  toleranceSquared
) {
  return sampleSets.some((sampleSet) =>
    doesPixelMatchPorositySampleSet(
      pixelsByTileSet,
      sampleSet,
      tileSetIndices,
      toleranceSquared
    )
  );
}

function hasPorositySamplesForSelectedTileSets(type) {
  const selectedTileSetIndices = getPorositySelectedTileSetIndices();
  return (
    selectedTileSetIndices.length > 0 &&
    getPorosityLinkedSampleSetsForTileSets(type, selectedTileSetIndices).length > 0
  );
}

function isPorosityImagePointInMask(imagePoint, mask) {
  if (!imagePoint || !mask?.canvas || !mask.imageCorners) return false;

  const topLeft = mask.imageCorners.topLeft;
  const topRight = mask.imageCorners.topRight;
  const bottomLeft = mask.imageCorners.bottomLeft;
  if (!topLeft || !topRight || !bottomLeft) return false;

  const ax = (topRight.x - topLeft.x) / mask.canvas.width;
  const ay = (topRight.y - topLeft.y) / mask.canvas.width;
  const bx = (bottomLeft.x - topLeft.x) / mask.canvas.height;
  const by = (bottomLeft.y - topLeft.y) / mask.canvas.height;
  const det = ax * by - ay * bx;
  if (Math.abs(det) < 1e-12) return false;

  const dx = imagePoint.x - topLeft.x;
  const dy = imagePoint.y - topLeft.y;
  const x = Math.floor((dx * by - dy * bx) / det);
  const y = Math.floor((ax * dy - ay * dx) / det);
  if (x < 0 || y < 0 || x >= mask.canvas.width || y >= mask.canvas.height) {
    return false;
  }

  if (mask.alphaData) {
    return mask.alphaData[y * mask.canvas.width + x] > 0;
  }

  const ctx = mask.canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  return ctx.getImageData(x, y, 1, 1).data[3] > 0;
}

function isPorosityImagePointClaimedByOtherType(
  imagePoint,
  targetTypeId,
  resultOverrides = null
) {
  return porosityTypes.some((type) => {
    if (type.id === targetTypeId) return false;
    const overrideResult = resultOverrides?.get(type.id);
    const result = overrideResult || type.result;
    return isPorosityImagePointInMask(imagePoint, result?.mask);
  });
}

async function addPorosityColorSample(event) {
  const imagePoint = getPorosityImagePointFromViewerPixel(event.position);
  if (!imagePoint) return;
  const selectedTileSetIndices = getPorositySelectedTileSetIndices();
  if (selectedTileSetIndices.length === 0) {
    updatePorosityControls("Select at least one tile set first.");
    return;
  }

  try {
    const activeType = getActivePorosityType();
    if (!activeType) return;
    showPorosityActivityStatus("Sampling selected tile sets...");
    const imageBounds = {
      minX: Math.floor(imagePoint.x),
      minY: Math.floor(imagePoint.y),
      maxX: Math.floor(imagePoint.x) + 1,
      maxY: Math.floor(imagePoint.y) + 1,
      width: 1,
      height: 1,
    };
    const exportSize = { width: 1, height: 1, scale: 1 };
    const sampleSetId = `sample-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const pickedSamples = [];
    for (const tileSetIndex of selectedTileSetIndices) {
      const sampleCanvas = await renderPorosityAnalysisCanvas(
        imageBounds,
        exportSize,
        tileSetIndex
      );
      const data = sampleCanvas
        .getContext("2d", { willReadFrequently: true })
        .getImageData(0, 0, 1, 1).data;
      if (data[3] === 0) continue;
      pickedSamples.push({
        sampleSetId,
        tileSetIndex,
        r: data[0],
        g: data[1],
        b: data[2],
      });
    }
    if (pickedSamples.length === 0) {
      updatePorosityControls("Could not sample a color at that point.");
      clearPorosityActivityStatus();
      return;
    }
    if (pickedSamples.length !== selectedTileSetIndices.length) {
      updatePorosityControls("Could not sample every selected tile set.");
      clearPorosityActivityStatus();
      return;
    }
    activeType.colorSamples.push(...pickedSamples);
    activeType.result = null;
    drawPorosityOverlay();
    renderPorositySamples();
    updatePorosityControls();
    clearPorosityActivityStatus();
  } catch (error) {
    console.error("Porosity color pick failed:", error);
    updatePorosityControls("Could not sample selected tile sets.");
    clearPorosityActivityStatus();
  }
}

async function estimatePorosity(options = {}) {
  const {
    dryRun = false,
    preserveStatus = false,
    resultOverrides = null,
    typeId = activePorosityTypeId,
    estimateGeneration = porosityEstimateGeneration,
    scope = "aoi",
  } = options;
  const targetType =
    porosityTypes.find((type) => type.id === typeId) || getActivePorosityType();
  const aoiBounds = getPorosityAoiImageBounds();
  const viewPolygon = scope === "view" ? getPorosityCurrentViewImagePolygon() : [];
  const imageBounds =
    scope === "view" ? getPorosityViewImageBounds(aoiBounds, viewPolygon) : aoiBounds;
  if (!porosityAoiComplete || !imageBounds) {
    updatePorosityControls("Draw a polygon AOI before estimating.");
    return;
  }
  if (!targetType || targetType.colorSamples.length === 0) {
    updatePorosityControls("Pick at least one pore color first.");
    return;
  }
  normalizePorosityTypeSamples(targetType);
  const selectedTileSetIndices = getPorositySelectedTileSetIndices();
  if (!hasPorositySamplesForSelectedTileSets(targetType)) {
    updatePorosityControls("Pick pore colors for each selected tile set first.");
    return;
  }

  const exportSize = getPorosityAnalysisExportSize(imageBounds);
  if (!exportSize) {
    updatePorosityControls("Could not determine the AOI resolution.");
    return;
  }
  updatePorosityResolutionStatus(exportSize);
  const imageCorners = {
    topLeft: { x: imageBounds.minX, y: imageBounds.minY },
    topRight: { x: imageBounds.maxX, y: imageBounds.minY },
    bottomLeft: { x: imageBounds.minX, y: imageBounds.maxY },
  };
  const previousResult = targetType.result;

  try {
    const analysisImages = [];
    setPorosityProgress(
      scope === "view"
        ? "Rendering selected tile sets for view..."
        : "Rendering selected tile sets for AOI..."
    );
    for (const tileSetIndex of selectedTileSetIndices) {
      const canvas = await renderPorosityAnalysisCanvas(
        imageBounds,
        exportSize,
        tileSetIndex
      );
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      analysisImages.push({
        tileSetIndex,
        canvas,
        imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
      });
    }
    const sourceCanvas = analysisImages[0]?.canvas;
    if (!sourceCanvas) {
      throw new Error("Could not render selected tile sets for porosity estimation.");
    }
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = sourceCanvas.width;
    maskCanvas.height = sourceCanvas.height;
    const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
    const mask = maskCtx.createImageData(maskCanvas.width, maskCanvas.height);
    const alphaData = new Uint8Array(maskCanvas.width * maskCanvas.height);
    if (targetType.id === activePorosityTypeId) {
      syncActivePorosityTypeFromControls();
    }
    if (!dryRun) {
      targetType.result = null;
    }
    const overlayColor = getPorosityOverlayColorRgbForType(targetType);
    const overlayAlpha = getPorosityOverlayAlphaForType(targetType);
    const imageScaleX = imageBounds.width / sourceCanvas.width;
    const imageScaleY = imageBounds.height / sourceCanvas.height;
    const toleranceSquared = getPorosityToleranceValueForType(targetType) ** 2;
    const linkedSampleSets = getPorosityLinkedSampleSetsForTileSets(
      targetType,
      selectedTileSetIndices
    );
    let porePixels = 0;
    let totalPixels = 0;
    let lastProgressUpdate = 0;

    for (let y = 0; y < sourceCanvas.height; y += 1) {
      if (y - lastProgressUpdate >= 24 || y === 0) {
        const percent = (y / sourceCanvas.height) * 100;
        setPorosityProgress(
          scope === "view"
            ? `Estimating visible AOI... ${Math.round(percent)}%`
            : `Estimating full AOI... ${Math.round(percent)}%`,
          percent
        );
        lastProgressUpdate = y;
        await wait(0);
        if (estimateGeneration !== porosityEstimateGeneration) {
          clearPorosityProgress();
          return previousResult || null;
        }
      }
      for (let x = 0; x < sourceCanvas.width; x += 1) {
        const imagePoint = {
          x: imageBounds.minX + (x + 0.5) * imageScaleX,
          y: imageBounds.minY + (y + 0.5) * imageScaleY,
        };
        if (!isPointInPolygon(imagePoint, porosityAoiImagePoints)) continue;
        if (scope === "view" && !isPointInPolygon(imagePoint, viewPolygon)) {
          continue;
        }

        const sourceIndex = (y * sourceCanvas.width + x) * 4;

        totalPixels += 1;
        const pixelsByTileSet = new Map();
        let hasPixelForEveryTileSet = true;
        for (const analysisImage of analysisImages) {
          const data = analysisImage.imageData.data;
          if (data[sourceIndex + 3] === 0) {
            hasPixelForEveryTileSet = false;
            break;
          }
          pixelsByTileSet.set(analysisImage.tileSetIndex, {
            r: data[sourceIndex],
            g: data[sourceIndex + 1],
            b: data[sourceIndex + 2],
          });
        }
        const matchesSelectedTileSets =
          hasPixelForEveryTileSet &&
          doesPixelMatchLinkedPorositySamples(
            pixelsByTileSet,
            linkedSampleSets,
            selectedTileSetIndices,
            toleranceSquared
          );
        if (
          matchesSelectedTileSets &&
          !isPorosityImagePointClaimedByOtherType(
            imagePoint,
            targetType.id,
            resultOverrides
          )
        ) {
          const maskIndex = (y * sourceCanvas.width + x) * 4;
          const alphaIndex = y * sourceCanvas.width + x;
          porePixels += 1;
          mask.data[maskIndex] = overlayColor.r;
          mask.data[maskIndex + 1] = overlayColor.g;
          mask.data[maskIndex + 2] = overlayColor.b;
          mask.data[maskIndex + 3] = overlayAlpha;
          alphaData[alphaIndex] = overlayAlpha;
        }
      }
    }

    if (preserveStatus && previousResult && porePixels === 0) {
      if (!dryRun) {
        targetType.result = previousResult;
        drawPorosityOverlay();
      }
      return previousResult;
    }

    maskCtx.putImageData(mask, 0, 0);
    setPorosityProgress("Porosity estimation complete.", 100);
    const nextResult = {
      mask: {
        canvas: maskCanvas,
        rect: null,
        imageCorners,
        alphaData,
      },
      porePixels,
      totalPixels,
      percent: totalPixels > 0 ? (porePixels / totalPixels) * 100 : 0,
      analysisScale: exportSize.scale,
      analysisWidth: exportSize.width,
      analysisHeight: exportSize.height,
      analysisResolutionMode: exportSize.mode,
      analysisResolutionLabel: exportSize.label,
      tileSetIndices: [...selectedTileSetIndices],
      scope,
    };
    if (!dryRun) {
      if (estimateGeneration !== porosityEstimateGeneration) {
        clearPorosityProgress();
        return previousResult || null;
      }
      targetType.result = nextResult;
      drawPorosityOverlay();
      if (!preserveStatus) {
        updatePorosityControls();
      }
    }
    return nextResult;
  } catch (error) {
    console.error("Porosity estimate failed:", error);
    if (!dryRun) {
      if (targetType) targetType.result = previousResult || null;
      drawPorosityOverlay();
      updatePorosityControls("Could not render the AOI for porosity estimation.");
      clearPorosityProgress();
    }
    return previousResult || null;
  }
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
  const tileSetLabel = tileSet?.label?.trim();
  if (tileSetLabel) return tileSetLabel;

  const firstTileLabel = tileSet?.tiles?.[0]?.label?.trim();
  return firstTileLabel || `Img ${index + 1}`;
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

function getTileOpacityGetterForViewer(
  targetViewer,
  tileSet,
  tileSetOpacity = 1,
  tileSetIndex = 0
) {
  const tiles = tileSet.tiles;
  const periodDegrees = tileSet.periodDegrees;
  if (!periodDegrees) {
    return (index) =>
      index === getTileSetVisibleTileIndex(tileSetIndex) ? tileSetOpacity : 0;
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

function applySnapshotTileSetComposition(
  targetViewer,
  tileSet,
  tileSetOpacity = 1,
  tileSetIndex = 0
) {
  const activeTileImages = [];
  if (!tileSet) return activeTileImages;

  const getTileOpacity = getTileOpacityGetterForViewer(
    targetViewer,
    tileSet,
    tileSetOpacity,
    tileSetIndex
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

function getExportViewerReadyTimeoutMs(outputPixels = 0) {
  const megapixels = Math.max(0, Number(outputPixels) || 0) / 1000000;
  return Math.min(300000, Math.max(120000, 120000 + megapixels * 3000));
}

async function waitForExportViewerReady(
  exportViewer,
  activeTileImages,
  options = {}
) {
  const startTime = Date.now();
  let lastActivity = Date.now();
  const timeoutMs = getExportViewerReadyTimeoutMs(options.outputPixels);
  const markActivity = () => {
    lastActivity = Date.now();
  };

  exportViewer.addHandler("tile-loaded", markActivity);
  exportViewer.addHandler("tile-drawn", markActivity);
  exportViewer.addHandler("animation", markActivity);
  exportViewer.addHandler("animation-finish", markActivity);

  try {
    while (Date.now() - startTime < timeoutMs) {
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
    throw new Error(
      `Timed out while loading image tiles after ${Math.round(
        timeoutMs / 1000
      )} seconds. Try a lower segmentation resolution or a smaller AOI.`
    );
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
  const selectedTileSetIndex = getSnapshotTileSetIndex();
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
        const tileSource = await getTileSourceForExport(tile);
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
      selectedTileSetOpacity,
      selectedTileSetIndex
    );
    await waitForExportViewerReady(exportViewer, activeTileImages, {
      outputPixels: exportSize.width * exportSize.height,
    });
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

function getViewportBoundsForImageRect(imageRect) {
  const image = viewer.world.getItemAt(0);
  if (!image || !imageRect) return null;

  const topLeft = image.imageToViewportCoordinates(imageRect.x, imageRect.y);
  const bottomRight = image.imageToViewportCoordinates(
    imageRect.x + imageRect.width,
    imageRect.y + imageRect.height
  );
  return new OpenSeadragon.Rect(
    Math.min(topLeft.x, bottomRight.x),
    Math.min(topLeft.y, bottomRight.y),
    Math.abs(bottomRight.x - topLeft.x),
    Math.abs(bottomRight.y - topLeft.y)
  );
}

async function renderFullResolutionImageRectCanvas(
  imageRect,
  tileSetIndex = 0,
  outputScale = 1
) {
  const renderScale = Math.max(0.05, Math.min(1, Number(outputScale) || 1));
  const exportSize = {
    width: Math.max(1, Math.round(imageRect.width * renderScale)),
    height: Math.max(1, Math.round(imageRect.height * renderScale)),
  };
  const pixelDensity =
    OpenSeadragon.pixelDensityRatio || window.devicePixelRatio || 1;
  const containerWidth = Math.max(1, Math.ceil(exportSize.width / pixelDensity));
  const containerHeight = Math.max(1, Math.ceil(exportSize.height / pixelDensity));
  const imageViewportBounds = getViewportBoundsForImageRect(imageRect);
  const selectedTileSet = tileSets()[tileSetIndex] || tileSets()[0] || null;
  const selectedTileSetOpacity = 1;

  if (!imageViewportBounds || !selectedTileSet) {
    throw new Error("Could not determine the image crop source.");
  }

  const exportContainer = document.createElement("div");
  exportContainer.id = `segment-export-${Date.now()}`;
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

  const exportTileSet = {
    ...selectedTileSet,
    tiles: selectedTileSet.tiles.map((tile) => ({
      ...tile,
      image: null,
    })),
  };

  try {
    for (const tile of exportTileSet.tiles) {
      const tileSource = await getTileSourceForExport(tile);
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
    exportViewer.viewport.fitBounds(imageViewportBounds, true);

    const activeTileImages = applySnapshotTileSetComposition(
      exportViewer,
      exportTileSet,
      selectedTileSetOpacity,
      tileSetIndex
    );
    await waitForExportViewerReady(exportViewer, activeTileImages, {
      outputPixels: exportSize.width * exportSize.height,
    });
    const sourceCanvas = getOpenSeadragonImageCanvas(exportViewer);
    if (!sourceCanvas) {
      throw new Error("Could not render the segmentation crop.");
    }

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = exportSize.width;
    outputCanvas.height = exportSize.height;
    const ctx = outputCanvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not create the segmentation crop canvas.");
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
  scheduleClampOpenToolPalettes();
}

function closeViewerToolsTray() {
  if (!viewerToolsTray || !viewerToolsButton) return;

  viewerToolsTray.hidden = true;
  viewerToolsButton.setAttribute("aria-expanded", "false");
  scheduleClampOpenToolPalettes();
}

function toggleElectronActionTray() {
  if (!electronActionTray || !electronActionButton) return;

  const willOpen = electronActionTray.hidden;
  electronActionTray.hidden = !willOpen;
  electronActionButton.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) closeViewerToolsTray();
  scheduleClampOpenToolPalettes();

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
  scheduleClampOpenToolPalettes();

  if (willOpen) {
    const firstTool = viewerToolsTray.querySelector(
      ".electron-action-item:not([hidden])"
    );
    firstTool?.focus();
  }
}

if (hasSharedViewerMenus) {
  if (loadLibraryButton) loadLibraryButton.hidden = true;
  electronActionButton.hidden = false;
  viewerToolsButton.hidden = false;
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
      closePorosityEstimator();
      closeSegmentPalette();
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

if (hasSharedViewerMenus && openGridCountPaletteButton && gridCountPalette) {
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
    scheduleClampOpenToolPalettes();
  });
}

if (window.ResizeObserver && controlsPanel) {
  const controlsResizeObserver = new ResizeObserver(() => {
    scheduleClampOpenToolPalettes();
  });
  controlsResizeObserver.observe(controlsPanel);
}

const paletteResizeViewerContainer = document.getElementById("viewer-container");
if (window.ResizeObserver && paletteResizeViewerContainer) {
  const viewerResizeObserver = new ResizeObserver(() => {
    scheduleClampOpenToolPalettes();
  });
  viewerResizeObserver.observe(paletteResizeViewerContainer);
}

const viewerCornerActions = document.querySelector(".viewer-corner-actions");
if (window.ResizeObserver && viewerCornerActions) {
  const viewerCornerActionsResizeObserver = new ResizeObserver(() => {
    scheduleClampOpenToolPalettes();
  });
  viewerCornerActionsResizeObserver.observe(viewerCornerActions);
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

if (hasSharedViewerMenus && openAnnotatePaletteButton && annotatePalette) {
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
    scheduleClampOpenToolPalettes();
  });
}

if (hasSharedViewerMenus && openMeasurePaletteButton && measurePalette) {
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
    closeReferenceCircleSettingsPopover();
    closeMeasureColumnsMenu();
    refreshOpenMeasureAnalysisMenus();
    scheduleClampOpenToolPalettes();
  });
}

if (hasSharedViewerMenus && openSnapshotPaletteButton && snapshotPalette) {
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
    scheduleClampOpenToolPalettes();
    if (snapshotSelectionRect) {
      clearSnapshotSelection();
      updateSnapshotStatus("Draw a new area after resizing the viewer.");
    }
  });
}

if (hasSharedViewerMenus && openPorosityEstimatorButton && porosityPalette) {
  ensurePorosityTypes();
  renderPorosityTileSetSelect();
  renderPorosityTypeSelect();
  syncPorosityControlsFromActiveType();
  openPorosityEstimatorButton.hidden = false;
  openPorosityEstimatorButton.setAttribute("aria-pressed", "false");
  openPorosityEstimatorButton.addEventListener("click", function (event) {
    event.preventDefault();
    closeViewerToolsTray();
    togglePorosityEstimator();
  });
  closePorosityPaletteButton?.addEventListener("click", function () {
    closePorosityEstimator();
  });
  minimizePorosityPaletteButton?.addEventListener("click", function () {
    toggleToolPaletteMinimized(
      porosityPalette,
      minimizePorosityPaletteButton
    );
  });
  porosityTypeSelect?.addEventListener("change", function () {
    activePorosityTypeId = porosityTypeSelect.value;
    porosityPickModeActive = false;
    syncPorosityControlsFromActiveType();
    drawPorosityOverlay();
  });
  porosityTileSetSelect?.addEventListener("change", function () {
    porositySelectedTileSetIndices = Array.from(
      porosityTileSetSelect.selectedOptions
    )
      .map((option) => normalizePorosityTileSetIndex(option.value))
      .filter((index) => index !== null);
    porosityTypes.forEach((type) => {
      normalizePorosityTypeSamples(type);
      type.result = null;
    });
    drawPorosityOverlay();
    renderPorositySamples();
    updatePorosityControls("Estimate again after changing tile sets.");
  });
  porosityResolutionMode?.addEventListener("change", function () {
    porosityAnalysisResolutionMode = getPorosityAnalysisResolutionMode();
    porosityTypes.forEach((type) => {
      type.result = null;
    });
    drawPorosityOverlay();
    updatePorosityResolutionStatus();
    updatePorosityControls("Estimate again after changing analysis resolution.");
  });
  porosityAddTypeButton?.addEventListener("click", function () {
    showPrompt(
      "Enter porosity type name:",
      (value) => addPorosityType(value),
      `Porosity ${porosityTypes.length + 1}`
    );
  });
  porosityRenameTypeButton?.addEventListener("click", function () {
    const activeType = getActivePorosityType();
    if (!activeType) return;

    showPrompt(
      "Rename porosity type:",
      (value) => renamePorosityType(activeType.id, value),
      activeType.name
    );
  });
  porosityDeleteTypeButton?.addEventListener("click", function () {
    deletePorosityType(activePorosityTypeId);
  });
  porosityDrawAoiButton?.addEventListener("click", function () {
    restoreToolPaletteFromMinimized(
      porosityPalette,
      minimizePorosityPaletteButton
    );
    startPorosityAoiMode();
  });
  porosityToggleAoiButton?.addEventListener("click", function () {
    porosityAoiVisible = !porosityAoiVisible;
    drawPorosityOverlay();
    updatePorosityControls(porosityAoiVisible ? "AOI shown." : "AOI hidden.");
  });
  porosityPickColorButton?.addEventListener("click", function () {
    if (!porosityAoiComplete) {
      updatePorosityControls("Draw an AOI before picking colors.");
      return;
    }
    porosityAoiModeActive = false;
    porosityPickModeActive = !porosityPickModeActive;
    if (porosityPickModeActive) {
      deactivateAnnotationModes();
      closeAnnotationSettingsPopover();
      closeCircleAnnotationOptionsPopover();
      closeReferenceCircleSettingsPopover();
      closeScaleWizard();
      if (typeof stopMeasurementMode === "function") {
        stopMeasurementMode();
      }
    }
    updatePorosityControls(
      porosityPickModeActive
        ? "Click pore-colored pixels anywhere in the image."
        : "Color picking stopped."
    );
  });
  porosityEstimateViewButton?.addEventListener("click", async function () {
    porosityPickModeActive = false;
    porosityEstimateGeneration += 1;
    const estimateGeneration = porosityEstimateGeneration;
    showPorosityActivityStatus("Estimating visible AOI...");
    await estimatePorosity({ estimateGeneration, scope: "view" });
    clearPorosityActivityStatus();
    clearPorosityProgress();
  });
  porosityEstimateButton?.addEventListener("click", async function () {
    porosityPickModeActive = false;
    porosityEstimateGeneration += 1;
    const estimateGeneration = porosityEstimateGeneration;
    showPorosityActivityStatus("Estimating full AOI...");
    await estimatePorosity({ estimateGeneration, scope: "aoi" });
    clearPorosityActivityStatus();
    clearPorosityProgress();
  });
  porosityClearButton?.addEventListener("click", function () {
    resetPorosityAnalysis({
      undoable: true,
      message: "Porosity analysis reset. Use Undo Reset to restore it.",
    });
  });
  porosityUndoColorButton?.addEventListener("click", function () {
    const activeType = getActivePorosityType();
    if (!activeType) return;
    if (activeType.colorSamples.length === 0) {
      undoPorosityReset();
      return;
    }

    const lastSample = activeType.colorSamples[activeType.colorSamples.length - 1];
    if (lastSample?.sampleSetId) {
      activeType.colorSamples = activeType.colorSamples.filter(
        (sample) => sample.sampleSetId !== lastSample.sampleSetId
      );
    } else {
      activeType.colorSamples.pop();
    }
    activeType.result = null;
    renderPorositySamples();
    drawPorosityOverlay();
    updatePorosityControls("Removed the last picked color.");
  });
  porosityTolerance?.addEventListener("input", function () {
    const activeType = syncActivePorosityTypeFromControls();
    if (activeType?.result) {
      porosityEstimateGeneration += 1;
      const estimateGeneration = porosityEstimateGeneration;
      showPorosityActivityStatus("Updating porosity estimation...");
      if (porosityToleranceReestimateTimer !== null) {
        window.clearTimeout(porosityToleranceReestimateTimer);
      }
      porosityToleranceReestimateTimer = window.setTimeout(async () => {
        porosityToleranceReestimateTimer = null;
        if (estimateGeneration !== porosityEstimateGeneration) return;
        await reestimatePorosityTypesWithResults({
          estimateGeneration,
          scope: activeType.result?.scope || "aoi",
        });
        clearPorosityProgress();
      }, 250);
    } else {
      updatePorosityControls();
    }
  });
  porosityToleranceValue?.addEventListener("change", function () {
    const activeType = setPorosityToleranceControlValue(porosityToleranceValue.value);
    if (activeType?.result) {
      porosityEstimateGeneration += 1;
      const estimateGeneration = porosityEstimateGeneration;
      showPorosityActivityStatus("Updating porosity estimation...");
      if (porosityToleranceReestimateTimer !== null) {
        window.clearTimeout(porosityToleranceReestimateTimer);
      }
      porosityToleranceReestimateTimer = window.setTimeout(async () => {
        porosityToleranceReestimateTimer = null;
        if (estimateGeneration !== porosityEstimateGeneration) return;
        await reestimatePorosityTypesWithResults({
          estimateGeneration,
          scope: activeType.result?.scope || "aoi",
        });
        clearPorosityProgress();
      }, 250);
    } else {
      updatePorosityControls();
    }
  });
  porosityOverlayColor?.addEventListener("input", function () {
    syncActivePorosityTypeFromControls();
    schedulePorosityMaskRecolor();
  });
  porosityOverlayOpacity?.addEventListener("input", function () {
    if (porosityOverlayOpacityValue) {
      porosityOverlayOpacityValue.value = porosityOverlayOpacity.value;
    }
    syncActivePorosityTypeFromControls();
    schedulePorosityMaskRecolor();
  });
  porosityOverlayOpacityValue?.addEventListener("change", function () {
    setPorosityOverlayOpacityControlValue(porosityOverlayOpacityValue.value);
    syncActivePorosityTypeFromControls();
    schedulePorosityMaskRecolor();
  });
  makeToolPaletteDraggable(
    porosityPalette,
    porosityPaletteHeader,
    "petroImage.porosityPalette"
  );
  window.addEventListener("resize", function () {
    scheduleClampOpenToolPalettes();
    drawPorosityOverlay();
  });
}

if (
  hasSharedViewerMenus &&
  hasElectronActions &&
  openSegmentPaletteButton &&
  segmentPalette
) {
  openSegmentPaletteButton.hidden = false;
  openSegmentPaletteButton.setAttribute("aria-pressed", "false");
  openSegmentPaletteButton.addEventListener("click", function (event) {
    event.preventDefault();
    closeViewerToolsTray();
    toggleSegmentPalette();
  });
  closeSegmentPaletteButton?.addEventListener("click", function () {
    closeSegmentPalette();
  });
  minimizeSegmentPaletteButton?.addEventListener("click", function () {
    toggleToolPaletteMinimized(segmentPalette, minimizeSegmentPaletteButton);
  });
  chooseSamPythonButton?.addEventListener("click", function () {
    chooseSamPython();
  });
  chooseSamCheckpointButton?.addEventListener("click", function () {
    chooseSamCheckpoint();
  });
  chooseSegmenteverygrainModelButton?.addEventListener("click", function () {
    chooseSegmenteverygrainModel();
  });
  saveSamSettingsButton?.addEventListener("click", function () {
    saveSamSettings();
  });
  testSamSetupButton?.addEventListener("click", function () {
    testSamSetup();
  });
  testSegmenteverygrainSetupButton?.addEventListener("click", function () {
    testSegmenteverygrainSetup();
  });
  segmentDrawBoxButton?.addEventListener("click", function () {
    startSegmentBoxMode();
  });
  segmentClearButton?.addEventListener("click", function () {
    clearSegmentPreview();
  });
  segmentAddPositivePointButton?.addEventListener("click", function () {
    setSegmentPointMode("positive");
  });
  segmentAddNegativePointButton?.addEventListener("click", function () {
    setSegmentPointMode("negative");
  });
  segmentAddAnnotationButton?.addEventListener("click", function () {
    commitSegmentPreview();
  });
  unsupervisedDrawAoiButton?.addEventListener("click", function () {
    startUnsupervisedAoiMode();
  });
  unsupervisedClearAoiButton?.addEventListener("click", function () {
    clearUnsupervisedAoi();
  });
  runUnsupervisedSegmentationButton?.addEventListener("click", function () {
    runUnsupervisedSegmentation();
  });
  cancelUnsupervisedSegmentationButton?.addEventListener("click", function () {
    cancelUnsupervisedSegmentation();
  });
  segmentModeToggle?.addEventListener("change", function () {
    setSegmentModeActive(segmentModeToggle.checked);
  });
  segmentAutoAddCheckbox?.addEventListener("change", function () {
    if (!segmentModeActive) {
      segmentAutoAddUserChecked = segmentAutoAddCheckbox.checked;
    }
    updateSegmentControls();
  });
  segmentTileSetSelect?.addEventListener("change", function () {
    updateSegmentControls();
  });
  segmentResolutionSelect?.addEventListener("change", function () {
    updateSegmentControls();
  });
  segmentSimplifyEnabledInput?.addEventListener("change", function () {
    updateSegmentSimplifyControls();
  });
  unsupervisedSimplifyEnabledInput?.addEventListener("change", function () {
    updateSegmentSimplifyControls();
  });
  unsupervisedSegmentTileSetSelect?.addEventListener("change", function () {
    updateUnsupervisedSegmentControls();
  });
  unsupervisedResolutionSelect?.addEventListener("change", function () {
    refreshUnsupervisedAoiPreviewAndControls();
  });
  [
    unsupervisedUseSamRefinementInput,
    unsupervisedMinAreaInput,
    unsupervisedPatchSizeInput,
    unsupervisedOverlapInput,
    unsupervisedDilationInput,
    unsupervisedShowPatchGridInput,
    unsupervisedRemoveEdgeGrainsInput,
  ].forEach((input) => {
    input?.addEventListener("input", function () {
      refreshUnsupervisedAoiPreviewAndControls();
    });
    input?.addEventListener("change", function () {
      refreshUnsupervisedAoiPreviewAndControls();
    });
  });
  segmentAnnotationGroupInput?.addEventListener("change", function () {
    populateSegmentAnnotationGroupOptions();
  });
  samModelTypeSelect?.addEventListener("change", function () {
    updateSamReadinessIndicator();
    saveSamSettings("SAM model type saved.");
  });
  [samPythonPathInput, samCheckpointPathInput].forEach((input) => {
    input?.addEventListener("input", function () {
      updateSamReadinessIndicator();
      if (input === samPythonPathInput) {
        updateSegmenteverygrainReadinessIndicator();
      }
    });
    input?.addEventListener("change", function () {
      updateSamReadinessIndicator();
      if (input === samPythonPathInput) {
        updateSegmenteverygrainReadinessIndicator();
      }
      saveSamSettings("SAM settings saved.");
    });
  });
  segmenteverygrainModelPathInput?.addEventListener("input", function () {
    updateSegmenteverygrainReadinessIndicator();
    updateUnsupervisedSegmentControls();
  });
  segmenteverygrainModelPathInput?.addEventListener("change", function () {
    updateSegmenteverygrainReadinessIndicator();
    saveSegmenteverygrainSettings("segmenteverygrain settings saved.");
  });
  [
    segmentPaddingPercentInput,
    segmentPaddingMinInput,
    segmentPaddingMaxInput,
  ].forEach((input) => {
    input?.addEventListener("input", function () {
      updateSegmentPaddingStatus();
    });
  });
  makeToolPaletteDraggable(
    segmentPalette,
    segmentPaletteHeader,
    "petroImage.segmentPalette"
  );
  window.addEventListener("resize", function () {
    scheduleClampOpenToolPalettes();
  });
  loadSamSettings();
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

if (hasSharedViewerMenus && actionLoadLibraryButton) {
  actionLoadLibraryButton.addEventListener("click", function (event) {
    event.preventDefault();
    closeElectronActionTray();
    if (window.electronAPI?.selectExistingJsonFile) {
      loadLibraryWithElectronDialog();
      return;
    }

    loadLibraryInput.click();
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

  // Update the sample dropdown on group change.
  groupDropdown.onchange = function () {
    const selectedGroup = this.value;
    populateSampleDropdown(selectedGroup);
  };
}

function rememberSelectedSampleForGroup(group, sampleIndex) {
  if (!group || !groupMapping[group]?.includes(sampleIndex)) return;
  lastSelectedSampleByGroup[group] = sampleIndex;
}

function rememberSelectedSampleForCurrentGroup(sampleIndex) {
  const groupDropdown = document.getElementById("groupDropdown");
  rememberSelectedSampleForGroup(groupDropdown?.value, sampleIndex);
}

function getSampleIndexForGroupSelection(selectedGroup) {
  const groupSampleIndices = groupMapping[selectedGroup] || [];
  const rememberedIndex = lastSelectedSampleByGroup[selectedGroup];
  if (groupSampleIndices.includes(rememberedIndex)) {
    return rememberedIndex;
  }
  return groupSampleIndices[0];
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
      sampleDropdown.value = String(
        getSampleIndexForGroupSelection(selectedGroup)
      );
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

viewer.addHandler("canvas-click", function (event) {
  if (event.quick === false) return;

  if (porosityAoiModeActive) {
    event.preventDefaultAction = true;
    addPorosityAoiPoint(event);
    return;
  }

  if (!porosityPickModeActive) return;

  event.preventDefaultAction = true;
  addPorosityColorSample(event);
});

viewer.addHandler("canvas-double-click", function (event) {
  if (porosityAoiComplete && !porosityPickModeActive) {
    const inserted = insertPorosityAoiVertex(event.position);
    if (inserted) {
      event.preventDefaultAction = true;
      return;
    }
  }
  if (!porosityAoiModeActive) return;

  event.preventDefaultAction = true;
  finishPorosityAoi();
});

viewer.addHandler("tile-load-failed", handleTileLoadFailed);
viewer.addHandler("open", clearUnsupervisedAoiForSampleChange);
viewer.addHandler("open", scheduleScalebarRefresh);

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
      rememberSelectedSampleForCurrentGroup(currentIndex);
      hideSampleInfoPopover();
      closeScaleWizard();
      stopSnapshotDrawMode({ clearSelection: true });
      porositySelectedTileSetIndices = [];
      if (porosityTileSetSelect) porosityTileSetSelect.innerHTML = "";
      resetPorosityAnalysis();
      renderPorosityTileSetSelect();
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

function resetTileSetScrollIndices() {
  tileSetScrollIndices = tileSets().map(() => scrollIndex);
}

function getTileSetVisibleTileIndex(tileSetIndex) {
  const tiles = tileSets()[tileSetIndex]?.tiles || [];
  if (tiles.length === 0) return 0;

  const scrollValue = Number.isFinite(tileSetScrollIndices[tileSetIndex])
    ? tileSetScrollIndices[tileSetIndex]
    : scrollIndex;
  return ((scrollValue % tiles.length) + tiles.length) % tiles.length;
}

function getTileSetTypeLabel(tileSet) {
  const tileCount = tileSet?.tiles?.length || 0;
  if (tileCount <= 1) return "Individual";
  return tileSet.periodDegrees ? "Rotation" : "Multiple";
}

function cycleTileSetImage(tileSetIndex, direction) {
  const tileSet = tileSets()[tileSetIndex];
  if (!tileSet || tileSet.periodDegrees || (tileSet.tiles?.length || 0) <= 1) {
    return;
  }

  const currentValue = Number.isFinite(tileSetScrollIndices[tileSetIndex])
    ? tileSetScrollIndices[tileSetIndex]
    : scrollIndex;
  tileSetScrollIndices[tileSetIndex] = currentValue + direction;
  displayImages();
  updateImageCheckboxLabels();
}

function canCycleTileSet(tileSet) {
  return Boolean(
    tileSet && !tileSet.periodDegrees && (tileSet.tiles?.length || 0) > 1
  );
}

function cycleAllMultipleTileSetImages(direction) {
  let changed = false;
  tileSets().forEach((tileSet, index) => {
    if (!canCycleTileSet(tileSet)) return;
    const currentValue = Number.isFinite(tileSetScrollIndices[index])
      ? tileSetScrollIndices[index]
      : scrollIndex;
    tileSetScrollIndices[index] = currentValue + direction;
    changed = true;
  });

  if (!changed) return false;
  displayImages();
  updateImageCheckboxLabels();
  return true;
}

// Function to update the image checkbox labels based on tileLabels array
function updateImageCheckboxLabels() {
  const checkboxes = document.querySelectorAll(".image-checkbox");

  checkboxes.forEach((checkbox, i) => {
    const label = checkbox.parentElement?.querySelector(".image-checkbox-label");
    const typeBadge = checkbox.parentElement?.parentElement?.querySelector(
      ".tile-set-type-badge"
    );
    const cycleControls = checkbox.parentElement?.parentElement?.querySelector(
      ".tile-set-cycle-controls"
    );
    const tileSet = tileSets()[i];
    if (!tileSet || !label) return;

    const tiles = tileSet.tiles;
    if (!tiles || tiles.length === 0) return;

    const visibleTileIndex = getTileSetVisibleTileIndex(i);
    const tileLabel = tiles[visibleTileIndex]?.label;

    label.textContent = tileLabel || tileSet.label || `Img ${i + 1}`;
    if (typeBadge) {
      typeBadge.textContent = getTileSetTypeLabel(tileSet);
      typeBadge.title =
        tileSet.periodDegrees && tiles.length > 1
          ? "Multiple images linked to rotation"
          : tiles.length > 1
          ? "Multiple images selected one at a time"
          : "Single image tile set";
    }
    if (cycleControls) {
      cycleControls.hidden = Boolean(tileSet.periodDegrees) || tiles.length <= 1;
    }
  });
}

function toggleOnImages() {
  const checkboxes = document.querySelectorAll(".image-checkbox");
  const count = tileSets().length;
  resetTileSetScrollIndices();

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
let sampleInfoPopover = null;

function getSampleScaleLabel(sample) {
  const scale = normalizePixelsPerMeter(sample?.pixelsPerMeter);
  if (scale === null) return "";

  const pixelsPerMillimeter = scale / 1000;
  if (pixelsPerMillimeter >= 10) {
    return `${Math.round(pixelsPerMillimeter).toLocaleString()} px/mm`;
  }
  return `${pixelsPerMillimeter.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })} px/mm`;
}

function getSampleAnnotationLabel(sample) {
  const annotations = sample?.annotations;
  if (!annotations) return "";
  if (Array.isArray(annotations)) {
    return `${annotations.length} annotation file${annotations.length === 1 ? "" : "s"}`;
  }
  return "1 annotation file";
}

function appendSampleInfoRow(container, label, value) {
  if (!value) return;

  const row = document.createElement("div");
  row.className = "sample-info-row";

  const labelElement = document.createElement("span");
  labelElement.className = "sample-info-label";
  labelElement.textContent = label;

  const valueElement = document.createElement("span");
  valueElement.className = "sample-info-value";
  valueElement.textContent = value;

  row.append(labelElement, valueElement);
  container.appendChild(row);
}

function getTileSetSummary(tileSet, index) {
  const label = tileSet?.label || `Tile set ${index + 1}`;
  return `${label}: ${getTileSetTypeLabel(tileSet)}`;
}

function buildSampleInfoPopover(sample) {
  const popover = document.createElement("div");
  popover.id = "sampleInfoPopover";
  popover.className = "sample-info-popover";
  popover.hidden = true;

  const titleElement = document.createElement("h3");
  titleElement.textContent = sample?.title || "Sample";
  popover.appendChild(titleElement);

  const details = document.createElement("div");
  details.className = "sample-info-details";
  appendSampleInfoRow(details, "Description", sample?.description || "");
  appendSampleInfoRow(
    details,
    "Groups",
    Array.isArray(sample?.groups) ? sample.groups.join(", ") : ""
  );
  appendSampleInfoRow(details, "Scale", getSampleScaleLabel(sample));
  appendSampleInfoRow(details, "Annotations", getSampleAnnotationLabel(sample));

  const tileSetSummaries = (sample?.tileSets || []).map(getTileSetSummary);
  appendSampleInfoRow(details, "Tile sets", tileSetSummaries.join("; "));

  if (!details.children.length) {
    const empty = document.createElement("p");
    empty.className = "sample-info-empty";
    empty.textContent = "No sample details available.";
    popover.appendChild(empty);
  } else {
    popover.appendChild(details);
  }

  return popover;
}

function positionSampleInfoPopover() {
  if (!sampleInfoPopover || sampleInfoPopover.hidden) return;

  const buttonRect = infoButton.getBoundingClientRect();
  const popoverRect = sampleInfoPopover.getBoundingClientRect();
  const margin = 6;
  const maxLeft = window.innerWidth - popoverRect.width - margin;
  const left = Math.max(margin, Math.min(buttonRect.right - popoverRect.width, maxLeft));
  const top = Math.min(
    buttonRect.bottom + margin,
    window.innerHeight - popoverRect.height - margin
  );

  sampleInfoPopover.style.left = `${left}px`;
  sampleInfoPopover.style.top = `${Math.max(margin, top)}px`;
}

function hideSampleInfoPopover() {
  if (!sampleInfoPopover) return;
  sampleInfoPopover.hidden = true;
}

function showSampleInfoPopover(event) {
  event?.stopPropagation();
  hideTooltip();

  sampleInfoPopover?.remove();
  sampleInfoPopover = buildSampleInfoPopover(samples[currentIndex]);
  document.body.appendChild(sampleInfoPopover);
  sampleInfoPopover.hidden = false;
  positionSampleInfoPopover();
}

// Show tooltip with sample info on hover
function showTooltip() {
  if (sampleInfoPopover && !sampleInfoPopover.hidden) return;
  const description = samples[currentIndex]?.description;
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
window.addEventListener("resize", positionSampleInfoPopover);
document.addEventListener("click", function (event) {
  if (
    sampleInfoPopover &&
    !sampleInfoPopover.hidden &&
    !sampleInfoPopover.contains(event.target) &&
    event.target !== infoButton &&
    !infoButton.contains(event.target)
  ) {
    hideSampleInfoPopover();
  }
});

// TODO: Testing HTML pop-up when button is clicked
infoButton.addEventListener("click", function (event) {
  const info = samples[currentIndex].info;
  if (info) {
    hideSampleInfoPopover();
    fetch(info)
      .then((response) => response.text())
      .then((data) => {
        document.getElementById("info-modal-body").innerHTML = data;
        document.getElementById("info-modal").style.display = "block";
      });
  } else {
    showSampleInfoPopover(event);
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

function getClosedDraftPolygonCoordinates(coordinates) {
  const draftCoordinates = coordinates.map((coordinate) => [...coordinate]);
  if (
    draftCoordinates.length > 1 &&
    !coordinatesMatch(draftCoordinates[0], draftCoordinates[draftCoordinates.length - 1])
  ) {
    draftCoordinates.push([...draftCoordinates[0]]);
  }
  return draftCoordinates;
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
    const draftStyle = {
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
      fillColor: currentPolyStyleColors.fillColor,
      fillOpacity: getAnnotationOpacityValue("fillOpacity"),
    };
    if (isPolygonMode || isXPressed) {
      addPolygonToGeoJSON(
        annoJSONTemp,
        getClosedDraftPolygonCoordinates(draftCoordinates),
        draftStyle
      );
    } else {
      addPolylineToGeoJSON(annoJSONTemp, draftCoordinates, draftStyle);
    }
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
    pendingAnnotationTextEdit = null;
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

function scheduleScalebarRefresh() {
  const refresh = () => {
    viewer.scalebarInstance?.refresh();
    viewer.forceRedraw();
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(refresh);
  } else {
    setTimeout(refresh, 0);
  }
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
  scheduleScalebarRefresh();
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
  const circleButton = document.getElementById("toggleCircleButton");

  if (showMeasure) showMeasure.checked = false;
  if (circleButton) {
    circleButton.classList.remove("active");
    circleButton.textContent = "Draw Reference Circle";
  }
  measurementModeActive = false;
  activeMeasureTool = null;
  updateMeasureValueControls();
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
    "toggleCircleButton",
    "measureGearButton",
    "referenceCircleGearButton",
    "measureSelectedAnnotationsButton",
    "measureGroupSelect",
    "measureGroupColorInput",
    "renameMeasureGroupButton",
    "newMeasureGroupButton",
    "exportMeasurementsButton",
    "clearMeasurementsButton",
    "distanceUnits",
    "areaUnits",
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
          tile.tileSource = event.item?.source || tileSource;
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

async function getTileSourceForExport(tile) {
  return tile?.tileSource || tile?.image?.source || getTileSource(tile?.uri);
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
    const getTileOpacity = getTileOpacityGetter(tileSet, tileSetOpacity, i);

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
const getTileOpacityGetter = (tileSet, tileSetOpacity, tileSetIndex = 0) => {
  const tiles = tileSet.tiles;
  const periodDegrees = tileSet.periodDegrees;
  if (!periodDegrees) {
    // If the tile set does not have a period, the tiles are just independent
    // images that can be scrolled through. Only show the selected tile.
    return (index) =>
      index === getTileSetVisibleTileIndex(tileSetIndex) ? tileSetOpacity : 0;
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
  resetTileSetScrollIndices();

  for (let i = 0; i < numTileSets; i++) {
    const div = document.createElement("div");
    div.className = "image-checkbox-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `image${i + 1}`;
    checkbox.checked = i === 0;
    checkbox.className = "image-checkbox";
    checkbox.dataset.index = i;
    checkbox.addEventListener("change", displayImages);

    const identity = document.createElement("div");
    identity.className = "image-checkbox-identity";

    const label = document.createElement("label");
    label.className = "image-checkbox-label";
    label.htmlFor = checkbox.id;
    label.textContent = `Img ${i + 1}`;

    const typeBadge = document.createElement("span");
    typeBadge.className = "tile-set-type-badge";
    typeBadge.textContent = getTileSetTypeLabel(tileSets()[i]);

    const cycleControls = document.createElement("span");
    cycleControls.className = "tile-set-cycle-controls";

    const previousButton = document.createElement("button");
    previousButton.type = "button";
    previousButton.className = "tile-set-cycle-button";
    previousButton.title = "Previous image";
    previousButton.setAttribute(
      "aria-label",
      `Previous image for tile set ${i + 1}`
    );
    previousButton.textContent = "<";
    previousButton.addEventListener("click", () => cycleTileSetImage(i, -1));

    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className = "tile-set-cycle-button";
    nextButton.title = "Next image";
    nextButton.setAttribute(
      "aria-label",
      `Next image for tile set ${i + 1}`
    );
    nextButton.textContent = ">";
    nextButton.addEventListener("click", () => cycleTileSetImage(i, 1));

    cycleControls.appendChild(previousButton);
    cycleControls.appendChild(nextButton);

    identity.appendChild(checkbox);
    identity.appendChild(label);
    identity.appendChild(typeBadge);
    div.appendChild(identity);
    div.appendChild(cycleControls);
    container.appendChild(div);
  }
  updateImageCheckboxLabels();
  populateSnapshotTileSetSelect();
  populateSegmentTileSetSelect();
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
let annotationBooleanButton = document.getElementById("annotationBooleanButton");
let annotationBooleanMenu = document.getElementById("annotationBooleanMenu");

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

function openMeasureSettingsPopover(button) {
  const menu = document.getElementById("measureSettingsMenu");
  if (!menu || !button) return;

  if (menu.parentElement !== document.body) {
    document.body.appendChild(menu);
  }

  menu.classList.add("measure-settings-popover");
  menu.style.display = "block";
  positionAnnotationSettingsPopover(menu, button);
}

function closeMeasureSettingsPopover() {
  const menu = document.getElementById("measureSettingsMenu");
  if (!menu) return;

  menu.style.display = "none";
  menu.classList.remove("measure-settings-popover");
}

function openReferenceCircleSettingsPopover(button) {
  const menu = document.getElementById("referenceCircleSettingsMenu");
  if (!menu || !button) return;

  if (menu.parentElement !== document.body) {
    document.body.appendChild(menu);
  }

  menu.classList.add("measure-settings-popover");
  menu.style.display = "block";
  positionAnnotationSettingsPopover(menu, button);
}

function closeReferenceCircleSettingsPopover() {
  const menu = document.getElementById("referenceCircleSettingsMenu");
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

function openAnnotationBooleanPopover(button) {
  if (!annotationBooleanMenu || !button) return;

  if (annotationBooleanMenu.parentElement !== document.body) {
    document.body.appendChild(annotationBooleanMenu);
  }

  updateAnnotationBooleanControls();
  annotationBooleanMenu.classList.add("annotation-boolean-popover");
  annotationBooleanMenu.style.display = "block";
  annotationBooleanButton?.setAttribute("aria-expanded", "true");
  positionAnnotationSettingsPopover(annotationBooleanMenu, button);
}

function closeAnnotationBooleanPopover() {
  if (!annotationBooleanMenu) return;

  annotationBooleanMenu.style.display = "none";
  annotationBooleanMenu.classList.remove("annotation-boolean-popover");
  annotationBooleanButton?.setAttribute("aria-expanded", "false");
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

// Show or hide the measurement settings menu when the gear button is clicked
document
  .getElementById("measureGearButton")
  .addEventListener("click", function (event) {
    event.stopPropagation();
    const menu = document.getElementById("measureSettingsMenu");
    if (menu.style.display === "block") {
      closeMeasureSettingsPopover();
    } else {
      openMeasureSettingsPopover(event.currentTarget);
    }
  });

document
  .getElementById("referenceCircleGearButton")
  .addEventListener("click", function (event) {
    event.stopPropagation();
    const menu = document.getElementById("referenceCircleSettingsMenu");
    if (menu.style.display === "block") {
      closeReferenceCircleSettingsPopover();
    } else {
      openReferenceCircleSettingsPopover(event.currentTarget);
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

annotationBooleanButton?.addEventListener("click", function (event) {
  event.stopPropagation();
  if (annotationBooleanButton.disabled) return;
  if (annotationBooleanMenu?.style.display === "block") {
    closeAnnotationBooleanPopover();
  } else {
    openAnnotationBooleanPopover(event.currentTarget);
  }
});

annotationBooleanMenu
  ?.querySelectorAll("[data-boolean-operation]")
  .forEach((button) => {
    button.addEventListener("click", function (event) {
      event.stopPropagation();
      const operation = event.currentTarget.dataset.booleanOperation;
      closeAnnotationBooleanPopover();
      applyAnnotationBooleanOperation(operation);
    });
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

  if (
    annotationBooleanMenu?.style.display === "block" &&
    !event.target.closest("#annotationBooleanButton") &&
    !event.target.closest("#annotationBooleanMenu")
  ) {
    closeAnnotationBooleanPopover();
  }
});

window.addEventListener("click", function (event) {
  const menu = document.getElementById("measureSettingsMenu");
  if (
    !event.target.closest("#measureGearButton") &&
    !event.target.closest("#measureSettingsMenu")
  ) {
    closeMeasureSettingsPopover();
  }

  if (
    !event.target.closest("#referenceCircleGearButton") &&
    !event.target.closest("#referenceCircleSettingsMenu")
  ) {
    closeReferenceCircleSettingsPopover();
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
  updateSelectedAnnotationGeometryWarning();
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
  updateSelectedAnnotationGeometryWarning();
  updateAnnotationBooleanControls();

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

function getAnnotationFeatureByUuidMap() {
  return new Map(
    annoJSON.features
      .filter((feature) => feature?.properties?.uuid)
      .map((feature) => [feature.properties.uuid, feature])
  );
}

function getAnnotationIdByUuidMap() {
  return new Map(
    annoJSON.features
      .map((feature, index) => [feature?.properties?.uuid, index + 1])
      .filter(([uuid]) => Boolean(uuid))
  );
}

function getSelectedAnnotationUuids() {
  const existingUuids = new Set(
    annoJSON.features
      .map((feature) => feature.properties?.uuid)
      .filter(Boolean)
  );
  return [...selectedAnnotationUuids].filter((uuid) => existingUuids.has(uuid));
}

function getSelectedAnnotation() {
  return getAnnotationByUuid(selectedAnnotationUuid);
}

function getSelectedAnnotationUuid() {
  return getSelectedAnnotation()?.properties?.uuid || null;
}

const BOOLEAN_OPERATION_LABELS = {
  union: "Union",
  difference: "Subtract from Primary",
  intersection: "Intersect",
  xor: "Exclude Overlap",
  simplify: "Simplify polygon(s)",
  split: "Split MultiPolygon",
  repair: "Repair Polygon",
};

function getPolygonClippingLibrary() {
  return window.polygonClipping || null;
}

function isBooleanPolygonFeature(feature) {
  return (
    feature?.properties?.uuid &&
    !isAnnotationFeatureLocked(feature) &&
    (feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon")
  );
}

function isAnnotationPolygonGeometry(feature) {
  return (
    feature?.geometry?.type === "Polygon" ||
    feature?.geometry?.type === "MultiPolygon"
  );
}

function isCoordinateOnRingBoundary(coordinate, ring) {
  const point = imagePointFromCoord(coordinate);
  return getRingSegments(ring).some(([start, end]) =>
    pointOnImageSegment(point, start, end)
  );
}

function ringsIntersect(firstRing, secondRing) {
  const firstSegments = getRingSegments(firstRing);
  const secondSegments = getRingSegments(secondRing);
  return firstSegments.some(([firstStart, firstEnd]) =>
    secondSegments.some(([secondStart, secondEnd]) =>
      imageSegmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)
    )
  );
}

function getPolygonHoleGeometryWarnings(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 2) return [];

  const exteriorRing = getCleanCoordinateRing(polygon[0] || []);
  if (exteriorRing.length < 4) return [];

  const warnings = [];
  const interiorRings = polygon
    .slice(1)
    .map((ring) => getCleanCoordinateRing(ring || []));
  interiorRings.forEach((holeRing) => {
    if (holeRing.length < 4) return;
    const holeCoordinates = getCoordinatesWithoutTrailingDuplicate(holeRing);
    const holeLeavesExterior = holeCoordinates.some((coordinate) => {
      const point = imagePointFromCoord(coordinate);
      return (
        !isImagePointInRing(point, exteriorRing) ||
        isCoordinateOnRingBoundary(coordinate, exteriorRing)
      );
    });

    if (holeLeavesExterior || ringsIntersect(holeRing, exteriorRing)) {
      warnings.push(
        "Invalid polygon hole; interior rings must stay inside the exterior ring."
      );
    }
  });

  interiorRings.forEach((holeRing, holeIndex) => {
    if (holeRing.length < 4) return;
    const holeCoordinates = getCoordinatesWithoutTrailingDuplicate(holeRing);
    interiorRings.slice(holeIndex + 1).forEach((otherRing) => {
      if (otherRing.length < 4) return;
      const otherCoordinates = getCoordinatesWithoutTrailingDuplicate(otherRing);
      const holesOverlap =
        ringsIntersect(holeRing, otherRing) ||
        holeCoordinates.some((coordinate) =>
          isImagePointInRing(imagePointFromCoord(coordinate), otherRing)
        ) ||
        otherCoordinates.some((coordinate) =>
          isImagePointInRing(imagePointFromCoord(coordinate), holeRing)
        );

      if (holesOverlap) {
        warnings.push("Invalid polygon holes; interior rings must not overlap.");
      }
    });
  });

  return [...new Set(warnings)];
}

function getAnnotationGeometryStatus(feature) {
  if (!isAnnotationPolygonGeometry(feature)) {
    return { validGeometry: true, geometryWarning: "" };
  }

  const invalidWarnings = [];
  const polygons = getGeometryPolygons(feature.geometry);
  polygons.forEach((polygon) => {
    if (!Array.isArray(polygon)) return;
    polygon.forEach((ring) => {
      const geometryStatus = getPolygonSelfIntersectionStatus(ring);
      if (!geometryStatus.validGeometry && geometryStatus.geometryWarning) {
        invalidWarnings.push(geometryStatus.geometryWarning);
      }
    });
    invalidWarnings.push(...getPolygonHoleGeometryWarnings(polygon));
  });

  if (invalidWarnings.length > 0) {
    return {
      validGeometry: false,
      geometryWarning: [...new Set(invalidWarnings)].join(" "),
    };
  }

  return { validGeometry: true, geometryWarning: "" };
}

function updateAnnotationGeometryStatus(feature) {
  if (!feature?.properties) return { validGeometry: true, geometryWarning: "" };

  const geometryStatus = getAnnotationGeometryStatus(feature);
  feature.properties.validGeometry = geometryStatus.validGeometry;
  feature.properties.geometryWarning = geometryStatus.geometryWarning;
  return geometryStatus;
}

function getSelectedBooleanFeatures() {
  return getSelectedAnnotationUuids()
    .map((uuid) => getAnnotationByUuid(uuid))
    .filter(Boolean);
}

function getBooleanSelectionState() {
  const selectedFeatures = getSelectedBooleanFeatures();
  const polygonFeatures = selectedFeatures.filter(isBooleanPolygonFeature);
  const primaryFeature = getSelectedAnnotation();
  const primaryIsPolygon = isBooleanPolygonFeature(primaryFeature);
  const hasOnlyPolygonSelection =
    selectedFeatures.length > 0 && polygonFeatures.length === selectedFeatures.length;

  return {
    selectedFeatures,
    polygonFeatures,
    primaryFeature,
    primaryIsPolygon,
    hasOnlyPolygonSelection,
    hasEnoughPolygons: hasOnlyPolygonSelection && polygonFeatures.length >= 2,
  };
}

function getBooleanFeatureInvalidGeometryStatus(feature) {
  if (!isBooleanPolygonFeature(feature)) return { validGeometry: true, geometryWarning: "" };
  return updateAnnotationGeometryStatus(feature);
}

function isRepairableBooleanFeature(feature) {
  if (!getPolygonClippingLibrary()) return false;
  return getBooleanFeatureInvalidGeometryStatus(feature).validGeometry === false;
}

function getBooleanOperationEnabled(operation) {
  const state = getBooleanSelectionState();
  if (operation === "split") {
    return (
      state.primaryFeature?.geometry?.type === "MultiPolygon" &&
      !isAnnotationFeatureLocked(state.primaryFeature) &&
      Array.isArray(state.primaryFeature.geometry.coordinates) &&
      state.primaryFeature.geometry.coordinates.length > 1
    );
  }
  if (operation === "repair") {
    return isRepairableBooleanFeature(state.primaryFeature);
  }
  if (operation === "simplify") {
    return state.hasOnlyPolygonSelection;
  }
  if (!getPolygonClippingLibrary()) return false;
  if (!state.hasEnoughPolygons) return false;
  if (operation === "difference") return state.primaryIsPolygon;
  return true;
}

function getCoordinateToSegmentDistance(point, start, end) {
  const px = Number(point?.[0]);
  const py = Number(point?.[1]);
  const x1 = Number(start?.[0]);
  const y1 = Number(start?.[1]);
  const x2 = Number(end?.[0]);
  const y2 = Number(end?.[1]);
  if (
    !Number.isFinite(px) ||
    !Number.isFinite(py) ||
    !Number.isFinite(x1) ||
    !Number.isFinite(y1) ||
    !Number.isFinite(x2) ||
    !Number.isFinite(y2)
  ) {
    return 0;
  }

  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);

  const t = Math.max(
    0,
    Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy))
  );
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function simplifyCoordinatePathDouglasPeucker(points, tolerancePx) {
  if (!Array.isArray(points) || points.length <= 2 || tolerancePx <= 0) {
    return points.map((point) => [...point]);
  }

  let maxDistance = 0;
  let splitIndex = -1;
  const start = points[0];
  const end = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const distance = getCoordinateToSegmentDistance(points[i], start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = i;
    }
  }

  if (maxDistance <= tolerancePx || splitIndex < 0) {
    return [[...start], [...end]];
  }

  const first = simplifyCoordinatePathDouglasPeucker(
    points.slice(0, splitIndex + 1),
    tolerancePx
  );
  const second = simplifyCoordinatePathDouglasPeucker(
    points.slice(splitIndex),
    tolerancePx
  );
  return first.slice(0, -1).concat(second);
}

function getCyclicCoordinatePath(points, startIndex, endIndex) {
  const path = [];
  let index = startIndex;
  while (true) {
    path.push(points[index]);
    if (index === endIndex) break;
    index = (index + 1) % points.length;
  }
  return path;
}

function getFarthestCoordinatePairIndices(points) {
  let firstIndex = 0;
  let secondIndex = Math.min(1, points.length - 1);
  let maxDistance = -1;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const distance = calculateDistance(points[i], points[j]);
      if (distance > maxDistance) {
        maxDistance = distance;
        firstIndex = i;
        secondIndex = j;
      }
    }
  }
  return [firstIndex, secondIndex];
}

function simplifyPolygonRing(ring, tolerancePx) {
  const cleaned = getCleanCoordinateRing(ring || []);
  const points = getCoordinatesWithoutTrailingDuplicate(cleaned);
  if (points.length <= 3 || tolerancePx <= 0) return cleaned;

  const [firstIndex, secondIndex] = getFarthestCoordinatePairIndices(points);
  const firstPath = getCyclicCoordinatePath(points, firstIndex, secondIndex);
  const secondPath = getCyclicCoordinatePath(points, secondIndex, firstIndex);
  const simplified = simplifyCoordinatePathDouglasPeucker(firstPath, tolerancePx)
    .slice(0, -1)
    .concat(simplifyCoordinatePathDouglasPeucker(secondPath, tolerancePx));
  const simplifiedRing = getCleanCoordinateRing(simplified);
  return getCoordinatesWithoutTrailingDuplicate(simplifiedRing).length >= 3
    ? simplifiedRing
    : cleaned;
}

function simplifyPolygonCoordinates(polygon, tolerancePx) {
  if (!Array.isArray(polygon) || polygon.length === 0) return null;
  const rings = polygon.map((ring) => simplifyPolygonRing(ring, tolerancePx));
  return normalizeBooleanPolygon(rings);
}

function simplifyAnnotationGeometry(geometry, tolerancePx) {
  if (geometry?.type === "Polygon") {
    const polygon = simplifyPolygonCoordinates(geometry.coordinates, tolerancePx);
    return polygon
      ? {
          type: "Polygon",
          coordinates: polygon,
        }
      : null;
  }

  if (geometry?.type === "MultiPolygon") {
    const polygons = (geometry.coordinates || [])
      .map((polygon) => simplifyPolygonCoordinates(polygon, tolerancePx))
      .filter(Boolean);
    if (polygons.length === 0) return null;
    return polygons.length === 1
      ? {
          type: "Polygon",
          coordinates: polygons[0],
        }
      : {
          type: "MultiPolygon",
          coordinates: polygons,
        };
  }

  return null;
}

function countGeometryCoordinates(geometry) {
  return getGeometryPolygons(geometry).reduce(
    (total, polygon) =>
      total +
      polygon.reduce(
        (polygonTotal, ring) =>
          polygonTotal + getCoordinatesWithoutTrailingDuplicate(ring || []).length,
        0
      ),
    0
  );
}

function normalizeBooleanRing(ring) {
  if (!Array.isArray(ring)) return null;
  const cleaned = getCleanCoordinateRing(ring);
  if (cleaned.length < 4) return null;
  const uniquePoints = getCoordinatesWithoutTrailingDuplicate(cleaned);
  if (uniquePoints.length < 3) return null;
  if (calculateArea(cleaned) <= 0) return null;
  return cleaned.map((coordinate) => [Number(coordinate[0]), Number(coordinate[1])]);
}

function normalizeBooleanPolygon(polygon) {
  if (!Array.isArray(polygon)) return null;
  const rings = polygon.map(normalizeBooleanRing).filter(Boolean);
  return rings.length > 0 ? rings : null;
}

function featureToBooleanMultiPolygon(feature) {
  if (feature.geometry?.type === "Polygon") {
    const polygon = normalizeBooleanPolygon(feature.geometry.coordinates);
    return polygon ? [polygon] : null;
  }
  if (feature.geometry?.type === "MultiPolygon") {
    const polygons = feature.geometry.coordinates
      .map(normalizeBooleanPolygon)
      .filter(Boolean);
    return polygons.length > 0 ? polygons : null;
  }
  return null;
}

function normalizeBooleanMultiPolygon(multiPolygon) {
  if (!Array.isArray(multiPolygon)) return [];
  return multiPolygon.map(normalizeBooleanPolygon).filter(Boolean);
}

function booleanMultiPolygonToGeometry(multiPolygon) {
  const normalized = normalizeBooleanMultiPolygon(multiPolygon);
  if (normalized.length === 0) return null;
  if (normalized.length === 1) {
    return {
      type: "Polygon",
      coordinates: normalized[0],
    };
  }
  return {
    type: "MultiPolygon",
    coordinates: normalized,
  };
}

function getGeometryPolygons(geometry) {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function calculateBooleanGeometryAreaPixels(geometry) {
  return getGeometryPolygons(geometry).reduce(
    (total, polygon) => total + calculatePolygonArea(polygon),
    0
  );
}

function calculateBooleanGeometryPerimeterPixels(geometry) {
  return getGeometryPolygons(geometry).reduce(
    (total, polygon) =>
      total +
      polygon.reduce((polygonTotal, ring) => {
        return polygonTotal + calculatePerimeter(ring);
      }, 0),
    0
  );
}

function getBooleanGeometryLabelPoint(geometry, fallbackFeature) {
  const firstRing = getGeometryPolygons(geometry)[0]?.[0] || [];
  const labelCoordinates = getCoordinatesWithoutTrailingDuplicate(firstRing);
  const topPoint = labelCoordinates.length > 0 ? getTopmostPoint(labelCoordinates) : null;
  if (
    topPoint &&
    Number.isFinite(Number(topPoint[0])) &&
    Number.isFinite(Number(topPoint[1]))
  ) {
    return {
      x: Number(topPoint[0]),
      y: Number(topPoint[1]),
    };
  }
  return {
    x: Number(fallbackFeature?.properties?.xLabel) || 0,
    y: Number(fallbackFeature?.properties?.yLabel) || 0,
  };
}

function updateGeometryMeasurementProperties(feature) {
  const areaPixels = calculateBooleanGeometryAreaPixels(feature.geometry);
  const perimeterPixels = calculateBooleanGeometryPerimeterPixels(feature.geometry);

  feature.properties.area_m2 = squareMetersFromSquarePixels(areaPixels);
  feature.properties.perimeter_m = metersFromPixels(perimeterPixels);
  feature.properties.validGeometry = true;
  feature.properties.geometryWarning = "";
}

function updateBooleanResultProperties(feature, options = {}) {
  const preserveLabelPosition = options.preserveLabelPosition === true;
  const currentLabelPoint = {
    x: Number(feature.properties?.xLabel),
    y: Number(feature.properties?.yLabel),
  };
  const hasCurrentLabelPoint =
    Number.isFinite(currentLabelPoint.x) && Number.isFinite(currentLabelPoint.y);
  const labelPoint =
    preserveLabelPosition && hasCurrentLabelPoint
      ? currentLabelPoint
      : getBooleanGeometryLabelPoint(feature.geometry, feature);

  feature.properties.shapeType = "polygon";
  feature.properties.xLabel = labelPoint.x;
  feature.properties.yLabel = labelPoint.y;
  updateGeometryMeasurementProperties(feature);
}

function cloneSplitPolygonProperties(sourceFeature, polygon, index) {
  const properties = normalizeAnnotationProperties({
    ...cloneData(sourceFeature.properties),
    uuid: index === 0 ? sourceFeature.properties.uuid : generateUniqueId(12),
    shapeType: "polygon",
  });
  const feature = {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: cloneData(polygon),
    },
    properties,
  };
  updateBooleanResultProperties(feature);
  return feature;
}

function getBooleanOperationResult(operation, polygonFeatures) {
  const polygonClipping = getPolygonClippingLibrary();
  if (!polygonClipping) {
    alert("Polygon boolean operations are not available.");
    return null;
  }

  const operands = polygonFeatures.map(featureToBooleanMultiPolygon);
  if (operands.some((operand) => !operand)) {
    alert("The selected polygons include invalid geometry.");
    return null;
  }

  try {
    if (operation === "union") return polygonClipping.union(...operands);
    if (operation === "intersection") return polygonClipping.intersection(...operands);
    if (operation === "xor") return polygonClipping.xor(...operands);
    if (operation === "repair") return polygonClipping.union(...operands);
    if (operation === "difference") {
      return polygonClipping.difference(operands[0], ...operands.slice(1));
    }
  } catch (error) {
    console.error("Boolean polygon operation failed:", error);
    alert("The selected polygons could not be combined. Check for invalid geometry.");
    return null;
  }
  return null;
}

function showBooleanOperationEmptyMessage(operation) {
  const label = BOOLEAN_OPERATION_LABELS[operation] || "Boolean operation";
  alert(`${label} did not produce any polygon area.`);
}

function applyAnnotationBooleanOperation(operation) {
  const state = getBooleanSelectionState();
  if (operation === "split") {
    splitPrimaryMultiPolygon();
    return;
  }
  if (operation === "repair") {
    repairPrimaryPolygon();
    return;
  }
  if (operation === "simplify") {
    promptSimplifySelectedPolygons();
    return;
  }
  if (!getBooleanOperationEnabled(operation)) {
    alert("Select at least two unlocked polygon annotations.");
    return;
  }

  const primaryFeature = state.primaryFeature;
  const polygonFeatures =
    operation === "difference"
      ? [
          primaryFeature,
          ...state.polygonFeatures.filter(
            (feature) => feature.properties.uuid !== primaryFeature.properties.uuid
          ),
        ]
      : state.polygonFeatures;
  const result = getBooleanOperationResult(operation, polygonFeatures);
  const geometry = booleanMultiPolygonToGeometry(result);
  if (!geometry) {
    showBooleanOperationEmptyMessage(operation);
    return;
  }

  annotationHistory.push(BOOLEAN_OPERATION_LABELS[operation]);
  pendingAnnotationTextEdit = null;
  exitAnnotationVertexEditMode();
  exitAnnotationShapeEditMode();

  const primaryUuid = primaryFeature.properties.uuid;
  const selectedPolygonUuids = new Set(
    state.polygonFeatures.map((feature) => feature.properties.uuid)
  );
  state.polygonFeatures.forEach((feature) => {
    if (feature.properties.uuid !== primaryUuid) {
      removeAnnotationFeatureOverlays(feature);
    }
  });

  primaryFeature.geometry = geometry;
  updateBooleanResultProperties(primaryFeature, {
    preserveLabelPosition: operation !== "intersection",
  });
  updateAnnotationLabelOverlayPosition(primaryUuid);
  updateText(primaryUuid, "anno", primaryFeature.properties.label || "");

  annoJSON.features = annoJSON.features.filter(
    (feature) =>
      feature.properties?.uuid === primaryUuid ||
      !selectedPolygonUuids.has(feature.properties?.uuid)
  );

  selectedAnnotationUuids = new Set([primaryUuid]);
  selectedAnnotationUuid = primaryUuid;
  annotationListSelectionAnchorUuid = primaryUuid;
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  renderAnnotationList();
  setAnnotationSelection([primaryUuid], primaryUuid, {
    redraw: false,
    scroll: true,
    pan: false,
  });
  unsavedAnnotations(true);
}

function promptSimplifySelectedPolygons() {
  if (!getBooleanOperationEnabled("simplify")) {
    alert("Select one or more unlocked polygon annotations.");
    return;
  }

  showPrompt("Maximum displacement in pixels:", (value) => {
    const tolerancePx = Number(value);
    if (!Number.isFinite(tolerancePx) || tolerancePx < 0) {
      alert("Enter a non-negative pixel tolerance.");
      return;
    }
    simplifySelectedPolygons(tolerancePx);
  }, "2");
}

function simplifySelectedPolygons(tolerancePx) {
  const state = getBooleanSelectionState();
  const polygonFeatures = state.polygonFeatures;
  if (polygonFeatures.length === 0) {
    alert("Select one or more unlocked polygon annotations.");
    return;
  }

  let changedCount = 0;
  let totalBefore = 0;
  let totalAfter = 0;
  const simplifiedGeometries = new Map();
  polygonFeatures.forEach((feature) => {
    const beforeCount = countGeometryCoordinates(feature.geometry);
    const geometry = simplifyAnnotationGeometry(feature.geometry, tolerancePx);
    if (!geometry) return;
    const afterCount = countGeometryCoordinates(geometry);
    totalBefore += beforeCount;
    totalAfter += afterCount;
    if (afterCount !== beforeCount) changedCount++;
    simplifiedGeometries.set(feature.properties.uuid, geometry);
  });

  if (simplifiedGeometries.size === 0) {
    alert("The selected polygons could not be simplified.");
    return;
  }

  annotationHistory.push(BOOLEAN_OPERATION_LABELS.simplify);
  pendingAnnotationTextEdit = null;
  exitAnnotationVertexEditMode();
  exitAnnotationShapeEditMode();

  polygonFeatures.forEach((feature) => {
    const geometry = simplifiedGeometries.get(feature.properties.uuid);
    if (!geometry) return;
    feature.geometry = geometry;
    invalidateFeatureImageBounds(feature);
    updateBooleanResultProperties(feature, { preserveLabelPosition: true });
    updateAnnotationGeometryStatus(feature);
    updateAnnotationLabelOverlayPosition(feature.properties.uuid);
    updateText(feature.properties.uuid, "anno", feature.properties.label || "");
  });

  const selectedUuids = polygonFeatures.map((feature) => feature.properties.uuid);
  selectedAnnotationUuids = new Set(selectedUuids);
  selectedAnnotationUuid = state.primaryFeature?.properties?.uuid || selectedUuids[0];
  annotationListSelectionAnchorUuid = selectedAnnotationUuid;
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  renderAnnotationList();
  setAnnotationSelection(selectedUuids, selectedAnnotationUuid, {
    redraw: false,
    scroll: true,
    pan: false,
  });
  unsavedAnnotations(true);

  if (changedCount === 0 && totalBefore === totalAfter) {
    alert("No vertices were removed at that tolerance.");
  }
}

function repairPrimaryPolygon() {
  const feature = getSelectedAnnotation();
  if (!getBooleanOperationEnabled("repair")) {
    alert("Select a polygon annotation with invalid geometry to repair.");
    return;
  }

  const result = getBooleanOperationResult("repair", [feature]);
  const geometry = booleanMultiPolygonToGeometry(result);
  if (!geometry) {
    showBooleanOperationEmptyMessage("repair");
    return;
  }

  annotationHistory.push(BOOLEAN_OPERATION_LABELS.repair);
  pendingAnnotationTextEdit = null;
  exitAnnotationVertexEditMode();
  exitAnnotationShapeEditMode();

  feature.geometry = geometry;
  invalidateFeatureImageBounds(feature);
  updateBooleanResultProperties(feature, { preserveLabelPosition: true });
  updateAnnotationLabelOverlayPosition(feature.properties.uuid);
  updateText(feature.properties.uuid, "anno", feature.properties.label || "");
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  renderAnnotationList();
  setAnnotationSelection([feature.properties.uuid], feature.properties.uuid, {
    redraw: false,
    scroll: true,
    pan: false,
  });
  unsavedAnnotations(true);
}

function splitPrimaryMultiPolygon() {
  const feature = getSelectedAnnotation();
  if (!getBooleanOperationEnabled("split")) {
    alert("Select a MultiPolygon annotation to split.");
    return;
  }

  const normalizedPolygons = (feature.geometry.coordinates || [])
    .map(normalizeBooleanPolygon)
    .filter(Boolean);
  if (normalizedPolygons.length <= 1) {
    alert("This MultiPolygon does not contain multiple valid polygon parts.");
    return;
  }

  annotationHistory.push(BOOLEAN_OPERATION_LABELS.split);
  pendingAnnotationTextEdit = null;
  exitAnnotationVertexEditMode();
  exitAnnotationShapeEditMode();
  removeAnnotationFeatureOverlays(feature);

  const originalIndex = getAnnotationIndexByUuid(feature.properties.uuid);
  const splitFeatures = normalizedPolygons.map((polygon, index) =>
    cloneSplitPolygonProperties(feature, polygon, index)
  );
  annoJSON.features.splice(originalIndex, 1, ...splitFeatures);

  splitFeatures.forEach((splitFeature) => {
    const image = viewer.world.getItemAt(0);
    if (!image) return;
    const props = splitFeature.properties;
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
  });

  const splitUuids = splitFeatures.map((splitFeature) => splitFeature.properties.uuid);
  selectedAnnotationUuids = new Set(splitUuids);
  selectedAnnotationUuid = splitUuids[0];
  annotationListSelectionAnchorUuid = splitUuids[0];
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  renderAnnotationList();
  setAnnotationSelection(splitUuids, splitUuids[0], {
    redraw: false,
    scroll: true,
    pan: false,
  });
  unsavedAnnotations(true);
}

function updateAnnotationBooleanControls() {
  if (!annotationBooleanButton) return;

  const polygonClipping = getPolygonClippingLibrary();
  const state = getBooleanSelectionState();
  const canSplit = getBooleanOperationEnabled("split");
  const canRepair = getBooleanOperationEnabled("repair");
  const canSimplify = getBooleanOperationEnabled("simplify");
  const canOpen = Boolean(
    (polygonClipping && state.hasEnoughPolygons) ||
      canSplit ||
      canRepair ||
      canSimplify
  );
  annotationBooleanButton.disabled = !canOpen;
  annotationBooleanButton.title = polygonClipping || canSplit || canSimplify
    ? "Polygon Operations"
    : "Polygon Operations unavailable";
  if (!canOpen) {
    closeAnnotationBooleanPopover();
  }

  if (!annotationBooleanMenu) return;
  annotationBooleanMenu
    .querySelectorAll("[data-boolean-operation]")
    .forEach((button) => {
      const operation = button.dataset.booleanOperation;
      const isEnabled = getBooleanOperationEnabled(operation);
      button.disabled = !isEnabled;
      button.setAttribute("aria-disabled", String(!isEnabled));
    });
}

function updateAnnotationListLabel(uuid, label) {
  if (!uuid) return;
  const row = document.querySelector(
    `.annotation-list-row[data-annotation-uuid="${CSS.escape(uuid)}"]`
  );
  if (!row) return;

  const displayLabel = label || "(no label)";
  const labelCell = row.querySelector(".annotation-list-label");
  if (labelCell) labelCell.textContent = displayLabel;

  const indexText = row.querySelector(".annotation-list-index")?.textContent;
  const geometryWarning = getAnnotationGeometryWarning(getAnnotationByUuid(uuid));
  const titlePrefix = indexText ? `${indexText}. ${displayLabel}` : displayLabel;
  row.title = geometryWarning ? `${titlePrefix} - ${geometryWarning}` : titlePrefix;
}

function beginPendingAnnotationTextEdit(feature) {
  if (!feature?.properties?.uuid) return null;

  if (pendingAnnotationTextEdit?.uuid !== feature.properties.uuid) {
    pendingAnnotationTextEdit = {
      uuid: feature.properties.uuid,
      undoState: cloneAnnotationState(),
      label: feature.properties.label ?? "",
      notes: feature.properties.notes ?? "",
    };
  }

  return pendingAnnotationTextEdit;
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
  if (selectedAnnotationUuid && selectedAnnotationUuid !== primaryUuid) {
    commitPendingAnnotationTextEdit("Edit annotation text");
  }
  const featureByUuid = new Map(
    annoJSON.features
      .filter((feature) => feature?.properties?.uuid)
      .map((feature) => [feature.properties.uuid, feature])
  );
  const validUuids = uuids.filter((uuid) => {
    const feature = featureByUuid.get(uuid);
    return feature && !isAnnotationFeatureLocked(feature);
  });
  selectedAnnotationUuids = new Set(validUuids);

  const primaryIsValid =
    primaryUuid &&
    selectedAnnotationUuids.has(primaryUuid) &&
    featureByUuid.has(primaryUuid) &&
    !isAnnotationFeatureLocked(featureByUuid.get(primaryUuid));
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
  if (isAnnotationPolygonGeometry(feature)) {
    updateAnnotationGeometryStatus(feature);
  }
  return feature;
}

function getAnnotationGeometryWarning(feature) {
  if (!isAnnotationPolygonGeometry(feature)) return "";
  const geometryStatus = updateAnnotationGeometryStatus(feature);
  return geometryStatus.validGeometry ? "" : geometryStatus.geometryWarning;
}

function createAnnotationGeometryWarningIcon(message) {
  const icon = document.createElement("span");
  icon.className = "annotation-geometry-warning-icon";
  icon.textContent = "!";
  icon.title = message;
  icon.setAttribute("aria-label", message);
  return icon;
}

function updateSelectedAnnotationGeometryWarning() {
  const warning = document.getElementById("annotationGeometryWarning");
  if (!warning) return;

  const feature = getSelectedAnnotation();
  const message = feature ? getAnnotationGeometryWarning(feature) : "";
  warning.textContent = message
    ? `${message} Repair Polygon is available from Polygon Operations.`
    : "";
  warning.hidden = !message;
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
  const featureByUuid = new Map(
    annoJSON.features
      .filter((feature) => feature?.properties?.uuid)
      .map((feature) => [feature.properties.uuid, feature])
  );
  return [...selectedAnnotationUuids].filter((uuid) => {
    const feature = featureByUuid.get(uuid);
    return feature && !isAnnotationFeatureLocked(feature);
  });
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
  populateSegmentAnnotationGroupOptions();
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
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
  }
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

  const fragment = document.createDocumentFragment();

  annoJSON.features.forEach((feature, index) => {
    normalizeAnnotationFeature(feature);

    const props = feature.properties;
    const isVisible = isAnnotationFeatureVisible(feature);
    const isLocked = isAnnotationFeatureLocked(feature);
    const isGroupLocked = props.groupLocked === true;
    const geometryWarning = getAnnotationGeometryWarning(feature);
    const row = document.createElement("div");
    row.className = "annotation-list-row";
    row.tabIndex = 0;
    row.setAttribute("role", "option");
    row.dataset.annotationUuid = props.uuid;
    row.setAttribute("aria-selected", "false");
    row.title = geometryWarning
      ? `${index + 1}. ${props.label || "(no label)"} - ${geometryWarning}`
      : `${index + 1}. ${props.label || "(no label)"}`;
    row.addEventListener("click", function (event) {
      handleAnnotationListRowClick(event, props.uuid);
    });
    row.addEventListener("contextmenu", function (event) {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
      }
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

    const warningCell = document.createElement("span");
    warningCell.className = "annotation-list-warning";
    if (geometryWarning) {
      warningCell.appendChild(createAnnotationGeometryWarningIcon(geometryWarning));
    }

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
      groupCell,
      indexCell,
      typeCell,
      warningCell,
      labelCell,
      visibilityButton,
      lockButton
    );
    fragment.appendChild(row);
  });

  list.appendChild(fragment);
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

function deleteSelectedAnnotations() {
  const selectedUuids = getUnlockedSelectedAnnotationUuids();
  if (selectedUuids.length === 0) return false;

  if (
    selectedUuids.length === annoJSON.features.length &&
    annoJSON.features.every((feature) => !isAnnotationFeatureLocked(feature))
  ) {
    annotationHistory.push("Delete annotations");
    clearAnnotations();
    unsavedAnnotations(true);
    disableAnnoButtons();
    return true;
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
  return true;
}

// When the delete annotation button is clicked
document.getElementById("deleteButton").addEventListener("click", function () {
  deleteSelectedAnnotations();
});

// labels could be changed without affecting the underlying color of the shapes
function applyCurrentAnno(id, changeLabel = false, options = {}) {
  const { deferDraw = false } = options;
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
      if (!deferDraw) {
        drawShape(polyCanvas, [annoJSON]);
      }
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
      if (!deferDraw) {
        drawShape(polyCanvas, [annoJSON]);
      }
    }
  }
}

function finishAnnotationStyleBatch(redraw = false) {
  if (redraw) {
    drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  }
  unsavedAnnotations(true);
  updateRepeatButton();
  syncSelectedAnnotationVisuals();
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
      const annotationIdByUuid = getAnnotationIdByUuidMap();
      selectedUuids.forEach((uuid) => {
        const id = annotationIdByUuid.get(uuid) || 0;
        if (id > 0) applyCurrentAnno(id, true, { deferDraw: true });
      });
      finishAnnotationStyleBatch(false);
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
      applyCurrentAnno(annoIds[i], true, { deferDraw: true });
    }
    if (annoIds.length > 0) {
      finishAnnotationStyleBatch(false);
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
      applyCurrentAnno(annoIds[i], true, { deferDraw: true });
    }
    if (annoIds.length > 0) {
      finishAnnotationStyleBatch(false);
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
      const annotationIdByUuid = getAnnotationIdByUuidMap();
      selectedUuids.forEach((uuid) => {
        const id = annotationIdByUuid.get(uuid) || 0;
        if (id > 0) applyCurrentAnno(id, false, { deferDraw: true });
      });
      finishAnnotationStyleBatch(true);
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
      applyCurrentAnno(annoIds[i], false, { deferDraw: true });
    }
    if (annoIds.length > 0) {
      finishAnnotationStyleBatch(true);
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
    applyCurrentAnno(annoIds[i], false, { deferDraw: true });
  }
  if (annoIds.length > 0) {
    finishAnnotationStyleBatch(true);
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

function previewAnnotationLabelInput() {
  const feature = getSelectedAnnotation();
  const annoLabel = document.getElementById("anno-label");
  if (!feature || !annoLabel) return;
  if (isAnnotationFeatureLocked(feature)) {
    setAnnotationTextInputs(feature);
    return;
  }

  beginPendingAnnotationTextEdit(feature);
  feature.properties.label = annoLabel.value;
  updateText(feature.properties.uuid, "anno", annoLabel.value);
  updateAnnotationListLabel(feature.properties.uuid, annoLabel.value);
}

function commitPendingAnnotationTextEdit(historyLabel) {
  if (!pendingAnnotationTextEdit) return false;

  const { uuid, undoState, label, notes } = pendingAnnotationTextEdit;
  const feature = getAnnotationByUuid(uuid);
  pendingAnnotationTextEdit = null;

  if (!feature) return false;
  if (isAnnotationFeatureLocked(feature)) {
    setAnnotationTextInputs(feature);
    return false;
  }

  const currentLabel = feature.properties.label ?? "";
  const currentNotes = feature.properties.notes ?? "";
  if (currentLabel === label && currentNotes === notes) return false;

  annotationHistory.push(historyLabel, undoState);
  unsavedAnnotations(true);
  return true;
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
  if (pendingAnnotationTextEdit?.uuid === feature.properties.uuid) {
    const notesChanged = feature.properties.notes !== annoNotes.value;
    if (notesChanged) {
      feature.properties.notes = annoNotes.value;
    }
    updateAnnotationListLabel(feature.properties.uuid, annoLabel.value);
    commitPendingAnnotationTextEdit(historyLabel);
    return;
  }

  const labelChanged = feature.properties.label !== annoLabel.value;
  const notesChanged = feature.properties.notes !== annoNotes.value;
  if (!labelChanged && !notesChanged) return;

  annotationHistory.push(historyLabel);
  annoTextToLabel();
  updateText(feature.properties.uuid, "anno", annoLabel.value);
  updateAnnotationListLabel(feature.properties.uuid, annoLabel.value);
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
  ?.addEventListener("input", previewAnnotationLabelInput);

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
  invalidateFeatureImageBounds(feature);

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
  if (
    feature.geometry.type !== "Polygon" &&
    feature.geometry.type !== "MultiPolygon"
  ) {
    return false;
  }

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
  if (
    feature.geometry.type !== "Polygon" &&
    feature.geometry.type !== "MultiPolygon"
  ) {
    return false;
  }

  const shapeType = feature.properties?.shapeType;
  return shapeType !== "circle";
}

function getEditableVertexEntries(feature) {
  if (!isVertexEditableAnnotation(feature)) return [];
  if (feature.geometry.type === "LineString") {
    return (feature.geometry.coordinates || []).map((coordinate, vertexIndex) => ({
      coordinate,
      vertexIndex,
      polygonIndex: null,
      ringIndex: null,
    }));
  }

  const polygons =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates || []]
      : feature.geometry.coordinates || [];
  const entries = [];
  polygons.forEach((polygon, polygonIndex) => {
    (polygon || []).forEach((ring, ringIndex) => {
      const isClosed =
        ring.length > 1 && coordinatesMatch(ring[0], ring[ring.length - 1]);
      const coordinates = isClosed ? ring.slice(0, -1) : ring;
      coordinates.forEach((coordinate, vertexIndex) => {
        entries.push({
          coordinate,
          vertexIndex,
          polygonIndex:
            feature.geometry.type === "MultiPolygon" ? polygonIndex : null,
          ringIndex,
        });
      });
    });
  });
  return entries;
}

function getEditableVertexCoordinates(feature) {
  return getEditableVertexEntries(feature).map((entry) => entry.coordinate);
}

function getVertexRing(feature, vertexContext = {}) {
  if (!isVertexEditableAnnotation(feature)) return null;
  if (feature.geometry.type === "LineString") return feature.geometry.coordinates;
  if (feature.geometry.type === "Polygon") {
    return feature.geometry.coordinates?.[Number(vertexContext.ringIndex) || 0] || null;
  }
  if (feature.geometry.type === "MultiPolygon") {
    return (
      feature.geometry.coordinates?.[Number(vertexContext.polygonIndex) || 0]?.[
        Number(vertexContext.ringIndex) || 0
      ] || null
    );
  }
  return null;
}

function getVertexContextFromHandle(handle) {
  return {
    vertexIndex: Number(handle.dataset.vertexIndex),
    polygonIndex:
      handle.dataset.polygonIndex === undefined
        ? null
        : Number(handle.dataset.polygonIndex),
    ringIndex:
      handle.dataset.ringIndex === undefined ? null : Number(handle.dataset.ringIndex),
  };
}

function getVertexContextSelector(uuid, vertexContext) {
  const parts = [
    `.annotation-vertex-handle[data-annotation-uuid="${CSS.escape(uuid)}"]`,
    `[data-vertex-index="${vertexContext.vertexIndex}"]`,
  ];
  if (vertexContext.ringIndex !== null && vertexContext.ringIndex !== undefined) {
    parts.push(`[data-ring-index="${vertexContext.ringIndex}"]`);
  }
  if (
    vertexContext.polygonIndex !== null &&
    vertexContext.polygonIndex !== undefined
  ) {
    parts.push(`[data-polygon-index="${vertexContext.polygonIndex}"]`);
  }
  return parts.join("");
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

  getEditableVertexEntries(feature).forEach((entry) => {
    const { coordinate, vertexIndex, polygonIndex, ringIndex } = entry;
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className =
      ringIndex > 0
        ? "annotation-vertex-handle annotation-hole-vertex-handle"
        : "annotation-vertex-handle";
    handle.title = "Drag vertex. Option-click to delete.";
    handle.setAttribute(
      "aria-label",
      `Move vertex ${vertexIndex + 1}. Option-click to delete.`
    );
    handle.dataset.annotationUuid = activeVertexEditUuid;
    handle.dataset.vertexIndex = String(vertexIndex);
    if (ringIndex !== null && ringIndex !== undefined) {
      handle.dataset.ringIndex = String(ringIndex);
    }
    if (polygonIndex !== null && polygonIndex !== undefined) {
      handle.dataset.polygonIndex = String(polygonIndex);
    }
    handle.addEventListener("pointerdown", function (event) {
      handleAnnotationVertexPointerDown(event, activeVertexEditUuid, {
        vertexIndex,
        polygonIndex,
        ringIndex,
      });
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

function setAnnotationVertexCoordinate(feature, vertexContext, imagePoint) {
  if (!isVertexEditableAnnotation(feature) || !imagePoint) return;

  const vertexIndex = Number(vertexContext?.vertexIndex);
  if (!Number.isInteger(vertexIndex)) return;

  const nextCoordinate = [imagePoint.x, imagePoint.y];
  let oldCoordinate = null;

  if (feature.geometry.type === "LineString") {
    oldCoordinate = [...feature.geometry.coordinates[vertexIndex]];
    feature.geometry.coordinates[vertexIndex] = nextCoordinate;
  } else if (
    feature.geometry.type === "Polygon" ||
    feature.geometry.type === "MultiPolygon"
  ) {
    const ring = getVertexRing(feature, vertexContext);
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
  invalidateFeatureImageBounds(feature);
}

function getMinimumEditableVertexCount(feature) {
  if (
    feature?.geometry?.type === "Polygon" ||
    feature?.geometry?.type === "MultiPolygon"
  ) {
    return 3;
  }
  if (feature?.geometry?.type === "LineString") return 2;
  return 0;
}

function setEditableVertexCoordinates(feature, coordinates, vertexContext = {}) {
  if (!isVertexEditableAnnotation(feature)) return false;

  if (feature.geometry.type === "LineString") {
    feature.geometry.coordinates = coordinates.map((coordinate) => [...coordinate]);
    invalidateFeatureImageBounds(feature);
    return true;
  }

  if (
    feature.geometry.type === "Polygon" ||
    feature.geometry.type === "MultiPolygon"
  ) {
    const ring = coordinates.map((coordinate) => [...coordinate]);
    if (
      ring.length > 0 &&
      !coordinatesMatch(ring[0], ring[ring.length - 1])
    ) {
      ring.push([...ring[0]]);
    }
    if (feature.geometry.type === "Polygon") {
      feature.geometry.coordinates[Number(vertexContext.ringIndex) || 0] = ring;
    } else {
      const polygonIndex = Number(vertexContext.polygonIndex) || 0;
      const ringIndex = Number(vertexContext.ringIndex) || 0;
      if (!feature.geometry.coordinates[polygonIndex]) return false;
      feature.geometry.coordinates[polygonIndex][ringIndex] = ring;
    }
    invalidateFeatureImageBounds(feature);
    return true;
  }

  return false;
}

function finishAnnotationVertexGeometryEdit(uuid, historyLabel, undoState) {
  updateAnnotationGeometryStatus(getAnnotationByUuid(uuid));
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
  if (feature.geometry.type === "MultiPolygon") {
    const coordinates = getEditableVertexCoordinates(feature);
    return getCoordinateCenter(coordinates);
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
  if (feature.geometry.type === "MultiPolygon") {
    return getEditableVertexCoordinates(feature);
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
  if (feature.geometry?.type === "MultiPolygon") {
    return feature.geometry.coordinates?.[0]?.[0]?.[0];
  }

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
  invalidateFeatureImageBounds(feature);
}

function rotatePolygonFeature(feature, startCoordinates, center, angleRadians) {
  if (!Array.isArray(startCoordinates)) return false;
  feature.geometry.coordinates = rotateCoordinateTree(
    startCoordinates,
    center,
    angleRadians
  );
  invalidateFeatureImageBounds(feature);
  updateGeometryMeasurementProperties(feature);
  return true;
}

function rotateCoordinateTree(coordinates, center, angleRadians) {
  if (
    Array.isArray(coordinates) &&
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    return rotatePointAroundCenter(coordinates, center, angleRadians);
  }
  if (!Array.isArray(coordinates)) return coordinates;
  return coordinates.map((coordinate) =>
    rotateCoordinateTree(coordinate, center, angleRadians)
  );
}

function rotateMultiPolygonFeature(feature, startCoordinates, center, angleRadians) {
  if (!Array.isArray(startCoordinates)) return false;
  feature.geometry.coordinates = rotateCoordinateTree(
    startCoordinates,
    center,
    angleRadians
  );
  invalidateFeatureImageBounds(feature);
  updateGeometryMeasurementProperties(feature);
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
  } else if (feature.geometry.type === "MultiPolygon") {
    if (
      !rotateMultiPolygonFeature(
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
  const uuid = annotationShapeDragState.uuid;
  annotationShapeDragState = null;
  viewerContainer?.classList.remove("annotation-shape-dragging");
  window.removeEventListener("pointermove", handleAnnotationShapeWindowPointerMove);
  window.removeEventListener("pointerup", handleAnnotationShapeWindowPointerUp);
  window.removeEventListener("pointercancel", handleAnnotationShapeWindowPointerUp);
  if (moved) {
    updateAnnotationGeometryStatus(getAnnotationByUuid(uuid));
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

function deleteAnnotationVertex(uuid, vertexContext) {
  const feature = getAnnotationByUuid(uuid);
  if (!isVertexEditableAnnotation(feature)) return false;
  if (isAnnotationFeatureLocked(feature)) return false;

  const ring = getVertexRing(feature, vertexContext);
  if (!ring) return false;
  const coordinates = getCoordinatesWithoutTrailingDuplicate(ring);
  const vertexIndex = Number(vertexContext?.vertexIndex);
  if (coordinates.length <= getMinimumEditableVertexCount(feature)) return false;
  if (!coordinates[vertexIndex]) return false;

  const undoState = cloneAnnotationState();
  coordinates.splice(vertexIndex, 1);
  if (!setEditableVertexCoordinates(feature, coordinates, vertexContext)) return false;
  finishAnnotationVertexGeometryEdit(uuid, "Delete annotation vertex", undoState);
  return true;
}

function getNearestEditableSegmentAtViewerPoint(feature, viewerPoint, tolerance = 10) {
  if (!isVertexEditableAnnotation(feature)) return null;

  const image = viewer.world.getItemAt(0);
  if (!image) return null;

  const entries = getEditableVertexEntries(feature);
  const lineEntries =
    feature.geometry.type === "LineString"
      ? [entries]
      : Object.values(
          entries.reduce((groups, entry) => {
            const key = `${entry.polygonIndex ?? "p"}:${entry.ringIndex ?? "r"}`;
            groups[key] ||= [];
            groups[key].push(entry);
            return groups;
          }, {})
        );
  let nearestSegment = null;

  lineEntries.forEach((ringEntries) => {
    const segmentCount =
      feature.geometry.type === "LineString"
        ? Math.max(0, ringEntries.length - 1)
        : ringEntries.length;
    for (let i = 0; i < segmentCount; i++) {
      const startEntry = ringEntries[i];
      const endEntry =
        feature.geometry.type === "LineString"
          ? ringEntries[i + 1]
          : ringEntries[(i + 1) % ringEntries.length];
      if (!startEntry?.coordinate || !endEntry?.coordinate) continue;

      const distance = distanceToSegment(
        viewerPoint,
        imageCoordToViewerPixel(image, startEntry.coordinate),
        imageCoordToViewerPixel(image, endEntry.coordinate)
      );

      if (distance <= tolerance && (!nearestSegment || distance < nearestSegment.distance)) {
        nearestSegment = {
          distance,
          insertIndex: startEntry.vertexIndex + 1,
          polygonIndex: startEntry.polygonIndex,
          ringIndex: startEntry.ringIndex,
        };
      }
    }
  });

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

  const ring = getVertexRing(feature, nearestSegment);
  if (!ring) return false;
  const coordinates = getCoordinatesWithoutTrailingDuplicate(ring);
  const undoState = cloneAnnotationState();
  coordinates.splice(nearestSegment.insertIndex, 0, [imagePoint.x, imagePoint.y]);
  setEditableVertexCoordinates(feature, coordinates, nearestSegment);
  finishAnnotationVertexGeometryEdit(uuid, "Add annotation vertex", undoState);
  return true;
}

function updateAnnotationVertexHandlePosition(uuid, vertexContext) {
  const feature = getAnnotationByUuid(uuid);
  const ring = getVertexRing(feature, vertexContext);
  const coordinate = ring?.[Number(vertexContext?.vertexIndex)];
  const handle = document.querySelector(getVertexContextSelector(uuid, vertexContext));
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

function startAnnotationVertexDrag(event, uuid, vertexContext) {
  const feature = getAnnotationByUuid(uuid);
  if (!isVertexEditableAnnotation(feature)) return false;
  if (isAnnotationFeatureLocked(feature)) return false;

  const imagePoint = getImagePointFromPointerEvent(event);
  if (!imagePoint) return false;
  const coordinate = getVertexRing(feature, vertexContext)?.[
    Number(vertexContext?.vertexIndex)
  ];
  if (!coordinate) return false;

  annotationVertexDragState = {
    uuid,
    vertexIndex: Number(vertexContext.vertexIndex),
    polygonIndex: vertexContext.polygonIndex,
    ringIndex: vertexContext.ringIndex,
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

  const { uuid, vertexIndex, polygonIndex, ringIndex } = annotationVertexDragState;
  const feature = getAnnotationByUuid(uuid);
  if (!isVertexEditableAnnotation(feature)) return false;
  const vertexContext = { vertexIndex, polygonIndex, ringIndex };

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
  setAnnotationVertexCoordinate(feature, vertexContext, adjustedImagePoint);
  annotationVertexDragState.moved = true;
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  updateAnnotationVertexHandlePosition(uuid, vertexContext);
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

function handleAnnotationVertexPointerDown(event, uuid, vertexContext) {
  if (event.altKey) {
    event.preventDefault();
    event.stopPropagation();
    deleteAnnotationVertex(uuid, vertexContext);
    return;
  }

  if (!startAnnotationVertexDrag(event, uuid, vertexContext)) return;

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

const ANNOTATION_COORDINATE_DECIMALS = 2;

function roundCoordinateNumber(value, decimals = ANNOTATION_COORDINATE_DECIMALS) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  const factor = 10 ** decimals;
  return Math.round(number * factor) / factor;
}

function roundCoordinateTree(coordinates, decimals = ANNOTATION_COORDINATE_DECIMALS) {
  if (!Array.isArray(coordinates)) return coordinates;
  if (
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    return coordinates.map((value) => roundCoordinateNumber(value, decimals));
  }
  return coordinates.map((coordinate) =>
    roundCoordinateTree(coordinate, decimals)
  );
}

function roundFeatureCoordinates(feature, decimals = ANNOTATION_COORDINATE_DECIMALS) {
  if (!feature?.geometry?.coordinates) return feature;
  feature.geometry.coordinates = roundCoordinateTree(
    feature.geometry.coordinates,
    decimals
  );
  invalidateFeatureImageBounds(feature);
  return feature;
}

function cloneFeaturesWithRoundedCoordinates(features) {
  return cloneData(features).map((feature) => roundFeatureCoordinates(feature));
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
      coordinates: roundCoordinateTree([x, y]), // [x, y] format for coordinates
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
      coordinates: roundCoordinateTree(coordinates), // [[x0, y0],[x1,y1]] format for coordinates
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
      coordinates: roundCoordinateTree([coordinates]), // [[[x0, y0],[x1,y1]]] format for coordinates
    },
    properties: properties, // metadata like label, description, etc.
  };
  updateAnnotationGeometryStatus(polygonFeature);
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
  const timestamp = Date.now().toString(36);
  let result = timestamp;

  // Always add randomness. Timestamp-only IDs collide during batch imports.
  const randomLength = Math.max(6, length - timestamp.length);
  for (let i = 0; i < randomLength; i++) {
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
  if (addSegmentPromptPoint(event)) return;
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
let overlayRedrawFrame = null;
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

if (window.electronAPI?.onSegmenteverygrainProgress) {
  window.electronAPI.onSegmenteverygrainProgress(handleSegmenteverygrainProgress);
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
    updateMeasureScaleAudit();
    addScalebar();
    closeScaleWizard();
    window.electronAPI?.setUnsavedState?.(true);
    await saveCurrentLibraryForScaleUpdate();
  } catch (error) {
    samples[currentIndex].pixelsPerMeter = previousPixelsPerMeter;
    updateScaleDependentControls();
    updateMeasureScaleAudit();
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

function isLiveOverlayInteractionActive() {
  return Boolean(
    isAnnotationDraftActive() ||
      isAnnotationDrawingActive() ||
      annotationMoveDragState ||
      annotationLabelMoveDragState ||
      activeVertexEditUuid ||
      activeShapeEditUuid ||
      measurementModeActive ||
      circleModeActive ||
      segmentBoxModeActive ||
      unsupervisedAoiModeActive
  );
}

function drawViewerOverlays() {
  drawShape(polyCanvas, [annoJSONTemp, annoJSON]);
  drawShape(circleCanvas, [circleJSON]);
  drawShape(measureCanvas, [measureJSONTemp, measureAreaJSONTemp, measureJSON]);
  drawScaleWizardOverlay();
}

function requestViewerOverlayRedraw() {
  if (overlayRedrawFrame !== null) return;
  overlayRedrawFrame = requestAnimationFrame(() => {
    overlayRedrawFrame = null;
    drawViewerOverlays();
  });
}

function getVisibleImageBounds(marginRatio = 0.15) {
  const image = viewer.world.getItemAt(0);
  if (!image) return null;

  const width = viewer.container.clientWidth;
  const height = viewer.container.clientHeight;
  const imageCorners = [
    new OpenSeadragon.Point(0, 0),
    new OpenSeadragon.Point(width, 0),
    new OpenSeadragon.Point(width, height),
    new OpenSeadragon.Point(0, height),
  ].map((pixelPoint) => {
    const viewportPoint = viewer.viewport.pointFromPixel(pixelPoint, true);
    return image.viewportToImageCoordinates(viewportPoint);
  });
  const xs = imageCorners.map((point) => point.x);
  const ys = imageCorners.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const marginX = Math.max((maxX - minX) * marginRatio, 64);
  const marginY = Math.max((maxY - minY) * marginRatio, 64);

  return {
    minX: minX - marginX,
    minY: minY - marginY,
    maxX: maxX + marginX,
    maxY: maxY + marginY,
  };
}

function expandCoordinateBounds(coordinates, bounds) {
  if (!Array.isArray(coordinates)) return bounds;
  if (
    coordinates.length >= 2 &&
    Number.isFinite(Number(coordinates[0])) &&
    Number.isFinite(Number(coordinates[1]))
  ) {
    const x = Number(coordinates[0]);
    const y = Number(coordinates[1]);
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
    return bounds;
  }

  coordinates.forEach((coordinate) => expandCoordinateBounds(coordinate, bounds));
  return bounds;
}

function getFeatureImageBounds(feature) {
  const coordinates = feature?.geometry?.coordinates;
  if (!coordinates) return null;
  if (feature._imageBounds?.coordinates === coordinates) {
    return feature._imageBounds.bounds;
  }

  const bounds = expandCoordinateBounds(coordinates, {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  });
  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.maxY)
  ) {
    return null;
  }

  feature._imageBounds = { coordinates, bounds };
  return bounds;
}

function invalidateFeatureImageBounds(feature) {
  if (feature) delete feature._imageBounds;
}

function boundsIntersect(a, b) {
  if (!a || !b) return true;
  return !(
    a.maxX < b.minX ||
    a.minX > b.maxX ||
    a.maxY < b.minY ||
    a.minY > b.maxY
  );
}

// Update previously drawn lines.
viewer.addHandler("animation", () => {
  drawViewerOverlays();
  refreshPorosityOverlayForViewportChange();
  if (unsupervisedResolutionSelect?.value === "viewer") {
    updateUnsupervisedAoiStats();
  }
});

viewer.addHandler("animation-finish", () => {
  drawViewerOverlays();
  refreshPorosityOverlayForViewportChange();
  if (unsupervisedResolutionSelect?.value === "viewer") {
    refreshUnsupervisedAoiPreviewAndControls();
  }
});

if (window.ResizeObserver && viewerContainer) {
  const overlayResizeObserver = new ResizeObserver(() => {
    drawViewerOverlays();
    refreshPorosityOverlayForViewportChange();
  });
  overlayResizeObserver.observe(viewerContainer);
} else {
  window.addEventListener("resize", () => {
    drawViewerOverlays();
    refreshPorosityOverlayForViewportChange();
  });
}

viewerContainer.addEventListener("mousemove", () => {
  if (!isLiveOverlayInteractionActive()) return;
  requestViewerOverlayRedraw();
});

viewerContainer.addEventListener("pointermove", updateSegmentReticlePosition);
viewerContainer.addEventListener("pointerenter", updateSegmentReticlePosition);
viewerContainer.addEventListener("pointerleave", hideSegmentReticle);

viewerContainer.addEventListener("mousemove", (event) => {
  if (!porosityAoiModeActive || porosityAoiComplete) return;

  const rect = viewerContainer.getBoundingClientRect();
  porosityAoiConstrainSegment = event.shiftKey;
  if (event.shiftKey && porosityAoiImagePoints.length > 0) {
    const imagePoint = getPorosityImagePointFromClientPoint(
      event.clientX,
      event.clientY
    );
    const constrainedPoint = constrainPorosityAoiPointToPrevious(imagePoint);
    porosityAoiMousePoint =
      getPorosityScreenPointFromImagePoint(constrainedPoint) || {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
  } else {
    porosityAoiMousePoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }
  drawPorosityOverlay();
});

viewerContainer.addEventListener(
  "pointerdown",
  (event) => {
    startPorosityAoiVertexDrag(event);
  },
  true
);

viewerContainer.addEventListener(
  "pointermove",
  (event) => {
    updatePorosityAoiVertexDrag(event);
  },
  true
);

viewerContainer.addEventListener(
  "pointerup",
  (event) => {
    finishPorosityAoiVertexDrag(event);
  },
  true
);

viewerContainer.addEventListener(
  "pointercancel",
  (event) => {
    finishPorosityAoiVertexDrag(event);
  },
  true
);

viewerContainer.addEventListener("mouseleave", () => {
  if (!porosityAoiModeActive) return;

  porosityAoiMousePoint = null;
  drawPorosityOverlay();
});

// Event listener for double-click to edit existing vertices or end collection
viewer.addHandler("canvas-double-click", function (event) {
  if (measurementModeActive) {
    event.preventDefaultAction = true;
    return;
  }

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
  const visibleImageBounds = getVisibleImageBounds();

  // Flatten the geoJSON array into a single array of features
  const allFeatures = JSONArray.flatMap((geoJSON) => geoJSON.features);

  allFeatures.forEach((feature) => {
    // Only process features that have geometry and properties
    if (feature.geometry && feature.properties) {
      if (!isAnnotationFeatureVisible(feature)) return;
      if (!boundsIntersect(getFeatureImageBounds(feature), visibleImageBounds)) {
        return;
      }
      const coordinates = feature.geometry.coordinates;
      const type = feature.geometry.type;

      if (type === "Polygon") {
        drawPolygon(ctx, coordinates, image, feature);
      } else if (type === "MultiPolygon") {
        coordinates.forEach((polygon) => {
          drawPolygon(ctx, polygon, image, feature);
        });
      } else if (type === "LineString") {
        drawLineString(ctx, coordinates, image, feature);
      } else if (type === "MultiLineString") {
        coordinates.forEach((line) => {
          drawLineString(ctx, line, image, feature);
        });
      } else if (
        type === "Point" &&
        feature.properties.shapeType === "segment-prompt-point"
      ) {
        drawSegmentPromptPoint(ctx, coordinates, image, feature);
      }
    }
  });
}

function drawSegmentPromptPoint(ctx, coordinates, image, feature) {
  if (!image) return;

  const viewportPoint = image.imageToViewportCoordinates(
    coordinates[0],
    coordinates[1]
  );
  const screenPoint =
    viewer.viewport.viewportToViewerElementCoordinates(viewportPoint);
  const color = feature.properties.lineColor || "#0f9d58";
  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(screenPoint.x, screenPoint.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(screenPoint.x - 8, screenPoint.y);
  ctx.lineTo(screenPoint.x + 8, screenPoint.y);
  ctx.moveTo(screenPoint.x, screenPoint.y - 8);
  ctx.lineTo(screenPoint.x, screenPoint.y + 8);
  ctx.stroke();
  ctx.restore();
}

function drawPolygon(ctx, coordinates, image, feature) {
  // Begin a new path for the entire polygon (outer ring + holes)
  ctx.beginPath();
  coordinates.forEach((ring, index) => {
    const isOuterBoundary = index === 0;
    drawPath(ctx, ring, image, feature, isOuterBoundary);
  });

  if (!shouldDrawMeasurementBase(feature)) {
    return;
  }

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

  if (isSelectedMeasurementFeature(feature)) {
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(0, 180, 255, 0.95)";
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

  if (!shouldDrawMeasurementBase(shape)) {
    if (isSelectedMeasurementFeature(shape)) {
      ctx.save();
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(0, 180, 255, 0.95)";
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.restore();
    }
    return;
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

  if (isSelectedMeasurementFeature(shape)) {
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(0, 180, 255, 0.95)";
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
  if (segmentModeActive && event.originalEvent?.altKey) return false;
  return isRectangleMode || event.originalEvent?.altKey;
}

function isSegmentBoxDrawGesture(event) {
  return segmentBoxModeActive || (segmentModeActive && event.originalEvent?.altKey);
}

function isUnsupervisedAoiDrawGesture() {
  return unsupervisedAoiModeActive;
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
  if (isUnsupervisedAoiDrawGesture(event)) {
    event.preventDefaultAction = true;
    const delta = event.delta || new OpenSeadragon.Point(0, 0);
    if (!unsupervisedAoiDragState) {
      unsupervisedAoiDragState = {
        startPixel: new OpenSeadragon.Point(
          event.position.x - delta.x,
          event.position.y - delta.y
        ),
      };
    }
    const aoiRect = imageRectFromPixelBox(
      unsupervisedAoiDragState.startPixel,
      event.position
    );
    if (aoiRect && aoiRect.width > 0 && aoiRect.height > 0) {
      unsupervisedAoiRect = aoiRect;
      updateUnsupervisedAoiPreview(aoiRect);
    }
    return;
  }

  if (isSegmentBoxDrawGesture(event)) {
    event.preventDefaultAction = true;
    const delta = event.delta || new OpenSeadragon.Point(0, 0);
    if (!segmentBoxDragState) {
      segmentBoxDragState = {
        startPixel: new OpenSeadragon.Point(
          event.position.x - delta.x,
          event.position.y - delta.y
        ),
      };
    }
    const promptRect = imageRectFromPixelBox(
      segmentBoxDragState.startPixel,
      event.position
    );
    if (promptRect && promptRect.width > 0 && promptRect.height > 0) {
      segmentPromptBox = promptRect;
      updateSegmentPromptPreview(promptRect);
    }
    return;
  }

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
  if (isUnsupervisedAoiDrawGesture(event)) {
    event.preventDefaultAction = true;
    const aoiRect =
      unsupervisedAoiDragState
        ? imageRectFromPixelBox(unsupervisedAoiDragState.startPixel, event.position)
        : null;
    unsupervisedAoiModeActive = false;
    unsupervisedAoiDragState = null;

    if (!aoiRect || aoiRect.width < 4 || aoiRect.height < 4) {
      clearUnsupervisedAoi("Draw a larger AOI.");
      return;
    }

    unsupervisedAoiRect = aoiRect;
    updateUnsupervisedAoiPreview(aoiRect);
    setUnsupervisedSegmentStatus(
      "AOI ready. Run segmenteverygrain to add annotations."
    );
    updateUnsupervisedSegmentControls();
    return;
  }

  if (isSegmentBoxDrawGesture(event)) {
    event.preventDefaultAction = true;
    const promptRect =
      segmentBoxDragState
        ? imageRectFromPixelBox(segmentBoxDragState.startPixel, event.position)
        : null;
    segmentBoxModeActive = false;
    segmentBoxDragState = null;
    updateSegmentControls();

    if (!promptRect || promptRect.width < 4 || promptRect.height < 4) {
      clearSegmentPreview({ message: "Draw a larger box around one feature." });
      return;
    }

    segmentPromptBox = promptRect;
    updateSegmentPromptPreview(promptRect);
    if (segmentModeActive) {
      segmentPromptBox = null;
      annoJSONTemp = {
        type: "FeatureCollection",
        features: [],
      };
      drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
    }
    runSegmentForPromptBox(promptRect);
    return;
  }

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
      toggleMeasurementsInMarquee(marqueePolygon);
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
    geometry: { type, coordinates: roundCoordinateTree(coordinates) },
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
  resetAnnotationImportProgress();
  setAnnotationImportBusy(false);
  document.getElementById("annotationImportDialog").classList.remove(
    "modal-prompt-hidden"
  );
  document
    .getElementById("annotationImportDialog")
    .classList.add("modal-prompt-visible");
}

function hideAnnotationImportDialog() {
  pendingAnnotationImport = null;
  resetAnnotationImportProgress();
  setAnnotationImportBusy(false);
  document.getElementById("annotationImportDialog").classList.remove(
    "modal-prompt-visible"
  );
  document
    .getElementById("annotationImportDialog")
    .classList.add("modal-prompt-hidden");
}

async function confirmAnnotationImport() {
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
  setAnnotationImportBusy(true);
  setAnnotationImportProgress(0, "Preparing annotation import...");
  try {
    await loadAnnotations(importData, loadOptions);
    updateRepeatButton();
    window.setTimeout(() => {
      hideAnnotationImportDialog();
      resetAnnotationImportProgress();
      setAnnotationImportBusy(false);
    }, 450);
  } catch (error) {
    console.error("Annotation import failed:", error);
    setAnnotationImportProgress(100, error.message || "Annotation import failed.");
    setAnnotationImportBusy(false);
  }
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

function setAnnotationImportProgress(percent, message = "") {
  const progress = document.getElementById("annotationImportProgress");
  const progressBar = document.getElementById("annotationImportProgressBar");
  const progressText = document.getElementById("annotationImportProgressText");
  if (!progress || !progressBar || !progressText) return;

  progress.hidden = false;
  const clampedPercent = Math.max(0, Math.min(100, Number(percent) || 0));
  progressBar.style.transform = `scaleX(${clampedPercent / 100})`;
  progressBar.setAttribute("aria-valuenow", String(Math.round(clampedPercent)));
  progressText.textContent =
    message || `Importing annotations... ${Math.round(clampedPercent)}%`;
}

function resetAnnotationImportProgress() {
  const progress = document.getElementById("annotationImportProgress");
  const progressBar = document.getElementById("annotationImportProgressBar");
  const progressText = document.getElementById("annotationImportProgressText");
  if (!progress || !progressBar || !progressText) return;

  progress.hidden = true;
  progressBar.style.transform = "scaleX(0)";
  progressBar.setAttribute("aria-valuenow", "0");
  progressText.textContent = "";
}

function setAnnotationImportBusy(isBusy) {
  document.getElementById("annotationImportConfirmButton").disabled = isBusy;
  document.getElementById("annotationImportCancelButton").disabled = isBusy;
  document.getElementById("annotationImportGroupSelect").disabled = isBusy;
  document.getElementById("annotationImportSelectAfter").disabled = isBusy;
  [...document.getElementsByName("annotationImportMode")].forEach((input) => {
    input.disabled = isBusy;
  });
  if (!isBusy) {
    updateAnnotationImportGroupInputs();
  }
}

function waitForAnnotationImportPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

// New loadAnnotations() for testing
async function loadAnnotations(geoJSONData, options = {}) {
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
    const chunkSize = Math.max(25, Number(options.chunkSize) || 100);
    for (let index = 0; index < features.length; index += 1) {
      const feature = features[index];
      if (!feature) continue;

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
        continue;
      }

      // Skip duplicate UUIDs
      if (existingUuids.has(properties.uuid)) {
        // Annotation already exists, skipping
        continue;
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
      if ((index + 1) % chunkSize === 0 || index === features.length - 1) {
        const percent = Math.round(((index + 1) / features.length) * 90);
        setAnnotationImportProgress(
          percent,
          `Importing annotations... ${index + 1} of ${features.length}`
        );
        await waitForAnnotationImportPaint();
      }
    }
    setAnnotationImportProgress(94, "Rendering annotation list...");
    await waitForAnnotationImportPaint();
    renderAnnotationList();
    setAnnotationImportProgress(98, "Updating annotation selection...");
    await waitForAnnotationImportPaint();
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
    annoLabelToText();
    setAnnotationImportProgress(100, `Imported ${addedUuids.length} annotation${addedUuids.length === 1 ? "" : "s"}.`);
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
    geometry: { type, coordinates: roundCoordinateTree(coordinates) },
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
    features: cloneFeaturesWithRoundedCoordinates(features),
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
  pendingAnnotationTextEdit = null;
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
    if (porosityPalette && !porosityPalette.hidden && undoPorosityReset()) {
      return;
    }
    if (!undoAnnotationDraftPoint()) {
      annotationHistory.undo();
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  if (!porosityPalette || porosityPalette.hidden) return;
  if (porosityAoiSelectedVertexIndex === null) return;

  const tag = event.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

  event.preventDefault();
  deletePorosityAoiVertex(porosityAoiSelectedVertexIndex);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }

  const target = event.target;
  const tag = target?.tagName;
  if (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target?.isContentEditable
  ) {
    return;
  }
  if (porosityAoiSelectedVertexIndex !== null) return;

  if (deleteSelectedAnnotations()) {
    event.preventDefault();
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

  const featureByUuid = getAnnotationFeatureByUuidMap();
  unlockedUuids.forEach((uuid) =>
    applyAnnoLabel(idBase, uuid, { feature: featureByUuid.get(uuid) })
  );
  if (unlockedUuids.length > 0) {
    finishAnnotationStyleBatch(false);
  }
}

// Functionality for applying specific formatting for annotations
function applyAllAnnoFeature(idBase) {
  const unlockedUuids = getUnlockedAnnotationUuids();
  if (unlockedUuids.length > 0) {
    annotationHistory.push("Style annotations");
  }

  const featureByUuid = getAnnotationFeatureByUuidMap();
  let needsRedraw = false;
  unlockedUuids.forEach((uuid) => {
    if (
      applyAnnoFeature(idBase, uuid, {
        feature: featureByUuid.get(uuid),
        deferDraw: true,
      })
    ) {
      needsRedraw = true;
    }
  });
  if (unlockedUuids.length > 0) {
    finishAnnotationStyleBatch(needsRedraw);
  }
}

function applyCurrentAnnoLabel(idBase) {
  const selectedUuids = getUnlockedSelectedAnnotationUuids();
  if (selectedUuids.length === 0) {
    return;
  }
  annotationHistory.push("Style annotation label");
  const featureByUuid = getAnnotationFeatureByUuidMap();
  selectedUuids.forEach((uuid) =>
    applyAnnoLabel(idBase, uuid, { feature: featureByUuid.get(uuid) })
  );
  finishAnnotationStyleBatch(false);
}

function applyCurrentAnnoFeature(idBase) {
  const selectedUuids = getUnlockedSelectedAnnotationUuids();
  if (selectedUuids.length === 0) {
    return;
  }
  annotationHistory.push("Style annotation");
  const featureByUuid = getAnnotationFeatureByUuidMap();
  let needsRedraw = false;
  selectedUuids.forEach((uuid) => {
    if (
      applyAnnoFeature(idBase, uuid, {
        feature: featureByUuid.get(uuid),
        deferDraw: true,
      })
    ) {
      needsRedraw = true;
    }
  });
  finishAnnotationStyleBatch(needsRedraw);
}

function applyAnnoLabel(idBase, uuid, options = {}) {
  const formattingMap = {
    annoLabelFontSize: "labelFontSize",
    annoLabelFontColor: "labelFontColor",
    annoLabelBackgroundColor: "labelBackgroundColor",
    annoLabelBackgroundOpacity: "labelBackgroundOpacity",
  };

  const feature =
    options.feature || annoJSON.features.find((f) => f.properties.uuid === uuid);
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

function applyAnnoFeature(idBase, uuid, options = {}) {
  const feature =
    options.feature || annoJSON.features.find((f) => f.properties.uuid === uuid);
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
    if (!options.deferDraw) {
      drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
    }
    return true;
  }
  return false;
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
    hideMeasureLiveReadout();
    return;
  }
  measureCanvas.style.display = checkbox.checked ? "block" : "none";
  if (!checkbox.checked) {
    stopMeasurementMode();
    hideMeasureLiveReadout();
  }
};

const circleButton = document.getElementById("toggleCircleButton");

function stopMeasurementMode() {
  measurementModeActive = false;
  activeMeasureTool = null;
  measureImageCoordinates = [];
  clearMeasurePreview();
  hideMeasureLiveReadout();
  [...document.querySelectorAll("[data-measure-tool]")].forEach((button) => {
    button.classList.remove("active");
  });
  updateMeasureValueControls();
  refreshAnnotationFloaters();
}

function toggleMeasurementMode() {
  if (!hasKnownScale()) return;
  measurementModeActive = !measurementModeActive;
  if (!measurementModeActive) resetMeasurements();
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
  circleButton.textContent = "Draw Reference Circle";
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

function calculateRingAreaFromCoordinates(coordinates) {
  const ring = closeCoordinates(coordinates);
  return calculateArea(ring);
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
const measureResultsBody = document.getElementById("measureResultsBody");
const measureResultsTable = document.getElementById("measureResultsTable");
const measureResultsHeader = document.getElementById("measureResultsHeader");
const measureLengthHeader = document.getElementById("measureLengthHeader");
const measureAreaHeader = document.getElementById("measureAreaHeader");
const measurePerimeterHeader = document.getElementById("measurePerimeterHeader");
const measureECDHeader = document.getElementById("measureECDHeader");
const measureWidthHeader = document.getElementById("measureWidthHeader");
const measureLiveReadout = document.getElementById("measure-live-readout");
const measureToolButtons = document.getElementById("measureToolButtons");
const measureSelectedAnnotationsButton = document.getElementById(
  "measureSelectedAnnotationsButton"
);
const measureGroupSelect = document.getElementById("measureGroupSelect");
const measureGroupColorInput = document.getElementById("measureGroupColorInput");
const renameMeasureGroupButton = document.getElementById("renameMeasureGroupButton");
const newMeasureGroupButton = document.getElementById("newMeasureGroupButton");
const measureScaleAuditButton = document.getElementById("measureScaleAuditButton");
const measureScaleAuditPopover = document.getElementById("measureScaleAuditPopover");
const exportMeasurementsButton = document.getElementById(
  "exportMeasurementsButton"
);
const clearMeasurementsButton = document.getElementById(
  "clearMeasurementsButton"
);
const deleteMeasurementButton = document.getElementById(
  "deleteMeasurementButton"
);
const measureColumnsButton = document.getElementById("measureColumnsButton");
const measureColumnsMenu = document.getElementById("measureColumnsMenu");
const measureColumnsList = document.getElementById("measureColumnsList");
const restoreMeasureColumnsButton = document.getElementById(
  "restoreMeasureColumnsButton"
);
const measureHelpButton = document.getElementById("measureHelpButton");
const measureHelpDialog = document.getElementById("measureHelpDialog");
const measureHelpHeader = document.getElementById("measureHelpHeader");
const closeMeasureHelpButton = document.getElementById("closeMeasureHelpButton");
const measureHistogramButton = document.getElementById("measureHistogramButton");
const measureHistogramMenu = document.getElementById("measureHistogramMenu");
const measureHistogramHeader = document.getElementById("measureHistogramHeader");
const measureHistogramParameter = document.getElementById(
  "measureHistogramParameter"
);
const measureHistogramPlotType = document.getElementById("measureHistogramPlotType");
const measureHistogramMode = document.getElementById("measureHistogramMode");
const measureHistogramGroups = document.getElementById("measureHistogramGroups");
const measureHistogramCanvas = document.getElementById("measureHistogramCanvas");
const measureHistogramStatsBody = document.getElementById(
  "measureHistogramStatsBody"
);
const measureHistogramStatsMeanHeader = document.getElementById(
  "measureHistogramStatsMeanHeader"
);
const measureHistogramStatsMedianHeader = document.getElementById(
  "measureHistogramStatsMedianHeader"
);
const measureHistogramStatsSdHeader = document.getElementById(
  "measureHistogramStatsSdHeader"
);
const measureHistogramStatsMinHeader = document.getElementById(
  "measureHistogramStatsMinHeader"
);
const measureHistogramStatsMaxHeader = document.getElementById(
  "measureHistogramStatsMaxHeader"
);
const exportMeasureHistogramButton = document.getElementById(
  "exportMeasureHistogramButton"
);
const exportMeasureHistogramStatsButton = document.getElementById(
  "exportMeasureHistogramStatsButton"
);
const measureScatterButton = document.getElementById("measureScatterButton");
const measureScatterMenu = document.getElementById("measureScatterMenu");
const measureScatterHeader = document.getElementById("measureScatterHeader");
const measureScatterXParameter = document.getElementById(
  "measureScatterXParameter"
);
const measureScatterYParameter = document.getElementById(
  "measureScatterYParameter"
);
const measureScatterMode = document.getElementById("measureScatterMode");
const measureScatterGroups = document.getElementById("measureScatterGroups");
const measureScatterXMinInput = document.getElementById("measureScatterXMin");
const measureScatterXMaxInput = document.getElementById("measureScatterXMax");
const measureScatterYMinInput = document.getElementById("measureScatterYMin");
const measureScatterYMaxInput = document.getElementById("measureScatterYMax");
const measureScatterColorInput = document.getElementById("measureScatterColor");
const measureScatterOpacityRange = document.getElementById(
  "measureScatterOpacityRange"
);
const measureScatterOpacityInput = document.getElementById("measureScatterOpacity");
const measureScatterCanvas = document.getElementById("measureScatterCanvas");
const measureScatterStatsBody = document.getElementById("measureScatterStatsBody");
const measureScatterMeanXHeader = document.getElementById(
  "measureScatterMeanXHeader"
);
const measureScatterMeanYHeader = document.getElementById(
  "measureScatterMeanYHeader"
);
const measureScatterSdXHeader = document.getElementById("measureScatterSdXHeader");
const measureScatterSdYHeader = document.getElementById("measureScatterSdYHeader");
const exportMeasureScatterButton = document.getElementById(
  "exportMeasureScatterButton"
);
const exportMeasureScatterStatsButton = document.getElementById(
  "exportMeasureScatterStatsButton"
);
const closeMeasureScatterButton = document.getElementById(
  "closeMeasureScatterButton"
);
const measureRoseButton = document.getElementById("measureRoseButton");
const measureRoseMenu = document.getElementById("measureRoseMenu");
const measureRoseHeader = document.getElementById("measureRoseHeader");
const measureRoseParameter = document.getElementById("measureRoseParameter");
const measureRoseMode = document.getElementById("measureRoseMode");
const measureRoseColorInput = document.getElementById("measureRoseColor");
const measureRoseBinSizeInput = document.getElementById("measureRoseBinSize");
const measureRoseBidirectionalInput = document.getElementById(
  "measureRoseBidirectional"
);
const measureRoseStackedInput = document.getElementById("measureRoseStacked");
const measureRoseGroups = document.getElementById("measureRoseGroups");
const measureRoseCanvas = document.getElementById("measureRoseCanvas");
const measureRoseStatsBody = document.getElementById("measureRoseStatsBody");
const exportMeasureRoseButton = document.getElementById("exportMeasureRoseButton");
const exportMeasureRoseStatsButton = document.getElementById(
  "exportMeasureRoseStatsButton"
);
const closeMeasureRoseButton = document.getElementById("closeMeasureRoseButton");
const measureParticleSizeButton = document.getElementById(
  "measureParticleSizeButton"
);
const measureParticleSizeMenu = document.getElementById("measureParticleSizeMenu");
const measureParticleSizeHeader = document.getElementById(
  "measureParticleSizeHeader"
);
const measureParticleSizeParameter = document.getElementById(
  "measureParticleSizeParameter"
);
const measureParticleSizeWeight = document.getElementById(
  "measureParticleSizeWeight"
);
const measureParticleSizeMode = document.getElementById("measureParticleSizeMode");
const measureParticleSizeGroups = document.getElementById(
  "measureParticleSizeGroups"
);
const measureParticleShowHistogram = document.getElementById(
  "measureParticleShowHistogram"
);
const measureParticleShowCumulative = document.getElementById(
  "measureParticleShowCumulative"
);
const measureParticleStacked = document.getElementById("measureParticleStacked");
const measureParticlePhiMinInput = document.getElementById("measureParticlePhiMin");
const measureParticlePhiMaxInput = document.getElementById("measureParticlePhiMax");
const measureParticlePhiBinInput = document.getElementById("measureParticlePhiBin");
const measureParticleColorInput = document.getElementById("measureParticleColor");
const measureParticleSizeCanvas = document.getElementById(
  "measureParticleSizeCanvas"
);
const measureParticleSizeStatsBody = document.getElementById(
  "measureParticleSizeStatsBody"
);
const exportMeasureParticleSizeButton = document.getElementById(
  "exportMeasureParticleSizeButton"
);
const exportMeasureParticleSizeStatsButton = document.getElementById(
  "exportMeasureParticleSizeStatsButton"
);
const closeMeasureParticleSizeButton = document.getElementById(
  "closeMeasureParticleSizeButton"
);
const closeMeasureHistogramButton = document.getElementById(
  "closeMeasureHistogramButton"
);
const measureHistogramMinInput = document.getElementById("measureHistogramMin");
const measureHistogramMaxInput = document.getElementById("measureHistogramMax");
const measureHistogramBinSizeInput = document.getElementById(
  "measureHistogramBinSize"
);
const measureHistogramColorInput = document.getElementById("measureHistogramColor");
const measureHistogramStackedInput = document.getElementById(
  "measureHistogramStacked"
);

let measureImageCoordinates = [];
let measureResults = [];
let selectedMeasurementUuids = new Set();
let measurementSelectionAnchorUuid = null;
let distanceInM = 0;
let areaInM2 = 0;
let ECDInM = 0;
measurementControlsInitialized = true;

const DEFAULT_MEASURE_GROUP = {
  groupId: "measurements",
  groupName: "Measurements",
  groupColor: "#00b4ff",
};
let measureGroups = [{ ...DEFAULT_MEASURE_GROUP }];
let activeMeasureGroupId = DEFAULT_MEASURE_GROUP.groupId;
let measureHistogramSelectedGroupIds = new Set();
let measureHistogramKnownGroupIds = new Set();
let measureHistogramRangeEdited = false;
let measureScatterSelectedGroupIds = new Set();
let measureScatterKnownGroupIds = new Set();
let measureScatterRangeEdited = false;
let measureRoseSelectedGroupIds = new Set();
let measureRoseKnownGroupIds = new Set();
let measureParticleSizeSelectedGroupIds = new Set();
let measureParticleSizeKnownGroupIds = new Set();
let measureParticleSizeRangeEdited = false;

const MEASURE_TOOL_LABELS = {
  line: "Line",
  polygon: "Polygon",
};

function isSelectedMeasurementFeature(feature) {
  return (
    selectedMeasurementUuids.has(feature?.properties?.uuid) &&
    (feature?.properties?.source === "manual" ||
      feature?.properties?.source === "annotation")
  );
}

function shouldDrawMeasurementBase(feature) {
  return feature?.properties?.source !== "annotation";
}

function getLinearUnitInfo() {
  const units = [
    { label: "m", factor: 1 },
    { label: "mm", factor: 1e3 },
    { label: "µm", factor: 1e6 },
  ];
  return (
    units[parseInt(document.getElementById("distanceUnits").value, 10)] ||
    units[1]
  );
}

function getAreaUnitInfo() {
  const units = [
    { label: "m²", factor: 1 },
    { label: "mm²", factor: 1e6 },
    { label: "µm²", factor: 1e12 },
  ];
  return (
    units[parseInt(document.getElementById("areaUnits").value, 10)] || units[1]
  );
}

function getECDUnitInfo() {
  const ECDUnits = document.getElementById("ECDUnits");
  if (!ECDUnits) return { label: "mm", factor: 1e3 };
  const units = [
    { label: "m", factor: 1 },
    { label: "mm", factor: 1e3 },
    { label: "µm", factor: 1e6 },
  ];
  return (
    units[parseInt(ECDUnits.value, 10)] || units[1]
  );
}

function formatCompactNumber(value, maximumFractionDigits = 3) {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString(undefined, {
    maximumFractionDigits,
  });
}

function getMeasureScaleAuditInfo() {
  const scale = pixelsPerMeter();
  const linearUnit = getLinearUnitInfo();
  const areaUnit = getAreaUnitInfo();
  const ecdUnit = getECDUnitInfo();
  const calibrated = scale !== null;
  const micronsPerPixel = calibrated ? 1e6 / scale : null;
  const pixelsPerMillimeter = calibrated ? scale / 1000 : null;
  return {
    calibrated,
    scale,
    micronsPerPixel,
    pixelsPerMillimeter,
    linearUnit,
    areaUnit,
    ecdUnit,
  };
}

function renderMeasureScaleAuditPopover(info = getMeasureScaleAuditInfo()) {
  if (!measureScaleAuditPopover) return;
  measureScaleAuditPopover.innerHTML = "";

  const rows = [
    ["Status", info.calibrated ? "Sample calibrated" : "No scale set"],
    [
      "Scale",
      info.calibrated
        ? `${formatCompactNumber(info.micronsPerPixel, 4)} µm/px`
        : "Measurements unavailable",
    ],
    [
      "Pixels",
      info.calibrated
        ? `${formatCompactNumber(info.pixelsPerMillimeter, 2)} px/mm`
        : "--",
    ],
    ["Linear", info.linearUnit.label],
    ["Area", info.areaUnit.label],
    ["ECD", info.ecdUnit.label],
  ];

  rows.forEach(([label, value]) => {
    const row = document.createElement("div");
    row.className = "measure-scale-audit-row-detail";
    const labelElement = document.createElement("span");
    labelElement.textContent = label;
    const valueElement = document.createElement("strong");
    valueElement.textContent = value;
    row.append(labelElement, valueElement);
    measureScaleAuditPopover.appendChild(row);
  });
}

function updateMeasureScaleAudit() {
  if (!measureScaleAuditButton) return;
  const info = getMeasureScaleAuditInfo();
  const summary = info.calibrated
    ? `Scale: ${formatCompactNumber(info.micronsPerPixel, 3)} µm/px · ${info.linearUnit.label}, ${info.areaUnit.label}`
    : "Scale: not set";
  measureScaleAuditButton.textContent = summary;
  measureScaleAuditButton.classList.toggle("missing", !info.calibrated);
  measureScaleAuditButton.title = info.calibrated
    ? `Measurements use ${info.linearUnit.label} and ${info.areaUnit.label}; ${formatCompactNumber(info.pixelsPerMillimeter, 2)} px/mm`
    : "Set an image scale before measuring.";
  renderMeasureScaleAuditPopover(info);
}

function closeMeasureScaleAuditPopover() {
  if (!measureScaleAuditPopover) return;
  measureScaleAuditPopover.hidden = true;
  measureScaleAuditButton?.setAttribute("aria-expanded", "false");
}

function openMeasureScaleAuditPopover() {
  if (!measureScaleAuditButton || !measureScaleAuditPopover) return;
  updateMeasureScaleAudit();
  if (measureScaleAuditPopover.parentElement !== document.body) {
    document.body.appendChild(measureScaleAuditPopover);
  }
  measureScaleAuditPopover.hidden = false;
  measureScaleAuditButton.setAttribute("aria-expanded", "true");

  const buttonRect = measureScaleAuditButton.getBoundingClientRect();
  const menuRect = measureScaleAuditPopover.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(
    Math.max(buttonRect.left, margin),
    window.innerWidth - menuRect.width - margin
  );
  const top = Math.min(
    buttonRect.bottom + 4,
    window.innerHeight - menuRect.height - margin
  );
  measureScaleAuditPopover.style.left = `${Math.max(margin, left)}px`;
  measureScaleAuditPopover.style.top = `${Math.max(margin, top)}px`;
}

function toggleMeasureScaleAuditPopover() {
  if (!measureScaleAuditPopover || measureScaleAuditPopover.hidden) {
    openMeasureScaleAuditPopover();
  } else {
    closeMeasureScaleAuditPopover();
  }
}

function getMeasureStyle() {
  return {
    lineStyle: document.getElementById("measureLineStyle").value,
    lineWeight: Number(document.getElementById("measureLineWeight").value),
    lineColor: document.getElementById("measureLineColor").value,
    lineOpacity: Number(document.getElementById("measureLineOpacity").value),
    fillColor: document.getElementById("measureFillColor").value,
    fillOpacity: Number(document.getElementById("measureFillOpacity").value),
  };
}

function getSafeMeasureGroupColor(color) {
  return /^#[0-9a-f]{6}$/i.test(color)
    ? color
    : DEFAULT_MEASURE_GROUP.groupColor;
}

function normalizeMeasureGroup(group = {}) {
  return {
    groupId: group.groupId || `measure-group-${generateUniqueId(8)}`,
    groupName: group.groupName || DEFAULT_MEASURE_GROUP.groupName,
    groupColor: getSafeMeasureGroupColor(group.groupColor),
  };
}

function getMeasureGroupById(groupId) {
  return measureGroups.find((group) => group.groupId === groupId) || null;
}

function ensureMeasureGroup(group = DEFAULT_MEASURE_GROUP) {
  const normalized = normalizeMeasureGroup(group);
  const existing = measureGroups.find(
    (candidate) =>
      candidate.groupId === normalized.groupId ||
      candidate.groupName.toLowerCase() === normalized.groupName.toLowerCase()
  );
  if (existing) {
    existing.groupColor = getSafeMeasureGroupColor(
      normalized.groupColor || existing.groupColor
    );
    return existing;
  }
  measureGroups.push(normalized);
  measureGroups.sort((a, b) => a.groupName.localeCompare(b.groupName));
  return normalized;
}

function rebuildMeasureGroupsFromRows() {
  const groups = new Map();
  const addGroup = (group = DEFAULT_MEASURE_GROUP) => {
    if (!group.groupId && !group.groupName) return;
    const normalized = normalizeMeasureGroup(group);
    groups.set(normalized.groupId, normalized);
  };

  addGroup(DEFAULT_MEASURE_GROUP);
  measureResults.forEach((result) => {
    addGroup({
      groupId: result.groupId,
      groupName: result.groupName,
      groupColor: result.groupColor,
    });
  });
  measureJSON.features.forEach((feature) => {
    addGroup({
      groupId: feature.properties?.groupId,
      groupName: feature.properties?.groupName,
      groupColor: feature.properties?.groupColor,
    });
  });

  measureGroups = [...groups.values()].sort((a, b) =>
    a.groupName.localeCompare(b.groupName)
  );
}

function getActiveMeasureGroup() {
  return (
    getMeasureGroupById(activeMeasureGroupId) ||
    ensureMeasureGroup(DEFAULT_MEASURE_GROUP)
  );
}

function getMeasureGroupForAnnotation(feature) {
  const props = normalizeAnnotationFeature(feature)?.properties || {};
  return ensureMeasureGroup({
    groupId: props.groupId || DEFAULT_ANNOTATION_GROUP.groupId,
    groupName: props.groupName || DEFAULT_ANNOTATION_GROUP.groupName,
    groupColor: props.groupColor || DEFAULT_ANNOTATION_GROUP.groupColor,
  });
}

function getMeasureGroupForResult(result) {
  return ensureMeasureGroup({
    groupId: result?.groupId || DEFAULT_MEASURE_GROUP.groupId,
    groupName: result?.groupName || DEFAULT_MEASURE_GROUP.groupName,
    groupColor: result?.groupColor || DEFAULT_MEASURE_GROUP.groupColor,
  });
}

function renderMeasureGroupOptions() {
  if (!measureGroupSelect) return;
  const preferredValue = activeMeasureGroupId || measureGroupSelect.value;
  rebuildMeasureGroupsFromRows();
  measureGroupSelect.innerHTML = "";
  measureGroups.forEach((group) => {
    const option = document.createElement("option");
    option.value = group.groupId;
    option.textContent = group.groupName;
    measureGroupSelect.appendChild(option);
  });

  activeMeasureGroupId = getMeasureGroupById(preferredValue)
    ? preferredValue
    : DEFAULT_MEASURE_GROUP.groupId;
  measureGroupSelect.value = activeMeasureGroupId;
  updateMeasureGroupControls();
}

function updateMeasureGroupControls() {
  const group = getMeasureGroupById(activeMeasureGroupId);
  if (measureGroupColorInput) {
    measureGroupColorInput.value = getSafeMeasureGroupColor(group?.groupColor);
    measureGroupColorInput.title = group ? `Color: ${group.groupName}` : "Group Color";
  }
  if (renameMeasureGroupButton) {
    renameMeasureGroupButton.disabled = !group;
    renameMeasureGroupButton.title = group ? `Rename ${group.groupName}` : "Rename Group";
  }
}

function updateMeasureGroupProperties(groupId, updates = {}) {
  const group = getMeasureGroupById(groupId);
  if (!group) return;
  if (updates.groupName !== undefined) {
    group.groupName = updates.groupName;
  }
  if (updates.groupColor !== undefined) {
    group.groupColor = getSafeMeasureGroupColor(updates.groupColor);
  }
  measureResults.forEach((result) => {
    if (result.groupId !== groupId) return;
    result.groupName = group.groupName;
    result.groupColor = group.groupColor;
  });
  measureJSON.features.forEach((feature) => {
    if (feature.properties?.groupId !== groupId) return;
    feature.properties.groupName = group.groupName;
    feature.properties.groupColor = group.groupColor;
  });
  renderMeasureGroupOptions();
  renderMeasureResults();
  drawShape(measureCanvas, [measureJSON, measureAreaJSONTemp, measureJSONTemp]);
}

function assignSelectedMeasurementsToGroup(group) {
  if (!group || selectedMeasurementUuids.size === 0) return;
  measureResults.forEach((result) => {
    if (!selectedMeasurementUuids.has(result.measurementUuid)) return;
    result.groupId = group.groupId;
    result.groupName = group.groupName;
    result.groupColor = group.groupColor;
  });
  measureJSON.features.forEach((feature) => {
    if (!selectedMeasurementUuids.has(feature.properties?.uuid)) return;
    feature.properties.groupId = group.groupId;
    feature.properties.groupName = group.groupName;
    feature.properties.groupColor = group.groupColor;
  });
  renderMeasureResults();
  drawShape(measureCanvas, [measureJSON, measureAreaJSONTemp, measureJSONTemp]);
}

function renameMeasureGroup(groupId, groupName) {
  const trimmedName = groupName.trim();
  if (!trimmedName) return;
  const duplicate = measureGroups.find(
    (group) =>
      group.groupId !== groupId &&
      group.groupName.toLowerCase() === trimmedName.toLowerCase()
  );
  if (duplicate) {
    alert("A measurement group with that name already exists.");
    return;
  }
  updateMeasureGroupProperties(groupId, { groupName: trimmedName });
}

function createMeasureGroup(groupName) {
  const trimmedName = groupName.trim();
  if (!trimmedName) return;
  const existing = measureGroups.find(
    (group) => group.groupName.toLowerCase() === trimmedName.toLowerCase()
  );
  const group =
    existing ||
    ensureMeasureGroup({
      groupId: `measure-group-${generateUniqueId(8)}`,
      groupName: trimmedName,
      groupColor: getAnnotationGroupColor(measureGroups.length),
    });
  activeMeasureGroupId = group.groupId;
  assignSelectedMeasurementsToGroup(group);
  renderMeasureGroupOptions();
}

function getImagePointFromMeasureEventPosition(position) {
  const image = viewer.world.getItemAt(0);
  if (!image) return null;
  const viewportPoint = viewer.viewport.pointFromPixel(position);
  const imagePoint = image.viewportToImageCoordinates(
    viewportPoint.x,
    viewportPoint.y
  );
  return [imagePoint.x, imagePoint.y];
}

function getImagePointFromMeasureMouseEvent(event) {
  const rect = viewerContainer.getBoundingClientRect();
  const position = new OpenSeadragon.Point(
    event.clientX - rect.left,
    event.clientY - rect.top
  );
  return getImagePointFromMeasureEventPosition(position);
}

function closeCoordinates(coordinates) {
  if (coordinates.length === 0) return [];
  const closed = coordinates.map((coordinate) => [...coordinate]);
  if (!coordinatesMatch(closed[0], closed[closed.length - 1])) {
    closed.push([...closed[0]]);
  }
  return closed;
}

function getCleanCoordinateRing(coordinates) {
  const cleaned = [];
  coordinates.forEach((coordinate) => {
    if (
      !Array.isArray(coordinate) ||
      coordinate.length < 2 ||
      !Number.isFinite(coordinate[0]) ||
      !Number.isFinite(coordinate[1])
    ) {
      return;
    }
    if (
      cleaned.length === 0 ||
      !coordinatesMatch(cleaned[cleaned.length - 1], coordinate)
    ) {
      cleaned.push([...coordinate]);
    }
  });
  return closeCoordinates(cleaned);
}

function segmentsShareCoordinateEndpoint(aStart, aEnd, bStart, bEnd) {
  return (
    coordinatesMatch(aStart, bStart) ||
    coordinatesMatch(aStart, bEnd) ||
    coordinatesMatch(aEnd, bStart) ||
    coordinatesMatch(aEnd, bEnd)
  );
}

function getPolygonSelfIntersectionStatus(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 4) {
    return { validGeometry: true, geometryWarning: "" };
  }

  const ring = getCleanCoordinateRing(coordinates);
  if (ring.length < 4) {
    return { validGeometry: true, geometryWarning: "" };
  }
  const segmentCount = ring.length - 1;
  for (let i = 0; i < segmentCount; i++) {
    const aStart = ring[i];
    const aEnd = ring[i + 1];
    if (coordinatesMatch(aStart, aEnd)) continue;

    for (let j = i + 1; j < segmentCount; j++) {
      const sharesEndpoint =
        Math.abs(i - j) <= 1 || (i === 0 && j === segmentCount - 1);
      if (sharesEndpoint) continue;

      const bStart = ring[j];
      const bEnd = ring[j + 1];
      if (
        coordinatesMatch(bStart, bEnd) ||
        segmentsShareCoordinateEndpoint(aStart, aEnd, bStart, bEnd)
      ) {
        continue;
      }
      if (
        imageSegmentsIntersect(
          imagePointFromCoord(aStart),
          imagePointFromCoord(aEnd),
          imagePointFromCoord(bStart),
          imagePointFromCoord(bEnd)
        )
      ) {
        return {
          validGeometry: false,
          geometryWarning:
            "Self-intersecting polygon; area is ambiguous and was not calculated.",
        };
      }
    }
  }

  return { validGeometry: true, geometryWarning: "" };
}

function getPolygonWidthHeight(coordinates) {
  const xs = coordinates.map((coordinate) => coordinate[0]);
  const ys = coordinates.map((coordinate) => coordinate[1]);
  return {
    widthPx: Math.max(...xs) - Math.min(...xs),
    heightPx: Math.max(...ys) - Math.min(...ys),
  };
}

function crossProduct(origin, a, b) {
  return (
    (a[0] - origin[0]) * (b[1] - origin[1]) -
    (a[1] - origin[1]) * (b[0] - origin[0])
  );
}

function getConvexHull(points) {
  const uniquePoints = [...new Map(
    points.map((point) => [`${point[0]},${point[1]}`, point])
  ).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  if (uniquePoints.length <= 1) return uniquePoints;

  const lower = [];
  uniquePoints.forEach((point) => {
    while (
      lower.length >= 2 &&
      crossProduct(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  });

  const upper = [];
  [...uniquePoints].reverse().forEach((point) => {
    while (
      upper.length >= 2 &&
      crossProduct(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  });

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function normalizeAxisAzimuthDegrees(dx, dy) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
    return null;
  }

  const northClockwise = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return ((northClockwise % 180) + 180) % 180;
}

function getOrientedAxisProperties(coordinates) {
  const points = getCoordinatesWithoutTrailingDuplicate(coordinates);
  if (points.length < 2) {
    return {
      shortAxisPx: null,
      longAxisPx: null,
      aspectRatio: null,
      longAxisAzimuthDeg: null,
    };
  }

  const hull = getConvexHull(points);
  if (hull.length === 2) {
    const dx = hull[1][0] - hull[0][0];
    const dy = hull[1][1] - hull[0][1];
    return {
      shortAxisPx: 0,
      longAxisPx: calculateDistance(hull[0], hull[1]),
      aspectRatio: 0,
      longAxisAzimuthDeg: normalizeAxisAzimuthDegrees(dx, dy),
    };
  }

  let bestBox = null;
  for (let i = 0; i < hull.length; i++) {
    const start = hull[i];
    const end = hull[(i + 1) % hull.length];
    const angle = Math.atan2(end[1] - start[1], end[0] - start[0]);
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const rotated = hull.map(([x, y]) => [
      x * cos - y * sin,
      x * sin + y * cos,
    ]);
    const xs = rotated.map((point) => point[0]);
    const ys = rotated.map((point) => point[1]);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    const area = width * height;
    if (!bestBox || area < bestBox.area) {
      bestBox = { width, height, angle, area };
    }
  }

  if (!bestBox) {
    return {
      shortAxisPx: null,
      longAxisPx: null,
      aspectRatio: null,
      longAxisAzimuthDeg: null,
    };
  }

  const widthIsLong = bestBox.width >= bestBox.height;
  const longAxisPx = widthIsLong ? bestBox.width : bestBox.height;
  const shortAxisPx = widthIsLong ? bestBox.height : bestBox.width;
  const longAxisAngle = bestBox.angle + (widthIsLong ? 0 : Math.PI / 2);

  return {
    shortAxisPx,
    longAxisPx,
    aspectRatio: longAxisPx === 0 ? null : shortAxisPx / longAxisPx,
    longAxisAzimuthDeg: normalizeAxisAzimuthDegrees(
      Math.cos(longAxisAngle),
      Math.sin(longAxisAngle)
    ),
  };
}

function getFeretDiameterProperties(coordinates) {
  const points = getCoordinatesWithoutTrailingDuplicate(coordinates);
  const hull = getConvexHull(points);
  if (hull.length < 2) {
    return {
      maxFeretPx: null,
      minFeretPx: null,
      maxFeretAzimuthDeg: null,
    };
  }

  if (hull.length === 2) {
    const dx = hull[1][0] - hull[0][0];
    const dy = hull[1][1] - hull[0][1];
    const diameter = calculateDistance(hull[0], hull[1]);
    return {
      maxFeretPx: diameter,
      minFeretPx: 0,
      maxFeretAzimuthDeg: normalizeAxisAzimuthDegrees(dx, dy),
    };
  }

  let maxFeretPx = 0;
  let maxFeretAzimuthDeg = null;
  for (let i = 0; i < hull.length; i++) {
    for (let j = i + 1; j < hull.length; j++) {
      const dx = hull[j][0] - hull[i][0];
      const dy = hull[j][1] - hull[i][1];
      const distance = Math.hypot(dx, dy);
      if (distance > maxFeretPx) {
        maxFeretPx = distance;
        maxFeretAzimuthDeg = normalizeAxisAzimuthDegrees(dx, dy);
      }
    }
  }

  let minFeretPx = null;
  for (let i = 0; i < hull.length; i++) {
    const start = hull[i];
    const end = hull[(i + 1) % hull.length];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const edgeLength = Math.hypot(dx, dy);
    if (edgeLength === 0) continue;
    const nx = -dy / edgeLength;
    const ny = dx / edgeLength;
    const projections = hull.map(([x, y]) => x * nx + y * ny);
    const width = Math.max(...projections) - Math.min(...projections);
    minFeretPx = minFeretPx === null ? width : Math.min(minFeretPx, width);
  }

  return {
    maxFeretPx,
    minFeretPx,
    maxFeretAzimuthDeg,
  };
}

function calculateMeasurementProperties(type, coordinates) {
  const properties = {
    lengthM: null,
    perimeterM: null,
    areaM2: null,
    ecdM: null,
    radiusM: null,
    diameterM: null,
    widthM: null,
    heightM: null,
    longAxisM: null,
    shortAxisM: null,
    maxFeretM: null,
    minFeretM: null,
    maxFeretAzimuthDeg: null,
    majorAxisM: null,
    minorAxisM: null,
    aspectRatio: null,
    azimuthDeg: null,
    solidity: null,
    circularity: null,
    validGeometry: true,
    geometryWarning: "",
  };

  if (type === "line") {
    properties.lengthM = metersFromPixels(calculateLineStringLength(coordinates));
    return properties;
  }

  const closed = closeCoordinates(coordinates);
  const geometryStatus = getPolygonSelfIntersectionStatus(closed);
  properties.validGeometry = geometryStatus.validGeometry;
  properties.geometryWarning = geometryStatus.geometryWarning;
  const areaPixels = calculatePolygonArea([closed]);
  const perimeterPixels = calculatePolygonExteriorPerimeter([closed]);
  properties.areaM2 = geometryStatus.validGeometry
    ? squareMetersFromSquarePixels(areaPixels)
    : null;
  properties.perimeterM = metersFromPixels(perimeterPixels);
  properties.ecdM =
    properties.areaM2 === null
      ? null
      : 2 * Math.sqrt(properties.areaM2 / Math.PI);
  properties.circularity =
    properties.areaM2 === null || properties.perimeterM === 0
      ? null
      : (4 * Math.PI * properties.areaM2) /
        (properties.perimeterM * properties.perimeterM);

  const hull = getConvexHull(getCoordinatesWithoutTrailingDuplicate(closed));
  const hullAreaPixels = hull.length >= 3 ? calculateRingAreaFromCoordinates(hull) : 0;
  properties.solidity =
    properties.areaM2 === null || hullAreaPixels === 0
      ? null
      : areaPixels / hullAreaPixels;

  const { widthPx, heightPx } = getPolygonWidthHeight(closed);
  properties.widthM = metersFromPixels(widthPx);
  properties.heightM = metersFromPixels(heightPx);
  const axes = getOrientedAxisProperties(closed);
  if (axes.shortAxisPx !== null && axes.longAxisPx !== null) {
    properties.longAxisM = metersFromPixels(axes.longAxisPx);
    properties.shortAxisM = metersFromPixels(axes.shortAxisPx);
    properties.widthM = properties.shortAxisM;
    properties.heightM = metersFromPixels(axes.longAxisPx);
    properties.aspectRatio = axes.aspectRatio;
    properties.azimuthDeg = axes.longAxisAzimuthDeg;
  }
  const feret = getFeretDiameterProperties(closed);
  properties.maxFeretM = metersFromPixels(feret.maxFeretPx);
  properties.minFeretM = metersFromPixels(feret.minFeretPx);
  properties.maxFeretAzimuthDeg = feret.maxFeretAzimuthDeg;

  if (type === "circle") {
    const diameterPx = Math.max(widthPx, heightPx);
    properties.diameterM = metersFromPixels(diameterPx);
    properties.radiusM = properties.diameterM / 2;
  }

  if (type === "ellipse") {
    const majorAxisPx = Math.max(widthPx, heightPx);
    const minorAxisPx = Math.min(widthPx, heightPx);
    properties.majorAxisM = metersFromPixels(majorAxisPx);
    properties.minorAxisM = metersFromPixels(minorAxisPx);
  }

  return properties;
}

function getGeometryLineCoordinates(geometry) {
  if (geometry?.type === "LineString") return [geometry.coordinates || []];
  if (geometry?.type === "MultiLineString") return geometry.coordinates || [];
  return [];
}

function getGeometryPolygonCoordinates(geometry) {
  if (geometry?.type === "Polygon") return [geometry.coordinates || []];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates || [];
  return [];
}

function getGeometryCoordinatePoints(geometry) {
  const points = [];
  const visit = (value) => {
    if (
      Array.isArray(value) &&
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      points.push(value);
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
  };
  visit(geometry?.coordinates);
  return points;
}

function calculateGeometryMeasurementProperties(type, geometry) {
  if (geometry?.type === "LineString" && Array.isArray(geometry.coordinates)) {
    return calculateMeasurementProperties(
      type,
      geometry.coordinates
    );
  }

  const properties = {
    lengthM: null,
    perimeterM: null,
    areaM2: null,
    ecdM: null,
    radiusM: null,
    diameterM: null,
    widthM: null,
    heightM: null,
    longAxisM: null,
    shortAxisM: null,
    maxFeretM: null,
    minFeretM: null,
    maxFeretAzimuthDeg: null,
    majorAxisM: null,
    minorAxisM: null,
    aspectRatio: null,
    azimuthDeg: null,
    solidity: null,
    circularity: null,
    validGeometry: true,
    geometryWarning: "",
  };

  if (type === "line") {
    const lengthPixels = getGeometryLineCoordinates(geometry).reduce(
      (total, line) => total + calculateLineStringLength(line || []),
      0
    );
    properties.lengthM = metersFromPixels(lengthPixels);
    return properties;
  }

  const polygons = getGeometryPolygonCoordinates(geometry);
  let areaPixels = 0;
  let perimeterPixels = 0;
  let invalidWarnings = [];

  polygons.forEach((polygon) => {
    (polygon || []).forEach((ring, ringIndex) => {
      const closed = closeCoordinates(ring || []);
      if (closed.length < 4) return;
      const geometryStatus = getPolygonSelfIntersectionStatus(closed);
      if (!geometryStatus.validGeometry && geometryStatus.geometryWarning) {
        invalidWarnings.push(geometryStatus.geometryWarning);
      }
      const ringArea = calculateArea(closed);
      areaPixels += ringIndex === 0 ? ringArea : -ringArea;
      perimeterPixels += calculatePerimeter(closed);
    });
  });

  properties.validGeometry = invalidWarnings.length === 0;
  properties.geometryWarning = [...new Set(invalidWarnings)].join(" ");
  properties.areaM2 = properties.validGeometry
    ? squareMetersFromSquarePixels(Math.max(0, areaPixels))
    : null;
  properties.perimeterM = metersFromPixels(perimeterPixels);
  properties.ecdM =
    properties.areaM2 === null
      ? null
      : 2 * Math.sqrt(properties.areaM2 / Math.PI);
  properties.circularity =
    properties.areaM2 === null || properties.perimeterM === 0
      ? null
      : (4 * Math.PI * properties.areaM2) /
        (properties.perimeterM * properties.perimeterM);

  const points = getGeometryCoordinatePoints(geometry);
  if (points.length > 0) {
    const { widthPx, heightPx } = getPolygonWidthHeight(points);
    properties.widthM = metersFromPixels(widthPx);
    properties.heightM = metersFromPixels(heightPx);
    const axes = getOrientedAxisProperties(points);
    if (axes.shortAxisPx !== null && axes.longAxisPx !== null) {
      properties.longAxisM = metersFromPixels(axes.longAxisPx);
      properties.shortAxisM = metersFromPixels(axes.shortAxisPx);
      properties.widthM = properties.shortAxisM;
      properties.heightM = metersFromPixels(axes.longAxisPx);
      properties.aspectRatio = axes.aspectRatio;
      properties.azimuthDeg = axes.longAxisAzimuthDeg;
    }
    const feret = getFeretDiameterProperties(points);
    properties.maxFeretM = metersFromPixels(feret.maxFeretPx);
    properties.minFeretM = metersFromPixels(feret.minFeretPx);
    properties.maxFeretAzimuthDeg = feret.maxFeretAzimuthDeg;

    if (type === "circle") {
      const diameterPx = Math.max(widthPx, heightPx);
      properties.diameterM = metersFromPixels(diameterPx);
      properties.radiusM = properties.diameterM / 2;
    }

    if (type === "ellipse") {
      const majorAxisPx = Math.max(widthPx, heightPx);
      const minorAxisPx = Math.min(widthPx, heightPx);
      properties.majorAxisM = metersFromPixels(majorAxisPx);
      properties.minorAxisM = metersFromPixels(minorAxisPx);
    }

    const hull = getConvexHull(points);
    const hullAreaPixels =
      hull.length >= 3 ? calculateRingAreaFromCoordinates(hull) : 0;
    properties.solidity =
      properties.areaM2 === null || hullAreaPixels === 0
        ? null
        : areaPixels / hullAreaPixels;
  }

  return properties;
}

function updateMeasurementSummaryFields(
  result = measureResults[measureResults.length - 1]
) {
  const linearUnit = getLinearUnitInfo();
  const areaUnit = getAreaUnitInfo();
  const ecdUnit = getECDUnitInfo();

  distanceInM = result?.lengthM ?? result?.perimeterM ?? 0;
  areaInM2 = result?.areaM2 ?? 0;
  ECDInM = result?.ecdM ?? 0;

  distanceElement.value = (distanceInM * linearUnit.factor).toFixed(2);
  areaElement.value = (areaInM2 * areaUnit.factor).toFixed(2);
  if (ECDElement) {
    ECDElement.value = (ECDInM * ecdUnit.factor).toFixed(2);
  }
}

function formatMeasurementValue(value, unitInfo) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return `${(value * unitInfo.factor).toFixed(2)} ${unitInfo.label}`;
}

function formatMeasurementNumber(value, unitInfo) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return (value * unitInfo.factor).toFixed(2);
}

function formatPlainMeasurementNumber(value, fractionDigits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return Number(value).toFixed(fractionDigits);
}

function updateMeasureTableHeaders() {
  const linearUnit = getLinearUnitInfo();
  const areaUnit = getAreaUnitInfo();
  if (measureLengthHeader) {
    measureLengthHeader.innerHTML = `Length<br>(${linearUnit.label})`;
  }
  if (measureAreaHeader) {
    measureAreaHeader.innerHTML = `Area<br>(${areaUnit.label})`;
  }
  if (measurePerimeterHeader) {
    measurePerimeterHeader.innerHTML = `Perimeter<br>(${linearUnit.label})`;
  }
  if (measureECDHeader) {
    measureECDHeader.innerHTML = `ECD<br>(${linearUnit.label})`;
  }
  if (measureWidthHeader) {
    measureWidthHeader.innerHTML = `Long axis<br>(${linearUnit.label})`;
  }
}

function hideMeasureLiveReadout() {
  if (!measureLiveReadout) return;
  measureLiveReadout.hidden = true;
  measureLiveReadout.classList.remove("measure-live-readout-warning");
}

function updateMeasureLiveReadout(event, type, measurement) {
  if (!measureLiveReadout || !measurement) return;
  const linearUnit = getLinearUnitInfo();
  const areaUnit = getAreaUnitInfo();
  const label =
    type === "polygon" && measurement.validGeometry === false
      ? measurement.geometryWarning
    : type === "polygon"
      ? `Area: ${formatMeasurementValue(measurement.areaM2, areaUnit)}`
      : `Length: ${formatMeasurementValue(measurement.lengthM, linearUnit)}`;

  measureLiveReadout.textContent = label;
  measureLiveReadout.classList.toggle(
    "measure-live-readout-warning",
    type === "polygon" && measurement.validGeometry === false
  );
  measureLiveReadout.style.left = `${event.clientX + 14}px`;
  measureLiveReadout.style.top = `${event.clientY + 14}px`;
  measureLiveReadout.hidden = false;
}

function createMeasureTypeIcon(type) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "measure-type-icon annotation-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");

  if (type === "point") {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "3");
    svg.appendChild(circle);
    return svg;
  }

  if (type === "rectangle") {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", "5");
    rect.setAttribute("y", "7");
    rect.setAttribute("width", "14");
    rect.setAttribute("height", "10");
    svg.appendChild(rect);
    return svg;
  }

  if (type === "circle") {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "7");
    svg.appendChild(circle);
    return svg;
  }

  if (type === "ellipse") {
    const ellipse = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
    ellipse.setAttribute("cx", "12");
    ellipse.setAttribute("cy", "12");
    ellipse.setAttribute("rx", "8");
    ellipse.setAttribute("ry", "5.5");
    svg.appendChild(ellipse);
    return svg;
  }

  if (type === "polygon") {
    const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    polygon.setAttribute("points", "12 4 19 9 16.5 18 7.5 18 5 9");
    svg.appendChild(polygon);
    return svg;
  }

  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", "4,18 9,10 15,14 20,5");
  svg.appendChild(polyline);
  return svg;
}

function createMeasureGroupColor(group) {
  const swatch = document.createElement("span");
  swatch.className = "measure-group-color annotation-list-group";
  swatch.style.backgroundColor = getSafeMeasureGroupColor(group?.groupColor);
  swatch.title = group?.groupName || DEFAULT_MEASURE_GROUP.groupName;
  return swatch;
}

function getNextMeasurementId(source) {
  const prefix = source === "annotation" ? "A" : "M";
  const count = measureResults.filter((result) =>
    String(result.id || "").startsWith(prefix)
  ).length;
  return `${prefix}${count + 1}`;
}

function updateDeleteMeasurementButton() {
  if (deleteMeasurementButton) {
    deleteMeasurementButton.disabled = selectedMeasurementUuids.size === 0;
  }
}

function getMeasureFeatureByUuid(uuid) {
  return measureJSON.features.find(
    (feature) =>
      feature.properties?.uuid === uuid &&
      ["manual", "annotation"].includes(feature.properties?.source)
  );
}

function getSelectableMeasurementUuids() {
  return measureResults
    .map((result) => result.measurementUuid)
    .filter(Boolean);
}

function getMeasurementResultIndexByUuid(uuid) {
  return getDisplayedMeasureResults().findIndex(
    (result) => result.measurementUuid === uuid
  );
}

function focusMeasurementRow(uuid) {
  if (!uuid) return;
  requestAnimationFrame(() => {
    const row = document.querySelector(
      `#measureResultsBody tr[data-measurement-uuid="${CSS.escape(uuid)}"]`
    );
    if (!row) return;
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: "nearest" });
  });
}

function setMeasurementSelection(uuids = [], options = {}) {
  const selectable = new Set(getSelectableMeasurementUuids());
  selectedMeasurementUuids = new Set(uuids.filter((uuid) => selectable.has(uuid)));
  if (
    measurementSelectionAnchorUuid &&
    !selectable.has(measurementSelectionAnchorUuid)
  ) {
    measurementSelectionAnchorUuid = null;
  }
  const selectedUuids = [...selectedMeasurementUuids];
  const primaryUuid =
    options.primaryUuid && selectedMeasurementUuids.has(options.primaryUuid)
      ? options.primaryUuid
      : selectedUuids[selectedUuids.length - 1];
  const primaryResult = measureResults.find(
    (result) => result.measurementUuid === primaryUuid
  );
  if (primaryResult?.groupId) {
    activeMeasureGroupId = primaryResult.groupId;
  }
  renderMeasureGroupOptions();
  renderMeasureResults();
  drawShape(measureCanvas, [measureJSON, measureAreaJSONTemp, measureJSONTemp]);
  if (options.focusUuid) focusMeasurementRow(options.focusUuid);
}

function selectMeasurement(uuid, options = {}) {
  const { toggle = false, append = false } = options;
  if (!uuid) {
    measurementSelectionAnchorUuid = null;
    setMeasurementSelection([]);
    return;
  }

  if (toggle) {
    measurementSelectionAnchorUuid = uuid;
    const nextSelection = new Set(selectedMeasurementUuids);
    if (nextSelection.has(uuid)) {
      nextSelection.delete(uuid);
    } else {
      nextSelection.add(uuid);
    }
    setMeasurementSelection([...nextSelection], {
      focusUuid: nextSelection.has(uuid) ? uuid : null,
      primaryUuid: nextSelection.has(uuid) ? uuid : null,
    });
    return;
  }

  if (append) {
    measurementSelectionAnchorUuid = uuid;
    setMeasurementSelection([...selectedMeasurementUuids, uuid], {
      focusUuid: uuid,
      primaryUuid: uuid,
    });
    return;
  }

  measurementSelectionAnchorUuid = uuid;
  setMeasurementSelection([uuid], { focusUuid: uuid, primaryUuid: uuid });
}

function handleMeasureResultRowClick(event, uuid) {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
  }
  const clickedIndex = getMeasurementResultIndexByUuid(uuid);
  if (clickedIndex < 0) return;

  if (event.shiftKey && measurementSelectionAnchorUuid) {
    const anchorIndex = getMeasurementResultIndexByUuid(
      measurementSelectionAnchorUuid
    );
    if (anchorIndex >= 0) {
      const displayedResults = getDisplayedMeasureResults();
      const start = Math.min(anchorIndex, clickedIndex);
      const end = Math.max(anchorIndex, clickedIndex);
      const rangeUuids = displayedResults
        .slice(start, end + 1)
        .map((result) => result.measurementUuid)
        .filter(Boolean);
      setMeasurementSelection(rangeUuids, { focusUuid: uuid, primaryUuid: uuid });
      return;
    }
  }

  if (event.ctrlKey || event.metaKey) {
    measurementSelectionAnchorUuid = uuid;
    selectMeasurement(uuid, { toggle: true });
    return;
  }

  measurementSelectionAnchorUuid = uuid;
  selectMeasurement(uuid);
}

function selectAdjacentMeasurementRow(currentUuid, direction) {
  const rows = [
    ...measureResultsBody.querySelectorAll("tr[data-measurement-uuid]"),
  ].filter((row) => row.dataset.measurementUuid);
  if (rows.length === 0) return;

  const selectedUuids = [...selectedMeasurementUuids];
  const selectedUuid = currentUuid || selectedUuids[selectedUuids.length - 1];
  const matchedIndex = rows.findIndex(
    (row) => row.dataset.measurementUuid === selectedUuid
  );
  const currentIndex = matchedIndex >= 0 ? matchedIndex : -direction;
  const nextIndex = Math.min(
    rows.length - 1,
    Math.max(0, currentIndex + direction)
  );
  const nextUuid = rows[nextIndex].dataset.measurementUuid;
  measurementSelectionAnchorUuid = nextUuid;
  selectMeasurement(nextUuid);
}

function deleteSelectedMeasurement() {
  if (selectedMeasurementUuids.size === 0) return;
  const selected = new Set(selectedMeasurementUuids);
  measureJSON.features = measureJSON.features.filter(
    (feature) => !selected.has(feature.properties?.uuid)
  );
  measureResults = measureResults.filter(
    (result) => !selected.has(result.measurementUuid)
  );
  selectedMeasurementUuids = new Set();
  measurementSelectionAnchorUuid = null;
  renderMeasureResults();
  drawShape(measureCanvas, [measureJSON, measureAreaJSONTemp, measureJSONTemp]);
}

function findMeasurementUuidAtViewerPoint(viewerPoint, options = {}) {
  const lineTolerance = options.lineTolerance ?? 10;
  const image = viewer.world.getItemAt(0);
  if (!image) return null;

  const viewportPoint = viewer.viewport.pointFromPixel(viewerPoint);
  const imagePoint = image.viewportToImageCoordinates(viewportPoint);

  for (let i = measureJSON.features.length - 1; i >= 0; i--) {
    const feature = measureJSON.features[i];
    if (
      !feature.geometry ||
      feature.properties?.source !== "manual"
    ) {
      continue;
    }

    const { type, coordinates } = feature.geometry;
    if (type === "LineString") {
      if (isNearLineCoordinates(viewerPoint, image, coordinates, lineTolerance)) {
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
    }
  }

  return null;
}

function measurementFeatureIntersectsMarquee(feature, marqueePolygon) {
  if (
    !feature.geometry ||
    feature.properties?.source !== "manual"
  ) {
    return false;
  }

  const { type, coordinates } = feature.geometry;
  if (type === "LineString") {
    return lineCoordinatesIntersectMarquee(coordinates, marqueePolygon);
  }
  if (type === "Polygon") {
    return polygonIntersectsMarquee(coordinates, marqueePolygon);
  }
  return false;
}

function toggleMeasurementsInMarquee(marqueePolygon) {
  const touchedUuids = measureJSON.features
    .filter((feature) => measurementFeatureIntersectsMarquee(feature, marqueePolygon))
    .map((feature) => feature.properties.uuid);

  if (touchedUuids.length === 0) return;

  const nextSelection = new Set(selectedMeasurementUuids);
  touchedUuids.forEach((uuid) => {
    if (nextSelection.has(uuid)) {
      nextSelection.delete(uuid);
    } else {
      nextSelection.add(uuid);
    }
  });

  const primaryUuid =
    touchedUuids.find((uuid) => nextSelection.has(uuid)) ||
    [...nextSelection][nextSelection.size - 1];
  setMeasurementSelection([...nextSelection], { primaryUuid });
}

const MEASURE_COLUMNS_STORAGE_KEY = "petroImage.measureColumns";

function createMeasureGroupCellContent(result) {
  return createMeasureGroupColor(getMeasureGroupForResult(result));
}

function createMeasureTypeCellContent(result) {
  return createMeasureTypeIcon(result.type);
}

function createMeasureColumnTextCell(value, className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = value;
  return cell;
}

function getInvalidMeasurementText(result, value) {
  return result.validGeometry === false ? "--" : value;
}

function getLineLengthM(result) {
  return result?.type === "line" ? result.lengthM : null;
}

function getLongAxisM(result) {
  return result?.longAxisM ?? (result?.type !== "line" ? result?.lengthM : null);
}

function getShortAxisM(result) {
  return result?.shortAxisM ?? (result?.type !== "line" ? result?.widthM : null);
}

const MEASURE_COLUMN_DEFINITIONS = [
  {
    id: "group",
    label: "Group",
    csvHeader: "group",
    defaultTable: true,
    defaultCsv: true,
    cellClass: "measure-group-cell measure-sticky-group-cell",
    tableValue: createMeasureGroupCellContent,
    csvValue: (result) => result.groupName ?? "",
  },
  {
    id: "type",
    label: "Type",
    csvHeader: "type",
    defaultTable: true,
    defaultCsv: true,
    cellClass: "measure-type-cell",
    tableValue: createMeasureTypeCellContent,
    csvValue: (result) => result.type ?? "",
  },
  {
    id: "id",
    label: "ID",
    csvHeader: "id",
    defaultTable: false,
    defaultCsv: true,
    tableEligible: false,
    tableValue: (result) => result.id ?? "",
    csvValue: (result) => result.id ?? "",
  },
  {
    id: "source",
    label: "Source",
    csvHeader: "source",
    defaultTable: false,
    defaultCsv: true,
    tableEligible: false,
    tableValue: (result) => result.source ?? "",
    csvValue: (result) => result.source ?? "",
  },
  {
    id: "annotationLabel",
    label: "Annotation",
    csvHeader: "annotation_label",
    defaultTable: false,
    defaultCsv: true,
    tableEligible: false,
    tableValue: (result) => result.annotationLabel ?? "",
    csvValue: (result) => result.annotationLabel ?? "",
  },
  {
    id: "annotationUuid",
    label: "Annotation UUID",
    csvHeader: "annotation_uuid",
    defaultTable: false,
    defaultCsv: true,
    tableEligible: false,
    tableValue: (result) => result.annotationUuid ?? "",
    csvValue: (result) => result.annotationUuid ?? "",
  },
  {
    id: "groupColor",
    label: "Group Color",
    csvHeader: "group_color",
    defaultTable: false,
    defaultCsv: true,
    tableEligible: false,
    tableValue: (result) => result.groupColor ?? "",
    csvValue: (result) => result.groupColor ?? "",
  },
  {
    id: "lengthM",
    label: "Length",
    csvHeader: "length_m",
    unit: "linear",
    defaultTable: true,
    defaultCsv: true,
    tableValue: (result, units) =>
      formatMeasurementNumber(getLineLengthM(result), units.linear),
    csvValue: (result) => getLineLengthM(result) ?? "",
  },
  {
    id: "longAxisM",
    label: "Long axis",
    csvHeader: "long_axis_m",
    unit: "linear",
    defaultTable: true,
    defaultCsv: true,
    tableValue: (result, units) =>
      formatMeasurementNumber(getLongAxisM(result), units.linear),
    csvValue: (result) => getLongAxisM(result) ?? "",
  },
  {
    id: "shortAxisM",
    label: "Short axis",
    csvHeader: "short_axis_m",
    unit: "linear",
    defaultTable: true,
    defaultCsv: true,
    tableValue: (result, units) =>
      formatMeasurementNumber(getShortAxisM(result), units.linear),
    csvValue: (result) => getShortAxisM(result) ?? "",
  },
  {
    id: "maxFeretM",
    label: "Max Feret",
    csvHeader: "max_feret_m",
    unit: "linear",
    defaultTable: false,
    defaultCsv: true,
    tableValue: (result, units) =>
      formatMeasurementNumber(result.maxFeretM, units.linear),
    csvValue: (result) => result.maxFeretM ?? "",
  },
  {
    id: "minFeretM",
    label: "Min Feret",
    csvHeader: "min_feret_m",
    unit: "linear",
    defaultTable: false,
    defaultCsv: true,
    tableValue: (result, units) =>
      formatMeasurementNumber(result.minFeretM, units.linear),
    csvValue: (result) => result.minFeretM ?? "",
  },
  {
    id: "areaM2",
    label: "Area",
    csvHeader: "area_m2",
    unit: "area",
    defaultTable: true,
    defaultCsv: true,
    invalidAware: true,
    tableValue: (result, units) =>
      getInvalidMeasurementText(
        result,
        formatMeasurementNumber(result.areaM2, units.area)
      ),
    csvValue: (result) => result.areaM2 ?? "",
  },
  {
    id: "perimeterM",
    label: "Perimeter",
    csvHeader: "perimeter_m",
    unit: "linear",
    defaultTable: true,
    defaultCsv: true,
    tableValue: (result, units) =>
      formatMeasurementNumber(result.perimeterM, units.linear),
    csvValue: (result) => result.perimeterM ?? "",
  },
  {
    id: "ecdM",
    label: "ECD",
    csvHeader: "ecd_m",
    unit: "linear",
    defaultTable: true,
    defaultCsv: true,
    invalidAware: true,
    tableValue: (result, units) =>
      getInvalidMeasurementText(
        result,
        formatMeasurementNumber(result.ecdM, units.linear)
      ),
    csvValue: (result) => result.ecdM ?? "",
  },
  {
    id: "aspectRatio",
    label: "Short/Long",
    csvHeader: "aspect_ratio",
    defaultTable: true,
    defaultCsv: true,
    tableValue: (result) => formatPlainMeasurementNumber(result.aspectRatio, 2),
    csvValue: (result) => result.aspectRatio ?? "",
  },
  {
    id: "azimuthDeg",
    label: "Long axis azimuth",
    csvHeader: "long_axis_azimuth_deg",
    unit: "degrees",
    defaultTable: true,
    defaultCsv: true,
    tableValue: (result) => formatPlainMeasurementNumber(result.azimuthDeg, 1),
    csvValue: (result) => result.azimuthDeg ?? "",
  },
  {
    id: "solidity",
    label: "Solidity",
    csvHeader: "solidity",
    defaultTable: true,
    defaultCsv: true,
    tableValue: (result) => formatPlainMeasurementNumber(result.solidity, 2),
    csvValue: (result) => result.solidity ?? "",
  },
  {
    id: "circularity",
    label: "Circularity",
    csvHeader: "circularity",
    defaultTable: true,
    defaultCsv: true,
    tableValue: (result) => formatPlainMeasurementNumber(result.circularity, 2),
    csvValue: (result) => result.circularity ?? "",
  },
  {
    id: "validGeometry",
    label: "Valid Geometry",
    csvHeader: "valid_geometry",
    defaultTable: false,
    defaultCsv: true,
    tableValue: (result) =>
      result.validGeometry === undefined ? "" : String(result.validGeometry),
    csvValue: (result) =>
      result.validGeometry === undefined ? "" : String(result.validGeometry),
  },
  {
    id: "geometryWarning",
    label: "Warning",
    csvHeader: "geometry_warning",
    defaultTable: false,
    defaultCsv: true,
    tableEligible: false,
    tableValue: (result) => result.geometryWarning ?? "",
    csvValue: (result) => result.geometryWarning ?? "",
  },
  {
    id: "sample",
    label: "Sample",
    csvHeader: "sample",
    defaultTable: false,
    defaultCsv: true,
    tableEligible: false,
    tableValue: () => title(),
    csvValue: () => title(),
  },
];

function getMeasureNumericFilterParameters() {
  return [
    { id: "lengthM", label: "Length", unit: "linear" },
    { id: "longAxisM", label: "Long axis", unit: "linear" },
    { id: "shortAxisM", label: "Short axis", unit: "linear" },
    { id: "maxFeretM", label: "Max Feret", unit: "linear" },
    { id: "minFeretM", label: "Min Feret", unit: "linear" },
    { id: "areaM2", label: "Area", unit: "area" },
    { id: "perimeterM", label: "Perimeter", unit: "linear" },
    { id: "ecdM", label: "ECD", unit: "linear" },
    { id: "aspectRatio", label: "Short/Long", unit: "none" },
    { id: "azimuthDeg", label: "Long axis azimuth", unit: "degrees" },
    { id: "solidity", label: "Solidity", unit: "none" },
    { id: "circularity", label: "Circularity", unit: "none" },
  ];
}

let measureFilterState = {
  groupId: "",
  type: "",
  validity: "",
  parameterId: "",
  min: null,
  max: null,
  sortParameterId: "",
  sortDirection: "asc",
};
let measureHeaderMenuColumnId = null;
let measureHeaderMenuElement = null;

function getMeasureParameterById(parameterId) {
  return getMeasureNumericFilterParameters().find(
    (parameter) => parameter.id === parameterId
  );
}

function getMeasureDisplayParameterValue(result, parameter) {
  if (!parameter) return null;
  const rawValue =
    parameter.id === "lengthM"
      ? getLineLengthM(result)
      : parameter.id === "longAxisM"
        ? getLongAxisM(result)
        : parameter.id === "shortAxisM"
          ? getShortAxisM(result)
          : result?.[parameter.id];
  if (!Number.isFinite(rawValue)) return null;
  if (
    result.validGeometry === false &&
    (parameter.id === "areaM2" || parameter.id === "ecdM")
  ) {
    return null;
  }
  return rawValue * getMeasureHistogramUnitInfo(parameter).factor;
}

function getMeasureSortValue(result, parameterId) {
  if (parameterId === "group") return getMeasureGroupForResult(result).groupName || "";
  if (parameterId === "type") return result.typeLabel || result.type || "";
  if (parameterId === "id") return result.id || "";
  if (parameterId === "validGeometry") {
    return result.validGeometry === false ? "Invalid" : "Valid";
  }
  return getMeasureDisplayParameterValue(result, getMeasureParameterById(parameterId));
}

function compareMeasureResults(a, b, parameterId, direction = "asc") {
  const multiplier = direction === "desc" ? -1 : 1;
  const aValue = getMeasureSortValue(a, parameterId);
  const bValue = getMeasureSortValue(b, parameterId);
  const aMissing = aValue === null || aValue === undefined || aValue === "";
  const bMissing = bValue === null || bValue === undefined || bValue === "";
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (typeof aValue === "number" && typeof bValue === "number") {
    return (aValue - bValue) * multiplier;
  }
  return String(aValue).localeCompare(String(bValue), undefined, {
    numeric: true,
    sensitivity: "base",
  }) * multiplier;
}

function getMeasureFilterState() {
  return measureFilterState;
}

function measureResultPassesFilters(result, state = getMeasureFilterState()) {
  if (state.groupId && result.groupId !== state.groupId) return false;
  if (state.type && result.type !== state.type) return false;
  if (state.validity === "valid" && result.validGeometry === false) return false;
  if (state.validity === "invalid" && result.validGeometry !== false) return false;

  if (state.parameterId && (state.min !== null || state.max !== null)) {
    const value = getMeasureDisplayParameterValue(
      result,
      getMeasureParameterById(state.parameterId)
    );
    if (!Number.isFinite(value)) return false;
    if (state.min !== null && value < state.min) return false;
    if (state.max !== null && value > state.max) return false;
  }

  return true;
}

function getFilteredMeasureResults() {
  const state = getMeasureFilterState();
  return measureResults.filter((result) => measureResultPassesFilters(result, state));
}

function hasFilteredMeasureResults() {
  return getFilteredMeasureResults().length > 0;
}

function getDisplayedMeasureResults() {
  const state = getMeasureFilterState();
  const results = measureResults.filter((result) =>
    measureResultPassesFilters(result, state)
  );
  if (state.sortParameterId) {
    results.sort((a, b) =>
      compareMeasureResults(a, b, state.sortParameterId, state.sortDirection)
    );
  }
  return results;
}

function setSelectOptions(select, options, value) {
  if (!select) return;
  select.innerHTML = "";
  options.forEach((option) => {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    select.appendChild(element);
  });
  select.value = options.some((option) => option.value === value)
    ? value
    : options[0]?.value || "";
}

function resetMeasureFilters() {
  measureFilterState = {
    groupId: "",
    type: "",
    validity: "",
    parameterId: "",
    min: null,
    max: null,
    sortParameterId: "",
    sortDirection: "asc",
  };
  closeMeasureHeaderMenu();
  renderMeasureResults();
}

let measureColumnState = loadMeasureColumnState();

function getDefaultMeasureColumnState() {
  return Object.fromEntries(
    MEASURE_COLUMN_DEFINITIONS.map((column) => [
      column.id,
      {
        table: column.defaultTable,
        csv: column.defaultCsv,
      },
    ])
  );
}

function normalizeMeasureColumnState(state = {}) {
  const defaults = getDefaultMeasureColumnState();
  MEASURE_COLUMN_DEFINITIONS.forEach((column) => {
    const saved = state[column.id] || {};
    defaults[column.id] = {
      table:
        column.tableEligible === false
          ? false
          : typeof saved.table === "boolean"
            ? saved.table
            : defaults[column.id].table,
      csv:
        typeof saved.csv === "boolean"
          ? saved.csv
          : defaults[column.id].csv,
    };
  });
  return defaults;
}

function loadMeasureColumnState() {
  try {
    return normalizeMeasureColumnState(
      JSON.parse(localStorage.getItem(MEASURE_COLUMNS_STORAGE_KEY) || "{}")
    );
  } catch (error) {
    console.warn("Could not load measurement column settings:", error);
    return getDefaultMeasureColumnState();
  }
}

function saveMeasureColumnState() {
  try {
    localStorage.setItem(
      MEASURE_COLUMNS_STORAGE_KEY,
      JSON.stringify(measureColumnState)
    );
  } catch (error) {
    console.warn("Could not save measurement column settings:", error);
  }
}

function getVisibleMeasureTableColumns() {
  const columns = MEASURE_COLUMN_DEFINITIONS.filter(
    (column) =>
      column.tableEligible !== false && measureColumnState[column.id]?.table
  );
  return columns.length > 0 ? columns : [MEASURE_COLUMN_DEFINITIONS[0]];
}

function getVisibleMeasureCsvColumns() {
  const columns = MEASURE_COLUMN_DEFINITIONS.filter(
    (column) => measureColumnState[column.id]?.csv
  );
  return columns.length > 0 ? columns : [MEASURE_COLUMN_DEFINITIONS[0]];
}

function getMeasureColumnUnits() {
  return {
    linear: getLinearUnitInfo(),
    area: getAreaUnitInfo(),
  };
}

function getMeasureColumnHeader(column, units) {
  if (column.id === "group") return "";
  if (column.id === "azimuthDeg") return "Long axis<br>azimuth (°)";
  if (column.unit === "linear") return `${column.label}<br>(${units.linear.label})`;
  if (column.unit === "area") return `${column.label}<br>(${units.area.label})`;
  if (column.unit === "degrees") return `${column.label}<br>(°)`;
  return column.label;
}

function getMeasureColumnSortLabel(column, direction) {
  const parameter = getMeasureParameterById(column.id);
  if (parameter) {
    return direction === "asc" ? "Sort smallest first" : "Sort largest first";
  }
  return direction === "asc" ? "Sort A to Z" : "Sort Z to A";
}

function getMeasureColumnFilterValue(columnId) {
  if (columnId === "group") return measureFilterState.groupId;
  if (columnId === "type") return measureFilterState.type;
  if (columnId === "validGeometry") return measureFilterState.validity;
  if (measureFilterState.parameterId === columnId) {
    return measureFilterState.min !== null || measureFilterState.max !== null;
  }
  return "";
}

function isMeasureColumnFiltered(columnId) {
  return Boolean(getMeasureColumnFilterValue(columnId));
}

function isMeasureColumnSorted(columnId) {
  return measureFilterState.sortParameterId === columnId;
}

function isMeasureColumnMenuActive(columnId) {
  return (
    measureHeaderMenuColumnId === columnId ||
    isMeasureColumnFiltered(columnId) ||
    isMeasureColumnSorted(columnId)
  );
}

function ensureMeasureHeaderMenu() {
  if (measureHeaderMenuElement) return measureHeaderMenuElement;
  measureHeaderMenuElement = document.createElement("div");
  measureHeaderMenuElement.className = "measure-header-menu";
  measureHeaderMenuElement.hidden = true;
  measureHeaderMenuElement.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  document.body.appendChild(measureHeaderMenuElement);
  return measureHeaderMenuElement;
}

function closeMeasureHeaderMenu() {
  if (!measureHeaderMenuElement) return;
  measureHeaderMenuElement.hidden = true;
  measureHeaderMenuColumnId = null;
  document
    .querySelectorAll(".measure-sortable-header[aria-expanded='true']")
    .forEach((header) => header.setAttribute("aria-expanded", "false"));
}

function closeMeasureHelpDialog() {
  if (!measureHelpDialog) return;
  measureHelpDialog.hidden = true;
  measureHelpButton?.setAttribute("aria-expanded", "false");
}

function openMeasureHelpDialog(button = measureHelpButton) {
  if (!measureHelpDialog || !button) return;
  if (measureHelpDialog.parentElement !== document.body) {
    document.body.appendChild(measureHelpDialog);
  }
  closeMeasureHeaderMenu();
  closeMeasureScaleAuditPopover();
  closeMeasureColumnsMenu();
  closeMeasureHistogramMenu();
  closeMeasureScatterMenu();
  closeMeasureRoseMenu();
  closeMeasureParticleSizeMenu();
  measureHelpDialog.hidden = false;
  measureHelpButton?.setAttribute("aria-expanded", "true");
  const buttonRect = button.getBoundingClientRect();
  const dialogRect = measureHelpDialog.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(
    Math.max(buttonRect.right - dialogRect.width, margin),
    window.innerWidth - dialogRect.width - margin
  );
  const top = Math.min(
    Math.max(buttonRect.bottom + 4, margin),
    window.innerHeight - dialogRect.height - margin
  );
  measureHelpDialog.style.left = `${Math.max(margin, left)}px`;
  measureHelpDialog.style.top = `${Math.max(margin, top)}px`;
}

function toggleMeasureHelpDialog(button = measureHelpButton) {
  if (!measureHelpDialog || measureHelpDialog.hidden) {
    openMeasureHelpDialog(button);
  } else {
    closeMeasureHelpDialog();
  }
}

function applyMeasureSort(columnId, direction) {
  measureFilterState = {
    ...measureFilterState,
    sortParameterId: columnId,
    sortDirection: direction,
  };
  closeMeasureHeaderMenu();
  renderMeasureResults();
}

function clearMeasureSort() {
  measureFilterState = {
    ...measureFilterState,
    sortParameterId: "",
    sortDirection: "asc",
  };
  closeMeasureHeaderMenu();
  renderMeasureResults();
}

function clearMeasureColumnFilter(columnId) {
  if (columnId === "group") {
    measureFilterState = { ...measureFilterState, groupId: "" };
  } else if (columnId === "type") {
    measureFilterState = { ...measureFilterState, type: "" };
  } else if (columnId === "validGeometry") {
    measureFilterState = { ...measureFilterState, validity: "" };
  } else if (measureFilterState.parameterId === columnId) {
    measureFilterState = {
      ...measureFilterState,
      parameterId: "",
      min: null,
      max: null,
    };
  }
}

function appendMeasureHeaderMenuButton(menu, label, handler, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (options.disabled) button.disabled = true;
  button.addEventListener("click", handler);
  menu.appendChild(button);
  return button;
}

function appendMeasureHeaderMenuSeparator(menu) {
  const separator = document.createElement("div");
  separator.className = "measure-header-menu-separator";
  menu.appendChild(separator);
}

function appendMeasureHeaderSelect(menu, label, options, value, onChange) {
  const wrapper = document.createElement("label");
  wrapper.className = "measure-header-menu-field";
  const text = document.createElement("span");
  text.textContent = label;
  const select = document.createElement("select");
  setSelectOptions(select, options, value);
  select.addEventListener("change", () => onChange(select.value));
  wrapper.append(text, select);
  menu.appendChild(wrapper);
}

function appendMeasureHeaderNumericFilter(menu, column) {
  const current = measureFilterState.parameterId === column.id ? measureFilterState : {};
  const minInput = document.createElement("input");
  minInput.type = "number";
  minInput.step = "any";
  minInput.placeholder = "Min";
  minInput.value = current.min ?? "";

  const maxInput = document.createElement("input");
  maxInput.type = "number";
  maxInput.step = "any";
  maxInput.placeholder = "Max";
  maxInput.value = current.max ?? "";

  const fields = document.createElement("div");
  fields.className = "measure-header-menu-range";
  fields.append(minInput, maxInput);
  menu.appendChild(fields);

  appendMeasureHeaderMenuButton(menu, "Apply range", () => {
    const min = minInput.value.trim() === "" ? null : Number(minInput.value);
    const max = maxInput.value.trim() === "" ? null : Number(maxInput.value);
    if (
      (min !== null && !Number.isFinite(min)) ||
      (max !== null && !Number.isFinite(max))
    ) {
      alert("Enter valid numeric filter values.");
      return;
    }
    measureFilterState = {
      ...measureFilterState,
      parameterId: min === null && max === null ? "" : column.id,
      min,
      max,
    };
    closeMeasureHeaderMenu();
    renderMeasureResults();
  });
}

function renderMeasureHeaderMenu(column) {
  const menu = ensureMeasureHeaderMenu();
  menu.innerHTML = "";

  appendMeasureHeaderMenuButton(menu, getMeasureColumnSortLabel(column, "asc"), () =>
    applyMeasureSort(column.id, "asc")
  );
  appendMeasureHeaderMenuButton(menu, getMeasureColumnSortLabel(column, "desc"), () =>
    applyMeasureSort(column.id, "desc")
  );
  appendMeasureHeaderMenuButton(menu, "Clear sort", clearMeasureSort, {
    disabled: !isMeasureColumnSorted(column.id),
  });

  appendMeasureHeaderMenuSeparator(menu);

  if (column.id === "group") {
    appendMeasureHeaderSelect(
      menu,
      "Group",
      [
        { value: "", label: "All" },
        ...measureGroups
          .map((group) => ({ value: group.groupId, label: group.groupName }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      ],
      measureFilterState.groupId,
      (value) => {
        measureFilterState = { ...measureFilterState, groupId: value };
        closeMeasureHeaderMenu();
        renderMeasureResults();
      }
    );
  } else if (column.id === "type") {
    appendMeasureHeaderSelect(
      menu,
      "Type",
      [
        { value: "", label: "All" },
        { value: "line", label: "Line" },
        { value: "polygon", label: "Polygon" },
        { value: "rectangle", label: "Rectangle" },
        { value: "ellipse", label: "Ellipse" },
        { value: "circle", label: "Circle" },
        { value: "point", label: "Point" },
      ],
      measureFilterState.type,
      (value) => {
        measureFilterState = { ...measureFilterState, type: value };
        closeMeasureHeaderMenu();
        renderMeasureResults();
      }
    );
  } else if (column.id === "validGeometry") {
    appendMeasureHeaderSelect(
      menu,
      "Valid",
      [
        { value: "", label: "All" },
        { value: "valid", label: "Valid" },
        { value: "invalid", label: "Invalid" },
      ],
      measureFilterState.validity,
      (value) => {
        measureFilterState = { ...measureFilterState, validity: value };
        closeMeasureHeaderMenu();
        renderMeasureResults();
      }
    );
  } else if (getMeasureParameterById(column.id)) {
    appendMeasureHeaderNumericFilter(menu, column);
  } else {
    const message = document.createElement("div");
    message.className = "measure-header-menu-note";
    message.textContent = "No filter for this column";
    menu.appendChild(message);
  }

  appendMeasureHeaderMenuSeparator(menu);
  appendMeasureHeaderMenuButton(
    menu,
    "Clear this filter",
    () => {
      clearMeasureColumnFilter(column.id);
      closeMeasureHeaderMenu();
      renderMeasureResults();
    },
    { disabled: !isMeasureColumnFiltered(column.id) }
  );
  appendMeasureHeaderMenuButton(menu, "Clear all", resetMeasureFilters, {
    disabled:
      !measureFilterState.groupId &&
      !measureFilterState.type &&
      !measureFilterState.validity &&
      !measureFilterState.parameterId &&
      !measureFilterState.sortParameterId,
  });
}

function openMeasureHeaderMenu(column, header) {
  if (!header) return;
  if (measureHeaderMenuColumnId === column.id && !measureHeaderMenuElement?.hidden) {
    closeMeasureHeaderMenu();
    return;
  }
  closeMeasureColumnsMenu();
  closeMeasureHistogramMenu();
  closeMeasureScatterMenu();
  closeMeasureRoseMenu();
  closeMeasureParticleSizeMenu();
  closeMeasureHeaderMenu();
  renderMeasureHeaderMenu(column);
  const menu = ensureMeasureHeaderMenu();
  measureHeaderMenuColumnId = column.id;
  header.setAttribute("aria-expanded", "true");
  menu.hidden = false;

  const buttonRect = header.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(
    Math.max(buttonRect.right - menuRect.width, margin),
    window.innerWidth - menuRect.width - margin
  );
  const top = Math.min(
    buttonRect.bottom + 4,
    window.innerHeight - menuRect.height - margin
  );
  menu.style.left = `${Math.max(margin, left)}px`;
  menu.style.top = `${Math.max(margin, top)}px`;
}

function renderMeasureTableHeader(columns, units) {
  if (!measureResultsHeader) return;
  measureResultsHeader.innerHTML = "";
  columns.forEach((column) => {
    const th = document.createElement("th");
    const label = document.createElement("span");
    label.className = "measure-header-label";
    label.innerHTML = getMeasureColumnHeader(column, units);
    th.appendChild(label);
    th.classList.add("measure-sortable-header");
    th.tabIndex = 0;
    th.title = `${column.label} sort and filter`;
    th.setAttribute("aria-expanded", "false");
    th.classList.toggle("active", isMeasureColumnMenuActive(column.id));
    th.addEventListener("click", (event) => {
      event.stopPropagation();
      openMeasureHeaderMenu(column, event.currentTarget);
    });
    th.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      openMeasureHeaderMenu(column, event.currentTarget);
    });
    if (column.id === "group") {
      th.className = "measure-sticky-header-cell";
    }
    if (column.id === "group" || column.id === "type") {
      th.setAttribute("aria-label", column.label);
    }
    measureResultsHeader.appendChild(th);
  });
}

function renderMeasureColumnsMenu() {
  if (!measureColumnsList) return;
  measureColumnsList.innerHTML = "";
  MEASURE_COLUMN_DEFINITIONS.forEach((column) => {
    const row = document.createElement("label");
    row.className = "measure-columns-row";

    const name = document.createElement("span");
    name.textContent = column.label;

    let tableControl;
    if (column.tableEligible === false) {
      tableControl = document.createElement("span");
      tableControl.className = "measure-columns-unavailable";
      tableControl.textContent = "—";
    } else {
      tableControl = document.createElement("input");
      tableControl.type = "checkbox";
      tableControl.checked = Boolean(measureColumnState[column.id]?.table);
      tableControl.addEventListener("change", () => {
        measureColumnState[column.id].table = tableControl.checked;
        saveMeasureColumnState();
        renderMeasureResults();
      });
    }

    const csvCheckbox = document.createElement("input");
    csvCheckbox.type = "checkbox";
    csvCheckbox.checked = Boolean(measureColumnState[column.id]?.csv);
    csvCheckbox.addEventListener("change", () => {
      measureColumnState[column.id].csv = csvCheckbox.checked;
      saveMeasureColumnState();
    });

    row.append(name, tableControl, csvCheckbox);
    measureColumnsList.appendChild(row);
  });
}

function closeMeasureColumnsMenu() {
  const menu = document.getElementById("measureColumnsMenu");
  if (!menu) return;
  menu.hidden = true;
  document
    .getElementById("measureColumnsButton")
    ?.setAttribute("aria-expanded", "false");
}

function openMeasureColumnsMenu(button) {
  if (!measureColumnsMenu || !button) return;
  if (measureColumnsMenu.parentElement !== document.body) {
    document.body.appendChild(measureColumnsMenu);
  }
  renderMeasureColumnsMenu();
  measureColumnsMenu.hidden = false;
  measureColumnsButton?.setAttribute("aria-expanded", "true");

  const buttonRect = button.getBoundingClientRect();
  const menuRect = measureColumnsMenu.getBoundingClientRect();
  const margin = 8;
  const maxLeft = window.innerWidth - menuRect.width - margin;
  const left = Math.min(
    Math.max(buttonRect.right - menuRect.width, margin),
    maxLeft
  );
  const spaceAbove = buttonRect.top - margin;
  const opensUp = spaceAbove >= menuRect.height;
  const top = opensUp
    ? buttonRect.top - menuRect.height - 4
    : Math.min(
        buttonRect.bottom + 4,
        window.innerHeight - menuRect.height - margin
      );

  measureColumnsMenu.style.left = `${left}px`;
  measureColumnsMenu.style.top = `${Math.max(margin, top)}px`;
}

function renderMeasureResults() {
  if (!measureResultsBody) return;
  const units = getMeasureColumnUnits();
  const visibleColumns = getVisibleMeasureTableColumns();
  updateMeasureScaleAudit();
  renderMeasureGroupOptions();
  renderMeasureTableHeader(visibleColumns, units);
  renderMeasureColumnsMenu();
  const displayedResults = getDisplayedMeasureResults();
  if (measureResultsTable) {
    measureResultsTable.style.minWidth = `${Math.max(
      240,
      visibleColumns.length * 62
    )}px`;
  }
  measureResultsBody.innerHTML = "";

  if (measureResults.length === 0 || displayedResults.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = visibleColumns.length;
    cell.className = "measure-results-empty";
    cell.textContent =
      measureResults.length === 0 ? "No results" : "No measurements match filters";
    row.appendChild(cell);
    measureResultsBody.appendChild(row);
    updateMeasurementSummaryFields(displayedResults[displayedResults.length - 1] || null);
    updateDeleteMeasurementButton();
    updateMeasureHistogramAvailability();
    renderMeasureHistogramMenu();
    updateMeasureScatterAvailability();
    renderMeasureScatterMenu();
    updateMeasureRoseAvailability();
    renderMeasureRoseMenu();
    updateMeasureParticleSizeAvailability();
    renderMeasureParticleSizeMenu();
    return;
  }

  displayedResults.forEach((result) => {
    const row = document.createElement("tr");
    row.dataset.measurementUuid = result.measurementUuid || "";
    if (result.measurementUuid) row.tabIndex = 0;
    row.classList.toggle(
      "measure-result-row-selected",
      selectedMeasurementUuids.has(result.measurementUuid)
    );
    row.addEventListener("click", (event) => {
      event.stopPropagation();
      handleMeasureResultRowClick(event, result.measurementUuid);
    });
    row.addEventListener("contextmenu", (event) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
      }
    });
    row.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      selectAdjacentMeasurementRow(
        result.measurementUuid,
        event.key === "ArrowDown" ? 1 : -1
      );
    });

    visibleColumns.forEach((column) => {
      const cell = document.createElement("td");
      if (column.cellClass) cell.className = column.cellClass;
      const value = column.tableValue(result, units);
      if (value instanceof Node) {
        cell.appendChild(value);
      } else {
        cell.textContent = value;
      }
      if (column.invalidAware && result.validGeometry === false) {
        cell.title = result.geometryWarning || "Invalid geometry";
        cell.classList.add("measure-invalid-area");
      }
      row.appendChild(cell);
    });
    measureResultsBody.appendChild(row);
  });
  updateMeasurementSummaryFields(displayedResults[displayedResults.length - 1]);
  updateDeleteMeasurementButton();
  updateMeasureHistogramAvailability();
  renderMeasureHistogramMenu();
  updateMeasureScatterAvailability();
  renderMeasureScatterMenu();
  updateMeasureRoseAvailability();
  renderMeasureRoseMenu();
  updateMeasureParticleSizeAvailability();
  renderMeasureParticleSizeMenu();
}

function addMeasureFeature(
  type,
  coordinates,
  source = "manual",
  sourceFeature = null,
  options = {}
) {
  const normalizedCoordinates =
    type === "line"
      ? getCoordinatesWithoutTrailingDuplicate(coordinates)
      : closeCoordinates(coordinates);
  const measurement = calculateMeasurementProperties(type, normalizedCoordinates);
  const id = options.id || getNextMeasurementId(source);
  const style = getMeasureStyle();
  const measurementUuid = generateUniqueId(16);
  const group =
    source === "annotation"
      ? getMeasureGroupForAnnotation(sourceFeature)
      : getActiveMeasureGroup();
  const properties = {
    uuid: measurementUuid,
    label: id,
    shapeType: type,
    source,
    lineStyle: style.lineStyle,
    lineWeight: style.lineWeight,
    lineColor: style.lineColor,
    lineOpacity: style.lineOpacity,
    fillColor: style.fillColor,
    fillOpacity: type === "line" ? 0 : style.fillOpacity,
    groupId: group.groupId,
    groupName: group.groupName,
    groupColor: group.groupColor,
    valid_geometry: measurement.validGeometry,
    geometry_warning: measurement.geometryWarning,
    length_m: measurement.lengthM,
    ecd_m: measurement.ecdM,
    long_axis_m: measurement.longAxisM,
    short_axis_m: measurement.shortAxisM,
    max_feret_m: measurement.maxFeretM,
    min_feret_m: measurement.minFeretM,
    max_feret_azimuth_deg: measurement.maxFeretAzimuthDeg,
    width_m: measurement.widthM,
    aspect_ratio: measurement.aspectRatio,
    long_axis_azimuth_deg: measurement.azimuthDeg,
    azimuth_deg: measurement.azimuthDeg,
    solidity: measurement.solidity,
    circularity: measurement.circularity,
  };

  if (type === "line") {
    addPolylineToGeoJSON(measureJSON, normalizedCoordinates, properties);
  } else {
    addPolygonToGeoJSON(measureJSON, normalizedCoordinates, properties);
  }

  measureResults.push({
    id,
    measurementUuid,
    source,
    annotationUuid: sourceFeature?.properties?.uuid || "",
    annotationLabel: sourceFeature?.properties?.label || "",
    groupId: group.groupId,
    groupName: group.groupName,
    groupColor: group.groupColor,
    type,
    typeLabel: MEASURE_TOOL_LABELS[type] || type,
    ...measurement,
  });
  selectedMeasurementUuids = new Set([measurementUuid]);
  if (!options.deferRender) {
    renderMeasureResults();
    drawShape(measureCanvas, [measureJSON, measureAreaJSONTemp, measureJSONTemp]);
  }
  return measurementUuid;
}

function addMeasureGeometry(
  type,
  geometry,
  source = "annotation",
  sourceFeature = null,
  options = {}
) {
  const measurement = calculateGeometryMeasurementProperties(type, geometry);
  const id = options.id || getNextMeasurementId(source);
  const style = getMeasureStyle();
  const measurementUuid = generateUniqueId(16);
  const group =
    source === "annotation"
      ? getMeasureGroupForAnnotation(sourceFeature)
      : getActiveMeasureGroup();
  const properties = {
    uuid: measurementUuid,
    label: id,
    shapeType: type,
    source,
    lineStyle: style.lineStyle,
    lineWeight: style.lineWeight,
    lineColor: style.lineColor,
    lineOpacity: style.lineOpacity,
    fillColor: style.fillColor,
    fillOpacity: type === "line" ? 0 : style.fillOpacity,
    groupId: group.groupId,
    groupName: group.groupName,
    groupColor: group.groupColor,
    valid_geometry: measurement.validGeometry,
    geometry_warning: measurement.geometryWarning,
    length_m: measurement.lengthM,
    ecd_m: measurement.ecdM,
    long_axis_m: measurement.longAxisM,
    short_axis_m: measurement.shortAxisM,
    max_feret_m: measurement.maxFeretM,
    min_feret_m: measurement.minFeretM,
    max_feret_azimuth_deg: measurement.maxFeretAzimuthDeg,
    width_m: measurement.widthM,
    aspect_ratio: measurement.aspectRatio,
    long_axis_azimuth_deg: measurement.azimuthDeg,
    azimuth_deg: measurement.azimuthDeg,
    solidity: measurement.solidity,
    circularity: measurement.circularity,
  };

  measureJSON.features.push({
    type: "Feature",
    geometry: cloneData(geometry),
    properties,
  });

  measureResults.push({
    id,
    measurementUuid,
    source,
    annotationUuid: sourceFeature?.properties?.uuid || "",
    annotationLabel: sourceFeature?.properties?.label || "",
    groupId: group.groupId,
    groupName: group.groupName,
    groupColor: group.groupColor,
    type,
    typeLabel: MEASURE_TOOL_LABELS[type] || type,
    ...measurement,
  });
  selectedMeasurementUuids = new Set([measurementUuid]);
  if (!options.deferRender) {
    renderMeasureResults();
    drawShape(measureCanvas, [measureJSON, measureAreaJSONTemp, measureJSONTemp]);
  }
  return measurementUuid;
}

function previewMeasureFeature(type, coordinates) {
  measureJSONTemp = {
    type: "FeatureCollection",
    features: [],
  };
  measureAreaJSONTemp = {
    type: "FeatureCollection",
    features: [],
  };

  const style = getMeasureStyle();
  if (type === "line") {
    addPolylineToGeoJSON(measureJSONTemp, coordinates, style);
  } else {
    addPolygonToGeoJSON(measureAreaJSONTemp, closeCoordinates(coordinates), {
      ...style,
      lineStyle: type === "polygon" ? "dashed" : style.lineStyle,
    });
  }

  const measurement = calculateMeasurementProperties(type, coordinates);
  updateMeasurementSummaryFields(measurement);
  drawShape(measureCanvas, [measureJSON, measureAreaJSONTemp, measureJSONTemp]);
  return measurement;
}

function clearMeasurePreview() {
  measureJSONTemp = {
    type: "FeatureCollection",
    features: [],
  };
  measureAreaJSONTemp = {
    type: "FeatureCollection",
    features: [],
  };
}

function refreshMeasureDrawingPreview(event) {
  if (
    !measurementModeActive ||
    !hasKnownScale() ||
    !["line", "polygon"].includes(activeMeasureTool) ||
    measureImageCoordinates.length === 0
  ) {
    hideMeasureLiveReadout();
    return;
  }

  const imagePoint = getImagePointFromMeasureMouseEvent(event);
  if (!imagePoint) return;
  const coordinates = [...measureImageCoordinates, imagePoint];
  const measurement = previewMeasureFeature(activeMeasureTool, coordinates);
  updateMeasureLiveReadout(event, activeMeasureTool, measurement);
}

function setActiveMeasureTool(tool) {
  if (activeMeasureTool === tool && measurementModeActive) {
    stopMeasurementMode();
    drawShape(measureCanvas, [measureJSON, measureAreaJSONTemp, measureJSONTemp]);
    return;
  }

  activeMeasureTool = tool;
  measurementModeActive = true;
  const showMeasure = document.getElementById("show-measure");
  if (showMeasure) {
    showMeasure.checked = true;
    if (measureCanvas) measureCanvas.style.display = "block";
  }
  [...document.querySelectorAll("[data-measure-tool]")].forEach((button) => {
    button.classList.toggle("active", button.dataset.measureTool === tool);
  });
  measureImageCoordinates = [];
  clearMeasurePreview();
  hideMeasureLiveReadout();
  updateMeasureValueControls();
  refreshAnnotationFloaters();
  drawShape(measureCanvas, [measureJSON, measureAreaJSONTemp, measureJSONTemp]);
}

function updateMeasureValueControls() {
  [...document.querySelectorAll("[data-measure-tool]")].forEach((button) => {
    button.classList.toggle(
      "active",
      measurementModeActive && button.dataset.measureTool === activeMeasureTool
    );
  });
}

measureToolButtons?.addEventListener("click", function (event) {
  const button = event.target.closest("[data-measure-tool]");
  if (!button) return;
  setActiveMeasureTool(button.dataset.measureTool);
});

function finishClickMeasurement() {
  let completed = false;
  if (activeMeasureTool === "line" && measureImageCoordinates.length >= 2) {
    addMeasureFeature("line", measureImageCoordinates);
    completed = true;
  } else if (
    activeMeasureTool === "polygon" &&
    measureImageCoordinates.length >= 3
  ) {
    addMeasureFeature("polygon", measureImageCoordinates);
    completed = true;
  }
  measureImageCoordinates = [];
  clearMeasurePreview();
  hideMeasureLiveReadout();
  if (completed) {
    stopMeasurementMode();
  }
  drawShape(measureCanvas, [measureJSON, measureAreaJSONTemp, measureJSONTemp]);
}

function handleMeasurementSelectionClick(viewerPoint, originalEvent = null) {
  if (!hasKnownScale()) return false;
  if (measurementModeActive || isAnnotationDrawingActive()) return false;
  const showMeasure = document.getElementById("show-measure");
  if (showMeasure && !showMeasure.checked) {
    if (selectedMeasurementUuids.size > 0) {
      selectMeasurement(null);
      return true;
    }
    return false;
  }

  const uuid = findMeasurementUuidAtViewerPoint(viewerPoint, {
    lineTolerance: 14,
  });
  if (uuid) {
    selectMeasurement(uuid, {
      toggle: originalEvent?.ctrlKey || originalEvent?.metaKey,
    });
    return true;
  }

  if (selectedMeasurementUuids.size > 0) {
    selectMeasurement(null);
    return true;
  }

  return false;
}

viewer.addHandler("canvas-click", function (event) {
  if (scaleWizardState.active) return;
  if (!hasKnownScale()) {
    return;
  }
  if (measurementModeActive) {
    if (!["line", "polygon"].includes(activeMeasureTool)) return;

    event.preventDefaultAction = true;
    const imagePoint = getImagePointFromMeasureEventPosition(event.position);
    if (!imagePoint) return;
    measureImageCoordinates.push(imagePoint);

    if (activeMeasureTool === "line" && measureImageCoordinates.length >= 2) {
      previewMeasureFeature("line", measureImageCoordinates);
    } else if (
      activeMeasureTool === "polygon" &&
      measureImageCoordinates.length >= 2
    ) {
      previewMeasureFeature("polygon", measureImageCoordinates);
    }
    return;
  }

  if (isAnnotationDrawingActive() || event.quick === false) return;

  if (handleMeasurementSelectionClick(event.position, event.originalEvent)) {
    event.preventDefaultAction = true;
  }
});

viewerContainer.addEventListener("click", function (event) {
  if (scaleWizardState.active || event.defaultPrevented) return;
  if (measurementModeActive || isAnnotationDrawingActive()) return;
  if (isTextEntryElement(event.target)) return;
  if (event.target.closest("button, input, select, textarea, [role='menu']")) {
    return;
  }

  const rect = viewerContainer.getBoundingClientRect();
  const viewerPoint = new OpenSeadragon.Point(
    event.clientX - rect.left,
    event.clientY - rect.top
  );
  if (handleMeasurementSelectionClick(viewerPoint, event)) {
    event.preventDefault();
  }
});

viewerContainer.addEventListener("mousemove", refreshMeasureDrawingPreview);

viewer.addHandler("canvas-double-click", function (event) {
  if (!measurementModeActive || !["line", "polygon"].includes(activeMeasureTool)) {
    return;
  }
  event.preventDefaultAction = true;
  finishClickMeasurement();
});

document.addEventListener(
  "keydown",
  function (event) {
    if (event.key !== "Escape" || !measurementModeActive) return;
    event.preventDefault();
    event.stopPropagation();
    stopMeasurementMode();
    drawShape(measureCanvas, [measureJSON, measureAreaJSONTemp, measureJSONTemp]);
  },
  true
);

function resetMeasurements(hardReset = false) {
	  if (hardReset) {
    stopMeasurementMode();
  }

  measureImageCoordinates = [];
  clearMeasurePreview();
  hideMeasureLiveReadout();
  drawShape(measureCanvas, [measureJSON, measureAreaJSONTemp, measureJSONTemp]);
  if (hardReset) {
    measureJSON = {
      type: "FeatureCollection",
      features: [],
    };
    measureResults = [];
    selectedMeasurementUuids = new Set();
    measurementSelectionAnchorUuid = null;
    measureHistogramSelectedGroupIds = new Set();
    measureHistogramKnownGroupIds = new Set();
    measureScatterSelectedGroupIds = new Set();
    measureScatterKnownGroupIds = new Set();
    measureScatterRangeEdited = false;
    measureRoseSelectedGroupIds = new Set();
    measureRoseKnownGroupIds = new Set();
    measureParticleSizeSelectedGroupIds = new Set();
    measureParticleSizeKnownGroupIds = new Set();
    measureParticleSizeRangeEdited = false;
    activeMeasureGroupId = DEFAULT_MEASURE_GROUP.groupId;
    measureGroups = [{ ...DEFAULT_MEASURE_GROUP }];
    distanceElement.value = 0;
    areaElement.value = 0;
    if (ECDElement) ECDElement.value = 0;
    renderMeasureResults();
    drawShape(measureCanvas, [measureJSON, measureAreaJSONTemp, measureJSONTemp]);
  }
}

document.getElementById("areaUnits").addEventListener("change", renderMeasureResults);
document
  .getElementById("distanceUnits")
  .addEventListener("change", renderMeasureResults);
document.getElementById("ECDUnits")?.addEventListener("change", renderMeasureResults);
updateMeasureValueControls();

function getMeasurementTypeForAnnotation(feature) {
  const geometryType = feature?.geometry?.type;
  const shapeType = String(feature?.properties?.shapeType || "").toLowerCase();
  if (shapeType === "rectangle") return "rectangle";
  if (shapeType === "circle") return "circle";
  if (shapeType === "ellipse") return "ellipse";
  if (shapeType === "polygon") return "polygon";
  if (shapeType === "line" || shapeType === "polyline") return "line";
  if (geometryType === "LineString" && isClosedCoordinateRing(feature.geometry.coordinates)) {
    return "polygon";
  }
  if (geometryType === "LineString" || geometryType === "MultiLineString") {
    return "line";
  }
  if (geometryType === "Polygon" || geometryType === "MultiPolygon") {
    return "polygon";
  }
  return geometryType === "Point" || geometryType === "MultiPoint" ? "point" : "";
}

function isClosedCoordinateRing(coordinates) {
  return (
    Array.isArray(coordinates) &&
    coordinates.length >= 4 &&
    coordinatesMatch(coordinates[0], coordinates[coordinates.length - 1])
  );
}

function getAnnotationMeasurementCoordinates(feature, measurementType = "") {
  const { type, coordinates } = feature.geometry;
  if (type === "LineString") return coordinates;
  if (type === "Polygon") return coordinates[0] || [];
  if (type === "MultiLineString") {
    if (measurementType === "polygon") {
      return coordinates.find((line) => isClosedCoordinateRing(line)) || coordinates[0] || [];
    }
    return coordinates.flat();
  }
  if (type === "MultiPolygon") return coordinates[0]?.[0] || [];
  return [];
}

function getAnnotationMeasurementGeometry(feature, measurementType = "") {
  if (!feature?.geometry) return null;
  const { type, coordinates } = feature.geometry;

  if (measurementType === "line") {
    if (type === "LineString" || type === "MultiLineString") {
      return cloneData(feature.geometry);
    }
    return null;
  }

  if (measurementType === "polygon") {
    if (type === "Polygon" || type === "MultiPolygon") {
      return cloneData(feature.geometry);
    }
    if (type === "LineString" && isClosedCoordinateRing(coordinates)) {
      return {
        type: "Polygon",
        coordinates: [closeCoordinates(coordinates)],
      };
    }
    if (type === "MultiLineString") {
      const polygons = (coordinates || [])
        .filter((line) => isClosedCoordinateRing(line))
        .map((line) => [closeCoordinates(line)]);
      if (polygons.length === 1) {
        return {
          type: "Polygon",
          coordinates: polygons[0],
        };
      }
      if (polygons.length > 1) {
        return {
          type: "MultiPolygon",
          coordinates: polygons,
        };
      }
    }
  }

  return null;
}

function measureSelectedAnnotations() {
  if (!hasKnownScale()) return;
  const selected = getSelectedAnnotationUuids();
  if (selected.length === 0) {
    alert("Select one or more annotations to measure.");
    return;
  }

  const addedMeasurementUuids = [];
  let nextAnnotationMeasureIndex =
    measureResults.filter((result) => String(result.id || "").startsWith("A"))
      .length + 1;
  selected.forEach((uuid) => {
    const feature = getAnnotationByUuid(uuid);
    if (!feature?.geometry) return;
    const type = getMeasurementTypeForAnnotation(feature);
    if (type === "point") {
      const id = `A${nextAnnotationMeasureIndex++}`;
      const group = getMeasureGroupForAnnotation(feature);
      const measurementUuid = generateUniqueId(16);
      measureResults.push({
        id,
        measurementUuid,
        source: "annotation",
        annotationUuid: feature.properties?.uuid || "",
        annotationLabel: feature.properties?.label || "",
        groupId: group.groupId,
        groupName: group.groupName,
        groupColor: group.groupColor,
        type,
        typeLabel: "Point",
        validGeometry: true,
        geometryWarning: "",
        x: feature.geometry.coordinates?.[0] ?? "",
        y: feature.geometry.coordinates?.[1] ?? "",
      });
      addedMeasurementUuids.push(measurementUuid);
      return;
    }
    const geometry = getAnnotationMeasurementGeometry(feature, type);
    if (!geometry) {
      const coordinates = getAnnotationMeasurementCoordinates(feature, type);
      if (coordinates.length < 2) return;
      const measurementUuid = addMeasureFeature(
        type,
        coordinates,
        "annotation",
        feature,
        {
          deferRender: true,
          id: `A${nextAnnotationMeasureIndex++}`,
        }
      );
      if (measurementUuid) addedMeasurementUuids.push(measurementUuid);
      return;
    }
    const measurementUuid = addMeasureGeometry(
      type,
      geometry,
      "annotation",
      feature,
      {
        deferRender: true,
        id: `A${nextAnnotationMeasureIndex++}`,
      }
    );
    if (measurementUuid) addedMeasurementUuids.push(measurementUuid);
  });
  selectedMeasurementUuids = new Set(addedMeasurementUuids);
  measurementSelectionAnchorUuid =
    addedMeasurementUuids[addedMeasurementUuids.length - 1] || null;
  renderMeasureResults();
  drawShape(measureCanvas, [measureJSON, measureAreaJSONTemp, measureJSONTemp]);
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportMeasurementsCSV() {
  if (measureResults.length === 0) {
    alert("No measurement results to export.");
    return;
  }

  const results = getDisplayedMeasureResults();
  if (results.length === 0) {
    alert("No measurement results match the current filters.");
    return;
  }

  const columns = getVisibleMeasureCsvColumns();
  const headers = columns.map((column) => column.csvHeader);
  const rows = results.map((result) =>
    columns.map((column) => column.csvValue(result))
  );

  const csv = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
  saveAs(new Blob([csv], { type: "text/csv;charset=utf-8" }), "measurements.csv");
}

const MEASURE_HISTOGRAM_PARAMETERS = [
  { id: "lengthM", label: "Length", unit: "linear" },
  { id: "longAxisM", label: "Long axis", unit: "linear" },
  { id: "shortAxisM", label: "Short axis", unit: "linear" },
  { id: "maxFeretM", label: "Max Feret", unit: "linear" },
  { id: "minFeretM", label: "Min Feret", unit: "linear" },
  { id: "areaM2", label: "Area", unit: "area" },
  { id: "perimeterM", label: "Perimeter", unit: "linear" },
  { id: "ecdM", label: "ECD", unit: "linear" },
  { id: "aspectRatio", label: "Short/Long", unit: "none" },
  { id: "azimuthDeg", label: "Long axis azimuth", unit: "degrees" },
  { id: "solidity", label: "Solidity", unit: "none" },
  { id: "circularity", label: "Circularity", unit: "none" },
];
const DEFAULT_MEASURE_HISTOGRAM_PARAMETER_ID = "longAxisM";

function getMeasureHistogramParameter() {
  const parameterId = measureHistogramParameter?.value;
  return (
    MEASURE_HISTOGRAM_PARAMETERS.find(
      (parameter) => parameter.id === parameterId
    ) ||
    MEASURE_HISTOGRAM_PARAMETERS.find(
      (parameter) => parameter.id === DEFAULT_MEASURE_HISTOGRAM_PARAMETER_ID
    ) ||
    MEASURE_HISTOGRAM_PARAMETERS[0]
  );
}

function getMeasureHistogramUnitInfo(parameter) {
  if (parameter.unit === "linear") return getLinearUnitInfo();
  if (parameter.unit === "area") return getAreaUnitInfo();
  if (parameter.unit === "degrees") return { label: "°", factor: 1 };
  return { label: "", factor: 1 };
}

function getMeasureHistogramLabel(parameter) {
  const unit = getMeasureHistogramUnitInfo(parameter);
  return unit.label ? `${parameter.label} (${unit.label})` : parameter.label;
}

function getMeasureHistogramSummaryMode() {
  return measureHistogramMode?.value === "groups" ? "groups" : "combined";
}

function getMeasureHistogramPlotType() {
  const value = measureHistogramPlotType?.value;
  return value === "box" || value === "violin" ? value : "histogram";
}

function getMeasureHistogramDefaultColor() {
  const color = measureHistogramColorInput?.value || "#d9d9d9";
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#d9d9d9";
}

function getMeasureSummaryValues(parameter, mode = "combined") {
  syncMeasureHistogramGroupSelection(getMeasureHistogramGroupsInUse());
  const groups = new Map();
  const addValue = (groupName, value) => {
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName).push(value);
  };

  getFilteredMeasureResults().forEach((result) => {
    const value = getMeasureParameterValue(result, parameter);
    if (!Number.isFinite(value)) return;
    const group = getMeasureGroupForResult(result);
    if (!measureHistogramSelectedGroupIds.has(group.groupId)) return;
    addValue(mode === "groups" ? group.groupName : "Combined", value);
  });

  return [...groups.entries()].map(([name, values]) => ({ name, values }));
}

function percentile(sortedValues, probability) {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const index = (sortedValues.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function summarizeValues(values) {
  const sortedValues = [...values].sort((a, b) => a - b);
  const n = sortedValues.length;
  if (n === 0) {
    return {
      n: 0,
      mean: null,
      median: null,
      sd: null,
      min: null,
      q1: null,
      q3: null,
      max: null,
    };
  }
  const mean = sortedValues.reduce((sum, value) => sum + value, 0) / n;
  const variance =
    n > 1
      ? sortedValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        (n - 1)
      : 0;
  return {
    n,
    mean,
    median: percentile(sortedValues, 0.5),
    sd: Math.sqrt(variance),
    min: sortedValues[0],
    q1: percentile(sortedValues, 0.25),
    q3: percentile(sortedValues, 0.75),
    max: sortedValues[n - 1],
  };
}

function buildMeasureHistogramStatsRows() {
  const parameter = getMeasureHistogramParameter();
  const mode = getMeasureHistogramSummaryMode();
  return getMeasureSummaryValues(parameter, mode).map((entry) => ({
    set: entry.name,
    ...summarizeValues(entry.values),
  }));
}

function formatSummaryStat(value) {
  return Number.isFinite(value) ? formatHistogramAxisNumber(value) : "";
}

function renderMeasureHistogramStats() {
  if (!measureHistogramStatsBody) return;
  updateMeasureHistogramStatsHeaders();
  const rows = buildMeasureHistogramStatsRows();
  measureHistogramStatsBody.innerHTML = "";
  if (rows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.textContent = "No plottable measurements";
    row.appendChild(cell);
    measureHistogramStatsBody.appendChild(row);
    if (exportMeasureHistogramStatsButton) {
      exportMeasureHistogramStatsButton.disabled = true;
    }
    return;
  }

  rows.forEach((summary) => {
    const row = document.createElement("tr");
    [
      summary.set,
      summary.n,
      formatSummaryStat(summary.mean),
      formatSummaryStat(summary.median),
      formatSummaryStat(summary.sd),
      formatSummaryStat(summary.min),
      formatSummaryStat(summary.max),
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    measureHistogramStatsBody.appendChild(row);
  });
  if (exportMeasureHistogramStatsButton) {
    exportMeasureHistogramStatsButton.disabled = false;
  }
}

function updateMeasureHistogramStatsHeaders() {
  const parameter = getMeasureHistogramParameter();
  const unit = getMeasureHistogramUnitInfo(parameter);
  const suffix = unit.label ? ` (${unit.label})` : "";
  if (measureHistogramStatsMeanHeader) {
    measureHistogramStatsMeanHeader.textContent = `Mean${suffix}`;
  }
  if (measureHistogramStatsMedianHeader) {
    measureHistogramStatsMedianHeader.textContent = `Median${suffix}`;
  }
  if (measureHistogramStatsSdHeader) {
    measureHistogramStatsSdHeader.textContent = `SD${suffix}`;
  }
  if (measureHistogramStatsMinHeader) {
    measureHistogramStatsMinHeader.textContent = `Min${suffix}`;
  }
  if (measureHistogramStatsMaxHeader) {
    measureHistogramStatsMaxHeader.textContent = `Max${suffix}`;
  }
}

function exportMeasureHistogramStatsCSV() {
  const parameter = getMeasureHistogramParameter();
  const unit = getMeasureHistogramUnitInfo(parameter);
  const unitSuffix = unit.label ? ` (${unit.label})` : "";
  const rows = buildMeasureHistogramStatsRows();
  if (rows.length === 0) {
    alert("No summary statistics to export.");
    return;
  }
  const headers = [
    "parameter",
    "mode",
    "set",
    "n",
    `mean${unitSuffix}`,
    `median${unitSuffix}`,
    `sd${unitSuffix}`,
    `min${unitSuffix}`,
    `q1${unitSuffix}`,
    `q3${unitSuffix}`,
    `max${unitSuffix}`,
  ];
  const csvRows = rows.map((row) => [
    getMeasureHistogramLabel(parameter),
    getMeasureHistogramSummaryMode(),
    row.set,
    row.n,
    row.mean ?? "",
    row.median ?? "",
    row.sd ?? "",
    row.min ?? "",
    row.q1 ?? "",
    row.q3 ?? "",
    row.max ?? "",
  ]);
  const csv = [headers, ...csvRows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
  saveAs(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    "measurement-histogram-stats.csv"
  );
}

function getMeasureHistogramGroupsInUse() {
  const groups = new Map();
  getFilteredMeasureResults().forEach((result) => {
    const group = getMeasureGroupForResult(result);
    groups.set(group.groupId, group);
  });
  return [...groups.values()].sort((a, b) =>
    a.groupName.localeCompare(b.groupName)
  );
}

function syncMeasureHistogramGroupSelection(groups) {
  const groupIds = new Set(groups.map((group) => group.groupId));
  groupIds.forEach((groupId) => {
    if (!measureHistogramKnownGroupIds.has(groupId)) {
      measureHistogramSelectedGroupIds.add(groupId);
    }
  });
  measureHistogramKnownGroupIds = groupIds;
  measureHistogramSelectedGroupIds = new Set(
    [...measureHistogramSelectedGroupIds].filter((groupId) =>
      groupIds.has(groupId)
    )
  );
}

function getMeasureHistogramValues(parameter) {
  const groups = getMeasureHistogramGroupsInUse();
  syncMeasureHistogramGroupSelection(groups);
  const groupedValues = new Map(
    groups.map((group) => [
      group.groupId,
      {
        ...group,
        values: [],
      },
    ])
  );

  getFilteredMeasureResults().forEach((result) => {
    const value = getMeasureParameterValue(result, parameter);
    if (!Number.isFinite(value)) return;
    const group = getMeasureGroupForResult(result);
    if (!measureHistogramSelectedGroupIds.has(group.groupId)) return;
    const entry = groupedValues.get(group.groupId);
    if (!entry) return;
    entry.values.push(value);
  });

  const enabledGroups = [...groupedValues.values()].filter((group) =>
    measureHistogramSelectedGroupIds.has(group.groupId)
  );
  const values = enabledGroups.flatMap((group) => group.values);
  return { groups: enabledGroups, values };
}

function getDefaultHistogramExtent(values) {
  if (values.length === 0) {
    return {
      min: 0,
      max: 0,
      binWidth: 0,
      dataMin: null,
      dataMax: null,
    };
  }

  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  let min = dataMin;
  let max = dataMax;
  if (min === max) {
    const padding = Math.abs(min) > 0 ? Math.abs(min) * 0.05 : 0.5;
    min -= padding;
    max += padding;
  }

  const binCount = Math.min(20, Math.max(5, Math.ceil(Math.sqrt(values.length))));
  const binWidth = getNiceHistogramNumber((max - min) / binCount, true);
  min = Math.floor(min / binWidth) * binWidth;
  max = Math.ceil(max / binWidth) * binWidth;
  if (dataMin >= 0 && min > 0) {
    min = 0;
  }
  return { min, max, binWidth, dataMin, dataMax };
}

function getNiceHistogramNumber(value, round = false) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  let niceFraction;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else if (fraction <= 1) {
    niceFraction = 1;
  } else if (fraction <= 2) {
    niceFraction = 2;
  } else if (fraction <= 5) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }
  return niceFraction * 10 ** exponent;
}

function createHistogramTicks(min, max, targetCount = 6, integer = false) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return [min, max].filter(Number.isFinite);
  }
  let step = getNiceHistogramNumber((max - min) / Math.max(1, targetCount - 1), true);
  if (integer) step = Math.max(1, Math.round(step));
  const first = Math.ceil(min / step) * step;
  const ticks = [];
  for (let value = first; value <= max + step * 0.5; value += step) {
    const tick = integer ? Math.round(value) : Number(value.toPrecision(12));
    if (tick >= min - step * 0.5 && tick <= max + step * 0.5) {
      ticks.push(tick);
    }
    if (ticks.length > 30) break;
  }
  if (ticks.length === 0 || Math.abs(ticks[0] - min) > step * 0.35) {
    ticks.unshift(integer ? Math.round(min) : min);
  }
  if (Math.abs(ticks[ticks.length - 1] - max) > step * 0.35) {
    ticks.push(integer ? Math.round(max) : max);
  }
  return [...new Set(ticks)];
}

function getMeasureHistogramNumberInputValue(input) {
  if (!input || input.value.trim() === "") return null;
  const value = Number(input?.value);
  return Number.isFinite(value) ? value : null;
}

function getMeasureHistogramBinSizeInputValue() {
  const value = getMeasureHistogramNumberInputValue(measureHistogramBinSizeInput);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function getDefaultMeasureHistogramBinWidth() {
  const parameter = getMeasureHistogramParameter();
  const { values } = getMeasureHistogramValues(parameter);
  const binWidth = getDefaultHistogramExtent(values).binWidth;
  return Number.isFinite(binWidth) && binWidth > 0 ? binWidth : 1;
}

function validateMeasureHistogramBinSizeInput() {
  if (!measureHistogramBinSizeInput) return;
  const value = getMeasureHistogramNumberInputValue(measureHistogramBinSizeInput);
  const invalid =
    measureHistogramBinSizeInput.value.trim() !== "" &&
    (!Number.isFinite(value) || value <= 0);
  measureHistogramBinSizeInput.setCustomValidity(
    invalid ? "Bin size must be greater than 0." : ""
  );
}

function normalizeMeasureHistogramBinSizeInput() {
  if (!measureHistogramBinSizeInput) return;
  const value = getMeasureHistogramNumberInputValue(measureHistogramBinSizeInput);
  if (measureHistogramBinSizeInput.value.trim() === "") return;
  if (Number.isFinite(value) && value > 0) return;
  measureHistogramBinSizeInput.value = formatHistogramInputValue(
    getDefaultMeasureHistogramBinWidth()
  );
  measureHistogramBinSizeInput.setCustomValidity("");
}

function validatePositiveNumberInput(input, message = "Value must be greater than 0.") {
  if (!input) return;
  const value = getMeasureHistogramNumberInputValue(input);
  const invalid =
    input.value.trim() !== "" && (!Number.isFinite(value) || value <= 0);
  input.setCustomValidity(invalid ? message : "");
}

function normalizePositiveNumberInput(input, fallbackValue) {
  if (!input) return;
  const value = getMeasureHistogramNumberInputValue(input);
  if (input.value.trim() === "") return;
  if (Number.isFinite(value) && value > 0) return;
  input.value = formatHistogramInputValue(fallbackValue);
  input.setCustomValidity("");
}

function formatHistogramInputValue(value) {
  if (!Number.isFinite(value)) return "";
  return Number(value.toPrecision(4)).toString();
}

function updateMeasureHistogramRangeInputs(defaultExtent) {
  if (
    !measureHistogramMinInput ||
    !measureHistogramMaxInput ||
    !measureHistogramBinSizeInput
  ) {
    return;
  }
  if (measureHistogramRangeEdited) return;
  measureHistogramMinInput.value = formatHistogramInputValue(defaultExtent.min);
  measureHistogramMaxInput.value = formatHistogramInputValue(defaultExtent.max);
  measureHistogramBinSizeInput.value = formatHistogramInputValue(
    defaultExtent.binWidth
  );
}

function createHistogramBins(values, options = {}) {
  const defaultExtent = getDefaultHistogramExtent(values);
  updateMeasureHistogramRangeInputs(defaultExtent);
  if (values.length === 0) {
    return {
      bins: [],
      min: defaultExtent.min,
      max: defaultExtent.max,
      binWidth: defaultExtent.binWidth,
      dataMin: defaultExtent.dataMin,
      dataMax: defaultExtent.dataMax,
    };
  }

  let min = Number.isFinite(options.min) ? options.min : defaultExtent.min;
  let max = Number.isFinite(options.max) ? options.max : defaultExtent.max;
  let binWidth =
    Number.isFinite(options.binWidth) && options.binWidth > 0
      ? options.binWidth
      : defaultExtent.binWidth;

  if (max <= min) {
    min = defaultExtent.min;
    max = defaultExtent.max;
  }
  if (!Number.isFinite(binWidth) || binWidth <= 0) {
    binWidth = defaultExtent.binWidth;
  }
  let binCount = Math.max(1, Math.ceil((max - min) / binWidth));
  if (binCount > 200) {
    binCount = 200;
    binWidth = (max - min) / binCount;
  }
  max = min + binCount * binWidth;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    min: min + index * binWidth,
    max: min + (index + 1) * binWidth,
    count: 0,
    groupCounts: new Map(),
  }));
  return {
    bins,
    min,
    max,
    binWidth,
    dataMin: defaultExtent.dataMin,
    dataMax: defaultExtent.dataMax,
  };
}

function buildMeasureHistogramModel() {
  const parameter = getMeasureHistogramParameter();
  const { groups, values } = getMeasureHistogramValues(parameter);
  const rangeOptions = measureHistogramRangeEdited
    ? {
        min: getMeasureHistogramNumberInputValue(measureHistogramMinInput),
        max: getMeasureHistogramNumberInputValue(measureHistogramMaxInput),
        binWidth: getMeasureHistogramBinSizeInputValue(),
      }
    : {};
  const histogram = createHistogramBins(values, rangeOptions);
  const mode = measureHistogramMode?.value || "combined";
  const plotType = getMeasureHistogramPlotType();
  const stacked = Boolean(measureHistogramStackedInput?.checked);

  groups.forEach((group) => {
    group.values.forEach((value) => {
      if (!Number.isFinite(value) || histogram.bins.length === 0) return;
      if (value < histogram.min || value > histogram.max) return;
      const rawIndex =
        histogram.binWidth === 0
          ? 0
          : Math.floor((value - histogram.min) / histogram.binWidth);
      const index = Math.min(
        histogram.bins.length - 1,
        Math.max(0, rawIndex)
      );
      const bin = histogram.bins[index];
      bin.count += 1;
      bin.groupCounts.set(
        group.groupId,
        (bin.groupCounts.get(group.groupId) || 0) + 1
      );
    });
  });

  const rawYMax = Math.max(
    1,
    ...histogram.bins.map((bin) =>
      mode === "groups" && !stacked
        ? Math.max(
            0,
            ...groups.map((group) => bin.groupCounts.get(group.groupId) || 0)
          )
        : bin.count
    )
  );
  const yTickStep = Math.max(1, Math.round(getNiceHistogramNumber(rawYMax / 4, true)));
  const yMax = Math.max(yTickStep, Math.ceil(rawYMax / yTickStep) * yTickStep);
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    parameter,
    parameterLabel: getMeasureHistogramLabel(parameter),
    plotType,
    defaultColor: getMeasureHistogramDefaultColor(),
    mode,
    stacked,
    groups,
    values,
    ...histogram,
    yMax,
    rawYMax,
    mean: values.length > 0 ? sum / values.length : null,
  };
}

function formatHistogramAxisNumber(value) {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs >= 1000 || (abs > 0 && abs < 0.01)) return value.toExponential(1);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function renderMeasureHistogramParameters() {
  if (!measureHistogramParameter) return;
  const previous =
    measureHistogramParameter.value || DEFAULT_MEASURE_HISTOGRAM_PARAMETER_ID;
  measureHistogramParameter.innerHTML = "";
  MEASURE_HISTOGRAM_PARAMETERS.forEach((parameter) => {
    const option = document.createElement("option");
    option.value = parameter.id;
    option.textContent = parameter.label;
    measureHistogramParameter.appendChild(option);
  });
  measureHistogramParameter.value = MEASURE_HISTOGRAM_PARAMETERS.some(
    (parameter) => parameter.id === previous
  )
    ? previous
    : DEFAULT_MEASURE_HISTOGRAM_PARAMETER_ID;
}

function renderMeasureHistogramGroupControls() {
  if (!measureHistogramGroups) return;
  const groups = getMeasureHistogramGroupsInUse();
  syncMeasureHistogramGroupSelection(groups);
  measureHistogramGroups.innerHTML = "";
  if (groups.length === 0) {
    measureHistogramGroups.textContent = "No groups";
    return;
  }

  groups.forEach((group) => {
    const label = document.createElement("label");
    label.className = "measure-histogram-group";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = measureHistogramSelectedGroupIds.has(group.groupId);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        measureHistogramSelectedGroupIds.add(group.groupId);
      } else {
        measureHistogramSelectedGroupIds.delete(group.groupId);
      }
      drawMeasureHistogram();
    });

    const swatch = createMeasureGroupColor(group);
    const name = document.createElement("span");
    name.textContent = group.groupName;
    label.append(checkbox, swatch, name);
    measureHistogramGroups.appendChild(label);
  });
}

function getMeasureDistributionEntries(model) {
  if (model.mode === "groups") {
    return model.groups
      .filter((group) => group.values.length > 0)
      .map((group) => ({
        label: group.groupName,
        color: getSafeMeasureGroupColor(group.groupColor),
        values: group.values,
      }));
  }
  return [
    {
      label: "Combined",
      color: model.defaultColor,
      values: model.values,
    },
  ].filter((entry) => entry.values.length > 0);
}

function drawMeasurePlotFrame(ctx, model, padding, plotWidth, plotHeight) {
  ctx.fillStyle = "#222";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(model.parameterLabel, padding.left + plotWidth / 2, 14);

  ctx.strokeStyle = "#444";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + plotHeight);
  ctx.lineTo(padding.left + plotWidth, padding.top + plotHeight);
  ctx.stroke();
}

function drawMeasureValueAxis(ctx, model, padding, plotWidth, plotHeight) {
  const xTicks = createHistogramTicks(model.min, model.max, 6);
  ctx.font = "10px sans-serif";
  ctx.lineWidth = 1;
  xTicks.forEach((tick) => {
    const x =
      padding.left + ((tick - model.min) / (model.max - model.min)) * plotWidth;
    ctx.strokeStyle = "#444";
    ctx.beginPath();
    ctx.moveTo(x, padding.top + plotHeight);
    ctx.lineTo(x, padding.top + plotHeight + 4);
    ctx.stroke();
    ctx.fillStyle = "#333";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(
      formatHistogramAxisNumber(tick),
      x,
      padding.top + plotHeight + 8
    );
  });
}

function getMeasureValueX(value, model, padding, plotWidth) {
  const clampedValue = Math.min(model.max, Math.max(model.min, value));
  return (
    padding.left + ((clampedValue - model.min) / (model.max - model.min)) * plotWidth
  );
}

function drawHistogramBars(ctx, model, padding, plotWidth, plotHeight) {
  const yTicks = createHistogramTicks(0, model.yMax, 5, true);
  ctx.font = "10px sans-serif";
  ctx.lineWidth = 1;
  yTicks.forEach((tick) => {
    const y = padding.top + plotHeight - (tick / model.yMax) * plotHeight;
    ctx.strokeStyle = tick === 0 ? "#444" : "#e4e4e4";
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + plotWidth, y);
    ctx.stroke();
    ctx.strokeStyle = "#444";
    ctx.beginPath();
    ctx.moveTo(padding.left - 4, y);
    ctx.lineTo(padding.left, y);
    ctx.stroke();
    ctx.fillStyle = "#333";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(String(tick), padding.left - 6, y);
  });
  drawMeasureValueAxis(ctx, model, padding, plotWidth, plotHeight);

  const binGap = 2;
  const binWidth = plotWidth / model.bins.length;
  model.bins.forEach((bin, index) => {
    const x = padding.left + index * binWidth + binGap / 2;
    const fullBarWidth = Math.max(1, binWidth - binGap);
    if (model.mode === "groups") {
      const activeGroups = model.groups.filter((group) => group.values.length > 0);
      if (model.stacked) {
        let stackedOffset = 0;
        activeGroups.forEach((group) => {
          const count = bin.groupCounts.get(group.groupId) || 0;
          const barHeight = (count / model.yMax) * plotHeight;
          ctx.fillStyle = getSafeMeasureGroupColor(group.groupColor);
          ctx.globalAlpha = 0.78;
          ctx.fillRect(
            x,
            padding.top + plotHeight - stackedOffset - barHeight,
            fullBarWidth,
            barHeight
          );
          ctx.globalAlpha = 1;
          ctx.strokeStyle = "#000";
          ctx.strokeRect(
            x,
            padding.top + plotHeight - stackedOffset - barHeight,
            fullBarWidth,
            barHeight
          );
          stackedOffset += barHeight;
        });
      } else {
        const groupWidth = fullBarWidth / Math.max(1, activeGroups.length);
        activeGroups.forEach((group, groupIndex) => {
          const count = bin.groupCounts.get(group.groupId) || 0;
          const barHeight = (count / model.yMax) * plotHeight;
          ctx.fillStyle = getSafeMeasureGroupColor(group.groupColor);
          ctx.globalAlpha = 0.72;
          ctx.fillRect(
            x + groupIndex * groupWidth,
            padding.top + plotHeight - barHeight,
            Math.max(1, groupWidth - 1),
            barHeight
          );
          ctx.globalAlpha = 1;
          ctx.strokeStyle = "#000";
          ctx.strokeRect(
            x + groupIndex * groupWidth,
            padding.top + plotHeight - barHeight,
            Math.max(1, groupWidth - 1),
            barHeight
          );
        });
      }
      ctx.globalAlpha = 1;
    } else {
      const barHeight = (bin.count / model.yMax) * plotHeight;
      ctx.fillStyle = model.defaultColor;
      ctx.fillRect(
        x,
        padding.top + plotHeight - barHeight,
        fullBarWidth,
        barHeight
      );
      ctx.strokeStyle = "#000";
      ctx.strokeRect(
        x,
        padding.top + plotHeight - barHeight,
        fullBarWidth,
        barHeight
      );
    }
  });
}

function drawBoxPlot(ctx, model, padding, plotWidth, plotHeight) {
  const entries = getMeasureDistributionEntries(model);
  drawMeasureValueAxis(ctx, model, padding, plotWidth, plotHeight);
  const rowHeight = plotHeight / Math.max(1, entries.length);
  entries.forEach((entry, index) => {
    const summary = summarizeValues(entry.values);
    if (summary.n === 0) return;
    const centerY = padding.top + rowHeight * (index + 0.5);
    const boxHeight = Math.min(34, rowHeight * 0.46);
    const minX = getMeasureValueX(summary.min, model, padding, plotWidth);
    const q1X = getMeasureValueX(summary.q1, model, padding, plotWidth);
    const medianX = getMeasureValueX(summary.median, model, padding, plotWidth);
    const q3X = getMeasureValueX(summary.q3, model, padding, plotWidth);
    const maxX = getMeasureValueX(summary.max, model, padding, plotWidth);
    ctx.strokeStyle = entry.color;
    ctx.fillStyle = entry.color;
    ctx.globalAlpha = 0.22;
    ctx.fillRect(q1X, centerY - boxHeight / 2, Math.max(1, q3X - q1X), boxHeight);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.strokeRect(q1X, centerY - boxHeight / 2, Math.max(1, q3X - q1X), boxHeight);
    ctx.beginPath();
    ctx.moveTo(minX, centerY);
    ctx.lineTo(q1X, centerY);
    ctx.moveTo(q3X, centerY);
    ctx.lineTo(maxX, centerY);
    ctx.moveTo(minX, centerY - boxHeight * 0.35);
    ctx.lineTo(minX, centerY + boxHeight * 0.35);
    ctx.moveTo(maxX, centerY - boxHeight * 0.35);
    ctx.lineTo(maxX, centerY + boxHeight * 0.35);
    ctx.moveTo(medianX, centerY - boxHeight / 2);
    ctx.lineTo(medianX, centerY + boxHeight / 2);
    ctx.stroke();
    ctx.fillStyle = "#333";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(entry.label, padding.left - 6, centerY);
  });
  ctx.lineWidth = 1;
}

function getSampleStandardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function getViolinBandwidth(values, min, max) {
  const sortedValues = [...values].sort((a, b) => a - b);
  const n = sortedValues.length;
  const range = Math.max(Number.EPSILON, max - min);
  if (n < 2) return range / 30;
  const sd = getSampleStandardDeviation(sortedValues);
  const iqr = percentile(sortedValues, 0.75) - percentile(sortedValues, 0.25);
  const robustSpread = iqr > 0 ? iqr / 1.34 : sd;
  let spread = Math.min(sd || robustSpread, robustSpread || sd);
  if (!Number.isFinite(spread) || spread <= 0) {
    spread = range / 30;
  }
  let bandwidth = 0.9 * spread * n ** (-1 / 5);
  const minBandwidth = range / 200;
  const maxBandwidth = range / 4;
  if (!Number.isFinite(bandwidth) || bandwidth <= 0) {
    bandwidth = range / 30;
  }
  return Math.min(maxBandwidth, Math.max(minBandwidth, bandwidth));
}

function getViolinDensityPoints(values, model, sampleCount = 120) {
  if (values.length === 0 || model.max <= model.min) return [];
  const bandwidth = getViolinBandwidth(values, model.min, model.max);
  const visibleValues = values.filter(
    (value) => value >= model.min && value <= model.max
  );
  const densityValues = visibleValues.length > 0 ? visibleValues : values;
  const normalizer =
    densityValues.length * bandwidth * Math.sqrt(2 * Math.PI);
  return Array.from({ length: sampleCount }, (_, index) => {
    const t = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    const value = model.min + t * (model.max - model.min);
    const kernelSum = densityValues.reduce((sum, sample) => {
      const z = (value - sample) / bandwidth;
      return sum + Math.exp(-0.5 * z * z);
    }, 0);
    return {
      value,
      density: normalizer > 0 ? kernelSum / normalizer : 0,
    };
  });
}

function drawViolinPlot(ctx, model, padding, plotWidth, plotHeight) {
  const entries = getMeasureDistributionEntries(model);
  drawMeasureValueAxis(ctx, model, padding, plotWidth, plotHeight);
  const rowHeight = plotHeight / Math.max(1, entries.length);
  entries.forEach((entry, index) => {
    if (entry.values.length === 0 || model.max <= model.min) return;
    const centerY = padding.top + rowHeight * (index + 0.5);
    const maxHalfHeight = Math.min(32, rowHeight * 0.38);
    const densityPoints = getViolinDensityPoints(entry.values, model);
    const maxDensity = Math.max(0, ...densityPoints.map((point) => point.density));
    const topPoints = [];
    const bottomPoints = [];
    densityPoints.forEach((point) => {
      const x = getMeasureValueX(point.value, model, padding, plotWidth);
      const halfHeight =
        maxDensity > 0 ? (point.density / maxDensity) * maxHalfHeight : 0;
      topPoints.push([x, centerY - halfHeight]);
      bottomPoints.unshift([x, centerY + halfHeight]);
    });
    if (topPoints.length === 0) return;
    ctx.fillStyle = entry.color;
    ctx.strokeStyle = entry.color;
    ctx.globalAlpha = 0.24;
    ctx.beginPath();
    [...topPoints, ...bottomPoints].forEach(([x, y], pointIndex) => {
      if (pointIndex === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
    const summary = summarizeValues(entry.values);
    const medianX = getMeasureValueX(summary.median, model, padding, plotWidth);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(medianX, centerY - maxHalfHeight * 0.75);
    ctx.lineTo(medianX, centerY + maxHalfHeight * 0.75);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = "#333";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(entry.label, padding.left - 6, centerY);
  });
}

function drawHistogramToCanvas(ctx, model, width, height) {
  const padding = {
    left: model.plotType === "histogram" ? 42 : 58,
    top: 20,
    right: 16,
    bottom: 42,
  };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#bdbdbd";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  drawMeasurePlotFrame(ctx, model, padding, plotWidth, plotHeight);

  if (model.values.length === 0 || model.bins.length === 0) {
    ctx.fillStyle = "#666";
    ctx.textAlign = "center";
    ctx.fillText("No plottable measurements", width / 2, height / 2);
    return;
  }

  if (model.plotType === "box") {
    drawBoxPlot(ctx, model, padding, plotWidth, plotHeight);
  } else if (model.plotType === "violin") {
    drawViolinPlot(ctx, model, padding, plotWidth, plotHeight);
  } else {
    drawHistogramBars(ctx, model, padding, plotWidth, plotHeight);
  }

  ctx.textBaseline = "alphabetic";
}

function drawMeasureHistogram() {
  if (!measureHistogramCanvas || measureHistogramMenu?.hidden) return null;
  const model = buildMeasureHistogramModel();
  const rect = measureHistogramCanvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.round(rect.width));
  const height = Math.max(200, Math.round(rect.height));
  measureHistogramCanvas.width = Math.round(width * ratio);
  measureHistogramCanvas.height = Math.round(height * ratio);
  const ctx = measureHistogramCanvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawHistogramToCanvas(ctx, model, width, height);
  renderMeasureHistogramStats();
  if (exportMeasureHistogramButton) {
    exportMeasureHistogramButton.disabled =
      model.values.length === 0 || model.plotType !== "histogram";
    exportMeasureHistogramButton.title =
      model.plotType === "histogram"
        ? "Export histogram as PDF"
        : "PDF export currently supports histogram view";
  }
  return model;
}

function renderMeasureHistogramMenu() {
  if (!measureHistogramMenu || measureHistogramMenu.hidden) return;
  renderMeasureHistogramParameters();
  renderMeasureHistogramGroupControls();
  updateMeasureHistogramControlState();
  drawMeasureHistogram();
}

function updateMeasureHistogramControlState() {
  const isHistogram = getMeasureHistogramPlotType() === "histogram";
  if (measureHistogramBinSizeInput) {
    measureHistogramBinSizeInput.disabled = !isHistogram;
  }
  if (measureHistogramStackedInput && measureHistogramMode) {
    measureHistogramStackedInput.disabled =
      !isHistogram || measureHistogramMode.value !== "groups";
  }
}

function updateMeasureHistogramAvailability() {
  if (!measureHistogramButton) return;
  measureHistogramButton.disabled = !hasFilteredMeasureResults();
}

function positionMeasureHistogramMenu(button) {
  if (!measureHistogramMenu || !button) return;
  const buttonRect = button.getBoundingClientRect();
  const menuRect = measureHistogramMenu.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(
    Math.max(buttonRect.left, margin),
    window.innerWidth - menuRect.width - margin
  );
  const spaceAbove = buttonRect.top - margin;
  const top =
    spaceAbove >= menuRect.height
      ? buttonRect.top - menuRect.height - 4
      : Math.min(
          buttonRect.bottom + 4,
          window.innerHeight - menuRect.height - margin
        );
  measureHistogramMenu.style.left = `${left}px`;
  measureHistogramMenu.style.top = `${Math.max(margin, top)}px`;
}

function openMeasureHistogramMenu(button) {
  if (!measureHistogramMenu || !button) return;
  if (measureHistogramMenu.parentElement !== document.body) {
    document.body.appendChild(measureHistogramMenu);
  }
  measureHistogramRangeEdited = false;
  renderMeasureHistogramParameters();
  renderMeasureHistogramGroupControls();
  updateMeasureHistogramControlState();
  measureHistogramMenu.hidden = false;
  measureHistogramButton?.setAttribute("aria-expanded", "true");
  positionMeasureHistogramMenu(button);
  drawMeasureHistogram();
}

function closeMeasureHistogramMenu() {
  if (!measureHistogramMenu) return;
  measureHistogramMenu.hidden = true;
  measureHistogramButton?.setAttribute("aria-expanded", "false");
}

function makeFixedElementDraggable(element, handle) {
  if (!element || !handle) return;
  let dragState = null;

  handle.addEventListener("pointerdown", function (event) {
    if (event.button !== 0 || event.target.closest("button, input, select")) {
      return;
    }
    const rect = element.getBoundingClientRect();
    dragState = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    handle.setPointerCapture(event.pointerId);
  });

  handle.addEventListener("pointermove", function (event) {
    if (!dragState) return;
    const rect = element.getBoundingClientRect();
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    const left = Math.min(
      Math.max(event.clientX - dragState.offsetX, margin),
      maxLeft
    );
    const top = Math.min(
      Math.max(event.clientY - dragState.offsetY, margin),
      maxTop
    );
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  });

  function stopDrag(event) {
    if (!dragState) return;
    dragState = null;
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
  }

  handle.addEventListener("pointerup", stopDrag);
  handle.addEventListener("pointercancel", stopDrag);
}

function pdfText(value) {
  return String(value)
    .replace(/ɸ/g, "phi")
    .replace(/µ/g, "um")
    .replace(/²/g, "^2")
    .replace(/°/g, " deg")
    .replace(/[^\x20-\x7e]/g, "");
}

function escapePdfString(value) {
  return pdfText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function addPdfText(commands, label, x, y, size = 10, pageHeight = 432) {
  commands.push(
    `BT /F1 ${size} Tf ${x.toFixed(2)} ${(pageHeight - y).toFixed(2)} Td (${escapePdfString(label)}) Tj ET`
  );
}

function addPdfRotatedText(commands, label, x, y, size = 10, pageHeight = 432) {
  commands.push(
    `BT /F1 ${size} Tf 0 1 -1 0 ${x.toFixed(2)} ${(pageHeight - y).toFixed(2)} Tm (${escapePdfString(label)}) Tj ET`
  );
}

function hexToPdfRgb(color) {
  const safe = getSafeMeasureGroupColor(color).slice(1);
  const red = parseInt(safe.slice(0, 2), 16) / 255;
  const green = parseInt(safe.slice(2, 4), 16) / 255;
  const blue = parseInt(safe.slice(4, 6), 16) / 255;
  return [red, green, blue].map((value) => value.toFixed(3)).join(" ");
}

function createMeasureHistogramPdf(model) {
  const width = 612;
  const height = 432;
  const padding = { left: 64, top: 54, right: 34, bottom: 72 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const commands = [];
  const pdfY = (y) => height - y;
  const text = (label, x, y, size = 10) => {
    commands.push(`BT /F1 ${size} Tf ${x.toFixed(2)} ${pdfY(y).toFixed(2)} Td (${escapePdfString(label)}) Tj ET`);
  };
  const rotatedText = (label, x, y, size = 10) => {
    commands.push(`BT /F1 ${size} Tf 0 1 -1 0 ${x.toFixed(2)} ${pdfY(y).toFixed(2)} Tm (${escapePdfString(label)}) Tj ET`);
  };
  const rect = (x, y, w, h, color) => {
    if (w <= 0 || h <= 0) return;
    commands.push(`${hexToPdfRgb(color)} rg ${x.toFixed(2)} ${pdfY(y + h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  };
  const strokedRect = (x, y, w, h, color) => {
    if (w <= 0 || h <= 0) return;
    commands.push(`${hexToPdfRgb(color)} rg 0 0 0 RG ${x.toFixed(2)} ${pdfY(y + h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re B`);
  };
  commands.push("1 1 1 rg 0 0 612 432 re f");
  commands.push("0.15 0.15 0.15 RG 1 w");
  commands.push(`${padding.left} ${pdfY(padding.top)} m ${padding.left} ${pdfY(padding.top + plotHeight)} l ${padding.left + plotWidth} ${pdfY(padding.top + plotHeight)} l S`);
  text(model.parameterLabel, padding.left + plotWidth / 2 - 65, 24, 13);

  if (model.values.length === 0 || model.bins.length === 0) {
    text("No plottable measurements", padding.left + 150, padding.top + plotHeight / 2, 12);
  } else {
    const binGap = 2;
    const binWidth = plotWidth / model.bins.length;
    model.bins.forEach((bin, index) => {
      const x = padding.left + index * binWidth + binGap / 2;
      const fullBarWidth = Math.max(1, binWidth - binGap);
      if (model.mode === "groups") {
        const activeGroups = model.groups.filter((group) => group.values.length > 0);
        if (model.stacked) {
          let stackedOffset = 0;
          activeGroups.forEach((group) => {
            const count = bin.groupCounts.get(group.groupId) || 0;
            const barHeight = (count / model.yMax) * plotHeight;
            strokedRect(
              x,
              padding.top + plotHeight - stackedOffset - barHeight,
              fullBarWidth,
              barHeight,
              group.groupColor
            );
            stackedOffset += barHeight;
          });
        } else {
          const groupWidth = fullBarWidth / Math.max(1, activeGroups.length);
          activeGroups.forEach((group, groupIndex) => {
            const count = bin.groupCounts.get(group.groupId) || 0;
            const barHeight = (count / model.yMax) * plotHeight;
            strokedRect(
              x + groupIndex * groupWidth,
              padding.top + plotHeight - barHeight,
              Math.max(1, groupWidth - 1),
              barHeight,
              group.groupColor
            );
          });
        }
      } else {
        const barHeight = (bin.count / model.yMax) * plotHeight;
        strokedRect(
          x,
          padding.top + plotHeight - barHeight,
          fullBarWidth,
          barHeight,
          model.defaultColor
        );
      }
    });
    text(String(model.yMax), padding.left - 28, padding.top + 3, 9);
    text("0", padding.left - 16, padding.top + plotHeight + 3, 9);
    text(formatHistogramAxisNumber(model.min), padding.left, padding.top + plotHeight + 18, 9);
    text(formatHistogramAxisNumber(model.max), padding.left + plotWidth - 48, padding.top + plotHeight + 18, 9);
  }

  text(
    `n = ${model.values.length}; mean = ${formatHistogramAxisNumber(model.mean)}; min = ${formatHistogramAxisNumber(model.dataMin)}; max = ${formatHistogramAxisNumber(model.dataMax)}`,
    padding.left,
    height - 24,
    10
  );

  if (model.mode === "groups") {
    let legendX = padding.left;
    const legendY = height - 42;
    model.groups
      .filter((group) => group.values.length > 0)
      .forEach((group) => {
        rect(legendX, legendY - 8, 8, 8, group.groupColor);
        text(group.groupName, legendX + 12, legendY, 8);
        legendX += Math.min(110, 18 + group.groupName.length * 5);
      });
  }

  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index++) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function exportMeasureHistogramPDF() {
  const model = buildMeasureHistogramModel();
  if (model.plotType !== "histogram") {
    alert("PDF export currently supports histogram view.");
    return;
  }
  if (model.values.length === 0) {
    alert("No plottable measurements to export.");
    return;
  }
  const parameter = pdfText(model.parameter.label).toLowerCase().replace(/\W+/g, "-");
  saveAs(createMeasureHistogramPdf(model), `measurement-histogram-${parameter}.pdf`);
}

function getMeasureParameterValue(result, parameter) {
  const rawValue =
    parameter.id === "lengthM"
      ? getLineLengthM(result)
      : parameter.id === "longAxisM"
        ? getLongAxisM(result)
        : parameter.id === "shortAxisM"
          ? getShortAxisM(result)
          : result?.[parameter.id];
  if (!Number.isFinite(rawValue)) return null;
  if (
    result.validGeometry === false &&
    (parameter.id === "areaM2" || parameter.id === "ecdM")
  ) {
    return null;
  }
  return rawValue * getMeasureHistogramUnitInfo(parameter).factor;
}

function renderMeasureParameterOptions(select, fallbackId) {
  if (!select) return;
  const previous = select.value || fallbackId;
  select.innerHTML = "";
  MEASURE_HISTOGRAM_PARAMETERS.forEach((parameter) => {
    const option = document.createElement("option");
    option.value = parameter.id;
    option.textContent = parameter.label;
    select.appendChild(option);
  });
  select.value = MEASURE_HISTOGRAM_PARAMETERS.some(
    (parameter) => parameter.id === previous
  )
    ? previous
    : fallbackId;
}

function getMeasureScatterParameter(select, fallbackIndex) {
  const parameterId = select?.value;
  return (
    MEASURE_HISTOGRAM_PARAMETERS.find(
      (parameter) => parameter.id === parameterId
    ) || MEASURE_HISTOGRAM_PARAMETERS[fallbackIndex]
  );
}

function getMeasureScatterDefaultColor() {
  const color = measureScatterColorInput?.value || "#8a8f94";
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#8a8f94";
}

function getMeasureScatterOpacity() {
  const value = Number(measureScatterOpacityInput?.value);
  return Number.isFinite(value)
    ? Math.min(1, Math.max(0.01, value / 100))
    : 0.78;
}

function clampMeasureScatterOpacity(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? Math.min(100, Math.max(1, Math.round(numericValue)))
    : 78;
}

function setMeasureScatterOpacityControlValue(value) {
  const opacity = clampMeasureScatterOpacity(value);
  if (measureScatterOpacityInput) {
    measureScatterOpacityInput.value = String(opacity);
  }
  if (measureScatterOpacityRange) {
    measureScatterOpacityRange.value = String(opacity);
  }
  return opacity;
}


function syncMeasureScatterGroupSelection(groups) {
  const groupIds = new Set(groups.map((group) => group.groupId));
  groupIds.forEach((groupId) => {
    if (!measureScatterKnownGroupIds.has(groupId)) {
      measureScatterSelectedGroupIds.add(groupId);
    }
  });
  measureScatterKnownGroupIds = groupIds;
  measureScatterSelectedGroupIds = new Set(
    [...measureScatterSelectedGroupIds].filter((groupId) => groupIds.has(groupId))
  );
}

function getMeasureScatterPoints(xParameter, yParameter) {
  const groups = getMeasureHistogramGroupsInUse();
  syncMeasureScatterGroupSelection(groups);
  const groupedPoints = new Map(
    groups.map((group) => [
      group.groupId,
      {
        ...group,
        points: [],
      },
    ])
  );

  getFilteredMeasureResults().forEach((result) => {
    const group = getMeasureGroupForResult(result);
    if (!measureScatterSelectedGroupIds.has(group.groupId)) return;
    const x = getMeasureParameterValue(result, xParameter);
    const y = getMeasureParameterValue(result, yParameter);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    groupedPoints.get(group.groupId)?.points.push({ x, y });
  });

  const enabledGroups = [...groupedPoints.values()].filter((group) =>
    measureScatterSelectedGroupIds.has(group.groupId)
  );
  const points = enabledGroups.flatMap((group) => group.points);
  return { groups: enabledGroups, points };
}

function getDefaultScatterExtent(values) {
  if (values.length === 0) {
    return { min: 0, max: 1, dataMin: null, dataMax: null };
  }
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  let min = dataMin;
  let max = dataMax;
  if (min === max) {
    const padding = Math.abs(min) > 0 ? Math.abs(min) * 0.05 : 0.5;
    min -= padding;
    max += padding;
  }
  const span = max - min;
  const step = getNiceHistogramNumber(span / 5, true);
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  if (dataMin >= 0 && min > 0) min = 0;
  return { min, max, dataMin, dataMax };
}

function updateMeasureScatterRangeInputs(xExtent, yExtent) {
  if (
    !measureScatterXMinInput ||
    !measureScatterXMaxInput ||
    !measureScatterYMinInput ||
    !measureScatterYMaxInput ||
    measureScatterRangeEdited
  ) {
    return;
  }
  measureScatterXMinInput.value = formatHistogramInputValue(xExtent.min);
  measureScatterXMaxInput.value = formatHistogramInputValue(xExtent.max);
  measureScatterYMinInput.value = formatHistogramInputValue(yExtent.min);
  measureScatterYMaxInput.value = formatHistogramInputValue(yExtent.max);
}

function renderMeasureScatterParameters() {
  renderMeasureParameterOptions(measureScatterXParameter, "longAxisM");
  renderMeasureParameterOptions(measureScatterYParameter, "areaM2");
}

function renderMeasureScatterGroupControls() {
  if (!measureScatterGroups) return;
  const groups = getMeasureHistogramGroupsInUse();
  syncMeasureScatterGroupSelection(groups);
  measureScatterGroups.innerHTML = "";
  if (groups.length === 0) {
    measureScatterGroups.textContent = "No groups";
    return;
  }
  groups.forEach((group) => {
    const label = document.createElement("label");
    label.className = "measure-histogram-group";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = measureScatterSelectedGroupIds.has(group.groupId);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        measureScatterSelectedGroupIds.add(group.groupId);
      } else {
        measureScatterSelectedGroupIds.delete(group.groupId);
      }
      drawMeasureScatter();
    });
    const swatch = createMeasureGroupColor(group);
    const name = document.createElement("span");
    name.textContent = group.groupName;
    label.append(checkbox, swatch, name);
    measureScatterGroups.appendChild(label);
  });
}

function buildMeasureScatterModel() {
  const xParameter = getMeasureScatterParameter(measureScatterXParameter, 1);
  const yParameter = getMeasureScatterParameter(measureScatterYParameter, 5);
  const { groups, points } = getMeasureScatterPoints(xParameter, yParameter);
  const xExtent = getDefaultScatterExtent(points.map((point) => point.x));
  const yExtent = getDefaultScatterExtent(points.map((point) => point.y));
  updateMeasureScatterRangeInputs(xExtent, yExtent);

  let xMin = measureScatterRangeEdited
    ? getMeasureHistogramNumberInputValue(measureScatterXMinInput)
    : null;
  let xMax = measureScatterRangeEdited
    ? getMeasureHistogramNumberInputValue(measureScatterXMaxInput)
    : null;
  let yMin = measureScatterRangeEdited
    ? getMeasureHistogramNumberInputValue(measureScatterYMinInput)
    : null;
  let yMax = measureScatterRangeEdited
    ? getMeasureHistogramNumberInputValue(measureScatterYMaxInput)
    : null;
  xMin = Number.isFinite(xMin) ? xMin : xExtent.min;
  xMax = Number.isFinite(xMax) ? xMax : xExtent.max;
  yMin = Number.isFinite(yMin) ? yMin : yExtent.min;
  yMax = Number.isFinite(yMax) ? yMax : yExtent.max;
  if (xMax <= xMin) {
    xMin = xExtent.min;
    xMax = xExtent.max;
  }
  if (yMax <= yMin) {
    yMin = yExtent.min;
    yMax = yExtent.max;
  }

  return {
    xParameter,
    yParameter,
    xLabel: getMeasureHistogramLabel(xParameter),
    yLabel: getMeasureHistogramLabel(yParameter),
    mode: measureScatterMode?.value || "combined",
    defaultColor: getMeasureScatterDefaultColor(),
    pointOpacity: getMeasureScatterOpacity(),
    groups,
    points,
    xMin,
    xMax,
    yMin,
    yMax,
    xDataMin: xExtent.dataMin,
    xDataMax: xExtent.dataMax,
    yDataMin: yExtent.dataMin,
    yDataMax: yExtent.dataMax,
  };
}

function drawScatterToCanvas(ctx, model, width, height) {
  const padding = { left: 48, top: 24, right: 18, bottom: 48 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const xScale = (value) =>
    padding.left + ((value - model.xMin) / (model.xMax - model.xMin)) * plotWidth;
  const yScale = (value) =>
    padding.top + plotHeight - ((value - model.yMin) / (model.yMax - model.yMin)) * plotHeight;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#bdbdbd";
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + plotHeight);
  ctx.lineTo(padding.left + plotWidth, padding.top + plotHeight);
  ctx.stroke();

  ctx.fillStyle = "#222";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${model.yLabel} vs ${model.xLabel}`, padding.left + plotWidth / 2, 15);
  ctx.save();
  ctx.translate(12, padding.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = "11px sans-serif";
  ctx.fillText(model.yLabel, 0, 0);
  ctx.restore();

  if (model.points.length === 0) {
    ctx.fillStyle = "#666";
    ctx.fillText("No plottable measurements", width / 2, height / 2);
    return;
  }

  const drawPoint = (point, color) => {
    if (
      point.x < model.xMin ||
      point.x > model.xMax ||
      point.y < model.yMin ||
      point.y > model.yMax
    ) {
      return;
    }
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.globalAlpha = model.pointOpacity;
    ctx.arc(xScale(point.x), yScale(point.y), 3.2, 0, Math.PI * 2);
    ctx.fill();
  };

  if (model.mode === "groups") {
    model.groups.forEach((group) => {
      group.points.forEach((point) =>
        drawPoint(point, getSafeMeasureGroupColor(group.groupColor))
      );
    });
  } else {
    model.points.forEach((point) => drawPoint(point, model.defaultColor));
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#333";
  ctx.font = "10px sans-serif";
  createHistogramTicks(model.xMin, model.xMax, 6).forEach((tick) => {
    const x = xScale(tick);
    ctx.strokeStyle = "#444";
    ctx.beginPath();
    ctx.moveTo(x, padding.top + plotHeight);
    ctx.lineTo(x, padding.top + plotHeight + 4);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(formatHistogramAxisNumber(tick), x, padding.top + plotHeight + 8);
  });
  createHistogramTicks(model.yMin, model.yMax, 6).forEach((tick) => {
    const y = yScale(tick);
    ctx.strokeStyle = "#444";
    ctx.beginPath();
    ctx.moveTo(padding.left - 4, y);
    ctx.lineTo(padding.left, y);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(formatHistogramAxisNumber(tick), padding.left - 7, y);
  });
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  ctx.font = "11px sans-serif";
  ctx.fillText(model.xLabel, padding.left + plotWidth / 2, height - 10);
}

function summarizeScatterPoints(points) {
  const n = points.length;
  if (n === 0) {
    return { n: 0, meanX: null, meanY: null, sdX: null, sdY: null, r: null, r2: null };
  }
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / n;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / n;
  if (n < 2) {
    return { n, meanX, meanY, sdX: 0, sdY: 0, r: null, r2: null };
  }
  const sums = points.reduce(
    (acc, point) => {
      const dx = point.x - meanX;
      const dy = point.y - meanY;
      acc.xx += dx * dx;
      acc.yy += dy * dy;
      acc.xy += dx * dy;
      return acc;
    },
    { xx: 0, yy: 0, xy: 0 }
  );
  const sdX = Math.sqrt(sums.xx / (n - 1));
  const sdY = Math.sqrt(sums.yy / (n - 1));
  const r = sums.xx > 0 && sums.yy > 0 ? sums.xy / Math.sqrt(sums.xx * sums.yy) : null;
  return {
    n,
    meanX,
    meanY,
    sdX,
    sdY,
    r,
    r2: Number.isFinite(r) ? r * r : null,
  };
}

function getMeasureScatterStatsRows(model) {
  if (model.mode === "groups") {
    return model.groups
      .filter((group) => group.points.length > 0)
      .map((group) => ({
        set: group.groupName,
        ...summarizeScatterPoints(group.points),
      }));
  }
  return [
    {
      set: "Combined",
      ...summarizeScatterPoints(model.points),
    },
  ].filter((row) => row.n > 0);
}

function updateMeasureScatterStatsHeaders(model) {
  if (measureScatterMeanXHeader) {
    measureScatterMeanXHeader.textContent = `Mean ${model.xLabel}`;
  }
  if (measureScatterMeanYHeader) {
    measureScatterMeanYHeader.textContent = `Mean ${model.yLabel}`;
  }
  if (measureScatterSdXHeader) {
    measureScatterSdXHeader.textContent = `SD ${model.xLabel}`;
  }
  if (measureScatterSdYHeader) {
    measureScatterSdYHeader.textContent = `SD ${model.yLabel}`;
  }
}

function renderMeasureScatterStats(model) {
  if (!measureScatterStatsBody) return;
  updateMeasureScatterStatsHeaders(model);
  const rows = getMeasureScatterStatsRows(model);
  measureScatterStatsBody.innerHTML = "";
  if (rows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.textContent = "No plottable measurements";
    row.appendChild(cell);
    measureScatterStatsBody.appendChild(row);
    if (exportMeasureScatterStatsButton) {
      exportMeasureScatterStatsButton.disabled = true;
    }
    return;
  }
  rows.forEach((stats) => {
    const row = document.createElement("tr");
    [
      stats.set,
      stats.n,
      formatSummaryStat(stats.meanX),
      formatSummaryStat(stats.meanY),
      formatSummaryStat(stats.sdX),
      formatSummaryStat(stats.sdY),
      formatSummaryStat(stats.r),
      formatSummaryStat(stats.r2),
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    measureScatterStatsBody.appendChild(row);
  });
  if (exportMeasureScatterStatsButton) {
    exportMeasureScatterStatsButton.disabled = false;
  }
}

function exportMeasureScatterStatsCSV() {
  const model = buildMeasureScatterModel();
  const rows = getMeasureScatterStatsRows(model);
  if (rows.length === 0) {
    alert("No scatterplot statistics to export.");
    return;
  }
  const headers = [
    "set",
    "n",
    `mean_${model.xLabel}`,
    `mean_${model.yLabel}`,
    `sd_${model.xLabel}`,
    `sd_${model.yLabel}`,
    "r",
    "r2",
  ];
  const csvRows = rows.map((row) => [
    row.set,
    row.n,
    row.meanX ?? "",
    row.meanY ?? "",
    row.sdX ?? "",
    row.sdY ?? "",
    row.r ?? "",
    row.r2 ?? "",
  ]);
  const csv = [headers, ...csvRows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
  saveAs(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    "scatterplot-statistics.csv"
  );
}

function drawMeasureScatter() {
  if (!measureScatterCanvas || measureScatterMenu?.hidden) return null;
  const model = buildMeasureScatterModel();
  const rect = measureScatterCanvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.round(rect.width));
  const height = Math.max(200, Math.round(rect.height));
  measureScatterCanvas.width = Math.round(width * ratio);
  measureScatterCanvas.height = Math.round(height * ratio);
  const ctx = measureScatterCanvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawScatterToCanvas(ctx, model, width, height);
  renderMeasureScatterStats(model);
  if (exportMeasureScatterButton) {
    exportMeasureScatterButton.disabled = model.points.length === 0;
  }
  return model;
}

function renderMeasureScatterMenu() {
  if (!measureScatterMenu || measureScatterMenu.hidden) return;
  renderMeasureScatterParameters();
  renderMeasureScatterGroupControls();
  drawMeasureScatter();
}

function updateMeasureScatterAvailability() {
  if (!measureScatterButton) return;
  measureScatterButton.disabled = !hasFilteredMeasureResults();
}

function positionFixedAnalysisMenu(menu, button) {
  if (!menu || !button) return;
  const buttonRect = button.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(
    Math.max(buttonRect.left, margin),
    window.innerWidth - menuRect.width - margin
  );
  const spaceAbove = buttonRect.top - margin;
  const top =
    spaceAbove >= menuRect.height
      ? buttonRect.top - menuRect.height - 4
      : Math.min(
          buttonRect.bottom + 4,
          window.innerHeight - menuRect.height - margin
        );
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(margin, top)}px`;
}

function clampFixedAnalysisMenuToViewport(menu) {
  if (!menu || menu.hidden) return;
  const rect = menu.getBoundingClientRect();
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
  const left = Math.min(Math.max(rect.left, margin), maxLeft);
  const top = Math.min(Math.max(rect.top, margin), maxTop);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function refreshOpenMeasureAnalysisMenus() {
  clampFixedAnalysisMenuToViewport(measureHistogramMenu);
  clampFixedAnalysisMenuToViewport(measureScatterMenu);
  clampFixedAnalysisMenuToViewport(measureRoseMenu);
  clampFixedAnalysisMenuToViewport(measureParticleSizeMenu);
  drawMeasureHistogram();
  drawMeasureScatter();
  drawMeasureRose();
  drawMeasureParticleSize();
}

function observeMeasureAnalysisMenuResize(menu) {
  if (!window.ResizeObserver || !menu) return;
  const observer = new ResizeObserver(() => {
    if (menu.hidden) return;
    requestAnimationFrame(refreshOpenMeasureAnalysisMenus);
  });
  observer.observe(menu);
}

[
  measureHistogramMenu,
  measureScatterMenu,
  measureRoseMenu,
  measureParticleSizeMenu,
].forEach(observeMeasureAnalysisMenuResize);

function openMeasureScatterMenu(button) {
  if (!measureScatterMenu || !button) return;
  if (measureScatterMenu.parentElement !== document.body) {
    document.body.appendChild(measureScatterMenu);
  }
  measureScatterRangeEdited = false;
  renderMeasureScatterParameters();
  renderMeasureScatterGroupControls();
  measureScatterMenu.hidden = false;
  measureScatterButton?.setAttribute("aria-expanded", "true");
  positionFixedAnalysisMenu(measureScatterMenu, button);
  drawMeasureScatter();
}

function closeMeasureScatterMenu() {
  if (!measureScatterMenu) return;
  measureScatterMenu.hidden = true;
  measureScatterButton?.setAttribute("aria-expanded", "false");
}

function createMeasureScatterPdf(model) {
  const width = 612;
  const height = 432;
  const padding = { left: 72, top: 54, right: 34, bottom: 76 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const commands = [];
  const pdfY = (y) => height - y;
  const text = (label, x, y, size = 10) => {
    commands.push(`BT /F1 ${size} Tf ${x.toFixed(2)} ${pdfY(y).toFixed(2)} Td (${escapePdfString(label)}) Tj ET`);
  };
  const square = (x, y, size, color) => {
    commands.push(
      `${hexToPdfRgb(color)} rg ${(x - size / 2).toFixed(2)} ${pdfY(y + size / 2).toFixed(2)} ${size.toFixed(2)} ${size.toFixed(2)} re f`
    );
  };
  const xScale = (value) =>
    padding.left + ((value - model.xMin) / (model.xMax - model.xMin)) * plotWidth;
  const yScale = (value) =>
    padding.top + plotHeight - ((value - model.yMin) / (model.yMax - model.yMin)) * plotHeight;

  commands.push("1 1 1 rg 0 0 612 432 re f");
  commands.push("0.15 0.15 0.15 RG 1 w");
  commands.push(`${padding.left} ${pdfY(padding.top)} m ${padding.left} ${pdfY(padding.top + plotHeight)} l ${padding.left + plotWidth} ${pdfY(padding.top + plotHeight)} l S`);
  text(`${model.yLabel} vs ${model.xLabel}`, padding.left + plotWidth / 2 - 80, 24, 13);

  const drawPoint = (point, color) => {
    if (
      point.x < model.xMin ||
      point.x > model.xMax ||
      point.y < model.yMin ||
      point.y > model.yMax
    ) {
      return;
    }
    square(xScale(point.x), yScale(point.y), 4.8, color);
  };
  if (model.mode === "groups") {
    model.groups.forEach((group) => {
      group.points.forEach((point) => drawPoint(point, group.groupColor));
    });
  } else {
    model.points.forEach((point) => drawPoint(point, model.defaultColor));
  }

  createHistogramTicks(model.xMin, model.xMax, 6).forEach((tick) => {
    const x = xScale(tick);
    commands.push(`0.25 0.25 0.25 RG 0.8 w ${x.toFixed(2)} ${pdfY(padding.top + plotHeight).toFixed(2)} m ${x.toFixed(2)} ${pdfY(padding.top + plotHeight + 4).toFixed(2)} l S`);
    text(formatHistogramAxisNumber(tick), x - 8, padding.top + plotHeight + 18, 8);
  });
  createHistogramTicks(model.yMin, model.yMax, 6).forEach((tick) => {
    const y = yScale(tick);
    commands.push(`0.25 0.25 0.25 RG 0.8 w ${(padding.left - 4).toFixed(2)} ${pdfY(y).toFixed(2)} m ${padding.left.toFixed(2)} ${pdfY(y).toFixed(2)} l S`);
    text(formatHistogramAxisNumber(tick), padding.left - 46, y + 3, 8);
  });
  text(model.xLabel, padding.left + plotWidth / 2 - 45, height - 42, 10);
  addPdfRotatedText(
    commands,
    model.yLabel,
    22,
    padding.top + plotHeight / 2 + 45,
    10,
    height
  );
  text(`n = ${model.points.length}; x ${formatHistogramAxisNumber(model.xDataMin)}-${formatHistogramAxisNumber(model.xDataMax)}; y ${formatHistogramAxisNumber(model.yDataMin)}-${formatHistogramAxisNumber(model.yDataMax)}`, padding.left, height - 24, 10);

  if (model.mode === "groups") {
    let legendX = padding.left;
    const legendY = height - 48;
    model.groups
      .filter((group) => group.points.length > 0)
      .forEach((group) => {
        commands.push(`${hexToPdfRgb(group.groupColor)} rg ${legendX.toFixed(2)} ${pdfY(legendY).toFixed(2)} 8 8 re f`);
        text(group.groupName, legendX + 12, legendY + 8, 8);
        legendX += Math.min(110, 18 + group.groupName.length * 5);
      });
  }

  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index++) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function exportMeasureScatterPDF() {
  const model = buildMeasureScatterModel();
  if (model.points.length === 0) {
    alert("No plottable measurements to export.");
    return;
  }
  saveAs(createMeasureScatterPdf(model), "measurement-scatterplot.pdf");
}

const MEASURE_ROSE_DEFAULT_BIN_SIZE = 10;

function getMeasureRoseParameters() {
  return MEASURE_HISTOGRAM_PARAMETERS.filter(
    (parameter) => parameter.unit === "degrees"
  );
}

function renderMeasureRoseParameters() {
  if (!measureRoseParameter) return;
  const parameters = getMeasureRoseParameters();
  const previous = measureRoseParameter.value || parameters[0]?.id || "";
  measureRoseParameter.innerHTML = "";
  parameters.forEach((parameter) => {
    const option = document.createElement("option");
    option.value = parameter.id;
    option.textContent = parameter.label;
    measureRoseParameter.appendChild(option);
  });
  measureRoseParameter.value = parameters.some(
    (parameter) => parameter.id === previous
  )
    ? previous
    : parameters[0]?.id || "";
}

function getMeasureRoseParameter() {
  const parameters = getMeasureRoseParameters();
  const parameterId = measureRoseParameter?.value;
  return (
    parameters.find((parameter) => parameter.id === parameterId) ||
    parameters[0] ||
    null
  );
}

function getMeasureRoseMode() {
  return measureRoseMode?.value === "groups" ? "groups" : "combined";
}

function getMeasureRoseDefaultColor() {
  const color = measureRoseColorInput?.value || "#8a8f94";
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#8a8f94";
}

function getMeasureRoseBinSize() {
  const value = Number(measureRoseBinSizeInput?.value);
  if (!Number.isFinite(value) || value <= 0) return MEASURE_ROSE_DEFAULT_BIN_SIZE;
  return Math.min(90, value);
}

function isMeasureRoseBidirectional() {
  return measureRoseBidirectionalInput?.checked !== false;
}

function shouldStackMeasureRoseGroups() {
  return Boolean(measureRoseStackedInput?.checked);
}

function normalizeDegrees(value, range = 360) {
  if (!Number.isFinite(value) || range <= 0) return null;
  return ((value % range) + range) % range;
}

function syncMeasureRoseGroupSelection(groups) {
  const groupIds = new Set(groups.map((group) => group.groupId));
  groupIds.forEach((groupId) => {
    if (!measureRoseKnownGroupIds.has(groupId)) {
      measureRoseSelectedGroupIds.add(groupId);
    }
  });
  measureRoseKnownGroupIds = groupIds;
  measureRoseSelectedGroupIds = new Set(
    [...measureRoseSelectedGroupIds].filter((groupId) => groupIds.has(groupId))
  );
}

function renderMeasureRoseGroupControls() {
  if (!measureRoseGroups) return;
  const groups = getMeasureHistogramGroupsInUse();
  syncMeasureRoseGroupSelection(groups);
  measureRoseGroups.innerHTML = "";
  if (groups.length === 0) {
    measureRoseGroups.textContent = "No groups";
    return;
  }

  groups.forEach((group) => {
    const label = document.createElement("label");
    label.className = "measure-histogram-group";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = measureRoseSelectedGroupIds.has(group.groupId);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        measureRoseSelectedGroupIds.add(group.groupId);
      } else {
        measureRoseSelectedGroupIds.delete(group.groupId);
      }
      drawMeasureRose();
    });
    const swatch = createMeasureGroupColor(group);
    const name = document.createElement("span");
    name.textContent = group.groupName;
    label.append(checkbox, swatch, name);
    measureRoseGroups.appendChild(label);
  });
}

function getMeasureRoseAngles(parameter) {
  const groups = getMeasureHistogramGroupsInUse();
  syncMeasureRoseGroupSelection(groups);
  const groupedAngles = new Map(
    groups.map((group) => [
      group.groupId,
      {
        ...group,
        angles: [],
      },
    ])
  );

  if (!parameter) return { groups: [...groupedAngles.values()], angles: [] };

  getFilteredMeasureResults().forEach((result) => {
    const group = getMeasureGroupForResult(result);
    if (!measureRoseSelectedGroupIds.has(group.groupId)) return;
    const angle = getMeasureParameterValue(result, parameter);
    if (!Number.isFinite(angle)) return;
    const normalized = normalizeDegrees(angle);
    if (!Number.isFinite(normalized)) return;
    groupedAngles.get(group.groupId)?.angles.push(normalized);
  });

  const enabledGroups = [...groupedAngles.values()].filter((group) =>
    measureRoseSelectedGroupIds.has(group.groupId)
  );
  const angles = enabledGroups.flatMap((group) => group.angles);
  return { groups: enabledGroups, angles };
}

function createRoseBins(binSize) {
  const binCount = Math.max(1, Math.ceil(360 / binSize));
  const adjustedBinSize = 360 / binCount;
  return Array.from({ length: binCount }, (_, index) => {
    const min = index * adjustedBinSize;
    const max = min + adjustedBinSize;
    return {
      min,
      max,
      center: min + adjustedBinSize / 2,
      count: 0,
    };
  });
}

function addAngleToRoseBins(bins, angle, weight = 1) {
  const normalized = normalizeDegrees(angle);
  if (!Number.isFinite(normalized) || bins.length === 0) return;
  const binSize = 360 / bins.length;
  const index = Math.min(bins.length - 1, Math.floor(normalized / binSize));
  bins[index].count += weight;
}

function buildRoseDistribution(angles, binSize, bidirectional) {
  const bins = createRoseBins(binSize);
  angles.forEach((angle) => {
    if (bidirectional) {
      const orientation = normalizeDegrees(angle, 180);
      addAngleToRoseBins(bins, orientation, 0.5);
      addAngleToRoseBins(bins, orientation + 180, 0.5);
    } else {
      addAngleToRoseBins(bins, angle, 1);
    }
  });
  return bins;
}

function summarizeRoseAngles(angles, bidirectional) {
  const n = angles.length;
  if (n === 0) {
    return {
      n: 0,
      meanDeg: null,
      resultantLength: null,
      circularSdDeg: null,
    };
  }
  const multiplier = bidirectional ? 2 : 1;
  let sinSum = 0;
  let cosSum = 0;
  angles.forEach((angle) => {
    const radians = ((angle * multiplier) / 180) * Math.PI;
    sinSum += Math.sin(radians);
    cosSum += Math.cos(radians);
  });
  const meanRadians = Math.atan2(sinSum, cosSum) / multiplier;
  const meanRange = bidirectional ? 180 : 360;
  const meanDeg = normalizeDegrees((meanRadians * 180) / Math.PI, meanRange);
  const resultantLength = Math.min(
    1,
    Math.max(0, Math.sqrt(sinSum ** 2 + cosSum ** 2) / n)
  );
  const circularSdDeg =
    resultantLength > 0
      ? (Math.sqrt(-2 * Math.log(resultantLength)) * 180) /
        Math.PI /
        multiplier
      : null;
  return { n, meanDeg, resultantLength, circularSdDeg };
}

function buildMeasureRoseModel() {
  const parameter = getMeasureRoseParameter();
  const binSize = getMeasureRoseBinSize();
  const mode = getMeasureRoseMode();
  const bidirectional = isMeasureRoseBidirectional();
  const stacked = shouldStackMeasureRoseGroups();
  const { groups, angles } = getMeasureRoseAngles(parameter);
  const groupDistributions = groups.map((group) => ({
    ...group,
    bins: buildRoseDistribution(group.angles, binSize, bidirectional),
    stats: summarizeRoseAngles(group.angles, bidirectional),
  }));
  const combinedBins = buildRoseDistribution(angles, binSize, bidirectional);
  const combinedStats = summarizeRoseAngles(angles, bidirectional);
  let maxCount = Math.max(1, ...combinedBins.map((bin) => bin.count));
  if (mode === "groups") {
    if (stacked) {
      maxCount = Math.max(
        1,
        ...combinedBins.map((_, binIndex) =>
          groupDistributions.reduce(
            (sum, group) => sum + (group.bins[binIndex]?.count || 0),
            0
          )
        )
      );
    } else {
      maxCount = Math.max(
        1,
        ...groupDistributions.flatMap((group) =>
          group.bins.map((bin) => bin.count)
        )
      );
    }
  }

  return {
    parameter,
    parameterLabel: parameter
      ? getMeasureHistogramLabel(parameter)
      : "Long axis azimuth (°)",
    mode,
    bidirectional,
    stacked,
    binSize: 360 / Math.max(1, Math.ceil(360 / binSize)),
    defaultColor: getMeasureRoseDefaultColor(),
    groups: groupDistributions,
    angles,
    bins: combinedBins,
    stats: combinedStats,
    maxCount,
  };
}

function getMeasureRoseStatsRows(model = buildMeasureRoseModel()) {
  if (model.mode === "groups") {
    return model.groups
      .filter((group) => group.stats.n > 0)
      .map((group) => ({ set: group.groupName, ...group.stats }));
  }
  return model.stats.n > 0 ? [{ set: "Combined", ...model.stats }] : [];
}

function formatRoseStat(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "";
}

function renderMeasureRoseStats(model) {
  if (!measureRoseStatsBody) return;
  const rows = getMeasureRoseStatsRows(model);
  measureRoseStatsBody.innerHTML = "";
  if (rows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "No results";
    row.appendChild(cell);
    measureRoseStatsBody.appendChild(row);
    if (exportMeasureRoseStatsButton) exportMeasureRoseStatsButton.disabled = true;
    return;
  }
  rows.forEach((stats) => {
    const row = document.createElement("tr");
    [
      stats.set,
      stats.n,
      formatRoseStat(stats.meanDeg),
      formatRoseStat(stats.resultantLength, 3),
      formatRoseStat(stats.circularSdDeg),
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    measureRoseStatsBody.appendChild(row);
  });
  if (exportMeasureRoseStatsButton) exportMeasureRoseStatsButton.disabled = false;
}

function drawRoseWedge(ctx, cx, cy, innerRadius, outerRadius, startDeg, endDeg, color) {
  if (outerRadius <= innerRadius) return;
  const start = ((startDeg - 90) * Math.PI) / 180;
  const end = ((endDeg - 90) * Math.PI) / 180;
  ctx.beginPath();
  ctx.arc(cx, cy, outerRadius, start, end);
  if (innerRadius > 0) {
    ctx.arc(cx, cy, innerRadius, end, start, true);
  } else {
    ctx.lineTo(cx, cy);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 0.75;
  ctx.stroke();
}

function drawRoseDistribution(ctx, model, cx, cy, radius) {
  const groupsWithAngles = model.groups.filter((group) => group.angles.length > 0);
  if (model.mode === "groups" && groupsWithAngles.length > 0) {
    model.bins.forEach((_, binIndex) => {
      const binMin = binIndex * model.binSize;
      const binMax = binMin + model.binSize;
      if (model.stacked) {
        let innerRadius = 0;
        groupsWithAngles.forEach((group) => {
          const count = group.bins[binIndex]?.count || 0;
          const outerRadius = innerRadius + (count / model.maxCount) * radius;
          drawRoseWedge(
            ctx,
            cx,
            cy,
            innerRadius,
            Math.min(radius, outerRadius),
            binMin,
            binMax,
            getSafeMeasureGroupColor(group.groupColor)
          );
          innerRadius = outerRadius;
        });
      } else {
        const sliceSize = model.binSize / groupsWithAngles.length;
        groupsWithAngles.forEach((group, groupIndex) => {
          const count = group.bins[binIndex]?.count || 0;
          const outerRadius = (count / model.maxCount) * radius;
          drawRoseWedge(
            ctx,
            cx,
            cy,
            0,
            outerRadius,
            binMin + groupIndex * sliceSize,
            binMin + (groupIndex + 1) * sliceSize,
            getSafeMeasureGroupColor(group.groupColor)
          );
        });
      }
    });
    return;
  }

  model.bins.forEach((bin) => {
    const outerRadius = (bin.count / model.maxCount) * radius;
    drawRoseWedge(
      ctx,
      cx,
      cy,
      0,
      outerRadius,
      bin.min,
      bin.max,
      model.defaultColor
    );
  });
}

function drawRoseToCanvas(ctx, model, width, height) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height / 2 + 8;
  const radius = Math.max(40, Math.min(width - 90, height - 62) / 2);

  ctx.fillStyle = "#222";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${model.parameterLabel} Rose Diagram`, cx, 17);

  ctx.strokeStyle = "#d8d8d8";
  ctx.lineWidth = 1;
  [0.25, 0.5, 0.75, 1].forEach((fraction) => {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * fraction, 0, Math.PI * 2);
    ctx.stroke();
  });
  for (let angle = 0; angle < 360; angle += 45) {
    const radians = ((angle - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(radians) * radius, cy + Math.sin(radians) * radius);
    ctx.stroke();
  }

  if (model.angles.length === 0) {
    ctx.fillStyle = "#777";
    ctx.font = "12px sans-serif";
    ctx.fillText("No plottable azimuth measurements", cx, cy);
  } else {
    drawRoseDistribution(ctx, model, cx, cy, radius);
  }

  ctx.fillStyle = "#333";
  ctx.font = "10px sans-serif";
  ctx.fillText("0°", cx, cy - radius - 7);
  ctx.fillText("90°", cx + radius + 17, cy + 3);
  ctx.fillText("180°", cx, cy + radius + 15);
  ctx.fillText("270°", cx - radius - 19, cy + 3);
  ctx.textAlign = "left";
  ctx.fillText(`Bin ${formatHistogramAxisNumber(model.binSize)}°`, 10, height - 10);
  ctx.textAlign = "right";
  ctx.fillText(
    model.bidirectional ? "Bidirectional" : "Directional",
    width - 10,
    height - 10
  );
}

function drawMeasureRose() {
  if (!measureRoseCanvas || measureRoseMenu?.hidden) return null;
  const model = buildMeasureRoseModel();
  const rect = measureRoseCanvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.round(rect.width));
  const height = Math.max(200, Math.round(rect.height));
  measureRoseCanvas.width = Math.round(width * ratio);
  measureRoseCanvas.height = Math.round(height * ratio);
  const ctx = measureRoseCanvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawRoseToCanvas(ctx, model, width, height);
  renderMeasureRoseStats(model);
  if (exportMeasureRoseButton) {
    exportMeasureRoseButton.disabled = model.angles.length === 0;
  }
  return model;
}

function renderMeasureRoseMenu() {
  if (!measureRoseMenu || measureRoseMenu.hidden) return;
  renderMeasureRoseParameters();
  renderMeasureRoseGroupControls();
  updateMeasureRoseControlState();
  drawMeasureRose();
}

function updateMeasureRoseControlState() {
  if (measureRoseStackedInput) {
    measureRoseStackedInput.disabled = getMeasureRoseMode() !== "groups";
  }
}

function updateMeasureRoseAvailability() {
  if (!measureRoseButton) return;
  const parameter = getMeasureRoseParameters()[0];
  const hasAngles = getFilteredMeasureResults().some((result) => {
    const value = getMeasureParameterValue(result, parameter);
    return Number.isFinite(value);
  });
  measureRoseButton.disabled = !parameter || !hasAngles;
}

function openMeasureRoseMenu(button) {
  if (!measureRoseMenu || !button) return;
  if (measureRoseMenu.parentElement !== document.body) {
    document.body.appendChild(measureRoseMenu);
  }
  renderMeasureRoseParameters();
  renderMeasureRoseGroupControls();
  updateMeasureRoseControlState();
  measureRoseMenu.hidden = false;
  measureRoseButton?.setAttribute("aria-expanded", "true");
  positionFixedAnalysisMenu(measureRoseMenu, button);
  drawMeasureRose();
}

function closeMeasureRoseMenu() {
  if (!measureRoseMenu) return;
  measureRoseMenu.hidden = true;
  measureRoseButton?.setAttribute("aria-expanded", "false");
}

function exportMeasureRoseStatsCSV() {
  const model = buildMeasureRoseModel();
  const rows = getMeasureRoseStatsRows(model);
  if (rows.length === 0) {
    alert("No rose diagram statistics to export.");
    return;
  }
  const headers = [
    "set",
    "n",
    "parameter",
    "bidirectional",
    "bin_deg",
    "mean_deg",
    "resultant_length",
    "circular_sd_deg",
  ];
  const csvRows = rows.map((row) => [
    row.set,
    row.n,
    model.parameter?.label || "",
    model.bidirectional ? "true" : "false",
    model.binSize,
    row.meanDeg ?? "",
    row.resultantLength ?? "",
    row.circularSdDeg ?? "",
  ]);
  const csv = [headers, ...csvRows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
  saveAs(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    "rose-diagram-statistics.csv"
  );
}

function addPdfPolygon(commands, points, color) {
  if (points.length < 3) return;
  commands.push(`${hexToPdfRgb(color)} rg`);
  commands.push(
    `${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} m ` +
      points
        .slice(1)
        .map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)} l`)
        .join(" ") +
      " h f"
  );
}

function addPdfRoseWedge(commands, pageHeight, cx, cy, innerRadius, outerRadius, startDeg, endDeg, color) {
  if (outerRadius <= innerRadius) return;
  const steps = Math.max(3, Math.ceil(Math.abs(endDeg - startDeg) / 5));
  const points = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = startDeg + ((endDeg - startDeg) * index) / steps;
    const radians = ((angle - 90) * Math.PI) / 180;
    points.push({
      x: cx + Math.cos(radians) * outerRadius,
      y: pageHeight - (cy + Math.sin(radians) * outerRadius),
    });
  }
  if (innerRadius > 0) {
    for (let index = steps; index >= 0; index -= 1) {
      const angle = startDeg + ((endDeg - startDeg) * index) / steps;
      const radians = ((angle - 90) * Math.PI) / 180;
      points.push({
        x: cx + Math.cos(radians) * innerRadius,
        y: pageHeight - (cy + Math.sin(radians) * innerRadius),
      });
    }
  } else {
    points.push({ x: cx, y: pageHeight - cy });
  }
  addPdfPolygon(commands, points, color);
}

function addPdfCircleApprox(commands, pageHeight, cx, cy, radius) {
  const points = [];
  for (let index = 0; index <= 72; index += 1) {
    const radians = (index / 72) * Math.PI * 2;
    points.push({
      x: cx + Math.cos(radians) * radius,
      y: pageHeight - (cy + Math.sin(radians) * radius),
    });
  }
  if (points.length === 0) return;
  commands.push(
    `${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} m ` +
      points
        .slice(1)
        .map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)} l`)
        .join(" ") +
      " S"
  );
}

function createMeasureRosePdf(model) {
  const width = 612;
  const height = 432;
  const commands = [];
  const cx = width / 2;
  const cy = 178;
  const radius = 118;
  commands.push("1 1 1 rg 0 0 612 432 re f");
  addPdfText(commands, `${model.parameterLabel} Rose Diagram`, 226, 28, 13, height);
  commands.push("0.82 0.82 0.82 RG 1 w");
  [0.25, 0.5, 0.75, 1].forEach((fraction) => {
    addPdfCircleApprox(commands, height, cx, cy, radius * fraction);
  });
  for (let angle = 0; angle < 360; angle += 45) {
    const radians = ((angle - 90) * Math.PI) / 180;
    const x = cx + Math.cos(radians) * radius;
    const y = cy + Math.sin(radians) * radius;
    commands.push(
      `${cx.toFixed(2)} ${(height - cy).toFixed(2)} m ${x.toFixed(2)} ${(height - y).toFixed(2)} l S`
    );
  }
  if (model.angles.length > 0) {
    const groupsWithAngles = model.groups.filter((group) => group.angles.length > 0);
    if (model.mode === "groups" && groupsWithAngles.length > 0) {
      model.bins.forEach((_, binIndex) => {
        const binMin = binIndex * model.binSize;
        const binMax = binMin + model.binSize;
        if (model.stacked) {
          let innerRadius = 0;
          groupsWithAngles.forEach((group) => {
            const count = group.bins[binIndex]?.count || 0;
            const outerRadius = Math.min(
              radius,
              innerRadius + (count / model.maxCount) * radius
            );
            addPdfRoseWedge(
              commands,
              height,
              cx,
              cy,
              innerRadius,
              outerRadius,
              binMin,
              binMax,
              getSafeMeasureGroupColor(group.groupColor)
            );
            innerRadius = outerRadius;
          });
        } else {
          const sliceSize = model.binSize / groupsWithAngles.length;
          groupsWithAngles.forEach((group, groupIndex) => {
            const count = group.bins[binIndex]?.count || 0;
            addPdfRoseWedge(
              commands,
              height,
              cx,
              cy,
              0,
              (count / model.maxCount) * radius,
              binMin + groupIndex * sliceSize,
              binMin + (groupIndex + 1) * sliceSize,
              getSafeMeasureGroupColor(group.groupColor)
            );
          });
        }
      });
    } else {
      model.bins.forEach((bin) => {
        addPdfRoseWedge(
          commands,
          height,
          cx,
          cy,
          0,
          (bin.count / model.maxCount) * radius,
          bin.min,
          bin.max,
          model.defaultColor
        );
      });
    }
  } else {
    addPdfText(commands, "No plottable azimuth measurements", 228, cy, 11, height);
  }
  addPdfText(commands, "0 deg", cx - 12, cy - radius - 12, 9, height);
  addPdfText(commands, "90 deg", cx + radius + 10, cy + 3, 9, height);
  addPdfText(commands, "180 deg", cx - 16, cy + radius + 18, 9, height);
  addPdfText(commands, "270 deg", cx - radius - 40, cy + 3, 9, height);
  addPdfText(
    commands,
    `Bin ${formatHistogramAxisNumber(model.binSize)} deg; ${model.bidirectional ? "Bidirectional" : "Directional"}`,
    42,
    332,
    10,
    height
  );
  addPdfText(commands, "Set", 42, 356, 9, height);
  addPdfText(commands, "n", 190, 356, 9, height);
  addPdfText(commands, "Mean deg", 232, 356, 9, height);
  addPdfText(commands, "R", 316, 356, 9, height);
  addPdfText(commands, "Circular SD deg", 370, 356, 9, height);
  getMeasureRoseStatsRows(model).slice(0, 5).forEach((row, index) => {
    const y = 374 + index * 14;
    addPdfText(commands, row.set.slice(0, 24), 42, y, 9, height);
    addPdfText(commands, String(row.n), 190, y, 9, height);
    addPdfText(commands, formatRoseStat(row.meanDeg), 232, y, 9, height);
    addPdfText(commands, formatRoseStat(row.resultantLength, 3), 316, y, 9, height);
    addPdfText(commands, formatRoseStat(row.circularSdDeg), 370, y, 9, height);
  });

  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index++) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function exportMeasureRosePDF() {
  const model = buildMeasureRoseModel();
  if (model.angles.length === 0) {
    alert("No plottable azimuth measurements to export.");
    return;
  }
  saveAs(createMeasureRosePdf(model), "measurement-rose-diagram.pdf");
}

function getParticleSizeParameterInfo() {
  const parameterId = measureParticleSizeParameter?.value || "ecdM";
  if (parameterId === "longAxisM") {
    return { id: "longAxisM", label: "Long axis" };
  }
  if (parameterId === "shortAxisM") {
    return { id: "shortAxisM", label: "Short axis" };
  }
  if (parameterId === "maxFeretM") {
    return { id: "maxFeretM", label: "Max Feret" };
  }
  if (parameterId === "minFeretM") {
    return { id: "minFeretM", label: "Min Feret" };
  }
  return { id: "ecdM", label: "ECD" };
}

function getParticleSizeWeightMode() {
  return measureParticleSizeWeight?.value === "none" ? "none" : "area";
}

function getParticleSizeMode() {
  return measureParticleSizeMode?.value === "groups" ? "groups" : "combined";
}

function shouldShowParticleHistogram() {
  return measureParticleShowHistogram?.checked !== false;
}

function shouldShowParticleCumulative() {
  return measureParticleShowCumulative?.checked !== false;
}

function shouldStackParticleHistograms() {
  return Boolean(measureParticleStacked?.checked);
}

function getParticleSizeDefaultColor() {
  const color = measureParticleColorInput?.value || "#8a8f94";
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#8a8f94";
}

function getParticleSizeMeasurements() {
  const parameter = getParticleSizeParameterInfo();
  return getFilteredMeasureResults()
    .map((result) => {
      const sizeM =
        parameter.id === "longAxisM"
          ? getLongAxisM(result)
          : parameter.id === "shortAxisM"
            ? getShortAxisM(result)
            : result[parameter.id];
      const sizeMm = Number.isFinite(sizeM)
        ? sizeM * 1000
        : null;
      const areaMm2 = Number.isFinite(result.areaM2) ? result.areaM2 * 1e6 : null;
      if (
        !Number.isFinite(sizeMm) ||
        sizeMm <= 0 ||
        result.validGeometry === false
      ) {
        return null;
      }
      return {
        sizeMm,
        sizeMicrons: sizeMm * 1000,
        phi: -Math.log2(sizeMm),
        areaMm2: Number.isFinite(areaMm2) && areaMm2 > 0 ? areaMm2 : 0,
        group: getMeasureGroupForResult(result),
      };
    })
    .filter(Boolean);
}

function getParticleSizeGroupsInUse(measurements) {
  const groups = new Map();
  measurements.forEach((measurement) => {
    groups.set(measurement.group.groupId, measurement.group);
  });
  return [...groups.values()].sort((a, b) =>
    a.groupName.localeCompare(b.groupName)
  );
}

function syncParticleSizeGroupSelection(groups) {
  const groupIds = new Set(groups.map((group) => group.groupId));
  groupIds.forEach((groupId) => {
    if (!measureParticleSizeKnownGroupIds.has(groupId)) {
      measureParticleSizeSelectedGroupIds.add(groupId);
    }
  });
  measureParticleSizeKnownGroupIds = groupIds;
  measureParticleSizeSelectedGroupIds = new Set(
    [...measureParticleSizeSelectedGroupIds].filter((groupId) =>
      groupIds.has(groupId)
    )
  );
}

function renderParticleSizeGroupControls(measurements = getParticleSizeMeasurements()) {
  if (!measureParticleSizeGroups) return;
  const groups = getParticleSizeGroupsInUse(measurements);
  syncParticleSizeGroupSelection(groups);
  measureParticleSizeGroups.innerHTML = "";
  if (groups.length === 0) {
    measureParticleSizeGroups.textContent = "No groups";
    return;
  }
  groups.forEach((group) => {
    const label = document.createElement("label");
    label.className = "measure-histogram-group";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = measureParticleSizeSelectedGroupIds.has(group.groupId);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        measureParticleSizeSelectedGroupIds.add(group.groupId);
      } else {
        measureParticleSizeSelectedGroupIds.delete(group.groupId);
      }
      drawMeasureParticleSize();
    });
    const swatch = createMeasureGroupColor(group);
    const name = document.createElement("span");
    name.textContent = group.groupName;
    label.append(checkbox, swatch, name);
    measureParticleSizeGroups.appendChild(label);
  });
}

function getParticleSizeCategory(phi) {
  if (!Number.isFinite(phi)) return "";
  if (phi < -11) return "Very large boulders";
  if (phi < -10) return "Large boulders";
  if (phi < -9) return "Medium boulders";
  if (phi < -8) return "Small boulders";
  if (phi < -7) return "Large cobbles";
  if (phi < -6) return "Small cobbles";
  if (phi < -5) return "Very coarse pebbles";
  if (phi < -4) return "Coarse pebbles";
  if (phi < -3) return "Medium pebbles";
  if (phi < -2) return "Fine pebbles";
  if (phi < -1) return "Very fine pebbles";
  if (phi < -0.5) return "Upper very coarse sand";
  if (phi < 0) return "Lower very coarse sand";
  if (phi < 0.5) return "Upper coarse sand";
  if (phi < 1) return "Lower coarse sand";
  if (phi < 1.5) return "Upper medium sand";
  if (phi < 2) return "Lower medium sand";
  if (phi < 2.5) return "Upper fine sand";
  if (phi < 3) return "Lower fine sand";
  if (phi < 3.5) return "Upper very fine sand";
  if (phi < 4) return "Lower very fine sand";
  if (phi < 5) return "Very coarse silt";
  if (phi < 6) return "Coarse silt";
  if (phi < 7) return "Medium silt";
  if (phi < 8) return "Fine silt";
  if (phi < 9) return "Very fine silt";
  return "Clay";
}

function getParticleSortingCategory(value) {
  if (!Number.isFinite(value)) return "";
  if (value < 0.35) return "Very well sorted";
  if (value < 0.5) return "Well sorted";
  if (value < 0.7) return "Moderately well sorted";
  if (value < 1) return "Moderately sorted";
  if (value < 2) return "Poorly sorted";
  if (value < 4) return "Very poorly sorted";
  return "Extremely poorly sorted";
}

function getParticleSkewnessCategory(value) {
  if (!Number.isFinite(value)) return "";
  if (value >= 1.3) return "Very fine skewed";
  if (value >= 0.43) return "Fine skewed";
  if (value >= -0.43) return "Symmetrical";
  if (value >= -1.3) return "Coarse skewed";
  return "Very coarse skewed";
}

function updateParticleSizeRangeInputs(defaults) {
  if (
    !measureParticlePhiMinInput ||
    !measureParticlePhiMaxInput ||
    !measureParticlePhiBinInput ||
    measureParticleSizeRangeEdited
  ) {
    return;
  }
  measureParticlePhiMinInput.value = formatHistogramInputValue(defaults.phiMin);
  measureParticlePhiMaxInput.value = formatHistogramInputValue(defaults.phiMax);
  measureParticlePhiBinInput.value = formatHistogramInputValue(defaults.binSize);
}

function buildParticleDistribution(measurements, weightMode, phiMin, phiMax, binSize) {
  const binCount = Math.min(200, Math.max(1, Math.ceil((phiMax - phiMin) / binSize)));
  const adjustedPhiMax = phiMin + binCount * binSize;
  const bins = Array.from({ length: binCount }, (_, index) => {
    const min = phiMin + index * binSize;
    const max = min + binSize;
    return {
      min,
      max,
      center: min + binSize / 2,
      areaMm2: 0,
      count: 0,
      weight: 0,
    };
  });

  let totalWeight = 0;
  measurements.forEach((measurement) => {
    const weight = weightMode === "area" ? measurement.areaMm2 : 1;
    if (!Number.isFinite(weight) || weight <= 0) return;
    totalWeight += weight;
    if (measurement.phi < phiMin || measurement.phi > adjustedPhiMax) return;
    const index = Math.min(
      binCount - 1,
      Math.max(0, Math.floor((measurement.phi - phiMin) / binSize))
    );
    bins[index].areaMm2 += measurement.areaMm2;
    bins[index].count += 1;
    bins[index].weight += weight;
  });
  const binnedWeight = bins.reduce((sum, bin) => sum + bin.weight, 0);
  const meanPhi =
    binnedWeight > 0
      ? bins.reduce((sum, bin) => sum + bin.center * (bin.weight / binnedWeight), 0)
      : null;
  const sortingPhi =
    binnedWeight > 0 && Number.isFinite(meanPhi)
      ? Math.sqrt(
          bins.reduce(
            (sum, bin) =>
              sum + (bin.weight / binnedWeight) * (bin.center - meanPhi) ** 2,
            0
          )
        )
      : null;
  const skewnessPhi =
    Number.isFinite(sortingPhi) && sortingPhi > 0
      ? bins.reduce(
          (sum, bin) =>
            sum + (bin.weight / binnedWeight) * (bin.center - meanPhi) ** 3,
          0
        ) /
        sortingPhi ** 3
      : null;
  const sorted = [...measurements].sort((a, b) => a.phi - b.phi);
  let cumulativeWeight = 0;
  const cumulative = [];
  if (sorted.length > 0 && totalWeight > 0) {
    sorted.forEach((measurement) => {
      const weight = weightMode === "area" ? measurement.areaMm2 : 1;
      cumulativeWeight += Number.isFinite(weight) && weight > 0 ? weight : 0;
      cumulative.push({
        phi: measurement.phi,
        fraction: cumulativeWeight / totalWeight,
      });
    });
  }

  return {
    measurements,
    bins,
    cumulative,
    totalWeight,
    binnedWeight,
    phiMin,
    phiMax: adjustedPhiMax,
    binSize,
    meanPhi,
    sortingPhi,
    skewnessPhi,
  };
}

function buildParticleSizeModel() {
  const parameter = getParticleSizeParameterInfo();
  const weightMode = getParticleSizeWeightMode();
  const allMeasurements = getParticleSizeMeasurements();
  const groupsInUse = getParticleSizeGroupsInUse(allMeasurements);
  syncParticleSizeGroupSelection(groupsInUse);
  const measurements = allMeasurements.filter((measurement) =>
    measureParticleSizeSelectedGroupIds.has(measurement.group.groupId)
  );
  const phiValues = measurements.map((measurement) => measurement.phi);
  const defaultPhiMin =
    phiValues.length > 0 ? Math.floor(Math.min(...phiValues)) : -6;
  const defaultPhiMax =
    phiValues.length > 0 ? Math.ceil(Math.max(...phiValues)) : 8;
  const defaultBinSize = 0.25;
  updateParticleSizeRangeInputs({
    phiMin: defaultPhiMin,
    phiMax: defaultPhiMax,
    binSize: defaultBinSize,
  });
  let phiMin = measureParticleSizeRangeEdited
    ? getMeasureHistogramNumberInputValue(measureParticlePhiMinInput)
    : null;
  let phiMax = measureParticleSizeRangeEdited
    ? getMeasureHistogramNumberInputValue(measureParticlePhiMaxInput)
    : null;
  let binSize = measureParticleSizeRangeEdited
    ? getMeasureHistogramNumberInputValue(measureParticlePhiBinInput)
    : null;
  phiMin = Number.isFinite(phiMin) ? phiMin : defaultPhiMin;
  phiMax = Number.isFinite(phiMax) ? phiMax : defaultPhiMax;
  binSize = Number.isFinite(binSize) && binSize > 0 ? binSize : defaultBinSize;
  if (phiMax <= phiMin) {
    phiMin = defaultPhiMin;
    phiMax = defaultPhiMax;
  }
  const combined = buildParticleDistribution(
    measurements,
    weightMode,
    phiMin,
    phiMax,
    binSize
  );
  phiMax = combined.phiMax;
  const groupDistributions = groupsInUse
    .filter((group) => measureParticleSizeSelectedGroupIds.has(group.groupId))
    .map((group) => ({
      ...group,
      ...buildParticleDistribution(
        measurements.filter(
          (measurement) => measurement.group.groupId === group.groupId
        ),
        weightMode,
        phiMin,
        phiMax,
        binSize
      ),
    }));

  return {
    parameter,
    weightMode,
    mode: getParticleSizeMode(),
    defaultColor: getParticleSizeDefaultColor(),
    showHistogram: shouldShowParticleHistogram(),
    showCumulative: shouldShowParticleCumulative(),
    stacked: shouldStackParticleHistograms(),
    yAxisLabel: weightMode === "area" ? "% total area" : "Count",
    allMeasurements,
    measurements,
    groups: groupDistributions,
    bins: combined.bins,
    cumulative: combined.cumulative,
    totalWeight: combined.totalWeight,
    binnedWeight: combined.binnedWeight,
    phiMin,
    phiMax,
    binSize,
    meanPhi: combined.meanPhi,
    sortingPhi: combined.sortingPhi,
    skewnessPhi: combined.skewnessPhi,
    meanCategory: getParticleSizeCategory(combined.meanPhi),
    sortingCategory: getParticleSortingCategory(combined.sortingPhi),
    skewnessCategory: getParticleSkewnessCategory(combined.skewnessPhi),
  };
}

function traceParticleCumulativeStepPath(ctx, cumulative, model, xScale, yScale) {
  if (cumulative.length === 0) return false;
  const startFraction = cumulative.reduce(
    (fraction, point) => (point.phi < model.phiMin ? point.fraction : fraction),
    0
  );
  let currentFraction = startFraction;
  ctx.beginPath();
  ctx.moveTo(xScale(model.phiMin), yScale(currentFraction));
  cumulative.forEach((point) => {
    if (point.phi < model.phiMin) return;
    if (point.phi > model.phiMax) return;
    const x = xScale(point.phi);
    ctx.lineTo(x, yScale(currentFraction));
    ctx.lineTo(x, yScale(point.fraction));
    currentFraction = point.fraction;
  });
  ctx.lineTo(xScale(model.phiMax), yScale(currentFraction));
  return true;
}

function drawParticleSizeToCanvas(ctx, model, width, height) {
  const padding = { left: 46, top: 22, right: 46, bottom: 44 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const xScale = (phi) =>
    padding.left + ((phi - model.phiMin) / (model.phiMax - model.phiMin)) * plotWidth;
  const yScale = (fraction) => padding.top + plotHeight - fraction * plotHeight;
  const getBinDisplayValue = (bin) =>
    model.weightMode === "area" && model.totalWeight > 0
      ? (bin.weight / model.totalWeight) * 100
      : bin.weight;
  const activeGroups = model.groups.filter((group) => group.binnedWeight > 0);
  const yMax = model.showHistogram
    ? Math.max(
        1,
        ...model.bins.map((bin, binIndex) => {
          if (model.mode !== "groups") return getBinDisplayValue(bin);
          if (model.stacked) {
            return activeGroups.reduce(
              (sum, group) => sum + getBinDisplayValue(group.bins[binIndex]),
              0
            );
          }
          return Math.max(
            0,
            ...activeGroups.map((group) => getBinDisplayValue(group.bins[binIndex]))
          );
        })
      )
    : 1;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#bdbdbd";
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  ctx.strokeStyle = "#444";
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + plotHeight);
  ctx.lineTo(padding.left + plotWidth, padding.top + plotHeight);
  ctx.stroke();
  if (model.showCumulative) {
    ctx.beginPath();
    ctx.moveTo(padding.left + plotWidth, padding.top);
    ctx.lineTo(padding.left + plotWidth, padding.top + plotHeight);
    ctx.stroke();
  }

  ctx.fillStyle = "#222";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${model.weightMode === "area" ? "Area-weighted" : "Unweighted"} ${model.parameter.label} grain size`, padding.left + plotWidth / 2, 15);

  if (model.measurements.length === 0 || model.binnedWeight <= 0) {
    ctx.fillStyle = "#666";
    ctx.fillText(`No valid ${model.parameter.label} measurements`, width / 2, height / 2);
    return;
  }

  if (!model.showHistogram && !model.showCumulative) {
    ctx.fillStyle = "#666";
    ctx.fillText("Select histogram or cumulative", width / 2, height / 2);
    return;
  }

  if (model.showHistogram) {
    model.bins.forEach((bin, binIndex) => {
      const x = xScale(bin.min);
      const nextX = xScale(bin.max);
      const fullBarWidth = Math.max(1, nextX - x - 1);
      if (model.mode === "groups") {
        if (model.stacked) {
          let stackedOffset = 0;
          activeGroups.forEach((group) => {
            const barHeight =
              (getBinDisplayValue(group.bins[binIndex]) / yMax) * plotHeight;
            ctx.fillStyle = getSafeMeasureGroupColor(group.groupColor);
            ctx.globalAlpha = 0.78;
            ctx.fillRect(
              x,
              padding.top + plotHeight - stackedOffset - barHeight,
              fullBarWidth,
              barHeight
            );
            ctx.globalAlpha = 1;
            ctx.strokeStyle = "#000";
            ctx.strokeRect(
              x,
              padding.top + plotHeight - stackedOffset - barHeight,
              fullBarWidth,
              barHeight
            );
            stackedOffset += barHeight;
          });
        } else {
          const groupWidth = fullBarWidth / Math.max(1, activeGroups.length);
          activeGroups.forEach((group, groupIndex) => {
            const barHeight =
              (getBinDisplayValue(group.bins[binIndex]) / yMax) * plotHeight;
            ctx.fillStyle = getSafeMeasureGroupColor(group.groupColor);
            ctx.globalAlpha = 0.72;
            ctx.fillRect(
              x + groupIndex * groupWidth,
              padding.top + plotHeight - barHeight,
              Math.max(1, groupWidth - 1),
              barHeight
            );
            ctx.globalAlpha = 1;
            ctx.strokeStyle = "#000";
            ctx.strokeRect(
              x + groupIndex * groupWidth,
              padding.top + plotHeight - barHeight,
              Math.max(1, groupWidth - 1),
              barHeight
            );
          });
        }
        ctx.globalAlpha = 1;
      } else {
        const barHeight = (getBinDisplayValue(bin) / yMax) * plotHeight;
        ctx.fillStyle = model.defaultColor;
        ctx.fillRect(x, padding.top + plotHeight - barHeight, fullBarWidth, barHeight);
        ctx.strokeStyle = "#000";
        ctx.strokeRect(x, padding.top + plotHeight - barHeight, fullBarWidth, barHeight);
      }
    });
  }

  if (model.showCumulative) {
    const drawCumulative = (cumulative, color) => {
      if (cumulative.length === 0) return;
      ctx.lineJoin = "round";
      if (traceParticleCumulativeStepPath(ctx, cumulative, model, xScale, yScale)) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3.6;
        ctx.stroke();
      }
      if (!traceParticleCumulativeStepPath(ctx, cumulative, model, xScale, yScale)) {
        return;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.7;
      ctx.stroke();
      ctx.lineJoin = "miter";
    };
    if (model.mode === "groups") {
      activeGroups.forEach((group) =>
        drawCumulative(group.cumulative, getSafeMeasureGroupColor(group.groupColor))
      );
    } else {
      drawCumulative(model.cumulative, model.defaultColor);
    }
  }

  if (Number.isFinite(model.meanPhi)) {
    const x = xScale(model.meanPhi);
    ctx.strokeStyle = "#d12f2f";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + plotHeight);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = "#333";
  ctx.font = "10px sans-serif";
  if (model.showHistogram) {
    ctx.save();
    ctx.translate(12, padding.top + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText(model.yAxisLabel, 0, 0);
    ctx.restore();
  }
  if (model.showHistogram) {
    ctx.fillText(
      model.weightMode === "area"
        ? `${formatHistogramAxisNumber(yMax)}%`
        : formatHistogramAxisNumber(yMax),
      padding.left - 5,
      padding.top + 4
    );
    ctx.fillText("0", padding.left - 5, padding.top + plotHeight + 3);
  }
  if (model.showCumulative) {
    ctx.textAlign = "left";
    ctx.fillText("100%", padding.left + plotWidth + 5, padding.top + 4);
    ctx.fillText("0", padding.left + plotWidth + 5, padding.top + plotHeight + 3);
  }
  ctx.textAlign = "center";
  ctx.fillText(`${model.parameter.label} (ɸ)`, padding.left + plotWidth / 2, height - 10);

  const firstTick = Math.ceil(model.phiMin);
  const lastTick = Math.floor(model.phiMax);
  ctx.strokeStyle = "#777";
  ctx.fillStyle = "#333";
  ctx.textAlign = "center";
  for (let tick = firstTick; tick <= lastTick; tick += 1) {
    const x = xScale(tick);
    ctx.beginPath();
    ctx.moveTo(x, padding.top + plotHeight);
    ctx.lineTo(x, padding.top + plotHeight + 4);
    ctx.stroke();
    ctx.fillText(String(tick), x, padding.top + plotHeight + 28);
  }
}

function getParticleSizeStatsRows(model) {
  const makeRow = (set, distribution) => ({
    set,
    n: distribution.measurements.length,
    meanPhi: distribution.meanPhi,
    meanCategory: getParticleSizeCategory(distribution.meanPhi),
    sortingPhi: distribution.sortingPhi,
    sortingCategory: getParticleSortingCategory(distribution.sortingPhi),
    skewnessPhi: distribution.skewnessPhi,
    skewnessCategory: getParticleSkewnessCategory(distribution.skewnessPhi),
  });
  if (model.mode === "groups") {
    return model.groups
      .filter((group) => group.binnedWeight > 0)
      .map((group) => makeRow(group.groupName, group));
  }
  return [makeRow("Combined", model)].filter((row) => row.n > 0);
}

function getParticleMeasurementWeight(measurement, weightMode) {
  return weightMode === "area" ? measurement.areaMm2 : 1;
}

function getWeightedParticlePhiPercentile(measurements, weightMode, probability) {
  const weighted = measurements
    .map((measurement) => ({
      phi: measurement.phi,
      weight: getParticleMeasurementWeight(measurement, weightMode),
    }))
    .filter(
      (entry) =>
        Number.isFinite(entry.phi) &&
        Number.isFinite(entry.weight) &&
        entry.weight > 0
    )
    .sort((a, b) => a.phi - b.phi);
  if (weighted.length === 0) return null;
  if (probability <= 0) return weighted[0].phi;
  if (probability >= 1) return weighted[weighted.length - 1].phi;
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  const targetWeight = probability * totalWeight;
  let cumulativeWeight = 0;
  let previousPhi = weighted[0].phi;
  for (const entry of weighted) {
    const nextCumulativeWeight = cumulativeWeight + entry.weight;
    if (targetWeight <= nextCumulativeWeight) {
      const span = nextCumulativeWeight - cumulativeWeight;
      const fraction = span > 0 ? (targetWeight - cumulativeWeight) / span : 0;
      return previousPhi + (entry.phi - previousPhi) * fraction;
    }
    cumulativeWeight = nextCumulativeWeight;
    previousPhi = entry.phi;
  }
  return weighted[weighted.length - 1].phi;
}

function getParticleSizeExportRows(model) {
  const statsRows = getParticleSizeStatsRows(model);
  const distributions =
    model.mode === "groups"
      ? model.groups
          .filter((group) => group.binnedWeight > 0)
          .map((group) => [group.groupName, group])
      : [["Combined", model]];
  const distributionMap = new Map(distributions);
  const allPercentiles = Array.from({ length: 99 }, (_, index) => index + 1);
  return statsRows.map((stats) => {
    const distribution = distributionMap.get(stats.set);
    const row = {
      set: stats.set,
      n: stats.n,
      size_parameter: model.parameter.label,
      weight_mode: model.weightMode,
      mean_phi: stats.meanPhi,
      mean_class: stats.meanCategory,
      sorting_phi: stats.sortingPhi,
      sorting_class: stats.sortingCategory,
      skewness: stats.skewnessPhi,
      skewness_class: stats.skewnessCategory,
    };
    allPercentiles.forEach((percentileValue) => {
      const phi = getWeightedParticlePhiPercentile(
        distribution?.measurements || [],
        model.weightMode,
        percentileValue / 100
      );
      const key = `d${String(percentileValue).padStart(2, "0")}`;
      row[`${key}_phi`] = phi;
    });
    return row;
  });
}

function renderMeasureParticleSizeStats(model) {
  if (!measureParticleSizeStatsBody) return;
  const rows = getParticleSizeStatsRows(model);
  measureParticleSizeStatsBody.innerHTML = "";
  if (rows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.textContent = "No valid particle size measurements";
    row.appendChild(cell);
    measureParticleSizeStatsBody.appendChild(row);
    if (exportMeasureParticleSizeStatsButton) {
      exportMeasureParticleSizeStatsButton.disabled = true;
    }
    return;
  }
  rows.forEach((stats) => {
    const row = document.createElement("tr");
    [
      stats.set,
      stats.n,
      formatSummaryStat(stats.meanPhi),
      stats.meanCategory,
      formatSummaryStat(stats.sortingPhi),
      stats.sortingCategory,
      formatSummaryStat(stats.skewnessPhi),
      stats.skewnessCategory,
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    measureParticleSizeStatsBody.appendChild(row);
  });
  if (exportMeasureParticleSizeStatsButton) {
    exportMeasureParticleSizeStatsButton.disabled = false;
  }
}

function exportMeasureParticleSizeStatsCSV() {
  const model = buildParticleSizeModel();
  const rows = getParticleSizeExportRows(model);
  if (rows.length === 0) {
    alert("No particle size statistics to export.");
    return;
  }
  const allPercentiles = Array.from({ length: 99 }, (_, index) => index + 1);
  const headers = [
    "set",
    "n",
    "size_parameter",
    "weight_mode",
    "mean_phi",
    "mean_class",
    "sorting_phi",
    "sorting_class",
    "skewness",
    "skewness_class",
    ...allPercentiles.map((percentileValue) => {
      const key = `d${String(percentileValue).padStart(2, "0")}`;
      return `${key}_phi`;
    }),
  ];
  const csvRows = rows.map((row) => headers.map((header) => row[header] ?? ""));
  const csv = [headers, ...csvRows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
  saveAs(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    "particle-size-statistics.csv"
  );
}

function drawMeasureParticleSize() {
  if (!measureParticleSizeCanvas || measureParticleSizeMenu?.hidden) return null;
  const model = buildParticleSizeModel();
  const rect = measureParticleSizeCanvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.round(rect.width));
  const height = Math.max(200, Math.round(rect.height));
  measureParticleSizeCanvas.width = Math.round(width * ratio);
  measureParticleSizeCanvas.height = Math.round(height * ratio);
  const ctx = measureParticleSizeCanvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawParticleSizeToCanvas(ctx, model, width, height);
  renderMeasureParticleSizeStats(model);
  if (exportMeasureParticleSizeButton) {
    exportMeasureParticleSizeButton.disabled =
      model.measurements.length === 0 || model.binnedWeight <= 0;
    exportMeasureParticleSizeButton.title = "Export particle size analysis as PDF";
  }
  return model;
}

function renderMeasureParticleSizeMenu() {
  if (!measureParticleSizeMenu || measureParticleSizeMenu.hidden) return;
  renderParticleSizeGroupControls();
  updateParticleSizeControlState();
  drawMeasureParticleSize();
}

function updateParticleSizeControlState() {
  if (measureParticleStacked && measureParticleSizeMode) {
    measureParticleStacked.disabled =
      measureParticleSizeMode.value !== "groups" || !shouldShowParticleHistogram();
  }
}

function updateMeasureParticleSizeAvailability() {
  if (!measureParticleSizeButton) return;
  measureParticleSizeButton.disabled = getParticleSizeMeasurements().length === 0;
}

function openMeasureParticleSizeMenu(button) {
  if (!measureParticleSizeMenu || !button) return;
  if (measureParticleSizeMenu.parentElement !== document.body) {
    document.body.appendChild(measureParticleSizeMenu);
  }
  measureParticleSizeRangeEdited = false;
  renderParticleSizeGroupControls();
  updateParticleSizeControlState();
  measureParticleSizeMenu.hidden = false;
  measureParticleSizeButton?.setAttribute("aria-expanded", "true");
  positionFixedAnalysisMenu(measureParticleSizeMenu, button);
  drawMeasureParticleSize();
}

function closeMeasureParticleSizeMenu() {
  if (!measureParticleSizeMenu) return;
  measureParticleSizeMenu.hidden = true;
  measureParticleSizeButton?.setAttribute("aria-expanded", "false");
}

function createMeasureParticleSizePdf(model) {
  const width = 612;
  const height = 432;
  const padding = { left: 64, top: 54, right: 64, bottom: 76 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const commands = [];
  const pdfY = (y) => height - y;
  const xScale = (phi) =>
    padding.left + ((phi - model.phiMin) / (model.phiMax - model.phiMin)) * plotWidth;
  const yScale = (fraction) => padding.top + plotHeight - fraction * plotHeight;
  const getBinDisplayValue = (bin) =>
    model.weightMode === "area" && model.totalWeight > 0
      ? (bin.weight / model.totalWeight) * 100
      : bin.weight;
  const yMax = Math.max(1, ...model.bins.map(getBinDisplayValue));
  const getCumulativePdfPath = (cumulative) => {
    if (cumulative.length === 0) return "";
    const startFraction = cumulative.reduce(
      (fraction, point) => (point.phi < model.phiMin ? point.fraction : fraction),
      0
    );
    let currentFraction = startFraction;
    const parts = [
      `${xScale(model.phiMin).toFixed(2)} ${pdfY(yScale(currentFraction)).toFixed(2)} m`,
    ];
    cumulative.forEach((point) => {
      if (point.phi < model.phiMin || point.phi > model.phiMax) return;
      const x = xScale(point.phi).toFixed(2);
      parts.push(`${x} ${pdfY(yScale(currentFraction)).toFixed(2)} l`);
      parts.push(`${x} ${pdfY(yScale(point.fraction)).toFixed(2)} l`);
      currentFraction = point.fraction;
    });
    parts.push(
      `${xScale(model.phiMax).toFixed(2)} ${pdfY(yScale(currentFraction)).toFixed(2)} l`
    );
    return parts.join(" ");
  };

  commands.push("1 1 1 rg 0 0 612 432 re f");
  commands.push("0.15 0.15 0.15 RG 1 w");
  commands.push(`${padding.left} ${pdfY(padding.top)} m ${padding.left} ${pdfY(padding.top + plotHeight)} l ${padding.left + plotWidth} ${pdfY(padding.top + plotHeight)} l S`);
  commands.push(`${padding.left + plotWidth} ${pdfY(padding.top)} m ${padding.left + plotWidth} ${pdfY(padding.top + plotHeight)} l S`);
  addPdfText(
    commands,
    `${model.weightMode === "area" ? "Area-weighted" : "Unweighted"} ${model.parameter.label} grain size`,
    padding.left + plotWidth / 2 - 100,
    24,
    13,
    height
  );

  if (model.measurements.length > 0 && model.binnedWeight > 0) {
    if (model.showHistogram) {
      model.bins.forEach((bin) => {
        const x = xScale(bin.min);
        const nextX = xScale(bin.max);
        const barHeight = (getBinDisplayValue(bin) / yMax) * plotHeight;
        commands.push(`${hexToPdfRgb(model.defaultColor)} rg 0 0 0 RG ${x.toFixed(2)} ${pdfY(padding.top + plotHeight).toFixed(2)} ${Math.max(1, nextX - x - 1).toFixed(2)} ${barHeight.toFixed(2)} re B`);
      });
    }
    if (model.showCumulative) {
      const cumulativePath = getCumulativePdfPath(model.cumulative);
      if (cumulativePath) {
        commands.push(`1 1 1 RG 3.6 w ${cumulativePath} S`);
        commands.push(`${hexToPdfRgb(model.defaultColor)} RG 1.5 w ${cumulativePath} S`);
      }
    }
    if (Number.isFinite(model.meanPhi)) {
      const x = xScale(model.meanPhi);
      commands.push("0.820 0.184 0.184 RG 1.5 w");
      commands.push(`${x.toFixed(2)} ${pdfY(padding.top).toFixed(2)} m ${x.toFixed(2)} ${pdfY(padding.top + plotHeight).toFixed(2)} l S`);
    }
  }

  for (let tick = Math.ceil(model.phiMin); tick <= Math.floor(model.phiMax); tick += 1) {
    const x = xScale(tick);
    commands.push(`0.45 0.45 0.45 RG 0.8 w ${x.toFixed(2)} ${pdfY(padding.top + plotHeight).toFixed(2)} m ${x.toFixed(2)} ${pdfY(padding.top + plotHeight + 4).toFixed(2)} l S`);
    addPdfText(commands, String(tick), x - 3, padding.top + plotHeight + 30, 8, height);
  }
  addPdfText(commands, `${model.parameter.label} (phi)`, padding.left + plotWidth / 2 - 30, height - 42, 10, height);
  addPdfRotatedText(commands, model.yAxisLabel, 24, padding.top + plotHeight / 2 + 28, 10, height);
  addPdfText(
    commands,
    model.weightMode === "area"
      ? `${formatHistogramAxisNumber(yMax)}%`
      : formatHistogramAxisNumber(yMax),
    padding.left - 36,
    padding.top + 4,
    9,
    height
  );
  addPdfText(commands, "100%", padding.left + plotWidth + 8, padding.top + 4, 9, height);
  addPdfText(commands, `n = ${model.measurements.length}; mean = ${formatHistogramAxisNumber(model.meanPhi)} phi (${model.meanCategory}); sorting = ${formatHistogramAxisNumber(model.sortingPhi)} phi (${model.sortingCategory}); skewness = ${formatHistogramAxisNumber(model.skewnessPhi)} (${model.skewnessCategory})`, padding.left, height - 24, 9, height);

  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index++) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function exportMeasureParticleSizePDF() {
  const model = buildParticleSizeModel();
  if (model.measurements.length === 0 || model.binnedWeight <= 0) {
    alert("No valid particle size measurements to export.");
    return;
  }
  saveAs(createMeasureParticleSizePdf(model), "particle-size-analysis.pdf");
}

measureSelectedAnnotationsButton?.addEventListener("click", measureSelectedAnnotations);
measureScaleAuditButton?.addEventListener("click", function (event) {
  event.stopPropagation();
  toggleMeasureScaleAuditPopover();
});
measureScaleAuditPopover?.addEventListener("click", function (event) {
  event.stopPropagation();
});
measureGroupSelect?.addEventListener("change", function (event) {
  activeMeasureGroupId = event.target.value;
  const group = getMeasureGroupById(activeMeasureGroupId);
  if (selectedMeasurementUuids.size > 0) {
    assignSelectedMeasurementsToGroup(group);
  } else {
    updateMeasureGroupControls();
  }
});
measureGroupColorInput?.addEventListener("change", function (event) {
  updateMeasureGroupProperties(activeMeasureGroupId, {
    groupColor: event.target.value,
  });
});
renameMeasureGroupButton?.addEventListener("click", function () {
  const group = getMeasureGroupById(activeMeasureGroupId);
  if (!group) return;
  showPrompt("Rename group:", (value) => {
    renameMeasureGroup(group.groupId, value);
  }, group.groupName);
});
newMeasureGroupButton?.addEventListener("click", function () {
  showPrompt("Enter the group name:", createMeasureGroup);
});
exportMeasurementsButton?.addEventListener("click", exportMeasurementsCSV);
measureColumnsButton?.addEventListener("click", function (event) {
  event.stopPropagation();
  if (!measureColumnsMenu) return;
  if (measureColumnsMenu.hidden) {
    closeMeasureHeaderMenu();
    closeMeasureScaleAuditPopover();
    closeMeasureHelpDialog();
    closeMeasureHistogramMenu();
    closeMeasureScatterMenu();
    closeMeasureRoseMenu();
    closeMeasureParticleSizeMenu();
    openMeasureColumnsMenu(event.currentTarget);
  } else {
    closeMeasureColumnsMenu();
  }
});
measureColumnsMenu?.addEventListener("click", function (event) {
  event.stopPropagation();
});
restoreMeasureColumnsButton?.addEventListener("click", function () {
  measureColumnState = getDefaultMeasureColumnState();
  saveMeasureColumnState();
  renderMeasureResults();
});
measureHelpButton?.addEventListener("click", function (event) {
  event.stopPropagation();
  toggleMeasureHelpDialog(event.currentTarget);
});
measureHelpDialog?.addEventListener("click", function (event) {
  event.stopPropagation();
});
makeFixedElementDraggable(measureHelpDialog, measureHelpHeader);
closeMeasureHelpButton?.addEventListener("click", closeMeasureHelpDialog);
measureHistogramButton?.addEventListener("click", function (event) {
  event.stopPropagation();
  if (!measureHistogramMenu) return;
  if (measureHistogramMenu.hidden) {
    closeMeasureHeaderMenu();
    closeMeasureScaleAuditPopover();
    closeMeasureHelpDialog();
    closeMeasureColumnsMenu();
    closeMeasureScatterMenu();
    closeMeasureRoseMenu();
    closeMeasureParticleSizeMenu();
    openMeasureHistogramMenu(event.currentTarget);
  } else {
    closeMeasureHistogramMenu();
  }
});
measureHistogramMenu?.addEventListener("click", function (event) {
  event.stopPropagation();
});
makeFixedElementDraggable(measureHistogramMenu, measureHistogramHeader);
closeMeasureHistogramButton?.addEventListener("click", closeMeasureHistogramMenu);
measureHistogramParameter?.addEventListener("change", function () {
  measureHistogramRangeEdited = false;
  drawMeasureHistogram();
});
measureHistogramPlotType?.addEventListener("change", function () {
  updateMeasureHistogramControlState();
  drawMeasureHistogram();
});
measureHistogramMode?.addEventListener("change", function () {
  updateMeasureHistogramControlState();
  drawMeasureHistogram();
});
[
  measureHistogramMinInput,
  measureHistogramMaxInput,
  measureHistogramBinSizeInput,
].forEach((input) => {
  input?.addEventListener("input", function () {
    measureHistogramRangeEdited = true;
    if (input === measureHistogramBinSizeInput) {
      validateMeasureHistogramBinSizeInput();
    }
    drawMeasureHistogram();
  });
});
measureHistogramBinSizeInput?.addEventListener("change", function () {
  normalizeMeasureHistogramBinSizeInput();
  measureHistogramRangeEdited = true;
  drawMeasureHistogram();
});
measureHistogramStackedInput?.addEventListener("change", drawMeasureHistogram);
measureHistogramColorInput?.addEventListener("input", drawMeasureHistogram);
exportMeasureHistogramButton?.addEventListener("click", exportMeasureHistogramPDF);
exportMeasureHistogramStatsButton?.addEventListener(
  "click",
  exportMeasureHistogramStatsCSV
);
measureScatterButton?.addEventListener("click", function (event) {
  event.stopPropagation();
  if (!measureScatterMenu) return;
  if (measureScatterMenu.hidden) {
    closeMeasureHeaderMenu();
    closeMeasureScaleAuditPopover();
    closeMeasureHelpDialog();
    closeMeasureColumnsMenu();
    closeMeasureHistogramMenu();
    closeMeasureRoseMenu();
    closeMeasureParticleSizeMenu();
    openMeasureScatterMenu(event.currentTarget);
  } else {
    closeMeasureScatterMenu();
  }
});
measureScatterMenu?.addEventListener("click", function (event) {
  event.stopPropagation();
});
makeFixedElementDraggable(measureScatterMenu, measureScatterHeader);
closeMeasureScatterButton?.addEventListener("click", closeMeasureScatterMenu);
measureScatterXParameter?.addEventListener("change", function () {
  measureScatterRangeEdited = false;
  drawMeasureScatter();
});
measureScatterYParameter?.addEventListener("change", function () {
  measureScatterRangeEdited = false;
  drawMeasureScatter();
});
measureScatterMode?.addEventListener("change", drawMeasureScatter);
measureScatterColorInput?.addEventListener("input", drawMeasureScatter);
measureScatterOpacityRange?.addEventListener("input", function () {
  setMeasureScatterOpacityControlValue(measureScatterOpacityRange.value);
  drawMeasureScatter();
});
measureScatterOpacityInput?.addEventListener("input", function () {
  if (measureScatterOpacityRange) {
    measureScatterOpacityRange.value = measureScatterOpacityInput.value;
  }
  drawMeasureScatter();
});
measureScatterOpacityInput?.addEventListener("change", function () {
  setMeasureScatterOpacityControlValue(measureScatterOpacityInput.value);
  drawMeasureScatter();
});
[
  measureScatterXMinInput,
  measureScatterXMaxInput,
  measureScatterYMinInput,
  measureScatterYMaxInput,
].forEach((input) => {
  input?.addEventListener("input", function () {
    measureScatterRangeEdited = true;
    drawMeasureScatter();
  });
});
exportMeasureScatterButton?.addEventListener("click", exportMeasureScatterPDF);
exportMeasureScatterStatsButton?.addEventListener(
  "click",
  exportMeasureScatterStatsCSV
);
measureRoseButton?.addEventListener("click", function (event) {
  event.stopPropagation();
  if (!measureRoseMenu) return;
  if (measureRoseMenu.hidden) {
    closeMeasureHeaderMenu();
    closeMeasureScaleAuditPopover();
    closeMeasureHelpDialog();
    closeMeasureColumnsMenu();
    closeMeasureHistogramMenu();
    closeMeasureScatterMenu();
    closeMeasureParticleSizeMenu();
    openMeasureRoseMenu(event.currentTarget);
  } else {
    closeMeasureRoseMenu();
  }
});
measureRoseMenu?.addEventListener("click", function (event) {
  event.stopPropagation();
});
makeFixedElementDraggable(measureRoseMenu, measureRoseHeader);
closeMeasureRoseButton?.addEventListener("click", closeMeasureRoseMenu);
measureRoseParameter?.addEventListener("change", drawMeasureRose);
measureRoseMode?.addEventListener("change", function () {
  updateMeasureRoseControlState();
  drawMeasureRose();
});
measureRoseColorInput?.addEventListener("input", drawMeasureRose);
measureRoseBinSizeInput?.addEventListener("input", function () {
  validatePositiveNumberInput(
    measureRoseBinSizeInput,
    "Rose bin size must be greater than 0."
  );
  drawMeasureRose();
});
measureRoseBinSizeInput?.addEventListener("change", function () {
  normalizePositiveNumberInput(
    measureRoseBinSizeInput,
    MEASURE_ROSE_DEFAULT_BIN_SIZE
  );
  drawMeasureRose();
});
measureRoseBidirectionalInput?.addEventListener("change", drawMeasureRose);
measureRoseStackedInput?.addEventListener("change", drawMeasureRose);
exportMeasureRoseButton?.addEventListener("click", exportMeasureRosePDF);
exportMeasureRoseStatsButton?.addEventListener(
  "click",
  exportMeasureRoseStatsCSV
);
measureParticleSizeButton?.addEventListener("click", function (event) {
  event.stopPropagation();
  if (!measureParticleSizeMenu) return;
  if (measureParticleSizeMenu.hidden) {
    closeMeasureHeaderMenu();
    closeMeasureScaleAuditPopover();
    closeMeasureHelpDialog();
    closeMeasureColumnsMenu();
    closeMeasureHistogramMenu();
    closeMeasureScatterMenu();
    closeMeasureRoseMenu();
    openMeasureParticleSizeMenu(event.currentTarget);
  } else {
    closeMeasureParticleSizeMenu();
  }
});
measureParticleSizeMenu?.addEventListener("click", function (event) {
  event.stopPropagation();
});
makeFixedElementDraggable(measureParticleSizeMenu, measureParticleSizeHeader);
closeMeasureParticleSizeButton?.addEventListener(
  "click",
  closeMeasureParticleSizeMenu
);
measureParticleSizeParameter?.addEventListener("change", function () {
  measureParticleSizeRangeEdited = false;
  updateMeasureParticleSizeAvailability();
  renderParticleSizeGroupControls();
  drawMeasureParticleSize();
});
measureParticleSizeWeight?.addEventListener("change", function () {
  measureParticleSizeRangeEdited = false;
  renderParticleSizeGroupControls();
  updateParticleSizeControlState();
  drawMeasureParticleSize();
});
measureParticleSizeMode?.addEventListener("change", function () {
  updateParticleSizeControlState();
  drawMeasureParticleSize();
});
measureParticleShowHistogram?.addEventListener("change", function () {
  updateParticleSizeControlState();
  drawMeasureParticleSize();
});
measureParticleShowCumulative?.addEventListener("change", drawMeasureParticleSize);
measureParticleStacked?.addEventListener("change", drawMeasureParticleSize);
measureParticleColorInput?.addEventListener("input", drawMeasureParticleSize);
[
  measureParticlePhiMinInput,
  measureParticlePhiMaxInput,
  measureParticlePhiBinInput,
].forEach((input) => {
  input?.addEventListener("input", function () {
    measureParticleSizeRangeEdited = true;
    if (input === measureParticlePhiBinInput) {
      validatePositiveNumberInput(
        measureParticlePhiBinInput,
        "Particle size bin size must be greater than 0."
      );
    }
    drawMeasureParticleSize();
  });
});
measureParticlePhiBinInput?.addEventListener("change", function () {
  normalizePositiveNumberInput(measureParticlePhiBinInput, 0.25);
  measureParticleSizeRangeEdited = true;
  drawMeasureParticleSize();
});
exportMeasureParticleSizeButton?.addEventListener(
  "click",
  exportMeasureParticleSizePDF
);
exportMeasureParticleSizeStatsButton?.addEventListener(
  "click",
  exportMeasureParticleSizeStatsCSV
);
window.addEventListener("click", function (event) {
  if (
    !event.target.closest("#measureColumnsButton") &&
    !event.target.closest("#measureColumnsMenu")
  ) {
    closeMeasureColumnsMenu();
  }
  if (
    !event.target.closest(".measure-sortable-header") &&
    !event.target.closest(".measure-header-menu")
  ) {
    closeMeasureHeaderMenu();
  }
  if (
    !event.target.closest("#measureScaleAuditButton") &&
    !event.target.closest("#measureScaleAuditPopover")
  ) {
    closeMeasureScaleAuditPopover();
  }
  if (
    !event.target.closest("#measureHelpButton") &&
    !event.target.closest("#measureHelpDialog")
  ) {
    closeMeasureHelpDialog();
  }
});
document.addEventListener(
  "keydown",
  function (event) {
    if (
      event.key !== "Escape" ||
      ((measureHeaderMenuElement?.hidden ?? true) &&
        (measureScaleAuditPopover?.hidden ?? true) &&
        (measureHelpDialog?.hidden ?? true) &&
        measureHistogramMenu?.hidden &&
        measureScatterMenu?.hidden &&
        measureRoseMenu?.hidden &&
        measureParticleSizeMenu?.hidden)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    closeMeasureHeaderMenu();
    closeMeasureScaleAuditPopover();
    closeMeasureHelpDialog();
    closeMeasureHistogramMenu();
    closeMeasureScatterMenu();
    closeMeasureRoseMenu();
    closeMeasureParticleSizeMenu();
  },
  true
);
window.addEventListener("resize", refreshOpenMeasureAnalysisMenus);
clearMeasurementsButton?.addEventListener("click", function () {
  resetMeasurements(true);
});
deleteMeasurementButton?.addEventListener("click", deleteSelectedMeasurement);
renderMeasureResults();

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
  const isMeasureLineFloater =
    measurementModeActive && activeMeasureTool === "line";
  const isMeasurePolygonFloater =
    measurementModeActive && activeMeasureTool === "polygon";
  polylineFloater.classList.toggle("measure-floater-active", isMeasureLineFloater);
  polygonFloater.classList.toggle(
    "measure-floater-active",
    isMeasurePolygonFloater
  );

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
  } else if (isMeasureLineFloater) {
    togglePolylineFloaterOn(true);
    togglePolygonFloaterOn(false);
  } else if (isMeasurePolygonFloater) {
    togglePolylineFloaterOn(false);
    togglePolygonFloaterOn(true);
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

document.addEventListener("keydown", function (event) {
  if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
  if (isTextEntryElement(event.target)) return;

  let direction = 0;
  if (event.key === "<" || event.key === "ArrowLeft") {
    direction = -1;
  } else if (event.key === ">" || event.key === "ArrowRight") {
    direction = 1;
  }

  if (direction === 0) return;

  if (cycleAllMultipleTileSetImages(direction)) {
    event.preventDefault();
  }
});

// Function to check if a polygon is self-intersecting
function isSelfIntersecting(coords) {
  return getPolygonSelfIntersectionStatus(coords).validGeometry === false;
}

function updateSelfIntersectionWarning(coords) {
  const isIntersecting = isSelfIntersecting(coords);
  const banner = document.getElementById("selfIntersectWarning");
  if (!banner) return;

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

  const stageSlider = document.getElementById("stageRotation");
  const stageSliderValue = document.getElementById("stageRotationValue");
  const stageSliderUnit = document.getElementById("stageRotationUnit");
  const stageLabel = document.getElementById("stageRotationLabel");
  const lockCheckbox = document.getElementById("rotateWithStage");
  const lockCheckboxLabel = document.getElementById("rotateWithStageLabel");
  if (
    !stageSlider ||
    !stageSliderValue ||
    !stageSliderUnit ||
    !stageLabel ||
    !lockCheckbox ||
    !lockCheckboxLabel
  ) {
    return;
  }

  if (enableStageRotation) {
    stageSlider.style.display = "block"; // Show the slider
    stageSliderValue.style.display = "block"; // Show the value
    stageSliderUnit.style.display = "block"; // Show the unit
    stageLabel.style.display = "block"; // Show the label
    lockCheckbox.style.display = "block"; // Show the checkbox
    lockCheckboxLabel.style.display = "block"; // Show the checkbox label
  } else {
    stageSlider.style.display = "none"; // Hide it
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
  const draftCoordinates = [...clickImageCoordinates, [imagePoint.x, imagePoint.y]];
  const draftStyle = {
    labelFontSize,
    labelFontColor,
    labelBackgroundColor,
    labelBackgroundOpacity,
    lineStyle,
    lineWeight,
    lineColor,
    lineOpacity,
    fillColor: currentPolyStyleColors.fillColor,
    fillOpacity: getAnnotationOpacityValue("fillOpacity"),
  };

  if (isPolygonMode || isXPressed) {
    addPolygonToGeoJSON(
      annoJSONTemp,
      getClosedDraftPolygonCoordinates(draftCoordinates),
      draftStyle
    );
  } else {
    addPolylineToGeoJSON(annoJSONTemp, draftCoordinates, draftStyle);
  }

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
