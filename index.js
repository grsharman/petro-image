"use strict";

const viewer = OpenSeadragon({
  maxZoomPixelRatio: 100,
  id: "viewer-container",
  prefixUrl: "js/images/",
  zoomPerClick: 1, // Disable zoom on click (or shift+click)
  tileSources: [
    "https://raw.githubusercontent.com/grsharman/petro-image/main/images/NZ23-069 test1 2.5x XPL00 final.dzi",
    "https://raw.githubusercontent.com/grsharman/petro-image/main/images/NZ23-069 test1 2.5x XPL45 final.dzi",
    "https://raw.githubusercontent.com/grsharman/petro-image/main/images/NZ23-069 test1 2.5x PPL45 final.dzi",
  ],
});

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


// const minSlider = document.getElementById("grid-left");
// const maxSlider = document.getElementById("grid-right");

// minSlider.addEventListener("input", function() {
//   if (parseInt(minSlider.value) > parseInt(maxSlider.value)) {
//     maxSlider.value = minSlider.value;
//   }
// });

// maxSlider.addEventListener("input", function() {
//   if (parseInt(maxSlider.value) < parseInt(minSlider.value)) {
//     minSlider.value = maxSlider.value;
//   }
// });

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

let annotations = [];
// Event listener to add point annotations for shift + click
viewer.addHandler('canvas-click', function(event) {
  let originalEvent = event.originalEvent;  // Get the original mouse event

  // Check if Shift is being held
  if (originalEvent.shiftKey) {
      let viewportPoint = viewer.viewport.pointFromPixel(event.position);  // Get viewport coordinates
      let imagePoint = viewer.viewport.viewportToImageCoordinates(viewportPoint.x, viewportPoint.y); // Get image coordinates
      let annotation = {
          x: imagePoint.x,
          y: imagePoint.y,
          w: 0,
          h: 0,
          type: 'pt',
          label: prompt("Enter a label for this point:"),  // Prompt for a label
      };

      // Make text and crosshairs
      addText(annotation.label, viewportPoint);
      addCrosshairs(viewportPoint);

      // Store annotation
      annotations.push(annotation);
  }
});

// GRS note: Ctrl+click and drag may not work in the browser
// due to conflicting options (brings up a menu?)
// Event listener to add square annotations for ctrl + drag
var startPoint = null;
var overlayElement = null;
viewer.addHandler('canvas-drag', function(event) {
  if (event.originalEvent.ctrlKey) {
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
  if (event.originalEvent.ctrlKey && startPoint) {
      // Capture the final rectangle's coordinates and size
      var endPoint = viewer.viewport.pointFromPixel(event.position);
      var imageStartPoint = viewer.viewport.viewportToImageCoordinates(startPoint.x, startPoint.y); // Get image coordinates
      var imageEndPoint = viewer.viewport.viewportToImageCoordinates(endPoint.x, endPoint.y);
      var width = imageEndPoint.x - imageStartPoint.x;
      var height = imageEndPoint.y - imageStartPoint.y;
      // var width = endPoint.x - startPoint.x;
      // var height = endPoint.y - startPoint.y;

      // Normalize the coordinates so the top-left is always the starting point
      var x = Math.min(imageStartPoint.x, imageStartPoint.x + width);
      var y = Math.min(imageStartPoint.y, imageStartPoint.y + height);
      var finalPoint = viewer.viewport.imageToViewportCoordinates(x, y);
      // var x = Math.min(startPoint.x, startPoint.x + width);
      // var y = Math.min(startPoint.y, startPoint.y + height);
      //var imageXY = viewer.viewport.viewportToImageCoordinates(x, y);
      var finalWidth = Math.abs(width);
      var finalHeight = Math.abs(height);
      // Mouse up - finalize and reset for the next rectangle
      startPoint = null;
      overlayElement = null;
      // var imageEndPoint = viewer.viewport.viewportToImageCoordinates(viewportPoint.x, viewportPoint.y); // Get image coordinates
      // var imageWidth = imageEndPoint.x - startPoint.x;
      // var imageHeight = imageEndPoint.y - startPoint.y;

      let annotation = {
        x: x,
        y: y,
        w: finalWidth,
        h: finalHeight,
        type: 'rect',
        label: prompt("Enter a label for this rectangle:"),  // Prompt for a label
      };

      // Add the label
      addText(annotation.label, finalPoint);

      // Store annotation
      annotations.push(annotation);
  }
});

// For storing annotation overlays so they can be cleared later
// GRS note: clearing annotations DOES NOT currently work
let annotationTextOverlays = [];
let annotationOverlays = [];

// Functions to add annotation test and crosshairs
function addText(label, location) {
  const pointLabel = document.createElement("div");
  pointLabel.innerHTML = `${label}`;
  pointLabel.className = "annotate-label";
  annotationTextOverlays.push(viewer.addOverlay({
          element: pointLabel,
          location: location,
          checkResize: false,
      })
    );
}
function addCrosshairs(location) {
    const crosshairsAnnotate = document.createElement("div");
    crosshairsAnnotate.className = "annotate-symbol";  
    const overlay = viewer.addOverlay({
      element: crosshairsAnnotate,
      location: location,
      checkResize: false,
  });
  annotationOverlays.push(overlay)
}

// GRS note: Currently only works with points (not rectangles)
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
              const label = row.label;
              if (!isNaN(x) && !isNaN(y)) {
                  const image = viewer.world.getItemAt(0);
                  const viewportPoint = image.imageToViewportCoordinates(new OpenSeadragon.Point(x, y));
                  let annotation = {
                    x: x,
                    y: y,
                    w: 0,
                    h: 0,
                    type: 'pt',
                    label: label,  // Prompt for a label
                  };
                  // Add the point
                  addText(label, viewportPoint);
                  addCrosshairs(viewportPoint);
                  // Store annotation
                  annotations.push(annotation);
              }
          });
          alert('Annotations loaded successfully.');
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
});

// GRS note: DOES NOT currently work
function clearOverlaySet(set) {
  set.forEach(overlay => {
    viewer.removeOverlay(overlay);
  });
  // Optionally, empty the set after clearing
  set.length = 0;
}

// GRS note: Would be nice to add ability to clear annotations
// document.getElementById('clearBtn').addEventListener('click', function () {
//   clearOverlaySet(annotationOverlays);
//   clearOverlaySet(annotationTextOverlays);
//   let annotations = [];
// });

viewerContainer.addEventListener("pointermove", (event) => {
  mousePos = new OpenSeadragon.Point(event.clientX, event.clientY);
  divideImages();
});

// Initialize the scalebar, except for pixelsPerMeter, which depends on the grid
// settings.
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
});

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
  unit: 2,
  pixelsPerUnit: 0.37,
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

// GRS note: Applying grid settings also clears any annotation overlays
// Would be better to not have this happen.
const applyGridSettings = () => {
  viewer.clearOverlays();

  const image = viewer.world.getItemAt(0);
  grid = new Grid({
    unit: document.getElementById("unit").selectedIndex,
    pixelsPerUnit: parseFloat(document.getElementById("pixels-per-unit").value),
    xMin: parseFloat(document.getElementById("grid-left").value),
    yMin: parseFloat(document.getElementById("grid-top").value),
    xMax: parseFloat(document.getElementById("grid-right").value),
    yMax: parseFloat(document.getElementById("grid-bottom").value),
    step: parseInt(document.getElementById("step-size").value),
    noPoints: parseInt(document.getElementById("no-points").value),
  });

  // GRS note: eventually use variables instead of hard-coding pixel dimensions
  const x_min_um = grid.xMin/100*17736/grid.pixelsPerUnit;
  const x_max_um = grid.xMax/100*17736/grid.pixelsPerUnit;
  const y_min_um = grid.yMin/100*10221/grid.pixelsPerUnit;
  const y_max_um = grid.yMax/100*10221/grid.pixelsPerUnit;

  // Get the coordinates and labels for point counts
  let [X, Y, A]  = makePoints(x_min_um, x_max_um, y_min_um, y_max_um, grid.step, grid.noPoints);

  for (let i = 0; i < X.length; i++) {
    // Get the coordinates in the specified unit.
    const xUnits = X[i];
    const yUnits = Y[i];

    // Convert to coordinates in pixels.
    const xPixels = xUnits * grid.metersPerUnit * grid.pixelsPerMeter;
    const yPixels = yUnits * grid.metersPerUnit * grid.pixelsPerMeter;

    // Convert to view-space coordinates, measuring from the top-left of the
    // first image.
    const location = image.imageToViewportCoordinates(xPixels, yPixels);

    // Add point label with coordinates.
    const pointLabel = document.createElement("div");
    pointLabel.innerHTML = `${A[i]}`;
    pointLabel.className = "grid point-label";
    viewer.addOverlay({
      element: pointLabel,
      location: location,
      checkResize: false,
    });

    // Add crosshairs.
    const crosshairs = document.createElement("div");
    crosshairs.className = "grid crosshairs";
    viewer.addOverlay({
      element: crosshairs,
      location: location,
      checkResize: false,
    });
  }

  // Update scalebar scale.
  viewer.scalebar({ pixelsPerMeter: grid.pixelsPerMeter });

  // Always show the grid right after generating it. (The newly added overlay
  // elements will be visible by default, so checking the box here doesn't
  // actually affect them - it just makes the checkbox state consistent with the
  // visibility states.)
  document.getElementById("show-grid").checked = true;

  document.getElementById("apply-grid-settings").disabled = true;
  document.getElementById("restore-grid-settings").disabled = true;
  gridApplied = true;
};

const restoreGridSettings = () => {
  document.getElementById("unit").selectedIndex = grid.unit;
  document.getElementById("pixels-per-unit").value = grid.pixelsPerUnit;
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