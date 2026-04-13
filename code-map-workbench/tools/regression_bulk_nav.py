from __future__ import annotations

import random
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.service import CodeMapService


def run(root: str = r"E:\相位\program\green", target_checks: int = 40) -> int:
    svc = CodeMapService()
    scan = svc.scan_project(root, "whitelist")
    if not scan.get("success"):
        print("FAIL scan_project", scan.get("error", ""))
        return 2

    pid = scan["project"]["id"]
    idx = svc._projects[pid]

    # Targeted symbols from known regressions / user feedback.
    for q in ["LD_PWR_RCU", "comm_init", "protocol_reply_wave_u16x2", "S1-HW"]:
        res = svc.search(pid, q, 10).get("results", [])
        print("SEARCH", q, "count", len(res), "top", res[0] if res else None)

    targeted_nav = [
        ("comm_init", "app/app_init.c", 93, 5),
        ("protocol_reply_wave_u16x2", "cmd/cmd_debug_capture.c", 82, 3),
        ("hw_system_get_ref_count", "hw_system/hw_system.c", 780, 5),
    ]
    for sym, path, line, col in targeted_nav:
        nav = svc.get_navigation_targets(pid, sym, path, line, col, 80)
        print("NAV", sym, "=>", nav.get("definition"))

    # Large-sample callsite -> callee definition consistency.
    funcs = list(idx.get("functions", []))
    random.seed(42)
    random.shuffle(funcs)
    sample = funcs[:120]

    checks = 0
    fails = []
    for fn in sample:
        calls = svc.get_calls(pid, fn["id"], "out").get("calls") or []
        for call in calls[:5]:
            name = call.get("name")
            exp_path = call.get("path")
            exp_line = int(call.get("def_line") or 0)
            call_line = int(call.get("line") or 0)
            if not (name and exp_path and call_line > 0):
                continue
            nav = svc.get_navigation_targets(pid, name, fn.get("path", ""), call_line, 1, 60)
            got = nav.get("definition") or {}
            ok = bool(got) and got.get("path") == exp_path and (exp_line <= 0 or int(got.get("line") or 0) == exp_line)
            checks += 1
            if not ok:
                fails.append({
                    "caller": f"{fn.get('path')}:{call_line}",
                    "symbol": name,
                    "expected": f"{exp_path}:{exp_line}",
                    "got": f"{got.get('path')}:{got.get('line')}" if got else "<none>",
                })
            if checks >= target_checks:
                break
        if checks >= target_checks:
            break

    passed = checks - len(fails)
    rate = (passed * 100.0 / checks) if checks else 0.0
    print(f"BULK_NAV SUMMARY: {passed}/{checks} passed ({rate:.2f}%)")
    for row in fails[:20]:
        print("FAIL", row)
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(run())
