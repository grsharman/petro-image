#!/usr/bin/env python3
import argparse
import contextlib
import json
import sys
import traceback
from types import SimpleNamespace

from segmenteverygrain_segment import emit, load_models, run_segmentation


def build_job(request, startup_args):
    return SimpleNamespace(
        image=str(request.get("image") or ""),
        tile_job=str(request.get("tileJob") or ""),
        stitch_output=str(request.get("stitchOutput") or ""),
        simplify_epsilon=float(request.get("simplifyEpsilon", 2.0)),
        min_area=float(request.get("minArea", 400.0)),
        patch_size=int(request.get("patchSize", 3000)),
        overlap=int(request.get("overlap", 600)),
        dilation=int(request.get("dilation", 3)),
        dbs_max_dist=float(request.get("dbsMaxDist", 100.0)),
        remove_edge_grains=bool(request.get("removeEdgeGrains", False)),
        use_sam=startup_args.use_sam,
        sam_model_type=startup_args.sam_model_type,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--use-sam", action="store_true")
    parser.add_argument("--sam-checkpoint", default="")
    parser.add_argument("--sam-model-type", default="large")
    parser.add_argument("--device", default="auto")
    args = parser.parse_args()

    try:
        emit(
            {
                "type": "progress",
                "stage": "Loading",
                "message": "Loading segmenteverygrain models...",
                "percent": 5,
            }
        )
        # stdout is the worker's JSON protocol. Some ML libraries print startup
        # messages without a trailing newline, which can otherwise become
        # attached to the ready payload and prevent Electron from recognizing it.
        with contextlib.redirect_stdout(sys.stderr):
            runtime = load_models(
                args.model,
                args.use_sam,
                args.sam_checkpoint,
                args.sam_model_type,
                args.device,
            )
        emit(
            {
                "type": "ready",
                "ok": True,
                "useSam": args.use_sam,
                "samModelType": args.sam_model_type if args.use_sam else "",
                "samModelConfig": runtime[3],
                "device": runtime[4] or "",
            }
        )
    except Exception as error:
        emit(
            {
                "type": "ready",
                "ok": False,
                "error": str(error),
                "traceback": traceback.format_exc(),
            }
        )
        return 1

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request = None
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            if request.get("type") == "shutdown":
                emit({"id": request_id, "ok": True, "type": "shutdown"})
                return 0
            emit(
                {
                    "id": request_id,
                    "type": "progress",
                    "stage": "Starting",
                    "message": "Segmentation request received by worker.",
                    "percent": 2,
                }
            )
            result = run_segmentation(build_job(request, args), *runtime)
            result["id"] = request_id
            emit(result)
        except Exception as error:
            emit(
                {
                    "id": request_id,
                    "ok": False,
                    "error": str(error),
                    "traceback": traceback.format_exc(),
                }
            )

    return 0


if __name__ == "__main__":
    sys.exit(main())
