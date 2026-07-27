# Annotation GeoJSON

petro-image imports and exports annotations as a GeoJSON `FeatureCollection`. Geometry coordinates are source-image pixels.

## Minimal example

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [1200, 800],
            [1800, 850],
            [1700, 1400],
            [1200, 800]
          ]
        ]
      },
      "properties": {
        "uuid": "example-feature-id",
        "label": "Grain A",
        "notes": "Altered margin"
      }
    }
  ]
}
```

## Feature collection

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `type` | string | Yes | Must be `"FeatureCollection"`. |
| `features` | array of feature objects | Yes | Annotation geometries and properties. |

## Feature

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `type` | string | Yes | Must be `"Feature"`. |
| `geometry` | GeoJSON geometry | Yes | Point, line, or area geometry in source-image pixels. |
| `properties` | object | Recommended | Labels, notes, styling, identity, grouping, and application state. |

petro-image may add or normalize properties when a file is imported. Consumers should preserve unrecognized properties when possible.

## Supported geometry types

| Geometry | Coordinate structure | Typical use |
| --- | --- | --- |
| `Point` | `[x, y]` | Point annotation or count location |
| `LineString` | `[[x, y], ...]` | Polyline annotation or measurement |
| `MultiLineString` | Array of line coordinate arrays | Imported multipart linear annotation |
| `Polygon` | Array of closed rings | Polygon, rectangle, ellipse, or circle represented as an area |
| `MultiPolygon` | Array of polygon coordinate arrays | Imported multipart area annotation |

For a polygon ring, the final coordinate should equal the first coordinate. The first ring is the exterior boundary; subsequent rings are holes.

## Common properties

The set of properties depends on how a feature was created and which tool exported it. Common annotation properties include:

| Property | Type | Description |
| --- | --- | --- |
| `uuid` | string | Stable identity of the feature within editing and selection operations. |
| `label` | string | User-facing annotation label. |
| `notes` | string | Free-text notes. |
| `shapeType` | string | petro-image drawing type associated with the geometry. |
| `groupId` | string | Identifier of the annotation group. |
| `groupName` | string | User-facing group name. |
| `locked` | boolean | Prevents normal selection or editing when true. |
| `groupLocked` | boolean | Records lock state inherited from a group. |
| `canSelect` | boolean | Whether an embedding application permits selection. |
| `canEdit` | boolean | Whether an embedding application permits editing. |
| `lineColor` | string | Line color, normally a CSS color value. |
| `lineOpacity` | number | Line opacity. |
| `lineWeight` | number | Line width used by petro-image. |
| `fillColor` | string | Fill color, normally a CSS color value. |
| `fillOpacity` | number | Fill opacity. |
| `countJoin` | object | Audit metadata written by Label Grains from Counts. |
| `annotationJoin` | object | Audit metadata written by the Transfer Values action. |

Style and application-state properties are not part of the GeoJSON standard; they are petro-image extensions stored in the GeoJSON `properties` object.

The [Label Grains from Counts](../../actions/label-grains-from-counts.md) and
[Transfer Values](../../actions/transfer-values.md) Actions add audit metadata
under `countJoin` and `annotationJoin`, respectively.

## Coordinate requirements

- The origin is the upper-left image corner.
- \(x\) increases rightward and \(y\) increases downward.
- Values may be fractional.
- Coordinates should describe the source image associated with the active sample.
- Viewer zoom and rotation must not be applied to exported coordinates.

See [Coordinates and units](../coordinates-and-units.md) for the complete coordinate convention.

## Geometry validity

GeoJSON syntax alone does not guarantee a scientifically meaningful geometry. For example, a polygon boundary may self-intersect. Individual tools document how invalid or degenerate geometry affects their calculations. The [Measure](../../tools/measure.md) page describes the current measurement validity checks.
