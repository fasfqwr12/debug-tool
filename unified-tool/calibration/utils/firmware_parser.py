"""
Source wrapper for `calibration/utils/firmware_parser.py`.
"""

from __future__ import annotations

from .._runtime_loader import load_runtime_calibration_module

_runtime = load_runtime_calibration_module(["utils", "firmware_parser"], "calibration.utils._runtime_firmware_parser")

for _name in dir(_runtime):
    if _name.startswith("__"):
        continue
    globals()[_name] = getattr(_runtime, _name)

__all__ = [name for name in globals() if not name.startswith("_")]
