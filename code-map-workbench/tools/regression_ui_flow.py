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

    def check(name: str, cond: bool, detail: str = "", severity: int = 1) -> None:
        report.append({
            "name": name,
            "ok": bool(cond),
            "detail": detail,
            "severity": int(severity),
        })

    scan = svc.scan_project(root, "whitelist")
    check("scan_project success", scan.get("success") is True, str(scan.get("error", "")), 3)
    if not scan.get("success"):
        _print_report(report)
        return 2

    pid = scan["project"]["id"]

    cases = [
        ("LD_PWR_RCU", "macro"),
        ("S1-HW", "text"),
        ("comm_init", "function"),
        ("protocol_reply_wave_u16x2", "function"),
    ]
    for keyword, expected_kind in cases:
        res = svc.search(pid, keyword, 20).get("results", [])
        top = res[0] if res else {}
        check(f"search {keyword} non-empty", len(res) > 0, f"count={len(res)}", 3)
        if res:
            check(
                f"search {keyword} top kind",
                str(top.get("kind") or "") == expected_kind,
                str(top),
                2,
            )

    nav1 = svc.get_navigation_targets(pid, "comm_init", "app/app_init.c", 93, 5, 80, "coldish")
    def1 = nav1.get("definition") or {}
    check("jump comm_init path", def1.get("path") == "drivers/drv_comm.c", str(def1), 3)
    check("jump comm_init line", int(def1.get("line") or 0) == 28, str(def1), 3)

    nav2 = svc.get_navigation_targets(pid, "protocol_reply_wave_u16x2", "cmd/cmd_debug_capture.c", 82, 3, 80, "coldish")
    def2 = nav2.get("definition") or {}
    check("jump protocol_reply_wave_u16x2 path", def2.get("path") == "protocol/frame.c", str(def2), 3)
    check("jump protocol_reply_wave_u16x2 line", int(def2.get("line") or 0) >= 280, str(def2), 3)

    chain = svc.simulate_navigation_chain(
        project_id=pid,
        perf_mode="coldish",
        enable_test=True,
        steps=[
            {"action": "symbol_click", "symbol": "comm_init", "path": "app/app_init.c", "line": 93, "column": 5},
            {"action": "go_definition"},
            {"action": "expand"},
            {"action": "back"},
            {"action": "forward"},
            {"action": "back"},
            {"action": "forward"},
        ],
    )
    check("simulate_navigation_chain success", chain.get("success") is True, str(chain.get("error", "")), 3)
    steps = chain.get("steps") or []
    exp_point = (steps[2].get("point") or {}) if len(steps) > 2 else {}
    fwd1 = (steps[4].get("point") or {}) if len(steps) > 4 else {}
    fwd2 = (steps[6].get("point") or {}) if len(steps) > 6 else {}
    check("expand has function_id", bool(exp_point.get("function_id")), str(exp_point), 3)
    check("expand branch_key non-empty", bool(exp_point.get("branch_key")), str(exp_point), 2)
    check(
        "back/forward restore round1",
        (fwd1.get("path"), int(fwd1.get("line") or 0), fwd1.get("function_id"), fwd1.get("branch_key"))
        == (exp_point.get("path"), int(exp_point.get("line") or 0), exp_point.get("function_id"), exp_point.get("branch_key")),
        f"forward1={fwd1} expand={exp_point}",
        3,
    )
    check(
        "back/forward restore round2",
        (fwd2.get("path"), int(fwd2.get("line") or 0), fwd2.get("function_id"), fwd2.get("branch_key"))
        == (exp_point.get("path"), int(exp_point.get("line") or 0), exp_point.get("function_id"), exp_point.get("branch_key")),
        f"forward2={fwd2} expand={exp_point}",
        3,
    )

    nav_state = svc.get_navigation_state(pid)
    check("navigation_state success", nav_state.get("success") is True, str(nav_state), 2)
    if nav_state.get("success"):
        check("navigation_state has resolve_mode", bool(nav_state.get("resolve_mode")), str(nav_state), 1)
        check("navigation_state has perf_mode", bool(nav_state.get("perf_mode")), str(nav_state), 1)

    _print_report(report)
    fails = [x for x in report if not x["ok"]]
    return 1 if fails else 0


def _print_report(report) -> None:
    fails = [x for x in report if not x["ok"]]
    for row in report:
        print(("PASS" if row["ok"] else "FAIL"), row["name"], row["detail"])
    if fails:
        print("\nFAILURES_BY_SEVERITY")
        for row in sorted(fails, key=lambda x: (-x["severity"], x["name"]))[:20]:
            print(f"S{row['severity']}", row["name"], row["detail"])
    print(f"\nSUMMARY: {len(report)-len(fails)}/{len(report)} passed")


if __name__ == "__main__":
    raise SystemExit(run())
