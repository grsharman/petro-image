# Segment

## Purpose

Segment uses model-assisted workflows to digitize feature outlines as polygon annotations. It reduces manual tracing effort but does not determine the scientific identity of the segmented feature.

## Inputs and prerequisites

The desktop tool currently supports:

- Supervised segmentation using SAM 2.1 (Ravi et al., 2024) with a box and optional positive or negative point prompts
- Unsupervised grain proposals using segmenteverygrain (Sylvester et al., 2025), with optional SAM 2.1 refinement

These workflows require compatible Python environments and model checkpoints. The selected tile set, area of interest, resolution, prompts, and processing settings affect the result.

Python segmentation is currently available only in the desktop app and requires locally accessible Deep Zoom imagery. The Python environment and model files are not bundled with petro-image.

## Python environment setup

### What each workflow requires

Both workflows use the Python executable selected under **Segment → Python Setup → SAM 2.1 Setup**. Once petro-image has been linked to that executable, the environment does not need to remain activated in a terminal.

### Recommended installation with conda or mamba

The recommended approach is to create the environment from the files maintained by the [segmenteverygrain project](https://github.com/zsylvester/segmenteverygrain). These files create an environment named `segmenteverygrain` with Python 3.10 and install segmenteverygrain, TensorFlow, PyTorch, torchvision, SAM 2, OpenCV, scikit-image, and the other upstream dependencies.

1. Install [Miniforge](https://conda-forge.org/download/) or another conda/mamba distribution.
2. Open Terminal on macOS or Linux, or a conda-enabled terminal such as Miniforge Prompt on Windows.
3. Clone the upstream repository:

```sh
git clone --depth 1 https://github.com/zsylvester/segmenteverygrain.git
```

4. Create the environment.

On macOS:

```sh
conda env create -f segmenteverygrain/environment_macos.yml
```

On Windows or Linux:

```sh
conda env create -f segmenteverygrain/environment.yml
```

If using mamba, replace `conda` with `mamba` in these commands.

5. Activate the environment:

```sh
conda activate segmenteverygrain
```

6. Confirm which Python executable belongs to it:

```sh
conda run -n segmenteverygrain python -c "import sys; print(sys.executable)"
```

The resulting path normally ends in `envs/segmenteverygrain/bin/python` on macOS or Linux and `envs\segmenteverygrain\python.exe` on Windows. Keep this path for the petro-image setup step.

The upstream environment is the simplest way to obtain a mutually compatible dependency set. A manually constructed environment can also work, but petro-image expects Python 3.10 or newer together with importable `torch`, `torchvision`, `sam2`, `hydra`, `omegaconf`, and either `opencv-python` or `scikit-image` for SAM. segmenteverygrain additionally requires an importable `segmenteverygrain` installation and the dependencies needed to load its Keras model, including TensorFlow.

### Download the model files

Python packages and model weights are separate. Installing the packages does not necessarily download the files selected in petro-image.

For supervised segmentation or SAM refinement, download a SAM 2.1 `.pt` checkpoint from the [official SAM 2 repository](https://github.com/facebookresearch/sam2#download-checkpoints). The model selected in petro-image must match the checkpoint:

| petro-image model | Matching SAM 2.1 checkpoint |
| --- | --- |
| `tiny` | `sam2.1_hiera_tiny.pt` |
| `small` | `sam2.1_hiera_small.pt` |
| `base_plus` | `sam2.1_hiera_base_plus.pt` |
| `large` | `sam2.1_hiera_large.pt` |

Larger models generally require more memory and processing time. `large` is the default selection in petro-image and is recommended for improved segmentation accuracy.

For the unsupervised workflow, select a trained `.keras` or `.h5` model from the cloned [segmenteverygrain models directory](https://github.com/zsylvester/segmenteverygrain/tree/main/models). The upstream repository currently includes `seg_model.keras` and `seg_model_smooth_labels.keras`. This is the grain-proposal model, not the Python executable or SAM checkpoint.

### Link the environment to petro-image

1. Open the desktop app and open the **Segment** palette.
2. Expand **Python Setup**, then **SAM 2.1 Setup**.
3. Click **Choose Python** and select the exact executable printed by the `sys.executable` command above. Select the executable file itself, not the environment folder, the `conda` program, or a terminal shortcut.
4. Click **Choose Checkpoint** and select the downloaded SAM 2.1 `.pt` file.
5. Choose the matching SAM 2.1 model size.
6. Click **Save**, then **Test SAM**.
7. For the unsupervised workflow, expand **segmenteverygrain Setup**, click **Choose Model**, and select the trained `.keras` or `.h5` file.
8. Click **Test segmenteverygrain**.

The setup indicators should turn green before running the corresponding workflow. petro-image remembers the selected paths and validation state. Changing the Python executable, checkpoint, model type, or segmenteverygrain model invalidates the previous test and requires testing again.

**Test SAM** verifies the selected interpreter and checkpoint, supported model type, PyTorch and torchvision, the SAM 2 builder and image predictor, and supporting modules. It also reports whether PyTorch recommends CUDA, Apple Metal Performance Shaders (MPS), or CPU execution.

**Test segmenteverygrain** verifies that the package can be imported in a separate Python process and that the selected model exists and has a `.keras` or `.h5` extension. It also reports imports of TensorFlow, PyTorch, OpenCV, and scikit-image. Review warnings as well as errors; for example, TensorFlow must be usable when the selected Keras model is loaded.

The first setup test can take several minutes on a new machine because TensorFlow, PyTorch, and other native libraries may initialize slowly the first time they are imported. Each module is allowed up to two minutes. If the diagnostic says a module was found but its import did not finish, wait for the test to complete and try it once more before recreating the environment.

### Platform and performance notes

- On macOS, the upstream environment includes `tensorflow-metal`, and SAM can use MPS when the installed PyTorch build supports it.
- On Windows, select a native Windows environment and its `python.exe`. A Python executable inside Windows Subsystem for Linux is not directly selectable by the Windows desktop app.
- On Linux or Windows with an NVIDIA GPU, CUDA use depends on installing a PyTorch build compatible with the system's drivers and CUDA runtime. Consult the [official SAM 2 installation guidance](https://github.com/facebookresearch/sam2/blob/main/INSTALL.md) before modifying the environment.
- CPU execution is supported but may be slow, especially for a large checkpoint, a large area of interest, full-resolution imagery, or SAM refinement of many grain proposals.
- Start with a small area of interest and a reduced processing resolution to verify the complete workflow before processing a large image.

### Troubleshooting

| Symptom | Likely cause or next step |
| --- | --- |
| **Choose Python** points to a folder or `conda` | Run the `sys.executable` command again and select the returned `python` or `python.exe` file. |
| `torch`, `torchvision`, or `sam2` is missing | The wrong interpreter was selected or the environment installation was incomplete. Activate the environment and test the imports from that same Python. |
| The SAM checkpoint is rejected or model loading reports incompatible keys | Confirm that it is a SAM **2.1** checkpoint and that `tiny`, `small`, `base_plus`, or `large` matches the filename. |
| SAM reports a missing Hydra configuration | Reinstall SAM 2 in the selected environment following the upstream installation instructions; the installed package must include the `configs/sam2.1` configuration files. |
| The segmenteverygrain model is rejected | Select a trained `.keras` or `.h5` model file rather than the Python executable or SAM `.pt` checkpoint. |
| TensorFlow or another native module fails to import | Recreate the upstream environment for the current operating system and review the complete diagnostic text returned by **Test segmenteverygrain**. |
| Processing is extremely slow or runs out of memory | Use a smaller model, reduce the processing resolution or area of interest, decrease the patch size, or disable SAM refinement. |

## Method

For supervised segmentation, the user supplies a bounding box and optionally points that indicate included or excluded regions, then clicks **Segment** to run SAM 2.1. After reviewing the predicted mask, the user can add it as an editable polygon annotation. The Segment button is enabled again when prompts or segmentation settings change. In **Fast segmentation mode**, users can Alt/Option+drag to define box inputs that are automatically segmented and added.

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
