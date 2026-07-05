#!/usr/bin/env python3
import argparse
import json
import os
import sys
import traceback

import numpy as np
from PIL import Image


MODEL_CONFIGS = {
    "tiny": "configs/sam2.1/sam2.1_hiera_t.yaml",
    "small": "configs/sam2.1/sam2.1_hiera_s.yaml",
    "base_plus": "configs/sam2.1/sam2.1_hiera_b+.yaml",
    "large": "configs/sam2.1/sam2.1_hiera_l.yaml",
}


def choose_device(requested):
    import torch

    if requested and requested != "auto":
        return requested
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def mask_to_polygon(mask, simplify_epsilon):
    try:
        import cv2

        binary = mask.astype(np.uint8) * 255
        contours, _ = cv2.findContours(
            binary,
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_SIMPLE,
        )
        if not contours:
            return []

        contour = max(contours, key=cv2.contourArea)
        epsilon = max(0.0, float(simplify_epsilon))
        simplified = cv2.approxPolyDP(contour, epsilon, True)
        points = simplified.reshape(-1, 2).astype(float).tolist()
    except Exception:
        from skimage import measure

        contours = measure.find_contours(mask.astype(float), 0.5)
        if not contours:
            return []
        contour = max(contours, key=len)
        # skimage returns row, col. Convert to x, y.
        points = [[float(col), float(row)] for row, col in contour]

    if len(points) < 3:
        return []

    if points[0] != points[-1]:
        points.append(points[0])
    return points


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--model-type", required=True)
    parser.add_argument("--box", nargs=4, type=float, required=True)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--simplify-epsilon", type=float, default=2)
    args = parser.parse_args()

    try:
      import torch
      from sam2.build_sam import build_sam2
      from sam2.sam2_image_predictor import SAM2ImagePredictor

      model_config = MODEL_CONFIGS.get(args.model_type)
      if not model_config:
          raise ValueError(f"Unsupported SAM 2.1 model type: {args.model_type}")
      if not os.path.isfile(args.checkpoint):
          raise FileNotFoundError(f"Checkpoint file was not found: {args.checkpoint}")

      device = choose_device(args.device)
      image = np.array(Image.open(args.image).convert("RGB"))
      box = np.array(args.box, dtype=np.float32)

      sam_model = build_sam2(model_config, args.checkpoint, device=device)
      predictor = SAM2ImagePredictor(sam_model)
      predictor.set_image(image)

      with torch.inference_mode():
          masks, scores, _ = predictor.predict(
              point_coords=None,
              point_labels=None,
              box=box,
              multimask_output=True,
          )

      if masks is None or len(masks) == 0:
          raise RuntimeError("SAM 2.1 did not return a mask.")

      best_index = int(np.argmax(scores)) if scores is not None else 0
      mask = masks[best_index]
      polygon = mask_to_polygon(mask, args.simplify_epsilon)
      if not polygon:
          raise RuntimeError("Could not convert SAM mask to a polygon.")

      print(json.dumps({
          "ok": True,
          "polygon": polygon,
          "score": float(scores[best_index]) if scores is not None else None,
          "modelType": args.model_type,
          "modelConfig": model_config,
          "device": device,
          "imageWidth": int(image.shape[1]),
          "imageHeight": int(image.shape[0]),
      }))
      return 0
    except Exception as error:
      print(json.dumps({
          "ok": False,
          "error": str(error),
          "traceback": traceback.format_exc(),
      }))
      return 1


if __name__ == "__main__":
    sys.exit(main())
