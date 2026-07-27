# Managing libraries and projects

## Libraries and projects

A petro-image **library** is a JSON document that describes samples, tile sets,
image locations, scale calibration, and related metadata. A desktop
**project** is a folder containing a library and the files used by local
workflows, such as Deep Zoom imagery and working annotation or count files.

The web viewer can load a library whose image locations are reachable by the
browser. The desktop app can additionally open project folders and write
changes to local library files.

## Load a library

**Availability:** web viewer and desktop app.

Choose **Actions → Load Library**, then select a supported library JSON file.
The selected library replaces the active library and populates the group and
sample menus.

Before switching libraries, export or save work that must be retained.
petro-image warns before discarding recognized unsaved work. In the web
viewer, loading the JSON does not grant access to arbitrary local image files;
the image addresses in the library must still be accessible to the browser.

See the [Library JSON reference](../reference/formats/library-json.md) for the
file structure and the [importing guide](../importing/index.md) for preparing
web-hosted libraries.

## Open a project

**Availability:** desktop app only.

Choose **Actions → Open Project** to select or switch the active project
folder. The desktop app loads that project's library and uses the project for
local workflows and working files.

Changing projects replaces the current library context. Complete or export
important work first and respond to any unsaved-work warning before
continuing. Project files should be stored on a disk location that remains
locally available. Cloud-storage placeholders that have not been downloaded
can make Deep Zoom tiles unavailable.

## Edit a library

**Availability:** desktop app only.

Choose **Actions → Edit Library** to update the active library. The editor can:

- Search, reorder, and remove samples.
- Edit a sample's title, description, groups, `pixelsPerMeter`, initial
  rotation, and annotation GeoJSON locations.
- Edit tile-set labels, types, ordering, image locations, acquisition angles,
  and rotation behavior.
- Save changes to the active library or create another library with **Save
  As**.

Select a sample in the list before editing its fields. Groups are separated by
semicolons, while annotation GeoJSON locations are entered one per line.
Choose **Edit Tile Sets** for the selected sample's image-layer metadata.

Use:

- **Apply** to save the current draft and keep the editor open.
- **Apply and Close** to save and close the editor.
- **Save As** to write the edited library to a new JSON file.
- **Cancel** to close without applying the current draft.

A library must retain at least one sample. Every sample must have a title and
at least one tile set, and `pixelsPerMeter`, when supplied, must be positive.

Removing a sample removes its entry from the library only. It does not delete
the sample's image tiles (unless "Delete local DZI files if this tile set is removed" is selected), annotation files, or other source files. Changes are
not written until one of the save or apply operations succeeds.

## Related documentation

- [Import Samples](../importing/index.md#import-with-the-desktop-app)
- [Add Scale](add-scale.md)
- [Library JSON](../reference/formats/library-json.md)
- [Annotation GeoJSON](../reference/formats/annotations-geojson.md)
