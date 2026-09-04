# AxioScan CZI to petro-image

This folder is a standalone, server-oriented converter for single-scene,
two-dimensional CZI files produced by the ZEISS AxioScan 7 Geo. It creates one
petro-image library and one Deep Zoom pyramid per acquisition channel.

For interactive testing, open `CZI_Pipeline_Test.ipynb` in Jupyter and edit its
input and output paths. The notebook uses the same batch command described
below; it does not contain a second implementation of the conversion logic.

## Install

Use Python 3.10 or newer in a virtual environment:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r czi_pipeline/requirements.txt
```

Only `pylibCZIrw`, NumPy, and Pillow are needed at runtime. The separate
`requirements-build.txt` file is used to package the converter with
PyInstaller for the desktop application.

## Convert a batch

```bash
.venv/bin/python czi_pipeline/batch.py INPUT OUTPUT
```

`INPUT` may be one `.czi` file or a directory. The output path must not already
exist. Useful options are:

```text
--recursive          include CZI files in input subdirectories
--downsample 0.5     produce half-resolution images
--quality 90         JPEG tile quality from 1 through 100
--group "Project A"  petro-image group assigned to each sample
```

The converter first inspects every input. No conversion starts unless every
file is a supported AxioScan profile with positive X and Y calibration and
square pixels. The X and Y pixel dimensions must agree within one part per
million. Output is built in a temporary directory and renamed into place only
after the complete batch succeeds.

Example output:

```text
OUTPUT/
├── library.json
└── dzi/
    ├── 01arz3ng/
    │   ├── sample-01-ppl-0.dzi
    │   └── sample-01-ppl-0_files/
    └── 7x3k9m2p/
        └── ...
```

Open `library.json` in petro-image. Its DZI paths are relative, so the complete
output directory can be moved or published as one unit.

## Sample identity

The filename stem is the sample title. A normalized, case-insensitive form of
that title is hashed into petro-image's preferred eight-character, 40-bit ID.
The same sample name therefore produces the same ID on another run. Duplicate
normalized names and the unlikely event of an ID collision stop the batch.

If filenames can change, the calling system should preserve the previously
assigned ID or rename the input to its authoritative sample accession before
conversion.

## Metadata

The petro-image sample includes `pixelsPerMeter` for the displayed derivative,
including any requested downsampling. The top-level `cziPipeline` object also
preserves source and output dimensions, both physical pixel dimensions,
microscope name, channel descriptions, source pixel type and bit depth,
compression, JPEG quality, and converter dependency versions. petro-image
ignores this provenance while preserving it when the library is edited.

The individual converter remains available for inspection and diagnostics:

```bash
.venv/bin/python czi_pipeline/converter.py sample.czi --inspect
```

It prints newline-delimited JSON events to standard output.

## Supported input

The converter intentionally rejects multiple scenes, Z-stacks, time series,
non-AxioScan instruments, missing calibration, and non-square calibrated
pixels. It converts the complete stitched bounding rectangle and preserves all
recognized brightfield, CPL, PPL, and XPL channels. PPL and XPL acquisition
angles are represented as rotation-aware petro-image tile sets when multiple
angles are present.
