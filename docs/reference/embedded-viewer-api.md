# Embedded viewer API

The web viewer supports URL selection and a versioned `postMessage` API for an application that embeds petro-image in an iframe.

## Open a library and select a sample

The viewer recognizes these URL query parameters:

| Parameter | Description |
| --- | --- |
| `library` | HTTP(S) URL of a library JSON file. Cross-origin access must be allowed. |
| `group` | Initial group. With `embed=1`, only this group is exposed in the group selector. |
| `sample` | Initial sample matched against `sampleId`, legacy `id`, or title. |
| `embed=1` | Enables the restricted embedded-viewer presentation and prevents visitors from loading a different local library. |

```text
https://grsharman.github.io/petro-image/?library=https%3A%2F%2Fexample.org%2Fcollection.json&group=Teaching&sample=PA-000184&embed=1
```

Encode a nested library URL before placing it in the viewer URL.

## Trust and versioning

petro-image accepts commands only from:

- the window that embedded it; and
- the exact origin obtained from `document.referrer`.

Commands from other windows or origins are ignored. Accepted command envelopes use:

```js
{
  source: "petro-image-host",
  version: 1,
  type: "viewer.setViewport",
  requestId: "question-2-start"
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `source` | string | Yes | Must be `"petro-image-host"`, identifying a command sent by the embedding application. |
| `version` | number | Yes | Must be `1`. |
| `type` | string | Yes | One of the supported command names. |
| `requestId` | string or number | No | Returned with the command result so the caller can correlate requests. |
| `sampleId` | string | No | If present, must match the active sample's ID, legacy ID, or title. |
| `title` | string | No | If present, must exactly match the active sample title. |

The embedding page should normally wait for `viewer.sampleChanged` before sending sample-specific commands.

## Commands

### `viewer.setLibrary`

Replaces the active library with a library JSON object supplied directly by the
embedding application. This is useful when the host has already fetched and
filtered a larger library.

```js
petroImageFrame.contentWindow.postMessage(
  {
    source: "petro-image-host",
    version: 1,
    type: "viewer.setLibrary",
    requestId: "filtered-library",
    library: {
      format: "v1",
      samples: [
        {
          sampleId: "4m7k2p9x",
          title: "Teaching sample 1",
          groups: ["Teaching"],
          tileSets: [
            {
              label: "PPL",
              tiles: [
                { uri: "https://example.org/images/sample-1-ppl.dzi" },
              ],
            }
          ],
        },
      ],
    },
  },
  petroImageOrigin
);
```

`library` must follow the [Library JSON](formats/library-json.md) format and
contain at least one sample. Each sample must have a title and at least one tile
set, and each tile set must contain at least one tile URI. Use absolute tile and
annotation URLs in a directly supplied object because it has no library-file
URL against which relative paths can be resolved.

The command succeeds after the library and selectors have been replaced. Its
result includes `sampleCount` and `format`. Image loading continues
asynchronously; wait for the subsequent `viewer.sampleChanged` event before
sending sample-specific commands.

### `viewer.setAnnotations`

Replaces or appends a GeoJSON annotation layer.

```js
petroImageFrame.contentWindow.postMessage(
  {
    source: "petro-image-host",
    version: 1,
    type: "viewer.setAnnotations",
    requestId: "question-1-annotations",
    sampleId: "4m7k2p9x",
    annotations: featureCollection,
    options: {
      mode: "replace",
      canSelect: true,
      canEdit: false,
      selectionMode: "multiple",
      visible: true,
      labelsVisible: true,
      selectImported: false
    }
  },
  petroImageOrigin
);
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | `"replace"` or `"append"` | `"replace"` | Replace the current annotations or append imported features. |
| `canSelect` | boolean | `true` | Permit selection of imported annotations. |
| `canEdit` | boolean | `true` | Permit editing of imported annotations. |
| `selectionMode` | `"single"` or `"multiple"` | `"single"` | In multiple mode, an ordinary click toggles an annotation in the selection. |
| `visible` | boolean | `true` | Show the annotation layer after loading. |
| `labelsVisible` | boolean | `true` | Show annotation labels after loading. |
| `selectImported` | boolean | `false` | Select imported annotations after loading. |
| `readOnly` | boolean | — | Legacy option. `true` without explicit capabilities creates fully locked annotations. |

`canSelect` and `canEdit` are independent. The petro-image lock control remains stronger: a locked annotation cannot be selected or edited.

### `viewer.setViewport`

Fits the viewer to source-image pixel bounds.

```js
petroImageFrame.contentWindow.postMessage(
  {
    source: "petro-image-host",
    version: 1,
    type: "viewer.setViewport",
    requestId: "question-2-start",
    sampleId: "4m7k2p9x",
    bounds: {
      x: 9000,
      y: 4000,
      width: 6000,
      height: 6000
    },
    options: {
      padding: 0.1,
      rotationDegrees: 0,
      immediately: false
    }
  },
  petroImageOrigin
);
```

`x`, `y`, `width`, and `height` must be finite; width and height must be
positive. Bounds must intersect the active image, but may extend beyond its
edges. The complete rectangle is fitted without clamping so a previously
captured viewport preserves its center and zoom.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `padding` | number | `0` | Fractional padding around each side, clamped from 0 through 2. |
| `rotationDegrees` | number | Current rotation | Set viewer rotation before fitting bounds. |
| `immediately` | boolean | `false` | Apply the viewport change without animation. |

### `viewer.focusAnnotation`

Fits the viewer to one or more loaded annotations.

```js
petroImageFrame.contentWindow.postMessage(
  {
    source: "petro-image-host",
    version: 1,
    type: "viewer.focusAnnotation",
    requestId: "question-1-start",
    labels: ["Grain A", "Grain B", "Grain C"],
    options: {
      padding: 0.5,
      minimumBoundsRatio: 0.06,
      immediately: false,
      select: false
    }
  },
  petroImageOrigin
);
```

Supply at least one selector:

| Field | Type | Description |
| --- | --- | --- |
| `label` | string | One annotation label. |
| `labels` | array of strings | Several annotation labels. |
| `uuid` | string | One annotation UUID. |
| `uuids` | array of strings | Several annotation UUIDs. |

The viewport encloses the combined bounds of all matches. The viewport options
are the same as for `viewer.setViewport`; `select: true` also selects the matched
annotations. For point or line annotations whose combined bounds have zero
width or height, `minimumBoundsRatio` expands each zero dimension symmetrically
to the specified fraction of the active image's corresponding dimension. For
example, `0.06` gives a point bounds that is 6% of the image width by 6% of the
image height.

### `viewer.resetViewport`

Returns to the whole-image home view.

```js
petroImageFrame.contentWindow.postMessage(
  {
    source: "petro-image-host",
    version: 1,
    type: "viewer.resetViewport",
    requestId: "question-reset",
    options: {
      rotationDegrees: 0,
      immediately: false
    }
  },
  petroImageOrigin
);
```

## Events

Events sent by petro-image use:

```js
{
  source: "petro-image",
  version: 1,
  type: "viewer.sampleChanged"
}
```

| Event | Important payload fields | Meaning |
| --- | --- | --- |
| `viewer.apiReady` | `commands`, `annotationFormat`, `viewportCoordinateSpace` | The command API is ready. |
| `viewer.sampleChanged` | `sampleId`, `title`, `group` | Initial sample selection or a later selection change. |
| `viewer.annotationsLoaded` | `sampleId`, `title`, `featureCount`, `totalFeatureCount`, `mode` | An annotation command finished loading features. |
| `viewer.annotationsChanged` | `sampleId`, `title`, `annotations` | A committed annotation create, edit, delete, clear, undo, or redo changed the active GeoJSON `FeatureCollection`. |
| `viewer.viewportChanged` | `sampleId`, `title`, `bounds`, `rotationDegrees` | The visible viewport settled after a pan, zoom, rotation, resize, or viewport command. |
| `viewer.commandSucceeded` | `requestId`, `command`, command-specific result fields | A trusted command completed. |
| `viewer.commandFailed` | `requestId`, `command`, `error.code`, `error.message` | A trusted command was rejected or failed. |

Every trusted command produces either `viewer.commandSucceeded` or `viewer.commandFailed`. Domain-specific events may be emitted in addition to the generic result.

`viewer.annotationsChanged` is not emitted while petro-image handles
`viewer.setAnnotations`, preventing an inbound synchronization update from
being echoed back to the host.

`viewer.viewportChanged` reports the visible rectangle in source-image pixels:

```js
{
  source: "petro-image",
  version: 1,
  type: "viewer.viewportChanged",
  sampleId: "4m7k2p9x",
  title: "Teaching sample 1",
  bounds: {
    x: 9000,
    y: 4000,
    width: 6000,
    height: 3375
  },
  rotationDegrees: 0
}
```

The event is emitted after interactive pan and zoom motion settles, rather than
for every animation frame. Its bounds describe the visible, unrotated viewport
rectangle; `rotationDegrees` records the rotation separately. Save
`bounds.x`, `bounds.y`, `bounds.width`, `bounds.height`, and `rotationDegrees`
with the teaching-set item, then pass the saved values back to
`viewer.setViewport` to restore the view. Bounds can extend beyond the image at
the home zoom when the viewer and image have different aspect ratios.

## Coordinate format

Annotation geometry and viewport bounds use source-image pixels. See [Coordinates and units](coordinates-and-units.md) and [Annotation GeoJSON](formats/annotations-geojson.md).
