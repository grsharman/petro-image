"use strict";

const openImportWizardButton = document.getElementById(
  "openImportWizardButton",
);

if (window.electronAPI?.openImportWizard && openImportWizardButton) {
  openImportWizardButton.hidden = false;
  openImportWizardButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.electronAPI.openImportWizard();
  });
}

if (window.electronAPI?.onLoadSampleJSON) {
  window.electronAPI.onLoadSampleJSON(({ jsonData, selectedTitle }) => {
    const loadSamples =
      window.loadSampleJSON ||
      (typeof loadSampleJSON === "function" ? loadSampleJSON : null);

    if (!loadSamples) return;

    loadSamples(jsonData);
    selectImportedSample(selectedTitle);
  });
}

function selectImportedSample(selectedTitle) {
  if (!selectedTitle) return;

  const groupDropdown = document.getElementById("groupDropdown");
  const sampleDropdown = document.getElementById("sampleDropdown");

  if (!groupDropdown || !sampleDropdown) return;

  groupDropdown.value = "All";
  groupDropdown.dispatchEvent(new Event("change"));

  const importedOption = Array.from(sampleDropdown.options)
    .reverse()
    .find((option) => option.textContent === selectedTitle);

  if (!importedOption) return;

  sampleDropdown.value = importedOption.value;
  sampleDropdown.dispatchEvent(new Event("change"));
}
