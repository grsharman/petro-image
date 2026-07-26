# Library JSON

A library JSON file tells petro-image which samples and image layers are available. The desktop importer creates and updates this file automatically. A manually authored library must follow the same structure.

## Minimal example

```json
{
  "format": "v1",
  "samples": [
    {
      "sampleId": "4m7k2p9x",
      "title": "Example sample",
      "groups": ["Teaching"],
      "pixelsPerMeter": 398000,
      "tileSets": [
        {
          "label": "PPL",
          "tiles": [
            {
              "uri": "images/example-ppl.dzi"
            }
          ]
        }
      ]
    }
  ]
}
```

Relative image and annotation paths are resolved relative to the library file. For a web library, the library, DZI descriptors, and DZI tile directories must be reachable by the viewer. Servers on a different origin must permit cross-origin requests.

## Library object

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `format` | string | Recommended | Current library format identifier. New libraries use `"v1"`. |
| `samples` | array of sample objects | Yes | Samples available in the library. |

Unrecognized top-level attributes are preserved when the desktop library editor saves the library.

## Sample object

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `sampleId` | string | Recommended | Stable sample identifier. Use an eight-character petro-image ID or a UUID. The desktop importer creates an ID automatically. |
| `title` | string | Yes | User-facing sample name. Titles should be unique within a library. |
| `description` | string | No | Additional sample description shown by the viewer. |
| `groups` | array of strings | No | Group selectors in which the sample appears. |
| `pixelsPerMeter` | positive number | No | Source-image pixels per physical meter. Required for scale-dependent measurements and scale bars. |
| `rotationDegrees` | number | No | Preferred initial image and stage orientation, normalized to the range 0–360°. Defaults to 0°. |
| `annotations` | string or array of strings | No | Paths or URLs of GeoJSON annotation files associated with the sample. |
| `tileSets` | array of tile-set objects | Yes | One or more displayable image layers. |

`sampleId` should not change when the title, description, groups, or storage location changes. URLs and embedding applications can use it to continue referring to the same sample. If an older library omits IDs, petro-image generates unique in-memory IDs, but these are not persistent unless the library is subsequently saved.

`pixelsPerMeter` is the only supported calibration field. See [Coordinates and units](../coordinates-and-units.md) for conversion equations and calibration requirements.

## Tile-set object

A tile set occupies one display-layer slot. It may contain one image, several images selected discretely, or several acquisition angles interpolated as the stage rotates.

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `label` | string | No | User-facing name for the tile set. |
| `tiles` | array of tile objects | Yes | At least one image definition. |
| `periodDegrees` | number | Rotation-aware sets only | Positive angular repetition period from 1° through 360°. Its presence makes the tile set rotation-aware. |

All images in a multi-image tile set should have matching pixel dimensions, registered specimen extents, and consistent acquisition and processing.

### Single-image tile set

```json
{
  "label": "PPL",
  "tiles": [
    {
      "uri": "images/example-ppl.dzi"
    }
  ]
}
```

### Discrete multi-image tile set

When `periodDegrees` is absent, images are selected one at a time. An optional tile label identifies each choice.

```json
{
  "label": "Reflected light",
  "tiles": [
    {
      "label": "Unpolarized",
      "uri": "images/example-reflected.dzi"
    },
    {
      "label": "Polarized",
      "uri": "images/example-reflected-pol.dzi"
    }
  ]
}
```

### Rotation-aware tile set

When `periodDegrees` is present, each tile supplies its acquisition angle. petro-image orders the images by angle and blends adjacent angles during stage rotation.

```json
{
  "label": "XPL",
  "periodDegrees": 90,
  "tiles": [
    {
      "uri": "images/example-xpl-00.dzi",
      "angleDegrees": 0
    },
    {
      "uri": "images/example-xpl-30.dzi",
      "angleDegrees": 30
    },
    {
      "uri": "images/example-xpl-60.dzi",
      "angleDegrees": 60
    }
  ]
}
```

## Tile object

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `uri` | string | Yes | Path or URL of the image source, normally a Deep Zoom `.dzi` descriptor. |
| `label` | string | No | User-facing name used for a tile in a discrete multi-image set. |
| `angleDegrees` | number | Rotation-aware sets only | Acquisition angle from 0° through 360°. |

## Complete example

```json
{
  "format": "v1",
  "samples": [
    {
      "sampleId": "4m7k2p9x",
      "groups": ["Favorites", "Teaching"],
      "title": "MT-2 02",
      "description": "Example metamorphic thin section",
      "pixelsPerMeter": 398000,
      "rotationDegrees": 90,
      "annotations": [
        "annotations/mt-2-grains.geojson"
      ],
      "tileSets": [
        {
          "label": "PPL",
          "tiles": [
            {
              "uri": "images/mt-2-ppl.dzi"
            }
          ]
        },
        {
          "label": "XPL",
          "periodDegrees": 90,
          "tiles": [
            {
              "uri": "images/mt-2-xpl-00.dzi",
              "angleDegrees": 0
            },
            {
              "uri": "images/mt-2-xpl-30.dzi",
              "angleDegrees": 30
            },
            {
              "uri": "images/mt-2-xpl-60.dzi",
              "angleDegrees": 60
            }
          ]
        }
      ]
    }
  ]
}
```

## Publishing checks

- Every sample has a nonempty title and at least one tile set.
- Every tile set contains at least one tile with a valid `uri`.
- Every `sampleId` is valid, unique, and persistent.
- `pixelsPerMeter`, when present, is positive and describes the displayed derivative.
- `periodDegrees` is between 1 and 360.
- `angleDegrees` values are finite and between 0 and 360.
- Registered layers have matching dimensions and spatial alignment.
- Web servers permit the library, DZI descriptors, and tiles to be loaded by the petro-image origin.

See [Using your own images](../../importing/index.md) for the recommended desktop workflow and web-publishing process.
