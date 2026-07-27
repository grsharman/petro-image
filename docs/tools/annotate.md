# Annotate

## Purpose

Annotations can be used to record point, polyline, or polygon features. There is also the option to include a label and notes.

## Inputs and prerequisites

The user selects a geometry appropriate to the observation:

- Point
- Polyline
- Polygon
- Rectangle
- Ellipse
- Circle

Annotations may be created manually or imported from a GeoJSON file.

## Method

Geometry vertices are stored in source-image pixel coordinates following the GeoJSON model. Labels, notes, groups, appearance, and editing state are associated with each feature.

In the desktop app, the first annotation for a sample creates a working GeoJSON file in the project's `annotations` folder. Subsequent edits are saved to that working file. Explicit exports are separate records.

## Outputs

The primary output is a GeoJSON feature collection containing geometries and their properties. Annotations can also be displayed in snapshots and used as training or transfer inputs by other tools. For example, polyline and polygon annotations can be selected and moved to the Measure tool.

Existing annotation values can be copied into containing polygons with the
[Transfer Values action](../actions/transfer-values.md). Grain polygons can
also be grouped from point-count labels with
[Label Grains from Counts](../actions/label-grains-from-counts.md).
