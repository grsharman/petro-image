#!/usr/bin/env python3
"""Compatibility entry point for the petro-image desktop application.

The source is executed in this module's namespace so existing diagnostic tests
that replace worker globals continue to exercise the standalone converter.
"""

from pathlib import Path

converter_path = Path(__file__).resolve().parents[1] / "czi_pipeline" / "converter.py"
exec(compile(converter_path.read_bytes(), str(converter_path), "exec"), globals())
