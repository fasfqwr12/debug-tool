"""
Source wrapper for `app/welcome_page.py`.

This file intentionally re-exports the runnable bytecode implementation while
keeping `source_runtime/` source-first.
"""

from __future__ import annotations

from ._runtime_loader import load_runtime_app_module

_runtime = load_runtime_app_module("welcome_page")

for _name in dir(_runtime):
    if _name.startswith("__"):
        continue
    globals()[_name] = getattr(_runtime, _name)

__all__ = [name for name in globals() if not name.startswith("_")]
