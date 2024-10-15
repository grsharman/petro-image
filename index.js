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

// Get number of pixels in x and y dimensions
viewer.addHandler('open', function() {
  const tileSource = viewer.world.getItemAt(0).source;
  const n_x = tileSource.dimensions.x;
  const n_y = tileSource.dimensions.y;
});

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

  // GRS note: Need to know number of pixels in x and y dimensions of the image. How to get this?

  const x_min_um = grid.xMin/100*n_x/grid.pixelsPerUnit;
  const x_max_um = grid.xMax/100*n_x/grid.pixelsPerUnit;
  const y_min_um = grid.yMin/100*n_y/grid.pixelsPerUnit;
  const y_max_um = grid.yMax/100*n_y/grid.pixelsPerUnit;

  // GRS note: Trying to implement new algorithm for determing x and y coordinates of points

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

  // GRS note: Not able to get the AOI rectangle to show up

  // Add AOI rectangle
  // const aoi_rect = document.createElement("div");
  // aoi_rect.className = "rectangle"; // Assign the CSS class

  // // Set its size and position (relative to the image in image coordinates)
  // var aoi_bounds = new OpenSeaDragon.Rect(grid.xMin/100, grid.yMin/100, grid.xMax/100, grid.yMax/100);

  // viewer.addOverlay({
  //   element: aoi_rect,
  //   location: aoi_bounds,
  //   checkResize: false,
  // });

  //const xPixels = xUnits * grid.metersPerUnit * grid.pixelsPerMeter;
  //const yPixels = yUnits * grid.metersPerUnit * grid.pixelsPerMeter;

  //for (let row = 0; row < grid.rows; ++row) {
    //for (let col = 0; col < grid.cols; ++col) {
      // Alternate column order per row.
      //const altCol = row % 2 == 0 ? col : grid.cols - col - 1;

      // Get the coordinates in the specified unit.
      //const xUnits =
      //  grid.xMin + (altCol * (grid.xMax - grid.xMin)) / (grid.cols - 1);
      //const yUnits =
      //  grid.yMin + (row * (grid.yMax - grid.yMin)) / (grid.rows - 1);

      // Convert to coordinates in pixels.
      //const xPixels = xUnits * grid.metersPerUnit * grid.pixelsPerMeter;
      //const yPixels = yUnits * grid.metersPerUnit * grid.pixelsPerMeter;

      // Convert to view-space coordinates, measuring from the top-left of the
      // first image.
      //const location = image.imageToViewportCoordinates(xPixels, yPixels);

      // Add point label with coordinates.
      //const pointLabel = document.createElement("div");
      //pointLabel.innerHTML = `${1 + xPixels.length}`;
      // pointLabel.innerHTML = `${1 + col + row * grid.cols}`;
      //pointLabel.className = "grid point-label";
      //viewer.addOverlay({
      //  element: pointLabel,
      //  location: location,
      //  checkResize: false,
      //});

      // Add crosshairs.
      //const crosshairs = document.createElement("div");
      //crosshairs.className = "grid crosshairs";
      //viewer.addOverlay({
      //  element: crosshairs,
      //  location: location,
      //  checkResize: false,
      //});
    //}
  //}

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