"""Validate a segmenteverygrain environment without risking the probe process.

TensorFlow and other native dependencies can terminate Python during import on
Windows (for example, when a DLL is missing). Each import therefore runs in a
child Python process so this script can still return structured diagnostics.
"""

import importlib.util
import json
import os
import subprocess
import sys
import traceback


MODEL_EXTENSIONS = {".h5", ".keras"}
IMPORT_TIMEOUT_SECONDS = 120
IMPORT_PROBE = r"""
import importlib
import json
import sys

try:
    module = importlib.import_module(sys.argv[1])
    version = getattr(module, "__version__", "")
    payload = {"available": True}
    if version:
        payload["version"] = str(version)
except BaseException as error:
    payload = {
        "available": False,
        "importError": f"{type(error).__name__}: {error}",
    }

print("\n" + json.dumps(payload), flush=True)
"""


def parse_json_object(output):
    for line in reversed(str(output or "").strip().splitlines()):
        for index, character in enumerate(line):
            if character != "{":
                continue
            try:
                value = json.loads(line[index:])
            except (TypeError, ValueError):
                continue
            if isinstance(value, dict):
                return value
    return None


def output_detail(completed):
    text = (completed.stderr or completed.stdout or "").strip()
    if text:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        return " | ".join(lines[-8:])[-4000:]
    return f"Python exited with code {completed.returncode}."


def probe_module(display_name, import_name=None, required=False):
    import_name = import_name or display_name
    try:
        installed = importlib.util.find_spec(import_name) is not None
    except BaseException as error:
        installed = False
        module_result = {
            "available": False,
            "importError": f"Module lookup failed: {type(error).__name__}: {error}",
        }
    else:
        module_result = {"available": installed}

    if installed:
        try:
            completed = subprocess.run(
                [sys.executable, "-c", IMPORT_PROBE, import_name],
                capture_output=True,
                encoding="utf-8",
                errors="replace",
                timeout=IMPORT_TIMEOUT_SECONDS,
                check=False,
            )
        except subprocess.TimeoutExpired:
            module_result = {
                "installed": True,
                "available": False,
                "timedOut": True,
                "importError": (
                    "Module was found, but its import did not finish within "
                    f"{IMPORT_TIMEOUT_SECONDS} seconds. This can happen during "
                    "first startup; try the setup test again."
                ),
            }
        except BaseException as error:
            module_result = {
                "installed": True,
                "available": False,
                "importError": f"Could not start import probe: {type(error).__name__}: {error}",
            }
        else:
            payload = parse_json_object(completed.stdout)
            if completed.returncode == 0 and payload is not None:
                module_result.update(payload)
            else:
                module_result = {
                    "installed": True,
                    "available": False,
                    "importError": output_detail(completed),
                    "exitCode": completed.returncode,
                }

    if not module_result.get("available"):
        detail = module_result.get("importError")
        if detail:
            message = f"{display_name} import failed: {detail}"
        else:
            message = f"{display_name} is not importable."
        (result["errors"] if required else result["warnings"]).append(message)

    result["modules"][display_name] = module_result
    return bool(module_result.get("available"))


model_path = sys.argv[1] if len(sys.argv) > 1 else ""
result = {
    "ok": False,
    "pythonExecutable": sys.executable,
    "pythonVersion": sys.version.split()[0],
    "modelPath": model_path,
    "modelExists": False,
    "modelSizeBytes": None,
    "modules": {},
    "errors": [],
    "warnings": [],
}

try:
    if model_path:
        result["modelExists"] = os.path.isfile(model_path)
        if result["modelExists"]:
            result["modelSizeBytes"] = os.path.getsize(model_path)
        else:
            result["errors"].append("segmenteverygrain model file was not found.")
    else:
        result["errors"].append("No segmenteverygrain model path was provided.")

    model_extension = os.path.splitext(model_path)[1].lower()
    if model_path and model_extension not in MODEL_EXTENSIONS:
        result["errors"].append(
            "segmenteverygrain model must be a .h5 or .keras file."
        )

    seg_available = probe_module("segmenteverygrain", required=True)
    probe_module("tensorflow")
    probe_module("torch")
    probe_module("opencv-python", "cv2")
    probe_module("scikit-image", "skimage")
    result["ok"] = (
        seg_available
        and result["modelExists"]
        and model_extension in MODEL_EXTENSIONS
    )
except BaseException:
    result["errors"].append(traceback.format_exc())

print("\n" + json.dumps(result), flush=True)
