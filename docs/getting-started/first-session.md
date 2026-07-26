# Your first petro-image session

This short walkthrough introduces the main viewer without requiring you to prepare or upload any data. Use the [hosted web viewer](https://grsharman.github.io/petro-image/) and choose one of the included specimens.

## 1. Select a specimen

Use the first menu to select a group of specimens and the second menu to select a sample. Choosing **All** as the group makes every available sample visible in the sample menu.

After a sample loads, zoom with the mouse wheel or trackpad and drag to pan. Deep Zoom tiling allows petro-image to retrieve more image detail as you move closer to an area.

## 2. Explore the available image layers

A specimen can contain several registered views, such as plain-polarized light (PPL), cross-polarized light (XPL), reflected light, or cathodoluminescence. Use the layer controls to turn individual views on and off.

When **Divide Images** is enabled, the visible layers occupy different regions whose boundaries follow the pointer. This is useful for comparing the same feature under different imaging conditions. When divided images are disabled, the layers are superimposed and their opacity can be adjusted to allow viewing multiple images at the same time.

## 3. Rotate the view

Use the rotation control to change the image orientation. When the sample has no rotation-aware tile set, Ctrl-scroll changes image rotation.

Some image sets contain multiple acquisition angles. In those sets, you have the ability to control stage and image rotation independently. Rotating the stage will blend images that have multiple acquisition angles, an effect that mimics the view under a petrographic microscope. Selecting **Lock stage** will rotate the image and stage together. When rotation-aware imagery is available, Ctrl-scroll changes stage rotation and changes image rotation only when **Lock stage** is enabled.

## 4. Try one analysis tool

Choose a small, recognizable feature and try one of these:

- **Measure** to determine a length or area.
- **Annotate** to outline and label a feature.
- **Grid** to generate sampling locations.
- **Count** to classify features beneath grid crosshairs.

These tools serve different scientific tasks. See [Tools and analytical methods](../tools/index.md) before starting work that you intend to save or reproduce.

## 5. Understand what is saved

The hosted web viewer can import and export supported files, but browser state should not be treated as permanent project storage. Export work that you need to retain before you close your browser window.

The desktop app adds project-oriented storage. For example, working annotation and point-count files are saved automatically for the active sample while remaining separate from explicit export files.

## Next steps

- Learn about [viewing and comparing images](../user-guide/viewing-and-comparing.md).
- Choose a [tool](../tools/index.md).
- Learn how to [use your own images](../importing/index.md).
- Read the [Polarization Analysis overview](../tools/polarization-analysis.md).
