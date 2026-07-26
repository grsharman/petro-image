# Polarization Analysis: detailed methods

This page defines the calculations and classification rules used by the [Polarization Analysis](polarization-analysis.md) method within [Transform](transform.md).

## Inputs, coordinates, and acquisition assumptions

The user assigns tile sets to the PPL, XPL, and, where applicable, CPL roles. A fitted product requires at least three finite angles that produce a nonsingular design matrix. More observations with broad angular coverage are strongly preferred; six PPL and six XPL images are ideal.

The current XPL model assumes that the polarizer and analyzer are crossed at 90° and rotate together. This has the same relative optical effect as keeping the crossed polars fixed while rotating the specimen stage. Reported angles use the image-coordinate convention and supplied acquisition angles.

Calculations may use red, green, blue, or luminance intensity. Luminance is

$$
Y=0.2126R+0.7152G+0.0722B.
$$

The anisotropy classifier always uses luminance. Its default intensity thresholds assume 8-bit data numbers (DN) on a 0–255 scale. Registration,illumination, exposure, white balance, and camera response should be consistent among images. Differences in any of these can be fitted as apparent angular variation.

## Harmonic response models

For each pixel, petro-image fits the observations by ordinary, unweighted least squares:

$$
I(\theta_i)=a+b\cos(h\theta_i)+c\sin(h\theta_i)+\varepsilon_i,
$$

where \(I(\theta_i)\) is the selected-channel intensity at acquisition angle \(\theta_i\), \(a\) is the fitted mean, \(b\) and \(c\) are harmonic coefficients, and \(h\) is the harmonic number. Angles are converted to radians during fitting.

PPL uses \(h=2\), giving a 180° period appropriate for a bidirectional maximum-transmission axis. XPL uses \(h=4\), giving a 90° period for the repeated extinction/maximum cycle under crossed polars. The fitted amplitude and extrema are

$$
A=\sqrt{b^2+c^2},\qquad
I_{\min}=a-A,\qquad
I_{\max}=a+A,
$$

and normalized modulation is

$$
M=\frac{A}{|a|}.
$$

\(M\) is dimensionless. The unnormalized amplitude \(A\) has the same intensity units as the source. Although display ranges are normally 0–255 for intensity and 0–1 for normalized modulation, an unconstrained least-squares fit can produce extrema outside 0–255 or \(M>1\), particularly for noisy or poorly sampled data.

The fitted maximum azimuth is

$$
\theta_{\max}=
\operatorname{mod}\left[
\frac{180^\circ}{\pi h}\operatorname{atan2}(c,b),
\frac{360^\circ}{h}
\right],
$$

and the minimum azimuth is

$$
\theta_{\min}=
\operatorname{mod}\left[
\theta_{\max}+\frac{180^\circ}{h},
\frac{360^\circ}{h}
\right].
$$

Thus PPL maximum-transmission azimuth is reported on \([0,180^\circ)\) and XPL extinction azimuth on \([0,90^\circ)\). These are axial, not directional, measurements: 0° and 180° describe the same PPL axis, while equivalent XPL extinction positions repeat every 90°.

### Fit error

Fit error is reported as the root mean square residual

$$
\operatorname{RMSE}=
\sqrt{\frac{1}{n}\sum_{i=1}^{n}
\left[I_i-\hat I(\theta_i)\right]^2}.
$$

This is a descriptive RMSE divided by \(n\), not a residual standard error divided by \(n-3\). With exactly three observations, the three-parameter model is exactly determined and normally has zero residual degrees of freedom. Such a fit can interpolate all three observations but cannot independently test model adequacy. The interface marks it as an exact fit with residual unchecked, and fit quality is capped as described under classification.

Normalized RMSE uses the same intensity-relative scale as the reliability rules:

$$
e=\frac{\operatorname{RMSE}}{\max(|a|,A,1)}.
$$

### Azimuth uncertainty

For more than three observations, the approximate covariance of the fitted coefficients is

$$
\operatorname{Cov}(\hat{\boldsymbol\beta})=
\hat\sigma^2(\mathbf X^\mathsf T\mathbf X)^{-1},
\qquad
\hat\sigma^2=\frac{\mathrm{SSE}}{n-3}.
$$

Let \(V_{bb}\), \(V_{cc}\), and \(V_{bc}\) be the corresponding covariance terms for \(b\) and \(c\). Propagating this covariance through \(\theta=h^{-1}\operatorname{atan2}(c,b)\) gives the approximate azimuth variance in radians squared:

$$
\operatorname{Var}(\theta)\approx
\frac{c^2V_{bb}+b^2V_{cc}-2bcV_{bc}}
{h^2(b^2+c^2)^2}.
$$

Azimuth uncertainty is reported as the resulting one-standard-error value in degrees. It incorporates residual variation, angular sampling, and fitted amplitude under the ordinary-least-squares assumptions. It becomes large as modulation approaches zero and is undefined when \(n\le3\), because residual variance cannot then be estimated independently.

## Calculated products

| Calculation | Definition | Units and nominal display range | Interpretation |
| --- | --- | --- | --- |
| PPL modulation | \(A=\sqrt{b^2+c^2}=(I_{\max}-I_{\min})/2\) | Intensity, 0–255 | Fitted half-range of the PPL response using all angular observations. |
| PPL normalized modulation | \(A/\lvert a\rvert\) | Ratio, nominally 0–1 | Relative PPL modulation, reducing dependence on absolute brightness. |
| PPL predicted maximum transmission | \(a+A\) from the \(h=2\) fit | Intensity, 0–255 | Synthetic intensity at the fitted maximum-transmission orientation. |
| PPL predicted minimum transmission | \(a-A\) from the \(h=2\) fit | Intensity, 0–255 | Synthetic intensity at the orthogonal fitted minimum-transmission orientation. |
| PPL maximum-transmission azimuth | \(\theta_{\max}\) for \(h=2\) | Degrees, 0–180 | Bidirectional image-coordinate axis of fitted maximum transmission. |
| PPL fit RMSE | RMSE of the \(h=2\) fit | Intensity, 0–64 display scale | Residual mismatch between observations and the harmonic model. |
| PPL normalized RMSE | \(e=\mathrm{RMSE}/\max(\lvert a\rvert,A,1)\) | Ratio, nominal display 0–0.5 | Intensity-relative residual mismatch. |
| PPL azimuth uncertainty | \(\sqrt{\operatorname{Var}(\theta_{\max})}\) | Degrees, nominal display 0–45 | Approximate one-standard-error uncertainty. Available only with more than three observations. |
| PPL azimuth reliability | PPL fit-error, modulation, and signal tests | Binary mask, 0 or 1 | Modality-specific mask used by **Fits = Reliable**. |
| XPL modulation | \(A=\sqrt{b^2+c^2}=(I_{\max}-I_{\min})/2\) | Intensity, 0–255 | Fitted half-range of the XPL response. |
| XPL normalized modulation | \(A/\lvert a\rvert\) | Ratio, nominally 0–1 | Relative angular XPL modulation. |
| XPL predicted maximum | \(a+A\) from the \(h=4\) fit | Intensity, 0–255 | Synthetic XPL intensity at the fitted maximum. |
| XPL predicted minimum | \(a-A\) from the \(h=4\) fit | Intensity, 0–255 | Synthetic XPL intensity at fitted extinction. |
| XPL extinction azimuth | \(\theta_{\min}\) for \(h=4\) | Degrees, 0–90 | Image-coordinate extinction azimuth, repeated every 90°. |
| XPL fit RMSE | RMSE of the \(h=4\) fit | Intensity, 0–64 display scale | Residual mismatch between observations and the harmonic model. |
| XPL normalized RMSE | \(e=\mathrm{RMSE}/\max(\lvert a\rvert,A,1)\) | Ratio, nominal display 0–0.5 | Intensity-relative residual mismatch. |
| XPL azimuth uncertainty | \(\sqrt{\operatorname{Var}(\theta_{\min})}\) | Degrees, nominal display 0–22.5 | Approximate one-standard-error uncertainty. Available only with more than three observations. |
| XPL azimuth reliability | XPL fit-error, modulation, and signal tests | Binary mask, 0 or 1 | Modality-specific mask used by **Fits = Reliable**. |
| PPL–XPL azimuth difference | \(\lvert\operatorname{mod}(\theta_{PPL}-\theta_{XPL}+45^\circ,90^\circ)-45^\circ\rvert\) | Degrees, 0–45 | Smallest separation between the PPL maximum-transmission axis and an extinction-equivalent XPL axis. |
| CPL − predicted XPL maximum | \(I_{\mathrm{CPL}}-I_{\mathrm{XPL,max}}\) | Intensity, −255–255 | Empirical signed difference; positive values are brighter in CPL. |
| Anisotropy class | Decision rules below | Integer code, 0–5 | Pixel-scale optical-behavior class, not a mineral identification. |
| Anisotropy confidence | Class-specific evidence score below | Ratio, 0–1 | Heuristic support for the assigned class; not a probability. |

Simple observed mean and range for rotation-aware tile sets are intentionally not duplicated as Polarization products. They can be calculated in Image Calculator, for example with `mean(A.l)` or `range(A.l)`. PPL and XPL modulation are fitted amplitudes \(A\)—half the corresponding predicted maximum-to-minimum differences—not raw observed ranges.

The PPL and XPL reliability products are separate because the modalities use different signal and modulation tests. With exactly three images they reproduce the current mask but remain residual-unchecked; they are thresholded indicators rather than probabilities.

## Synthetic RGB output

RGB output is available for predicted PPL maximum, predicted PPL minimum, predicted XPL maximum, and predicted XPL minimum. A luminance fit first determines one physically consistent target angle \(\theta^*\). Red, green, and blue are then fitted independently and evaluated at that shared angle:

$$
\mathbf I_{\mathrm{RGB}}(\theta^*)=
\left[
\hat I_R(\theta^*),
\hat I_G(\theta^*),
\hat I_B(\theta^*)
\right].
$$

Using one luminance-derived angle prevents each color channel from selecting a different synthetic orientation. Scalar and false-color outputs instead use the channel selected in the interface.

## Fit at cursor, histogram, and rose diagram

**Fit at cursor** plots the angular observations and fitted curve for the pixel under the cursor. It reports fitted minimum, maximum, amplitude, normalized modulation, azimuth, RMSE, and normalized RMSE. Double-clicking the image pins the sampled point so the cursor can move without changing the chart.

For analytical previews, the histogram and rose diagram use a common,approximately uniform screen-space sample of up to 30,000 points from the visible viewport. Each screen position samples the highest-resolution loaded analytical tile available there. Larger visible areas contribute proportionally more observations, while viewer background and positions without a calculated value are excluded. These displays are representative samples of the current view rather than exhaustive statistics over the entire source image.

The histogram, rose diagram, and azimuth preview share a fit filter. **All** includes every finite fitted azimuth. **Reliable** retains pixels that satisfy the fit-error, normalized-modulation, and signal tests associated with the selected classification preset; failing pixels are shown in neutral gray without changing their analytical values. Both statistical views report the included fraction and sampled-pixel count.

The rose diagram treats measurements as axial by expanding each PPL observation to \(\theta\) and \(\theta+180^\circ\), and each XPL observation to \(\theta\), \(\theta+90^\circ\), \(\theta+180^\circ\), and \(\theta+270^\circ\). PPL uses 10° bins and XPL uses 5° bins. Bin radius is linear in sample count.

## Pixel-based anisotropy classification

The classifier combines observed luminance statistics with PPL and XPL fits. Its classes describe image behavior:

| Code | Class | Required evidence |
| ---: | --- | --- |
| 0 | Unresolved / poor fit | No supported class, missing or conflicting evidence, poor fit, or confidence below the selected minimum. |
| 1 | Opaque-like / very low transmission | Very low PPL transmission. A single PPL image can provide limited evidence. |
| 2 | Isotropic-like / continuously extinct | Transmissive, reliably non-pleochroic PPL response plus continuously dark XPL. |
| 3 | Pleochroic | Reliable PPL modulation without reliable positive XPL evidence. |
| 4 | Birefringent | Reliable XPL modulation without reliable positive PPL evidence. |
| 5 | Pleochroic + birefringent | Reliable positive PPL and XPL responses. |

“Opaque-like” and “isotropic-like” are deliberately qualified. A dark pixel may reflect absorption, thickness, polishing, illumination, registration, or sensor limitations. Continuous XPL darkness can resemble isotropic behavior without proving mineral isotropy.

### Presets and thresholds

<b>Note:</b> Present thresholds are experimental and still under development.

| Symbol | Interface threshold | Conservative | Balanced | Sensitive |
| --- | --- | ---: | ---: | ---: |
| \(L\) | Low PPL transmission (DN) | 12 | 15 | 20 |
| \(D\) | XPL extinction ceiling (DN) | 8 | 12 | 18 |
| \(P\) | Minimum PPL normalized modulation | 0.12 | 0.08 | 0.05 |
| \(P_{\mathrm{abs}}\) | Minimum PPL amplitude (DN) | 6 | 4 | 3 |
| \(X\) | Minimum XPL normalized modulation | 0.22 | 0.15 | 0.10 |
| \(E_{\max}\) | Maximum normalized fit error | 0.08 | 0.12 | 0.18 |
| \(C_{\min}\) | Minimum classification confidence | 0.50 | 0.35 | 0.25 |

The presets are heuristic starting points, not universally calibrated physical boundaries. Changing acquisition conditions or bit depth generally requires validation and possibly custom thresholds.

### Fit reliability and evidence functions

For either fit, the normalization scale and normalized fit error are

$$
s=\max(|a|,A,1),\qquad
e=\frac{\operatorname{RMSE}}{s}.
$$

The fit is reliable when \(e\le E_{\max}\). Its quality score is

$$
q=
\begin{cases}
\operatorname{clip}_{[0,1]}
\left(1-\frac{1}{2}\frac{e}{E_{\max}}\right),
& e\le E_{\max},\\[4pt]
\operatorname{clip}_{[0,1]}
\left(\frac{1}{2}\frac{E_{\max}}{\max(e,\epsilon)}\right),
& e>E_{\max}.
\end{cases}
$$

For three or fewer observations, \(q\) is capped at 0.55 because the residual is not an independent check on the three-parameter fit.

Evidence relative to a positive threshold \(t\) is

$$
E_+(v,t)=\operatorname{clip}_{[0,1]}
\left(0.5+\frac{v-t}{2\max(t,\epsilon)}\right),
$$

while evidence that a value lies below a threshold is

$$
E_-(v,t)=\operatorname{clip}_{[0,1]}
\left(0.5+\frac{t-v}{2\max(t,\epsilon)}\right).
$$

A value exactly at its decision threshold has evidence 0.5. These linear scores quantify separation from selected thresholds; they are not likelihood functions.

### Decision rules and confidence

Let \(M_P\), \(A_P\), and \(q_P\) denote PPL normalized modulation, amplitude, and fit quality. Let \(M_X\), \(A_X\), and \(q_X\) denote their XPL equivalents. The PPL amplitude noise floor is

$$
N_P=\max\left(P_{\mathrm{abs}},
\begin{cases}
2\operatorname{RMSE}_P,& n_P>3,\\
0,& n_P\le3.
\end{cases}\right).
$$

PPL-positive requires a reliable fit, \(M_P\ge P\), and \(A_P\ge N_P\). Its evidence is

$$
C_P=\min\left[
E_+(M_P,P),
E_+(A_P,\max(N_P,1)),
q_P
\right].
$$

XPL-positive requires a reliable fit, an observed XPL maximum greater than \(D\), \(M_X\ge X\), and \(A_X\ge2\) DN. Its evidence is

$$
C_X=\min\left[E_+(M_X,X),E_+(A_X,2),q_X\right].
$$

Several rules use conservative maxima. Let \(I_{P,\mathrm{obs}}^{\max}\) and \(I_{X,\mathrm{obs}}^{\max}\) be observed maxima, and let \(I_{P,\mathrm{fit}}^{\max}\) and \(I_{X,\mathrm{fit}}^{\max}\) be predicted maxima from reliable fits:

$$
I_{P,\mathrm{opaque}}=
\begin{cases}
\max(I_{P,\mathrm{obs}}^{\max},I_{P,\mathrm{fit}}^{\max}),
& \text{reliable PPL fit},\\
I_{P,\mathrm{obs}}^{\max},& \text{otherwise},
\end{cases}
$$

$$
I_{X,\mathrm{dark}}=
\begin{cases}
\max(I_{X,\mathrm{obs}}^{\max},I_{X,\mathrm{fit}}^{\max}),
& \text{reliable XPL fit},\\
I_{X,\mathrm{obs}}^{\max},& \text{otherwise}.
\end{cases}
$$

The reliable fitted PPL maximum, when available, is used as the PPL transmission estimate \(I_{P,\mathrm{trans}}\); otherwise the observed PPL maximum is used. These choices prevent an undersampled observation or a fitted curve alone from making the pixel appear darker than the combined evidence supports.

- **Opaque-like:** The observed PPL maximum must be \(\le L\), and a reliable predicted PPL maximum, if available, must also be \(\le L\). Confidence is \(E_-(I_{P,\mathrm{opaque}},\max(L,1))s_P\), where \(s_P=0.8\) for one PPL observation and 1 otherwise.
- **Isotropic-like:** At least three XPL observations must satisfy \(I_{X,\mathrm{dark}}\le D\); a reliable PPL fit from at least three images must not be PPL-positive. Confidence is \(\min[E_+(I_{P,\mathrm{trans}},\max(L,1)), E_-(I_{X,\mathrm{dark}},\max(D,1))]s_X\), where \(s_X=0.65\) for exactly three XPL observations and 1 for more than three.
- **Pleochroic + birefringent:** Both tests are positive and confidence is \(\min(C_P,C_X)\).
- **Pleochroic:** Only PPL is positive and confidence is \(C_P\). It is multiplied by 0.75 when XPL exists but is neither reliably fitted nor continuously dark.
- **Birefringent:** Only XPL is positive and confidence is \(C_X\). It is multiplied by 0.75 when a PPL fit exists but is unreliable.
- **Unresolved:** When neither response is positive, retained confidence is at most half of the better available fit-quality score. Any provisional nonzero class with confidence below \(C_{\min}\) is reassigned to unresolved while retaining its evidence score.

Anisotropy confidence is a deterministic, heuristic evidence score constructed from threshold separation, fit quality, and limited-sampling penalties. It is not a posterior probability, confidence interval, p-value, or empirically calibrated probability of correct mineral classification. Missing PPL or XPL information is treated as missing evidence, not as a negative observation. If a class cannot be assessed from available inputs, its histogram percentage is displayed as `--` rather than 0%.

## Display, export, and reproducibility

False color changes only visualization, not analytical values. Cyclic hue is the default for PPL and XPL azimuths; shifted cyclic palettes move the seam. Viridis is the default for noncyclic scalar products, and a zero-centered diverging map is used for CPL − predicted XPL maximum. Histograms and cursor values for scalar outputs report analytical units rather than display RGB values.

NumPy and TIFF exports preserve scalar analytical values. PNG and JPEG preserve the current display mapping. For synthetic RGB products, the image contains the calculated RGB values; scalar analytical export retains the corresponding luminance calculation. Exported analytical rasters include coordinate and provenance information so source roles, angles, calculation, channel, and settings can be reconstructed.

For scientific reporting, record at minimum:

- petro-image version or commit;
- source tile-set roles and every acquisition angle;
- image registration and any illumination, exposure, flat-field, or color normalization;
- selected channel or RGB output;
- classification preset and any custom thresholds;
- export resolution and file format; and
- whether azimuth summaries used all fits or only reliable fits.
