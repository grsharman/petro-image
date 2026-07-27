# Add Scale

## Purpose

Add Scale calibrates the active sample from a scalebar visible in its image.
The result is stored as `pixelsPerMeter` and enables physical distances,
areas, scale bars, and tools that require scale calibration.

**Availability:** desktop app only.

## Prerequisites

Use an image layer that clearly shows a scalebar with a known length.

## Procedure

1. Open the sample and display the layer containing the scalebar.
2. Choose **Actions → Add Scale**.
3. Click the start and end of the scalebar in the image.
4. Enter its length and select meters, millimeters, or micrometers.
5. Review the calculated pixels-per-meter value.
6. Choose **Apply**.

Use **Reset** to select the endpoints again. After two points have already
been selected, clicking the image starts a new two-point selection.

## Calculation and output

If the selected endpoints are \(d_\mathrm{px}\) pixels apart and the entered
physical length is \(d_\mathrm{m}\) meters, petro-image calculates

$$
\mathrm{pixelsPerMeter}=\frac{d_\mathrm{px}}{d_\mathrm{m}}.
$$

Applying the result updates the active sample's `pixelsPerMeter` value and
saves the library JSON. If the active library has not yet been assigned a
writable file, the desktop app prompts for a save location. A canceled or
failed save does not retain the new calibration.

## Verification and limitations

- Place both points at consistent locations on the scalebar, such as the outer
  edges or the centers of its end ticks.
- Zoom in before selecting short scalebars; endpoint uncertainty represents a
  larger fraction of a short distance.
- Confirm the calibration by displaying petro-image's scale bar or measuring a
  second known distance.
- All other image layers are assumed to have the same pixel dimensions and scale.
- Viewer rotation does not change the source-image distance used in the
  calculation.

See [Coordinates and units](../reference/coordinates-and-units.md#scale-calibration)
for unit conversions and the meaning of `pixelsPerMeter`.
