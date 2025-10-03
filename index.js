"use strict";

// Keep track of the current step in the sequence
let currentIndex = 0;
let tileSets = [];
let tileLabels = [];
let samples = [];
let descriptions = [];
let pixelsPerUnits = [];
let pixelsPerMeters = [];
let units = []; // 2 for microns
let infos = [];
let annotation_files = {}; // For loading predefined annotations
let groupMapping = {}; // To map groups to sample indices ///
let scrollIndex = 1e6;

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
let measureJSONTemp = {
  type: "FeatureCollection",
  features: [],
}; // For drawing temporary measurements
let measureAreaJSONTemp = {
  type: "FeatureCollection",
  features: [],
}; // For drawing temporary measurements of area

// OG function
// function loadSampleJSON(JSON) {
//   // Load necessary information from JSON
//   fetch(JSON)
//     // fetch("samples.json")
//     .then((response) => response.json())
//     .then((data) => {
//       // Loop through each sample
//       Object.keys(data).forEach((sampleKey, index) => {
//         ///
//         // Object.keys(data).forEach(sampleKey => {
//         let sample = data[sampleKey];
//         if (sample) {
//           // Extract the relevant details
//           tileSets.push(sample.tileSets);
//           tileLabels.push(sample.tileLabels);
//           samples.push(sample.title);
//           descriptions.push(sample.description);
//           pixelsPerUnits.push(sample.pixelsPerUnit);
//           pixelsPerMeters.push(sample.pixelsPerMeter);
//           units.push(sample.unit);
//           annotation_files[sample.title] = sample.annotations; // || null;

//           /// Map sample indices to their groups
//           if (sample.groups) {
//             sample.groups.forEach((group) => {
//               if (!groupMapping[group]) {
//                 groupMapping[group] = [];
//               }
//               groupMapping[group].push(index);
//             });
//           }
//         } else {
//           console.error(`Sample not found for key: ${sampleKey}`);
//         }
//       });

//       // Add a default "All" group containing all sample indices
//       groupMapping["All"] = Array.from({ length: samples.length }, (_, i) => i);

//       // Example: initialize OpenSeadragon with the first tile source
//       loadTileSet(0);
//       addScalebar(pixelsPerMeters[0]);
//       populateGroupDropdown();
//       updateButtonLabels(0);
//       divideImages();
//       disableCountButtons();
//       // deselectAllButFirstImage();

//       const sampleParam = getQueryParameter("sample");
//       if (sampleParam) {
//         const sampleIndex = samples.indexOf(sampleParam);
//         if (sampleIndex !== -1) {
//           // Select the correct group and sample
//           const groupForSample = Object.keys(groupMapping).find((group) =>
//             groupMapping[group].includes(sampleIndex)
//           );
//           document.getElementById("groupDropdown").value =
//             groupForSample || "All";
//           populateSampleDropdown(groupForSample || "All");
//           document.getElementById("sampleDropdown").value = sampleIndex;
//           document
//             .getElementById("sampleDropdown")
//             .dispatchEvent(new Event("change"));
//         } else {
//           console.warn(`Sample "${sampleParam}" not found in JSON.`);
//         }
//       } else {
//         // Default behavior if no sample is specified
//         const firstGroup = Object.keys(groupMapping)[0];
//         if (firstGroup) {
//           document.getElementById("groupDropdown").value = firstGroup;
//           populateSampleDropdown(firstGroup);
//         }
//       }
//     })
//     .catch((error) => {
//       console.error("Error loading the JSON file:", error);
//     });
// }

function loadSampleJSON(input) {
  if (typeof input === "string") {
    // Load necessary information from JSON
    fetch(input)
      // fetch("samples.json")
      .then((response) => response.json())
      .then((data) => {
        console.log("Fetched JSON from file:", input, data);
        processJSON(data); // Process JSON data
      });
  } else if (typeof input === "object") {
    // Case 2: Input is already parsed JSON
    console.log("Using already parsed JSON:", input);
    processJSON(input);
  } else {
    console.error("Invalid input to loadSampleJSON");
  }
}

function processJSON(data) {
  currentIndex = 0;
  tileSets = [];
  tileLabels = [];
  samples = [];
  descriptions = [];
  pixelsPerUnits = [];
  pixelsPerMeters = [];
  units = []; // 2 for microns
  infos = [];
  annotation_files = {}; // For loading predefined annotations
  groupMapping = {}; // To map groups to sample indices ///
  // Loop through each sample
  Object.keys(data).forEach((sampleKey, index) => {
    let sample = data[sampleKey];
    if (sample) {
      // Extract the relevant details
      tileSets.push(sample.tileSets);
      tileLabels.push(sample.tileLabels);
      samples.push(sample.title);
      descriptions.push(sample.description);
      pixelsPerUnits.push(sample.pixelsPerUnit);
      pixelsPerMeters.push(sample.pixelsPerMeter);
      units.push(sample.unit);
      infos.push(sample.info);
      annotation_files[sample.title] = sample.annotations; // || null;

      /// Map sample indices to their groups
      if (sample.groups) {
        sample.groups.forEach((group) => {
          if (!groupMapping[group]) {
            groupMapping[group] = [];
          }
          groupMapping[group].push(index);
        });
      }
    } else {
      console.error(`Sample not found for key: ${sampleKey}`);
    }
  });

  // Add a default "All" group containing all sample indices
  groupMapping["All"] = Array.from({ length: samples.length }, (_, i) => i);

  // Example: initialize OpenSeadragon with the first tile source
  loadTileSet(0);
  //addScalebar(pixelsPerMeters[0]);
  populateGroupDropdown();
  updateButtonLabels(0);
  divideImages();
  disableCountButtons();
  // deselectAllButFirstImage();

  const sampleParam = getQueryParameter("sample");
  if (sampleParam) {
    const sampleIndex = samples.indexOf(sampleParam);
    if (sampleIndex !== -1) {
      // Select the correct group and sample
      const groupForSample = Object.keys(groupMapping).find((group) =>
        groupMapping[group].includes(sampleIndex)
      );
      document.getElementById("groupDropdown").value = groupForSample || "All";
      populateSampleDropdown(groupForSample || "All");
      document.getElementById("sampleDropdown").value = sampleIndex;
      document
        .getElementById("sampleDropdown")
        .dispatchEvent(new Event("change"));
    } else {
      console.warn(`Sample "${sampleParam}" not found in JSON.`);
    }
  } else {
    // Default behavior if no sample is specified
    const firstGroup = Object.keys(groupMapping)[0];
    if (firstGroup) {
      document.getElementById("groupDropdown").value = firstGroup;
      populateSampleDropdown(firstGroup);
    }
  }
}

// Automatically load the default JSON file when the page loads
document.addEventListener("DOMContentLoaded", () => {
  console.log("uploading samples.json");
  loadSampleJSON("samples.json");
});

document
  .getElementById("load-sample-JSON")
  .addEventListener("change", function (event) {
    console.log("load sample JSON clicked");
    const fileInput = event.target;
    const file = fileInput.files[0];
    if (!file) {
      console.log("not a file!");
      return;
    }

    console.log("Selected file:", file.name); // Debugging

    const reader = new FileReader();
    reader.onload = function (event) {
      const sampleJSON = event.target.result;

      try {
        const parsedJSON = JSON.parse(sampleJSON);
        console.log("Successfully loaded JSON:", parsedJSON); // Debugging
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

///
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
function populateSampleDropdown(selectedGroup) {
  const sampleDropdown = document.getElementById("sampleDropdown");
  sampleDropdown.innerHTML = ""; // Clear existing options

  if (groupMapping[selectedGroup]) {
    groupMapping[selectedGroup].forEach((index) => {
      const option = document.createElement("option");
      option.value = index; // Store index as value
      option.textContent = samples[index]; // Sample title
      sampleDropdown.appendChild(option);
    });
    // Automatically select the first sample in the group
    if (sampleDropdown.options.length > 0) {
      sampleDropdown.currentIndex = 0; // Select the first option
      sampleDropdown.dispatchEvent(new Event("change")); // Trigger the change event
    }
  }
}

let sampleName = "";

// Initialize the OpenSeadragon viewer
const viewer = OpenSeadragon({
  maxZoomPixelRatio: 100,
  id: "viewer-container",
  prefixUrl: "js/images/",
  zoomPerClick: 1, // Disable zoom on click (or shift+click)
  sequenceMode: false,
  tileSources: tileSets[0], // Load first tile set upon load
  showNavigationControl: false, // Disable the default navigation controls
});

/// Event listener for sample selection change (only add once)
document
  .getElementById("sampleDropdown")
  .addEventListener("change", function () {
    currentIndex = Number(this.value);
    sampleName = samples[currentIndex];
    loadTileSet(currentIndex);
    clearAnnotations();
    updateButtonLabels(currentIndex);
    addScalebar(pixelsPerMeters[currentIndex]);
    clearGrid();
    enableGridButtons();
    disableCountButtons();
    removeAoiRectangle();
    updateOpacityImageSliderVisibility();
    updateImageLabels();
    resetMeasurements(true);
    document.getElementById("enableDivideImages").checked = true;
    enableDivideImages = true;
    divideImages();
    toggleOnImages();
    resetRotation();

    const annoJSONButtonContainer = document.getElementById("loadAnnoFromJSON");

    // Remove any existing button
    const existingButton = document.getElementById("loadAnnoFromJSONButton");
    if (existingButton) {
      existingButton.remove();
    }

    // Check if the selected sample has annotations
    let file = annotation_files[sampleName];
    if (file) {
      hasAnnotationInJSON = true;
      console.log("anno JSON detected, creating button");
      console.log("file to load:", file);
      const button = document.createElement("button");
      button.textContent = "Load from JSON";
      button.id = "loadAnnoFromJSONButton";
      button.className = "custom-button";
      button.style.setProperty("--button-width", "110px"); // button.style.display = "block"; // Make sure the button is visible
      button.onclick = () => loadAnnotationsFromJSON(file);
      annoJSONButtonContainer.appendChild(button);
    } else {
      hasAnnotationInJSON = false;
      console.log("No annotations detected for the selected sample.");
    }
  });

// Function to update the button labels based on tileLabels array
function updateButtonLabels(index) {
  const numButtons = tileSets[index].length;
  const tileLabelsForIndex = tileLabels[index]; // Get the labels for the current tile set

  for (let i = 1; i <= 4; i++) {
    const checkbox = document.getElementById(`image${i}`);
    const label = document.getElementById(`label${i}`);

    const visibleImageIndex = scrollIndex % tileLabelsForIndex.length;

    if (i <= numButtons) {
      // For regular labels, use the normal setup
      checkbox.style.display = "inline";
      label.style.display = "inline";
      const currentLabel = tileLabelsForIndex[i - 1];
      if (Array.isArray(currentLabel)) {
        // Determine the visible label index based on scrollIndex
        label.textContent = currentLabel[visibleImageIndex]; // Set the label text based on the scrollIndex logic
      } else {
        label.textContent = currentLabel;
      }
    } else {
      checkbox.style.display = "none";
      label.style.display = "none";
      label.textContent = "";
    }
  }
}

function toggleOnImages() {
  const numButtons = tileSets[currentIndex].length;
  for (let i = 1; i <= 4; i++) {
    const checkbox = document.getElementById(`image${i}`);
    if (i <= numButtons) {
      checkbox.checked = true;
    }
  }
}

// TODO: Only select the first image upon first load (not currently working
// because the image is undefined when toggleImage() is called)
function deselectAllButFirstImage() {
  for (let i = 1; i <= 4; i++) {
    const checkbox = document.getElementById(`image${i}`);
    console.log(checkbox);
    if (checkbox) {
      if (i > 1 && checkbox.checked === true) {
        console.log(`deselecting image${i}`);
        toggleImage(checkbox, i);
        // checkbox.click();
      }
    }
  }
}

// Function to update the label dynamically
function updateImageLabels() {
  const tileLabelsForCurrent = tileLabels[currentIndex];

  for (let i = 0; i < 4; i++) {
    const labelDiv = document.getElementById(
      `labelForOpacityImage${i + 1}`
    ).parentElement; // the <div> wrapping the label+input+span
    const labelElement = document.getElementById(
      `labelForOpacityImage${i + 1}`
    );

    if (i < tileLabelsForCurrent.length) {
      // Show the div
      labelDiv.style.display = "";
      const tileLabelsForIndex = tileLabelsForCurrent[i];
      const visibleImageIndex =
        scrollIndex %
        (Array.isArray(tileLabelsForIndex) ? tileLabelsForIndex.length : 1);
      labelElement.textContent = Array.isArray(tileLabelsForIndex)
        ? tileLabelsForIndex[visibleImageIndex]
        : tileLabelsForIndex;
    } else {
      // Hide extra divs
      labelDiv.style.display = "none";
    }
  }
}

const tooltip = document.getElementById("tooltip-desc");
const infoButton = document.getElementById("info-button-desc");
// Show tooltip with sample info on hover
function showTooltip() {
  const dropdown = document.getElementById("sampleDropdown");
  if (descriptions[dropdown.value]) {
    tooltip.textContent = `${descriptions[dropdown.value]}`;
    tooltip.style.display = "block";
    const buttonRect = infoButton.getBoundingClientRect();
    console.log("buttonRect.top", buttonRect.top);
    console.log("buttonRect.height", buttonRect.height);
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
  if (infos[currentIndex]) {
    fetch(infos[currentIndex])
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

// TOOD: A new function for changing hasUnsavedAnnotations
function unsavedAnnotations(value) {
  if (value) {
    window.appState.hasUnsavedAnnotations = true;
  } else {
    window.appState.hasUnsavedAnnotations = false;
  }
  if (window.electronAPI) {
    const unsaved =
      window.appState.hasUnsavedAnnotations || window.appState.hasUnsavedCounts;
    console.log("Sending unsaved state to main process:", unsaved);
    window.electronAPI.setUnsavedState(unsaved);
  }
}

function unsavedCounts(value) {
  if (value) {
    window.appState.hasUnsavedCounts = true;
  } else {
    window.appState.hasUnsavedCounts = false;
  }
  if (window.electronAPI) {
    const unsaved =
      window.appState.hasUnsavedAnnotations || window.appState.hasUnsavedCounts;
    console.log("Sending unsaved state to main process:", unsaved);
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
function addScalebar() {
  const scalebarType = document.getElementById("scalebarType").value;

  const pixelsPerMeter = pixelsPerMeters[currentIndex];
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
    pixelsPerMeter: pixelsPerMeter,
  });
}

function restoreScalebarDefaults() {
  const scalebarBackgroundColorToPlot = applyOpacityToColor("#ffffff", 0.5);
  const pixelsPerMeter = pixelsPerMeters[currentIndex];

  // Reset scalebar settings to default values
  document.getElementById("scalebarType").value = "Map";
  document.getElementById("scalebarUnitSystem").value = "Metric";
  document.getElementById("scalebarMinWidth").innerHTML = 75;
  document.getElementById("scalebarLocation").value = "Bottom left";
  document.getElementById("scalebarXOffset").innerHTML = 10;
  document.getElementById("scalebarYOffset").innerHTML = 10;
  document.getElementById("scalebarColor").value = "#000000";
  document.getElementById("scalebarFontColor").value = "#000000";
  document.getElementById("scalebarBackgroundColor").value = "#ffffff";
  document.getElementById("scalebarBackgroundOpacity").innerHTML = 0.5;
  document.getElementById("scalebarFontSize").value = "medium";
  document.getElementById("scalebarLineWeight").innerHTML = 2;

  viewer.scalebar({
    type: OpenSeadragon.ScalebarType.MAP,
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
    pixelsPerMeter: pixelsPerMeter,
  });
}

// Function to recursively add tile sources
// function addTiles(tileSource) {
//   if (Array.isArray(tileSource)) {
//     tileSource.forEach(addTiles); // Recursively handle nested lists
//   } else {
//     viewer.addTiledImage({
//       tileSource: tileSource,
//       success: function () {},
//     });
//   }
// }

// Recursive addTiles function
// Recursive addTiles function
function addTiles(tileSource) {
  if (Array.isArray(tileSource)) {
    if (
      tileSource.length === 2 &&
      typeof tileSource[0] === "string" &&
      typeof tileSource[1] === "string"
    ) {
      // Blend two images
      let blendImages = [];

      function tryInitBlend() {
        if (blendImages.length === 2) {
          // Initialize WebGL overlay
          const glOverlay = new openSeadragonGL(viewer);

          // Provide shader code as strings (no external .glsl files)
          glOverlay.viaGL.vShader = `
            attribute vec2 a_pos;
            varying vec2 vTextureCoord;
            void main(void) {
              vTextureCoord = a_pos * 0.5 + 0.5;
              gl_Position = vec4(a_pos, 0.0, 1.0);
            }
          `;

          glOverlay.viaGL.fShader = `
            precision mediump float;
            uniform sampler2D uSampler0;
            uniform sampler2D uSampler1;
            uniform float blendFactor;
            varying vec2 vTextureCoord;
            void main(void) {
              vec4 c0 = texture2D(uSampler0, vTextureCoord);
              vec4 c1 = texture2D(uSampler1, vTextureCoord);
              gl_FragColor = mix(c0, c1, blendFactor);
            }
          `;

          // Set initial blend factor
          glOverlay.viaGL.blendFactor = 0.0;

          // Initialize WebGL overlay
          glOverlay.viaGL.init().then(() => {
            console.log("WebGL overlay ready");

            // Slider to adjust blend factor
            document
              .getElementById("blendSlider")
              .addEventListener("input", function () {
                glOverlay.viaGL.blendFactor = parseFloat(this.value) / 100;

                // Only redraw GL overlay, do not reset all OSD tiles
                if (glOverlay.viaGL.gl) {
                  glOverlay.viaGL["gl-drawing"](glOverlay.viaGL.source);
                }
              });
          });
        }
      }

      // Load both images
      tileSource.forEach((url) => {
        viewer.addTiledImage({
          tileSource: url,
          success: function (event) {
            blendImages.push(event.item);
            tryInitBlend();
          },
        });
      });
    } else {
      tileSource.forEach(addTiles);
    }
  } else {
    viewer.addTiledImage({
      tileSource: tileSource,
      success: function () {},
    });
  }
}

// Function to load a set of images based on the current index
function loadTileSet(index) {
  viewer.world.removeAll(); // Remove previous images
  const tileSources = tileSets[index]; // Get the tile set

  if (tileSources) {
    addTiles(tileSources); // Process all tiles (handling nested lists)
  }
}

const viewerContainer = document.getElementById("viewer-container");

// Share the mouse position between event handlers.
let mousePos = new OpenSeadragon.Point(0, 0);

// Divides the images at the current mouse position, cropping overlaid images to
// expose the images underneath. Note that all images are expected to have the
// same position and size.
const divideImages = () => {
  // Bail out if there are no images.
  if (viewer.world.getItemCount() === 0) {
    return;
  }

  const tileSet = tileSets[currentIndex];
  // Determine the number of checked images ahead of time so we know how big to
  // make each section.
  const isChecked = [];
  let totalChecked = 0;
  for (let i = 0; i < tileSet.length; ++i) {
    const checkbox = document.getElementById(`image${i + 1}`);
    isChecked.push(checkbox.checked);
    if (checkbox.checked) {
      ++totalChecked;
    }
  }

  const radius = 4 * Math.max(window.innerWidth, window.innerHeight);
  // Place the first image in a segment with its most clockwise edge facing up.
  const startAngle = -Math.PI / 2 - (2 * Math.PI) / totalChecked;

  // Set the cropping polygon for each image.
  let imageIndex = 0; // Because a given section may have multiple images
  let sectionsLeft = totalChecked;
  // One loop per top level of image list
  for (let i = 0; i < tileSet.length; ++i) {
    const endAngle = (-2 * Math.PI * sectionsLeft) / totalChecked;
    const windowPolygon = [mousePos];
    // Define the section's arc using four points to ensure the polygon is
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

    let imagesInSection;
    if (Array.isArray(tileSet[i])) {
      // If it's a nested list, add all images to the same section
      imagesInSection = tileSet[i];
    } else {
      // If it's a single image, treat it as its own group
      imagesInSection = [tileSet[i]];
    }

    const imageOpacity = document.getElementById(`opacityImage${i + 1}`).value;

    // One loop per second level of image list
    for (let j = 0; j < imagesInSection.length; ++j) {
      ++imageIndex;

      const image = viewer.world.getItemAt(imageIndex - 1);
      if (!image) {
        console.warn(`Image at index ${imageIndex - 1} is not loaded yet.`);
        continue;
      }

      // Display this image if it's selected and checked.
      const visibleImageIndex = scrollIndex % imagesInSection.length;
      if (isChecked[i] && j === visibleImageIndex) {
        image.setOpacity(imageOpacity / 100);
        --sectionsLeft;
      } else {
        image.setOpacity(0);
        continue;
      }

      if (enableDivideImages) {
        image.setCroppingPolygons([
          windowPolygon.map((p) => image.viewerElementToImageCoordinates(p)),
        ]);
      } else {
        image.resetCroppingPolygons();
      }
    }
  }
  viewer.forceRedraw();
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

viewer.addHandler("animation", divideImages);

// Update grid slider values as slider moves
const slider_1 = document.getElementById("grid-left");
const sliderValue_1 = document.getElementById("grid-left-value");
slider_1.oninput = function () {
  sliderValue_1.textContent = this.value;
};
const slider_2 = document.getElementById("grid-right");
const sliderValue_2 = document.getElementById("grid-right-value");
slider_2.oninput = function () {
  sliderValue_2.textContent = this.value;
};
const slider_3 = document.getElementById("grid-top");
const sliderValue_3 = document.getElementById("grid-top-value");
slider_3.oninput = function () {
  sliderValue_3.textContent = this.value;
};
const slider_4 = document.getElementById("grid-bottom");
const sliderValue_4 = document.getElementById("grid-bottom-value");
slider_4.oninput = function () {
  sliderValue_4.textContent = this.value;
};
const image1slider = document.getElementById("opacityImage1");
const image1sliderValue = document.getElementById("opacityImage1Value");
image1slider.oninput = function () {
  image1sliderValue.textContent = `${this.value}%`;
};
const image2slider = document.getElementById("opacityImage2");
const image2sliderValue = document.getElementById("opacityImage2Value");
image2slider.oninput = function () {
  image2sliderValue.textContent = `${this.value}%`;
};
const image3slider = document.getElementById("opacityImage3");
const image3sliderValue = document.getElementById("opacityImage3Value");
image3slider.oninput = function () {
  image3sliderValue.textContent = `${this.value}%`;
};
const image4slider = document.getElementById("opacityImage4");
const image4sliderValue = document.getElementById("opacityImage4Value");
image4slider.oninput = function () {
  image4sliderValue.textContent = `${this.value}%`;
};

function updateOpacityImageSliderVisibility() {
  // Get all slider container divs
  const sliders = document.querySelectorAll("#imageSettingsMenu > div > div");

  // Loop through all sliders and adjust visibility
  sliders.forEach((slider, index) => {
    if (index < tileSets[currentIndex].length) {
      slider.style.display = "block"; // Show the slider
      // Reset the slider value to 100
      const sliderInput = slider.querySelector("input[type='range']");
      const sliderValueSpan = slider.querySelector(".slider-value");
      if (sliderInput) {
        sliderInput.value = 100; // Reset slider to 100

        // Attach an event listener to dynamically update opacity
        sliderInput.addEventListener("input", () => {
          console.log("slider input event listener");
          // const opacity = sliderInput.value / 100;
          setTileSetOpacity();
          // Update the displayed slider value
          if (sliderValueSpan) {
            sliderValueSpan.textContent = `${sliderInput.value}%`;
          }
        });
      }
      if (sliderValueSpan) {
        sliderValueSpan.textContent = "100%"; // Update displayed value
      }
    } else {
      slider.style.display = "none"; // Hide the slider
    }
  });
}

// Constrain values of sliders and update the value display for slider1
slider_1.addEventListener("input", function () {
  if (parseInt(slider_1.value) > parseInt(slider_2.value)) {
    slider_1.value = slider_2.value;
  }
  sliderValue_1.textContent = slider_1.value;
});
// Update the value display for slider2 and ensure slider1 stays within bounds
slider_2.addEventListener("input", function () {
  if (parseInt(slider_1.value) > parseInt(slider_2.value)) {
    slider_1.value = slider_2.value;
    sliderValue_1.textContent = slider_1.value; // Update display for slider1
  }
  sliderValue_2.textContent = slider_2.value;
});
// Update the value display for slider3
slider_3.addEventListener("input", function () {
  if (parseInt(slider_3.value) > parseInt(slider_4.value)) {
    slider_3.value = slider_4.value;
  }
  sliderValue_3.textContent = slider_3.value;
});

// Update the value display for slider2 and ensure slider3 stays within bounds
slider_4.addEventListener("input", function () {
  if (parseInt(slider_3.value) > parseInt(slider_4.value)) {
    slider_3.value = slider_4.value;
    sliderValue_3.textContent = slider_4.value; // Update display for slider1
  }
  sliderValue_4.textContent = slider_4.value;
});

///////////////////////////////////
//// Annotations functionality ////
///////////////////////////////////

let pointButton = document.getElementById("crosshairButton");
let polylineButton = document.getElementById("polylineButton");
let rectButton = document.getElementById("rectangleButton");
let repeatButton = document.getElementById("repeatButton");
let polygonButton = document.getElementById("polygonButton");
let ellipseButton = document.getElementById("ellipseButton");

// Flags to track modes
let isPointMode = false;
let isPolylineMode = false;
let isRectangleMode = false;
let isRepeatMode = false;
let isPolygonMode = false;
let isEllipseMode = false;

function removeTemporaryPoints() {
  clickCoordinates = [];
  clickImageCoordinates = [];
  clickCoordinatesArray = [];
  ellipseCoordinates = [];
  ellipseImageCoordinates = [];
  annoJSONTemp = {
    type: "FeatureCollection",
    features: [],
  };
}

pointButton.addEventListener("click", () => {
  // Deactivate rect and poly buttons
  rectButton.classList.remove("active");
  isRectangleMode = false;
  polylineButton.classList.remove("active");
  isPolygonMode = false;
  polygonButton.classList.remove("active");
  isPolygonMode = false;
  ellipseButton.classList.remove("active");
  isEllipseMode = false;
  removeTemporaryPoints();
  // Remove any existing temporary points

  if (isPointMode === false) {
    console.log("point mode activated");
    pointButton.classList.add("active");
    isPointMode = true;
  } else {
    console.log("point mode deactivated");
    pointButton.classList.remove("active");
    isPointMode = false;
  }
});

polylineButton.addEventListener("click", () => {
  // Deactivate point and poly buttons
  pointButton.classList.remove("active");
  isPointMode = false;
  rectButton.classList.remove("active");
  isRectangleMode = false;
  polygonButton.classList.remove("active");
  isPolygonMode = false;
  ellipseButton.classList.remove("active");
  isEllipseMode = false;
  removeTemporaryPoints();

  if (isPolylineMode === false) {
    console.log("polyline mode activated");
    polylineButton.classList.add("active");
    isPolylineMode = true;
  } else {
    console.log("polyline mode deactivated");
    polylineButton.classList.remove("active");
    isPolylineMode = false;
    removeTemporaryPoints();
  }
});

rectButton.addEventListener("click", () => {
  // Deactivate point and poly buttons
  pointButton.classList.remove("active");
  isPointMode = false;
  polylineButton.classList.remove("active");
  isPolylineMode = false;
  polygonButton.classList.remove("active");
  isPolygonMode = false;
  ellipseButton.classList.remove("active");
  isEllipseMode = false;
  removeTemporaryPoints();

  if (isRectangleMode === false) {
    console.log("rect mode activated");
    rectButton.classList.add("active");
    isRectangleMode = true;
  } else {
    console.log("rect mode deactivated");
    rectButton.classList.remove("active");
    isRectangleMode = false;
  }
});

repeatButton.addEventListener("click", () => {
  if (isRepeatMode === false) {
    console.log("repeat mode activated");
    repeatButton.classList.add("active");
    isRepeatMode = true;
  } else {
    console.log("repeat mode deactivated");
    repeatButton.classList.remove("active");
    isRepeatMode = false;
  }
});

polygonButton.addEventListener("click", () => {
  console.log("poly button clicked");
  // Deactivate point and rect buttons
  pointButton.classList.remove("active");
  isPointMode = false;
  rectButton.classList.remove("active");
  isRectangleMode = false;
  polylineButton.classList.remove("active");
  isPolylineMode = false;
  ellipseButton.classList.remove("active");
  isEllipseMode = false;
  removeTemporaryPoints();

  if (isPolygonMode === false) {
    console.log("poly mode activated");
    polygonButton.classList.add("active");
    isPolygonMode = true;
  } else {
    console.log("poly mode deactivated");
    polygonButton.classList.remove("active");
    isPolygonMode = false;
  }
});

ellipseButton.addEventListener("click", () => {
  console.log("ellipse button clicked");
  // Deactivate point and rect buttons
  pointButton.classList.remove("active");
  isPointMode = false;
  rectButton.classList.remove("active");
  isRectangleMode = false;
  polylineButton.classList.remove("active");
  isPolylineMode = false;
  polygonButton.classList.remove("active");
  isPolygonMode = false;
  removeTemporaryPoints();

  if (isEllipseMode === false) {
    console.log("ellipse mode activated");
    ellipseButton.classList.add("active");
    isEllipseMode = true;
  } else {
    console.log("ellipse mode deactivated");
    ellipseButton.classList.remove("active");
    isEllipseMode = false;
  }
});

// Show or hide the image menu when the gear button is clicked
document
  .getElementById("imageSettingsButton")
  .addEventListener("click", function (event) {
    console.log("image settings button clicked");
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

// Show or hide the annotations settings menu when the gear button is clicked
document
  .getElementById("gearButton")
  .addEventListener("click", function (event) {
    event.stopPropagation(); // Prevent click from reaching the window listener
    const menu = document.getElementById("annoSettingsMenu");
    if (menu.style.display === "none" || menu.style.display === "") {
      menu.style.display = "block";
    } else {
      menu.style.display = "none";
    }
  });

// Show or hide the annotations settings menu when the circle gear button is clicked
document
  .getElementById("circleGearButton")
  .addEventListener("click", function (event) {
    event.stopPropagation(); // Prevent click from reaching the window listener
    const menu = document.getElementById("circleSettingsMenu");
    if (menu.style.display === "none" || menu.style.display === "") {
      menu.style.display = "block";
    } else {
      menu.style.display = "none";
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

// Close the menu if clicked outside (annotations menu)
window.addEventListener("click", function (event) {
  const menu = document.getElementById("annoSettingsMenu");
  if (
    !event.target.closest("#gearButton") &&
    !event.target.closest("#annoSettingsMenu")
  ) {
    menu.style.display = "none";
  }
});

// Close the menu if clicked outside (circle menu)
window.addEventListener("click", function (event) {
  const menu = document.getElementById("circleSettingsMenu");
  if (
    !event.target.closest("#circleGearButton") &&
    !event.target.closest("#circleSettingsMenu")
  ) {
    menu.style.display = "none";
  }
});

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
  document.getElementById("anno-first-button").disabled = false;
  document.getElementById("anno-prev-button").disabled = false;
  document.getElementById("anno-id").disabled = false;
  document.getElementById("anno-next-button").disabled = false;
  document.getElementById("anno-last-button").disabled = false;
  document.getElementById("anno-label").disabled = false;
  document.getElementById("anno-notes").disabled = false;
  document.getElementById("deleteButton").disabled = false;
  document.getElementById("gearButton").disabled = false;
  document.getElementById("repeatButton").disabled = false;
  document.getElementById("exportBtn").disabled = false;
  document.getElementById("clearBtn").disabled = false;
};

const disableAnnoButtons = () => {
  document.getElementById("anno-first-button").disabled = true;
  document.getElementById("anno-prev-button").disabled = true;
  document.getElementById("anno-id").disabled = true;
  document.getElementById("anno-next-button").disabled = true;
  document.getElementById("anno-last-button").disabled = true;
  document.getElementById("anno-label").disabled = true;
  document.getElementById("anno-notes").disabled = true;
  document.getElementById("deleteButton").disabled = true;
  document.getElementById("gearButton").disabled = true;
  document.getElementById("repeatButton").disabled = true;
  document.getElementById("exportBtn").disabled = true;
  document.getElementById("clearBtn").disabled = true;
  isRepeatMode = false; // Reset repeat mode when disabling buttons
  repeatButton.classList.remove("active");
};

document
  .getElementById("anno-first-button")
  .addEventListener("click", function () {
    console.log("first arrow clicked");
    const annoIdBox = document.getElementById("anno-id");
    const annoIds = Array.from(
      { length: annoJSON.features.length },
      (_, i) => i + 1
    );
    const firstId = annoIds[0];
    annoIdBox.value = firstId;
    const image = viewer.world.getItemAt(0);
    const viewportPoint = image.imageToViewportCoordinates(
      annoJSON.features[firstId - 1].properties.xLabel,
      annoJSON.features[firstId - 1].properties.yLabel
    );
    goToPoint(viewportPoint.x, viewportPoint.y);
    annoLabelToText();
  });

document
  .getElementById("anno-last-button")
  .addEventListener("click", function () {
    console.log("last arrow clicked");
    const annoIdBox = document.getElementById("anno-id");
    // const annoIds = Object.keys(annoDict).map(Number);
    const annoIds = Array.from(
      { length: annoJSON.features.length },
      (_, i) => i + 1
    );
    const lastId = annoIds[annoIds.length - 1];
    annoIdBox.value = lastId;
    const image = viewer.world.getItemAt(0);
    const viewportPoint = image.imageToViewportCoordinates(
      annoJSON.features[lastId - 1].properties.xLabel,
      annoJSON.features[lastId - 1].properties.yLabel
    );
    goToPoint(viewportPoint.x, viewportPoint.y);
    annoLabelToText();
  });

// When the previous annotation button is clicked
document
  .getElementById("anno-prev-button")
  .addEventListener("click", function () {
    console.log("prev arrow clicked");
    // Current annotation id
    const annoIdBox = document.getElementById("anno-id");
    const currentId = parseInt(annoIdBox.value);
    // List of all the annotation ids
    // const annoIds = Object.keys(annoDict).map(Number);
    const annoIds = Array.from(
      { length: annoJSON.features.length },
      (_, i) => i + 1
    );

    console.log("annoIds", annoIds);

    // Index of current annotation id
    const currentIdx = annoIds.indexOf(currentId); // Index of current annotation

    if (currentIdx > 0) {
      const nextIdx = currentIdx - 1;
      const nextId = annoIds[nextIdx];
      annoIdBox.value = nextId;
      const image = viewer.world.getItemAt(0);
      const viewportPoint = image.imageToViewportCoordinates(
        annoJSON.features[nextId - 1].properties.xLabel,
        annoJSON.features[nextId - 1].properties.yLabel
      );
      goToPoint(viewportPoint.x, viewportPoint.y);
      annoLabelToText();
    }
  });

// When the next annotation button is clicked
document
  .getElementById("anno-next-button")
  .addEventListener("click", function () {
    console.log("next arrow clicked");
    // Current annotation id
    const annoIdBox = document.getElementById("anno-id");
    const currentId = parseInt(annoIdBox.value);
    // List of all the annotation ids
    // const annoIds = Object.keys(annoDict).map(Number);
    const annoIds = Array.from(
      { length: annoJSON.features.length },
      (_, i) => i + 1
    );
    // Index of current annotation id
    const currentIdx = annoIds.indexOf(currentId); // Index of current annotation

    // if (currentIdx + 1 < Object.keys(annoDict).length) {
    if (currentIdx + 1 < annoJSON.features.length) {
      const nextIdx = currentIdx + 1;
      const nextId = annoIds[nextIdx];
      annoIdBox.value = nextId;
      const image = viewer.world.getItemAt(0);
      const viewportPoint = image.imageToViewportCoordinates(
        annoJSON.features[nextId - 1].properties.xLabel,
        annoJSON.features[nextId - 1].properties.yLabel
      );
      goToPoint(viewportPoint.x, viewportPoint.y);
      annoLabelToText();
    }
  });

// When the delete annotation button is clicked
document.getElementById("deleteButton").addEventListener("click", function () {
  // Deleting the last item is equivalent to clearing all items
  if (annoJSON.features.length === 1) {
    clearAnnotations();
    disableAnnoButtons();
  } else {
    const id = parseInt(document.getElementById("anno-id").value);
    const uuid = annoJSON.features[id - 1].properties.uuid;
    deleteText(uuid, "anno");
    deleteCrosshairs(uuid, "anno");
    deleteFromGeoJSON(id);
    selectNextAnno(id);
    drawShape(polyCanvas, [annoJSON]);
    // Disable the annotation buttons if there are no annotations left
    if (annoJSON.features.length === 0) {
      disableAnnoButtons();
      document.getElementById("anno-id").value = "";
      document.getElementById("anno-label").value = "";
      document.getElementById("anno-notes").value = "";
    }
  }
});

// labels could be changed without affecting the underlying color of the shapes
function applyCurrentAnno(id, changeLabel = false) {
  const labelFontSize = Number(
    document.getElementById("annoLabelFontSize").value
  );
  const labelFontColor = document.getElementById("annoLabelFontColor").value;
  const labelBackgroundColor = document.getElementById(
    "annoLabelBackgroundColor"
  ).value;
  const labelBackgroundOpacity = Number(
    document.getElementById("annoLabelBackgroundOpacity").value
  );
  const lineWeight = Number(document.getElementById("lineWeight").value);
  const lineColor = document.getElementById("lineColor").value;
  const lineOpacity = Number(document.getElementById("lineOpacity").value);
  const lineStyle = document.getElementById("lineStyle").value;
  const fillColor = document.getElementById("fillColor").value;
  const fillOpacity = Number(document.getElementById("fillOpacity").value);
  const uuid = annoJSON.features[id - 1].properties.uuid;
  const type = annoJSON.features[id - 1].geometry.type;
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
  } else {
    console.warning("Feature type not supported");
  }
}

// Apply current annotation text label style
document
  .getElementById("applyCurrentAnnoLabel")
  .addEventListener("click", function () {
    const id = parseInt(document.getElementById("anno-id").value);
    applyCurrentAnno(id, true);
  });

// Apply current grid text label style
document
  .getElementById("applyCurrentGridLabel")
  .addEventListener("click", function () {
    const id = parseInt(document.getElementById("count-id").value);
    const uuid = countJSON.features[id - 1].properties.uuid;
    applyCurrentGrid(id, true);
    applyFormattingAfterCount(countJSON, uuid, "text");
  });

// Apply all annotations text label style
document
  .getElementById("applyAllAnnoLabel")
  .addEventListener("click", function () {
    const annoIds = Array.from(
      { length: annoJSON.features.length },
      (_, i) => i + 1
    );
    // const annoIds = Object.keys(annoDict).map(Number);
    for (let i = 0; i < annoIds.length; i++) {
      applyCurrentAnno(annoIds[i], true);
    }
  });

// Apply all grid text label style
document
  .getElementById("applyAllGridLabel")
  .addEventListener("click", function () {
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
    const id = parseInt(document.getElementById("anno-id").value);
    applyCurrentAnno(id, false);
  });

// Apply current grid feature style
document
  .getElementById("applyCurrentGrid")
  .addEventListener("click", function () {
    const id = parseInt(document.getElementById("count-id").value);
    const uuid = countJSON.features[id - 1].properties.uuid;
    applyCurrentGrid(id, false);
    applyFormattingAfterCount(countJSON, uuid, "point");
  });

// Apply all annotations feature style
document.getElementById("applyAllAnno").addEventListener("click", function () {
  const annoIds = Array.from(
    { length: annoJSON.features.length },
    (_, i) => i + 1
  );
  // const annoIds = Object.keys(annoDict).map(Number);
  for (let i = 0; i < annoIds.length; i++) {
    applyCurrentAnno(annoIds[i], false);
  }
});

// Apply all grid feature style
document.getElementById("applyAllGrid").addEventListener("click", function () {
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

function selectNextAnno(id) {
  console.log("selecting next id");
  const annoIdBox = document.getElementById("anno-id");
  const annoLabelBox = document.getElementById("anno-label");
  const annoNotesBox = document.getElementById("anno-notes");
  const annoIds = Array.from(
    { length: annoJSON.features.length },
    (_, i) => i + 1
  );
  console.log("annoIds", annoIds);

  // Case where there are no annotations left
  if (annoIds.length === 0) {
    annoLabelBox.value = "";
    annoNotesBox.value = "";
    annoIdBox.value = 1;
    document.getElementById("anno-id").disabled = false;
    return;
  }

  // Case where there is no index that is < id
  if (id > Math.min(annoIds)) {
    const nextId = annoIds[0];
    annoIdBox.value = nextId;
    annoLabelToText();
  } else {
    // Find the index of the closest value that is < id
    const nextIdx = annoIds.reduce(
      (closestIndex, currentValue, currentIndex) => {
        if (currentValue <= id) {
          const closestValue = annoIds[closestIndex];
          if (
            closestValue === undefined ||
            id - currentValue < id - closestValue
          ) {
            return currentIndex;
          }
        }
        return closestIndex;
      },
      -1
    );
    const nextId = annoIds[nextIdx];
    console.log("nextIdx,nextId", nextIdx, nextId);
    annoIdBox.value = nextId;
    annoLabelToText();
  }
}

// Function to update the textbox with the JSON label
function annoLabelToText() {
  const idInput = parseInt(document.getElementById("anno-id").value);
  // Find the annotation by id
  let label = "";
  let notes = "";
  if (annoJSON.features[idInput - 1]) {
    // Access the label within the properties of the GeoJSON object
    label = annoJSON.features[idInput - 1].properties.label ?? "";
    // Access the notes within the properties of the GeoJSON object
    notes = annoJSON.features[idInput - 1].properties.notes ?? "";
  } else {
    console.log("Annotation with this ID not found.");
  }
  const annoLabel = document.getElementById("anno-label");
  const annoNotes = document.getElementById("anno-notes");
  annoLabel.value = `${label}`;
  annoNotes.value = `${notes}`;
}

// Function to update the JSON based on the anno-id text box
function annoTextToLabel() {
  const idInput = parseInt(document.getElementById("anno-id").value);
  const annoLabel = document.getElementById("anno-label");
  const annoNotes = document.getElementById("anno-notes");
  // Check if the ID exists in the annoJSON dictionary
  if (annoJSON.features[idInput - 1]) {
    // Update the label within the properties of the GeoJSON object
    annoJSON.features[idInput - 1].properties.label = annoLabel.value;
    annoJSON.features[idInput - 1].properties.notes = annoNotes.value;
    console.log(
      `Updated label and/or notes for ID ${idInput}:`,
      annoJSON.features[idInput - 1].properties.label
    );
  } else {
    console.log("Annotation with this ID not found.");
  }
}

// When Enter is pressed in the anno-label text box
document.addEventListener("keydown", function (event) {
  const textInput = document.getElementById("anno-label");
  // Check for Enter key in anno-label field
  if (event.code === "Enter" && document.activeElement === textInput) {
    event.preventDefault(); // Prevent any default action for Enter key
    annoTextToLabel();
    const idInput = parseInt(document.getElementById("anno-id").value);
    const uuid = annoJSON.features[idInput - 1].properties.uuid;
    updateText(uuid, "anno", textInput.value);
  }
});

// When Enter is pressed in the anno-notes text box
document.addEventListener("keydown", function (event) {
  const textInput = document.getElementById("anno-notes");
  // Check for Enter key in anno-notes field
  if (event.code === "Enter" && document.activeElement === textInput) {
    event.preventDefault(); // Prevent any default action for Enter key
    annoTextToLabel();
  }
});

// When Enter is pressed in the anno-id input box
document.addEventListener("keydown", function (event) {
  if (
    event.code === "Enter" &&
    document.activeElement === document.getElementById("anno-id")
  ) {
    const idInput = document.getElementById("anno-id");

    console.log("idInput", idInput);

    event.preventDefault(); // Prevent any default action for Enter key
    annoLabelToText();

    console.log(annoJSON);
    const image = viewer.world.getItemAt(0);
    const viewportPoint = image.imageToViewportCoordinates(
      annoJSON.features[parseInt(idInput.value) - 1].properties.xLabel,
      annoJSON.features[parseInt(idInput.value) - 1].properties.yLabel
    );
    goToPoint(viewportPoint.x, viewportPoint.y);

    // Provide visual feedback by changing the border color
    idInput.style.borderColor = "green";
    idInput.style.outline = "none"; // Removes the default focus outline

    setTimeout(() => {
      idInput.style.borderColor = ""; // Revert to original after 1 second
    }, 1000);
  }
});

function goToPoint(x, y) {
  // Center the viewport on the specified coordinates without changing the zoom level
  viewer.viewport.panTo(
    new OpenSeadragon.Point(x, y),
    true // Animate the panning
  );
}

// Function to add a point to the annoJSON
function addPointToGeoJSON(x, y, metadata) {
  // Create a GeoJSON point feature
  // x, y = coordinates in image (pixel) coordinates
  // metadata = dictionary with feature labels and values, e.g., { uuid: 'abc', label: 'Hello World'}
  const pointFeature = {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [x, y], // [x, y] format for coordinates
    },
    properties: metadata, // metadata like label, description, etc.
  };

  // Add the point feature to the annoJSON under the provided id
  annoJSON.features.push(pointFeature);
}

// Function to add a point to the annoJSON
function addPolylineToGeoJSON(JSON, coordinates, metadata) {
  // Create a GeoJSON point feature
  // coordinates = array of x,y values in image (pixel) coordinates
  // metadata = dictionary with feature labels and values, e.g., { uuid: 'abc', label: 'Hello World'}
  const polylineFeature = {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: coordinates, // [[x0, y0],[x1,y1]] format for coordinates
    },
    properties: metadata, // metadata like label, description, etc.
  };
  // Add the point feature to the annoJSON under the provided id
  JSON.features.push(polylineFeature);
}

// Function to add a point to the annoJSON
function addPolygonToGeoJSON(JSON, coordinates, metadata) {
  // Create a GeoJSON polygon feature
  // coordinates = array of x,y values in image (pixel) coordinates
  // metadata = dictionary with feature labels and values, e.g., { uuid: 'abc', label: 'Hello World'}
  const polygonFeature = {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [coordinates], // [[[x0, y0],[x1,y1]]] format for coordinates
    },
    properties: metadata, // metadata like label, description, etc.
  };
  // Add the point feature to the annoJSON under the provided id
  JSON.features.push(polygonFeature);
}

// Function to delete an entry in the JSON
function deleteFromGeoJSON(id) {
  if (annoJSON.features[id - 1]) {
    const uuid = annoJSON.features[id - 1].properties.uuid;
    annoJSON.features.splice(id - 1, 1);
    // delete annoJSON.features[id - 1];
    console.log(`Entry with ID ${uuid} deleted.`);
  } else {
    console.warn(`Entry with ID ${uuid} not found.`);
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
  divideImages();
};

// Import, add, and export points with labels
const toggleAnnotation = (event) => {
  for (let el of document.getElementsByClassName("annotate-crosshairs")) {
    el.style.visibility = event.checked ? "visible" : "hidden";
  }
  if (document.getElementById("show-annotation-labels").checked) {
    for (let el of document.getElementsByClassName("annotate-label")) {
      el.style.visibility = event.checked ? "visible" : "hidden";
    }
  }
  if (polyCanvas.style.display === "none") {
    polyCanvas.style.display = "block"; // Show the canvas
  } else {
    polyCanvas.style.display = "none"; // Hide the canvas
  }
};

// Import, add, and export points with labels
const toggleAnnotationLabels = (event) => {
  if (document.getElementById("show-annotations").checked) {
    for (let el of document.getElementsByClassName("annotate-label")) {
      el.style.visibility = event.checked ? "visible" : "hidden";
    }
  }
};

function disableOtherAnnoModes(mode) {
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
}

// Functions for detecting when q, z, anc x are pressed and released
let isQPressed = false;
let isZPressed = false;
let isXPressed = false;
let isCPressed = false;
document.addEventListener("keydown", function (event) {
  if (event.key === "q" || event.key === "Q") {
    // console.log("Q pressed");
    isQPressed = true;
    toggleCrosshairFloaterOn(true);
    disableOtherAnnoModes("point");
  }
  if (event.key === "z" || event.key === "Z") {
    // console.log("Z pressed");
    isZPressed = true;
    togglePolylineFloaterOn(true);
    disableOtherAnnoModes("polyline");
  }
  if (event.key === "x" || event.key === "X") {
    // console.log("X pressed");
    isXPressed = true;
    togglePolygonFloaterOn(true);
    disableOtherAnnoModes("polygon");
  }
  if (event.key === "c" || event.key === "C") {
    // console.log("C pressed");
    isCPressed = true;
    toggleEllipseFloaterOn(true);
    disableOtherAnnoModes("ellipse");
  }
});
document.addEventListener("keyup", function (event) {
  if (event.key === "q" || event.key === "Q") {
    console.log("Q released");
    isQPressed = false;
    if (!pointButton.classList.contains("active")) {
      // Only toggle off if the button is not also pressed
      toggleCrosshairFloaterOn(false);
    }
  }
  if (event.key === "z" || event.key === "Z") {
    console.log("Z released");
    isZPressed = false;
    if (!polylineButton.classList.contains("active")) {
      // Only toggle off if the button is not also pressed
      togglePolylineFloaterOn(false);
    }
  }
  if (event.key === "x" || event.key === "X") {
    console.log("X released");
    isXPressed = false;
    if (!polygonButton.classList.contains("active")) {
      togglePolygonFloaterOn(false);
    }
  }
  if (event.key === "c" || event.key === "C") {
    console.log("C released");
    isCPressed = false;
    if (!ellipseButton.classList.contains("active")) {
      toggleEllipseFloaterOn(false);
    }
  }
});

// Handler for adding point annotations
viewer.addHandler("canvas-click", function (event) {
  if (isQPressed || isPointMode) {
    console.log("canvs & Q clicked");
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
    const labelFontColor = document.getElementById("annoLabelFontColor").value;
    const labelBackgroundColor = document.getElementById(
      "annoLabelBackgroundColor"
    ).value;
    const labelBackgroundOpacity = Number(
      document.getElementById("annoLabelBackgroundOpacity").value
    );
    const lineWeight = Number(document.getElementById("lineWeight").value);
    const lineColor = document.getElementById("lineColor").value;
    const lineOpacity = Number(document.getElementById("lineOpacity").value);

    let constPointLabel;
    if (isRepeatMode) {
      const annoId = parseInt(document.getElementById("anno-id").value);
      constPointLabel = annoJSON.features[annoId - 1].properties.label;

      const sampleIdx = samples.indexOf(sampleName);
      addPointToGeoJSON(imagePoint.x, imagePoint.y, {
        uuid: uniqueID,
        label: constPointLabel,
        xLabel: imagePoint.x,
        yLabel: imagePoint.y,
        imageTitle: sampleName,
        pixelsPerMeter: Number(pixelsPerMeters[sampleIdx]),
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
    } else {
      showPrompt("Enter the annotation label:", (value) => {
        if (value) {
          console.log("User entered:", value);
          constPointLabel = value;

          const sampleIdx = samples.indexOf(sampleName);
          addPointToGeoJSON(imagePoint.x, imagePoint.y, {
            uuid: uniqueID,
            label: constPointLabel,
            xLabel: imagePoint.x,
            yLabel: imagePoint.y,
            imageTitle: sampleName,
            pixelsPerMeter: Number(pixelsPerMeters[sampleIdx]),
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
        } else {
          console.log("User cancelled. No label added.");
          const sampleIdx = samples.indexOf(sampleName);
          addPointToGeoJSON(imagePoint.x, imagePoint.y, {
            uuid: uniqueID,
            label: "",
            xLabel: imagePoint.x,
            yLabel: imagePoint.y,
            imageTitle: sampleName,
            pixelsPerMeter: Number(pixelsPerMeters[sampleIdx]),
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
            "",
            viewportPoint,
            "anno",
            labelFontColor,
            labelFontSize,
            labelBackgroundColor,
            labelBackgroundOpacity
          );
        }
      });
    }

    addCrosshairs(
      uniqueID,
      viewportPoint,
      "anno",
      lineColor,
      lineWeight,
      lineOpacity
    );
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

function getLowestYPoint(points) {
  let minIndex = points.reduce(
    (minIndex, point, currentIndex, array) =>
      point[1] < array[minIndex][1] ? currentIndex : minIndex,
    0
  );
  return points[minIndex];
}

// TODO: There is a fair bit of code redundancy between ellipse and polyline/
// polygon drawing. Could be refactored to reduce redundancy.
let ellipseCoordinates = []; // Array to store ellipse viewport coordinates
let ellipseImageCoordinates = []; // Array to store ellipse image coordinates
let activelyMakingEllipse = false;
// Event listener to add ellipse annotations
viewer.addHandler("canvas-click", function (event) {
  if (isEllipseMode || isCPressed) {
    console.log("ellipse clicked");
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
    const labelFontColor = document.getElementById("annoLabelFontColor").value;
    const labelBackgroundColor = document.getElementById(
      "annoLabelBackgroundColor"
    ).value;
    const labelBackgroundOpacity = Number(
      document.getElementById("annoLabelBackgroundOpacity").value
    );
    const lineWeight = Number(document.getElementById("lineWeight").value);
    const lineColor = document.getElementById("lineColor").value;
    const lineStyle = document.getElementById("lineStyle").value;
    const lineOpacity = Number(document.getElementById("lineOpacity").value);
    const fillColor = document.getElementById("fillColor").value;
    const fillOpacity = Number(document.getElementById("fillOpacity").value);
    ellipseCoordinates.push({ x, y });
    ellipseImageCoordinates.push([imagePoint.x, imagePoint.y]);

    document.addEventListener("keydown", function (event) {
      // Check if the Escape key was pressed
      if (event.key === "Escape") {
        removeTemporaryPoints();
        console.log("Escape key pressed");
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
          });
          drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
        }
      }
    });

    if (ellipseCoordinates.length === 3) {
      if (isRepeatMode) {
        const annoId = parseInt(document.getElementById("anno-id").value);
        var constEllipseLabel = annoJSON.features[annoId - 1].properties.label;
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
      } else {
        // var constEllipseLabel = prompt("Enter a label for this polyline:");
        var constEllipseLabel;
        showPrompt("Enter the annotation label:", (value) => {
          if (value) {
            console.log("User entered:", value);
            constEllipseLabel = value;
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
          } else {
            console.log("User cancelled. No label added.");
            constEllipseLabel = "";
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
          }
        });
        drawPath(polyCanvas, [annoJSON]);
      }
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
  const labelImagePoint = getLowestYPoint(ellipsePoints);
  const labelViewportPoint = image.imageToViewportCoordinates(
    labelImagePoint[0],
    labelImagePoint[1]
  );
  const sampleIdx = samples.indexOf(sampleName);
  const areaPixels2 = calculatePolygonArea([ellipsePoints]);
  const areaM2 = areaPixels2 / pixelsPerMeters[currentIndex] ** 2;
  const perimeterPixels = calculatePolygonExteriorPerimeter([ellipsePoints]);
  const perimeterM = perimeterPixels / pixelsPerMeters[currentIndex];

  addPolygonToGeoJSON(annoJSON, [...ellipsePoints], {
    uuid: uniqueID,
    label: label,
    xLabel: labelImagePoint[0],
    yLabel: labelImagePoint[1],
    imageTitle: sampleName,
    pixelsPerMeter: Number(pixelsPerMeters[sampleIdx]),
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

// Event listener to add polyline and polygon annotations
let clickCoordinates = []; // Array to store viewport coordinates
let clickImageCoordinates = []; // Array to store image coordinates
let clickCoordinatesArray = []; // Array to store arrays of coordinates
let clickTimeout; // Timeout reference to detect double-click
const clickDelay = 300; // Maximum delay between clicks for detecting double-click
let lastClickTime = 0; // Timestamp of the last click
const polyCanvas = document.getElementById("annotation-overlay"); // Includes polyline and polygon
const circleCanvas = document.getElementById("circle-overlay"); // Includes circles
const measureCanvas = document.getElementById("measurement-overlay"); // Includes polyline and polygon
let activelyMakingPoly = false; // Either polyline or polygon
viewer.addHandler("canvas-click", function (event) {
  console.log("canvas clicked");
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
    const labelFontColor = document.getElementById("annoLabelFontColor").value;
    const labelBackgroundColor = document.getElementById(
      "annoLabelBackgroundColor"
    ).value;
    const labelBackgroundOpacity = Number(
      document.getElementById("annoLabelBackgroundOpacity").value
    );
    const lineWeight = Number(document.getElementById("lineWeight").value);
    const lineColor = document.getElementById("lineColor").value;
    const lineStyle = document.getElementById("lineStyle").value;
    const lineOpacity = Number(document.getElementById("lineOpacity").value);
    const fillColor = document.getElementById("fillColor").value;
    const fillOpacity = Number(document.getElementById("fillOpacity").value);
    clickCoordinates.push({ x, y });
    clickImageCoordinates.push([imagePoint.x, imagePoint.y]);
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

    document.addEventListener("keydown", function (event) {
      // Check if the Escape key was pressed
      if (event.key === "Escape") {
        removeTemporaryPoints();
        console.log("Escape key pressed");
      }
    });

    // Continually update the annoJSONTemp with the latest coordinates
    viewerContainer.addEventListener("mousemove", function (subevent) {
      if (activelyMakingPoly) {
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
        const sampleIdx = samples.indexOf(sampleName);
        addPolylineToGeoJSON(
          annoJSONTemp,
          [
            ...clickImageCoordinates,
            [subeventImagePoint.x, subeventImagePoint.y],
          ],
          {
            labelFontSize: labelFontSize,
            labelFontColor: labelFontColor,
            labelBackgroundColor: labelBackgroundColor,
            labelBackgroundOpacity: labelBackgroundOpacity,
            lineStyle: lineStyle,
            lineWeight: lineWeight,
            lineColor: lineColor,
            lineOpacity: lineOpacity,
            // canvasDraw: true,
          }
        );
        drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
      }
    });

    // If the time between this click and the last click is shorter than clickDelay, it's a double-click
    const currentTime = new Date().getTime();
    if (currentTime - lastClickTime < clickDelay) {
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
      console.log("Double-click detected, ending collection of points.");

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
      const sampleIdx = samples.indexOf(sampleName);

      const rectAreaPixels2 = calculatePolygonArea([clickImageCoordinates]);
      const rectAreaM2 = rectAreaPixels2 / pixelsPerMeters[currentIndex] ** 2;
      const rectPerimeterPixels = calculatePolygonExteriorPerimeter([
        clickImageCoordinates,
      ]);
      const rectPerimeterM =
        rectPerimeterPixels / pixelsPerMeters[currentIndex];
      const lineLengthPixels = calculateLineStringLength(
        clickImageCoordinates.slice(0, clickImageCoordinates.length - 1)
      );
      const lineLengthM = lineLengthPixels / pixelsPerMeters[currentIndex];

      if (isRepeatMode) {
        const annoId = parseInt(document.getElementById("anno-id").value);
        var constPolylineLabel = annoJSON.features[annoId - 1].properties.label;
        finalizePolyAnnotation(
          constPolylineLabel,
          labelImagePoint,
          imageSize,
          sampleIdx,
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
        console.log("Poly mode disabled");
        enableAnnoButtons();
      } else {
        // var constPolylineLabel = prompt("Enter a label for this polyline:");
        showPrompt("Enter the annotation label:", (value) => {
          const constPolylineLabel = value || "";
          finalizePolyAnnotation(
            constPolylineLabel,
            labelImagePoint,
            imageSize,
            sampleIdx,
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
          console.log("Poly mode disabled");
          enableAnnoButtons();
        });
      }
    } else {
      // It's a single click, so set a timeout to handle it
      clickTimeout = setTimeout(function () {
        console.log("Single click detected, continuing collection...");
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
  sampleIdx,
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
    // Close the polygon by adding the first point to the end
    clickCoordinates = clickImageCoordinates.slice(
      0,
      clickImageCoordinates.length - 1
    ); // To avoid getting a duplicated final point
    clickImageCoordinates.push(clickImageCoordinates[0]);
    addPolygonToGeoJSON(annoJSON, clickImageCoordinates, {
      uuid: uuid,
      label: constPolylineLabel,
      xLabel: labelImagePoint.x,
      yLabel: labelImagePoint.y,
      imageTitle: sampleName,
      pixelsPerMeter: Number(pixelsPerMeters[sampleIdx]),
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
    addPolylineToGeoJSON(
      annoJSON,
      clickImageCoordinates.slice(0, clickImageCoordinates.length - 1), // To avoid getting a duplicated final point
      {
        uuid: uuid,
        label: constPolylineLabel,
        xLabel: labelImagePoint.x,
        yLabel: labelImagePoint.y,
        imageTitle: sampleName,
        pixelsPerMeter: Number(pixelsPerMeters[sampleIdx]),
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
});

// TOOD: Is this necessary? Could be partially redundant with the above function
viewerContainer.addEventListener("mousemove", () => {
  drawShape(polyCanvas, [annoJSONTemp, annoJSON]);
  drawShape(circleCanvas, [circleJSON]);
  drawShape(measureCanvas, [measureJSONTemp, measureAreaJSONTemp, measureJSON]);
});

// Event listener for double-click to end collection
viewer.addHandler("canvas-dblclick", function (event) {
  if (isPolylineMode) {
    // Double-click detected, stop collecting points
    console.log("Double-click detected, ending collection of points.");
    console.log("Collected Coordinates:", clickCoordinates);

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
    const fillOpacity = Number(document.getElementById("fillOpacity").value);
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
    const lineOpacity = Number(document.getElementById("lineOpacity").value);
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
    const lineOpacity = Number(document.getElementById("lineOpacity").value);
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
}

let startPoint = null;
let startPixel;
let startPointImage = null;
let overlayElement = null;
let currentRectUniqueId;
viewer.addHandler("canvas-drag", function (event) {
  if (event.originalEvent.shiftKey || isRectangleMode) {
    event.preventDefaultAction = true; // Prevent default behavior (like panning)

    const canvasPoint = event.position;
    const viewportPoint = viewer.viewport.pointFromPixel(event.position);

    const labelFontSize = Number(
      document.getElementById("annoLabelFontSize").value
    );
    const labelFontColor = document.getElementById("annoLabelFontColor").value;
    const labelBackgroundColor = document.getElementById(
      "annoLabelBackgroundColor"
    ).value;
    const labelBackgroundOpacity = Number(
      document.getElementById("annoLabelBackgroundOpacity").value
    );
    const lineWeight = Number(document.getElementById("lineWeight").value);
    const lineColor = document.getElementById("lineColor").value;
    const lineStyle = document.getElementById("lineStyle").value;
    const lineOpacity = Number(document.getElementById("lineOpacity").value);
    const fillColor = document.getElementById("fillColor").value;
    const fillOpacity = Number(document.getElementById("fillOpacity").value);

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
  if ((event.originalEvent.shiftKey || isRectangleMode) && startPoint) {
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
    const labelFontColor = document.getElementById("annoLabelFontColor").value;
    const labelBackgroundColor = document.getElementById(
      "annoLabelBackgroundColor"
    ).value;
    const labelBackgroundOpacity = Number(
      document.getElementById("annoLabelBackgroundOpacity").value
    );
    const lineWeight = Number(document.getElementById("lineWeight").value);
    const lineColor = document.getElementById("lineColor").value;
    const lineStyle = document.getElementById("lineStyle").value;
    const lineOpacity = Number(document.getElementById("lineOpacity").value);
    const fillColor = document.getElementById("fillColor").value;
    const fillOpacity = Number(document.getElementById("fillOpacity").value);

    if (isRepeatMode) {
      const annoId = parseInt(document.getElementById("anno-id").value);
      var constRectLabel = annoJSON.features[annoId - 1].properties.label;
      finalizeRectAnnotationWithCoords(
        rectCoordinates,
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
      );
      annoJSONTemp = {
        type: "FeatureCollection",
        features: [],
      };
      drawShape(polyCanvas, [annoJSON]);
    } else {
      var constRectLabel;
      drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
      showPrompt("Enter the annotation label:", (value) => {
        if (value) {
          console.log("User entered:", value);
          constRectLabel = value;
          finalizeRectAnnotationWithCoords(
            rectCoordinates,
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
          );
          annoJSONTemp = {
            type: "FeatureCollection",
            features: [],
          };
          drawShape(polyCanvas, [annoJSON]);
        } else {
          constRectLabel = "";
          finalizeRectAnnotationWithCoords(
            rectCoordinates,
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
          );
          annoJSONTemp = {
            type: "FeatureCollection",
            features: [],
          };
          drawShape(polyCanvas, [annoJSON]);
        }
      });
    }
  }
  enableAnnoButtons();
  window.appState.hasUnsavedAnnotations = true; // TODO: Turn off button between each annotation???
  if (!rectButton.classList.contains("active")) {
    toggleRectFloaterOn(false);
  }
  shiftKeyHeld = false; // TODO: is this right?    // Clear upon release
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
  const rectAreaM2 = rectAreaPixels2 / pixelsPerMeters[currentIndex] ** 2;
  const rectPerimeterPixels = calculatePolygonExteriorPerimeter([coordinates]);
  const rectPerimeterM = rectPerimeterPixels / pixelsPerMeters[currentIndex];

  // Add the rectangle to geoJSON
  const sampleIdx = samples.indexOf(sampleName);
  addPolygonToGeoJSON(annoJSON, coordinates, {
    uuid: currentRectUniqueId,
    label: constRectLabel,
    xLabel: coordinates[0][0], // top-left corner
    yLabel: coordinates[0][1],
    imageTitle: sampleName,
    pixelsPerMeter: Number(pixelsPerMeters[sampleIdx]),
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

// OLD deprecated function. Does not support drawing on a rotated viewport.
function finalizeRectAnnotation(
  x,
  y,
  finalWidth,
  finalHeight,
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
  fillOpacity,
  finalPoint
) {
  // Calculate the four corners of the rectangle
  const coordinates = [
    [x, y], // Top-left corner
    [x + finalWidth, y], // Top-right corner
    [x + finalWidth, y + finalHeight], // Bottom-right corner
    [x, y + finalHeight], // Bottom-left corner
    [x, y], // Close the loop to the top-left corner
  ];

  const rectAreaPixels2 = calculatePolygonArea([coordinates]);
  const rectAreaM2 = rectAreaPixels2 / pixelsPerMeters[currentIndex] ** 2;
  const rectPerimeterPixels = calculatePolygonExteriorPerimeter([coordinates]);
  const rectPerimeterM = rectPerimeterPixels / pixelsPerMeters[currentIndex];

  // Add the rectangle to the geoJSON
  const sampleIdx = samples.indexOf(sampleName);
  addPolygonToGeoJSON(annoJSON, coordinates, {
    uuid: currentRectUniqueId,
    label: constRectLabel,
    xLabel: x,
    yLabel: y,
    imageTitle: sampleName,
    pixelsPerMeter: Number(pixelsPerMeters[sampleIdx]),
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

  // Mouse up - finalize and reset for the next rectangle
  startPoint = null;
  overlayElement = null;

  // Add the label
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
  if (
    confirm(
      "Are you sure you want to apply clear the annotations? This action cannot be undone."
    )
  ) {
    console.log("Clear confirmed");
    clearAnnotations();
    disableAnnoButtons();
    // annotations = [];
  } else {
    console.log("Clear cancelled");
  }
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
  pointLabel.innerHTML = `${label}`;
  pointLabel.className = `${className}`;
  pointLabel.id = `${className}-${i}`;

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
  pointLabel.style.transformOrigin = "center center";
  pointLabel.style.willChange = "transform"; // performance hint

  // assemble and add overlay
  container.appendChild(pointLabel);
  viewer.addOverlay({
    element: container,
    location: location,
    checkResize: false,
  });

  // keep reference to the INNER label so we can rotate it later
  if (type === "anno") {
    annotateLabels.push(pointLabel);
    unsavedAnnotations(true);
    updateRepeatButton();
  }

  // immediately sync it to current rotation (so newly added labels are upright)
  const currentRotation = viewer.viewport.getRotation();
  pointLabel.style.transform = `rotate(${-currentRotation}deg)`;
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
    viewer.removeOverlay(overlayElement); // Remove the overlay using the element
    if (type === "anno") {
      // TODO: Is this code necessary?
      annotateLabels = annotateLabels.filter(
        (label) => label.id !== `annotate-label-${uuid}`
      ); // Clean up the array
      // window.appState.hasUnsavedAnnotations = true;
      unsavedAnnotations(true);
    }
    // Finally remove the element from DOM
    overlayElement.remove();
  } else {
    console.warn(`Text overlay with ID-${uuid} not found.`);
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

  if (pointLabel) {
    if (newLabel !== undefined && newLabel !== null) {
      console.log("updating label innerHTML");
      // Update the innerHTML with the new label
      pointLabel.innerHTML = newLabel;
    }

    console.log(`Label updated for ID ${uuid}:`, newLabel);
    if (type === "anno") {
      // window.appState.hasUnsavedAnnotations = true;
      unsavedAnnotations(true);
    }

    // Update the CSS variables if new values are provided
    if (color !== undefined) {
      const colorToPlot = applyOpacityToColor(color, 1.0);
      console.log("colorToPlot", colorToPlot);
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
  } else {
    console.log(`No annotation found with ID ${uuid}.`);
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
    console.error(`Crosshair with ID "${uuid}" not found.`);
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
    // console.log(`Crosshair with ID ${uuid} removed.`);
  } else {
    console.warn(`Crosshair with ID ${uuid} not found.`);
  }
  if (type === "anno") {
    updateRepeatButton();
  }
}

function loadAnnotationsFromJSON(file) {
  // Use fetch to get the GeoJSON file from the URL
  console.log("Beginning loading annotations from JSON", file);
  fetch(file)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      // Log the raw response as text for debugging
      return response.json(); // Use text() first to inspect the content
    })
    .then((data) => {
      console.log("GeoJSON data loaded:", data);
      loadAnnotations(data);
      // You can now use the geoJsonData for mapping or other purposes
    })
    .catch((error) => {
      console.error("Error loading GeoJSON:", error);
    });
  updateRepeatButton();
}

function loadCounts(geoJSONData) {
  console.log("Starting counts load");
  const geoJSON = parseJSON(geoJSONData);

  const features = geoJSON.features || Object.values(geoJSON); // Supports both formats
  features.forEach((feature) => {
    const geometry = feature.geometry;
    const properties = feature.properties;

    if (!geometry || !properties) {
      console.warn("Invalid feature, skipping:", feature);
      return;
    }

    const { type, coordinates } = geometry;

    if (type !== "Point") {
      console.warn("Skipping non-point feature", feature);
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
    console.log("Invalid point geometry, skipping");
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
      console.log("Parsed GeoJSON:", geoJSON);
    } catch (error) {
      console.error("Error parsing GeoJSON:", error);
      return; // Exit if parsing fails
    }
  } else {
    geoJSON = geoJSONData;
    console.log("GeoJSON is already parsed:", geoJSON);
  }
  return geoJSON;
}

// New loadAnnotations() for testing
function loadAnnotations(geoJSONData) {
  console.log("Starting annotation load");
  const geoJSON = parseJSON(geoJSONData);

  const features = geoJSON.features || Object.values(geoJSON); // Supports both formats
  features.forEach((feature) => {
    const geometry = feature.geometry;
    const properties = feature.properties;
    if (!geometry || !properties) {
      console.warn("Invalid feature, skipping:", feature);
      return;
    }

    // Skip duplicate UUIDs
    const uuids = annoJSON.features.map((f) => f.properties.uuid);
    if (uuids.includes(properties.uuid)) {
      console.log("Warning: annotation already exists, skipping");
      return;
    }

    const { type, coordinates } = geometry;

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

    // Redraw the shapes and enable annotation features
    drawShape(polyCanvas, [annoJSON]);
    enableAnnoButtons();
    annoLabelToText();
  });
}

// Helper functions for specific geometry types
function handlePoint(coords, properties) {
  const [x, y] = coords;
  if (isNaN(x) || isNaN(y)) {
    console.log("Invalid point geometry, skipping");
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
    console.log("Invalid MultiPoint geometry, skipping");
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
      console.log("Invalid point geometry, skipping");
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
  console.log("loading MultiPolygon");
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
  const geoJSONFeature = {
    type: "Feature",
    geometry: { type, coordinates },
    properties: {
      ...properties,
      pixelsPerMeter: Number(properties.pixelsPerMeter),
      imageWidth: Number(properties.imageWidth),
      imageHeight: Number(properties.imageHeight),
      labelFontSize: Number(properties.labelFontSize),
      labelBackgroundOpacity: Number(properties.labelBackgroundOpacity),
      lineWeight: Number(properties.lineWeight),
      lineOpacity: Number(properties.lineOpacity),
      fillOpacity: Number(properties.fillOpacity),
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
      console.log("not a file!");
      return;
    }

    if (file) {
      const reader = new FileReader();
      reader.onload = function (event) {
        const geoJSONData = event.target.result;
        loadAnnotations(geoJSONData);
        fileInput.value = "";
      };
      reader.readAsText(file);
    } else {
      alert("Please select a GeoJSON file to load annotations.");
    }
  });

// Attach export functionality to the button (GeoJSON version)
document.getElementById("exportBtn").addEventListener("click", function () {
  const geoJSON = annoJSON;
  console.log(geoJSON);
  // Create a Blob from the GeoJSON object
  const geoJSONBlob = new Blob([JSON.stringify(geoJSON, null, 2)], {
    type: "application/geo+json",
  });
  // Trigger the download with 'saveAs'
  saveAs(geoJSONBlob, "annotations.geojson");
  // Reset the unsaved annotations flag (if necessary)
  // window.appState.hasUnsavedAnnotations = false;
  unsavedAnnotations(false);
});

// Attach export functionality to the button (GeoJSON version)
document.getElementById("save-counts").addEventListener("click", function () {
  const geoJSON = countJSON;
  console.log(geoJSON);
  // Create a Blob from the GeoJSON object
  const geoJSONBlob = new Blob([JSON.stringify(geoJSON, null, 2)], {
    type: "application/geo+json",
  });
  // Trigger the download with 'saveAs'
  saveAs(geoJSONBlob, "counts.geojson");
  unsavedCounts(false);
});

const clearAnnotations = () => {
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
  drawShape(polyCanvas, [annoJSON, annoJSONTemp]);
  console.log("Cleared", geoJSON);
  const annoLabel = document.getElementById("anno-label");
  const annoNotes = document.getElementById("anno-notes");
  const annoId = document.getElementById("anno-id");
  annoLabel.value = "";
  annoNotes.value = "";
  annoId.value = 1;
  // window.appState.hasUnsavedAnnotations = false;
  unsavedAnnotations(false);
};

viewerContainer.addEventListener("pointermove", (event) => {
  mousePos = new OpenSeadragon.Point(event.clientX, event.clientY);
  if (enableDivideImages) {
    divideImages();
  }
});

////////////////////////
// Keyboard Shortcuts //
////////////////////////

// Keyboard shortcut handler to toggle checkboxes
const toggleCheckbox = (id) => {
  const checkbox = document.getElementById(id);
  checkbox.click(); // Trigger the onclick handler for each checkbox
};

// Add keyboard event listener
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.altKey) {
    switch (event.code) {
      case "Digit1":
        toggleCheckbox("image1");
        break;
      case "Digit2":
        toggleCheckbox("image2");
        break;
      case "Digit3":
        toggleCheckbox("image3");
        break;
      case "Digit4":
        toggleCheckbox("image4");
        break;
      case "KeyG":
        toggleCheckbox("show-grid");
        break;
      case "KeyD":
        toggleCheckbox("enableDivideImages");
        break;
      default:
        return; // Exit early if no match
    }

    event.preventDefault(); // Optional: block browser behavior
  }
});

////////////////////////
// Grid functionality //
////////////////////////

const Grid = class {
  constructor({ unit, pixelsPerUnit, xMin, yMin, xMax, yMax, step, noPoints }) {
    this.unit = unit;
    this.pixelsPerUnit = pixelsPerUnit;
    this.xMin = xMin;
    this.yMin = yMin;
    this.xMax = xMax;
    this.yMax = yMax;
    this.step = step;
    this.noPoints = noPoints;
  }

  get metersPerUnit() {
    return 10 ** (-3 * this.unit);
  }

  get unitName() {
    switch (this.unit) {
      case 0:
        return "m";
      case 1:
        return "mm";
      case 2:
        return "μm";
      case 3:
        return "nm";
    }
  }

  get pixelsPerMeter() {
    q;
    return this.pixelsPerUnit / this.metersPerUnit;
  }
};

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
  document.getElementById("apply-grid-settings").disabled = false;
  // document.getElementById("restore-grid-settings").disabled = false;
};

// Empty arrays to store points and crosshairs
let gridOverlayPoints = []; ///
let gridOverlayCrosshairs = []; ///

// TODO: Could combine enableGridButtons() and disableGridButtons() into a single function
function enableCountButtons() {
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
  document.getElementById("filterDropdown").disabled = false;
  document.getElementById("filterButton").disabled = false;
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
  document.getElementById("filterDropdown").disabled = true;
  document.getElementById("filterButton").disabled = true;
  document.getElementById("summarizeButton").disabled = true;
}

document
  .getElementById("apply-grid-settings")
  .addEventListener("click", function () {
    let proceed = true;
    if (countJSON.features.length > 0) {
      proceed = confirm(
        "Applying the grid will clear existing point counts. Do you want to proceed? This action cannot be undone."
      );
    }

    if (proceed) {
      applyGridSettings();
    }
  });

const applyGridSettings = () => {
  clearGrid();

  // Enable buttons and input field after settings are applied
  enableCountButtons();

  const image = viewer.world.getItemAt(0);
  grid = new Grid({
    unit: units[currentIndex],
    pixelsPerUnit: pixelsPerUnits[currentIndex],
    xMin: parseFloat(document.getElementById("grid-left").value),
    yMin: parseFloat(document.getElementById("grid-top").value),
    xMax: parseFloat(document.getElementById("grid-right").value),
    yMax: parseFloat(document.getElementById("grid-bottom").value),
    step: parseInt(document.getElementById("step-size").value),
    noPoints: parseInt(document.getElementById("no-points").value),
  });

  const imageSize = image.getContentSize();
  console.log("image size:", imageSize);
  console.log("pixels per unit:", grid.pixelsPerUnit);
  const x_min_um = ((grid.xMin / 100) * imageSize.x) / grid.pixelsPerUnit;
  const x_max_um = ((grid.xMax / 100) * imageSize.x) / grid.pixelsPerUnit;
  const y_min_um = ((grid.yMin / 100) * imageSize.y) / grid.pixelsPerUnit;
  const y_max_um = ((grid.yMax / 100) * imageSize.y) / grid.pixelsPerUnit;

  // Get the coordinates and labels for point counts
  let [X, Y, A] = makePoints(
    x_min_um,
    x_max_um,
    y_min_um,
    y_max_um,
    grid.step,
    grid.noPoints
  );

  for (let i = 0; i < X.length; i++) {
    // Get the coordinates in the specified unit.
    const xUnits = X[i];
    const yUnits = Y[i];

    // Convert to coordinates in pixels.
    const xPixels = xUnits * pixelsPerUnits[currentIndex];
    const yPixels = yUnits * pixelsPerUnits[currentIndex];

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

    const sampleIdx = samples.indexOf(sampleName);

    const coords = [xPixels, yPixels];
    const properties = {
      uuid: generateUniqueId(16),
      label: `${A[i]}`,
      id: "",
      notes: "",
      xLabel: xPixels,
      yLabel: yPixels,
      imageTitle: sampleName,
      pixelsPerMeter: Number(pixelsPerMeters[sampleIdx]),
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

  console.log("Cleared grid");
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
  if (
    confirm(
      "Are you sure you want to clear the grid? This will delete the existing grid along with any point counts. This action cannot be undone."
    )
  ) {
    clearGrid();
  }
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

  // Start at top-left pixel and progress to the bottom-right in snake-like pattern
  let n_y_rows = Math.floor((y_max - y_min) / step_size) + 1;
  let n_x_cols = Math.floor((x_max - x_min) / step_size) + 1;

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

    c += X.length;

    if (c <= num_points) {
      Xs = [...Xs, ...X];
      Ys = [...Ys, ...Y];
      As = [...As, ...A];
      legend = [...legend, ...Array(X.length).fill(e + 1)];
      d /= 2.0;
    } else {
      Xs = [...Xs, ...X.slice(0, num_points - c)];
      Ys = [...Ys, ...Y.slice(0, num_points - c)];
      As = [...As, ...A.slice(0, num_points - c)];
      legend = [
        ...legend,
        ...Array(X.slice(0, num_points - c).length).fill(e + 1),
      ];
      break;
    }

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
  // Loop through all features in the annoJSON
  annoJSON.features.forEach((feature) => {
    const props = feature.properties;
    const uuid = props.uuid;
    applyAnnoLabel(idBase, uuid);
  });
}

// Functionality for applying specific formatting for annotations
function applyAllAnnoFeature(idBase) {
  // Loop through all features in the annoJSON
  annoJSON.features.forEach((feature) => {
    const props = feature.properties;
    const uuid = props.uuid;
    applyAnnoFeature(idBase, uuid);
  });
}

function applyCurrentAnnoLabel(idBase) {
  const id = document.getElementById("anno-id").value;
  const uuid = annoJSON.features[id - 1].properties.uuid;
  applyAnnoLabel(idBase, uuid);
}

function applyCurrentAnnoFeature(idBase) {
  const id = document.getElementById("anno-id").value;
  const uuid = annoJSON.features[id - 1].properties.uuid;
  applyAnnoFeature(idBase, uuid);
}

function applyAnnoLabel(idBase, uuid) {
  const formattingMap = {
    annoLabelFontSize: "labelFontSize",
    annoLabelFontColor: "labelFontColor",
    annoLabelBackgroundColor: "labelBackgroundColor",
    annoLabelBackgroundOpacity: "labelBackgroundOpacity",
  };

  const feature = annoJSON.features.find((f) => f.properties.uuid === uuid);
  const props = feature.properties;
  const input = document.getElementById(idBase);
  console.log("input", input.value);
  feature.properties[formattingMap[idBase]] = input.value;

  // Apply visual formatting immediately
  if (idBase === "annoLabelFontSize") {
    updateText(uuid, "anno", undefined, undefined, input.value);
  } else if (idBase === "annoLabelFontColor") {
    updateText(uuid, "anno", undefined, input.value);
  } else if (idBase === "annoLabelBackgroundColor") {
    // Need both backgroundColor and backgroundOpacity to apply background
    const bgColor = input.value;
    const bgOpacity = props["labelBackgroundOpacity"];
    if (!bgOpacity) {
      console.warn(
        "Background opacity is not set, cannot apply background color."
      );
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
    const bgOpacity = input.value;
    const bgColor = props["labelBackgroundColor"];
    if (!bgColor) {
      console.warn(
        "Background color is not set, cannot apply background opacity."
      );
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
  const props = feature.properties;
  const input = document.getElementById(idBase);
  props[idBase] = input.value;
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
  // Loop through all features in the countJSON
  countJSON.features.forEach((feature) => {
    const props = feature.properties;
    const id = props.label;
    applyGridLabel(idBase, id);
  });
}

function applyAllGridCrosshair(idBase) {
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
  applyGridLabel(idBase, id);
}

function applyCurrentGridCrosshair(idBase) {
  const id = document.getElementById("count-id").value;
  applyGridCrosshair(idBase, id);
}

// Functionality for applying specific formatting for grid attributes
function applyGridLabel(idBase, id) {
  if (isNaN(id) || id < 1 || id > countJSON.features.length) {
    console.warn("Invalid ID selected.");
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
    console.warn(`The element was not found: ${input}`);
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
      console.warn(
        "Background opacity is not set, cannot apply background color."
      );
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
      console.warn(
        "Background color is not set, cannot apply background opacity."
      );
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
    console.warn("Invalid ID selected.");
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
    console.warn(`The element was not found: ${input}`);
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
    console.warn(`No feature found with id: ${id}`);
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

  console.log(
    uuid,
    labelFontColor,
    labelFontSize,
    labelBackgroundColor,
    labelBackgroundOpacity
  );

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
  console.log("prev button clicked");
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
    console.log("Enter clicked");
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
  // Check if the space bar is pressed without modifiers
  if (
    event.code === "Space" &&
    document.activeElement.id !== "count-notes" &&
    document.activeElement.id !== "anno-label" &&
    document.activeElement.id !== "anno-notes" &&
    document.activeElement.id !== "promptInput"
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

  // Store the text in the geoJSON
  countJSON.features[id - 1].properties.id = textInput.value;
  // window.appState.hasUnsavedCounts = true;
  unsavedCounts(true);
}

function inputNotesText() {
  const input = document.getElementById("count-id");
  let value = parseInt(input.value, 10);
  const textInput = document.getElementById("count-notes");

  // Store the text in the object with sampleNumber as key
  countJSON.features[value - 1].properties.notes = textInput.value;
  // window.appState.hasUnsavedCounts = true;
  unsavedCounts(true);
}

// Function to update repeatButton state
function updateRepeatButton() {
  // Enable the checkbox if the dictionary has at least one item
  repeatButton.disabled = annoJSON.features.length === 0;
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
    csvContent += `${sampleName},${pointNumber},${x_px},${y_px},"${label}","${notes}"\n`;
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
    console.log("load count geoJSON clicked");
    const fileInput = event.target;
    const file = fileInput.files[0];
    if (!file) {
      console.log("not a file!");
      return;
    }

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

    console.log("Loading CSV");

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
      imageTitle: sampleName,
      pixelsPerMeter: pixelsPerMeters[currentIndex],
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

// Function to populate the dropdown with unique labels and checkboxes
function populateFilterDropdown() {
  const filterDropdown = document.getElementById("includeDropdown");
  const uniqueLabels = getUniqueLabels();
  console.log("unique labels", uniqueLabels);

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

    console.log(checkbox.id, checkbox.checked);

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

// Attach event listener to the filterButton
document.getElementById("filterButton").addEventListener("click", function () {
  populateFilterDropdown();
  const includeDropdown = document.getElementById("includeDropdown");

  // Toggle visibility of the dropdown menu
  if (includeDropdown.style.display === "block") {
    includeDropdown.style.display = "none";
  } else {
    includeDropdown.style.display = "block";
  }
});

// Optional: Close the dropdown when clicking outside
document.addEventListener("click", function (event) {
  const includeDropdown = document.getElementById("includeDropdown");
  const filterButton = document.getElementById("filterButton");

  // Check if the click is outside the dropdown and button
  if (
    !includeDropdown.contains(event.target) &&
    event.target !== filterButton
  ) {
    includeDropdown.style.display = "none";
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

// Function to populate the dropdown with unique labels from overlays
function populateDropdown() {
  const filterDropdown = document.getElementById("filterDropdown");

  // Clear existing dropdown options
  filterDropdown.innerHTML = `<option value="all">All</option>`; // Default option

  // Get unique labels
  const uniqueLabels = getUniqueLabels();

  // Add each unique label as an option
  uniqueLabels.forEach((label) => {
    const option = document.createElement("option");
    option.value = label;
    option.textContent = label;
    filterDropdown.appendChild(option);
  });
}

// TODO: Enable checkbox-style filtering, such that any combination of
// unique counts could be shown or ommitted
// Function to filter overlays based on selected label
function filterOverlays() {
  const filterDropdown = document.getElementById("filterDropdown");
  const selectedLabel = filterDropdown.value;
  const noPoints = parseInt(document.getElementById("no-points").value);

  for (let value = 1; value <= noPoints; value++) {
    const label = countJSON.features[value - 1].properties.id;
    const uuid = countJSON.features[value - 1].properties.uuid;
    const textOverlay = viewer.getOverlayById(`grid-label-${uuid}`);
    const crosshairOverlay = viewer.getOverlayById(`grid-crosshair-${uuid}`);

    // Manage visibility by changing the opacity of the overlay element
    if (selectedLabel === "all" || label === selectedLabel) {
      textOverlay.element.style.visibility = "visible"; // Make overlay visible
      crosshairOverlay.element.style.visibility = "visible"; // Make overlay visible
    } else {
      textOverlay.element.style.visibility = "hidden"; // Hide overlay
      crosshairOverlay.element.style.visibility = "hidden"; // Hide overlay
    }
  }
}

// Ensure overlays respect the filter on each viewport update (for panning, zooming, etc.)
function enforceOverlayVisibility() {
  // const noPoints = parseInt(document.getElementById("no-points").value);
  const noPoints = parseInt(countJSON.features.length);

  for (let value = 1; value <= noPoints; value++) {
    const overlayId = `grid-label-${value - 1}`;
    const overlay = viewer.getOverlayById(overlayId);

    if (overlay) {
      const isVisible = overlay.element.style.visibility !== "hidden";
      overlay.element.style.visibility = isVisible ? "visible" : "hidden";
    }
  }
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
  measureCanvas.style.display = checkbox.checked ? "block" : "none";
};

const measurementButton = document.getElementById("toggleMeasurementButton");
const circleButton = document.getElementById("toggleCircleButton");

let measurementModeActive = false;
function toggleMeasurementMode() {
  const isMeasuring = measurementButton.classList.contains("active");

  // Toggle the active state of the button
  measurementButton.classList.toggle("active");

  if (isMeasuring) {
    // Disable measurement mode
    measurementButton.textContent = "Start Measuring";
    measurementModeActive = false;
    console.log("Measurement mode disabled");
    resetMeasurements();
  } else {
    // Enable measurement mode
    measurementButton.textContent = "Stop Measuring";
    measurementModeActive = true;
    console.log("Measurement mode enabled");
  }
}

///////////////////////////////////////////////////
//// Functions for plotting measurement circle ////
///////////////////////////////////////////////////

let circleJSON = {
  type: "FeatureCollection",
  features: [],
};
let circleModeActive = false;
function toggleCircleMode() {
  const isMeasuring = circleButton.classList.contains("active");

  // Toggle the active state of the button
  circleButton.classList.toggle("active");

  if (isMeasuring) {
    // Disable measurement mode
    circleButton.textContent = "Draw Circle";
    circleModeActive = false;
    console.log("Circle mode disabled");
    circleJSON = {
      type: "FeatureCollection",
      features: [],
    };
    drawShape(circleCanvas, [circleJSON]);
  } else {
    // Enable measurement mode
    circleButton.textContent = "Stop";
    circleModeActive = true;
    console.log("Circle mode enabled");
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
  // For testing
  console.log(window.appState.hasUnsavedAnnotations);

  if (!circleModeActive) return; // Only draw when mode is active

  circleJSON = {
    type: "FeatureCollection",
    features: [],
  };

  const circleDiameter = parseFloat(document.getElementById("circle").value);
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
    circleDiameter * (pixelsPerMeters[currentIndex] / circleConversion) // Convert microns to meters
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
// let activeMeasurement = false;
viewer.addHandler("canvas-click", function (event) {
  const isMeasuring = measurementButton.classList.contains("active");
  if (measurementModeActive) {
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

        if (isSelfIntersecting(polygonCoords)) {
          console.log("Self-intersecting polygon detected");
        }

        const currentMeasureImageCoordinates = [
          ...measureImageCoordinates,
          [subeventImagePoint.x, subeventImagePoint.y],
        ];

        const measurePerimeterPixels = calculatePolygonExteriorPerimeter([
          currentMeasureImageCoordinates,
        ]);
        distanceInM = measurePerimeterPixels / pixelsPerMeters[currentIndex];
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
          areaInM2 = measureAreaPixels / pixelsPerMeters[currentIndex] ** 2;
          const measureArea = areaInM2 * areaConversion;
          // measureAreaPixels /
          // (pixelsPerMeters[currentIndex] / areaConversion) ** 2;
          areaElement.value = measureArea.toFixed(2);

          ECDInM =
            2 *
            Math.sqrt(
              measureAreaPixels / pixelsPerMeters[currentIndex] ** 2 / Math.PI
            );
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
      console.log("Double-click detected, ending measurement.");

      const measurePerimeterPixels = calculatePolygonExteriorPerimeter([
        measureImageCoordinates,
      ]);
      const measurePerimeter =
        (measurePerimeterPixels / pixelsPerMeters[currentIndex]) *
        distanceConversion;

      // Close the polygon by adding the first point to the end
      const finalMeasureImageCoordinatesPolygon = [
        ...measureImageCoordinates,
        [measureImageCoordinates[0][0], measureImageCoordinates[0][1]],
      ];

      const measureAreaPixels = calculatePolygonArea([
        finalMeasureImageCoordinatesPolygon,
      ]);
      areaInM2 = measureAreaPixels / pixelsPerMeters[currentIndex] ** 2;
      const measureArea = areaInM2 * areaConversion;

      ECDInM =
        2 *
        Math.sqrt(
          measureAreaPixels / pixelsPerMeters[currentIndex] ** 2 / Math.PI
        );
      const ECD = ECDInM * ECDConversion;
      ECDElement.value = ECD.toFixed(2);

      addPolylineToGeoJSON(measureJSON, measureImageCoordinates, {
        label: "measurement",
        pixelsPerMeter: Number(pixelsPerMeters[currentIndex]),
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
      console.log("Measurement mode disabled");
    } else {
      // It's a single click, so set a timeout to handle it
      measureTimeout = setTimeout(function () {
        console.log("Single click detected, continuing collection...");
      }, clickDelay);
    }

    // Update the last click timestamp
    measureLastClickTime = measureCurrentTime;
  }
});

function resetMeasurements(hardReset = false) {
  measureCoordinates = [];
  measureImageCoordinates = []; // Clear
  measureJSONTemp = {
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
  }
}

// Update measurement values upon change of units
document.getElementById("areaUnits").addEventListener("change", function () {
  console.log("Area units changed");
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
    console.log("Distance units changed");
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
  console.log("ECD units changed");
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

// This keeps track of key presses and releases, in case the keyup event listener is missed
const pressedKeys = new Set();
const keyTimestamps = {};

const KEY_TIMEOUT_MS = 500; // 0.5 seconds

window.addEventListener("keydown", (event) => {
  const code = event.code;
  pressedKeys.add(code);
  keyTimestamps[code] = Date.now();
});

window.addEventListener("keyup", (event) => {
  const code = event.code;
  pressedKeys.delete(code);
  delete keyTimestamps[code];
});

setInterval(() => {
  const now = Date.now();
  for (const code of pressedKeys) {
    if (now - keyTimestamps[code] > KEY_TIMEOUT_MS) {
      console.log(`Expiring stuck key: ${code}`);
      pressedKeys.delete(code);
      delete keyTimestamps[code];
    }
  }
}, 250); // check four times a second

document.addEventListener("mousemove", (event) => {
  if (!event.shiftKey) {
    shiftKeyHeld = false; // Reset shift key state if not held
  }
  isCPressed = pressedKeys.has("KeyC");
  isXPressed = pressedKeys.has("KeyX");
  isQPressed = pressedKeys.has("KeyQ");
  isZPressed = pressedKeys.has("KeyZ");
  if (isQPressed || isPointMode) {
    // crosshairFloater.style.display = "block";
    // document.body.style.cursor = "default"; // Hide system cursor when crosshair is active
    toggleCrosshairFloaterOn(true);
    // crosshairFloater.style.left = `${event.clientX + 5}px`;
    // crosshairFloater.style.top = `${event.clientY - 5}px`;
  } else if (isZPressed || isPolylineMode) {
    togglePolylineFloaterOn(true);
  } else if (shiftKeyHeld || isRectangleMode) {
    toggleRectFloaterOn(true);
  } else if (isXPressed || isPolygonMode) {
    togglePolygonFloaterOn(true);
  } else if (isCPressed || isEllipseMode) {
    toggleEllipseFloaterOn(true);
  } else {
    toggleCrosshairFloaterOn(false);
    togglePolylineFloaterOn(false);
    toggleRectFloaterOn(false);
    togglePolygonFloaterOn(false);
    toggleEllipseFloaterOn(false);
  }
});

viewer.addHandler("canvas-drag", function (event) {
  if (event.originalEvent.shiftKey || isRectangleMode) {
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

let shiftKeyHeld = false; // Track shift key state
window.addEventListener("keydown", function (event) {
  if (event.key === "Shift" && !shiftKeyHeld) {
    disableOtherAnnoModes("rect");
    shiftKeyHeld = true;
    toggleRectFloaterOn(true);
  }
  if (event.key === "x" || event.key === "X") {
    togglePolygonFloaterOn(true);
  }
  if (event.key === "c" || event.key === "C") {
    toggleEllipseFloaterOn(true);
  }
});

window.addEventListener("keyup", function (event) {
  if (event.key === "Shift") {
    shiftKeyHeld = false;
    toggleRectFloaterOn(false);
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
  divideImages();
  updateButtonLabels(currentIndex);
  updateImageLabels();
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

function showPrompt(message, callback) {
  const promptBox = document.getElementById("customPrompt");
  const promptInput = document.getElementById("promptInput");
  const promptMessage = document.getElementById("promptMessage");

  promptMessage.textContent = message;
  promptBox.classList.remove("modal-prompt-hidden");
  promptBox.classList.add("modal-prompt-visible");

  promptInput.value = "";
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

// Update value in real time
imageRotater.addEventListener("input", () => {
  const rotationAngle = parseInt(
    document.getElementById("imageRotation").value
  );
  viewer.viewport.setRotation(rotationAngle);
  document.getElementById("imageRotationValue").innerHTML = rotationAngle + "°";
});

// Listen for R key press → rotate +90°
document.addEventListener("keydown", (event) => {
  if (event.key === "r" || event.key === "R") {
    const currentRotation = viewer.viewport.getRotation();
    const newRotation = currentRotation % 360;
    viewer.viewport.setRotation(newRotation);

    // Sync slider + text
    imageRotater.value = newRotation;
    document.getElementById("imageRotationValue").innerHTML = newRotation + "°";
  }
});

//// Code for keeping annotation and grid labels upright when rotating ////

// Keep labels roughly upright, snapping to 45° increments
function updateAnnotationUpright() {
  const angle = viewer.viewport.getRotation();

  // Compute snapped rotation
  // Round to nearest multiple of 45 degrees
  const snappedAngle = Math.round(-angle / 22.5) * 22.5;

  annotateLabels.forEach((labelEl) => {
    labelEl.style.transform = `rotate(${snappedAngle}deg)`;
    labelEl.style.transformOrigin = "top left";
  });

  for (let labelEl of document.getElementsByClassName("grid-label")) {
    labelEl.style.transform = `rotate(${snappedAngle}deg)`;
    labelEl.style.transformOrigin = "top left";
  }
}

// Trigger only when rotation changes (avoids fighting animations)
viewer.addHandler("rotate", updateAnnotationUpright);

// Also update after animations finish
viewer.addHandler("animation-finish", updateAnnotationUpright);

// Call once at init
updateAnnotationUpright();

//// Code that controls zoom/rotation with mouse scroll ////

const ROTATION_SENSITIVITY = 1; // degrees per scroll unit
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
    const currentRotation = viewer.viewport.getRotation();
    const newRotation = currentRotation + delta * ROTATION_SENSITIVITY;
    viewer.viewport.setRotation(newRotation);

    // update slider/value if you have them
    const rotationSlider = document.getElementById("imageRotation");
    const rotationValue = document.getElementById("imageRotationValue");
    if (rotationSlider && rotationValue) {
      const positiveRotation = ((newRotation % 360) + 360) % 360;
      rotationSlider.value = positiveRotation;
      rotationValue.textContent = Math.round(positiveRotation) + "°";
    }
  } else {
    // No Ctrl → zoom normally
    e.preventDefault();
    e.stopPropagation();

    const zoom = viewer.viewport.getZoom();
    const factor = 1 - e.deltaY * ZOOM_SENSITIVITY * 0.01; // adjust sensitivity

    // const factor = Math.pow(1.2, -e.deltaY / 100); // adjust sensitivity if needed

    // Get the mouse position relative to the viewport
    const webPoint = new OpenSeadragon.Point(e.clientX, e.clientY);
    const viewportPoint = viewer.viewport.pointFromPixel(webPoint);

    viewer.viewport.zoomTo(zoom * factor, viewportPoint);
  }
});

function resetRotation() {
  const rotationSlider = document.getElementById("imageRotation");
  const rotationValue = document.getElementById("imageRotationValue");
  if (rotationSlider && rotationValue) {
    rotationSlider.value = 0;
    rotationValue.textContent = "0°";
  }
  viewer.viewport.setRotation(0, true);
}

/////////////////////////////////////////
//// Shader code for blending images ////
/////////////////////////////////////////

// Initialize WebGL once with a source image or canvas
// const glOverlay = new openSeadragonGL(viewer);

// // Provide a valid source for init
// glOverlay.viaGL.init(glOverlay.viaGL.source).then(() => {
//   // Now the WebGL buffers are ready
//   document.getElementById("blendSlider").addEventListener("input", function () {
//     const value = parseFloat(this.value) / 100;

//     // Update blend factor
//     glOverlay.viaGL.blendFactor = value;

//     // Redraw only the WebGL canvas
//     if (glOverlay.viaGL.gl) {
//       glOverlay.viaGL["gl-drawing"](glOverlay.viaGL.source);
//     }
//   });
// });

// Create WebGL overlay canvas
const canvas = document.createElement("canvas");
canvas.id = "glOverlay";
viewerContainer.appendChild(canvas);

const gl = canvas.getContext("webgl");
if (!gl) alert("WebGL not supported");

let textures = [];

// Load XPL images as HTMLImageElements
console.log("tileSets", tileSets);
const xplImages = tileSets[currentIndex][1].map((url) => {
  console.log("Loading image:", url);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  return img;
});

// Adjust canvas size on resize or viewer open
function resizeCanvas() {
  const rect = viewerContainer.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  draw(); // redraw on resize
}
window.addEventListener("resize", resizeCanvas);
viewer.addHandler("open", resizeCanvas);

// Simple vertex shader
const vertexShaderSource = `
      attribute vec2 a_pos;
      varying vec2 vTexCoord;
      void main() {
        vTexCoord = a_pos * 0.5 + 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;

// Fragment shader to blend two textures
const fragmentShaderSource = `
      precision mediump float;
      uniform sampler2D uTex0;
      uniform sampler2D uTex1;
      uniform float blendFactor;
      varying vec2 vTexCoord;
      void main() {
        vec4 c0 = texture2D(uTex0, vTexCoord);
        vec4 c1 = texture2D(uTex1, vTexCoord);
        gl_FragColor = mix(c0, c1, blendFactor);
      }
    `;

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl, vsSource, fsSource) {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

const program = createProgram(gl, vertexShaderSource, fragmentShaderSource);
gl.useProgram(program);

// Setup a fullscreen quad
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(
  gl.ARRAY_BUFFER,
  new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
  gl.STATIC_DRAW
);

const a_pos = gl.getAttribLocation(program, "a_pos");
gl.enableVertexAttribArray(a_pos);
gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 0, 0);

// Load images as textures
xplImages.forEach((img, i) => {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  textures.push(tex);

  img.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    draw();
  };
});

const uTex0 = gl.getUniformLocation(program, "uTex0");
const uTex1 = gl.getUniformLocation(program, "uTex1");
const uBlend = gl.getUniformLocation(program, "blendFactor");

function draw() {
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // Bind textures
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, textures[0]);
  gl.uniform1i(uTex0, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, textures[1]);
  gl.uniform1i(uTex1, 1);

  gl.uniform1f(
    uBlend,
    parseFloat(document.getElementById("blendSlider").value) / 100
  );

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// Slider
document.getElementById("blendSlider").addEventListener("input", draw);
