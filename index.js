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

// GRS note: Old code. Replaced by code that allows a sample to be specified in the URL
//     /// Automatically select the first group and populate the sample dropdown
//     const firstGroup = Object.keys(groupMapping)[0];
//     //populateGroupDropdown(firstGroup);
//     if (firstGroup) {
//       document.getElementById('groupDropdown').value = firstGroup;
//       populateSampleDropdown(firstGroup);
//     }
//   })
//   .catch(error => {
//     console.error('Error loading the JSON file:', error);
//   });
  
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
      sampleDropdown.selectedIndex = 0; // Select the first option
      sampleDropdown.dispatchEvent(new Event('change')); // Trigger the change event
    }
  }
}

let sampleName = '';

/// Event listener for sample selection change (only add once)
document.getElementById('sampleDropdown').addEventListener('change', function() {
  const selectedIndex = this.value;
  sampleName = this.options[this.selectedIndex].textContent; // Get the sample name as a string
  loadTileSet(selectedIndex);
  clearAnnotations();
  annotations = [];
  updateButtonLabels(selectedIndex);
  addScalebar(pixelsPerMeters[selectedIndex]);
  clearGridOverlayPoints();
  clearGridOverlayCrosshairs();
  enableGridButtons();
  removeAoiRectangle();

  // Check if the selected sample has annotations
  let file = annotation_files[sampleName];
  const annotationCheckbox = document.getElementById('show-annotations'); // replace with your actual checkbox ID

  if (file) {
    // Use fetch to get the file from the URL
    fetch(file)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
      })
      .then(csvData => {
        loadAnnotations(csvData);  // Pass the fetched data to the loadAnnotations function
        // Uncheck the annotation checkbox and update visibility
        annotationCheckbox.checked = false;
        toggleAnnotation(annotationCheckbox);      
      })
      .catch(error => {
        console.error('Error loading file:', error);
      });
  }
  toggleAnnotation(); // Turn annotations off by default if loaded upon import
  hasUnsavedAnnotations = false; // No unsaved annotations upon first load
});

// Function to update the button labels based on tileLabels array
function updateButtonLabels(index) {
  //("tileLabels for index", index, ":", tileLabels[index]);
  document.querySelector("label[for='image1']").textContent = tileLabels[index][0] || "XPL1";
  document.querySelector("label[for='image2']").textContent= tileLabels[index][1] || "XPL2";
  document.querySelector("label[for='image3']").textContent = tileLabels[index][2] || "PPL";
  // Default is to be checked upon image change
  document.getElementById("image1").checked = true;
  document.getElementById("image2").checked = true;
  document.getElementById("image3").checked = true;
}

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

      // GRS note: button placement is somewhat ad hoc

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

// Initialize the OpenSeadragon viewer
const viewer = OpenSeadragon({
  maxZoomPixelRatio: 100,
  id: "viewer-container",
  prefixUrl: "js/images/",
  zoomPerClick: 1, // Disable zoom on click (or shift+click)
  sequenceMode: false,
  tileSources: tileSets[0], // Load first tile set upon load
});

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
};

const toggleImage = (checkbox, idx) => {
  viewer.world.getItemAt(idx).setOpacity(checkbox.checked ? 1 : 0);
  divideImages();
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

///////////////////////////////
// Annotations functionality //
///////////////////////////////

// Import, add, and export points with labels
const toggleAnnotation = (event) => {
  for (let el of document.getElementsByClassName("annotate-symbol")) {
    el.style.visibility = event.checked ? "visible" : "hidden";
  }
  for (let el of document.getElementsByClassName("annotate-label")) {
    el.style.visibility = event.checked ? "visible" : "hidden";
  }
  for (let el of document.getElementsByClassName("rectangle-label")) {
    el.style.visibility = event.checked ? "visible" : "hidden";
  }
  for (let el of document.getElementsByClassName("annotate-rectangle")) {
    el.style.visibility = event.checked ? "visible" : "hidden";
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
let currentAnnotationId = 0; // Initialize a counter for annotation IDs

viewer.addHandler('canvas-click', function(event) {
  console.log('canvas clicked');
  let originalEvent = event.originalEvent;
  if (isQPressed) {
    console.log('canvs & Q clicked');
    let viewportPoint = viewer.viewport.pointFromPixel(event.position);  // Get viewport coordinates
    let imagePoint = viewer.viewport.viewportToImageCoordinates(viewportPoint.x, viewportPoint.y); // Get image coordinates
    let annotation = {
        x: imagePoint.x,
        y: imagePoint.y,
        w: 0,
        h: 0,
        type: 0, // 0 for point
        label: prompt("Enter a label for this point:"),  // Prompt for a label
    }
    // Make text and crosshairs
    addText(currentAnnotationId, annotation.label, viewportPoint);
    addCrosshairs(currentAnnotationId, viewportPoint);
    // Store annotation
    annotations.push(annotation);
    isQPressed = false; // Reset
  }
});

// Event listener to add square annotations for shift + drag
var startPoint = null;
var overlayElement = null;
viewer.addHandler('canvas-drag', function(event) {
  //if (isQPressed) {
  if (event.originalEvent.shiftKey) {
      event.preventDefaultAction = true; // Prevent default behavior (like panning)

      var viewportPoint = viewer.viewport.pointFromPixel(event.position);

      if (!startPoint) {
          // Mouse down - initialize start point and overlay
          startPoint = viewportPoint;

          // Create an HTML element for the overlay
          overlayElement = document.createElement('div');
          overlayElement.style.border = '2px solid green';
          overlayElement.className = "annotate-rectangle";
          //overlayElement.style.background = 'rgba(255, 0, 0, 0.2)'; // Add semi-transparent background
          overlayElement.style.pointerEvents = 'none'; // Prevent interaction
          overlayElement.id = `annotate-rect-${currentAnnotationId}`;

          viewer.addOverlay({
              element: overlayElement,
              location: new OpenSeadragon.Rect(startPoint.x, startPoint.y, 0, 0)
          });
      } else {
          // Mouse move - update overlay dimensions
          var width = viewportPoint.x - startPoint.x;
          var height = viewportPoint.y - startPoint.y;
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
  if (event.originalEvent.shiftKey && startPoint) {
      // Capture the final rectangle's coordinates and size
      var endPoint = viewer.viewport.pointFromPixel(event.position);
      var imageStartPoint = viewer.viewport.viewportToImageCoordinates(startPoint.x, startPoint.y); // Get image coordinates
      var imageEndPoint = viewer.viewport.viewportToImageCoordinates(endPoint.x, endPoint.y);
      var width = imageEndPoint.x - imageStartPoint.x;
      var height = imageEndPoint.y - imageStartPoint.y;

      // Normalize the coordinates so the top-left is always the starting point
      var x = Math.min(imageStartPoint.x, imageStartPoint.x + width);
      var y = Math.min(imageStartPoint.y, imageStartPoint.y + height);
      var finalPoint = viewer.viewport.imageToViewportCoordinates(x, y);
      var finalWidth = Math.abs(width);
      var finalHeight = Math.abs(height);

      // Record the rectangle
      annotateRectangles.push(overlayElement);

      // Mouse up - finalize and reset for the next rectangle
      startPoint = null;
      overlayElement = null;

      let annotation = {
        x: x,
        y: y,
        w: finalWidth,
        h: finalHeight,
        type: 1, // 1 for rectangle
        label: prompt("Enter a label for this rectangle:"),  // Prompt for a label
      };

      // Add the label
      addText(currentAnnotationId, annotation.label, finalPoint);
      currentAnnotationId = currentAnnotationId+1;

      // Store annotation
      annotations.push(annotation);
  }
});

// Clear annotations & grid
document.getElementById('clearBtn').addEventListener('click', function () {
  console.log('Clear clicked');
  clearAnnotations();
  annotations = [];
});

// Functions to add annotation test and crosshairs
function addText(i, label, location) {
  const pointLabel = document.createElement("div");
  pointLabel.innerHTML = `${label}`;
  pointLabel.className = "annotate-label";
  pointLabel.id = `annotate-label-${i}`;
  const overlay = viewer.addOverlay({
          element: pointLabel,
          location: location,
          checkResize: false,
      });
  annotateLabels.push(pointLabel);
  hasUnsavedAnnotations = true;
}

function addCrosshairs(i, location) {
    const crosshairsAnnotate = document.createElement("div");
    crosshairsAnnotate.className = "annotate-symbol";  
    crosshairsAnnotate.id = `annotate-crosshair-${i}`;
    const overlay = viewer.addOverlay({
      element: crosshairsAnnotate,
      location: location,
      checkResize: false,
  });
  annotatePoints.push(crosshairsAnnotate);
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
}

function loadAnnotations(csvData) {
  Papa.parse(csvData, {
      header: true, // Assuming your CSV has headers
      skipEmptyLines: true,
      complete: function (results) {
          // Assuming the CSV format is: x,y,label
          results.data.forEach((row) => {
              // x and y are both in pixels
              const x = parseFloat(row.x);
              const y = parseFloat(row.y);
              const w = parseFloat(row.w);
              const h = parseFloat(row.h);
              const type = parseInt(row.type);
              const label = row.label;
              if (!isNaN(x) && !isNaN(y)) {
                const image = viewer.world.getItemAt(0);
                if (type === 0) { // Point
                  const viewportPoint = viewer.viewport.imageToViewportCoordinates(new OpenSeadragon.Point(x, y));
                  let annotation = {
                    x: x,
                    y: y,
                    w: 0,
                    h: 0,
                    type: type,
                    label: label,  // Prompt for a label
                  };
                  // Add the point
                  addText(currentAnnotationId, label, viewportPoint);
                  addCrosshairs(currentAnnotationId, viewportPoint);
                  currentAnnotationId = currentAnnotationId+1;
                  // Store annotation
                  annotations.push(annotation);
                }
                if (type === 1) { // Rectangle
                  // X, Y image coordinates converted to viewport coordinates
                  const viewportRect = viewer.viewport.imageToViewportCoordinates(new OpenSeadragon.Point(x, y));
                  const imageSize = image.getContentSize();
                  // Height and width normalized by pixel dimensions
                  // GRS note: I'm surprised that both need to be normalized by x
                  const w_view = w/imageSize.x;
                  const h_view = h/imageSize.x;
                  let annotation ={
                    x: x,
                    y: y,
                    w: w,
                    h: h,
                    type: type,
                    label: label,
                  };
                  // Add the rectangle
                  addRectangle(currentAnnotationId, viewportRect.x, viewportRect.y, w_view, h_view);
                  // Add the point
                  addText(currentAnnotationId, label, viewportRect);
                  // Store annotation
                  annotations.push(annotation);
                  currentAnnotationId = currentAnnotationId+1;
                }
              }
          });
          // alert('Annotations loaded successfully.');
      },
      error: function (error) {
          console.error('Error loading annotations:', error);
          alert('Failed to load annotations from the CSV file.');
      }
  });
}

document.getElementById('loadAnnotationsBtn').addEventListener('click', function () {
  const fileInput = document.getElementById('csvFileInput');
  const file = fileInput.files[0];
  if (file) {
      const reader = new FileReader();
      reader.onload = function (event) {
          const csvData = event.target.result;
          loadAnnotations(csvData);
      };
      reader.readAsText(file);
  } else {
      alert('Please select a CSV file to load annotations.');
  }
});

// Attach export functionality to the button
document.getElementById('exportBtn').addEventListener('click', function () {
  var csv = Papa.unparse(annotations);
  let blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  saveAs(blob, "annotations.csv");
  hasUnsavedAnnotations = false;
});

const clearAnnotations = () => {
  annotateLabels.forEach((label) => {
    viewer.removeOverlay(label.id || label);
  });
  annotatePoints.forEach((label) => {
    viewer.removeOverlay(label.id || label);
  });
  annotateRectangles.forEach((label) => {
    viewer.removeOverlay(label.id || label);
  });
  annotateLabels = [];
  annotatePoints = [];
  annotateRectangles = [];
  hasUnsavedAnnotations = false;
};

viewerContainer.addEventListener("pointermove", (event) => {
  mousePos = new OpenSeadragon.Point(event.clientX, event.clientY);
  divideImages();
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

  get pixelsPerMeter() {
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

// GRS note: Currently adding more counts results in erasing the existing
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


// GRS note: IN PROGRESS. Developing an approach for loading pre-existing
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
  if (event.code === 'Space' && document.activeElement.id !== 'sample-notes') {
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

// GRS note: in progress. Currently not working. Feature implement paused
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
      const imagePoint = viewer.viewport.viewportToImageCoordinates(overlay.location.x, overlay.location.y);
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

document.getElementById('count-file-input').addEventListener('change', function(event) {
  const file = event.target.files[0];
  if (!file) return;
  console.log("File chosen:", file.name); // Optional: log the file name
});

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