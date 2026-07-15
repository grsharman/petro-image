import argparse
import contextlib
import json
import os
import re
import sys
import traceback
import math
import time


MODEL_CONFIGS = {
    "tiny": "configs/sam2.1/sam2.1_hiera_t.yaml",
    "small": "configs/sam2.1/sam2.1_hiera_s.yaml",
    "base_plus": "configs/sam2.1/sam2.1_hiera_b+.yaml",
    "large": "configs/sam2.1/sam2.1_hiera_l.yaml",
}


def emit(payload):
    print(json.dumps(payload), flush=True)


class ProgressStdout:
    def __init__(self, wrapped):
        self.wrapped = wrapped
        self.buffer = ""
        self.last_percent_by_label = {}
        self.last_current_by_label = {}
        self.pass_by_label = {}
        self.last_overall_percent = 0
        self.overall_patch_current = 0
        self.overall_patch_total = 0
        self.announced_overall_patch = 0

    def write(self, text):
        self.wrapped.write(text)
        self.wrapped.flush()
        self.buffer += text
        while "\r" in self.buffer or "\n" in self.buffer:
            split_index = min(
                [index for index in [self.buffer.find("\r"), self.buffer.find("\n")] if index >= 0]
            )
            chunk = self.buffer[:split_index]
            self.buffer = self.buffer[split_index + 1 :]
            self._emit_progress_from_text(chunk)

    def flush(self):
        self.wrapped.flush()

    def _emit_progress_from_text(self, text):
        overall_patch_match = re.search(
            r"(?:processed\s+patch\s+#?(\d+)\s+out\s+of\s+(\d+)\s+patch(?:es)?|patch\s+(\d+)\s*/\s*(\d+))",
            text,
            re.IGNORECASE,
        )
        if overall_patch_match:
            current = int(overall_patch_match.group(1) or overall_patch_match.group(3))
            total = max(
                1,
                int(overall_patch_match.group(2) or overall_patch_match.group(4)),
            )
            self.overall_patch_current = current
            self.overall_patch_total = total
            self.announced_overall_patch = current
            percent = 20 + (current / total) * 70
            self.last_overall_percent = max(self.last_overall_percent, percent)
            emit(
                {
                    "type": "progress",
                    "stage": "Segmentation",
                    "message": f"Segmentation: patch {current} of {total} complete.",
                    "percent": self.last_overall_percent,
                    "overallPatchCurrent": current,
                    "overallPatchTotal": total,
                }
            )
            return

        tqdm_match = re.search(r"(\d{1,3})%\|", text)
        label_match = re.search(r"([^:\r\n]*):\s*(\d{1,3})%", text)
        count_match = re.search(r"(\d+)\s*/\s*(\d+)", text)
        if tqdm_match:
            label = self._guess_stage_label(text)
            percent = max(0, min(100, int(tqdm_match.group(1))))
        elif label_match:
            label = label_match.group(1).strip().lower() or "processing"
            percent = max(0, min(100, int(label_match.group(2))))
        else:
            return

        if self.overall_patch_total:
            next_patch = min(
                self.overall_patch_current + 1,
                self.overall_patch_total,
            )
            if next_patch != self.announced_overall_patch:
                self.announced_overall_patch = next_patch
                emit(
                    {
                        "type": "progress",
                        "stage": "Segmentation",
                        "message": f"Segmentation: processing patch {next_patch} of {self.overall_patch_total}.",
                        "percent": self.last_overall_percent,
                        "overallPatchCurrent": self.overall_patch_current,
                        "overallPatchTotal": self.overall_patch_total,
                    }
                )
            return
        current = int(count_match.group(1)) if count_match else None
        total = int(count_match.group(2)) if count_match else None
        if current is not None and total is not None:
            last_current = self.last_current_by_label.get(label)
            if last_current is not None and current < last_current:
                self.pass_by_label[label] = self.pass_by_label.get(label, 1) + 1
            else:
                self.pass_by_label.setdefault(label, 1)
            self.last_current_by_label[label] = current

        if self.last_percent_by_label.get(label) == percent and current is None:
            return
        self.last_percent_by_label[label] = percent
        stage = "SAM refinement" if "creating masks" in label else "Patch prediction"
        base = 20 if stage == "Patch prediction" else 55
        span = 35 if stage == "Patch prediction" else 35
        overall_percent = base + (percent / 100) * span
        if overall_percent < self.last_overall_percent:
            overall_percent = self.last_overall_percent
        self.last_overall_percent = overall_percent
        message = self._format_progress_message(stage, label, percent, current, total)
        emit(
            {
                "type": "progress",
                "stage": stage,
                "message": message,
                "percent": overall_percent,
            }
        )

    def _guess_stage_label(self, text):
        normalized = text.lower()
        if "creating masks" in normalized or "sam" in normalized:
            return "creating masks"
        return "patch prediction"

    def _format_progress_message(self, stage, label, percent, current, total):
        if current is None or total is None:
            return f"{stage}: {percent}%"
        pass_number = self.pass_by_label.get(label, 1)
        pass_label = f" pass {pass_number}," if pass_number > 1 else ""
        noun = "mask" if stage == "SAM refinement" else "patch"
        return f"{stage}:{pass_label} {noun} {current} of {total} ({percent}%)"


def choose_device(requested):
    import torch

    if requested and requested != "auto":
        return requested
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def load_sam2_model(checkpoint_path, model_type, device):
    from sam2.build_sam import build_sam2

    model_config = MODEL_CONFIGS.get(model_type)
    if not model_config:
        raise ValueError(f"Unsupported SAM 2.1 model type: {model_type}")
    if not os.path.isfile(checkpoint_path):
        raise FileNotFoundError(f"SAM checkpoint file was not found: {checkpoint_path}")

    return build_sam2(model_config, checkpoint_path, device=device), model_config


def load_segmenteverygrain_model(seg, model_path):
    extension = os.path.splitext(model_path)[1].lower()
    if extension not in {".h5", ".keras"}:
        raise ValueError(
            "segmenteverygrain model must be a trained .h5 or .keras file, "
            f"not {model_path!r}."
        )

    custom_objects = {}
    weighted_crossentropy = getattr(seg, "weighted_crossentropy", None)
    if weighted_crossentropy is not None:
        custom_objects["weighted_crossentropy"] = weighted_crossentropy

    load_model = getattr(seg, "load_model", None)
    if load_model is not None:
        try:
            return load_model(model_path, compile=False)
        except TypeError:
            try:
                return load_model(model_path)
            except Exception:
                pass

    from tensorflow.keras.models import load_model as keras_load_model

    try:
        return keras_load_model(
            model_path,
            compile=False,
            custom_objects=custom_objects or None,
        )
    except TypeError:
        return keras_load_model(model_path, compile=False)


def polygon_to_rings(geometry):
    if geometry.is_empty:
        return []

    if geometry.geom_type == "Polygon":
        polygons = [geometry]
    elif geometry.geom_type == "MultiPolygon":
        polygons = list(geometry.geoms)
    else:
        return []

    rings = []
    for polygon in polygons:
        if polygon.is_empty:
            continue
        exterior = [[float(x), float(y)] for x, y in polygon.exterior.coords]
        if len(exterior) >= 4:
            rings.append(exterior)
    return rings


def get_dzi_tiles_directory(dzi_path):
    root, _ = os.path.splitext(dzi_path)
    return f"{root}_files"


def get_level_dimensions(width, height, level, max_level):
    scale = 2 ** (max_level - level)
    return int(math.ceil(width / scale)), int(math.ceil(height / scale))


def choose_dzi_level(width, height, output_scale):
    max_level = int(math.ceil(math.log2(max(width, height))))
    level = int(round(max_level + math.log2(max(0.0001, output_scale))))
    return max(0, min(max_level, level)), max_level


def tile_extent(col, row, tile_size, overlap, level_width, level_height):
    left = col * tile_size - (overlap if col > 0 else 0)
    top = row * tile_size - (overlap if row > 0 else 0)
    right = min((col + 1) * tile_size + overlap, level_width)
    bottom = min((row + 1) * tile_size + overlap, level_height)
    return left, top, right, bottom


def get_dzi_crop_plan(tile, image_rect, output_scale):
    width = int(tile["width"])
    height = int(tile["height"])
    tile_size = int(tile["tileSize"])
    level, max_level = choose_dzi_level(width, height, output_scale)
    level_width, level_height = get_level_dimensions(width, height, level, max_level)
    level_scale = level_width / max(1, width)
    crop_left = float(image_rect["x"]) * level_scale
    crop_top = float(image_rect["y"]) * level_scale
    crop_right = (float(image_rect["x"]) + float(image_rect["width"])) * level_scale
    crop_bottom = (float(image_rect["y"]) + float(image_rect["height"])) * level_scale
    first_col = max(0, int(math.floor(crop_left / tile_size)))
    last_col = max(0, int(math.floor((crop_right - 1) / tile_size)))
    first_row = max(0, int(math.floor(crop_top / tile_size)))
    last_row = max(0, int(math.floor((crop_bottom - 1) / tile_size)))
    tile_count = max(0, last_col - first_col + 1) * max(0, last_row - first_row + 1)
    return {
        "level": level,
        "max_level": max_level,
        "level_width": level_width,
        "level_height": level_height,
        "level_scale": level_scale,
        "crop_left": crop_left,
        "crop_top": crop_top,
        "crop_right": crop_right,
        "crop_bottom": crop_bottom,
        "first_col": first_col,
        "last_col": last_col,
        "first_row": first_row,
        "last_row": last_row,
        "tile_count": tile_count,
    }


def paste_dzi_crop_layer(layer, tile, image_rect, output_scale, progress=None):
    from PIL import Image

    width = int(tile["width"])
    height = int(tile["height"])
    tile_size = int(tile["tileSize"])
    overlap = int(tile.get("overlap", 0))
    plan = get_dzi_crop_plan(tile, image_rect, output_scale)
    level = plan["level"]
    level_width = plan["level_width"]
    level_height = plan["level_height"]
    crop_left = plan["crop_left"]
    crop_top = plan["crop_top"]
    crop_right = plan["crop_right"]
    crop_bottom = plan["crop_bottom"]
    crop_width = max(1, int(round(crop_right - crop_left)))
    crop_height = max(1, int(round(crop_bottom - crop_top)))

    level_crop = Image.new("RGB", (crop_width, crop_height), (0, 0, 0))
    first_col = plan["first_col"]
    last_col = plan["last_col"]
    first_row = plan["first_row"]
    last_row = plan["last_row"]
    tiles_dir = get_dzi_tiles_directory(tile["dziPath"])
    tile_format = tile.get("format", "jpg")
    loaded_tiles = 0

    for row in range(first_row, last_row + 1):
        for col in range(first_col, last_col + 1):
            loaded_tiles += 1
            if progress is not None:
                progress(loaded_tiles, plan["tile_count"], level, plan["max_level"])
            tile_path = os.path.join(tiles_dir, str(level), f"{col}_{row}.{tile_format}")
            if not os.path.isfile(tile_path):
                continue
            tile_image = Image.open(tile_path).convert("RGB")
            tile_left, tile_top, tile_right, tile_bottom = tile_extent(
                col, row, tile_size, overlap, level_width, level_height
            )
            intersect_left = max(tile_left, crop_left)
            intersect_top = max(tile_top, crop_top)
            intersect_right = min(tile_right, crop_right)
            intersect_bottom = min(tile_bottom, crop_bottom)
            if intersect_right <= intersect_left or intersect_bottom <= intersect_top:
                continue

            source_box = (
                int(round(intersect_left - tile_left)),
                int(round(intersect_top - tile_top)),
                int(round(intersect_right - tile_left)),
                int(round(intersect_bottom - tile_top)),
            )
            dest = (
                int(round(intersect_left - crop_left)),
                int(round(intersect_top - crop_top)),
            )
            level_crop.paste(tile_image.crop(source_box), dest)

    output_width = max(1, int(round(float(image_rect["width"]) * output_scale)))
    output_height = max(1, int(round(float(image_rect["height"]) * output_scale)))
    if level_crop.size != (output_width, output_height):
        resampling = getattr(getattr(Image, "Resampling", Image), "LANCZOS")
        level_crop = level_crop.resize((output_width, output_height), resampling)

    opacity = max(0.0, min(1.0, float(tile.get("opacity", 1.0))))
    if opacity >= 0.999:
        layer.paste(level_crop)
    elif opacity > 0:
        layer.alpha_composite(Image.blend(layer.convert("RGB"), level_crop, opacity).convert("RGBA"))


def stitch_dzi_tile_job(tile_job_path, output_path):
    from PIL import Image
    start_time = time.time()

    with open(tile_job_path, "r", encoding="utf-8") as file:
        job = json.load(file)

    image_rect = job["imageRect"]
    output_scale = max(0.05, min(1.0, float(job.get("outputScale", 1))))
    output_width = max(1, int(round(float(image_rect["width"]) * output_scale)))
    output_height = max(1, int(round(float(image_rect["height"]) * output_scale)))
    layer = Image.new("RGBA", (output_width, output_height), (0, 0, 0, 255))

    emit(
        {
            "type": "progress",
            "stage": "Stitching",
            "message": "Stitching DZI tiles...",
            "percent": 3,
        }
    )
    tiles = job.get("tiles", [])
    total_tile_count = sum(
        get_dzi_crop_plan(tile, image_rect, output_scale)["tile_count"]
        for tile in tiles
    )
    stitched_tiles = 0

    def emit_stitch_progress(tile_index, tile_total, level, max_level):
        nonlocal stitched_tiles
        stitched_tiles += 1
        percent = 3 + (stitched_tiles / max(1, total_tile_count)) * 14
        emit(
            {
                "type": "progress",
                "stage": "Stitching",
                "message": f"Stitching DZI tiles: tile {stitched_tiles} of {total_tile_count} (level {level}/{max_level})",
                "percent": percent,
            }
        )

    for tile in tiles:
        paste_dzi_crop_layer(
            layer,
            tile,
            image_rect,
            output_scale,
            progress=emit_stitch_progress,
        )

    layer.convert("RGB").save(output_path)
    emit(
        {
            "type": "progress",
            "stage": "Stitching",
            "message": f"Finished stitching {total_tile_count} DZI tiles in {time.time() - start_time:.1f}s.",
            "percent": 17,
        }
    )
    return {
        "scaleX": output_width / max(1.0, float(image_rect["width"])),
        "scaleY": output_height / max(1.0, float(image_rect["height"])),
    }


def load_models(model_path, use_sam, sam_checkpoint, sam_model_type, requested_device):
    # Load PyTorch before segmenteverygrain. The latter imports TensorFlow first
    # and then SAM2/PyTorch, which can cause a Windows shm.dll dependency to bind
    # to an incompatible DLL that TensorFlow already loaded.
    import torch  # noqa: F401
    import segmenteverygrain as seg

    device = choose_device(requested_device) if use_sam else None
    sam_model = None
    sam_model_config = ""
    if use_sam:
        sam_model, sam_model_config = load_sam2_model(
            sam_checkpoint,
            sam_model_type,
            device,
        )
    model = load_segmenteverygrain_model(seg, model_path)
    return seg, model, sam_model, sam_model_config, device


def run_segmentation(args, seg, model, sam_model, sam_model_config, device):
    stitched_info = {}
    image_path = args.image
    if args.tile_job:
        image_path = args.stitch_output or os.path.join(
            os.path.dirname(args.tile_job),
            "aoi.png",
        )
        stitched_info = stitch_dzi_tile_job(args.tile_job, image_path)
    if not image_path:
        raise ValueError("Either --image or --tile-job is required.")

    from PIL import Image

    with Image.open(image_path) as image:
        image_width, image_height = image.size
    step_size = max(1, args.patch_size - args.overlap)
    patch_rows = max(
        1,
        (image_height - args.patch_size + step_size) // step_size + 1,
    )
    patch_columns = max(
        1,
        (image_width - args.patch_size + step_size) // step_size + 1,
    )
    total_patches = patch_rows * patch_columns

    emit(
        {
            "type": "progress",
            "stage": "Segmentation",
            "message": f"Segmentation: processing patch 1 of {total_patches}.",
            "percent": 20,
            "overallPatchCurrent": 0,
            "overallPatchTotal": total_patches,
        }
    )
    progress_stdout = ProgressStdout(sys.stdout)
    progress_stdout.overall_patch_total = total_patches
    progress_stdout.announced_overall_patch = 1
    prediction_options = {
        "sam": sam_model,
        "min_area": args.min_area,
        "patch_size": args.patch_size,
        "overlap": args.overlap,
        "min_grain_area": args.min_area,
        "remove_edge_grains": args.remove_edge_grains,
        "use_sam": args.use_sam,
        "dilation": args.dilation,
        "dbs_max_dist": args.dbs_max_dist,
    }
    try:
        import inspect

        if "verbose" in inspect.signature(seg.predict_large_image).parameters:
            prediction_options["verbose"] = False
    except (TypeError, ValueError):
        pass
    with contextlib.redirect_stdout(progress_stdout):
        result = seg.predict_large_image(
            image_path,
            model,
            **prediction_options,
        )
    emit(
        {
            "type": "progress",
            "stage": "Polygons",
            "message": "Converting polygons...",
            "percent": 92,
        }
    )
    grains = result[0] if isinstance(result, tuple) else result
    polygons = []
    for grain in grains:
        geometry = grain
        if args.simplify_epsilon > 0:
            geometry = geometry.simplify(
                args.simplify_epsilon,
                preserve_topology=True,
            )
        if not geometry.is_valid:
            geometry = geometry.buffer(0)
        if geometry.is_empty or geometry.area < args.min_area:
            continue
        for ring in polygon_to_rings(geometry):
            polygons.append(
                {
                    "coordinates": ring,
                    "area": float(geometry.area),
                }
            )

    emit(
        {
            "type": "progress",
            "stage": "Complete",
            "message": "Segmentation complete.",
            "percent": 100,
        }
    )
    return {
        "ok": True,
        "polygons": polygons,
        "count": len(polygons),
        "useSam": bool(args.use_sam),
        "samModelType": args.sam_model_type if args.use_sam else "",
        "samModelConfig": sam_model_config,
        "device": device or "",
        **stitched_info,
    }


def build_parser():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", default="")
    parser.add_argument("--tile-job", default="")
    parser.add_argument("--stitch-output", default="")
    parser.add_argument("--model", required=True)
    parser.add_argument("--simplify-epsilon", type=float, default=2.0)
    parser.add_argument("--min-area", type=float, default=400.0)
    parser.add_argument("--patch-size", type=int, default=3000)
    parser.add_argument("--overlap", type=int, default=600)
    parser.add_argument("--dilation", type=int, default=3)
    parser.add_argument("--dbs-max-dist", type=float, default=100.0)
    parser.add_argument("--remove-edge-grains", action="store_true")
    parser.add_argument("--use-sam", action="store_true")
    parser.add_argument("--sam-checkpoint", default="")
    parser.add_argument("--sam-model-type", default="base_plus")
    parser.add_argument("--device", default="auto")
    return parser


def main():
    args = build_parser().parse_args()

    try:
        emit(
            {
                "type": "progress",
                "stage": "Loading",
                "message": "Loading models...",
                "percent": 18 if args.tile_job else 5,
            }
        )
        if args.use_sam:
            emit(
                {
                    "type": "progress",
                    "stage": "Loading SAM",
                    "message": "Loading SAM 2.1...",
                    "percent": 19 if args.tile_job else 8,
                }
            )
        runtime = load_models(
            args.model,
            args.use_sam,
            args.sam_checkpoint,
            args.sam_model_type,
            args.device,
        )
        emit(run_segmentation(args, *runtime))
    except Exception:
        emit(
            {
                "ok": False,
                "error": traceback.format_exc(),
            }
        )
        return 1
    return 0


if __name__ == "__main__":
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    sys.exit(main())
