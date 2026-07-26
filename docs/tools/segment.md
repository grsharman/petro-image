# Segment

## Purpose

Segment uses model-assisted workflows to digitize feature outlines as polygon annotations. It reduces manual tracing effort but does not determine the scientific identity of the segmented feature.

## Inputs and prerequisites

The desktop tool currently supports:

- Supervised segmentation using SAM 2.1 (Ravi et al., 2024) with a box and optional positive or negative point prompts
- Unsupervised grain proposals using segmenteverygrain (Sylvester et al., 2025), with optional SAM 2.1 refinement

These workflows require compatible Python environments and model checkpoints. The selected tile set, area of interest, resolution, prompts, and processing settings affect the result.

## Method

For supervised segmentation, the user supplies a bounding box and optionally points that indicate included or excluded regions. SAM 2.1 predicts a mask, which petro-image converts to an editable polygon annotation. In "Fast segmentation mode", users can Alt/Option+drag to define box inputs that are then automatically segmented.

For unsupervised segmentation, segmenteverygrain uses a trained U-Net model to propose grain masks over an area of interest. Optional refinement adjusts those outlines with SAM 2.1 before they are added as annotations. Downsampling the image to lower resolution may be required to avoid very long processing times.

## Outputs

Accepted results become polygon annotations in source-image coordinates and can be edited, labeled, grouped, and exported as GeoJSON.

## Assumptions and limitations

- Output depends on model training data, checkpoint, image appearance, resolution, prompts, and post-processing parameters.
- Model boundaries should be visually reviewed and corrected.
- Adjacent, overlapping, poorly contrasted, or partly visible grains may be merged, split, or omitted.
- Changing resolution can change both boundary detail and model behavior.

## Reproducibility

Retain the source sample and tile set, area of interest, prompts where applicable, processing resolution, model names and checkpoint versions, segmentation parameters, refinement settings, accepted output GeoJSON, and petro-image version.

If used in a publication, cite the underlying method:

- Ravi, N., Gabeur, V., Hu, Y.-T., et al. (2024), SAM 2: Segment Anything in Images and Videos, arXiv:2408.00714, [doi:10.48550/arXiv.2408.00714](https://doi.org/10.48550/arXiv.2408.00714).
- Sylvester, Z., Stockli, D. F., Howes, N., et al. (2025), Segmenteverygrain: A Python module for segmentation of grains in images, *Journal of Open Source Software*, 10(112), 7953, [doi:10.21105/joss.07953](https://doi.org/10.21105/joss.07953).
