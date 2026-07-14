"use strict";

function resizeImportWizardWindow() {
  if (!window.electronAPI?.resizeImportWizardToContent) return;

  const container = document.querySelector(".import-wizard-container");
  if (!container) return;

  window.electronAPI.resizeImportWizardToContent({
    width: container.offsetLeft + container.scrollWidth + 8,
    height: container.offsetTop + container.scrollHeight + 8,
  });
}

function initializeImportWizardAutoResize() {
  const container = document.querySelector(".import-wizard-container");
  if (!container || !window.ResizeObserver) {
    resizeImportWizardWindow();
    return;
  }

  let resizeFrame = null;
  const scheduleResize = () => {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(resizeImportWizardWindow);
  };
  const observer = new ResizeObserver(scheduleResize);

  observer.observe(container);
  scheduleResize();
}

// The import wizard now uses a resizable two-column layout. Continuous
// content-based resizing fights manual window resizing, so the Electron window
// owns sizing instead.

function addGroup(btn) {
  const container = document.getElementById("groupContainer");
  const rows = container.querySelectorAll(".group-row");
  const nextIndex = rows.length + 1;

  const row = document.createElement("div");
  row.className = "group-row";

  row.innerHTML = `
    <input
        type="text"
        class="group-input"
        placeholder="Group ${nextIndex}"
        oninput="validateGroupUniqueness()"
    />
    <button type="button" class="group-btn" onclick="addGroup(this)">+</button>
    <button type="button" class="group-btn" onclick="removeGroup(this)">&minus;</button>
    `;

  container.appendChild(row);
}

function removeGroup(btn) {
  const row = btn.closest(".group-row");
  row.remove();
  validateGroupUniqueness();
}

function validateGroupUniqueness() {
  const inputs = Array.from(document.querySelectorAll(".group-input"));

  // Normalize values: trim + lowercase
  const values = inputs.map((i) => i.value.trim().toLowerCase());

  // Count occurrences
  const counts = {};
  values.forEach((v) => {
    if (!v) return;
    counts[v] = (counts[v] || 0) + 1;
  });

  // Mark duplicates
  inputs.forEach((input, i) => {
    const v = values[i];
    if (v && counts[v] > 1) {
      input.classList.add("duplicate");
    } else {
      input.classList.remove("duplicate");
    }
  });

  // Return true if valid
  return !Object.values(counts).some((c) => c > 1);
}

function hasElectronImagePicker() {
  return Boolean(window.electronAPI?.selectImageFile);
}

function hasElectronDziConverter() {
  return Boolean(window.electronAPI?.convertImageToDzi);
}

function updateJpgLabel(row, text) {
  const labelText = row.querySelector(".jpg-label-text");
  if (labelText) {
    labelText.textContent = text;
  }
}

function setJpgRowConversionState(row, state, message) {
  row.dataset.dziState = state;
  row.title = message || "";
  updateJpgLabel(row, message || "Choose image");
}

function setImageRowUri(row, uri) {
  const uriInput = row.querySelector(".uri-input");
  if (uriInput) {
    uriInput.value = uri || "";
  }
  updateExportButtonLabel();
}

function displaySelectedImageFallback(fileInput) {
  const row = fileInput.closest(".image-row");
  const file = fileInput.files?.[0];

  if (!row || !file || hasElectronImagePicker()) return;

  const filePath = file.path || file.name || "";
  row.dataset.sourceImagePath = filePath;
  setImageRowUri(row, filePath);
  setJpgRowConversionState(row, "selected", file.name || "Image selected");
}

document.addEventListener("click", async (event) => {
  const label = event.target.closest(".jpg-label");

  if (!label || !hasElectronImagePicker()) return;

  event.preventDefault();
  event.stopPropagation();

  const row = label.closest(".image-row");
  if (!row) return;

  try {
    setJpgRowConversionState(row, "selecting", "Selecting...");
    const result = await window.electronAPI.selectImageFile();

    if (result?.canceled) {
      const priorPath = row.dataset.sourceImagePath;
      setJpgRowConversionState(
        row,
        priorPath ? "selected" : "idle",
        priorPath ? "Image selected" : "Choose image",
      );
      return;
    }

    const sourcePath = result.sourcePath || "";
    row.dataset.sourceImagePath = sourcePath;

    if (!sourcePath) {
      setImageRowUri(row, "");
      setJpgRowConversionState(row, "idle", "Choose image");
      return;
    }

    setImageRowUri(row, sourcePath);
    setJpgRowConversionState(row, "selected", "Image selected");
  } catch (error) {
    console.error(error);
    row.dataset.sourceImagePath = "";
    activeConversionProgress = null;
    setJpgRowConversionState(row, "error", "Selection failed");
    alert(error.message || "Could not select the image file.");
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches(".jpg-file")) {
    displaySelectedImageFallback(event.target);
  }
});

document.addEventListener("input", (event) => {
  if (event.target.matches(".uri-input")) {
    updateExportButtonLabel();
  }
});

/////////////////////////////////////////////////////
//// Functions for adding/removing tile set rows ////
/////////////////////////////////////////////////////

function addTileRow() {
  const container = document.getElementById("tileSetContainer");
  const row = document.createElement("div");
  row.className = "tile-set-row";

  row.innerHTML = `
    <div class="tile-row-header">
	  <!--Tile set label-->
      <div class="tile-row-title">
        <span class="tile-set-label"></span>
        <span class="required-field-label tile-set-required-label">required</span>
      </div>
      <div class="tile-row-actions">
        <button type="button" class="img-btn" onclick="addTileRow(this)">+</button>
	    <!--Will need to unhide minus button on 2nd+ tile sets-->
        <button type="button" class="img-btn remove-tile-btn" onclick="removeTileRow(this)" hidden>&minus;</button>
      </div>
    </div>

    <select onchange="updateTileSetType(this)" title="Specify the format for the tile set">
      <option value="Individual" selected>Individual</option>
      <option value="Multiple">Multiple</option>
      <option value="Multiple (rotation enabled)">Multiple (rotation enabled)</option>
    </select>

	<!-- Tile set label (shown for Individual & Rotation modes) -->
	<div class="tile-set-label-container">
        <input type="text" class="tile-set-label" placeholder="Tile set label" />
    </div>

	<!-- Angle periodicity input (shown only for rotation mode) -->
	<div class="angle-periodicity-container" style="display:none;">
		<label>Angle periodicity:
			<input type="number" class="tile-angle-periodicity" min="1" max="360" value="90"/>
		</label>
	</div>

    <!--Container for image(s) in this tile set-->
    <div class="images-container">
        <div class="image-row">
            <!--The image label for Multiple option-->
            <input type="text" class="image-label" placeholder="Image label" hidden />
            <!--The angle input for Multiple (rotation enabled) option-->
            <label hidden
              >Angle (0&minus;360):
              <input
                type="number"
                class="image-angle"
                min="0"
                max="360"
                value="0"
                hidden
              />
            </label>
            <!-- Buttons for image rows -->
            <button
              type="button"
              class="img-btn add-btn"
              onclick="addImageRowMultiple(this)"
              hidden
            >
              +
            </button>
            <button
              type="button"
              class="img-btn remove-btn"
              onclick="removeImageRow(this)"
              hidden
            >
              &minus;
            </button>

            <!-- Local image / URI inputs -->
            <div class="jpg-row">
                <label class="file-label jpg-label" style="--file-label-width: 104px">
                  <span class="jpg-label-text">Choose image</span>
                  <input type="file" class="file-input jpg-file" accept=".jpg,.jpeg,.png,.tif,.tiff,.webp,.gif,.avif,.heif,.heic,.svg,.v,.vips,.jp2,.j2k,.jpf,.jpx,.jpm,.mj2,image/*"/>
				</label>
                <input type="text" class="uri-input" placeholder="dzi/sample.dzi" />
            </div>
        </div>
    </div>
  `;

  container.appendChild(row);
  renumberTileSets();
}

function removeTileRow(btn) {
  const container = document.getElementById("tileSetContainer");
  if (container.children.length === 1) return; // keep at least one row
  btn.closest(".tile-set-row").remove();
  updateExportButtonLabel();
}

// Update the Tile Set N labels
function renumberTileSets() {
  const rows = document.querySelectorAll("#tileSetContainer .tile-set-row");
  rows.forEach((row, index) => {
    const label = row.querySelector(".tile-set-label");
    label.textContent = `Tile Set ${index + 1}`;

    // Toggle minus button visibility
    const minusBtn = row.querySelector(".remove-tile-btn");
    if (minusBtn) {
      minusBtn.hidden = index === 0; // hide on first tile set
    }

    const requiredLabel = row.querySelector(".tile-set-required-label");
    if (requiredLabel) {
      requiredLabel.hidden = index !== 0;
    }
  });
}

// Function for adding/removing image rows
function addImageRowMultiple(btn) {
  const container = btn.closest(".images-container"); // parent container for images
  const row = document.createElement("div");
  row.className = "image-row";

  row.innerHTML = `
    <input type="text" class="image-label" placeholder="Image label" />
    <button type="button" class="img-btn add-btn" onclick="addImageRowMultiple(this)">
        +
    </button>
    <button
        type="button"
        class="img-btn remove-btn"
        onclick="removeImageRow(this)"
    >
        &minus;
    </button>

    <div class="jpg-row">
      <label class="file-label jpg-label" style="--file-label-width: 104px">
        <span class="jpg-label-text">Choose image</span>
	    <input type="file" class="file-input jpg-file" accept=".jpg,.jpeg,.png,.tif,.tiff,.webp,.gif,.avif,.heif,.heic,.svg,.v,.vips,.jp2,.j2k,.jpf,.jpx,.jpm,.mj2,image/*" />
	  </label>
      
      <input type="text" class="uri-input" placeholder="dzi/sample.dzi" />
    </div>
  `;

  container.appendChild(row);

  // Hide minus button on first image row
  updateImageButtons(container);
}

function addImageRowRotation(btn) {
  const container = btn.closest(".images-container"); // parent container for images
  const row = document.createElement("div");
  row.className = "image-row";

  row.innerHTML = `
    <input
        type="number"
        class="image-angle"
        placeholder="e.g., 360"
        min="0"
        max="360"
        value="0"
    />
    <button type="button" class="img-btn add-btn" onclick="addImageRowRotation(this)">
        +
    </button>
    <button
        type="button"
        class="img-btn remove-btn"
        onclick="removeImageRow(this)"
    >
        &minus;
    </button>

    <div class="jpg-row">
      <label class="file-label jpg-label" style="--file-label-width: 104px">
        <span class="jpg-label-text">Choose image</span>
        <input type="file" class="file-input jpg-file" accept=".jpg,.jpeg,.png,.tif,.tiff,.webp,.gif,.avif,.heif,.heic,.svg,.v,.vips,.jp2,.j2k,.jpf,.jpx,.jpm,.mj2,image/*" />
	  </label>
      
      <input type="text" class="uri-input" placeholder="dzi/sample.dzi" />
    </div>
  `;

  container.appendChild(row);

  // Hide minus button on first image row
  updateImageButtons(container);
}

function removeImageRow(btn) {
  const container = btn.closest(".images-container");
  btn.closest(".image-row").remove();
  updateImageButtons(container);
  updateExportButtonLabel();
}

function updateImageButtonsOLD(container) {
  const rows = container.querySelectorAll(".image-row");
  rows.forEach((row, index) => {
    const minusBtn = row.querySelector("button:last-of-type"); // assume last button is minus
    if (index === 0) {
      minusBtn.style.display = "none"; // hide minus on first image
    } else {
      minusBtn.style.display = "inline-block";
    }
  });
}

// Hide minus button on first image row
function updateImageButtons(container) {
  const rows = container.querySelectorAll(".image-row");
  rows.forEach((row, index) => {
    const minusBtn = row.querySelector(".remove-btn");
    if (minusBtn)
      minusBtn.style.display = index === 0 ? "none" : "inline-block";
  });
}

// Update tile set type and dynamically adjust inputs
function updateTileSetType(selectElement) {
  const tileRow = selectElement.closest(".tile-set-row");
  const type = selectElement.value;

  const imagesContainer = tileRow.querySelector(".images-container");
  if (!imagesContainer) return;

  const anglePeriodicityContainer = tileRow.querySelector(
    ".angle-periodicity-container",
  );

  const tileSetLabelContainer = tileRow.querySelector(
    ".tile-set-label-container",
  );

  // Default: hide rotation-specific elements
  anglePeriodicityContainer.style.display = "none";
  //   tileSetLabelContainer.style.display = "inline-block";
  const existingRows = imagesContainer.querySelectorAll(".image-row");

  if (tileSetLabelContainer) {
    tileSetLabelContainer.style.display =
      type === "Multiple" ? "none" : "block";
  }

  if (type === "Individual") {
    // tileSetLabelContainer.style.display = "block"; // show tile set label
    anglePeriodicityContainer.style.display = "none";

    // Individual: only 1 image row, show tile set label, hide + / − buttons
    existingRows.forEach((row, idx) => {
      const addBtn = row.querySelector(".add-btn");
      const removeBtn = row.querySelector(".remove-btn");
      if (idx === 0) {
        addBtn.hidden = true;
        removeBtn.hidden = true;
      } else {
        row.remove();
      }
      const imgLabel = row.querySelector(".image-label");
      if (imgLabel) {
        imgLabel.hidden = true; // hide image label in individual mode
      }
      const angleLabel = row.querySelector("label");
      const imgAngle = row.querySelector(".image-angle");
      if (angleLabel) {
        angleLabel.hidden = true; // show angle label in individual mode
      }
      if (imgAngle) {
        console.log("hiding image angle");
        imgAngle.hidden = true; // show angle input in individual mode
      }
    });

    // // Hide image-label inputs when switching to Individual
    // const firstRow = imagesContainer.querySelector(".image-row");
    // if (firstRow) {
    //   const imgLabel = firstRow.querySelector(".image-label");
    //   console.log("hiding");
    //   if (imgLabel) {
    //     imgLabel.hidden = true;
    //   }
    // }
  } else if (type === "Multiple") {
    // tileSetLabelContainer.style.display = "none"; // hide tile set label in Multiple mode
    anglePeriodicityContainer.style.display = "none";

    // Ensure at least 2 rows
    if (existingRows.length < 2) {
      addImageRowTemplate(existingRows[0].querySelector(".add-btn"), "label");
    }

    existingRows.forEach((row) => {
      const addBtn = row.querySelector(".add-btn");
      const removeBtn = row.querySelector(".remove-btn");
      if (addBtn) addBtn.hidden = false;
      if (removeBtn) removeBtn.hidden = false;
      const imgLabel = row.querySelector(".image-label");
      if (imgLabel) {
        imgLabel.hidden = false; // hide image label in rotation mode
      }
      const angleLabel = row.querySelector("label");
      const imgAngle = row.querySelector(".image-angle");
      if (angleLabel) {
        angleLabel.hidden = true; // show angle label in rotation mode
      }
      if (imgAngle) {
        console.log("hiding image angle");
        imgAngle.hidden = true; // show angle input in rotation mode
      }
    });
    // Makes sure the add image buttons add angle rows
    imagesContainer.querySelectorAll(".add-btn").forEach((btn) => {
      btn.onclick = () => addImageRowTemplate(btn, "label");
    });

    // const firstRow = imagesContainer.querySelector(".image-row");
    // if (firstRow) {
    //   const imgLabel = firstRow.querySelector(".image-label");
    //   console.log("unhiding");
    //   if (imgLabel) {
    //     console.log("unhiding");
    //     imgLabel.hidden = false;
    //   }
    // }
  } else if (type === "Multiple (rotation enabled)") {
    // Rotation: multiple image rows, numeric angles, show tile set label and angle periodicity
    tileSetLabelContainer.style.display = "block"; // show tile set label
    anglePeriodicityContainer.style.display = "block";

    // Make sure there are at least 2 image rows
    if (existingRows.length < 2) {
      addImageRowTemplate(existingRows[0].querySelector(".add-btn"), "angle");
    }

    // Makes sure the add image buttons add angle rows
    imagesContainer.querySelectorAll(".add-btn").forEach((btn) => {
      btn.onclick = () => addImageRowTemplate(btn, "angle");
    });

    console.log("# existing image rows", existingRows.length);

    existingRows.forEach((row) => {
      const addBtn = row.querySelector(".add-btn");
      const removeBtn = row.querySelector(".remove-btn");
      if (addBtn) addBtn.hidden = false;
      if (removeBtn) removeBtn.hidden = false;
      const imgLabel = row.querySelector(".image-label");
      if (imgLabel) {
        imgLabel.hidden = true; // hide image label in rotation mode
      }
      const angleLabel = row.querySelector("label");
      const imgAngle = row.querySelector(".image-angle");
      if (angleLabel) {
        angleLabel.hidden = false; // show angle label in rotation mode
      }
      if (imgAngle) {
        console.log("unhiding image angle");
        imgAngle.hidden = false; // show angle input in rotation mode
      }
    });

    // const firstRow = imagesContainer.querySelector(".image-row");
    // if (firstRow) {
    //   const imgLabel = firstRow.querySelector(".image-label");
    //   if (imgLabel) {
    //     console.log("hiding image label");
    //     // Instead of imgLabel.hidden = false;
    //     imgLabel.hidden = true; // hide
    //   }
    //   const imgAngle = firstRow.querySelector(".image-angle");
    //   if (imgAngle) {
    //     console.log("unhiding image angle");
    //     imgAngle.hidden = false;
    //   }
    // }
  }
}

// Add an image row to a tile set
// mode = 'label' or 'angle'
function addImageRowTemplate(btn, mode = "label") {
  let container;

  if (btn) {
    container = btn.closest(".images-container");
  } else {
    // fallback: find the first images-container on the page (or some parent row)
    console.warn("btn not provided, trying fallback container");
    container = document.querySelector(".images-container");
  }

  if (!container) {
    console.error("Cannot find images-container!");
    return;
  }

  const row = document.createElement("div");
  row.className = "image-row";

  if (mode === "label") {
    // per-image label
    row.innerHTML = `
      <input type="text" class="image-label" placeholder="Image label" />
      <label hidden>Angle (0&minus;360):
        <input type="number" class="image-angle" min="0" max="360" value="0" hidden/>
      </label>
      <button type="button" class="img-btn add-btn" onclick="addImageRowTemplate(this,'label')">+</button>
      <button type="button" class="img-btn remove-btn" onclick="removeImageRow(this)">&minus;</button>
      <div class="jpg-row">
        <label class="file-label jpg-label" style="--file-label-width:104px">
          <span class="jpg-label-text">Choose image</span>
			<input type="file" class="file-input jpg-file" accept=".jpg,.jpeg,.png,.tif,.tiff,.webp,.gif,.avif,.heif,.heic,.svg,.v,.vips,.jp2,.j2k,.jpf,.jpx,.jpm,.mj2,image/*" />
		</label>
        <input type="text" class="uri-input" placeholder="dzi/sample.dzi" />
      </div>
    `;
  } else if (mode === "angle") {
    // numeric angle input per image
    row.innerHTML = `
      <input type="text" class="image-label" placeholder="Image label" hidden/>
      <label>Angle (0&minus;360):
        <input type="number" class="image-angle" min="0" max="360" value="0" />
      </label>
	  <button type="button" class="img-btn add-btn" onclick="addImageRowTemplate(this,'angle')">+</button>
      <button type="button" class="img-btn remove-btn" onclick="removeImageRow(this)">&minus;</button>
      <div class="jpg-row">
        <label class="file-label jpg-label" style="--file-label-width:104px">
          <span class="jpg-label-text">Choose image</span>
			<input type="file" class="file-input jpg-file" accept=".jpg,.jpeg,.png,.tif,.tiff,.webp,.gif,.avif,.heif,.heic,.svg,.v,.vips,.jp2,.j2k,.jpf,.jpx,.jpm,.mj2,image/*" />
		</label>
        <input type="text" class="uri-input" placeholder="dzi/sample.dzi" />
      </div>
    `;
  }

  container.appendChild(row);
  updateImageButtons(container);
}

document.addEventListener("DOMContentLoaded", function () {
  console.log("Initializing first tile set row");
  addTileRow();
});

function createJSON() {
  const data = {};
  data.sampleId = crypto.randomUUID();

  // Groups
  data.groups = [];
  const groupRows = document.querySelectorAll("#groupContainer .group-row");
  groupRows.forEach((row) => {
    const val = row.querySelector("input")?.value;
    if (val) {
      data.groups.push(val);
    }
  });

  // Metadata fields
  data.title = document.getElementById("TitleText")?.value || "";
  const pixelsPerMeterValue = document.getElementById("pixelsPerMeterValue")?.value;
  const pixelsPerMeter = parseFloat(pixelsPerMeterValue);
  data.pixelsPerMeter =
    pixelsPerMeterValue && Number.isFinite(pixelsPerMeter) && pixelsPerMeter > 0
      ? pixelsPerMeter
      : null;
  data.description = document.getElementById("DescriptionText")?.value || "";

  // Tile sets
  data.tileSets = [];
  document
    .querySelectorAll("#tileSetContainer .tile-set-row")
    .forEach((tileRow) => {
      const type = tileRow.querySelector("select")?.value;
      const labelContainer = tileRow.querySelector(".tile-set-label-container");
      const tileSetLabel = labelContainer?.querySelector("input")?.value || "";
      const periodInput = tileRow.querySelector(".tile-angle-periodicity");
      const periodDegrees = periodInput ? parseFloat(periodInput.value) : 90;

      const tileSet = {};
      const imageRows = tileRow.querySelectorAll(".image-row");
      const tiles = [];

      imageRows.forEach((imgRow) => {
        const uriInput = imgRow.querySelector(".uri-input");
        const fileInput = imgRow.querySelector(".jpg-file");
        const selectedFile = fileInput?.files[0];
        let uri =
          uriInput?.value ||
          imgRow.dataset.sourceImagePath ||
          selectedFile?.path ||
          selectedFile?.name ||
          "";
        uri = uri.replace(/^["']+|["']+$/g, ""); // remove leading/trailing quotes

        if (type === "Individual") {
          // Individual: one image per tile set
          tiles.push({ uri });
        } else if (type === "Multiple") {
          // Multiple: images have labels
          const label = imgRow.querySelector(".image-label")?.value || "";
          tiles.push({ label, uri });
        } else if (type === "Multiple (rotation enabled)") {
          // Rotation: images have angleDegrees
          const angle = parseFloat(
            imgRow.querySelector(".image-angle")?.value || 0,
          );
          tiles.push({ uri, angleDegrees: angle });
        }
      });

      // Build JSON per type
      if (type === "Individual") {
        tileSet.label = tileSetLabel;
        tileSet.tiles = tiles;
      } else if (type === "Multiple") {
        tileSet.tiles = tiles;
      } else if (type === "Multiple (rotation enabled)") {
        tileSet.label = tileSetLabel;
        tileSet.periodDegrees = periodDegrees;
        tileSet.tiles = tiles;
      }

      data.tileSets.push(tileSet);
    });

  console.log("Generated JSON data:", data);
  return data;
}

const saveDropdown = document.getElementById("saveTypeDropdown");
const loadBtn = document.getElementById("loadExistingJSONBtn");
const exportBtn = document.getElementById("exportJSONBtn");
const existingFileInput = document.getElementById("selectExistingJSON");
const titleInput = document.getElementById("TitleText");
const pixelsPerMeterInput = document.getElementById("pixelsPerMeterValue");
const modifyCurrentOption = saveDropdown.querySelector(
  'option[value="modifyCurrentJSON"]',
);
const importProgressContainer = document.getElementById(
  "importProgressContainer",
);
const importProgressBar = document.getElementById("importProgressBar");
const importProgressText = document.getElementById("importProgressText");
let selectedExistingJSONPath = "";
let selectedExistingJSONData = null;
let selectedExistingJSONName = "";
let currentLibraryPath = "";
let currentLibraryData = null;
let canWriteCurrentLibrary = false;
let activeConversionProgress = null;

function hasRequiredSampleFields() {
  const title = titleInput.value.trim();
  return Boolean(title);
}

function updateExportButtonState() {
  const needsExistingJSON = saveDropdown.value === "modifyExistingJSON";
  const needsCurrentJSON = saveDropdown.value === "modifyCurrentJSON";
  const hasExistingJSON =
    Boolean(selectedExistingJSONPath) || existingFileInput.files.length > 0;
  exportBtn.disabled =
    !hasRequiredSampleFields() ||
    (needsExistingJSON && !hasExistingJSON) ||
    (needsCurrentJSON && !canWriteCurrentLibrary);
}

function hasPendingLocalImageUris() {
  return Array.from(document.querySelectorAll(".image-row")).some((row) => {
    const uriInput = row.querySelector(".uri-input");
    const fileInput = row.querySelector(".jpg-file");
    const selectedFile = fileInput?.files[0];
    const uri =
      uriInput?.value ||
      row.dataset.sourceImagePath ||
      selectedFile?.path ||
      selectedFile?.name ||
      "";

    return isLocalImagePath(uri.replace(/^["']+|["']+$/g, ""));
  });
}

function updateExportButtonLabel() {
  const actions = {
    modifyCurrentJSON: "Add to Library",
    modifyExistingJSON: "Update Library",
    createNewJSON: "Export Library",
  };
  const action = actions[saveDropdown.value] || "Export Library";

  exportBtn.textContent = hasElectronDziConverter() && hasPendingLocalImageUris()
    ? `Convert images and ${action}`
    : action;
}

// Called whenever the dropdown changes
function updateSaveType() {
  const mode = saveDropdown.value;
  const needsAnotherLibrary = mode === "modifyExistingJSON";

  // Show/hide the "Select file" button
  loadBtn.hidden = !needsAnotherLibrary;

  // Clear the file input when switching
  existingFileInput.value = "";
  selectedExistingJSONPath = "";
  selectedExistingJSONData = null;
  selectedExistingJSONName = "";
  loadBtn.textContent = "Select file";
  updateExportButtonLabel();
  updateExportButtonState();
}

function applyCurrentLibraryContext(context = {}) {
  currentLibraryPath =
    typeof context.filePath === "string" ? context.filePath : "";
  currentLibraryData =
    context.jsonData && Array.isArray(context.jsonData.samples)
      ? context.jsonData
      : null;
  canWriteCurrentLibrary = Boolean(
    context.canWriteCurrentLibrary &&
      currentLibraryPath &&
      currentLibraryData,
  );

  if (modifyCurrentOption) {
    modifyCurrentOption.disabled = !canWriteCurrentLibrary;
    modifyCurrentOption.textContent = canWriteCurrentLibrary
      ? "Add to this library JSON"
      : "Add to this library JSON (read-only)";
  }
  if (!canWriteCurrentLibrary && saveDropdown.value === "modifyCurrentJSON") {
    saveDropdown.value = "createNewJSON";
  }
  updateSaveType();
}

if (window.electronAPI?.onImportWizardContext) {
  window.electronAPI.onImportWizardContext(applyCurrentLibraryContext);
} else {
  applyCurrentLibraryContext();
}

// Open file picker when user clicks "Select file"
loadBtn.addEventListener("click", async () => {
  if (!window.electronAPI?.selectExistingJsonFile) {
    existingFileInput.click();
    return;
  }

  try {
    const result = await window.electronAPI.selectExistingJsonFile();
    if (result?.canceled) return;

    selectedExistingJSONPath = result.filePath || "";
    selectedExistingJSONData = result.jsonData || null;
    selectedExistingJSONName = result.fileName || "";
    loadBtn.textContent = selectedExistingJSONName || "Library selected";
    updateExportButtonState();
  } catch (error) {
    console.error(error);
    alert(error.message || "Invalid library JSON file.");
    selectedExistingJSONPath = "";
    selectedExistingJSONData = null;
    selectedExistingJSONName = "";
    loadBtn.textContent = "Select file";
    updateExportButtonState();
  }
});

titleInput.addEventListener("input", updateExportButtonState);
pixelsPerMeterInput.addEventListener("input", updateExportButtonState);
existingFileInput.addEventListener("change", updateExportButtonState);

// Initialize state on page load
updateSaveType();

function isLocalImagePath(uri) {
  return (
    typeof uri === "string" &&
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(uri) &&
    /\.(jpe?g|png|tiff?|webp|gif|avif|hei[cf]|svg|v|vips|jp2|j2k|jpf|jpx|jpm|mj2)$/i.test(uri)
  );
}

function getSampleImageUris(sample) {
  const uris = [];
  const seen = new Set();

  for (const tileSet of sample.tileSets || []) {
    for (const tile of tileSet.tiles || []) {
      if (
        typeof tile.uri !== "string" ||
        !tile.uri.trim() ||
        seen.has(tile.uri)
      ) {
        continue;
      }

      seen.add(tile.uri);
      uris.push(tile.uri);
    }
  }

  return uris;
}

function waitForImportProgressPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function showImportProgress(message, percent = 0) {
  if (!importProgressContainer || !importProgressBar || !importProgressText) {
    return;
  }

  importProgressContainer.hidden = false;
  const clampedPercent = Math.max(0, Math.min(100, percent));
  importProgressBar.style.width = "100%";
  importProgressBar.style.transform = `scaleX(${clampedPercent / 100})`;
  importProgressText.textContent = message;
}

function hideImportProgress() {
  if (!importProgressContainer || !importProgressBar || !importProgressText) {
    return;
  }

  importProgressContainer.hidden = true;
  importProgressBar.style.width = "100%";
  importProgressBar.style.transform = "scaleX(0)";
  importProgressText.textContent = "";
  activeConversionProgress = null;
}

function getPathFileName(filePath) {
  return String(filePath || "").split(/[\\/]/).pop();
}

function handleDziConversionProgress(progress) {
  if (
    !activeConversionProgress ||
    progress.sourcePath !== activeConversionProgress.sourcePath
  ) {
    return;
  }

  const filePercent = progress.percent || 0;
  const overallPercent =
    ((activeConversionProgress.fileIndex - 1 + filePercent / 100) /
      activeConversionProgress.totalFiles) *
    activeConversionProgress.progressLimit;
  const fileName = getPathFileName(progress.sourcePath);

  showImportProgress(
    `Converting ${activeConversionProgress.fileIndex}/${activeConversionProgress.totalFiles}: ${fileName}`,
    overallPercent,
  );
}

if (window.electronAPI?.onDziConversionProgress) {
  window.electronAPI.onDziConversionProgress(handleDziConversionProgress);
}

async function prepareSampleImages(sample) {
  const imageUris = getSampleImageUris(sample);
  const conversionResults = new Map();
  const progressLimit = 90;

  if (!imageUris.length) {
    showImportProgress("Saving library...", progressLimit);
    await waitForImportProgressPaint();
    return;
  }

  for (let i = 0; i < imageUris.length; i += 1) {
    const uri = imageUris[i];
    const fileIndex = i + 1;
    const shouldConvert = isLocalImagePath(uri) && hasElectronDziConverter();

    showImportProgress(
      `Preparing ${fileIndex}/${imageUris.length}: ${getPathFileName(uri)}`,
      (i / imageUris.length) * progressLimit,
    );
    await waitForImportProgressPaint();

    if (shouldConvert) {
      activeConversionProgress = {
        sourcePath: uri,
        fileIndex,
        totalFiles: imageUris.length,
        progressLimit,
      };

      const result = await window.electronAPI.convertImageToDzi(uri);
      conversionResults.set(uri, result.relativeDziPath || result.dziPath);
    }

    showImportProgress(
      `Prepared ${fileIndex}/${imageUris.length}: ${getPathFileName(uri)}`,
      (fileIndex / imageUris.length) * progressLimit,
    );
    await waitForImportProgressPaint();
  }

  activeConversionProgress = null;

  for (const tileSet of sample.tileSets || []) {
    for (const tile of tileSet.tiles || []) {
      if (conversionResults.has(tile.uri)) {
        tile.uri = conversionResults.get(tile.uri);
      }
    }
  }

  document.querySelectorAll(".image-row").forEach((row) => {
    const uriInput = row.querySelector(".uri-input");
    const uri = (uriInput?.value || row.dataset.sourceImagePath || "").replace(
      /^["']+|["']+$/g,
      "",
    );

    if (conversionResults.has(uri)) {
      setImageRowUri(row, conversionResults.get(uri));
      delete row.dataset.sourceImagePath;
      setJpgRowConversionState(row, "converted", "DZI ready");
    }
  });

  showImportProgress("Saving library...", 95);
  await waitForImportProgressPaint();
}

function setExportInProgress(inProgress) {
  exportBtn.disabled = inProgress;
  exportBtn.textContent = inProgress ? "Importing..." : "";
  if (!inProgress) {
    updateExportButtonLabel();
  }
}

async function completeSampleImport(jsonData, selectedTitle) {
  showImportProgress("Import complete.", 100);
  await waitForImportProgressPaint();

  if (!window.electronAPI?.completeSampleImport) return;

  await window.electronAPI.completeSampleImport(jsonData, selectedTitle);
}

function getDefaultJSONFileName() {
  return "my_library.json";
}

document.getElementById("exportJSONBtn").addEventListener("click", async () => {
  if (exportBtn.disabled) return;

  // Gather the new sample
  const newSample = createJSON();
  if (newSample.pixelsPerMeter !== null) {
    newSample.pixelsPerMeter = newSample.pixelsPerMeter.toString(); // ensure string
  }

  const mode = document.getElementById("saveTypeDropdown").value;

  setExportInProgress(true);
  showImportProgress("Preparing import...", 0);

  try {
    await prepareSampleImages(newSample);
  } catch (error) {
    console.error(error);
    alert(error.message || "Could not convert image file(s) to DZI.");
    setExportInProgress(false);
    hideImportProgress();
    updateExportButtonState();
    return;
  }

  if (mode === "modifyCurrentJSON") {
    if (!canWriteCurrentLibrary || !currentLibraryData || !currentLibraryPath) {
      alert("The current library JSON is read-only. Choose another save target.");
      setExportInProgress(false);
      hideImportProgress();
      updateExportButtonState();
      return;
    }

    try {
      const updatedLibrary = JSON.parse(JSON.stringify(currentLibraryData));
      if (!updatedLibrary.samples) updatedLibrary.samples = [];
      updatedLibrary.samples.push(newSample);
      await window.electronAPI.writeJsonFile(
        currentLibraryPath,
        updatedLibrary,
      );
      await completeSampleImport(updatedLibrary, newSample.title);
    } catch (err) {
      alert("Could not update the current library JSON file.");
      console.error(err);
      setExportInProgress(false);
      hideImportProgress();
      updateExportButtonState();
    }
    return;
  } else if (mode === "createNewJSON") {
    // Create a new JSON object
    const jsonOutput = {
      format: "v1",
      samples: [newSample],
    };
    try {
      if (window.electronAPI?.saveJsonFileAs) {
        const result = await window.electronAPI.saveJsonFileAs(
          getDefaultJSONFileName(),
          jsonOutput,
        );

        if (result?.canceled) {
          setExportInProgress(false);
          hideImportProgress();
          updateExportButtonState();
          return;
        }
      } else {
        saveJSONFile(jsonOutput, getDefaultJSONFileName());
      }

      await completeSampleImport(jsonOutput, newSample.title);
      setExportInProgress(false);
      updateExportButtonState();
    } catch (err) {
      alert("Could not load the exported JSON in the main window.");
      console.error(err);
      setExportInProgress(false);
      hideImportProgress();
      updateExportButtonState();
    }
  } else if (mode === "modifyExistingJSON") {
    if (!selectedExistingJSONData && existingFileInput.files.length === 0) {
      alert("Please select a library JSON file to modify.");
      setExportInProgress(false);
      updateExportButtonState();
      return;
    }

    if (selectedExistingJSONData && selectedExistingJSONPath) {
      try {
        const existingJSON = JSON.parse(JSON.stringify(selectedExistingJSONData));

        if (!existingJSON.samples) existingJSON.samples = [];
        existingJSON.samples.push(newSample);

        await window.electronAPI.writeJsonFile(
          selectedExistingJSONPath,
          existingJSON,
        );
        await completeSampleImport(existingJSON, newSample.title);
      } catch (err) {
        alert("Could not update the selected library JSON file.");
        console.error(err);
        setExportInProgress(false);
        hideImportProgress();
        updateExportButtonState();
      }
      return;
    }

    // Browser fallback: download an updated copy when direct filesystem writes are unavailable.
    const file = existingFileInput.files[0];
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const existingJSON = JSON.parse(e.target.result);

        if (!existingJSON.samples) existingJSON.samples = [];
        existingJSON.samples.push(newSample);

        saveJSONFile(existingJSON, file.name);
        await completeSampleImport(existingJSON, newSample.title);
      } catch (err) {
        alert("Invalid library JSON file.");
        console.error(err);
      } finally {
        setExportInProgress(false);
        hideImportProgress();
        updateExportButtonState();
      }
    };
    reader.onerror = () => {
      alert("Could not read the selected library JSON file.");
      setExportInProgress(false);
      hideImportProgress();
      updateExportButtonState();
    };
    reader.readAsText(file);
  }
});

function saveJSONFile(jsonData, defaultFileName = "data.json") {
  // Convert object to JSON string
  const jsonString = JSON.stringify(jsonData, null, 2); // pretty-print

  // Create a blob
  const blob = new Blob([jsonString], { type: "application/json" });

  // Create a temporary download link
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = defaultFileName;

  // Trigger the download
  document.body.appendChild(link);
  link.click();

  // Cleanup
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
