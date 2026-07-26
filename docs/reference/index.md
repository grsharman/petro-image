# Reference

These pages define petro-image's file formats, coordinate conventions, keyboard controls, and integration interfaces. They are intended for users who need exact field names or application behavior rather than a guided workflow.

## File formats

- [File-format index](formats/index.md)
- [Library JSON](formats/library-json.md): samples, tile sets, images, calibration, rotation, and annotations
- [Annotation GeoJSON](formats/annotations-geojson.md): geometry coordinates and commonly used feature properties

Tool-specific recipes and result files are described by the corresponding [tool and analytical method](../tools/index.md).

## Coordinates and units

[Coordinates and units](coordinates-and-units.md) defines source-image pixel coordinates, image orientation, azimuth, `pixelsPerMeter`, and conversion to physical units.

## Application controls

[Keyboard shortcuts](keyboard-shortcuts.md) is the canonical list of keyboard and modified-pointer controls.

## Integration

[Embedded viewer API](embedded-viewer-api.md) defines the URL parameters, trusted `postMessage` commands, events, and payloads used when another application embeds petro-image.

## How reference pages relate to the rest of the documentation

- [Getting started](../getting-started/first-session.md) introduces the application.
- [User guides](../user-guide/viewing-and-comparing.md) explain complete workflows.
- [Importing](../importing/index.md) explains how to bring local or hosted images into petro-image.
- [Tools and analytical methods](../tools/index.md) explain calculations, outputs, assumptions, and interpretation.
