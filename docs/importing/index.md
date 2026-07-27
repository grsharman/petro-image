# Using your own images

For most users, the **desktop app is the recommended way to bring images into petro-image**. It can convert local image files to Deep Zoom, place the generated files in a project, and add the sample metadata to a petro-image library. This avoids manually creating DZI pyramids, editing JSON, hosting files, or configuring a web server.

Web-hosted libraries remain useful when a collection needs to be shared through the hosted viewer or embedded in another website. That workflow is described after the desktop workflow.

## Import with the desktop app

Use the desktop app when you are working with files on your computer, building a personal or laboratory collection, or preparing a library before publishing it elsewhere.

### Before importing

Prepare one or more images of a specimen. Images that represent different lighting conditions or acquisition angles should:

- Show the same specimen extent.
- Have the same pixel dimensions.
- Be registered so that corresponding pixels represent corresponding locations.

Determine pixel dimensions if measurements in physical units are needed. Alternatively, you can use the [Add Scale action](../actions/add-scale.md) to calibrate to a scalebar on the image. For multi-angle imagery (e.g., multiple angles of cross-polarized light), also retain the acquisition angle and polarization mode for each image.

### Basic workflow

1. Open or create a project in the desktop app.
2. Choose **Actions → Import Samples**.
3. Enter the sample title, optional description, scale, and groups.
4. Add one or more tile sets and select the corresponding local image files.
5. Add labels, acquisition angles, and rotation behavior where appropriate.
6. Choose whether to add the sample to the current library, create a new library, or update another library.
7. Run the import and inspect the sample after it opens.

The importer converts source images into tiled Deep Zoom pyramids and updates the selected library JSON. Keeping those files together in a project makes the collection portable and avoids external hosting requirements during local use.

See [Managing libraries and projects](../actions/managing-libraries-and-projects.md)
for the difference between loading a library, opening a project, and editing
the active library.

**Important:** We recommend not saving your project on cloud storage unless you specify that files are always downloaded on your device. The Deep Zoom tiles must be readily accessible by the app, and the app is likely to crash if the tiles are hosted only in the cloud.

### Specialized formats

The desktop app includes specialized beta import support for:

- Single-scene, two-dimensional CZI files from the Zeiss AxioScan 7 Geo
- JPEG 2000 still images

The AxioScan workflow discovers available lighting channels, preserves their shared registered extent, and can organize multiple PPL or XPL angles into rotation-aware tile sets.

JPEG 2000 files are converted to a standard Deep Zoom pyramid. The current derivative uses 8-bit, quality-90 JPEG tiles, so 16-bit precision, alpha, and lossless source encoding are not retained.

The AxioScan importer currently supports single-scene, two-dimensional scans. It rejects Z-stacks, time series, multiple scenes, and other general CZI layouts. Packaged desktop releases contain the required conversion worker, so users do not need to install Python.

The JPEG 2000 importer supports `.jp2`, `.j2k`, `.j2c`, `.jpc`, `.jpx`, and `.jpf` still images. Complex multi-codestream JPX compositions, JPM compound documents, and Motion JPEG 2000 files are not supported.

### Check the imported sample

Before beginning analysis:

- Confirm that every expected tile set appears.
- Compare layers at several widely separated locations to check registration.
- Verify labels and acquisition angles.
- Confirm that the scale bar or a known distance has the expected value.
- Rotate any angle-aware tile sets through their full period.
- Check that the sample belongs to the intended groups.

## Publish a library for the web viewer

Use a web-hosted library when other users should be able to open the collection without having access to your local project folder.

The general route is:

1. Prepare and register the source images.
2. Use the desktop app or another converter to create a `.dzi` descriptor and tiled-image directory for each image.
3. Upload the DZI files and tile directories to a web-accessible location.
4. Upload or create a petro-image library JSON file that points to the hosted DZI URLs.
5. Open the library URL in the petro-image web viewer.

The server hosting the library JSON and Deep Zoom images must allow them to be loaded by webpages on other domains. This browser permission is called Cross-Origin Resource Sharing, or CORS. If a file opens directly in a browser but does not load in petro-image, check the hosting server's CORS settings.

The [current library JSON reference](../reference/formats/library-json.md) contains a complete example with groups, sample metadata, tile sets, acquisition angles, and rotation behavior.

## Before publishing a library

Check at least the following:

- Every library, DZI, and image-tile URL is reachable.
- Cross-origin requests are allowed where needed.
- Registered layers have matching dimensions and spatial alignment.
- `pixelsPerMeter` describes the displayed derivative rather than an earlier source resolution.
- Acquisition angles and periods are expressed consistently.
- Every sample has a unique `sampleId` that remains unchanged after publication.

The last point matters because URLs and embedding applications can use `sampleId` to select a specimen. A stable identifier continues to refer to the same sample if its title or description changes. The desktop importer creates this identifier automatically. For a manually authored library, store a valid, unique `sampleId` in the JSON rather than relying on the temporary identifier petro-image creates in memory when one is missing.
