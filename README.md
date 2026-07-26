# petro-image

petro-image is an open-source application for exploring and analyzing
high-resolution digital microscopy images. It is designed especially for
petrographic imagery, including registered views acquired with different
illumination and polarization configurations such as one would use with a
petrographic microscope.

**[Open the web viewer](https://grsharman.github.io/petro-image/)**

![Divided-image comparison in petro-image](assets/divide_images3_M.gif)

petro-image uses tiled [Deep Zoom](https://openseadragon.github.io/examples/creating-zooming-images/)
images, so specimens much larger than a computer screen can be explored
interactively without loading the entire full-resolution image at once.

## What can petro-image do?

- Explore and compare one or multiple image layers.
- Move between plain-polarized, cross-polarized, reflected-light, and other
  views of the same specimen.
- Blend layers or reveal them in separate regions of the viewer.
- Measure distance and area.
- Draw, label, import, and export GeoJSON annotations.
- Generate a grid and conduct reproducible point counts.
- Load remotely hosted image libraries in the web viewer.
- Import locally hosted images and manage projects in the desktop app.
- Segment grains using the Segment Anything Model (SAM) in the desktop app.
- Embed the viewer in teaching and research applications.

## Start here

If this is your first time using petro-image, begin with
[Your first session](docs/getting-started/first-session.md). It introduces the
viewer through a short specimen-exploration workflow.

More detailed documentation is organized by what you want to do:

- [Documentation home](docs/index.md)
- [Viewing and comparing images](docs/user-guide/viewing-and-comparing.md)
- [Tools and analytical methods](docs/tools/index.md)
- [Using your own images](docs/importing/index.md)
- [File formats, shortcuts, and integration reference](docs/reference/index.md)

## Web viewer and desktop app

The web viewer is the quickest way to explore petro-image and can open a
remotely hosted image library. The desktop app adds project-oriented workflows,
including import tool for loading local files and automatic storage of
working annotation and count files.

petro-image is under active development. Some import and analysis
features should be treated as beta functionality, and scientific outputs should
be evaluated in light of the documented assumptions and limitations.

## Scientific scope

petro-image is a viewing and measurement environment that provides basic
tools for petrographic analysis. The Transform tool allows derivative
products to be calculated, including simple filters (e.g., Sobel edge),
custom calculations, and Polarization Analysis that quantifies pixel-scale
optical responses in registered multi-angle imagery. The Classify tool
allows user-supplied classifications to be applied to non-classified
polygons or to the image itself. Several tools are still in development.

Each tool has its own scope, inputs, assumptions, methods, outputs, and
limitations. See the
[tools and methods documentation](docs/tools/index.md) before using results in
research or teaching. Where a method requires additional detail, its tool page
links to equations, algorithms, validation guidance, and reproducibility
information for the current implementation.

## Contributing samples and ideas

Most specimens currently hosted by petro-image are petrographic thin sections
of sediment and sedimentary rock. Contributions of specimens, bug reports, and
suggestions are welcome. Open a
[GitHub issue](https://github.com/grsharman/petro-image/issues) or contact
Dr. Glenn R. Sharman at gsharman@uark.edu.

petro-image was created by
[Glenn R. Sharman](https://github.com/grsharman) and
[Jonathan P. Sharman](https://github.com/jonathansharman).

## License

petro-image is distributed under the [GNU General Public License v3.0](LICENSE).
