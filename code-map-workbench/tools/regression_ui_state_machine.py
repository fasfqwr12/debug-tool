from __future__ import annotations

import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.service import CodeMapService


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

    steps = [
        {"action": "symbol_click", "symbol": "comm_init", "path": "app/app_init.c", "line": 93, "column": 5},
        {"action": "go_definition"},
        {"action": "expand"},
    ]
    for _ in range(10):
        steps.extend([{"action": "back"}, {"action": "forward"}])

    chain = svc.simulate_navigation_chain(
        project_id=pid,
        steps=steps,
        perf_mode="coldish",
        enable_test=True,
    )
    check("simulate_navigation_chain success", chain.get("success") is True, str(chain.get("error", "")))
    run_steps = chain.get("steps") or []
    current = chain.get("current") or {}
    check("history size sane", int(chain.get("history_size") or 0) >= 2, str(chain))
    check("current has function_id", bool(current.get("function_id")), str(current))
    check("current has branch_key", bool(current.get("branch_key")), str(current))

    expand_point = {}
    for row in run_steps:
        if row.get("action") == "expand":
            expand_point = row.get("point") or {}
            break
    check("expand point captured", bool(expand_point), str(run_steps[:5]))

    forward_rows = [r for r in run_steps if r.get("action") == "forward"]
    check("forward rows count", len(forward_rows) == 10, f"count={len(forward_rows)}")
    for i, row in enumerate(forward_rows, start=1):
        pt = row.get("point") or {}
        same = (
            pt.get("path"),
            int(pt.get("line") or 0),
            pt.get("function_id"),
            pt.get("branch_key"),
        ) == (
            expand_point.get("path"),
            int(expand_point.get("line") or 0),
            expand_point.get("function_id"),
            expand_point.get("branch_key"),
        )
        check(f"forward restore round {i}", same, f"forward={pt} expand={expand_point}")

    nav_state = svc.get_navigation_state(pid)
    check("navigation_state success", nav_state.get("success") is True, str(nav_state))
    check("navigation_state has decision_source", bool(nav_state.get("decision_source")), str(nav_state))
    check("navigation_state has ambiguity_count field", "ambiguity_count" in nav_state, str(nav_state))

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
