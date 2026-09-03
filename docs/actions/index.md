# Actions and workflows

The petro-image Actions menu contains workflows for loading and managing data,
calibrating samples, updating existing annotations, and getting help. Unlike
the [Tools menu](../tools/index.md), Actions generally operate on a library,
project, or existing records rather than creating a new measurement or image
analysis.

Some Actions are available only in the desktop app because they read or write
project files on the local computer.

| Action | Purpose | Web viewer | Desktop app |
| --- | --- | :---: | :---: |
| [Load Library](managing-libraries-and-projects.md#load-a-library) | Open a library JSON file | Yes | Yes |
| [Open Project](managing-libraries-and-projects.md#open-a-project) | Switch to another project folder and its library | No | Yes |
| [Project Information](managing-libraries-and-projects.md#view-project-information) | View or reveal the active project folder | No | Yes |
| [Import Samples](../importing/index.md#import-with-the-desktop-app) | Convert source images and add samples to a library | No | Yes |
| [Add Scale](add-scale.md) | Calibrate a sample from a visible scalebar | No | Yes |
| [Label Grains from Counts](label-grains-from-counts.md) | Assign polygon groups from point-count labels | Yes | Yes |
| [Transfer Values](transfer-values.md) | Copy annotation values into containing polygons | Yes | Yes |
| [Edit Library](managing-libraries-and-projects.md#edit-a-library) | Edit, reorder, or remove samples and tile sets | No | Yes |
| [Import AxioScan 7 CZI](../importing/index.md#specialized-formats) | Convert supported polarization channels to Deep Zoom | No | Yes |
| Quick Tour | Review the main viewer controls | Yes | Yes |
| About petro-image | View version, citation, authors, license, and project links | Yes | Yes |

The AxioScan 7 CZI importer and some analytical features are beta
functionality. Review the limitations in the linked documentation before
using their outputs.

## Actions that change data

Before applying an Action, note which records it can change:

- **Add Scale** writes `pixelsPerMeter` for the active sample to a library JSON
  file.
- **Label Grains from Counts** adds point-count join metadata to eligible polygon
  annotations and may change their groups.
- **Transfer Values** adds transfer metadata to eligible polygon annotations
  and may change their label, notes, or group.
- **Edit Library** writes library and tile-set metadata. Removing a sample from
  the library does not automatically delete its image or annotation files, unless that option is specifically chosen.

Label Grains from Counts and Transfer Values provide a non-modifying
**Preview** step.
Use it to check matched, conflicting, unmatched, and ambiguous records before
choosing **Apply**. Applied annotation changes enter the annotation undo
history. In the web viewer, export work that must be retained; in the desktop
app, annotation edits are saved to the active sample's working annotation
file.

## Related documentation

- [Using your own images](../importing/index.md)
- [Library JSON](../reference/formats/library-json.md)
- [Annotation GeoJSON](../reference/formats/annotations-geojson.md)
- [Coordinates and units](../reference/coordinates-and-units.md)
- [Tools and analytical methods](../tools/index.md)
