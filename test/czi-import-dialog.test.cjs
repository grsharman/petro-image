const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "index.js"),
  "utf8",
);

test("CZI import dialog closes only from its close button", () => {
  assert.match(
    source,
    /closeCziImportButton\?\.addEventListener\("click", closeCziImportDialog\)/,
  );
  assert.match(
    source,
    /cziImportDialog\.addEventListener\("cancel", function \(event\) \{\s*event\.preventDefault\(\);\s*\}\)/,
  );
  assert.doesNotMatch(
    source,
    /event\.target === cziImportDialog\) closeCziImportDialog\(\)/,
  );
});
