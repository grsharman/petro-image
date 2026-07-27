# Classify

## Purpose

Classify learns from labeled polygon annotations to predict labels for other polygons or to create a pixel-classification raster. It is an interactive supervised-classification tool, and it is up to the user to provide ground-truth labels.

To assign grain-polygon groups directly from point counts without training a
model, use
[Label Grains from Counts](../actions/label-grains-from-counts.md).

<b>Note:</b> Classify is still in under development and is presented in beta.

## Inputs and prerequisites

Classification requires representative labeled polygons and selected source tile sets. Available feature families include:

- Color, chromaticity, luminance, and saturation
- Polarization products from eligible multi-angle imagery
- General texture
- Lamellar texture
- Shape measurements for polygon classification

The selected labels, feature families, image resolution, model, and confidence threshold define the experiment.

## Method

Image features are sampled within labeled polygons with a configurable boundary inset. Eligible multi-angle tile sets can contribute fitted polarization features. Scale-calibrated imagery can contribute texture products at requested physical window sizes.

The tool supports Random Forest and k-nearest-neighbor models. Validation uses held-out polygons; each validation polygon contributes one confusion-matrix result based on its sampled-pixel probabilities. After validation, the model is retrained using all labeled polygons before prediction.

## Outputs

Polygon mode predicts groups for annotations and applies them only when the user commits the result. Image mode produces a classification overlay that can be exported. Results include held-out validation, feature importance where available, predicted classes, confidence values, and unclassified results below the selected threshold.

## Assumptions and limitations

- Predictions reproduce patterns in the supplied labels and features.
- Biased, sparse, spatially autocorrelated, or inconsistent training polygons can produce misleading validation and predictions.
- Held-out polygon validation is not a substitute for an independent test set.
- Confidence is model output used for triage and is not automatically calibrated probability.
- Feature selection, image resolution, model tuning, and thresholds remain experimental.
- The in-app Random Forest is intended for interactive exploration rather than final research-grade model validation.
