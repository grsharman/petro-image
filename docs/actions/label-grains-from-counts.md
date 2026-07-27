# Label Grains from Counts

## Purpose

Label Grains from Counts assigns annotation groups to grain polygons using point-count
labels that fall inside them. It is useful for relating point counting and grain
segmentation results.

**Availability:** web viewer and desktop app.

## Inputs and prerequisites

The active sample needs:

- Point-count features with classification identifiers.
- Unlocked Polygon or MultiPolygon annotations representing grains.
- Registered count and annotation coordinates in the same source-image pixel
  space.

The Action does not modify the point counts. Locked polygon annotations are
excluded.

## Procedure

1. Choose **Actions → Label Grains from Counts**.
2. Choose all grain polygons, selected polygons, or polygons in one annotation
   group.
3. Decide whether to include only the labels enabled under **Count Select**.
4. Configure label parsing and an optional dictionary.
5. Choose how conflicting and uncounted grains should be grouped.
6. Choose **Preview** and review the summary.
7. Resolve unexpected outside or ambiguous counts, then choose **Apply**.

Preview runs the join without changing annotations. Changing an option clears
the preview and requires it to be run again.

## Label interpretation

By default, petro-image uses the complete, case-sensitive point-count
identifier. **Use character position** instead extracts one character from
each identifier; positions shown in the dialog begin at 1. This feature can be useful when codes are used for point-counting (e.g., AG = quartz within a plutonic rock fragment).

An optional JSON dictionary can expand codes:

```json
{
  "A": "Quartz",
  "F": "Feldspar",
  "L": "Lithic fragment"
}
```

Dictionary keys are matched exactly. A code missing from the dictionary
remains unchanged rather than being discarded. The most recently entered
dictionary is retained in local application storage for later use in the same
viewer environment.

## Spatial join and grouping

Each included point is tested against every eligible grain polygon:

- A grain containing no included point is **uncounted**.
- A grain whose included points all resolve to one non-empty label is
  **matched** and is assigned to the group with that label.
- A grain containing different interpreted labels is a **conflict** and is
  assigned to the named review group.

Uncounted grains can retain their current group or be assigned to an
`Uncounted` group. If a required group does not exist, petro-image creates it.

Preview also reports points outside all eligible grains and points contained
by multiple grains. Multiple matches commonly indicate overlapping polygons
and should be reviewed before applying the result.

## Changes and audit metadata

Apply adds a `countJoin` object to every evaluated grain polygon. It records
the join status, source count UUIDs, raw and interpreted labels, label counts,
and whether mixed labels were found. The Action then changes groups according
to the selected conflict and uncounted rules.

Applied changes enter the annotation undo history. In the web viewer, export
the annotations before ending the session. In the desktop app, the updated
annotations are saved to the sample's working annotation file.

## Limitations

- Points on boundaries or within overlapping grains need particular review.
- One count point may classify more than one polygon when polygons overlap.

## Related documentation

- [Grid & Count](../tools/grid-and-point-count.md)
- [Annotate](../tools/annotate.md)
- [Annotation GeoJSON](../reference/formats/annotations-geojson.md)
- [Coordinates and units](../reference/coordinates-and-units.md)
