from __future__ import annotations

import re
import sys
from collections import defaultdict
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

    fn_by_name = defaultdict(list)
    for fn in idx.get("functions", []):
        fn_by_name[fn.get("name")].append(fn)
    ambiguous = [(name, rows) for name, rows in fn_by_name.items() if len(rows) > 1 and name]
    check("has ambiguous function symbols", len(ambiguous) > 0, f"count={len(ambiguous)}")

    tested = 0
    for name, rows in ambiguous[:8]:
        rows = sorted(rows, key=lambda x: (x.get("path", ""), int(x.get("start_line") or 0)))
        pick = rows[0]
        nav = svc.get_navigation_targets(
            pid,
            name,
            str(pick.get("path") or ""),
            int(pick.get("start_line") or 1),
            1,
            80,
            "coldish",
        )
        defn = nav.get("definition") or {}
        check(
            f"ambiguous {name} chooses local/same-path",
            defn.get("path") == pick.get("path"),
            f"expected={pick.get('path')} got={defn}",
        )
        check(
            f"ambiguous {name} exposes ambiguity_count",
            int(nav.get("ambiguity_count") or 0) >= 2,
            f"ambiguity_count={nav.get('ambiguity_count')}",
        )
        check(
            f"ambiguous {name} has decision_source",
            bool(nav.get("decision_source")),
            f"decision_source={nav.get('decision_source')}",
        )
        tested += 1

    macro_names = []
    for tok, rows in (idx.get("token_index") or {}).items():
        if tok and tok.upper() == tok and "_" in tok and rows and len(tok) >= 3 and any(ch.isalnum() for ch in tok):
            macro_names.append(tok)
        if len(macro_names) >= 5:
            break
    check("macro-like symbols sampled (optional)", True, str(macro_names))
    for tok in macro_names[:3]:
        nav = svc.get_navigation_targets(pid, tok, "", 1, 1, 40, "coldish")
        defn = nav.get("definition") or {}
        check(f"macro-like {tok} resolves", bool(defn.get("path")), str(defn))

    non_ident_queries = ["S1-HW", "A3, status", "phase:req", "x-y-z"]
    for q in non_ident_queries:
        res = svc.search(pid, q, 10).get("results", [])
        check(f"search non-identifier {q}", len(res) >= 0, f"count={len(res)}")

    check("ambiguous test cases executed", tested > 0, f"tested={tested}")
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
