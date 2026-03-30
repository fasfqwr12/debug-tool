#!/usr/bin/env python3
"""
Recover helper for runtime-only .pyc modules.

Outputs:
1. Bytecode disassembly (.dis.txt)
2. Code metadata summary (.meta.json)

This does not fully decompile source, but gives a stable, repeatable artifact
for incremental manual recovery.
"""

from __future__ import annotations

import argparse
import dis
import json
import marshal
import pathlib
import types
from typing import Any


def load_code_from_pyc(pyc_path: pathlib.Path) -> types.CodeType:
    data = pyc_path.read_bytes()
    if len(data) < 16:
        raise ValueError(f"Invalid pyc (too small): {pyc_path}")
    return marshal.loads(data[16:])


def walk_code_objects(code: types.CodeType, depth: int = 0):
    yield depth, code
    for const in code.co_consts:
        if isinstance(const, types.CodeType):
            yield from walk_code_objects(const, depth + 1)


def code_meta(code: types.CodeType) -> dict[str, Any]:
    return {
        "name": code.co_name,
        "qualname": getattr(code, "co_qualname", code.co_name),
        "argcount": code.co_argcount,
        "posonlyargcount": getattr(code, "co_posonlyargcount", 0),
        "kwonlyargcount": code.co_kwonlyargcount,
        "nlocals": code.co_nlocals,
        "stacksize": code.co_stacksize,
        "flags": code.co_flags,
        "firstlineno": code.co_firstlineno,
        "varnames": list(code.co_varnames),
        "names": list(code.co_names),
        "freevars": list(code.co_freevars),
        "cellvars": list(code.co_cellvars),
    }


def module_name_from_pyc(runtime_root: pathlib.Path, pyc_path: pathlib.Path) -> str:
    rel = pyc_path.relative_to(runtime_root).with_suffix("")
    return ".".join(rel.parts)


def recover_one(runtime_root: pathlib.Path, pyc_path: pathlib.Path, output_root: pathlib.Path) -> None:
    module_name = module_name_from_pyc(runtime_root, pyc_path)
    code = load_code_from_pyc(pyc_path)

    base = output_root / module_name.replace(".", "/")
    base.parent.mkdir(parents=True, exist_ok=True)

    dis_path = base.with_suffix(".dis.txt")
    meta_path = base.with_suffix(".meta.json")

    with dis_path.open("w", encoding="utf-8") as f:
        f.write(f"# module: {module_name}\n")
        f.write(f"# pyc: {pyc_path}\n\n")
        for depth, obj in walk_code_objects(code):
            indent = "  " * depth
            f.write(f"{indent}## code object: {obj.co_name} (line {obj.co_firstlineno})\n")
            f.write(f"{indent}# vars={obj.co_varnames}\n")
            f.write(f"{indent}# names={obj.co_names}\n")
            for instr in dis.Bytecode(obj):
                f.write(
                    f"{indent}{instr.offset:>4}  {instr.opname:<30} "
                    f"{instr.argrepr}\n"
                )
            f.write("\n")

    meta = {
        "module": module_name,
        "pyc_path": str(pyc_path),
        "objects": [code_meta(obj) | {"depth": depth} for depth, obj in walk_code_objects(code)],
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[OK] {module_name}")
    print(f"  dis : {dis_path}")
    print(f"  meta: {meta_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Recover readable artifacts from runtime pyc modules.")
    parser.add_argument(
        "--runtime-root",
        default="runtime",
        help="Runtime root directory that contains .pyc files (default: runtime)",
    )
    parser.add_argument(
        "--out",
        default="_recovered/disasm",
        help="Output root directory (default: _recovered/disasm)",
    )
    parser.add_argument(
        "modules",
        nargs="*",
        help="Optional module names (e.g. core.serial_manager). If omitted, recover all pyc files under runtime root.",
    )
    args = parser.parse_args()

    runtime_root = pathlib.Path(args.runtime_root).resolve()
    output_root = pathlib.Path(args.out).resolve()
    output_root.mkdir(parents=True, exist_ok=True)

    if args.modules:
        pyc_files = [runtime_root / pathlib.Path(*m.split(".")).with_suffix(".pyc") for m in args.modules]
    else:
        pyc_files = sorted(runtime_root.rglob("*.pyc"))

    missing = [p for p in pyc_files if not p.exists()]
    if missing:
        for p in missing:
            print(f"[MISS] {p}")
        return 1

    for pyc in pyc_files:
        recover_one(runtime_root, pyc, output_root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

