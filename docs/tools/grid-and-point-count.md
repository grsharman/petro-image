# Grid & Count

## Purpose

Grid & Count supports systematic point counting: the observer identifies the feature beneath crosshairs that are defined at a specified spacing in a grid-like pattern. The result can be used to estimate proportions within a defined area of interest.

## Inputs and prerequisites

A count requires:

- A specimen image and defined area of interest
- A generated grid or imported crosshair locations
- A consistent set of count identifiers, which are defined by the user

Meaningful spacing in physical units requires valid image scale-calibration.

## Method

petro-image generates crosshairs in a snake-like sequence from the upper left toward the lower right. The user controls the area of interest, spacing, number of points, and crosshair appearance. When more points are requested than fit at the selected spacing, the algorithm can add infill locations using successively smaller spacing while preventing duplicate coordinates.

At each point, the observer records a case-sensitive identifier and optional notes. Summary percentages are calculated from recorded identifiers selected for inclusion.

## Outputs

Outputs can include:

- Ordered sampling coordinates
- Identifier and notes for each point
- Counts and percentages by identifier
- GeoJSON or CSV exports

The desktop app maintains a per-sample working GeoJSON file in the project's `counts` folder after the first recorded count.

Point-count labels can be joined to existing grain polygons with the
[Label Grains from Counts](../actions/label-grains-from-counts.md).

## Reproducibility

Exporting results will retain the area of interest, point coordinates, and the identifier and notes for each counted point. Export existing work before replacing a grid to avoid losing work.

See the [keyboard shortcut reference](../reference/keyboard-shortcuts.md#grid-and-point-counting).
