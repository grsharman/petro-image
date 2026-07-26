# Viewing and comparing images

petro-image displays one or more images of the same specimen in a shared coordinate system.

## Selecting samples

The group menu narrows the available specimens. The sample menu selects the specimen to display. A sample description may also be available in the viewer.

Locally or remotely hosted libraries can supply their own groups, samples, descriptions, image locations, scale information, and acquisition metadata. See [Using your own images](../importing/index.md).

## Navigating a high-resolution image

Pan by dragging and zoom with the mouse wheel, trackpad, or viewer controls. petro-image uses OpenSeadragon and the Deep Zoom format to request tiled image regions at an appropriate resolution.

Vector annotations use image-pixel coordinates. Zooming, panning, and viewport rotation change the display but do not rewrite the underlying annotation coordinates.

## Comparing layers

Any number of simultaneously visible image layers, or tile sets, may be used for a given specimen. The first visible image acts as the base, with later images drawn above it.

There are two principal comparison modes:

- **Divided images** assign layers to separate regions of the viewport. Moving the pointer changes the boundaries and reveals corresponding parts of each layer.
- **Superimposed images** place registered layers over one another. Adjusting opacity can reveal agreement, differences, or misregistration.

![Vertically superimposed image layers](../../assets/layer_explanation_v2.png)

## Rotation and acquisition angle

Viewport rotation changes how an image is displayed. A sample can have a defined initial orientation, but this does not alter its image-pixel coordinate system.

For tile sets that represent imagery collected at a particular polarization angles, a "Stage angle" option will be displayed. Changing the stage angle will blend adjacent tile sets to mimic rotating the stage of a petrographic microscope.

## Keyboard controls

Common controls include:

| Control | Action |
| --- | --- |
| Ctrl-scroll | Change image rotation; with rotation-aware imagery, change stage rotation and change image rotation only when **Lock stage** is enabled |
| Ctrl/Alt-`1` through `9` | Toggle the corresponding tile set |
| Ctrl/Alt-Shift-`1` through `9` | Show only the corresponding tile set |
| Alt-`0` | Hide all tile sets |
| Shift-Left/Right | Step through eligible multi-image tile sets |

See the [complete keyboard shortcut reference](../reference/keyboard-shortcuts.md).
