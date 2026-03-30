from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def load_runtime_calibration_module(rel_parts: list[str], module_name: str):
    here = Path(__file__).resolve()
    runtime_root = here.parents[1] / "runtime" / "calibration"
    if not runtime_root.exists():
        runtime_root = here.parents[2] / "runtime" / "calibration"
    runtime_pyc = runtime_root.joinpath(*rel_parts).with_suffix(".pyc")
    spec = importlib.util.spec_from_file_location(module_name, runtime_pyc)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load runtime calibration module from {runtime_pyc}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module
