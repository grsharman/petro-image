# Transfer Values

## Purpose

Transfer Values copies annotation labels, notes, or group names to polygon
annotations that contain the source annotations. It can connect observations
recorded as points or other small annotations with larger segmented or
digitized regions.

**Availability:** web viewer and desktop app.

## Inputs and prerequisites

The active sample needs:

- Unlocked source annotations chosen by selection or annotation group.
- Unlocked target Polygon or MultiPolygon annotations chosen by selection or
  group.
- Source and target coordinates in the same source-image pixel space.

The same feature is never joined to itself. Locked source and target
annotations are excluded.

## Procedure

1. Choose **Actions → Transfer Values**.
2. Choose the source annotations and target polygons by current selection or
   annotation group.
3. Select the source property to read: label, notes, or group.
4. Select the target property to write: label, notes, or group.
5. Configure an optional dictionary, conflict handling, and existing-value
   behavior.
6. Choose **Preview** and review the summary.
7. Resolve unexpected outside or ambiguous sources, then choose **Apply**.

Preview runs the transfer without changing annotations. Changing an option
clears the preview and requires it to be run again.

## Matching rule

petro-image identifies a representative center for each source annotation and
tests whether that point falls inside each eligible target polygon. The center
is the feature's editing/move coordinate when available; otherwise it is the
center of the feature's image-coordinate bounding box.

A source can therefore match more than one target when target polygons
overlap. Preview reports these ambiguous sources as well as sources outside
every target.

## Value mapping

An optional JSON dictionary maps exact source values to output values:

```json
{
  "Q": "Quartz",
  "F": "Feldspar",
  "L": "Lithic fragment"
}
```

Values not present in the dictionary pass through unchanged. Empty source
values do not supply a value. The most recently entered dictionary is retained
in local application storage for later use in the same viewer environment.

## Conflicts and existing values

A target is **matched** when all non-empty source values within it resolve to
one value. It is a **conflict** when they resolve to different values, and it
is **unmatched** when it receives no non-empty source value.

For conflicts, choose one of:

- **Leave target unchanged**: do not apply a conflicting value.
- **Assign to Review group**: move the target to the named review group.
- **Join unique values**: combine unique values with semicolons.

When writing labels or notes, existing values can be overwritten, filled only
when blank, or appended. Appending does not add a value that already appears
in the existing text. When writing groups, the target is assigned directly to
the resulting group; the existing-value setting does not apply to group
membership.

## Changes and audit metadata

Apply adds an `annotationJoin` object to every evaluated target polygon. It
records the match mode, source UUIDs, source labels and notes, raw and mapped
values, join status, applied value, source and target properties, and conflict
and existing-value settings.

Applied changes enter the annotation undo history. In the web viewer, export
the annotations before ending the session. In the desktop app, the updated
annotations are saved to the sample's working annotation file.

## Limitations

- Matching uses one representative center per source rather than testing the
  source's complete geometry.
- Bounding-box centers can fall outside irregular or concave source
  geometries.
- Results depend on source and target coordinates being registered.
- Overlapping target polygons can receive the same source.
- Dictionary matching is exact and case-sensitive.

## Related documentation

- [Annotate](../tools/annotate.md)
- [Label Grains from Counts](label-grains-from-counts.md)
- [Annotation GeoJSON](../reference/formats/annotations-geojson.md)
- [Coordinates and units](../reference/coordinates-and-units.md)
