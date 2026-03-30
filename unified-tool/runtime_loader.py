"""
Helpers for loading recovered runtime bytecode modules (.pyc).

This project currently contains a mixed state: some modules are editable source,
while several core modules are only available as runtime bytecode.
"""

from __future__ import annotations

import marshal
import pathlib
import sys
from types import ModuleType


def _load_code_from_pyc(pyc_path: pathlib.Path):
    data = pyc_path.read_bytes()
    if len(data) < 16:
        raise RuntimeError(f"Invalid pyc (too small): {pyc_path}")
    return marshal.loads(data[16:])


def _runtime_roots(current_file: str):
    current = pathlib.Path(current_file).resolve()
    project_root = current.parent.parent
    return [
        project_root / "runtime",
        project_root.parent / "runtime",
    ]


def load_runtime_module(current_file: str, module_name: str) -> ModuleType:
    rel_pyc = pathlib.Path(*module_name.split(".")).with_suffix(".pyc")
    candidates = [root / rel_pyc for root in _runtime_roots(current_file)]
    runtime_pyc = next((p for p in candidates if p.exists()), None)
    if runtime_pyc is None:
        tried = ", ".join(str(p) for p in candidates)
        raise FileNotFoundError(f"Runtime module not found for {module_name}. Tried: {tried}")

    code = _load_code_from_pyc(runtime_pyc)
    module = ModuleType(module_name)
    module.__file__ = str(runtime_pyc)
    module.__cached__ = str(runtime_pyc)
    module.__package__ = module_name.rpartition(".")[0]
    sys.modules[module_name] = module
    exec(code, module.__dict__, module.__dict__)
    return module


def export_runtime_symbols(target_globals: dict, runtime_module: ModuleType):
    protected = {
        "__name__",
        "__file__",
        "__package__",
        "__cached__",
        "__loader__",
        "__spec__",
        "__builtins__",
    }
    for name, value in runtime_module.__dict__.items():
        if name not in protected:
            target_globals[name] = value

    if "__all__" in runtime_module.__dict__:
        target_globals["__all__"] = runtime_module.__dict__["__all__"]

