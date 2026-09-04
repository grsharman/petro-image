#!/usr/bin/env python3
"""Batch-convert AxioScan 7 Geo CZI files into a petro-image library."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from datetime import datetime, timezone
from pathlib import Path


ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"
ID_DOMAIN = b"petro-image-czi-sample-v1\0"
SUPPORTED_DOWNSAMPLES = (1, 1 / 2, 1 / 4, 1 / 8, 1 / 16, 1 / 32, 1 / 64)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert an AxioScan 7 Geo CZI file or directory to petro-image DZI files."
    )
    parser.add_argument("input", type=Path, help="A .czi file or directory of CZI files")
    parser.add_argument("output", type=Path, help="A new output directory")
    parser.add_argument("--recursive", action="store_true", help="Search input subdirectories")
    parser.add_argument(
        "--downsample",
        type=float,
        choices=SUPPORTED_DOWNSAMPLES,
        default=1,
        help="Linear output scale; defaults to full resolution",
    )
    parser.add_argument("--quality", type=int, default=90, choices=range(1, 101))
    parser.add_argument(
        "--group", default="Imported CZI", help="petro-image group assigned to every sample"
    )
    return parser.parse_args()


def canonical_sample_key(path: Path) -> str:
    return unicodedata.normalize("NFKC", path.stem.strip()).casefold()


def sample_id_for_key(key: str) -> str:
    """Return petro-image's preferred eight-character, 40-bit sample ID."""
    value = int.from_bytes(
        hashlib.sha256(ID_DOMAIN + key.encode("utf-8")).digest()[:5], "big"
    )
    return "".join(ID_ALPHABET[(value >> shift) & 31] for shift in range(35, -1, -5))


def find_sources(input_path: Path, recursive: bool) -> list[Path]:
    if input_path.is_file():
        return [input_path.resolve()] if input_path.suffix.lower() == ".czi" else []
    if not input_path.is_dir():
        return []
    pattern = "**/*" if recursive else "*"
    return sorted(
        (path.resolve() for path in input_path.glob(pattern) if path.is_file()
         and path.suffix.lower() == ".czi"),
        key=lambda path: str(path).casefold(),
    )


def run_converter(arguments: list[str]) -> list[dict]:
    converter = Path(__file__).with_name("converter.py")
    result = subprocess.run(
        [sys.executable, str(converter), *arguments],
        text=True,
        capture_output=True,
        check=False,
    )
    events = []
    for line in result.stdout.splitlines():
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "unknown error"
        raise RuntimeError(detail)
    return events


def event_of_type(events: list[dict], event_type: str) -> dict:
    for event in reversed(events):
        if event.get("type") == event_type:
            return event
    raise RuntimeError(f"Converter did not emit a {event_type!r} event")


def inspect_source(source: Path) -> dict:
    event = event_of_type(run_converter([str(source), "--inspect"]), "inspection")
    inspection = event["inspection"]
    if not inspection.get("isSupportedProfile"):
        raise ValueError("not a supported single-scene, two-dimensional AxioScan 7 CZI")
    sizes = inspection.get("pixelSizeMicrometers", {})
    if not sizes.get("x") or not sizes.get("y"):
        raise ValueError("missing X or Y pixel calibration")
    if inspection.get("hasSquarePixels") is not True:
        raise ValueError(
            f"non-square pixels: X={sizes.get('x')} um, Y={sizes.get('y')} um"
        )
    return inspection


def dependency_versions() -> dict[str, str]:
    versions = {}
    for name in ("pylibCZIrw", "numpy", "Pillow"):
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            pass
    return versions


def prepare_sources(sources: list[Path]) -> list[dict]:
    prepared = []
    keys = set()
    ids = set()
    for source in sources:
        key = canonical_sample_key(source)
        if not key:
            raise ValueError(f"CZI filename has no usable sample name: {source}")
        sample_id = sample_id_for_key(key)
        if key in keys:
            raise ValueError(f"Duplicate canonical sample name: {source.stem}")
        if sample_id in ids:
            raise ValueError(f"Eight-character sample ID collision for: {source.stem}")
        print(f"Inspecting {source.name}", file=sys.stderr, flush=True)
        inspection = inspect_source(source)
        prepared.append({
            "source": source,
            "key": key,
            "sampleId": sample_id,
            "inspection": inspection,
        })
        keys.add(key)
        ids.add(sample_id)
    return prepared


def convert_one(item: dict, staging: Path, downsample: float, quality: int,
                group: str) -> tuple[dict, dict]:
    source = item["source"]
    sample_id = item["sampleId"]
    inspection = item["inspection"]
    bounds = inspection["bounds"]
    temporary_output = staging / "work" / sample_id
    print(f"Converting {source.name} [{sample_id}]", file=sys.stderr, flush=True)
    events = run_converter([
        str(source),
        str(temporary_output),
        "--roi",
        str(bounds["x"]),
        str(bounds["y"]),
        str(bounds["width"]),
        str(bounds["height"]),
        "--downsample",
        str(downsample),
        "--quality",
        str(quality),
    ])
    result = event_of_type(events, "result")
    generated = json.loads((temporary_output / "library.json").read_text("utf-8"))
    sample = generated["samples"][0]
    sample["sampleId"] = sample_id
    sample["title"] = source.stem
    sample["groups"] = [group] if group else []
    for tile_set in sample.get("tileSets", []):
        tile_set.pop("_cziImportKey", None)
        for tile in tile_set.get("tiles", []):
            tile["uri"] = f"dzi/{sample_id}/{Path(tile['uri']).name}"

    sample_dzi = staging / "dzi" / sample_id
    sample_dzi.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(temporary_output / "dzi"), sample_dzi)
    shutil.rmtree(temporary_output)

    provenance = {
        "sourceFile": source.name,
        "canonicalSampleKey": item["key"],
        "sourceBytes": inspection["sourceBytes"],
        "microscope": inspection["microscope"],
        "sourceRegion": bounds,
        "outputSize": {"width": result["width"], "height": result["height"]},
        "pixelSizeMicrometers": inspection["pixelSizeMicrometers"],
        "pixelsPerMeter": sample.get("pixelsPerMeter"),
        "downsample": downsample,
        "jpegQuality": quality,
        "pixelType": inspection.get("pixelType"),
        "componentBitCount": inspection.get("componentBitCount"),
        "compression": inspection.get("compression"),
        "channels": inspection.get("channels", []),
    }
    return sample, provenance


def main() -> int:
    args = parse_arguments()
    sources = find_sources(args.input.resolve(), args.recursive)
    if not sources:
        raise SystemExit(f"No CZI files found: {args.input}")

    output = args.output.resolve()
    if output.exists():
        raise SystemExit(f"Output path already exists: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)

    try:
        prepared = prepare_sources(sources)
    except (RuntimeError, ValueError) as error:
        raise SystemExit(f"Preflight failed: {error}") from error

    staging = Path(tempfile.mkdtemp(prefix=f".{output.name}-", dir=output.parent))
    try:
        samples = []
        provenance = {}
        for item in prepared:
            sample, metadata = convert_one(
                item, staging, args.downsample, args.quality, args.group.strip()
            )
            samples.append(sample)
            provenance[item["sampleId"]] = metadata

        shutil.rmtree(staging / "work", ignore_errors=True)
        library = {
            "format": "v1",
            "samples": samples,
            "cziPipeline": {
                "format": 1,
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "sampleIdMethod": "sha256-first-40-bits-crockford-base32",
                "dependencies": dependency_versions(),
                "samples": provenance,
            },
        }
        (staging / "library.json").write_text(
            json.dumps(library, indent=2) + "\n", encoding="utf-8"
        )
        staging.rename(output)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise

    print(json.dumps({
        "libraryPath": str(output / "library.json"),
        "outputPath": str(output),
        "sampleCount": len(samples),
    }))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        raise SystemExit("Canceled") from None
