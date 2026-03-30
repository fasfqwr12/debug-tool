"""
Source wrapper for `calibration/engine/device_manager.py`.
"""

from __future__ import annotations

from .._runtime_loader import load_runtime_calibration_module

_runtime = load_runtime_calibration_module(["engine", "device_manager"], "calibration.engine._runtime_device_manager")

for _name in dir(_runtime):
    if _name.startswith("__"):
        continue
    globals()[_name] = getattr(_runtime, _name)

__all__ = [name for name in globals() if not name.startswith("_")]
