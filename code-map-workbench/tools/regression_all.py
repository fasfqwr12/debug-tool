from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import json
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_ROOT = r"E:\相位\program\green"


FULL_SEQUENCE: List[Tuple[str, str]] = [
    ("regression_check", "regression_check.py"),
    ("regression_bulk_nav", "regression_bulk_nav.py"),
    ("regression_ui_flow", "regression_ui_flow.py"),
    ("regression_ambiguity_nav", "regression_ambiguity_nav.py"),
    ("regression_ui_state_machine", "regression_ui_state_machine.py"),
    ("regression_contract_modules", "regression_contract_modules.py"),
    ("perf_check", "perf_check.py"),
]

QUICK_SEQUENCE: List[Tuple[str, str]] = [
    ("regression_check", "regression_check.py"),
    ("regression_bulk_nav", "regression_bulk_nav.py"),
    ("perf_check", "perf_check.py"),
]


def _load_module(script_path: Path):
    spec = importlib.util.spec_from_file_location(script_path.stem, script_path)
    if not spec or not spec.loader:
        raise RuntimeError(f"无法加载脚本: {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_script(script_path: Path, root: str) -> Dict[str, Any]:
    module = _load_module(script_path)
    run_fn = getattr(module, "run", None)
    if not callable(run_fn):
        raise RuntimeError(f"{script_path.name} 未定义 run(root) 函数")
    stream = io.StringIO()
    started = time.perf_counter()
    with contextlib.redirect_stdout(stream):
        rc = int(run_fn(root))
    elapsed_ms = (time.perf_counter() - started) * 1000.0
    output = stream.getvalue()
    return {
        "return_code": rc,
        "elapsed_ms": round(elapsed_ms, 2),
        "output": output,
    }


def _parse_kv_lines(output: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for raw in (output or "").splitlines():
        line = raw.strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip()
    return out


def _evaluate_perf(output: str) -> Dict[str, Any]:
    kv = _parse_kv_lines(output)
    required = [
        "acceptance_coldish_search_p95_ms",
        "acceptance_coldish_navigation_p95_ms",
        "cache_bias_level",
        "acceptance_source",
    ]
    missing = [k for k in required if k not in kv]
    ok = len(missing) == 0
    result: Dict[str, Any] = {
        "ok": ok,
        "missing_keys": missing,
        "metrics": {},
        "error": "",
    }
    if not ok:
        result["error"] = "perf output invalid"
        return result

    def _f(name: str) -> float:
        try:
            return float(kv.get(name, "0"))
        except Exception:
            return 0.0

    metrics = {
        "acceptance_coldish_search_p95_ms": _f("acceptance_coldish_search_p95_ms"),
        "acceptance_coldish_navigation_p95_ms": _f("acceptance_coldish_navigation_p95_ms"),
        "cache_bias_level": kv.get("cache_bias_level", ""),
        "acceptance_source": kv.get("acceptance_source", ""),
    }
    result["metrics"] = metrics
    return result


def _print_task_result(name: str, success: bool, elapsed_ms: float) -> None:
    status = "PASS" if success else "FAIL"
    print(f"[{status}] {name} ({elapsed_ms:.2f} ms)")


def run_all(root: str, quick: bool = False, stop_on_fail: bool = False) -> Dict[str, Any]:
    sequence = QUICK_SEQUENCE if quick else FULL_SEQUENCE
    results: List[Dict[str, Any]] = []
    failed = 0
    started = time.perf_counter()

    for name, rel in sequence:
        script_path = ROOT_DIR / "tools" / rel
        try:
            one = _run_script(script_path, root)
            rc = int(one["return_code"])
            success = (rc == 0)
            detail: Dict[str, Any] = {
                "name": name,
                "script": str(script_path),
                "success": success,
                "return_code": rc,
                "elapsed_ms": one["elapsed_ms"],
                "output": one["output"],
            }
            if name == "perf_check":
                perf_eval = _evaluate_perf(one["output"])
                detail["perf_eval"] = perf_eval
                if not perf_eval.get("ok", False):
                    success = False
                    detail["success"] = False
                    detail["return_code"] = 1
            results.append(detail)
            _print_task_result(name, success, float(one["elapsed_ms"]))
            if name == "perf_check":
                perf_eval = detail.get("perf_eval") or {}
                if perf_eval.get("ok"):
                    m = perf_eval["metrics"]
                    print(
                        "PERF GATE "
                        f"search={m['acceptance_coldish_search_p95_ms']:.2f}ms "
                        f"nav={m['acceptance_coldish_navigation_p95_ms']:.2f}ms "
                        f"source={m['acceptance_source']} "
                        f"bias={m['cache_bias_level']}"
                    )
                else:
                    print("PERF GATE FAIL (perf output invalid)")
            if not success:
                failed += 1
                if stop_on_fail:
                    break
        except Exception as exc:
            failed += 1
            detail = {
                "name": name,
                "script": str(script_path),
                "success": False,
                "return_code": 2,
                "elapsed_ms": 0.0,
                "output": "",
                "error": str(exc),
            }
            results.append(detail)
            _print_task_result(name, False, 0.0)
            print(f"ERROR: {exc}")
            if stop_on_fail:
                break

    total_ms = (time.perf_counter() - started) * 1000.0
    passed = len([r for r in results if r.get("success")])
    summary = {
        "root": root,
        "quick": bool(quick),
        "stop_on_fail": bool(stop_on_fail),
        "passed": passed,
        "failed": failed,
        "total": len(results),
        "total_elapsed_ms": round(total_ms, 2),
        "results": results,
    }
    print(
        "TOTAL SUMMARY "
        f"passed={summary['passed']} failed={summary['failed']} total={summary['total']} "
        f"elapsed={summary['total_elapsed_ms']:.2f}ms"
    )
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Run all regression scripts in one command.")
    parser.add_argument("--root", default=DEFAULT_ROOT, help="Project root path")
    parser.add_argument("--quick", action="store_true", help="Run only check/bulk/perf")
    parser.add_argument("--stop-on-fail", action="store_true", help="Stop immediately on first failure")
    parser.add_argument("--json-out", default="", help="Write structured result to json path")
    args = parser.parse_args()

    try:
        summary = run_all(
            root=str(args.root),
            quick=bool(args.quick),
            stop_on_fail=bool(args.stop_on_fail),
        )
        if args.json_out:
            out_path = Path(args.json_out)
            if not out_path.is_absolute():
                out_path = ROOT_DIR / out_path
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"JSON WRITTEN {out_path}")
        return 0 if int(summary.get("failed") or 0) == 0 else 1
    except Exception as exc:
        print(f"FATAL: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
