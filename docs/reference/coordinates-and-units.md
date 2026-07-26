# Coordinates and units

## Source-image coordinates

petro-image stores annotation, measurement, grid, area-of-interest, and embedded-viewer coordinates in source-image pixels. The origin is the upper-left corner of the image:

- \(x\) increases to the right.
- \(y\) increases downward.
- Coordinate values may be fractional.

Coordinates refer to the source-image coordinate space rather than CSS screen pixels, OpenSeadragon viewport coordinates, or the dimensions of the current browser window. Zooming and panning therefore do not change stored geometry.

Registered tile sets for a sample are expected to represent the same image extent. If layers have different source dimensions or are not spatially registered, a coordinate will not identify the same specimen location in each layer.

## Rotation

Image rotation changes how the source-image coordinate system is displayed; it does not rewrite stored coordinates. The sample-level `rotationDegrees` field sets the preferred initial display orientation. Tile-level `angleDegrees` instead records an image's acquisition angle within a rotation-aware tile set.

These values serve different purposes:

| Field | Meaning |
| --- | --- |
| `rotationDegrees` | Initial display orientation of the sample |
| `angleDegrees` | Acquisition angle represented by one image |
| `periodDegrees` | Rotation interval after which an angle-aware tile set repeats |

## Azimuth

Shape and optical-response azimuths use the image coordinate system. Azimuth is measured clockwise from the top of the displayed source image and is generally reported as an axial direction from \(0^\circ\) to less than \(180^\circ\). Opposite directions along the same axis are therefore equivalent.

Rotation of the viewer does not change the stored or calculated image-coordinate azimuth.

## Scale calibration

The supported calibration field is `pixelsPerMeter`, a positive number giving the number of source-image pixels per physical meter. If \(s\) is `pixelsPerMeter`, then

$$
d_{\mathrm{m}}=\frac{d_{\mathrm{px}}}{s}
\qquad\text{and}\qquad
A_{\mathrm{m}^2}=\frac{A_{\mathrm{px}^2}}{s^2}.
$$

petro-image can display these results in meters, millimeters, or micrometers and their corresponding square units. Without a valid `pixelsPerMeter`, scale-dependent measurements and scale bars are unavailable. If a scalebar is available on the image, `pixelsPerMeter` can be defined using the Add Scale action.

Calibration must describe the displayed image derivative. If an image was resampled before its Deep Zoom pyramid was generated, use the pixel density of the resampled derivative rather than the original scan.

## GeoJSON coordinates

petro-image uses GeoJSON geometry types but interprets their coordinate arrays as source-image pixels rather than longitude and latitude. Consequently, petro-image GeoJSON is not geographic GeoJSON unless an external application supplies and manages an additional coordinate transformation.

See [Annotation GeoJSON](formats/annotations-geojson.md) for the feature structure and commonly used properties.
