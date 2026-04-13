from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.service import CodeMapService


def _norm(data):
    return json.loads(json.dumps(data, ensure_ascii=False, sort_keys=True))


def _norm_nav(data):
    obj = _norm(data)
    if isinstance(obj, dict):
        obj.pop("perf_breakdown", None)
    return obj


def run(root: str = r"E:\相位\program\green") -> int:
    svc = CodeMapService()
    report = []

    def check(name: str, cond: bool, detail: str = "") -> None:
        report.append((name, bool(cond), detail))

    scan = svc.scan_project(root, "whitelist")
    check("scan_project success", scan.get("success") is True, str(scan.get("error", "")))
    if not scan.get("success"):
        _print(report)
        return 2
    pid = scan["project"]["id"]

    for q in ["comm_init", "LD_PWR_RCU", "S1-HW", "protocol_reply_wave_u16x2"]:
        a = svc.search(pid, q, 20)
        b = svc._search_engine.search(pid, q, 20)
        check(f"search contract {q}", _norm(a) == _norm(b), f"a={a} b={b}")

    nav_cases = [
        ("comm_init", "app/app_init.c", 93, 5),
        ("protocol_reply_wave_u16x2", "cmd/cmd_debug_capture.c", 82, 3),
    ]
    for sym, path, line, col in nav_cases:
        a = svc.get_navigation_targets(pid, sym, path, line, col, 60, "coldish")
        b = svc._navigation_engine.get_navigation_targets(pid, sym, path, line, col, 60, "coldish")
        check(f"navigation contract {sym}", _norm_nav(a) == _norm_nav(b), f"a={a} b={b}")

    a = svc.get_perf_stats()
    b = svc._perf_metrics.get_perf_stats()
    metrics_a = sorted((r.get("metric") for r in (a.get("rows") or [])))
    metrics_b = sorted((r.get("metric") for r in (b.get("rows") or [])))
    check("perf contract metrics", metrics_a == metrics_b, f"a={metrics_a} b={metrics_b}")

    a = svc.get_navigation_state(pid)
    b = svc._perf_metrics.get_navigation_state(pid)
    check("navigation_state contract", _norm(a) == _norm(b), "get_navigation_state mismatch")

    _print(report)
    fails = [x for x in report if not x[1]]
    return 1 if fails else 0


def _print(report):
    fails = [x for x in report if not x[1]]
    for n, ok, d in report:
        print(("PASS" if ok else "FAIL"), n, d)
    print(f"\nSUMMARY: {len(report)-len(fails)}/{len(report)} passed")


if __name__ == "__main__":
    raise SystemExit(run())
