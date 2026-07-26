# Measure

## Purpose

Measure quantifies the size, shape, and orientation of polyline and polygon annotations. Measure also includes basic functions for plotting and analysis of measurement properties.

## Inputs and prerequisites

Measurements require valid `pixelsPerMeter` scale metadata for the image. Without scale calibration, measurement values are unavailable.

## Method

The tool records vertices in source-image coordinates and calculates measurements from the resulting polyline or polygon. In the equations below, \((x_i,y_i)\) are consecutive vertices, \(n\) is the number of vertices, \(A\) is polygon area, and \(P\) is polygon perimeter.

### Polyline properties

**Length (polylines only).** The total length is the sum of the straight-line distances between consecutive vertices:

$$
L=\sum_{i=1}^{n-1}
\sqrt{(x_{i+1}-x_i)^2+(y_{i+1}-y_i)^2}.
$$

**Long-axis azimuth (polylines and polygons).** This describes the overall orientation of the geometry. petro-image finds the minimum-area bounding rectangle around the vertices' convex hull and uses the direction of its longer side. For a straight polyline, this is the direction of the line; for a bent polyline, it describes the orientation of the polyline's overall footprint rather than any individual segment.

Azimuth is measured clockwise from the top of the image and reported from \(0^\circ\) to less than \(180^\circ\). Opposite directions along the same axis are equivalent.

### Polygon properties

**Area (polygons only).** The enclosed two-dimensional area is calculated from the polygon vertices using the shoelace formula:

$$
A=\frac{1}{2}\left|
\sum_{i=1}^{n}(x_i y_{i+1}-x_{i+1}y_i)
\right|,
$$

where the final vertex is connected back to the first. For polygon geometries that contain holes, hole areas are subtracted from the exterior area.

**Perimeter (polygons only).** The perimeter is the sum of the lengths of all boundary segments, including the closing segment from the final vertex to the first:

$$
P=\sum_{i=1}^{n}
\sqrt{(x_{i+1}-x_i)^2+(y_{i+1}-y_i)^2}.
$$

For polygon geometries that contain holes, the boundaries of the holes are also included.

**Equivalent circular diameter (ECD; polygons only).** ECD is the diameter of a circle having the same area as the measured polygon:

$$
D_{\mathrm{ECD}}=2\sqrt{\frac{A}{\pi}}.
$$

**Long axis and short axis (polygons only).** petro-image finds the minimum-area bounding rectangle around the polygon's convex hull. The long axis is the longer side of this rectangle and the short axis is the shorter side. These are bounding-box dimensions, not axes fitted by an ellipse or by principal-component analysis.

**Short/Long (polygons only).** This dimensionless aspect ratio is

$$
R=\frac{D_{\mathrm{short}}}{D_{\mathrm{long}}}.
$$

It ranges from 0 to 1 for a non-degenerate polygon. Values nearer 1 indicate more equant shapes, whereas smaller values indicate more elongate shapes.

**Maximum Feret diameter (polygons only).** The maximum Feret diameter is the greatest distance between any two points on the polygon's convex hull:

$$
D_{\mathrm{F,max}}=\max_{p,q\in H}\lVert p-q\rVert,
$$

where \(H\) is the convex hull. petro-image also calculates and stores the azimuth of the vertex pair that defines this diameter, using the same azimuth convention as the long axis.

**Minimum Feret diameter (polygons only).** The minimum Feret diameter is the smallest caliper width of the convex hull: the minimum separation between two parallel supporting lines as their orientation is varied.

**Solidity (polygons only).** Solidity compares the polygon area with the area of its convex hull:

$$
S=\frac{A}{A_{\mathrm{hull}}}.
$$

A convex polygon has a solidity of 1. Indentations and concavities reduce the value.

**Circularity (polygons only).** Circularity compares polygon area and perimeter:

$$
C=\frac{4\pi A}{P^2}.
$$

A perfect circle has a circularity of 1. More elongate, irregular, or rough-edged boundaries generally have lower values.

### Geometry validity

For polygons, petro-image checks the digitized boundary for self-intersections. If a polygon self-intersects, its area is ambiguous; area-dependent properties (area, ECD, solidity, and circularity) are therefore not calculated. The perimeter and properties based on the polygon vertices or convex hull remain available, and the result is marked with a geometry warning.

## Outputs

Individual measurements can be reviewed in a table, filtered, plotted, and exported. Depending on geometry type and calibration, outputs include:

- Polyline length
- Polyline and polygon long-axis azimuth
- Polygon area, perimeter, and equivalent circular diameter
- Polygon long and short axes and aspect ratio
- Polygon maximum and minimum Feret diameters
- Polygon solidity and circularity
- Geometry type, group, identifiers, validity information, and associated summary statistics
