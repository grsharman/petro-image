# Snapshot

## Purpose

Snapshot exports a selected image region for figures, teaching, communication, or visual records. It renders a view; it does not export the full analytical state behind every displayed layer.

## Inputs and prerequisites

The user chooses:

- A drawn area or the current screen extent
- Visible layers or one selected tile set
- Whether to include annotations and labels
- Full, half, quarter, or current-viewer resolution
- Optional scalebar, porosity overlay, or applied Transform
- JPEG quality

A scalebar is available only when image scale-calibration exists.

## Method

Visible layers are rendered in display order using their current opacity. Snapshot superimposes selected layers and does not reproduce the divided-image layout. Source-relative resolution choices use source-image pixels; current viewer resolution uses the on-screen pixel density.

If requested, visible vector annotations, labels, the current porosity overlay, or a tile set's attached Transform are rendered into the exported image.

## Outputs

Snapshot can save a JPEG or copy the rendered image to the system clipboard. The selected output dimensions and pixel count are shown before export.

## Assumptions and limitations

- The export is limited to 16,000 pixels per side and 100 megapixels total.
