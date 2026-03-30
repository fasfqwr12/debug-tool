#!/usr/bin/env python3
"""
Runtime bootstrap for recovered GreenLaser main entry.

The real entry bytecode is still available as ``main_web.pyc``. Until full
source recovery is complete, this loader executes that bytecode with standard
``__main__`` semantics so the recovered runtime can be started and tested.
"""

from __future__ import annotations

import marshal
import pathlib
import sys
from types import CodeType


def _load_code_from_pyc(pyc_path: pathlib.Path) -> CodeType:
    data = pyc_path.read_bytes()
    if len(data) < 16:
        raise RuntimeError(f"Invalid pyc (too small): {pyc_path}")
    try:
        return marshal.loads(data[16:])
    except Exception as exc:  # pragma: no cover - recovery path
        raise RuntimeError(f"Failed to decode pyc: {pyc_path}") from exc


def main() -> None:
    pyc_path = pathlib.Path(__file__).with_suffix(".pyc")
    if not pyc_path.exists():
        raise FileNotFoundError(f"Missing entry bytecode: {pyc_path}")

    # Keep local imports consistent with direct script execution.
    runtime_root = str(pathlib.Path(__file__).resolve().parent)
    if runtime_root not in sys.path:
        sys.path.insert(0, runtime_root)

    code = _load_code_from_pyc(pyc_path)
    globals_dict = {
        "__name__": "__main__",
        "__file__": str(pathlib.Path(__file__).resolve()),
        "__package__": None,
        "__cached__": str(pyc_path.resolve()),
        "__doc__": None,
    }
    exec(code, globals_dict, globals_dict)


if __name__ == "__main__":
    main()
