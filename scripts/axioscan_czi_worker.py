#!/usr/bin/env python3
"""AxioScan 7 CZI metadata and bounded-memory DZI conversion worker."""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path
from xml.etree import ElementTree

try:
    import numpy as np
    from PIL import Image
    from pylibCZIrw import czi
except ImportError as error:
    raise SystemExit(
        "The AxioScan CZI importer requires pylibCZIrw, numpy, and Pillow."
    ) from error


DZI_TILE_SIZE = 254
DZI_OVERLAP = 1
MIN_CZI_ZOOM = 1 / 64
SUPPORTED_DOWNSAMPLES = (1, 1 / 2, 1 / 4, 1 / 8, 1 / 16, 1 / 32, 1 / 64)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert a rectangular AxioScan 7 CZI region to DZI files."
    )
    parser.add_argument("source", type=Path, help="Source .czi file")
    parser.add_argument("output", type=Path, nargs="?", help="New output directory")
    parser.add_argument(
        "--inspect",
        action="store_true",
        help="Print machine-readable AxioScan metadata without converting",
    )
    parser.add_argument(
        "--roi",
        type=int,
        nargs=4,
        metavar=("X", "Y", "WIDTH", "HEIGHT"),
        help="Rectangle in raw CZI pixel coordinates",
    )
    parser.add_argument(
        "--downsample",
        type=float,
        choices=SUPPORTED_DOWNSAMPLES,
        default=1,
        help="Linear output scale; defaults to full resolution",
    )
    parser.add_argument("--quality", type=int, default=90, choices=range(1, 101))
    return parser.parse_args()


def emit_event(event_type: str, **payload) -> None:
    print(json.dumps({"type": event_type, **payload}, separators=(",", ":")), flush=True)


def as_list(value: object) -> list:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def get_metadata_root(reader) -> dict:
    return reader.metadata["ImageDocument"]["Metadata"]


def get_channels(metadata: dict) -> list[dict]:
    channels = metadata["Information"]["Image"]["Dimensions"]["Channels"]
    return as_list(channels.get("Channel"))


def get_microns_per_pixel(metadata: dict) -> float | None:
    distances = as_list(metadata.get("Scaling", {}).get("Items", {}).get("Distance"))
    for distance in distances:
        if distance.get("@Id") == "X":
            meters_per_pixel = float(distance["Value"])
            return meters_per_pixel * 1_000_000
    return None


def get_microscope_name(metadata: dict) -> str:
    microscopes = metadata["Information"]["Instrument"].get("Microscopes", {})
    microscope = as_list(microscopes.get("Microscope"))
    return str(microscope[0].get("@Name", "")) if microscope else ""


def get_image_metadata(metadata: dict) -> dict:
    return metadata["Information"]["Image"]


def dimension_size(reader, dimension: str) -> int:
    start, end = reader.total_bounding_box.get(dimension, (0, 1))
    return int(end - start)


def sanitize_name(value: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return value or "channel"


def channel_details(channel: dict, index: int) -> dict:
    name = str(channel.get("@Name") or f"Channel {index}").strip()
    settings = channel.get("PolarizingSettings") or {}
    polarization = str(settings.get("PolarizationType", "")).lower()
    contrast = str(channel.get("ContrastMethod", "")).lower()

    if contrast == "brightfield":
        return {"kind": "brightfield", "label": "Brightfield", "name": "brightfield"}
    if polarization == "cpol":
        return {"kind": "cpl", "label": "CPL", "name": "cpl"}
    if polarization == "xpol":
        angle = float(settings.get("AnalyzerAngle", settings.get("PolarizerAngle", 0)))
        return {
            "kind": "xpl",
            "label": name,
            "name": f"xpl-{angle:g}",
            "angleDegrees": angle,
        }
    if polarization == "ppol":
        angle = float(settings.get("PolarizerAngle", 0))
        return {
            "kind": "ppl",
            "label": name,
            "name": f"ppl-{angle:g}",
            "angleDegrees": angle,
        }
    return {"kind": "other", "label": name, "name": sanitize_name(name)}


def dzi_level_size(width: int, height: int, max_level: int, level: int) -> tuple[int, int]:
    divisor = 2 ** (max_level - level)
    return max(1, math.ceil(width / divisor)), max(1, math.ceil(height / divisor))


def read_tile(
    reader,
    channel: int,
    roi: tuple[int, int, int, int],
    zoom: float,
    tile_box: tuple[int, int, int, int],
) -> Image.Image:
    left, top, right, bottom = tile_box
    source_pixels_per_level_pixel = max(1, round(1 / zoom))
    source_left = roi[0] + left * source_pixels_per_level_pixel
    source_top = roi[1] + top * source_pixels_per_level_pixel
    source_right = min(
        roi[0] + roi[2],
        roi[0] + right * source_pixels_per_level_pixel,
    )
    source_bottom = min(
        roi[1] + roi[3],
        roi[1] + bottom * source_pixels_per_level_pixel,
    )
    source_roi = (
        source_left,
        source_top,
        max(1, source_right - source_left),
        max(1, source_bottom - source_top),
    )
    czi_zoom = max(zoom, MIN_CZI_ZOOM)
    pixels = reader.read(
        roi=source_roi,
        plane={"C": channel},
        scene=0,
        zoom=czi_zoom,
    )
    if pixels.ndim != 3 or pixels.shape[2] != 3:
        raise RuntimeError(f"Channel {channel} did not return a BGR color image.")

    # pylibCZIrw returns BGR; JPEG and petro-image expect RGB.
    image = Image.fromarray(np.ascontiguousarray(pixels[:, :, ::-1]))
    expected_size = (right - left, bottom - top)
    if image.size != expected_size:
        image = image.resize(expected_size, Image.Resampling.LANCZOS)
    return image


def write_level_tiles(
    reader,
    channel: int,
    roi: tuple[int, int, int, int],
    zoom: float,
    width: int,
    height: int,
    directory: Path,
    level: int,
    quality: int,
    on_tile,
) -> int:
    level_directory = directory / str(level)
    level_directory.mkdir(parents=True)
    columns = math.ceil(width / DZI_TILE_SIZE)
    rows = math.ceil(height / DZI_TILE_SIZE)

    for column in range(columns):
        for row in range(rows):
            left = max(0, column * DZI_TILE_SIZE - DZI_OVERLAP)
            top = max(0, row * DZI_TILE_SIZE - DZI_OVERLAP)
            right = min(width, (column + 1) * DZI_TILE_SIZE + DZI_OVERLAP)
            bottom = min(height, (row + 1) * DZI_TILE_SIZE + DZI_OVERLAP)
            tile = read_tile(
                reader,
                channel,
                roi,
                zoom,
                (left, top, right, bottom),
            )
            tile.save(level_directory / f"{column}_{row}.jpg", "JPEG", quality=quality)
            on_tile(level)

    return columns * rows


def write_descriptor(path: Path, width: int, height: int) -> None:
    namespace = "http://schemas.microsoft.com/deepzoom/2008"
    root = ElementTree.Element(
        "Image",
        {
            "TileSize": str(DZI_TILE_SIZE),
            "Overlap": str(DZI_OVERLAP),
            "Format": "jpg",
            "xmlns": namespace,
        },
    )
    ElementTree.SubElement(root, "Size", {"Width": str(width), "Height": str(height)})
    ElementTree.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)


def write_channel_dzi(
    reader,
    channel: int,
    roi: tuple[int, int, int, int],
    output_width: int,
    output_height: int,
    output_base: Path,
    output_scale: float,
    quality: int,
    on_tile,
) -> int:
    descriptor = output_base.with_suffix(".dzi")
    tile_directory = output_base.parent / f"{output_base.name}_files"
    if descriptor.exists() or tile_directory.exists():
        raise FileExistsError(f"Refusing to overwrite existing DZI: {descriptor}")

    max_level = math.ceil(math.log2(max(output_width, output_height)))
    total_tiles = 0
    for level in range(max_level + 1):
        width, height = dzi_level_size(output_width, output_height, max_level, level)
        relative_scale = 2 ** (level - max_level)
        czi_zoom = output_scale * relative_scale
        total_tiles += write_level_tiles(
            reader,
            channel,
            roi,
            czi_zoom,
            width,
            height,
            tile_directory,
            level,
            quality,
            on_tile,
        )

    write_descriptor(descriptor, output_width, output_height)
    return total_tiles


def build_library(source: Path, details: list[dict], dzi_paths: list[str],
                  pixels_per_meter: float | None, roi: tuple[int, int, int, int]) -> dict:
    tiles_by_kind: dict[str, list[dict]] = {}
    for detail, uri in zip(details, dzi_paths):
        tile = {"uri": uri}
        if "angleDegrees" in detail:
            tile["angleDegrees"] = detail["angleDegrees"]
        tiles_by_kind.setdefault(detail["kind"], []).append(tile)

    tile_sets = []
    for kind, label, period in (
        ("brightfield", "Brightfield", None),
        ("cpl", "CPL", None),
        ("xpl", "XPL", 90),
        ("ppl", "PPL", 180),
    ):
        tiles = tiles_by_kind.pop(kind, [])
        if not tiles:
            continue
        tile_set = {"label": label, "tiles": tiles}
        if period is not None:
            tile_set["periodDegrees"] = period
            tiles.sort(key=lambda tile: tile["angleDegrees"])
        tile_sets.append(tile_set)

    for detail, uri in zip(details, dzi_paths):
        if detail["kind"] == "other":
            tile_sets.append({"label": detail["label"], "tiles": [{"uri": uri}]})

    sample = {
        "title": source.stem,
        "description": f"Imported from AxioScan 7 CZI; source ROI x={roi[0]}, y={roi[1]}, width={roi[2]}, height={roi[3]}",
        "groups": ["Imported CZI"],
        "tileSets": tile_sets,
    }
    if pixels_per_meter is not None:
        sample["pixelsPerMeter"] = pixels_per_meter
    return {"format": "v1", "samples": [sample]}


def count_dzi_tiles(width: int, height: int) -> int:
    max_level = math.ceil(math.log2(max(width, height)))
    total = 0
    for level in range(max_level + 1):
        level_width, level_height = dzi_level_size(width, height, max_level, level)
        total += math.ceil(level_width / DZI_TILE_SIZE) * math.ceil(
            level_height / DZI_TILE_SIZE
        )
    return total


def inspect_czi(source: Path) -> dict:
    with czi.open_czi(str(source)) as reader:
        metadata = get_metadata_root(reader)
        image_metadata = get_image_metadata(metadata)
        channels = get_channels(metadata)
        details = [
            {"index": index, **channel_details(channel, index)}
            for index, channel in enumerate(channels)
        ]
        bounds = reader.total_bounding_rectangle
        microns_per_pixel = get_microns_per_pixel(metadata)
        scene_count = len(reader.scenes_bounding_rectangle) or 1
        kinds = [detail["kind"] for detail in details]
        expected_profile = (
            scene_count == 1
            and dimension_size(reader, "T") == 1
            and dimension_size(reader, "Z") == 1
            and len(details) == 14
            and kinds.count("brightfield") == 1
            and kinds.count("cpl") == 1
            and kinds.count("xpl") == 6
            and kinds.count("ppl") == 6
        )
        return {
            "sourcePath": str(source),
            "sourceName": source.name,
            "sourceBytes": source.stat().st_size,
            "microscope": get_microscope_name(metadata),
            "isSupportedProfile": expected_profile,
            "bounds": {
                "x": bounds.x,
                "y": bounds.y,
                "width": bounds.w,
                "height": bounds.h,
            },
            "sceneCount": scene_count,
            "sizeT": dimension_size(reader, "T"),
            "sizeZ": dimension_size(reader, "Z"),
            "sizeC": dimension_size(reader, "C"),
            "pixelType": image_metadata.get("PixelType", ""),
            "componentBitCount": int(image_metadata.get("ComponentBitCount", 0) or 0),
            "compression": image_metadata.get("OriginalCompressionMethod", ""),
            "micronsPerPixel": microns_per_pixel,
            "pixelsPerMeter": (
                1_000_000 / microns_per_pixel if microns_per_pixel else None
            ),
            "channels": details,
            "resolutionScales": list(SUPPORTED_DOWNSAMPLES),
        }


def main() -> int:
    args = parse_arguments()
    source = args.source.resolve()
    if source.suffix.lower() != ".czi" or not source.is_file():
        raise SystemExit(f"CZI file not found: {source}")

    if args.inspect:
        emit_event("inspection", inspection=inspect_czi(source))
        return 0

    if args.output is None:
        raise SystemExit("An output directory is required for conversion.")
    if args.roi is None:
        raise SystemExit("--roi is required for conversion.")

    output = args.output.resolve()
    roi = tuple(args.roi)
    if roi[2] <= 0 or roi[3] <= 0:
        raise SystemExit("ROI width and height must be positive.")
    if output.exists() and any(output.iterdir()):
        raise SystemExit(f"Output directory is not empty: {output}")

    output.mkdir(parents=True, exist_ok=True)
    dzi_directory = output / "dzi"
    dzi_directory.mkdir()

    # pylibCZIrw 6.1 accepts path-like values at the Python boundary but its
    # native constructor still requires a string.
    with czi.open_czi(str(source)) as reader:
        metadata = get_metadata_root(reader)
        microscope = get_microscope_name(metadata)
        if "axioscan 7" not in microscope.lower():
            raise SystemExit(f"Expected an Axioscan 7 CZI, found: {microscope or 'unknown'}")

        channels = get_channels(metadata)
        details = [channel_details(channel, index) for index, channel in enumerate(channels)]
        output_width = math.ceil(roi[2] * args.downsample)
        output_height = math.ceil(roi[3] * args.downsample)
        microns_per_pixel = get_microns_per_pixel(metadata)
        pixels_per_meter = None
        if microns_per_pixel:
            pixels_per_meter = 1_000_000 / (microns_per_pixel / args.downsample)

        tiles_per_channel = count_dzi_tiles(output_width, output_height)
        all_tiles = tiles_per_channel * len(details)
        completed_tiles = 0

        def on_tile(level: int) -> None:
            nonlocal completed_tiles
            completed_tiles += 1
            if completed_tiles == all_tiles or completed_tiles % 25 == 0:
                emit_event(
                    "progress",
                    completedTiles=completed_tiles,
                    totalTiles=all_tiles,
                    percent=round(completed_tiles / all_tiles * 100, 2),
                    level=level,
                )

        dzi_paths = []
        for index, detail in enumerate(details):
            base_name = f"{source.stem}-{sanitize_name(detail['name'])}"
            emit_event(
                "channel",
                channelIndex=index,
                channelCount=len(details),
                label=detail["label"],
                message=f"Converting {detail['label']}",
            )
            total_tiles = write_channel_dzi(
                reader,
                index,
                roi,
                output_width,
                output_height,
                dzi_directory / base_name,
                args.downsample,
                args.quality,
                on_tile,
            )
            dzi_paths.append(f"dzi/{base_name}.dzi")

    library = build_library(source, details, dzi_paths, pixels_per_meter, roi)
    library_path = output / "library.json"
    library_path.write_text(json.dumps(library, indent=2) + "\n", encoding="utf-8")
    emit_event(
        "result",
        libraryPath=str(library_path),
        outputPath=str(output),
        width=output_width,
        height=output_height,
        totalTiles=all_tiles,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
