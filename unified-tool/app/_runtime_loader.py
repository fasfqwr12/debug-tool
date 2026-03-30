from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def load_runtime_app_module(module_name: str):
    here = Path(__file__).resolve()
    candidates = [
        here.parents[1] / "runtime" / "app" / f"{module_name}.pyc",  # unified-tool/runtime
        here.parents[2] / "runtime" / "app" / f"{module_name}.pyc",  # legacy sibling runtime
    ]
    runtime_pyc = next((p for p in candidates if p.exists()), candidates[0])
    spec = importlib.util.spec_from_file_location(f"app._runtime_{module_name}", runtime_pyc)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load runtime app module from {runtime_pyc}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module
