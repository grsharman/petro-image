"use strict";

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

function toggleURI(checkbox) {
  // Find the nearest image-row containing this checkbox
  const row = checkbox.closest(".image-row");
  if (!row) return;

  const fileLabel = row.querySelector(".jpg-label");
  const uriInput = row.querySelector(".uri-input");

  if (!fileLabel || !uriInput) return;

  if (checkbox.checked) {
    fileLabel.style.display = "none";
    uriInput.style.display = "inline-block";
  } else {
    fileLabel.style.display = "flex";
    uriInput.style.display = "none";
    uriInput.value = ""; // reset URI
  }
}

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
      <span class="tile-set-label"></span>
      <button type="button" class="img-btn" onclick="addTileRow(this)">+</button>
	  <!--Will need to unhide minus button on 2nd+ tile sets-->
      <button type="button" class="img-btn remove-tile-btn" onclick="removeTileRow(this)" hidden>&minus;</button>
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
			<input type="number" class="tile-angle-periodicity" min="0" max="360" value="0"/>
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

            <!-- JPG / URI inputs -->
            <div class="jpg-row">
                <label class="file-label jpg-label" style="--file-label-width: 141px">Select JPG file
                	<input type="file" class="file-input jpg-file"/>
				</label>
                <!--URI input-->
                <input type="text" class="uri-input" placeholder="Enter image URI" style="display: none" />
                <!--Toggle checkbox-->
                <input type="checkbox" onclick="toggleURI(this)" />
                <label>Use URI?</label>
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
  });
}

// Function for adding/removing image rows
function addImageRowMultiple(btn) {
  const container = btn.closest(".images-container"); // parent container for images
  const row = document.createElement("div");
  row.className = "image-row";

  row.innerHTML = `
    <input type="text" class="image-label" placeholder="Image label" />
    <button type="button" class="img-btn" onclick="addImageRowMultiple(this)">
        +
    </button>
    <button
        type="button"
        class="img-btn"
        onclick="removeImageRow(this)"
    >
        &minus;
    </button>

    <div class="jpg-row">
      <label class="file-label jpg-label" style="--file-label-width: 141px">Select JPG file
	    <input type="file" class="file-input jpg-file" />
	  </label>
      
      <input type="text" class="uri-input" placeholder="Enter image URI" style="display: none" />
      <input type="checkbox" onclick="toggleURI(this)" />
      <label>Use URI?</label>
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
    <button type="button" class="img-btn" onclick="addImageRowRotation(this)">
        +
    </button>
    <button
        type="button"
        class="img-btn"
        onclick="removeImageRow(this)"
    >
        &minus;
    </button>

    <div class="jpg-row">
      <label class="file-label jpg-label" style="--file-label-width: 141px">Select JPG file
      	<input type="file" class="file-input jpg-file" />
	  </label>
      
      <input type="text" class="uri-input" placeholder="Enter image URI" style="display: none" />
      <input type="checkbox" onclick="toggleURI(this)" />
      <label>Use URI?</label>
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
    ".angle-periodicity-container"
  );

  const tileSetLabelContainer = tileRow.querySelector(
    ".tile-set-label-container"
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
        <label class="file-label jpg-label" style="--file-label-width:141px">Select JPG file
			<input type="file" class="file-input jpg-file" />
		</label>
        <input type="text" class="uri-input" placeholder="Enter image URI" style="display:none;" />
        <input type="checkbox" onclick="toggleURI(this)" />
        <label>Use URI?</label>
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
        <label class="file-label jpg-label" style="--file-label-width:141px">Select JPG file
			<input type="file" class="file-input jpg-file" />
		</label>
        <input type="text" class="uri-input" placeholder="Enter image URI" style="display:none;" />
        <input type="checkbox" onclick="toggleURI(this)" />
        <label>Use URI?</label>
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
  data.pixelsPerMeter =
    parseFloat(document.getElementById("pixelsPerMeterValue")?.value) || 1000;
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
      const periodDegrees = periodInput ? parseFloat(periodInput.value) : 0;

      const tileSet = {};
      const imageRows = tileRow.querySelectorAll(".image-row");
      const tiles = [];

      imageRows.forEach((imgRow) => {
        const uriInput = imgRow.querySelector(".uri-input");
        const useURI = uriInput && uriInput.style.display !== "none";
        const fileInput = imgRow.querySelector(".jpg-file");
        let uri = useURI ? uriInput.value : fileInput?.files[0]?.name || "";
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
            imgRow.querySelector(".image-angle")?.value || 0
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

// Called whenever the dropdown changes
function updateSaveType() {
  const mode = saveDropdown.value;
  const isNew = mode === "createNewJSON";

  // Show/hide the "Select file" button
  loadBtn.hidden = isNew;

  // Export button is enabled immediately for new JSON
  exportBtn.disabled = !isNew;

  // Clear the file input when switching
  existingFileInput.value = "";
}

// Open file picker when user clicks "Select file"
loadBtn.addEventListener("click", () => {
  existingFileInput.click();
});

// Enable Export JSON only when a file is selected
existingFileInput.addEventListener("change", () => {
  exportBtn.disabled = existingFileInput.files.length === 0;
});

// Initialize state on page load
updateSaveType();

document.getElementById("exportJSONBtn").addEventListener("click", () => {
  // Gather the new sample
  const newSample = createJSON();
  newSample.pixelsPerMeter = newSample.pixelsPerMeter.toString(); // ensure string

  const mode = document.getElementById("saveTypeDropdown").value;

  if (mode === "createNewJSON") {
    // Create a new JSON object
    const jsonOutput = {
      format: "v1",
      samples: [newSample],
    };
    saveJSONFile(jsonOutput, newSample.title || "sample.json");
  } else if (mode === "modifyExistingJSON") {
    // Read an existing JSON file
    const fileInput = document.getElementById("selectExistingJSON");
    const file = fileInput.files[0];

    if (!file) {
      alert("Please select a JSON file to modify.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const existingJSON = JSON.parse(e.target.result);

        if (!existingJSON.samples) existingJSON.samples = [];
        existingJSON.samples.push(newSample);

        saveJSONFile(existingJSON, file.name);
      } catch (err) {
        alert("Invalid JSON file.");
        console.error(err);
      }
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
