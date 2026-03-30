#!/usr/bin/env python3
"""
Generate editable source skeletons from runtime .pyc code objects.

The output is intentionally conservative:
- keeps class/function names
- emits generic signatures
- leaves TODO markers for manual restoration
"""

from __future__ import annotations

import argparse
import marshal
import pathlib
import types


def load_code_from_pyc(pyc_path: pathlib.Path) -> types.CodeType:
    data = pyc_path.read_bytes()
    if len(data) < 16:
        raise ValueError(f"Invalid pyc (too small): {pyc_path}")
    return marshal.loads(data[16:])


def walk_code_objects(code: types.CodeType):
    yield code
    for const in code.co_consts:
        if isinstance(const, types.CodeType):
            yield from walk_code_objects(const)


def is_user_symbol(name: str) -> bool:
    if name.startswith("<") and name.endswith(">"):
        return False
    if name.startswith("__") and name.endswith("__"):
        return False
    return True


def guess_kind(obj: types.CodeType) -> str:
    qn = getattr(obj, "co_qualname", obj.co_name)
    if "." in qn and "<locals>" not in qn:
        return "method"
    return "function"


def arg_list(obj: types.CodeType, is_method: bool) -> str:
    argc = obj.co_argcount + obj.co_kwonlyargcount + getattr(obj, "co_posonlyargcount", 0)
    if argc <= 0:
        return "self" if is_method else ""
    names = list(obj.co_varnames[:argc])
    if is_method and names and names[0] != "self":
        names[0] = "self"
    return ", ".join(names)


def module_name_from_pyc(runtime_root: pathlib.Path, pyc_path: pathlib.Path) -> str:
    rel = pyc_path.relative_to(runtime_root).with_suffix("")
    return ".".join(rel.parts)


def generate_skeleton(module_name: str, root_code: types.CodeType) -> str:
    all_objects = list(walk_code_objects(root_code))
    qualnames = [getattr(o, "co_qualname", o.co_name) for o in all_objects]
    classes: dict[str, set[str]] = {}
    functions: set[str] = set()

    for obj in all_objects:
        name = obj.co_name
        if not is_user_symbol(name):
            continue
        qn = getattr(obj, "co_qualname", name)
        if "<locals>" in qn:
            continue
        parts = qn.split(".")
        if len(parts) == 1:
            # If descendants use "<name>.<member>", this code object likely
            # represents a class body (not a callable function).
            has_members = any(x.startswith(f"{name}.") for x in qualnames if x != qn)
            if guess_kind(obj) == "function" and not has_members:
                functions.add(name)
            continue
        cls = parts[0]
        meth = parts[-1]
        if is_user_symbol(cls) and is_user_symbol(meth):
            classes.setdefault(cls, set()).add(meth)

    out: list[str] = []
    out.append(f'"""')
    out.append(f"Skeleton recovered from bytecode: {module_name}")
    out.append("TODO: fill implementations using disassembly artifacts.")
    out.append(f'"""')
    out.append("")
    out.append("from __future__ import annotations")
    out.append("")

    if functions:
        for fn in sorted(functions):
            obj = next(o for o in all_objects if o.co_name == fn)
            args = arg_list(obj, is_method=False)
            out.append(f"def {fn}({args}) -> None:")
            out.append(f'    """TODO: restore {module_name}.{fn}."""')
            out.append("    raise NotImplementedError")
            out.append("")

    for cls in sorted(classes.keys()):
        out.append(f"class {cls}:")
        out.append(f'    """TODO: restore class {module_name}.{cls}."""')
        methods = sorted(classes[cls])
        if not methods:
            out.append("    pass")
            out.append("")
            continue
        out.append("")
        for meth in methods:
            obj = next(
                o
                for o in all_objects
                if getattr(o, "co_qualname", o.co_name).endswith(f"{cls}.{meth}")
            )
            args = arg_list(obj, is_method=True)
            out.append(f"    def {meth}({args}) -> None:")
            out.append(f'        """TODO: restore {module_name}.{cls}.{meth}."""')
            out.append("        raise NotImplementedError")
            out.append("")

    if not functions and not classes:
        out.append("# No recoverable top-level symbols found.")
        out.append("")

    return "\n".join(out).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate source skeletons from runtime pyc files.")
    parser.add_argument("--runtime-root", default="runtime", help="Runtime root directory (default: runtime)")
    parser.add_argument("--out", default="_recovered/skeleton", help="Output directory (default: _recovered/skeleton)")
    parser.add_argument("modules", nargs="+", help="Module names (e.g. core.serial_manager)")
    args = parser.parse_args()

    runtime_root = pathlib.Path(args.runtime_root).resolve()
    output_root = pathlib.Path(args.out).resolve()
    output_root.mkdir(parents=True, exist_ok=True)

    for mod in args.modules:
        pyc_path = runtime_root / pathlib.Path(*mod.split(".")).with_suffix(".pyc")
        if not pyc_path.exists():
            print(f"[MISS] {pyc_path}")
            return 1
        code = load_code_from_pyc(pyc_path)
        skeleton = generate_skeleton(mod, code)
        out_path = output_root / pathlib.Path(*mod.split(".")).with_suffix(".py")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(skeleton, encoding="utf-8")
        print(f"[OK] {mod} -> {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
