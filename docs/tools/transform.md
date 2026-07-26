# Transform

## Purpose

Transform previews filters and calculates derivative imagery from one or more tile sets. Results can remain temporary previews or be generated as persistent derived tile sets and raster exports.

## Inputs and prerequisites

Inputs depend on the selected recipe:

- **Simple Filter** operates on selected imagery using predefined filters.
- **Image Calculator** evaluates expressions using tile-set color channels and functions.
- **Polarization Analysis** operates on registered, angle-aware PPL, XPL, and optionally CPL tile sets.

Color- and intensity-based calculations inherit the acquisition and processing properties of their source imagery.

## Method

Simple Filter includes operations such as edge detection, local contrast, unsharp masking, relief shading, and channel mapping. Image Calculator exposes red, green, blue, luminance, saturation, and hue channels for tile sets labeled `A`, `B`, `C`, and so forth. Supported operations include absolute value, normalized difference, and stack range, maximum, minimum, and mean.

Stack functions calculate a value at each pixel across all images in the selected tile set. A single-image stack therefore has a range of zero.

[Polarization Analysis](polarization-analysis.md) uses its own harmonic models and interpretive rules.

## Outputs

Transform provides a mapped preview and can generate a persistent tile set. Depending on the calculation, exports may include NumPy arrays, TIFF, PNG, or JPEG. Numeric formats preserve scalar calculated values more directly; PNG and JPEG preserve the current display mapping.

## Assumptions and limitations

- Preview color and contrast are not necessarily the analytical values.
- Edge, contrast, and sharpening filters are scale-dependent.
- Stack calculations require spatially registered input images.
- Comparisons of intensity assume suitable radiometric consistency.
- Maximum-resolution calculations can require substantial time and memory.

## Reproducibility

Retain source tile-set identifiers, expression or filter name, all parameters, analysis resolution, output range and mapping, export format, sample calibration, and software version. Prefer a numeric export when exact derived values are required downstream.

See [Polarization Analysis](polarization-analysis.md) for the detailed harmonic models, calculated products, reliability rules, and classification method.
