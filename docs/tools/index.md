# Tools and analytical methods

The petro-image Tools menu combines manual observations, quantitative measurements, image processing, and model-assisted analysis. Each tool has a different  purpose and produces a different kind of record, although some tools are best used together.

| Tool | Primary purpose | Typical output |
| --- | --- | --- |
| [Measure](measure.md) | Quantify feature dimensions | Length, area, diameter, summary statistics |
| [Annotate](annotate.md) | Record feature geometries, labels, and notes | GeoJSON features |
| [Grid & Count](grid-and-point-count.md) | Conduct systematic point-counting | Ordered locations, classifications, percentages |
| [Snapshot](snapshot.md) | Export a selected image region | Rendered JPG or clipboard image |
| [Segment](segment.md) | Digitize feature boundaries with model assistance | Polygon annotations |
| [Transform](transform.md) | Filter imagery and calculate derivative products | Preview or export a derived raster |
| [Estimate Porosity](estimate-porosity.md) | Estimate color-defined pore area and pore properties | Area fractions, masks, property rasters, tables |
| [Classify](classify.md) | Predict polygon labels or pixel classes from labeled examples | Predicted groups or classification raster |

## How to read a tool page

The pages use a common structure:

- **Purpose** states the scientific question or task addressed by the tool.
- **Inputs and prerequisites** identify required imagery, metadata, annotations, calibration, or trained models.
- **Method** explains how petro-image derives the result.
- **Outputs** describes what is recorded or exported, including units and coordinate systems where relevant.
- **Assumptions and limitations** identifies conditions that affect interpretation, if applicable.
- **Reproducibility** lists settings or contextual information that should be retained with research results, if applicable.

## Shared principles

Most geometries use source-image pixel coordinates. Physical measurements require valid image scale-calibration. Tools that operate on image color or intensity inherit the effects of acquisition, registration, illumination, color processing, resolution, and compression.

Outputs from beta tools should be reviewed rather than treated as ground truth. Functionality in these tools is likey to evolve during continued development.
