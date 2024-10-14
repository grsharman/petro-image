"use strict";

const viewer = OpenSeadragon({
  maxZoomPixelRatio: 100,
  id: "viewer-container",
  prefixUrl: "js/images/",
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

// GRS note: The code unchecks the box, but the action does not occur

// Keyboard shortcut handler to toggle checkboxes
const toggleCheckbox = (id) => {
  const checkbox = document.getElementById(id);
  //checkbox.checked = !checkbox.checked;
  checkbox.click();  // Trigger the onclick handler for each checkbox
  //checkbox.dispatchEvent(new Event('change'));
};

// Add keyboard event listener
document.addEventListener("keydown", (event) => {
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
});

const Grid = class {
  constructor({ unit, pixelsPerUnit, xMin, yMin, xMax, yMax, rows, cols }) {
    this.unit = unit;
    this.pixelsPerUnit = pixelsPerUnit;
    this.xMin = xMin;
    this.yMin = yMin;
    this.xMax = xMax;
    this.yMax = yMax;
    this.rows = rows;
    this.cols = cols;
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
  unit: 1,
  pixelsPerUnit: 100,
  xMin: 1,
  yMin: 3,
  xMax: 48,
  yMax: 28,
  rows: 10,
  cols: 10,
});
let gridApplied = false;

const enableGridButtons = () => {
  document.getElementById("apply-grid-settings").disabled = false;
  document.getElementById("restore-grid-settings").disabled = false;
};

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
    rows: parseInt(document.getElementById("row-count").value),
    cols: parseInt(document.getElementById("col-count").value),
  });

  for (let row = 0; row < grid.rows; ++row) {
    for (let col = 0; col < grid.cols; ++col) {
      // Alternate column order per row.
      const altCol = row % 2 == 0 ? col : grid.cols - col - 1;

      // Get the coordinates in the specified unit.
      const xUnits =
        grid.xMin + (altCol * (grid.xMax - grid.xMin)) / (grid.cols - 1);
      const yUnits =
        grid.yMin + (row * (grid.yMax - grid.yMin)) / (grid.rows - 1);

      // Convert to coordinates in pixels.
      const xPixels = xUnits * grid.metersPerUnit * grid.pixelsPerMeter;
      const yPixels = yUnits * grid.metersPerUnit * grid.pixelsPerMeter;

      // Convert to view-space coordinates, measuring from the top-left of the
      // first image.
      const location = image.imageToViewportCoordinates(xPixels, yPixels);

      // Add point label with coordinates.
      const pointLabel = document.createElement("div");
      pointLabel.innerHTML = `${1 + col + row * grid.cols}`;
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
  document.getElementById("row-count").value = grid.rows;
  document.getElementById("col-count").value = grid.cols;

  // Leave the Apply button enabled unless the grid has been generated at least
  // once.
  if (gridApplied) {
    document.getElementById("apply-grid-settings").disabled = true;
  }
  document.getElementById("restore-grid-settings").disabled = true;
};

// Initialize grid setting elements.
restoreGridSettings();
