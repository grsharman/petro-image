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
const annotation_files = {}; // For loading predefined annotations
let groupMapping = {}; // To map groups to sample indices ///
let currentAnnotationId = 1; // Initialize a counter for annotation IDs. First ID is 1
let hasAnnotationInJSON = false; // for keeping track of whether the selected sample has annotations in the JSON

// Load necessary information from JSON
fetch('samples.json')
  .then(response => response.json())
  .then(data => {
    // Loop through each sample
    Object.keys(data).forEach((sampleKey, index) => { ///
    // Object.keys(data).forEach(sampleKey => {
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
        annotation_files[sample.title] = sample.annotations;// || null;

        /// Map sample indices to their groups
        if (sample.groups) {
          sample.groups.forEach(group => {
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
    groupMapping['All'] = Array.from({ length: samples.length }, (_, i) => i);

    // Example: initialize OpenSeadragon with the first tile source
    loadTileSet(0);
    updateButtonLabels(0);
    // updateCheckboxVisibility(tileSets[0].length);
    addScalebar(pixelsPerMeters[0]);
    populateGroupDropdown();

    const sampleParam = getQueryParameter('sample');
    if (sampleParam) {
      const sampleIndex = samples.indexOf(sampleParam);
      if (sampleIndex !== -1) {
        // Select the correct group and sample
        const groupForSample = Object.keys(groupMapping).find(group =>
          groupMapping[group].includes(sampleIndex)
        );
        document.getElementById('groupDropdown').value = groupForSample || 'All';
        populateSampleDropdown(groupForSample || 'All');
        document.getElementById('sampleDropdown').value = sampleIndex;
        document.getElementById('sampleDropdown').dispatchEvent(new Event('change'));
      } else {
        console.warn(`Sample "${sampleParam}" not found in JSON.`);
      }
    } else {
      // Default behavior if no sample is specified
      const firstGroup = Object.keys(groupMapping)[0];
      if (firstGroup) {
        document.getElementById('groupDropdown').value = firstGroup;
        populateSampleDropdown(firstGroup);
      }
    }
  })
  .catch(error => {
    console.error('Error loading the JSON file:', error);
  });
  
// Parse URL for query parameters
function getQueryParameter(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

///
function populateGroupDropdown() {
  const groupDropdown = document.getElementById('groupDropdown');
  groupDropdown.innerHTML = ''; // Clear existing
  const uniqueGroups = Object.keys(groupMapping);

  uniqueGroups.forEach(group => {
    const option = document.createElement('option');
    option.value = group;
    option.textContent = group;
    groupDropdown.appendChild(option);
  });

  // Add event listener to update the sample dropdown on group change
  groupDropdown.addEventListener('change', function() {
    const selectedGroup = this.value;
    populateSampleDropdown(selectedGroup);
  });
}

// Function to populate sample dropdown based on the selected group
function populateSampleDropdown(selectedGroup) {
  const sampleDropdown = document.getElementById('sampleDropdown');
  sampleDropdown.innerHTML = ''; // Clear existing options

  if (groupMapping[selectedGroup]) {
    groupMapping[selectedGroup].forEach(index => {
      const option = document.createElement('option');
      option.value = index; // Store index as value
      option.textContent = samples[index]; // Sample title
      sampleDropdown.appendChild(option);
    });
    // Automatically select the first sample in the group
    if (sampleDropdown.options.length > 0) {
      sampleDropdown.currentIndex = 0; // Select the first option
      // sampleDropdown.selectedIndex = 0; // Select the first option
      sampleDropdown.dispatchEvent(new Event('change')); // Trigger the change event
    }
  }
}

let sampleName = '';

// Initialize the OpenSeadragon viewer
const viewer = OpenSeadragon({
  maxZoomPixelRatio: 100,
  id: "viewer-container",
  prefixUrl: "js/images/",
  zoomPerClick: 1, // Disable zoom on click (or shift+click)
  sequenceMode: false,
  tileSources: tileSets[0], // Load first tile set upon load
});

/// Event listener for sample selection change (only add once)
document.getElementById('sampleDropdown').addEventListener('change', function() {
  currentIndex = Number(this.value);
  sampleName = samples[currentIndex];
  //sampleName = this.options[currentIndex].textContent; // Get the sample name as a string
  loadTileSet(currentIndex);
  clearAnnotations();
  annotations = [];
  updateButtonLabels(currentIndex);
  // updateCheckboxVisibility(tileSets[currentIndex].length);
  addScalebar(pixelsPerMeters[currentIndex]);
  clearGridOverlayPoints();
  clearGridOverlayCrosshairs();
  enableGridButtons();
  removeAoiRectangle();
  updateOpacityImageSliderVisibility();
  updateImageLabels();
  resetMeasurements();
  document.getElementById('enableDivideImages').checked = true;

  const annoJSONButtonContainer = document.getElementById('loadAnnoFromJSON');

  // Remove any existing button
  const existingButton = document.getElementById('loadAnnoFromJSONButton');
  if (existingButton) {
    existingButton.remove();
  }

  // Check if the selected sample has annotations
  let file = annotation_files[sampleName];
  if (file) {
    hasAnnotationInJSON = true;
    console.log('anno JSON detected, creating button');
    const button = document.createElement('button');
    button.textContent = 'Load from JSON';
    button.id = 'loadAnnoFromJSONButton';
    button.style.display = 'block'; // Make sure the button is visible
    button.onclick = () => loadAnnotationsFromJSON(file);
    annoJSONButtonContainer.appendChild(button);
  } else {
    hasAnnotationInJSON = false;
    console.log('No annotations detected for the selected sample.');
  }
});

// Function to update the button labels based on tileLabels array
function updateButtonLabels(index) {
  const numButtons = tileSets[index].length;
  for (let i = 1; i <= 4; i++) {
    const checkbox = document.getElementById(`image${i}`);
    const label  = document.getElementById(`label${i}`);
    if (i <= numButtons) {
      checkbox.style.display = 'inline';
      label.style.display = 'inline';
      label.textContent = tileLabels[index][i-1];
      checkbox.checked = true;
    } else {
      checkbox.style.display = "none";
      label.style.display = "none";
      label.textContent = '';
    }
  }
}

// Function to update the label dynamically
function updateImageLabels() {
  for (let i = 0; i < tileLabels[currentIndex].length; i++) {
    const labelElement = document.getElementById(`labelForOpacityImage${i+1}`);
    labelElement.textContent = tileLabels[currentIndex][i]; // Update the label text
  }
}

// // Function to update the button labels based on tileLabels array
// function updateButtonLabels(index) {
//   //("tileLabels for index", index, ":", tileLabels[index]);
//   document.querySelector("label[for='image1']").textContent = tileLabels[index][0] || "XPL1";
//   document.querySelector("label[for='image2']").textContent= tileLabels[index][1] || "XPL2";
//   document.querySelector("label[for='image3']").textContent = tileLabels[index][2] || "PPL";
//   // Default is to be checked upon image change
//   document.getElementById("image1").checked = true;
//   document.getElementById("image2").checked = true;
//   document.getElementById("image3").checked = true;
// }

// Function to update visibility of checkboxes
// function updateCheckboxVisibility(arrayLength) {
//   // Iterate over the checkboxes
//   for (let i = 2; i <= 4; i++) { // Start from checkbox 2
//       const checkbox = document.getElementById(`image${i}`);
//       if (checkbox) {
//           // Show checkboxes based on array length
//           if (i <= arrayLength + 1) { // +1 because checkbox1 is always shown
//               checkbox.style.display = "inline"; // Show
//           } else {
//               checkbox.style.display = "none"; // Hide
//           }
//       }
//   }
// }

const tooltip = document.getElementById("tooltip-desc");
const infoButton = document.getElementById("info-button-desc");
//const sampleDropdown = document.getElementById('sampleDropdown');

//(descriptions[currentIndex]);

// Show tooltip with sample info on hover
function showTooltip() {
  const dropdown = document.getElementById("sampleDropdown");

  if (descriptions[dropdown.value]) {
      tooltip.textContent = `${descriptions[dropdown.value]}`;
      tooltip.style.display = 'block';

      const buttonRect = infoButton.getBoundingClientRect();

      // TODO: button placement is somewhat ad hoc

      // Wait for the tooltip to be displayed before calculating its height
      const tooltipHeight = tooltip.offsetHeight;

      // Align tooltip vertically centered with the button
      tooltip.style.top = `${buttonRect.top - (buttonRect.height / 1.25) - (tooltipHeight)}px`;

      // Position tooltip directly to the right of the button
      tooltip.style.left = `${buttonRect.right + 2}px`;  // Align to the right, accounting for scrolling
  }
}

// Hide tooltip when not hovering
function hideTooltip() {
  tooltip.style.display = 'none';
}

// Event listeners for tooltip
infoButton.addEventListener("mouseenter", showTooltip);
infoButton.addEventListener("mouseleave", hideTooltip);

// A message to discourage loss of data upon reload
let hasUnsavedAnnotations = false;
let hasUnsavedCounts = false;

window.addEventListener("beforeunload", (event) => {
  // Check if there's unsaved data or any other condition for triggering the warning
  if (hasUnsavedAnnotations || hasUnsavedCounts) {
      // Set the returnValue property of the event to a string to trigger the dialog
      event.preventDefault();
      // Some browsers might ignore this message and show their own default message
      event.returnValue = "";
  }
});

//////////////
// Scalebar //
//////////////

// Initialize the scalebar, except for pixelsPerMeter, which depends on the grid
// settings.
function addScalebar(pixelsPerMeter) {
  viewer.scalebar({
    type: OpenSeadragon.ScalebarType.MAP,
    minWidth: "75px",
    location: OpenSeadragon.ScalebarLocation.BOTTOM_LEFT,
    xOffset: 10,
    yOffset: 10,
    stayInsideImage: true,
    color: "black",
    fontColor: "black",
    backgroundColor: "rgba(255, 255, 255, 0.5)",
    fontSize: "small",
    barThickness: 2,
    pixelsPerMeter: pixelsPerMeter,
  });
}

// Function to load a set of images based on the current index
function loadTileSet(index) {
  viewer.world.removeAll(); // Remove previous images
  // Add each tile source from the current tile set
  tileSets[index].forEach(tileSource => {
    viewer.addTiledImage({
      tileSource: tileSource,
      success: function() {
      }
    });
  });
}

function setTileSetOpacity() {
  for (let i = 0; i < viewer.world.getItemCount(); ++i) {
    const opacityValue = Number(document.getElementById(`opacityImage${i+1}`).value)/100; // Convert percent
    if (document.getElementById(`image${i+1}`).checked) {
      const tiledImage = viewer.world.getItemAt(i);
      if (tiledImage) {
        tiledImage.setOpacity(opacityValue);
        //tiledImage.setOpacity(opacityValues[i]);
      }
    }
  }
}

const viewerContainer = document.getElementById("viewer-container");

// Share the mouse position between event handlers.
let mousePos = new OpenSeadragon.Point(0, 0);

// Divides the images at the current mouse position, clipping overlaid images to
// expose the images underneath. Note that all images are expected to have the
// same position and size.
const divideImages = () => {
  // Bail out if there are no images.
  if (viewer.world.getItemCount() == 0) {
    return;
  }
  // Bail out if enableDivideImages is false
  if (!enableDivideImages) {
    for (let i = 0; i < viewer.world.getItemCount(); ++i) {
      const image = viewer.world.getItemAt(i);
      image.setClip(null); // Clear the clip
    }
    return; // Exit the function
  }

  // Get the clip point and clamp it to within the image bounds.
  const image = viewer.world.getItemAt(0);
  const clipPos = image.viewerElementToImageCoordinates(mousePos);
  const size = image.getContentSize();
  clipPos.x = Math.max(0, Math.min(clipPos.x, size.x));
  clipPos.y = Math.max(0, Math.min(clipPos.y, size.y));

  // Set the clip for each image.
  let previousVisibleImages = 0;
  for (let i = 0; i < viewer.world.getItemCount(); ++i) {
    const image = viewer.world.getItemAt(i);
    if (!image.getOpacity()) {
      continue;
    }
    // Determine the quadrants to be clipped by how many visible images are
    // underneath this one.
    const xClip = previousVisibleImages & 1 ? clipPos.x : 0;
    const yClip = previousVisibleImages & 2 ? clipPos.y : 0;
    image.setClip(new OpenSeadragon.Rect(xClip, yClip, size.x, size.y));
    ++previousVisibleImages;
  }
  // TODO: testing
  setTileSetOpacity();
};


const toggleImage = (checkbox, idx) => {
  viewer.world.getItemAt(idx).setOpacity(checkbox.checked ? 1 : 0);
  if (enableDivideImages) {
    divideImages();
  }
};

const toggleGrid = (event) => {
  for (let el of document.getElementsByClassName("grid")) {
    el.style.visibility = event.checked ? "visible" : "hidden";
  }
};

viewer.addHandler("animation", divideImages);

// Update grid slider values as slider moves
const slider_1 = document.getElementById("grid-left");
const sliderValue_1 = document.getElementById("grid-left-value");
slider_1.oninput = function() {
  sliderValue_1.textContent = this.value;
};
const slider_2 = document.getElementById("grid-right");
const sliderValue_2 = document.getElementById("grid-right-value");
slider_2.oninput = function() {
  sliderValue_2.textContent = this.value;
};
const slider_3 = document.getElementById("grid-top");
const sliderValue_3 = document.getElementById("grid-top-value");
slider_3.oninput = function() {
  sliderValue_3.textContent = this.value;
};
const slider_4 = document.getElementById("grid-bottom");
const sliderValue_4 = document.getElementById("grid-bottom-value");
slider_4.oninput = function() {
  sliderValue_4.textContent = this.value;
};
const image1slider = document.getElementById("opacityImage1");
const image1sliderValue = document.getElementById("opacityImage1Value");
image1slider.oninput = function() {
  image1sliderValue.textContent = `${this.value}%`;
};
const image2slider = document.getElementById("opacityImage2");
const image2sliderValue = document.getElementById("opacityImage2Value");
image2slider.oninput = function() {
  image2sliderValue.textContent = `${this.value}%`;
};
const image3slider = document.getElementById("opacityImage3");
const image3sliderValue = document.getElementById("opacityImage3Value");
image3slider.oninput = function() {
  image3sliderValue.textContent = `${this.value}%`;
};
const image4slider = document.getElementById("opacityImage4");
const image4sliderValue = document.getElementById("opacityImage4Value");
image4slider.oninput = function() {
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
          console.log('slider input event listener');
          const opacity = sliderInput.value / 100;
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


// TODO: Code below looks redundant with code above
// Constrain values of sliders
const slider1 = document.getElementById('grid-left');
const slider2 = document.getElementById('grid-right');
const slider3 = document.getElementById('grid-top');
const slider4 = document.getElementById('grid-bottom');
const value1 = document.getElementById('grid-left-value');
const value2 = document.getElementById('grid-right-value');
const value3 = document.getElementById('grid-top-value');
const value4 = document.getElementById('grid-bottom-value');

// Update the value display for slider1
slider1.addEventListener('input', function () {
    if (parseInt(slider1.value) > parseInt(slider2.value)) {
        slider1.value = slider2.value;
    }
    value1.textContent = slider1.value;
});
// Update the value display for slider2 and ensure slider1 stays within bounds
slider2.addEventListener('input', function () {
    if (parseInt(slider1.value) > parseInt(slider2.value)) {
        slider1.value = slider2.value;
        value1.textContent = slider1.value; // Update display for slider1
    }
    value2.textContent = slider2.value;
});
// Update the value display for slider3
slider3.addEventListener('input', function () {
  if (parseInt(slider3.value) > parseInt(slider4.value)) {
      slider3.value = slider4.value;
  }
  value3.textContent = slider3.value;
});

// Update the value display for slider2 and ensure slider1 stays within bounds
slider4.addEventListener('input', function () {
  if (parseInt(slider3.value) > parseInt(slider4.value)) {
      slider3.value = slider4.value;
      value3.textContent = slider4.value; // Update display for slider1
  }
  value4.textContent = slider4.value;
});

///////////////////////////////////
//// Annotations functionality ////
///////////////////////////////////

let annoDict = {}; // Dictionary for ID number (1+) with unique alphanumeric ID

let pointButton = document.getElementById("crosshairButton");
let rectButton = document.getElementById("rectangleButton");
let repeatButton = document.getElementById("repeatButton");
// let polyButton = document.getElementById("polygonButton"); // TODO: Future implementation

// Flags to track modes
let isPointMode = false;
let isRectangleMode = false;
let isRepeatMode = false;
// let isPolygonMode = false;

pointButton.addEventListener("click", () => {
  // Deactivate rect and poly buttons
  rectButton.classList.remove('active');
  // polyButton.classList.remove('active');

  if (isPointMode === false) {
    console.log('point mode activated');
    pointButton.classList.add('active');
    isPointMode = true;
    console.log('point mode activiated');
  }
  else {
    console.log('point mode deactivated');
    pointButton.classList.remove('active');
    isPointMode = false;
    console.log('point mode deactiviated');
  }
});

rectButton.addEventListener("click", () => {
  // Deactivate point and poly buttons
  pointButton.classList.remove('active');
  // polyButton.classList.remove('active');

  if (isRectangleMode === false) {
    console.log('rect mode activated');
    rectButton.classList.add('active');
    isRectangleMode = true;
  }
  else {
    console.log('rect mode deactivated');
    rectButton.classList.remove('active');
    isRectangleMode = false;
  }
});

repeatButton.addEventListener("click", () => {
  if (isRepeatMode === false) {
    console.log('repeat mode activated');
    repeatButton.classList.add('active');
    isRepeatMode = true;
  }
  else {
    console.log('repeat mode deactivated');
    repeatButton.classList.remove('active');
    isRepeatMode = false;
  }
});

// TODO: In case I ever add a polygon feature
// polyButton.addEventListener("click", () => {
//   console.log('poly button clicked');
//   // Deactivate point and rect buttons
//   pointButton.classList.remove('active');
//   rectButton.classList.remove('active');

//   if (isPolygonMode === false) {
//     console.log('poly mode activated');
//     polyButton.classList.add('active');
//     isPolygonMode = true;
//   }
//   else {
//     console.log('poly mode deactivated');
//     polyButton.classList.remove('active');
//     isPolygonMode = false;
//   }
// });

// Show or hide the image menu when the gear button is clicked
document.getElementById("imageSettingsButton").addEventListener("click", function (event) {
  console.log('image settings button clicked');
  event.stopPropagation(); // Prevent click from reaching the window listener
  const menu = document.getElementById("imageSettingsMenu");
  if (menu.style.display === "none" || menu.style.display === "") {
    menu.style.display = "block";
  } else {
    menu.style.display = "none";
  }
});

// Optional: Close the menu if clicked outside
window.addEventListener("click", function (event) {
  const menu = document.getElementById("imageSettingsMenu");
  if (!event.target.closest("#imageSettingsButton") && !event.target.closest("#imageSettingsMenu")) {
    menu.style.display = "none";
  }
});

// Show or hide the settings menu when the gear button is clicked
document.getElementById("gearButton").addEventListener("click", function (event) {
  event.stopPropagation(); // Prevent click from reaching the window listener
  const menu = document.getElementById("annoSettingsMenu");
  if (menu.style.display === "none" || menu.style.display === "") {
    menu.style.display = "block";
  } else {
    menu.style.display = "none";
  }
});

// Optional: Close the menu if clicked outside
window.addEventListener("click", function (event) {
  const menu = document.getElementById("annoSettingsMenu");
  if (!event.target.closest("#gearButton") && !event.target.closest("#annoSettingsMenu")) {
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
};

const disableAnnoButtons = () => {
  document.getElementById("anno-first-button").disabled = true;
  document.getElementById("anno-prev-button").disabled = true;
  document.getElementById("anno-id").disabled = true;
  document.getElementById("anno-next-button").disabled = true;
  document.getElementById("anno-last-button").disabled = true;
  document.getElementById("anno-label").disabled = true;
};

document.getElementById('anno-first-button').addEventListener('click', function() {
  const annoIdBox = document.getElementById('anno-id');
  const annoIds = Object.keys(annoDict).map(Number);
  const firstId = annoIds[0];
  annoIdBox.value = firstId;
  goToAnnoPoint(annoJSON[firstId].properties.xLabel,
    annoJSON[firstId].properties.yLabel);
  annoLabelToText();
});

document.getElementById('anno-last-button').addEventListener('click', function() {
  const annoIdBox = document.getElementById('anno-id');
  const annoIds = Object.keys(annoDict).map(Number);
  const lastId = annoIds[annoIds.length-1];
  annoIdBox.value = lastId;
  goToAnnoPoint(annoJSON[lastId].properties.xLabel,
    annoJSON[lastId].properties.yLabel);
  annoLabelToText();
});

// When the previous annotation button is clicked
document.getElementById('anno-prev-button').addEventListener('click', function() {
  // Current annotation id
  const annoIdBox = document.getElementById('anno-id');
  const currentId = parseInt(annoIdBox.value);
  // List of all the annotation ids
  const annoIds = Object.keys(annoDict).map(Number);
  // Index of current annotation id
  const currentIdx = annoIds.indexOf(currentId); // Index of current annotation

  if (currentIdx > 0) {
    const nextIdx = currentIdx-1;
    const nextId = annoIds[nextIdx];
    annoIdBox.value = nextId;
    goToAnnoPoint(annoJSON[nextId].properties.xLabel,
      annoJSON[nextId].properties.yLabel);
    annoLabelToText();
  }
});

// When the next annotation button is clicked
document.getElementById('anno-next-button').addEventListener('click', function() {
  // Current annotation id
  const annoIdBox = document.getElementById('anno-id');
  const currentId = parseInt(annoIdBox.value);
  // List of all the annotation ids
  const annoIds = Object.keys(annoDict).map(Number);
  // Index of current annotation id
  const currentIdx = annoIds.indexOf(currentId); // Index of current annotation

  if (currentIdx+1 < Object.keys(annoDict).length) {
    const nextIdx = currentIdx+1;
    const nextId = annoIds[nextIdx];
    annoIdBox.value = nextId;
    goToAnnoPoint(annoJSON[nextId].properties.xLabel,
      annoJSON[nextId].properties.yLabel);
    annoLabelToText();
  }
});

// When the delete annotation button is clicked
document.getElementById('deleteButton').addEventListener('click', function() {
  const id = parseInt(document.getElementById('anno-id').value);
  deleteText(id);
  deleteCrosshairs(id);
  deleteRectangle(id);
  deleteFromGeoJSON(id);
  deleteFromAnnoDict(id);
  selectNextAnno(id);
});

// TODO: Idea: allow a default text field (e.g., useful if picking many of the same thing)
// TODO: Currently cannot apply text field separately from shapes. Might consider doing this so all
// labels could be changed without affecting the underlying color of the shapes
function applyCurrentAnno(id, changeLabel = false) {
  const annoLabel = document.getElementById("anno-label").value;
  const labelFontSize = Number(document.getElementById("annoLabelFontSize").value);
  const labelFontColor = document.getElementById("annoLabelFontColor").value;
  console.log('labelFontColor',labelFontColor);
  const labelBackgroundColor = document.getElementById("annoLabelBackgroundColor").value;
  const labelBackgroundOpacity = Number(document.getElementById("annoLabelBackgroundOpacity").value);
  const pointLw = document.getElementById("pointLw").value;
  const pointColor = document.getElementById("pointColor").value;
  const pointOpacity = document.getElementById("pointOpacity").value;
  const borderLw = Number(document.getElementById("rectBorderLw").value);
  const borderColor = document.getElementById("rectBorderColor").value;
  const borderStyle = document.getElementById("rectBorderStyle").value;
  const borderOpacity = Number(document.getElementById("rectBorderOpacity").value);
  const fillColor = document.getElementById("rectFillColor").value;
  const fillOpacity = Number(document.getElementById("rectFillOpacity").value);
  const type = annoJSON[id].geometry.type;
  console.log('type',type);
  if (type === 'Point') {
    if (changeLabel) {
      annoJSON[id].properties.labelFontSize = labelFontSize;
      annoJSON[id].properties.labelFontColor = labelFontColor;
      annoJSON[id].properties.labelBackgroundColor = labelBackgroundColor;
      annoJSON[id].properties.labelBackgroundOpacity = labelBackgroundOpacity;
      updateText(id, undefined, labelFontColor, labelFontSize, labelBackgroundColor, labelBackgroundOpacity);
    } else {
      annoJSON[id].properties.pointLw = pointLw;
      annoJSON[id].properties.pointColor = pointColor;
      annoJSON[id].properties.pointOpacity = pointOpacity;
      updateCrosshair(id, pointColor, pointLw, pointOpacity);
    }
  } else if (type === 'Polygon') {
    if (changeLabel) {
      annoJSON[id].properties.labelFontSize = labelFontSize;
      annoJSON[id].properties.labelFontColor = labelFontColor;
      annoJSON[id].properties.labelBackgroundColor = labelBackgroundColor;
      annoJSON[id].properties.labelBackgroundOpacity = labelBackgroundOpacity;
      updateText(id, undefined, String(labelFontColor), labelFontSize, labelBackgroundColor, labelBackgroundOpacity);
    } else {
      annoJSON[id].properties.borderStyle = borderStyle;
      annoJSON[id].properties.borderLw = borderLw;
      annoJSON[id].properties.borderColor = borderColor;
      annoJSON[id].properties.borderOpacity = borderOpacity;
      annoJSON[id].properties.fillColor = fillColor;
      annoJSON[id].properties.fillOpacity = fillOpacity;
      updateRectangle(id, borderStyle, borderLw, borderColor,
        borderOpacity, fillColor, fillOpacity);
    }
  }
}

document.getElementById('applyCurrentAnnoLabel').addEventListener('click', function () {
  const id = parseInt(document.getElementById("anno-id").value);
  applyCurrentAnno(id, true);
});

document.getElementById('applyAllAnnoLabel').addEventListener('click', function () {
  const annoIds = Object.keys(annoDict).map(Number);
  for (let i = 0; i < annoIds.length; i++) {
    applyCurrentAnno(annoIds[i], true);
  }  
});

document.getElementById('applyCurrentAnno').addEventListener('click', function () {
  const id = parseInt(document.getElementById("anno-id").value);
  applyCurrentAnno(id, false);
});

document.getElementById('applyAllAnno').addEventListener('click', function () {
  const annoIds = Object.keys(annoDict).map(Number);
  for (let i = 0; i < annoIds.length; i++) {
    applyCurrentAnno(annoIds[i], false);
  }  
});

function selectNextAnno(id) {
  console.log('selecting next id');
  const annoIdBox = document.getElementById('anno-id');
  const annoLabelBox = document.getElementById('anno-label');
  const annoIds = Object.keys(annoDict).map(Number);

  // Case where there are no annotations left
  if (annoIds.length === 0) {
    annoLabelBox.value = '';
    annoIdBox.value = currentAnnotationId;
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
  // TODO: Update use of currentIndex to a variable that is not already used
  const nextIdx = annoIds.reduce((closestIndex, currentValue, currentIndex) => {
    if (currentValue <= id) {
      const closestValue = annoIds[closestIndex];
      if (closestValue === undefined || id - currentValue < id - closestValue) {
        return currentIndex;
      }
    }
    return closestIndex;
  }, -1);
  const nextId = annoIds[nextIdx];
  console.log('nextIdx,nextId',nextIdx,nextId);
  annoIdBox.value = nextId;
  annoLabelToText();
  }
}

// Function to update the textbox with the JSON label
function annoLabelToText() {
  const idInput = parseInt(document.getElementById('anno-id').value);
  // Find the annotation by id
  let label = '';
  if (annoJSON[idInput]) {
    // Access the label within the properties of the GeoJSON object
    label = annoJSON[idInput].properties.label;
  } else {
    console.log('Annotation with this ID not found.');
  }
  const annoLabel = document.getElementById("anno-label");
  annoLabel.value = `${label}`;
}

// Function to update the JSON based on the anno-id text box
function annoTextToLabel() {
  const idInput = parseInt(document.getElementById('anno-id').value);
  const annoLabel = document.getElementById("anno-label");
  // Check if the ID exists in the annoJSON dictionary
  if (annoJSON[idInput]) {
    // Update the label within the properties of the GeoJSON object
    annoJSON[idInput].properties.label = annoLabel.value;
    console.log(`Updated label for ID ${idInput}:`, annoJSON[idInput].properties.label);
  } else {
    console.log("Annotation with this ID not found.");
  }
}

// When Enter is pressed in the anno-label text box
document.addEventListener('keydown', function(event) {
  // Check for Enter key in anno-label field
  const idInput = parseInt(document.getElementById('anno-id').value);
  const textInput = document.getElementById('anno-label');
  if (event.code === 'Enter' && document.activeElement === textInput) {
    event.preventDefault(); // Prevent any default action for Enter key
    annoTextToLabel();
    updateText(idInput, textInput.value);
  }
});

// When Enter is pressed in the anno-id input box
document.addEventListener('keydown', function(event) {
  if (event.code === 'Enter' && document.activeElement === document.getElementById('anno-id')) {
    const idInput = document.getElementById('anno-id');
    event.preventDefault(); // Prevent any default action for Enter key
    annoLabelToText();

    goToAnnoPoint(annoJSON[parseInt(idInput.value)].properties.xLabel,
      annoJSON[parseInt(idInput.value)].properties.yLabel);

    // Provide visual feedback by changing the border color
    idInput.style.borderColor = 'green';
    idInput.style.outline = 'none'; // Removes the default focus outline

    setTimeout(() => {
      idInput.style.borderColor = ''; // Revert to original after 1 second
    }, 1000);
  }
});

// TODO: Redundancy with goToGridPoint() function. Could make a more generic function
// that goes to specified x-y coordinates
function goToAnnoPoint(x, y) {
  // Center the viewport on the specified coordinates without changing the zoom level
  viewer.viewport.panTo(
    new OpenSeadragon.Point(x, y),
    true // Animate the panning
  );
}

// Function to add a point to the annoJSON
function addPointToGeoJSON(id, x, y, metadata) {
  // Create a GeoJSON point feature
  // id = currentAnnotationId
  // x, y = coordinates in image (pixel) coordinates
  // metadata = dictionary with feature labels and values, e.g., { uuid: 'abc', label: 'Hello World'}
  const pointFeature = {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [x, y]  // [x, y] format for coordinates
    },
    properties: metadata  // metadata like label, description, etc.
  };

  // Add the point feature to the annoJSON under the provided id
  annoJSON[id] = pointFeature;
}

// Function to add a rectangle to the annoJSON
function addRectToGeoJSON(id, x, y, w, h, metadata) {
  // Create a GeoJSON point feature
  // id = currentAnnotationId
  // x, y = coordinates in image (pixel) coordinates
  // w, h = width, and heigh tin image (pixel) coordinates
  // metadata = dictionary with feature labels and values, e.g., { uuid: 'abc', label: 'Hello World'}
  
  // Calculate the four corners of the rectangle
  const coordinates = [
    [x, y], // Top-left corner
    [x + w, y], // Top-right corner
    [x + w, y + h], // Bottom-right corner
    [x, y + h], // Bottom-left corner
    [x, y] // Close the loop to the top-left corner
  ];
  
  const rectangleFeature = {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [coordinates]  // [x, y] format for coordinates
    },
    properties: metadata  // metadata like label, description, etc.
  };

  // Add the point feature to the annoJSON under the provided id
  annoJSON[id] = rectangleFeature;
}

// Function to delete an entry in the JSON
function deleteFromGeoJSON(id) {
  if (annoJSON[id]) {
    delete annoJSON[id];
    console.log(`Entry with ID ${id} deleted.`);
  } else {
    console.warn(`Entry with ID ${id} not found.`);
  }
}

function deleteFromAnnoDict(id) {
  if (annoDict[id]) {
    delete annoDict[id];
    console.log(`annoDict with ID ${id} deleted.`);
  } else {
    console.warn(`annoDict with ID ${id} not found.`);
  }  
}

// TODO: Use for testing
// // Get the button element
// const unsavedChangesButton = document.getElementById("unsavedChanges");

// // Function to update the button color and text based on the value of hasUnsavedAnnotations
// function updateButtonColor() {
//   if (hasUnsavedAnnotations) {
//     unsavedChangesButton.style.backgroundColor = "red"; // Color when true
//     unsavedChangesButton.textContent = "Unsaved Annotations";
//   } else {
//     unsavedChangesButton.style.backgroundColor = "green"; // Color when false
//     unsavedChangesButton.textContent = "No Unsaved Annotations";
//   }
// }

// Generate unique ID
function generateUniqueId(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';

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
    divideImages();
  } else {
    enableDivideImages = false;
    divideImages();
  }
}

// Import, add, and export points with labels
const toggleAnnotation = (event) => {
  for (let el of document.getElementsByClassName("annotate-symbol")) {
    el.style.visibility = event.checked ? "visible" : "hidden";
  }
  if (document.getElementById('show-annotation-labels').checked) {
    for (let el of document.getElementsByClassName("annotate-label")) {
      el.style.visibility = event.checked ? "visible" : "hidden";
    }
    for (let el of document.getElementsByClassName("rectangle-label")) {
      el.style.visibility = event.checked ? "visible" : "hidden";
    }
  }
  for (let el of document.getElementsByClassName("annotate-rectangle")) {
    el.style.visibility = event.checked ? "visible" : "hidden";
  }
};

// Import, add, and export points with labels
const toggleAnnotationLabels = (event) => {
  if (document.getElementById('show-annotations').checked) {
    for (let el of document.getElementsByClassName("annotate-label")) {
      el.style.visibility = event.checked ? "visible" : "hidden";
    }
    for (let el of document.getElementsByClassName("rectangle-label")) {
      el.style.visibility = event.checked ? "visible" : "hidden";
    }
  }
};

// Functions for detecting when q is pressed and released
let isQPressed = false;
document.addEventListener('keydown', function(event) {
  if (event.key === 'q' || event.key === 'Q') {
    console.log('Q pressed')
    isQPressed = true;
  }
});
document.addEventListener('keyup', function(event) {
  if (event.key === 'q' || event.key === 'Q') {
    console.log('Q released');
    isQPressed = false;
  }
});

// Function for making points
let annotations = [];
let annotateLabels = [];
let annotatePoints = [];
let annotateRectangles = [];
// let currentAnnotationId = 0; // Initialize a counter for annotation IDs

// Testing GeoJSON approach
let annoJSON = {};

viewer.addHandler('canvas-click', function(event) {
  console.log('canvas clicked');
  let originalEvent = event.originalEvent;
  if (isQPressed || isPointMode) {
    console.log('canvs & Q clicked');
    const image = viewer.world.getItemAt(0);
    const imageSize = image.getContentSize();
    let viewportPoint = viewer.viewport.pointFromPixel(event.position);  // Get viewport coordinates
    let imagePoint = image.viewportToImageCoordinates(viewportPoint.x, viewportPoint.y); // Get image coordinates    
    //let imagePoint = viewer.viewport.viewportToImageCoordinates(viewportPoint.x, viewportPoint.y); // Get image coordinates
    const uniqueID = generateUniqueId(8);
    const labelFontSize = Number(document.getElementById("annoLabelFontSize").value);
    const labelFontColor = document.getElementById("annoLabelFontColor").value;
    const labelBackgroundColor = document.getElementById("annoLabelBackgroundColor").value;
    const labelBackgroundOpacity = Number(document.getElementById("annoLabelBackgroundOpacity").value);
    const pointLw = Number(document.getElementById("pointLw").value);
    const pointColor = document.getElementById("pointColor").value;
    const pointOpacity = Number(document.getElementById("pointOpacity").value);

    if (isRepeatMode) {
      const annoId = parseInt(document.getElementById('anno-id').value);
      var constPointLabel = annoJSON[annoId].properties.label;
    } else {
      var constPointLabel = prompt("Enter a label for this point:");
    }
    let annotation = {
        id: currentAnnotationId,
        uuid: uniqueID,
        x: viewportPoint.x,
        y: viewportPoint.y,
        x_px: imagePoint.x,
        y_px: imagePoint.y,
        w: 0,
        h: 0,
        type: 0, // 0 for point
        label: constPointLabel,
        //label: prompt("Enter a label for this point:"),  // Prompt for a label
    }
    const sampleIdx = samples.indexOf(sampleName);
    addPointToGeoJSON(currentAnnotationId,
      imagePoint.x,
      imagePoint.y,
      { uuid: uniqueID,
        label: annotation.label,
        xLabel: viewportPoint.x,
        yLabel: viewportPoint.y,
        imageTitle: sampleName,
        pixelsPerMeter: pixelsPerMeters[sampleIdx],
        imageWidth: imageSize.x,
        imageHeight: imageSize.y,
        labelFontSize: labelFontSize,
        labelFontColor: labelFontColor,
        labelBackgroundColor: labelBackgroundColor,
        labelBackgroundOpacity: labelBackgroundOpacity,
        pointLw: pointLw,
        pointColor: pointColor,
        pointOpacity: pointOpacity,
      }
    )
    console.log(annoJSON);
    // Make text and crosshairs
    annoDict[currentAnnotationId] = uniqueID;
    addText(currentAnnotationId, annotation.label, viewportPoint, labelFontColor,
      labelFontSize, labelBackgroundColor, labelBackgroundOpacity
    );

    addCrosshairs(currentAnnotationId, viewportPoint, pointColor, pointLw, pointOpacity);
    // Store annotation
    annotations.push(annotation);
    isQPressed = false; // Reset
    currentAnnotationId = currentAnnotationId+1;
    enableAnnoButtons();
    hasUnsavedAnnotations = true;
    // updateButtonColor(); // Use for testing
  }
});



// Event listener to add square annotations for shift + drag
let startPoint = null;
let overlayElement = null;
viewer.addHandler('canvas-drag', function(event) {
  console.log('rectangleMode',isRectangleMode);
  if (event.originalEvent.shiftKey || isRectangleMode) {
      console.log('drawing rectangle');
      event.preventDefaultAction = true; // Prevent default behavior (like panning)

      const viewportPoint = viewer.viewport.pointFromPixel(event.position);
      const borderLw = Number(document.getElementById("rectBorderLw").value);
      const borderColor = document.getElementById("rectBorderColor").value;
      const borderStyle = document.getElementById("rectBorderStyle").value;
      const borderOpacity = Number(document.getElementById("rectBorderOpacity").value);
      const fillColor = document.getElementById("rectFillColor").value;
      const fillOpacity = Number(document.getElementById("rectFillOpacity").value);
      console.log('borderLw,borderColor,borderStyle,borderOpacity,fillColor',borderLw,borderColor,borderStyle,borderOpacity,fillColor);

      const borderColorToPlot = applyOpacityToColor(borderColor, borderOpacity);
      const fillColorToPlot = applyOpacityToColor(fillColor, fillOpacity);
      console.log('borderColorToPlot',borderColorToPlot);

      if (!startPoint) {
          // Mouse down - initialize start point and overlay
          startPoint = viewportPoint;

          // Create an HTML element for the overlay
          overlayElement = document.createElement('div');
          overlayElement.className = "annotate-rectangle";
          overlayElement.style.borderStyle = borderStyle;
          overlayElement.style.borderColor = borderColorToPlot;
          overlayElement.style.borderWidth = `${borderLw}px`;
          overlayElement.style.backgroundColor = fillColorToPlot;
          overlayElement.id = `annotate-rect-${currentAnnotationId}`;

          viewer.addOverlay({
              element: overlayElement,
              location: new OpenSeadragon.Rect(startPoint.x, startPoint.y, 0, 0)
          });
      } else {
          // Mouse move - update overlay dimensions
          const width = viewportPoint.x - startPoint.x;
          const height = viewportPoint.y - startPoint.y;
          // If you want to constrain it to a square, make width = height
          //var size = Math.max(Math.abs(width), Math.abs(height));
          //width = width < 0 ? -size : size;
          //height = height < 0 ? -size : size;

          // Update the overlay's location and size
          viewer.updateOverlay(overlayElement, new OpenSeadragon.Rect(
              Math.min(startPoint.x, startPoint.x + width),
              Math.min(startPoint.y, startPoint.y + height),
              Math.abs(width),
              Math.abs(height)
          ));
      }
  }
});

// Finalize the rectangle on mouseup
viewer.addHandler('canvas-release', function(event) {
  if ((event.originalEvent.shiftKey || isRectangleMode) && startPoint) {
      // Capture the final rectangle's coordinates and size
      const image = viewer.world.getItemAt(0);
      const imageSize = image.getContentSize();

      const endPoint = viewer.viewport.pointFromPixel(event.position);
      const imageStartPoint = image.viewportToImageCoordinates(startPoint.x, startPoint.y); // Get image coordinates
      const imageEndPoint = image.viewportToImageCoordinates(endPoint.x, endPoint.y);
      // var imageStartPoint = viewer.viewport.viewportToImageCoordinates(startPoint.x, startPoint.y); // Get image coordinates
      // var imageEndPoint = viewer.viewport.viewportToImageCoordinates(endPoint.x, endPoint.y);
      const width = imageEndPoint.x - imageStartPoint.x;
      const height = imageEndPoint.y - imageStartPoint.y;

      // Normalize the coordinates so the top-left is always the starting point
      const x = Math.min(imageStartPoint.x, imageStartPoint.x + width);
      const y = Math.min(imageStartPoint.y, imageStartPoint.y + height);
      const finalPoint = image.imageToViewportCoordinates(x, y);
      // var finalPoint = viewer.viewport.imageToViewportCoordinates(x, y);
      const finalWidth = Math.abs(width);
      const finalHeight = Math.abs(height);

      // Get a uniqueID to store
      const uniqueID = generateUniqueId(8);

      // Get the plotting options
      const labelFontSize = Number(document.getElementById("annoLabelFontSize").value);
      const labelFontColor = document.getElementById("annoLabelFontColor").value;
      const labelBackgroundColor = document.getElementById("annoLabelBackgroundColor").value;
      const labelBackgroundOpacity = Number(document.getElementById("annoLabelBackgroundOpacity").value);
      const borderLw = Number(document.getElementById("rectBorderLw").value);
      const borderColor = document.getElementById("rectBorderColor").value;
      const borderStyle = document.getElementById("rectBorderStyle").value;
      const borderOpacity = Number(document.getElementById("rectBorderOpacity").value);
      const fillColor = document.getElementById("rectFillColor").value;
      const fillOpacity = Number(document.getElementById("rectFillOpacity").value);

      if (isRepeatMode) {
        const annoId = parseInt(document.getElementById('anno-id').value);
        var constRectLabel = annoJSON[annoId].properties.label;
      } else {
        var constRectLabel = prompt("Enter a label for this point:");
      }

      // Record the annotation (and get the prompt for the label)
      let annotation = {
        x: x,
        y: y,
        w: finalWidth,
        h: finalHeight,
        type: 1, // 1 for rectangle
        label: constRectLabel, //prompt("Enter a label for this rectangle:"),  // Prompt for a label
      };

      // Add the rectangle to the geoJSON
      const sampleIdx = samples.indexOf(sampleName);
      addRectToGeoJSON(currentAnnotationId,
        x,
        y,
        finalWidth,
        finalHeight,
        { uuid: uniqueID,
          label: annotation.label,
          xLabel: finalPoint.x, // Upper left
          yLabel: finalPoint.y, // Upper left
          w: finalWidth,
          h: finalHeight,
          imageTitle: sampleName,
          pixelsPerMeter: Number(pixelsPerMeters[sampleIdx]),
          imageWidth: imageSize.x,
          imageHeight: imageSize.y,
          labelFontSize: labelFontSize,
          labelFontColor: labelFontColor,
          labelBackgroundColor: labelBackgroundColor,
          labelBackgroundOpacity: labelBackgroundOpacity,
          borderStyle: borderStyle,
          borderLw: borderLw,
          borderColor: borderColor,
          borderOpacity: borderOpacity,
          fillColor: fillColor,
          fillOpacity: fillOpacity
        }
      )

      annoDict[currentAnnotationId] = uniqueID;

      // Record the rectangle
      annotateRectangles.push(overlayElement);

      // Mouse up - finalize and reset for the next rectangle
      startPoint = null;
      overlayElement = null;


      // Add the label
      addText(currentAnnotationId, annotation.label, finalPoint,
        labelFontColor, labelFontSize, labelBackgroundColor, labelBackgroundOpacity
      );
      currentAnnotationId = currentAnnotationId+1;

      // Store annotation
      annotations.push(annotation);

      enableAnnoButtons();
      hasUnsavedAnnotations = true;
      // updateButtonColor(); // Use for testing
  }
});

// Clear annotations & grid
document.getElementById('clearBtn').addEventListener('click', function () {
  console.log('Clear clicked');
  clearAnnotations();
  annotations = [];
});

// Functions to add annotation test and crosshairs
function addText(i, label, location, color='#FFFFFF', fontSize=16, backgroundColor='#000000', backgroundOpacity=0.5) {
  const pointLabel = document.createElement("div");

  pointLabel.innerHTML = `${label}`;
  pointLabel.className = "annotate-label";
  pointLabel.id = `annotate-label-${i}`;

  const backgroundColorToPlot = applyOpacityToColor(backgroundColor, backgroundOpacity);

  // Apply inline styles for customization
  pointLabel.style.setProperty("--annoLabel-color", color);
  pointLabel.style.setProperty("--annoLabel-font-size", `${fontSize}px`);
  pointLabel.style.setProperty("--annoLabelBackground-color", backgroundColorToPlot);

  const overlay = viewer.addOverlay({
          element: pointLabel,
          location: location,
          checkResize: false,
      });
  annotateLabels.push(pointLabel);
  hasUnsavedAnnotations = true;
  // // updateButtonColor(); // Use for testing // Use for testing
  updateRepeatButton();
}

// Function to delete the text of an existing annotation label
function deleteText(id) {
  const overlayElement = document.getElementById(`annotate-label-${id}`);
  if (overlayElement) {
    viewer.removeOverlay(overlayElement); // Remove the overlay using the element
    annotateLabels = annotateLabels.filter(label => label.id !== `annotate-label-${id}`); // Clean up the array
    console.log(`Overlay with ID annotate-label-${id} removed.`);
    hasUnsavedAnnotations = true;
    // updateButtonColor(); // Use for testing
  } else {
    console.warn(`Overlay with ID annotate-label-${id} not found.`);
  }
}

// Function to update the text of an existing annotation label
function updateText(i, newLabel=undefined, color=undefined, fontSize=undefined, backgroundColor=undefined, backgroundOpacity=undefined) {
  // Find the label element by id
  const pointLabel = document.getElementById(`annotate-label-${i}`);

  if (pointLabel) {
    if (newLabel !== undefined && newLabel !== null) {
      console.log('updating label innerHTML');
      // Update the innerHTML with the new label
      pointLabel.innerHTML = newLabel;
    }

    console.log(color, fontSize, backgroundColor, backgroundOpacity, newLabel);

    console.log(`Label updated for ID ${i}:`, newLabel);
    hasUnsavedAnnotations = true;
    // updateButtonColor(); // Use for testing

    // Update the CSS variables if new values are provided
    if (color !== undefined) {
      const colorToPlot = applyOpacityToColor(color, 1.0);
      console.log('colorToPlot',colorToPlot);
      pointLabel.style.setProperty("--annoLabel-color", colorToPlot);
    }
    if (fontSize !== undefined) {
      pointLabel.style.setProperty("--annoLabel-font-size", `${fontSize}px`);
    }
    if (backgroundColor !== undefined && backgroundOpacity !== undefined) {
      const backgroundColorToPlot = applyOpacityToColor(backgroundColor, backgroundOpacity);
      pointLabel.style.setProperty("--annoLabelBackground-color", backgroundColorToPlot);
    }

  } else {
    console.log(`No annotation found with ID ${i}.`);
  }
}

function addCrosshairs(i, location, color='purple', lineWeight = 2, opacity = 1) {
    console.log('Crosshairs added');

    console.log('lw,op',lineWeight,opacity);
    const crosshairsAnnotate = document.createElement("div");
    crosshairsAnnotate.className = "annotate-symbol"; // Used for css styling
    crosshairsAnnotate.id = `annotate-crosshair-${i}`;

    // Apply inline styles for customization
    crosshairsAnnotate.style.setProperty("--crosshair-color", color);
    crosshairsAnnotate.style.setProperty("--crosshair-line-weight", `${Number(lineWeight)}px`);
    crosshairsAnnotate.style.setProperty("--crosshair-opacity", Number(opacity));

    const overlay = viewer.addOverlay({
      element: crosshairsAnnotate,
      location: location,
      checkResize: false,
  });
  annotatePoints.push(crosshairsAnnotate);
  hasUnsavedAnnotations = true;
  updateRepeatButton();
  // updateButtonColor(); // Use for testing
}

function updateCrosshair(id, newColor, newLineWeight, newOpacity) {
  // Find the existing crosshair element by its ID
  const crosshairElement = document.getElementById(`annotate-crosshair-${id}`);
  
  if (!crosshairElement) {
      console.error(`Crosshair with ID "${id}" not found.`);
      return;
  }

  // Update the CSS variables if new values are provided
  if (newColor !== undefined) {
      crosshairElement.style.setProperty("--crosshair-color", newColor);
  }
  if (newLineWeight !== undefined) {
      crosshairElement.style.setProperty("--crosshair-line-weight", `${newLineWeight}px`);
  }
  if (newOpacity !== undefined) {
      crosshairElement.style.setProperty("--crosshair-opacity", newOpacity);
  }
}

function updateRectangle(id, borderStyle, borderLw, borderColor,
  borderOpacity, fillColor, fillOpacity) {
  // Find the existing crosshair element by its ID
  const rectElement = document.getElementById(`annotate-rect-${id}`);
  const borderColorToPlot = applyOpacityToColor(borderColor, borderOpacity);
  const fillColorToPlot = applyOpacityToColor(fillColor, fillOpacity);

  if (!rectElement) {
      console.error(`Rectangle with ID "${id}" not found.`);
      return;
  }

  // Update the CSS variables if new values are provided
  if (borderStyle !== undefined) {
    rectElement.style.borderStyle = borderStyle;
  }
  if (borderLw !== undefined) {
    rectElement.style.borderWidth = `${borderLw}px`;
  }
  if (borderColor !== undefined) {
    rectElement.style.borderColor = borderColorToPlot;
  }
  if (fillColor !== undefined) {
    rectElement.style.backgroundColor = fillColorToPlot;
  }
}

// TODO: Could probably consolidate these "delete" functions into a single function
function deleteCrosshairs(id) {
  const overlayElement = document.getElementById(`annotate-crosshair-${id}`);
  if (overlayElement) {
    viewer.removeOverlay(overlayElement); // Remove the overlay using the element
    annotatePoints = annotatePoints.filter(label => label.id !== `annotate-crosshair-${id}`); // Clean up the array
    console.log(`Overlay with ID annotate-crosshair-${id} removed.`);
  } else {
    console.warn(`Overlay with ID annotate-crosshair-${id} not found.`);
  }
  updateRepeatButton();
}

// TODO: Could probably consolidate these "delete" functions into a single function
function deleteRectangle(id) {
  const overlayElement = document.getElementById(`annotate-rect-${id}`);
  if (overlayElement) {
    viewer.removeOverlay(overlayElement); // Remove the overlay using the element
    annotateRectangles = annotateRectangles.filter(label => label.id !== `annotate-rect-${id}`); // Clean up the array
    console.log(`Overlay with ID annotate-rect-${id} removed.`);
  } else {
    console.warn(`Overlay with ID annotate-rect-${id} not found.`);
  }
  updateRepeatButton();
}

function addRectangle(i, x, y, w, h) {
  /// Input must be in viewer coordinations
  console.log('Adding rectangle!');
  const rectAnnotate = document.createElement("div");
  rectAnnotate.style.border = '2px solid green';
  rectAnnotate.className = "annotate-rectangle";
  rectAnnotate.id = `annotate-rect-${i}`;
  const overlay = viewer.addOverlay({
    element: rectAnnotate,
    location: new OpenSeadragon.Rect(x, y, w, h),
    checkResize: false,
  });
  annotateRectangles.push(rectAnnotate);
  hasUnsavedAnnotations = true;
  // updateButtonColor(); // Use for testing
  updateRepeatButton();
}

function loadAnnotationsFromJSON(file) {
  // Use fetch to get the GeoJSON file from the URL
  console.log('Beginning loading annotations from JSON',file);
  fetch(file)
      .then(response => {
          if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
          }
          // Log the raw response as text for debugging
          return response.json(); // Use text() first to inspect the content
      })
      .then(data => {
        console.log('GeoJSON data loaded:', data);
        loadAnnotations(data);
        // You can now use the geoJsonData for mapping or other purposes
      })
      .catch(error => {
        console.error('Error loading GeoJSON:', error);
      });
  updateRepeatButton();
}

// TODO: This function seems too complicated and probably redundant with parts
// of other functions. Consider cleaning up.
// New function for loading geoJSON data
function loadAnnotations(geoJSONData) {
  // Parse the GeoJSON data
  console.log('starting annotation load');
  let geoJSON;
  if (typeof geoJSONData === 'string') {
    // If it's a string, attempt to parse it
    try {
      geoJSON = JSON.parse(geoJSONData);
      console.log('Parsed geoJSON:', geoJSON);
    } catch (error) {
      console.error('Error parsing GeoJSON:', error);
      return; // Exit if parsing fails
    }
  } else {
    // If it's already an object, use it directly
    geoJSON = geoJSONData;
    console.log('GeoJSON is already parsed:', geoJSON);
  }
  //const geoJSON = JSON.parse(geoJSONData);

  // Check if it's a FeatureCollection or an object with custom IDs
  const features = geoJSON.features || Object.values(geoJSON); // Supports both formats
  
  console.log('features',features);

  // Iterate through each feature in the GeoJSON data
  features.forEach((feature) => {
    const { geometry, properties } = feature;
    // Check if the uuid already exists, and if so, skip
    if (Object.values(annoDict).includes(properties.uuid)) {
      console.log('Warning: annotation already exists, skipping');
      return;
    }
    if (geometry && properties) {
      const { coordinates } = geometry;
      if (geometry.type === "Point") { // Point annotation
        const { label, pixelsPerMeter, imageWidth, imageHeight, lw, color, opacity } = properties;
        const x = coordinates[0]; // x-coordinate from GeoJSON
        const y = coordinates[1]; // y-coordinate from GeoJSON

        // Check to see if geometry is present
        if (isNaN(x) || isNaN(y)) {
          console.log('Geometry not detected');
          return;
        }

        const image = viewer.world.getItemAt(0);
        if (image) {
          console.log('tiledImage',image);
        } else {
          console.error('TiledImage is undefined or not yet loaded.');
          return;
        }
          
        // Calculate viewport coordinates from image coordinates
        const viewportPoint = image.imageToViewportCoordinates(new OpenSeadragon.Point(x, y));
        // const viewportPoint = viewer.viewport.imageToViewportCoordinates(new OpenSeadragon.Point(x, y));
          
        // Create annotation object
        let annotation = {
          x: x,
          y: y,
          w: 0,   // Width not needed for points
          h: 0,   // Height not needed for points
          type: 0,  // Type 0 for points
          label: label,  // Label from properties
          uuid: properties.uuid,  // Unique ID for the annotation
        };

        // Add the point annotation (crosshairs, text)
        addText(currentAnnotationId, label, viewportPoint, properties.labelFontColor,
          Number(properties.labelFontSize), properties.labelBackgroundColor, Number(properties.labelBackgroundOpacity));
        addCrosshairs(currentAnnotationId, viewportPoint, properties.pointColor, Number(properties.pointLw),
          Number(properties.pointOpacity));

        // Create the GeoJSON entry for this annotation
        const geoJSONFeature = {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [x, y]
          },
          properties: {
            uuid: properties.uuid,
            label: label,
            xLabel: properties.xLabel,
            yLabel: properties.yLabel,
            imageTitle: properties.imageTitle,
            pixelsPerMeter: Number(properties.pixelsPerMeter),
            imageWidth: Number(properties.imageWidth),
            imageHeight: Number(properties.imageHeight),
            labelFontSize: Number(properties.labelFontSize),
            labelFontColor: properties.labelFontColor,
            labelBackgroundColor: properties.labelBackgroundColor,
            labelBackgroundOpacity: Number(properties.labelBackgroundOpacity),
            pointLw: Number(properties.pointLw),
            pointColor: properties.pointColor,
            pointOpacity: Number(properties.pointOpacity),
          }
        };
        // Add the feature to the geoJSONDict with currentAnnotationId + 1 as the key
        // TODO: is annoDict redundant with annoJSON?
        annoDict[currentAnnotationId] = properties.uuid;
        annoJSON[currentAnnotationId] = geoJSONFeature;
        // TODO: This code is not generic for other polygon shapes. Currently only for Rectangles.
      } else if (geometry.type === "Polygon") { // Polygon annotation
        console.log('Loading polygon!!!');
        const image = viewer.world.getItemAt(0);
        if (!image) {
          console.error('TiledImage is undefined or not yet loaded.');
          return;
        }
        const coordinates = geometry.coordinates; // Polygon coordinates
        
        // This assumes that the first coordinate is always the minimum value (which seems to work always)
        const minX = coordinates[0][0][0];
        const minY = coordinates[0][0][1];

        // Width and height in geoJSON are in image coordinates
        const width = properties.w/properties.imageWidth;
        const height = properties.h/properties.imageWidth; // TODO: I'm always surprised this is x and not y

        // // Calculate viewport coordinates from image coordinates
        const viewportPoint = image.imageToViewportCoordinates(new OpenSeadragon.Point(minX, minY));
          
        // Add the point annotation (crosshairs, text)
        addText(currentAnnotationId, properties.label, viewportPoint, properties.labelFontColor,
          Number(properties.labelFontSize), properties.labelBackgroundColor, Number(properties.labelBackgroundOpacity)
        );
     
        console.log('inputs',currentAnnotationId, properties.label, viewportPoint, properties.labelFontColor, Number(properties.labelFontSize), properties.labelBackgroundColor, Number(properties.labelBackgroundOpacity));

        const borderColorToPlot = applyOpacityToColor(properties.borderColor, Number(properties.borderOpacity));
        const fillColorToPlot = applyOpacityToColor(properties.fillColor, Number(properties.fillOpacity));
        
        overlayElement = document.createElement('div');
        overlayElement.className = "annotate-rectangle";
        overlayElement.style.borderStyle = properties.borderStyle;
        overlayElement.style.borderColor = borderColorToPlot;
        overlayElement.style.borderWidth = `${Number(properties.borderLw)}px`;
        overlayElement.style.backgroundColor = fillColorToPlot;
        overlayElement.id = `annotate-rect-${currentAnnotationId}`;
        
        viewer.addOverlay({
            element: overlayElement,
            location: new OpenSeadragon.Rect(viewportPoint.x, viewportPoint.y, width, height)
        });


        // Create the GeoJSON entry for this annotation
        const geoJSONFeature = {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: coordinates
          },
          properties: {
            uuid: properties.uuid,
            label: properties.label,
            xLabel: properties.xLabel,
            yLabel: properties.yLabel,
            w: properties.w,
            h: properties.h,
            imageTitle: properties.imageTitle,
            pixelsPerMeter: Number(properties.pixelsPerMeter),
            imageWidth: Number(properties.imageWidth),
            imageHeight: Number(properties.imageHeight),
            labelFontSize: Number(properties.labelFontSize),
            labelFontColor: properties.labelFontColor,
            labelBackgroundColor: properties.labelBackgroundColor,
            labelBackgroundOpacity: Number(properties.labelBackgroundOpacity),
            borderStyle: properties.borderStyle,
            borderLw: Number(properties.borderLw),
            borderColor: properties.borderColor,
            borderOpacity: Number(properties.borderOpacity),
            fillColor: properties.fillColor,
            fillOpacity: Number(properties.fillOpacity)
          }
        };
        // Add the feature to the geoJSONDict with currentAnnotationId + 1 as the key
        // TODO: is annoDict redundant with annoJSON?
        annoDict[currentAnnotationId] = properties.uuid;
        annoJSON[currentAnnotationId] = geoJSONFeature;
      }

      // document.getElementById("anno-id").disabled = false;
      // document.getElementById("anno-first-button").disabled = false;
      // document.getElementById("anno-prev-button").disabled = false;
      // document.getElementById("anno-next-button").disabled = false;
      // document.getElementById("anno-last-button").disabled = false;
      // document.getElementById("anno-label").disabled = false;
      enableAnnoButtons();
      annoLabelToText();
      
      // Increment annotation ID
      currentAnnotationId = currentAnnotationId + 1;
    }
  });
}

// New loading code
document.getElementById('loadAnnotationsBtn').addEventListener('change', function(event) {
  
  // const fileInput = document.getElementById('geojsonFileInput');
  const fileInput = event.target;
  // Old way
  // const fileInput = document.getElementById()
  // const file = fileInput.files[0];

  const file = fileInput.files[0];
  if (!file) {
    console.log('not a file!');
    return;
  }

  if (file) {
      const reader = new FileReader();
      reader.onload = function (event) {
          const geoJSONData = event.target.result;
          console.log('geoJSONData',geoJSONData);
          loadAnnotations(geoJSONData);
          fileInput.value = '';
      };
      reader.readAsText(file);
  } else {
      alert('Please select a GeoJSON file to load annotations.');
  }
});

// Attach export functionality to the button (GeoJSON version)
document.getElementById('exportBtn').addEventListener('click', function () {
  const geoJSON = annoJSON;
  console.log(geoJSON);
  // Create a Blob from the GeoJSON object
  const geoJSONBlob = new Blob([JSON.stringify(geoJSON, null, 2)], { type: 'application/geo+json' });
  // Trigger the download with 'saveAs'
  saveAs(geoJSONBlob, "annotations.geojson");
  // Reset the unsaved annotations flag (if necessary)
  hasUnsavedAnnotations = false;
  // updateButtonColor(); // Use for testing
});

const clearAnnotations = () => {
  const annoIds = Object.keys(annoDict).map(Number);
  
  if (annoIds.length === 0) {
    return; // Nothing to remove
  } else {
    for (let i = 0; i < annoIds.length; i++) {
      const type = annoJSON[annoIds[i]].geometry.type;
      deleteText(annoIds[i]);
      console.log('type',type);
      if (type === 'Point') {
        deleteCrosshairs(annoIds[i]);
      } else if (type === 'Polygon') {
        deleteRectangle(annoIds[i]);
      } else {
        console.log('Annotation type not known. NOT DELETED');
      }
  }
  }
  const geoJSON = {};
  console.log('Cleared',geoJSON);
  annoDict = {};
  const annoLabel = document.getElementById('anno-label');
  annoLabel.value = '';
  currentAnnotationId = 1;
  hasUnsavedAnnotations = false;
  // updateButtonColor(); // Use for testing
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
  //checkbox.checked = !checkbox.checked;
  checkbox.click();  // Trigger the onclick handler for each checkbox
  //checkbox.dispatchEvent(new Event('change'));
};

// Add keyboard event listener
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey) {
    switch (event.key) {
      case '1':
        toggleCheckbox('image1');
        break;
      case '2':
        toggleCheckbox('image2');
        break;
      case '3':
        toggleCheckbox('image3');
        break;
      case '4':
        toggleCheckbox('image4');
        break;
      case 'g':
        toggleCheckbox('show-grid');
        break;
      default:
        break;
    }
  }
});

////////////////////////
// Grid functionality //
////////////////////////

const Grid = class {
  constructor({ unit, pixelsPerUnit, xMin, yMin, xMax, yMax, step, noPoints}) {
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

  get pixelsPerMeter() {q
    return this.pixelsPerUnit / this.metersPerUnit;
  }  
};

// Initialize grid with default settings.
let grid = new Grid({
  //unit: 2,
  //pixelsPerUnit: 0.37,
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
  document.getElementById("restore-grid-settings").disabled = false;
};

// Empty arrays to store points and crosshairs
let gridOverlayPoints = []; ///
let gridOverlayCrosshairs = []; ///

// TODO: Currently adding more counts results in erasing the existing
// counts. It would be better if there were a way of changing the point counts
// without changing modifying the underlying count data. This way more points
// count be added on the fly without having to mess with CSV file.
const applyGridSettings = () => {
  clearGridOverlayCrosshairs();
  clearGridOverlayPoints();

  // Enable buttons and input field after settings are applied
  document.getElementById('prev-button').disabled = false;
  document.getElementById('next-button').disabled = false;
  document.getElementById('sample-input').disabled = false;
  document.getElementById('sample-text').disabled = false;
  document.getElementById('sample-notes').disabled = false;
  document.getElementById('count-export').disabled = false;


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
  console.log('image size:',imageSize);
  console.log('pixels per unit:',grid.pixelsPerUnit);
  const x_min_um = grid.xMin / 100 * imageSize.x / grid.pixelsPerUnit;
  const x_max_um = grid.xMax / 100 * imageSize.x / grid.pixelsPerUnit;
  const y_min_um = grid.yMin / 100 * imageSize.y / grid.pixelsPerUnit;
  const y_max_um = grid.yMax / 100 * imageSize.y / grid.pixelsPerUnit;

  // Get the coordinates and labels for point counts
  let [X, Y, A]  = makePoints(x_min_um, x_max_um, y_min_um, y_max_um, grid.step, grid.noPoints);

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

    // Add point label with coordinates.
    const pointLabel = document.createElement("div");
    pointLabel.innerHTML = `${A[i]}`;
    pointLabel.className = "grid point-label";
    pointLabel.id = `pointLabel-${i}`;
    const labelOverlay = viewer.addOverlay({
      element: pointLabel,
      location: location,
      checkResize: false,
    });
    gridOverlayPoints.push(labelOverlay);

    // Add crosshairs.
    const crosshairs = document.createElement("div");
    crosshairs.className = "grid crosshairs";
    crosshairs.id = `crosshair-${i}`; // Set a unique ID for each overlay
    const crosshairOverlay = viewer.addOverlay({
      element: crosshairs,
      location: location,
      checkResize: false,
    });
    // Store the crosshairs overlay in the array
    gridOverlayCrosshairs.push(crosshairOverlay);
  }

  // Always show the grid right after generating it. (The newly added overlay
  // elements will be visible by default, so checking the box here doesn't
  // actually affect them - it just makes the checkbox state consistent with the
  // visibility states.)
  document.getElementById("show-grid").checked = true;
  document.getElementById("apply-grid-settings").disabled = true;
  document.getElementById("restore-grid-settings").disabled = true;
  gridApplied = true;

  // Update AOI rectangle after grid is applied
  updateAoiRectangle();
};


// TODO: IN PROGRESS. Developing an approach for loading pre-existing
// points that is independent of defining a new grid. Will allow custom point
// configuration provided that point locations in pixels are provided

// toggleButton.addEventListener("click", () => {
//   if (!detailsMenu.hasAttribute("disabled")) {
//     detailsMenu.setAttribute("disabled", "true");
//   } else {
//     detailsMenu.removeAttribute("disabled");
//   }
// });

// const loadExistingGrid = () => {
//   clearGridOverlayCrosshairs();
//   clearGridOverlayPoints();

//   const gridDropdown = document.getElementById("detailsMenu");
//   detailsMenu.setAttribute("disabled", "true");

//   // Enable buttons and input field after settings are applied
//   document.getElementById('prev-button').disabled = false;
//   document.getElementById('next-button').disabled = false;
//   document.getElementById('sample-input').disabled = false;
//   document.getElementById('sample-text').disabled = false;
//   document.getElementById('sample-notes').disabled = false;
//   document.getElementById('count-export').disabled = false;


//   const image = viewer.world.getItemAt(0);
//   grid = new Grid({
//     unit: units[currentIndex],
//     pixelsPerUnit: pixelsPerUnits[currentIndex],
//     xMin: parseFloat(document.getElementById("grid-left").value),
//     yMin: parseFloat(document.getElementById("grid-top").value),
//     xMax: parseFloat(document.getElementById("grid-right").value),
//     yMax: parseFloat(document.getElementById("grid-bottom").value),
//     step: parseInt(document.getElementById("step-size").value),
//     noPoints: parseInt(document.getElementById("no-points").value),
//   });

//   const imageSize = image.getContentSize();
//   console.log('image size:',imageSize);
//   const x_min_um = grid.xMin / 100 * imageSize.x / grid.pixelsPerUnit;
//   const x_max_um = grid.xMax / 100 * imageSize.x / grid.pixelsPerUnit;
//   const y_min_um = grid.yMin / 100 * imageSize.y / grid.pixelsPerUnit;
//   const y_max_um = grid.yMax / 100 * imageSize.y / grid.pixelsPerUnit;

//   // Get the coordinates and labels for point counts
//   let [X, Y, A]  = makePoints(x_min_um, x_max_um, y_min_um, y_max_um, grid.step, grid.noPoints);

//   for (let i = 0; i < X.length; i++) {
//     // Get the coordinates in the specified unit.
//     const xUnits = X[i];
//     const yUnits = Y[i];

//     // Convert to coordinates in pixels.
//     const xPixels = xUnits * pixelsPerUnits[currentIndex];
//     const yPixels = yUnits * pixelsPerUnits[currentIndex];

//     // Convert to view-space coordinates, measuring from the top-left of the
//     // first image.
//     const location = image.imageToViewportCoordinates(xPixels, yPixels);

//     // Add point label with coordinates.
//     const pointLabel = document.createElement("div");
//     pointLabel.innerHTML = `${A[i]}`;
//     pointLabel.className = "grid point-label";
//     pointLabel.id = `pointLabel-${i}`;
//     const labelOverlay = viewer.addOverlay({
//       element: pointLabel,
//       location: location,
//       checkResize: false,
//     });
//     gridOverlayPoints.push(labelOverlay);

//     // Add crosshairs.
//     const crosshairs = document.createElement("div");
//     crosshairs.className = "grid crosshairs";
//     crosshairs.id = `crosshair-${i}`; // Set a unique ID for each overlay
//     const crosshairOverlay = viewer.addOverlay({
//       element: crosshairs,
//       location: location,
//       checkResize: false,
//     });
//     // Store the crosshairs overlay in the array
//     gridOverlayCrosshairs.push(crosshairOverlay);
//   }

//   // Always show the grid right after generating it. (The newly added overlay
//   // elements will be visible by default, so checking the box here doesn't
//   // actually affect them - it just makes the checkbox state consistent with the
//   // visibility states.)
//   document.getElementById("show-grid").checked = true;
//   document.getElementById("apply-grid-settings").disabled = true;
//   document.getElementById("restore-grid-settings").disabled = true;
//   gridApplied = true;

//   // Update AOI rectangle after grid is applied
//   updateAoiRectangle();
// };

const clearGridOverlayPoints = () => {
  // Loop through each overlay in the array and remove it from the viewer
  gridOverlayPoints.forEach((_, i) => {
    viewer.removeOverlay(`pointLabel-${i}`);
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

const restoreGridSettings = () => {
  document.getElementById("grid-left").value = grid.xMin;
  document.getElementById("grid-top").value = grid.yMin;
  document.getElementById("grid-right").value = grid.xMax;
  document.getElementById("grid-bottom").value = grid.yMax;
  document.getElementById("step-size").value = grid.step;
  document.getElementById("no-points").value = grid.noPoints;

  // Leave the Apply button enabled unless the grid has been generated at least
  // once.
  if (gridApplied) {
    document.getElementById("apply-grid-settings").disabled = true;
  }
  document.getElementById("restore-grid-settings").disabled = true;
};

// Initialize grid setting elements.
restoreGridSettings();

// Point counting function (Oct 14, 2024)
function pointMatrix(x_min, x_max, y_min, y_max, step_size, i_ini = 1, reverse = false) {
  // Return x coordinates, y coordinates, and point count labels
  // Units of x and y must be same as step_size
  // i_ini is starting point count ID label (default=1)
  // reverse (bool) indicates whether starting in top left (false) or bottom right (true)

  // Start at top-left pixel and progress to the bottom-right in snake-like pattern
  let n_y_rows = Math.floor((y_max - y_min) / step_size) + 1;
  let n_x_cols = Math.floor((x_max - x_min) / step_size) + 1;

  // Make 1D x-axis array that reflects snaking increments from top left to bottom right
  let x_vals = Array.from({ length: n_x_cols }, (_, i) => x_min + i * step_size);
  let X = Array(n_y_rows)
      .fill(0)
      .map((_, rowIndex) => {
          let row = [...x_vals];
          return rowIndex % 2 === 0 ? row : row.reverse();
      })
      .flat();

  // Make 1D y-axis values for the same array
  let y_vals = Array.from({ length: n_y_rows }, (_, i) => y_min + i * step_size);
  let Y = [].concat(...y_vals.map(y => Array(n_x_cols).fill(y)));

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

      let [X, Y, A] = pointMatrix(x_min, x_max, y_min, y_max, step_size * d, c, reverse);

      // Remove overlapping points
      let newPoints = X.map((x, i) => [x, Y[i]]);
      let existingPoints = Xs.map((x, i) => [x, Ys[i]]);
      let idxToRemove = newPoints.filter(p => existingPoints.some(e => e[0] === p[0] && e[1] === p[1]));
      let filteredPoints = newPoints.filter(p => !idxToRemove.includes(p));

      X = filteredPoints.map(p => p[0]);
      Y = filteredPoints.map(p => p[1]);
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
          legend = [...legend, ...Array(X.slice(0, num_points - c).length).fill(e + 1)];
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
    viewer.updateOverlay(aoiOverlay, new OpenSeadragon.Rect(topLeft.x, topLeft.y, width, height));
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
["grid-left", "grid-right", "grid-top", "grid-bottom"].forEach(id => {
  document.getElementById(id).addEventListener("input", updateAoiRectangle);
});

// Attach an event listener to the "Show AOI" checkbox
document.getElementById("show-aoi").addEventListener("change", updateAoiRectangle);

//////////////////////////////////////////
//// Point counting functionality ////////
//////////////////////////////////////////

document.getElementById('prev-button').addEventListener('click', function() {
  const input = document.getElementById('sample-input');
  let value = parseInt(input.value, 10) || 0; // Parse current value or default to 0
  const min = parseInt(input.min, 10);

  if (value > min) {
    input.value = value - 1;
  }
  goToGridPoint(input.value); // Input count id
  inputSampleLabelFromOverlay();
});

document.getElementById('next-button').addEventListener('click', function() {
  const input = document.getElementById('sample-input');
  let value = parseInt(input.value, 10) || 0; // Parse current value or default to 0
  const max = parseInt(document.getElementById("no-points").value);

  if (value <= max) {
    input.value = value + 1;
  } else {
    input.value = max;
  }
  goToGridPoint(input.value);
  inputSampleLabelFromOverlay();
});

function goToGridPoint(value) {
  if (viewer.getOverlayById(`pointLabel-${value-1}`)) {
    const overlay = viewer.getOverlayById(`pointLabel-${value-1}`);
    // Center the viewport on the specified coordinates without changing the zoom level
    viewer.viewport.panTo(
      new OpenSeadragon.Point(overlay.location.x, overlay.location.y),
      true // Animate the panning
    );
    } else {
    alert('Overlay not found for this sample number.');
  }
}

// When you get hit Enter on the sample-input field
document.addEventListener('keydown', function(event) {
  // Check for Enter key in sample-input field
  const gridInput = document.getElementById('sample-input');
  if (event.code === 'Enter' && document.activeElement === gridInput) {
    event.preventDefault(); // Prevent any default action for Enter key
    goToGridPoint(gridInput.value);
    inputSampleLabelFromOverlay();
    console.log('Enter clicked');
  }
});

// When you hit Enter on the sample-notes field
document.addEventListener('keydown', function(event) {
  // Check for Enter key in sample-notes field
  const notesInput = document.getElementById('sample-notes');
  if (event.code === 'Enter' && document.activeElement === notesInput) {
    event.preventDefault(); // Prevent any default action for Enter key
    inputNotesText();
  }
});

// Function to handle keyboard shortcuts
document.addEventListener('keydown', function(event) {
  // Check for Enter key in sample-text field
  const textInput = document.getElementById('sample-text');
  // const gridInput = document.getElementById('sample-input'); // Placeholder for changing color of crosshairs
  if (event.code === 'Enter' && document.activeElement === textInput) {
    event.preventDefault(); // Prevent any default action for Enter key
    inputSampleLabel();
    // updateGridCrosshair(gridInput.value); // Placeholder for changing color of crosshairs
  }
});

// Shortcuts for going to next (space) or previous (shift+space)
document.addEventListener('keydown', function(event) {
  // Check if the space bar is pressed without modifiers
  if (event.code === 'Space' && document.activeElement.id !== 'sample-notes' && document.activeElement.id !== 'anno-label')
   {
    event.preventDefault();
    if (event.shiftKey) {
      const prevButton = document.getElementById('prev-button');
      prevButton.click(); // Simulate a click on the next button
    } else {
      const nextButton = document.getElementById('next-button');
      nextButton.click(); // Simultae a click on the next button
    }
  }
});

// Function to update the sample-text input based on the current overlay
function inputSampleLabelFromOverlay() {
  const input = document.getElementById('sample-input');
  let value = parseInt(input.value, 10);
  const textInput = document.getElementById('sample-text');
  const notesInput = document.getElementById('sample-notes');

  const overlay = viewer.getOverlayById(`pointLabel-${value-1}`);
  
  // Populate the sample-text with the label of the current overlay
  if (overlay) {
    textInput.value = overlay.label || ''; // Set the text input to the label of the overlay, defaulting to an empty string
    notesInput.value = overlay.notes || ''; // Set the text input to the label of the overlay, defaulting to an empty string
    }
}

function inputSampleLabel() {
  const input = document.getElementById('sample-input');
  let value = parseInt(input.value, 10);
  const textInput = document.getElementById('sample-text');
  
  // Store the text in the object with sampleNumber as key
  const overlay = viewer.getOverlayById(`pointLabel-${value-1}`);
  if (overlay) {
    overlay.label = textInput.value;
  } else {
    console.error('Overlay not found for value: ', value);
  }
  hasUnsavedCounts = true;
}

function inputNotesText() {
  const input = document.getElementById('sample-input');
  let value = parseInt(input.value, 10);
  const textInput = document.getElementById('sample-notes');
  
  // Store the text in the object with sampleNumber as key
  const overlay = viewer.getOverlayById(`pointLabel-${value-1}`);
  if (overlay) {
    overlay.notes = textInput.value;
  } else {
    console.error('Overlay not found for value: ', value);
  }
  hasUnsavedCounts = true;
}

// Function to update repeatButton state
function updateRepeatButton() {
  // Enable the checkbox if the dictionary has at least one item
  repeatButton.disabled = Object.keys(annoDict).length === 0;
}

// TODO: in progress. Currently not working. Feature implement paused
// Function for updating crosshair color after point is made
// function updateGridCrosshair(id) {
//   console.log('updating grid crosshair');
  
//   // Get the crosshair overlay from the array
//   const crosshairOverlay = gridOverlayCrosshairs[id - 1];
  
//   if (crosshairOverlay && crosshairOverlay.element) {
//     const element = crosshairOverlay.element;

//     // Temporarily remove the class to force a re-render
//     element.classList.remove("crosshair-counted");
//     void element.offsetWidth; // Trigger a reflow
//     element.classList.add("crosshair-counted");
//   } else {
//     console.error("Crosshair overlay not found for ID:", id);
//   }
// }

// Shortcut for entering labels and notes
document.addEventListener('keydown', function(event) {
  // Check for Enter key in sample-text field
  const textInput = document.getElementById('sample-text');
  const notesInput = document.getElementById('sample-notes');
  if (event.code === 'Enter' && document.activeElement === textInput) {
    event.preventDefault(); // Prevent any default action for Enter key
    inputSampleLabel();

    // Provide visual feedback by changing the border color
    textInput.style.borderColor = 'green';
    textInput.style.outline = 'none'; // Removes the default focus outline

    setTimeout(() => {
      textInput.style.borderColor = ''; // Revert to original after 1 second
    }, 1000);
    populateDropdown(); // Repopulate dropdown for filtering
    populateFilterDropdown(); // Repopulate filter dropdown
  }
  if (event.code === 'Enter' && document.activeElement === notesInput) {
    event.preventDefault(); // Prevent any default action for Enter key
    inputNotesText();

    // Provide visual feedback by changing the border color
    notesInput.style.borderColor = 'green';
    notesInput.style.outline = 'none'; // Removes the default focus outline

    setTimeout(() => {
      notesInput.style.borderColor = ''; // Revert to original after 1 second
    }, 1000);
  }
});

// Export a CSV of point counts when the Export button is clicked
document.getElementById('count-export').addEventListener('click', function() {
  let csvContent = 'Parameter,Value\n';
  const headerInfo = {
    sample: sampleName,
    xMin: parseFloat(document.getElementById("grid-left").value),
    yMin: parseFloat(document.getElementById("grid-top").value),
    xMax: parseFloat(document.getElementById("grid-right").value),
    yMax: parseFloat(document.getElementById("grid-bottom").value),
    step: parseInt(document.getElementById("step-size").value),
    noPoints: parseInt(document.getElementById("no-points").value),
    version: 1
  };

  // Append each key-value pair in the header to csvContent
  for (const [key, value] of Object.entries(headerInfo)) {
    csvContent += `${key},${value}\n`;
  }

  // Add a blank line to separate headers from data
  csvContent += '\n';

  // Define data headers for point information
  csvContent += 'Point Number,X_viewer,Y_viewer,X_image,Y_image,Label,Notes\n';

  // const overlayCount = gridOverlayPoints.length;
  for (let i = 0; i < headerInfo.noPoints; i++) {
    // Get the overlay by its ID
    const overlay = viewer.getOverlayById(`pointLabel-${i}`);

    if (overlay && overlay.location) {
      const image = viewer.world.getItemAt(0);
      const imagePoint = image.viewportToImageCoordinates(overlay.location.x, overlay.location.y);
      // const imagePoint = viewer.viewport.viewportToImageCoordinates(overlay.location.x, overlay.location.y);
      const pointNumber = i + 1; // Point number, assuming 1-based index for CSV
      const x = overlay.location ? overlay.location.x : 'N/A';
      const y = overlay.location ? overlay.location.y : 'N/A';
      const x_px = imagePoint.x;
      const y_px = imagePoint.y;
      const label = overlay.label || '';
      const notes = overlay.notes || ''; // Adjust if your notes are stored differently

      // Append the row as a CSV line
      csvContent += `${pointNumber},${x},${y},${x_px},${y_px},"${label}","${notes}"\n`;
    }
  }

  // Create a blob and trigger a download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'count_data_export.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  hasUnsavedCounts = false;
});

// TODO: Is the code below unnecessary?
// document.getElementById('count-file-input').addEventListener('change', function(event) {
//   const file = event.target.files[0];
//   if (!file) return;
//   console.log("File chosen:", file.name); // Optional: log the file name
// });

// document.getElementById('loadAnnotationsBtn').addEventListener('change', function(event) {
//   const file = event.target.files[0];
//   if (!file) return;
//   console.log("File chosen:", file.name); // Optional: log the file name
// });

// Import CSV of previously generated point-count data
// Handle the file selection
document.getElementById('count-file-input').addEventListener('change', function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const content = e.target.result;
    const lines = content.split('\n');

    // Check if the file has at least three lines (header + data)
    if (lines.length < 3) {
      console.error('The file does not contain enough data.');
      return;
    }
    const headerInfo = {};
    // Parse header information from the first lines (until an empty line)
    let lineIndex = 0;
    while (lines[lineIndex] && lines[lineIndex].trim() !== '') {
      const [key, value] = lines[lineIndex].split(',').map(item => item.trim());
      if (key && value) {
        headerInfo[key] = value;
      }
      lineIndex++;
    }

    // Use trim to remove any extra whitespace and parse the values
    const xMin = parseFloat(headerInfo.xMin);
    const xMax = parseFloat(headerInfo.xMax);
    const yMin = parseFloat(headerInfo.yMin);
    const yMax = parseFloat(headerInfo.yMax);
    const stepSize = parseInt(headerInfo.step);
    const noPoints = parseInt(headerInfo.noPoints);
    const version = parseInt(headerInfo.version);

    // Update your grid settings based on header info
    document.getElementById("grid-left").value = xMin;
    document.getElementById("grid-top").value = yMin;
    document.getElementById("grid-right").value = xMax;
    document.getElementById("grid-bottom").value = yMax;
    document.getElementById("step-size").value = stepSize;
    document.getElementById("no-points").value = noPoints;
    applyGridSettings();

    // Update the slider values displayed next to the sliders
    document.getElementById("grid-left-value").innerText = xMin;
    document.getElementById("grid-right-value").innerText = xMax;
    document.getElementById("grid-top-value").innerText = yMin;
    document.getElementById("grid-bottom-value").innerText = yMax;
    document.getElementById("step-size").innerText = stepSize;
    document.getElementById("no-points").innerText = noPoints;

    const labels = [];
    const notes = [];

    // Move to the start of data rows, skipping the blank line between headers and data
    lineIndex++;
    const dataHeaders = lines[lineIndex++]; // Skip over the point data headers

    // Parse CSV data rows for points
    for (let i = lineIndex; i < lines.length; i++) {
      const dataLine = lines[i].split(',');
      if (dataLine.length > 1) { // Ensure there's data
        const pointNumber = parseInt(dataLine[0]);
        const label = dataLine[5].replace(/"/g, ''); // Remove quotes
        const note = dataLine[6] ? dataLine[6].replace(/"/g, '') : ''; // Handle optional notes

        labels[pointNumber - 1] = label;
        notes[pointNumber - 1] = note;
      }
    }

    for (let value = 1; value <= noPoints; value++) {
      const overlay = viewer.getOverlayById(`pointLabel-${value - 1}`);
      if (overlay) {
        overlay.label = labels[value - 1] || '';
        overlay.notes = notes[value - 1] || '';
      }
    }
    populateDropdown();
    populateFilterDropdown();
  };

  reader.readAsText(file);
  hasUnsavedCounts = false;
});

// Function to count labels dynamically
function getLabelCounts(noPoints) {
  const labelCounts = {};
  let totalCount = 0;
  for (let value = 1; value <= noPoints; value++) {
    const overlayId = `pointLabel-${value - 1}`;
    const overlay = viewer.getOverlayById(overlayId);

    if (overlay) {
        const label = overlay.label || ''; // Ensure label is not undefined
        if (label) {
            labelCounts[label] = (labelCounts[label] || 0) + 1;
            totalCount++;
        }
    } else {
        console.log(`No overlay found with ID: ${overlayId}`); // Debug: Log missing overlays
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

  // Clear existing options
  filterDropdown.innerHTML = "";

  // Add checkboxes for each unique label
  uniqueLabels.forEach(label => {
    const isChecked = checkboxStates[label] !== undefined ? checkboxStates[label] : true;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = label;
    checkbox.id = `checkbox-${label}`;
    checkbox.checked = isChecked; // Default to checked
    
    // Update the state in the `checkboxStates` object when the checkbox changes
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

  checkboxes.forEach(checkbox => {
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
  const filteredCounts = Object.entries(labelCounts)
    .filter(([label]) => selectedLabels.includes(label));

  // Calculate total count for selected labels
  const filteredTotalCount = filteredCounts.reduce((sum, [, count]) => sum + count, 0);

  // Header with total count
  const results = [`N= ${filteredTotalCount}`];

  // Generate sorted results for selected labels
  filteredCounts.sort((a, b) => b[1] - a[1]) // Sort by count in descending order
    .forEach(([label, count]) => {
      const percentage = ((count / filteredTotalCount) * 100).toFixed(1);
      results.push(`${label}: ${count} (${percentage}%)`);
    });

  return results.join('<br>');
}

// Function to display summary results
function showResults() {
  const noPoints = parseInt(document.getElementById("no-points").value);
  //const noPoints = viewer.overlays.length; // Total number of overlays
  const resultsContent = document.getElementById("resultsContent");
  resultsContent.innerHTML = getResults(noPoints);
  document.getElementById("resultsModal").style.display = "block";
}

// Attach event listener to the filterButton
document.getElementById("filterButton").addEventListener("click", function () {
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
  if (!includeDropdown.contains(event.target) && event.target !== filterButton) {
    includeDropdown.style.display = "none";
  }
});

// Function to close the modal
function closeModal() {
  document.getElementById("resultsModal").style.display = "none";
}

// Function to get unique labels from the overlays
function getUniqueLabels() {
  const noPoints = parseInt(document.getElementById("no-points").value);
  const labels = new Set();

  for (let value = 1; value <= noPoints; value++) {
      const overlayId = `pointLabel-${value - 1}`;
      const overlay = viewer.getOverlayById(overlayId);
      if (overlay && overlay.label) {
          labels.add(overlay.label); // Add label to the Set (automatically ensures uniqueness)
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
  uniqueLabels.forEach(label => {
      const option = document.createElement("option");
      option.value = label;
      option.textContent = label;
      filterDropdown.appendChild(option);
  });
}

// // Function to filter overlays based on selected label
function filterOverlays() {
  const filterDropdown = document.getElementById("filterDropdown");
  const selectedLabel = filterDropdown.value;

  const noPoints = parseInt(document.getElementById("no-points").value);
  for (let value = 1; value <= noPoints; value++) {
    const overlayId = `pointLabel-${value - 1}`;
    const overlay = viewer.getOverlayById(overlayId);
    const crosshairId = `crosshair-${value - 1}`;
    const overlayCrosshair = viewer.getOverlayById(crosshairId);

    if (overlay) {
      // Manage visibility by changing the opacity of the overlay element
      if (selectedLabel === "all" || overlay.label === selectedLabel) {
          overlay.element.style.visibility = "visible"; // Make overlay visible
          overlayCrosshair.element.style.visibility = "visible"; // Make overlay visible
      } else {
          overlay.element.style.visibility = "hidden"; // Hide overlay
          overlayCrosshair.element.style.visibility = "hidden"; // Hide overlay
      }
    }
  }
}

// Ensure overlays respect the filter on each viewport update (for panning, zooming, etc.)
function enforceOverlayVisibility() {
  const noPoints = parseInt(document.getElementById("no-points").value);

  for (let value = 1; value <= noPoints; value++) {
      const overlayId = `pointLabel-${value - 1}`;
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
      hex = "#" + Array.from(hex.slice(1)).map(x => x + x).join('');
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

let firstViewerElementPoint;
let firstViewportPoint;
let secondViewerElementPoint;
let secondViewportPoint;
const x0 = document.getElementById('x0');
const y0 = document.getElementById('y0');
const x1 = document.getElementById('x1');
const y1 = document.getElementById('y1');
const distanceElement = document.getElementById('distance');
const measurementButton = document.getElementById("toggleMeasurementButton");
const showMeasurementsButton = document.getElementById("show-measurements");

viewer.addHandler('canvas-click', function(event) {
  console.log('click',measurementCounter);
  if (measurmentModeActive & measurementCounter < 2) {
    const image = viewer.world.getItemAt(0);
    //const imagePoint = handleMeasurementClick(event);
    const viewportPoint = viewer.viewport.pointFromPixel(event.position);
    const imagePoint = image.viewportToImageCoordinates(viewportPoint.x, viewportPoint.y); 
    const viewerElementPoint = event.position;
    if (measurementCounter === 0) {
      clearLine();
      // disablePanning(); // Disable panning while measuring
      event.preventDefaultAction = true; // Prevent default behavior (like panning)

      x0.textContent = imagePoint.x.toFixed(0);
      y0.textContent = imagePoint.y.toFixed(0);
      const firstCrosshair = document.getElementById(`measure-crosshair-0`);
      const secondCrosshair = document.getElementById(`measure-crosshair-1`);
      firstViewportPoint = viewportPoint;
      firstViewerElementPoint = event.position;
      if (firstCrosshair) {
        viewer.removeOverlay(firstCrosshair); // Remove the overlay using the element
        viewer.removeOverlay(secondCrosshair); // Remove the overlay using the element
      }
      addMeasurementCrosshairs(measurementCounter, viewportPoint);
      measurementCounter++;
    } else if (measurementCounter === 1) {
      // Reference the canvas

      x1.textContent = imagePoint.x.toFixed(0);
      y1.textContent = imagePoint.y.toFixed(0);
      addMeasurementCrosshairs(measurementCounter, viewportPoint);
      const viewportPt1 = image.imageToViewportCoordinates(x0.textContent, y0.textContent);
      const viewportPt2 = image.imageToViewportCoordinates(x1.textContent, y1.textContent);
      secondViewportPoint = viewportPoint;
      secondViewerElementPoint = event.position;
      drawLine(firstViewerElementPoint, secondViewerElementPoint);
      // drawLine(viewportPt1.x, viewportPt1.y, viewportPt2.x, viewportPt2.y);
      measurementCounter++;
      const distance = Math.sqrt((x1.textContent - x0.textContent) ** 2 + (y1.textContent - y0.textContent) ** 2);
      const distanceInMicrons = distance*1/pixelsPerMeters[currentIndex]*1000000; // Microns
      distanceElement.value = distanceInMicrons.toFixed(2);
      measurementCounter = 0;
      // enablePanning(); // Re-enable panning after measuring
    } else {
      measurementCounter = 0;
    }
  }
});

// Disable panning by intercepting mouse events
function disablePanning() {
  viewer.setMouseNavEnabled(false); // Disable OpenSeadragon panning
}

// Re-enable panning by resetting mouse navigation
function enablePanning() {
  viewer.setMouseNavEnabled(true); // Re-enable OpenSeadragon panning
}

let measurmentModeActive = false;
let measurementCounter = 0;
function toggleMeasurementMode() {
  const isMeasuring = measurementButton.classList.contains("active");

  // Toggle the active state of the button
  measurementButton.classList.toggle("active");

  if (isMeasuring) {
    // Disable measurement mode
    measurementButton.textContent = 'Start';
    measurmentModeActive = false;
    console.log('Measurement mode disabled');
  } else {
    // Enable measurement mode
    measurementButton.textContent = 'Stop';
    measurmentModeActive = true;
    console.log('Measurement mode enabled');
  }
}

// Function to handle measurement clicks
function handleMeasurementClick(event) {
  const image = viewer.world.getItemAt(0); // Assuming one image in the viewer
  const viewportPoint = viewer.viewport.pointFromPixel(event.position); // Viewport coordinates
  const imagePoint = image.viewportToImageCoordinates(viewportPoint); // Image coordinates

  // Check if event.position exists
  if (!event.position) {
    console.error("event.position is undefined");
    return;
  }

  return imagePoint;
}

function addMeasurementCrosshairs(i, location, color='red', lineWeight = 2, opacity = 1) {
  console.log('adding measurement crosshairs');
  const crosshairsMeasurement = document.createElement("div");
  crosshairsMeasurement.className = "measure-symbol"; // Used for css styling
  crosshairsMeasurement.id = `measure-crosshair-${i}`;

  // Apply inline styles for customization
  crosshairsMeasurement.style.setProperty("--crosshair-color", color);
  crosshairsMeasurement.style.setProperty("--crosshair-line-weight", `${Number(lineWeight)}px`);
  crosshairsMeasurement.style.setProperty("--crosshair-opacity", Number(opacity));

  const overlay = viewer.addOverlay({
    element: crosshairsMeasurement,
    location: location,
    checkResize: false,
  });
}

const lineCanvas = document.getElementById('measurement-overlay');
const lineContext = lineCanvas.getContext('2d');

function resizeCanvasToViewport() {
  const viewportWidth = viewer.viewport.containerSize.x;
  const viewportHeight = viewer.viewport.containerSize.y;
  lineCanvas.width = viewportWidth;
  lineCanvas.height = viewportHeight;
  if (firstViewerElementPoint && secondViewerElementPoint) {
    const firstViewerElementPointUpdated = viewer.viewport.viewportToViewerElementCoordinates(firstViewportPoint);
    const secondViewerElementPointUpdated = viewer.viewport.viewportToViewerElementCoordinates(secondViewportPoint);
    drawLine(firstViewerElementPointUpdated, secondViewerElementPointUpdated);
  }

  // TODO: Allow multiple lines to be rescaled
  // const crosshairDivs = document.querySelectorAll('div[id^="measure-crosshair-"]');
  // crosshairDivs.forEach((div, index) => {
  //   console.log(`Div ${index}:`, div); // Log or interact with each div
}

// Wait until the viewer is fully loaded (the open event)
viewer.addHandler("open", function () {
  // Resize canvas after the viewer has loaded
  resizeCanvasToViewport();
});

// Update size on window resize
window.addEventListener("resize", resizeCanvasToViewport);

// Draw the line between the two points
function drawLine(startPoint, endPoint) {
  if (startPoint && endPoint) {
    // points are in viewer element coordinates
    lineContext.clearRect(0, 0, lineCanvas.width, lineCanvas.height);
    // Draw the line
    lineContext.beginPath();
    lineContext.moveTo(startPoint.x, startPoint.y);
    lineContext.lineTo(endPoint.x, endPoint.y);
    lineContext.strokeStyle = 'red';
    lineContext.lineWidth = 2;
    lineContext.stroke();
  }
}

function clearLine() {
  lineContext.clearRect(0, 0, lineCanvas.width, lineCanvas.height);
}

// Adjust canvas transformations for pan and zoom
function adjustCanvasTransform() {
  const zoomLevel = viewer.viewport.getZoom();
  const pan = viewer.viewport.getCenter();

  // Clear the canvas before applying transformations
  lineContext.clearRect(0, 0, lineCanvas.width, lineCanvas.height);

  // Apply zoom and pan transformations to the canvas context
  lineContext.setTransform(zoomLevel, 0, 0, zoomLevel, pan.x * lineCanvas.width, pan.y * lineCanvas.height);
  
  // Redraw the existing line with the new transform applied
  drawLine(firstViewerElementPoint, secondViewerElementPoint);
}

// Update the line when the viewport changes
viewer.addHandler('viewport-change', drawLine(firstViewerElementPoint, secondViewerElementPoint));
viewer.addHandler('resize', () => {
  resizeCanvasToViewport();
  drawLine(firstViewerElementPoint, secondViewerElementPoint);
});

// Listen to zoom and pan events to update the line's position
viewer.addHandler("animation", function () {
  resizeCanvasToViewport();
  // adjustCanvasTransform();
});

// Import, add, and export points with labels
const toggleMeasurementVisibility = (event) => {
  for (let el of document.getElementsByClassName("measure-symbol")) {
    el.style.visibility = event.checked ? "visible" : "hidden";
  }
  if (lineCanvas) {
    lineCanvas.style.visibility = event.checked ? "visible" : "hidden";
  }
};

function resetMeasurements() {
  // Clear the line canvas (if it exists)
  if (lineContext) {
    console.log('clearing canvas');
    lineCanvas.width = lineCanvas.width; // Reset width, this will clear the canvas
    lineCanvas.height = lineCanvas.height; // Reset height, this will clear the canvas
  }
  // Clear the crosshairs
  const elements = Array.from(document.getElementsByClassName("measure-symbol"));
  for (let el of elements) {
    viewer.removeOverlay(el); // Remove the overlay using the element
  }
  // Reset other items
  if (measurementButton.classList.contains("active")) {
    toggleMeasurementMode();
  }
  measurementCounter = 0;
  showMeasurementsButton.checked = true;
  x0.textContent = '';
  x1.textContent = '';
  y0.textContent = '';
  y1.textContent = '';
  distanceElement.value = '0';
  firstViewerElementPoint = '';
  secondViewerElementPoint = '';
}