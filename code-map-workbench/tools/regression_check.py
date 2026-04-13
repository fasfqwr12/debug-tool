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
    idx = svc._projects[pid]

    func_names = [f["name"] for f in idx["functions"] if f["path"] == "cmd/cmd_debug_basic.c"]
    for bad in ["point", "state", "checks", "value", "step", "error32", "voltage"]:
        check(f"no fake function: {bad}", bad not in func_names, f"found={bad in func_names}")

    for good in ["cmd_find_apd", "cmd_status_snapshot", "cmd_apd_temp_info", "cmd_dac_test"]:
        check(f"has function: {good}", good in func_names)

    usbd_funcs = [f["name"] for f in idx["functions"] if f["path"] == "usb/device/Include/usbd_core.h"]
    check("no fake function from comments: number", "number" not in usbd_funcs, f"count={usbd_funcs.count('number')}")
    check("has function: usbd_ep_deinit", "usbd_ep_deinit" in usbd_funcs)

    res = svc.search(pid, "comm_init", 10).get("results", [])
    first = res[0] if res else {}
    check("search comm_init top path", first.get("path") == "drivers/drv_comm.c", str(first))
    check("search comm_init top line", int(first.get("line") or 0) == 28, str(first))

    res2 = svc.search(pid, "LD_PWR_RCU", 10).get("results", [])
    check("search LD_PWR_RCU non-empty", len(res2) > 0, f"count={len(res2)}")
    check("search LD_PWR_RCU has macro", any(r.get("kind") == "macro" for r in res2), str(res2[:3]))

    file_id = next((f["id"] for f in idx["files"] if f["path"] == "drivers/drv_pll.c"), None)
    peek = svc.peek_symbol(pid, "g_pll_ctx", file_id, 41)
    check("peek g_pll_ctx success", peek.get("success") is True, str(peek.get("error", "")))
    check("peek g_pll_ctx kind definition", peek.get("kind") == "definition", f"kind={peek.get('kind')}")
    check("peek g_pll_ctx line 41", int(peek.get("line") or 0) == 41, f"line={peek.get('line')}")
    facts = {f.get("label"): f.get("value") for f in (peek.get("facts") or [])}
    check("peek has variable type", "变量类型" in facts, str(facts))
    check("peek type is pll_context_t", str(facts.get("变量类型", "")).strip() == "pll_context_t", str(facts))

    nav = svc.get_navigation_targets(pid, "comm_init", "app/app_init.c", 93, 3, 80)
    defn = nav.get("definition") or {}
    check("nav comm_init def path", defn.get("path") == "drivers/drv_comm.c", str(defn))
    check("nav comm_init def line", int(defn.get("line") or 0) == 28, str(defn))
    check("nav references exist", len(nav.get("references") or []) > 0, f"refs={len(nav.get('references') or [])}")

    # Multi-line function declaration should be indexed and jumpable.
    pfunc = svc.search(pid, "protocol_reply_wave_u16x2", 10).get("results", [])
    top = pfunc[0] if pfunc else {}
    check("search protocol_reply_wave_u16x2 top is function", top.get("kind") == "function", str(top))
    check("search protocol_reply_wave_u16x2 top path", top.get("path") == "protocol/frame.c", str(top))

    nav2 = svc.get_navigation_targets(pid, "protocol_reply_wave_u16x2", "cmd/cmd_debug_capture.c", 82, 3, 80)
    def2 = nav2.get("definition") or {}
    check("nav protocol_reply_wave_u16x2 def path", def2.get("path") == "protocol/frame.c", str(def2))
    check("nav protocol_reply_wave_u16x2 def line", int(def2.get("line") or 0) >= 280, str(def2))

    root_fn = next((f for f in idx["functions"] if f["name"] == "app_init" and f["path"] == "app/app_init.c"), None)
    if root_fn:
        calls = svc.get_calls(pid, root_fn["id"], "out").get("calls") or []
        dm = [c for c in calls if c.get("name") == "comm_init"]
        check("callgraph app_init -> comm_init exists", len(dm) > 0, f"count={len(dm)}")
        if dm:
            check("callgraph target path drivers", dm[0].get("path") == "drivers/drv_comm.c", str(dm[0]))
            check("callgraph def_line 28", int(dm[0].get("def_line") or 0) == 28, str(dm[0]))
    else:
        check("app_init function exists", False, "not found")

    _print(report)
    fails = [x for x in report if not x[1]]
    return 1 if fails else 0


def _print(report) -> None:
    fails = [x for x in report if not x[1]]
    for n, ok, d in report:
        print(("PASS" if ok else "FAIL"), n, d)
    print(f"\nSUMMARY: {len(report)-len(fails)}/{len(report)} passed")


if __name__ == "__main__":
    raise SystemExit(run())
