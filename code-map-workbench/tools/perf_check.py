from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.service import CodeMapService


def _p95(values):
    if not values:
        return 0.0
    ordered = sorted(float(x) for x in values)
    idx = max(0, min(len(ordered) - 1, int(len(ordered) * 0.95) - 1))
    return ordered[idx]


def _stable_sample_tokens(index, count: int = 8):
    token_index = index.get("token_index", {})
    candidates = []
    for tok, rows in token_index.items():
        if not tok or len(tok) < 4:
            continue
        if not tok.replace("_", "").isalnum():
            continue
        if tok.isdigit():
            continue
        candidates.append((len(rows or []), tok))
    candidates.sort(reverse=True)
    out = []
    for _, tok in candidates:
        if tok in {"comm_init", "ld_pwr_rcu", "protocol_reply_wave_u16x2"}:
            continue
        out.append(tok)
        if len(out) >= count:
            break
    return out


def run(root: str = r"E:\相位\program\green") -> int:
    svc = CodeMapService()
    scan = svc.scan_project(root, "whitelist")
    if not scan.get("success"):
        print("SCAN_FAIL", scan.get("error", ""))
        return 2

    pid = scan["project"]["id"]
    idx = svc._projects[pid]
    random_tokens = _stable_sample_tokens(idx, 8)
    search_queries = ["comm_init", "LD_PWR_RCU", "S1-HW", "protocol_reply_wave_u16x2"] + random_tokens
    nav_cases = [
        ("comm_init", "app/app_init.c", 93, 5),
        ("protocol_reply_wave_u16x2", "cmd/cmd_debug_capture.c", 82, 3),
        ("hw_system_get_ref_count", "cmd/cmd_status_snapshot.c", 66, 2),
    ]
    ambiguous_nav_case_count = 0
    fn_count = {}
    first_fn_by_name = {}
    for fn in idx.get("functions", []):
        name = fn.get("name")
        if not name:
            continue
        fn_count[name] = int(fn_count.get(name) or 0) + 1
        if name not in first_fn_by_name:
            first_fn_by_name[name] = fn
    for name, count in fn_count.items():
        if count > 1 and name not in {c[0] for c in nav_cases}:
            fn = first_fn_by_name.get(name) or {}
            nav_cases.append((name, str(fn.get("path") or ""), int(fn.get("start_line") or 1), 1))
            break
    for sym, _, _, _ in nav_cases:
        if int(fn_count.get(sym) or 0) > 1:
            ambiguous_nav_case_count += 1
    warm_search = 6
    warm_nav = 4
    sample_loops = 12

    for _ in range(warm_search):
        for q in search_queries[:4]:
            svc.search(pid, q, 50)
    for _ in range(warm_nav):
        for sym, path, line, col in nav_cases[:2]:
            svc.get_navigation_targets(pid, sym, path, line, col, 80, "normal")

    steady_search_samples = []
    t0 = time.perf_counter()
    for _ in range(sample_loops):
        for q in search_queries:
            st = time.perf_counter()
            svc.search(pid, q, 50)
            steady_search_samples.append((time.perf_counter() - st) * 1000.0)
    t1 = time.perf_counter()

    acceptance_search_samples = []
    for _ in range(sample_loops):
        with svc._search_cache_lock:
            svc._search_cache.clear()
        for q in search_queries:
            st = time.perf_counter()
            svc.search(pid, q, 50)
            acceptance_search_samples.append((time.perf_counter() - st) * 1000.0)

    steady_nav_samples = []
    cold_start_nav_ms = 0.0
    for i in range(sample_loops):
        for j, (sym, path, line, col) in enumerate(nav_cases):
            nav_t = time.perf_counter()
            svc.get_navigation_targets(pid, sym, path, line, col, 80, "coldish")
            steady_nav_samples.append((time.perf_counter() - nav_t) * 1000.0)
            if i == 0 and j == 0:
                cold_start_nav_ms = (time.perf_counter() - nav_t) * 1000.0
    t2 = time.perf_counter()

    file_map = {f["path"]: f["id"] for f in idx.get("files", [])}
    fid = file_map.get("drivers/drv_pll.c")
    if fid:
        for _ in range(15):
            svc.peek_symbol(pid, "g_pll_ctx", fid, 41)
    t3 = time.perf_counter()

    perf = svc.get_perf_stats()
    rows = {r["metric"]: r for r in perf.get("rows", [])}
    search_row = rows.get("search", {})
    nav_row = rows.get("navigation", {})
    nav_non_cache_row = rows.get("navigation.non_cache_p95_ms", {})
    peek_row = rows.get("peek_symbol", {})
    search_p95 = float(search_row.get("p95_ms") or 0.0)
    nav_p95 = float(nav_row.get("p95_ms") or 0.0)
    nav_non_cache_p95 = float(nav_non_cache_row.get("p95_ms") or 0.0)
    acceptance_search_p95 = _p95(acceptance_search_samples)
    steady_search_sample_p95 = _p95(steady_search_samples)
    steady_nav_sample_p95 = _p95(steady_nav_samples)
    print("SUMMARY")
    print(f"search_loop_ms={(t1 - t0) * 1000:.2f}")
    print(f"navigation_loop_ms={(t2 - t1) * 1000:.2f}")
    print(f"peek_loop_ms={(t3 - t2) * 1000:.2f}")
    print(f"cold_start_navigation_ms={cold_start_nav_ms:.2f}")
    print(f"steady_normal_search_p95_ms={search_p95:.2f}")
    print(f"steady_normal_search_p95_sample_ms={steady_search_sample_p95:.2f}")
    print(f"steady_normal_navigation_p95_ms={nav_p95:.2f}")
    print(f"steady_normal_navigation_p95_sample_ms={steady_nav_sample_p95:.2f}")
    print(f"acceptance_coldish_search_p95_ms={acceptance_search_p95:.2f}")
    print(f"acceptance_coldish_navigation_p95_ms={nav_non_cache_p95:.2f}")
    print(f"threshold_search_p95_lt_150={'PASS' if acceptance_search_p95 < 150 else 'FAIL'}")
    print(f"threshold_navigation_coldish_p95_lt_300={'PASS' if nav_non_cache_p95 < 300 else 'FAIL'}")
    print(f"warmup_search_loops={warm_search}")
    print(f"warmup_navigation_loops={warm_nav}")
    print(f"sample_loops={sample_loops}")
    print(f"search_query_count={len(search_queries)}")
    print(f"search_queries={','.join(search_queries[:10])}")
    print(f"nav_case_count={len(nav_cases)}")
    search_non_identifier_case_count = len([q for q in search_queries if not q.isidentifier()])
    print(f"ambiguous_nav_case_count={ambiguous_nav_case_count}")
    print(f"search_non_identifier_case_count={search_non_identifier_case_count}")
    nav_cache_ratio = float(rows.get("navigation.cache_hit_ratio", {}).get("p95_ms") or 0.0)
    if nav_cache_ratio >= 80:
        cache_bias_level = "high"
    elif nav_cache_ratio >= 40:
        cache_bias_level = "medium"
    else:
        cache_bias_level = "low"
    print(f"cache_bias_level={cache_bias_level}")
    print("acceptance_source=coldish")
    if nav_cache_ratio > 80 and nav_non_cache_p95 <= 0:
        print("WARN navigation cache bias is high and non-cache p95 is missing")
    if peek_row:
        print(f"peek_recent_avg_ms={float(peek_row.get('recent_avg_ms') or 0.0):.2f}")
    for row in perf.get("rows", []):
        print(
            f"{row['metric']}: count={row['count']} avg={row['avg_ms']} "
            f"recent_avg={row.get('recent_avg_ms', 0)} p95={row.get('p95_ms', 0)} "
            f"last={row['last_ms']} max={row['max_ms']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
