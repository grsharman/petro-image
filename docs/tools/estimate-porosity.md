# Estimate Porosity

## Purpose

Estimate Porosity measures the area fraction of pixels classified as one or more pore types within a polygonal area of interest. It can also calculate geometric properties of the resulting binary pore regions.

## Inputs and prerequisites

The workflow uses:

- A polygonal area of interest
- One or more source tile sets
- Representative color picks for each pore type
- Selected polygons for manually defining pore space
- A color-similarity tolerance and analysis resolution
- Valid calibration when physical size units are needed

## Method

Pixels are assigned to pore types by similarity to user-sampled colors. Separate pore types retain separate samples, tolerances, overlay colors, and results. Selected annotation polygons can force intersecting areas into a pore type. This is useful when porosity has a non-typical color (e.g., a white bubble in blue-dyed epoxy).

Calculated properties include distance to boundary, connected-component properties, chord lengths, and local thickness. At a pore pixel, local thickness is the diameter of the largest circle that contains that pixel and remains inside the corresponding pore region.

## Outputs

Outputs include:

- Area fraction by pore type and combined total
- Binary masks
- Local-thickness and distance rasters
- Component area, equivalent diameter, thickness, circularity, aspect ratio, orientation, and identifier
- Summary CSV or JSON
- Numeric or rendered raster exports with image-coordinate sidecars
- Recipe JSON containing the AOI, samples, polygons, and settings

## Assumptions and limitations

- Color similarity is an operational definition of pore space and is most similar when the sample is impregned with blue or red dye.
- Lighting gradients, stains, shadows, bubbles, mixed pixels, compression, and color processing can affect results.
- Results vary with tolerance, samples, resolution, and AOI.
- Edge-touching objects may be truncated by the analysis boundary.
- Two-dimensional area fraction and pore geometry do not fully describe a three-dimensional pore network.

## Reproducibility

The recipe used to estimate porosity can be exported and later imported to reproduce results. Review the overlay before treating estimates as final.
