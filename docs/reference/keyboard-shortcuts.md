# Keyboard shortcuts

This is a list of petro-image keyboard and modified-pointer controls. On macOS, Command substitutes for Ctrl only where the table says **Ctrl/Command**. Image-display shortcuts specifically use Control or Option.

## Image display and navigation

| Shortcut | Action |
| --- | --- |
| Scroll | Zoom in or out around the pointer |
| Ctrl-scroll | Change image rotation; if a rotation-aware image is available, change stage rotation and image rotation only if **Lock stage** is enabled |
| Ctrl/Alt-`1` through `9` | Toggle the corresponding tile set |
| Ctrl/Alt-Shift-`1` through `9` | Show only the corresponding tile set |
| Alt-`0` | Hide all tile sets |
| Ctrl/Alt-`D` | Toggle **Divide Images** |
| Shift-Left or Shift-`<` | Show the previous image in every eligible multi-image tile set not controlled by stage rotation |
| Shift-Right or Shift-`>` | Show the next image in every eligible multi-image tile set not controlled by stage rotation |

## Annotation drawing

Hold the indicated letter while clicking or dragging in the image.

| Shortcut | Action |
| --- | --- |
| `Q`-click | Create a point |
| `Z`-click | Add polyline vertices; double-click to finish |
| `X`-click | Add polygon vertices; double-click to finish |
| Alt/Option-drag | Create a rectangle |
| `C`-click | Create an ellipse: click the center, long axis, and short axis |
| `V`-click | Create a circle: click the center and radius; a configured fixed radius creates the circle with one click |
| `L` | Focus the Label field for the selected annotation |
| Escape | Cancel the active drawing state or leave geometry-editing modes |

## Annotation selection and editing

| Shortcut | Action |
| --- | --- |
| Click | Select one annotation in the image or annotation list |
| Ctrl/Command-click | Add or remove one annotation from the selection |
| Shift-drag in the image | Marquee-select annotations, toggling annotations already selected |
| Shift-click in the annotation list | Select a range of annotations |
| Ctrl/Command-`A` in the annotation list | Select all shown, unlocked annotations |
| Up/Down in the annotation list | Select the adjacent annotation |
| Shift-Up/Down in the annotation list | Extend the selection to the adjacent annotation |
| Enter or Space on a focused annotation row | Select that row |
| Delete or Backspace | Delete selected, unlocked annotations |
| Alt/Option-click an editable vertex | Delete that vertex |
| Enter in the Label or Notes field | Save the text edit |
| Escape in the Label or Notes field | Leave the field |

## Undo and redo

| Shortcut | Action |
| --- | --- |
| Ctrl/Command-`Z` | Undo the latest supported edit; while drawing a line or polygon, remove the latest draft vertex first |
| Ctrl/Command-Shift-`Z` | Redo |
| Ctrl-`Y` | Redo on Windows |

## Grid and point counting

| Shortcut | Action |
| --- | --- |
| Ctrl/Alt-`G` | Toggle grid crosshairs |
| Enter in the point-number field | Go to that crosshair |
| Enter in the Identifier field | Record the identifier |
| Enter in the Notes field | Record the notes |
| Space | Go to the next crosshair |
| Shift-Space | Go to the previous crosshair |

Space and Shift-Space also work while the Identifier field is active. They do not navigate while another text-entry field, such as Notes, is active.

## Measurement

| Shortcut | Action |
| --- | --- |
| Double-click while drawing a line or polygon | Complete the measurement |
| Ctrl/Command-click a measurement or result row | Add or remove it from the selection |
| Shift-click a result row | Select a range of measurement results |
| Up/Down on a focused result row | Select the adjacent result |
| Escape | Cancel the active measurement |

## Estimate Porosity and Segment AOIs

| Shortcut | Action |
| --- | --- |
| Double-click or Alt/Option-click an editable AOI edge | Add a vertex |
| Delete or Backspace | Delete the selected Porosity or Segment AOI vertex |
| Delete or Backspace on a selected porosity color sample | Remove that linked sample |

## Transform and Classify

| Shortcut | Action |
| --- | --- |
| Double-click a loaded **Fit at cursor** point | Pin the Transform sample so the pointer can move without changing the plot |
| Escape | Close the Classify image-feature menu |

## Dialogs and guided tours

| Shortcut | Action |
| --- | --- |
| Escape | Close the active help dialog, popover, feature menu, welcome screen, or guided tour |
| Left/Right during the guided tour | Move to the previous or next tour step |
