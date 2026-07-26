# Polarization Analysis

Polarization Analysis derives pixel-scale optical-response products from images acquired at multiple polarization angles. It is intended to quantify patterns that are visible while rotating a petrographic stage.

Polarization Analysis is one of three methods within the [Transform tool](transform.md).

## Purpose

Use Polarization Analysis when a specimen has mutiple PPL and/or XPL images acquired at known angles.

## Inputs and prerequisites

The user assigns image tile sets to the relevant optical roles. A fitted product requires at least three finite acquisition angles that produce a nonsingular design matrix. More observations with broad angular coverage are strongly preferred; six PPL and six XPL images are the ideal target.

## Method

At each pixel, petro-image fits harmonic intensity responses to the supplied acquisition angles. PPL uses a 180-degree-periodic response and XPL uses a 90-degree-periodic response.

See [Polarization Analysis: detailed methods](polarization-analysis-methods.md) for the equations, error estimates, product definitions, reliability rules, sampling behavior, and classification decision functions.

## Outputs

Depending on the selected product, outputs can include:

- Fitted modulation and normalized modulation
- Predicted minimum and maximum intensity
- PPL maximum-transmission azimuth
- XPL extinction azimuth
- Fit RMSE and normalized RMSE
- Approximate azimuth uncertainty
- Modality-specific reliability masks
- PPL–XPL azimuth difference
- CPL-minus-predicted-XPL differences
- Synthetic RGB extrema
- Heuristic optical-behavior classes and confidence scores

Cursor plots, histograms, and rose diagrams help inspect the fitted response and the distribution of results in the visible region.

## Acquisition assumptions

Interpretation depends on the source imagery. Registration, illumination, exposure, white balance, and camera response should be consistent among angles from the same imaging type. Differences in these properties can be fitted as if they were real angular variation.

The current XPL model assumes that the polarizer and analyzer are crossed at 90 degrees and rotate together.

Default classifier intensity thresholds assume 8-bit data numbers on a 0–255 scale.

## Interpretation limits

The anisotropy classes describe pixel-scale image behavior. Names such as “opaque-like” and “isotropic-like” are intentionally qualified: darkness or continuous extinction can arise from acquisition, preparation, thickness, registration, or sensor effects as well as specimen properties.

Classification confidence is a deterministic heuristic evidence score. It is not a probability, confidence interval, p-value, or calibrated probability of correct mineral classification.

## Reproducibility

Retain the sample identifier, role assigned to each tile set, acquisition angles, input channel, selected product, analysis resolution, classification preset or thresholds, fit filter, display range, export format, and petro-image version. Numeric exports should be retained when exact analytical values are required.

Before using derived products in research, consult the [detailed methods](polarization-analysis-methods.md), which document:

- The harmonic models and coordinate conventions
- Every calculated product and its units
- Synthetic RGB evaluation
- Sampling used by histograms and rose diagrams
- Classification presets and thresholds
- Reliability and evidence functions
- Decision rules
- Display, export, reproducibility, and known limitations
