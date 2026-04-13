from __future__ import annotations

import re
import threading
import json
import shlex
import shutil
import subprocess
import time
import urllib.parse
import xml.etree.ElementTree as ET
import queue
from pathlib import Path
from typing import Dict, List, Optional, Any

from .navigation_engine import NavigationEngine
from .perf_metrics import PerfMetrics
from .search_engine import SearchEngine


CALL_RE = re.compile(r"\b([A-Za-z_]\w*)\s*\(")


class CodeMapService:
    def __init__(self) -> None:
        self._projects: Dict[str, Dict] = {}
        self._lock = threading.Lock()
        self.window = None
        self.base_dir = Path(__file__).resolve().parents[1] / "data"
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.recent_path = self.base_dir / "recent_projects.json"
        self._cached_clangd_path = ""
        self._source_cache: Dict[str, tuple] = {}
        self._perf_lock = threading.Lock()
        self._perf_stats: Dict[str, Dict[str, Any]] = {}
        self._clangd_session: Dict[str, Any] = {}
        self._clangd_session_lock = threading.Lock()
        self._clangd_persistent_disabled_until: Dict[str, float] = {}
        self._clangd_persistent_failures: Dict[str, int] = {}
        self._nav_cache: Dict[str, Dict[str, Any]] = {}
        self._nav_cache_lock = threading.Lock()
        self._search_cache: Dict[str, Dict[str, Any]] = {}
        self._search_cache_lock = threading.Lock()
        self._stats_lock = threading.Lock()
        self._stat_counters: Dict[str, float] = {}
        self._index_state: Dict[str, Dict[str, Any]] = {}
        self._last_navigation: Dict[str, Any] = {}
        self._last_navigation_lock = threading.Lock()
        self._search_engine = SearchEngine(self)
        self._navigation_engine = NavigationEngine(self)
        self._perf_metrics = PerfMetrics(self)

    def set_window(self, window) -> None:
        self.window = window

    def _read_source_cached(self, abs_path: str) -> tuple:
        """Return (text, raw_lines) with mtime-based caching."""
        key = str(Path(abs_path).resolve())
        try:
            mtime = Path(abs_path).stat().st_mtime
        except OSError:
            self._source_cache.pop(key, None)
            return "", []
        cached = self._source_cache.get(key)
        if cached and cached[0] == mtime:
            return cached[1], cached[2]
        text = Path(abs_path).read_text(encoding="utf-8", errors="ignore")
        raw_lines = text.splitlines()
        self._source_cache[key] = (mtime, text, raw_lines)
        return text, raw_lines

    def _perf_begin(self) -> float:
        return time.perf_counter()

    def _perf_record(self, metric: str, elapsed_ms: float) -> None:
        with self._perf_lock:
            bucket = self._perf_stats.setdefault(
                metric,
                {"count": 0, "total_ms": 0.0, "max_ms": 0.0, "last_ms": 0.0, "samples": []},
            )
            bucket["count"] += 1
            bucket["total_ms"] += elapsed_ms
            bucket["last_ms"] = elapsed_ms
            if elapsed_ms > bucket["max_ms"]:
                bucket["max_ms"] = elapsed_ms
            samples = bucket.setdefault("samples", [])
            samples.append(elapsed_ms)
            if len(samples) > 160:
                del samples[:-160]

    def _perf_end(self, metric: str, start_at: float) -> None:
        elapsed_ms = (time.perf_counter() - start_at) * 1000.0
        self._perf_record(metric, elapsed_ms)

    def _stat_inc(self, key: str, amount: float = 1.0) -> None:
        with self._stats_lock:
            self._stat_counters[key] = float(self._stat_counters.get(key) or 0.0) + float(amount)

    def _set_last_navigation(self, payload: Dict[str, Any]) -> None:
        with self._last_navigation_lock:
            self._last_navigation = dict(payload or {})

    def _set_index_state(self, project_root: Path, **kwargs) -> None:
        root_key = str(project_root.resolve())
        now = time.time()
        with self._stats_lock:
            row = self._index_state.get(root_key, {"root": root_key, "created_at": now})
            row.update(kwargs)
            row["updated_at"] = now
            self._index_state[root_key] = row

    def _trim_nav_cache(self) -> None:
        if len(self._nav_cache) <= 320:
            return
        items = sorted(self._nav_cache.items(), key=lambda kv: float((kv[1] or {}).get("ts") or 0.0))
        for key, _ in items[: max(1, len(items) - 280)]:
            self._nav_cache.pop(key, None)

    def _get_nav_cache(self, key: str, ttl_s: float = 25.0) -> Optional[Dict[str, Any]]:
        now = time.time()
        with self._nav_cache_lock:
            row = self._nav_cache.get(key)
            if not row:
                return None
            ts = float(row.get("ts") or 0.0)
            if now - ts > ttl_s:
                self._nav_cache.pop(key, None)
                return None
            return dict(row.get("data") or {})

    def _put_nav_cache(self, key: str, data: Dict[str, Any]) -> None:
        with self._nav_cache_lock:
            self._nav_cache[key] = {"ts": time.time(), "data": dict(data or {})}
            self._trim_nav_cache()

    def _nav_cache_key(
        self,
        project_id: str,
        symbol: str,
        current_path: str,
        current_line: int,
        current_column: int,
        limit: int,
    ) -> str:
        return "|".join([
            project_id,
            (symbol or "").strip(),
            (current_path or "").replace("\\", "/"),
            str(int(current_line or 0)),
            str(int(current_column or 0)),
            str(int(limit or 0)),
        ])

    def _search_cache_key(self, project_id: str, keyword: str, limit: int) -> str:
        return "|".join([project_id, (keyword or "").strip().lower(), str(int(limit or 0))])

    def _get_search_cache(self, key: str, ttl_s: float = 8.0) -> Optional[List[Dict[str, Any]]]:
        now = time.time()
        with self._search_cache_lock:
            row = self._search_cache.get(key)
            if not row:
                return None
            ts = float(row.get("ts") or 0.0)
            if now - ts > ttl_s:
                self._search_cache.pop(key, None)
                return None
            data = row.get("data") or []
            return [dict(x) for x in data]

    def _put_search_cache(self, key: str, rows: List[Dict[str, Any]]) -> None:
        with self._search_cache_lock:
            self._search_cache[key] = {"ts": time.time(), "data": [dict(x) for x in (rows or [])]}
            if len(self._search_cache) > 320:
                items = sorted(self._search_cache.items(), key=lambda kv: float((kv[1] or {}).get("ts") or 0.0))
                for old_key, _ in items[: max(1, len(items) - 280)]:
                    self._search_cache.pop(old_key, None)

    def _is_fast_resolve_confident(
        self,
        index: Dict,
        symbol: str,
        definition: Dict,
        current_path: str,
        cur_file_id: str,
        current_line: int,
    ) -> bool:
        if not definition:
            return False
        kind = str(definition.get("kind") or "")
        if kind == "macro":
            return True
        if symbol.isupper() and "_" in symbol and kind in {"definition", "declaration", "typedef", "struct"}:
            return True
        if kind == "function":
            fn_rows = [fn for fn in index.get("functions", []) if fn.get("name") == symbol]
            if len(fn_rows) == 1:
                return True
            def_path = str(definition.get("path") or "")
            if def_path and def_path == (current_path or "").replace("\\", "/"):
                return True
        def_path = str(definition.get("path") or "")
        if def_path and cur_file_id and self._resolve_file_id_by_path(index, def_path) == cur_file_id:
            dist = abs(int(current_line or 0) - int(definition.get("line") or 0))
            if dist <= 240:
                return True
        return False

    def _kickoff_clangd_warmup(self, index: Dict) -> None:
        project_root = Path(index["project"]["root"]).resolve()
        clangd_path = self._find_clangd_path()
        self._set_index_state(
            project_root,
            state="pending",
            ready=False,
            clangd_found=bool(clangd_path),
            scan_mode=index.get("project", {}).get("scan_mode", ""),
        )
        if not clangd_path:
            return

        def _worker() -> None:
            t0 = time.perf_counter()
            try:
                ok, err = self._ensure_compile_commands(project_root)
                if not ok:
                    self._set_index_state(project_root, state="compile_commands_error", ready=False, error=err)
                    return
                session = self._ensure_clangd_session(project_root, clangd_path)
                if not session:
                    self._set_index_state(project_root, state="session_error", ready=False, error="clangd 会话不可用")
                    return
                self._set_index_state(project_root, state="ready", ready=True, error="")
            except Exception as exc:
                self._set_index_state(project_root, state="warmup_error", ready=False, error=str(exc))
            finally:
                self._set_index_state(project_root, warmup_ms=round((time.perf_counter() - t0) * 1000.0, 3))

        threading.Thread(target=_worker, name="clangd-warmup", daemon=True).start()

    def get_perf_stats(self) -> Dict:
        return self._perf_metrics.get_perf_stats()
        with self._perf_lock:
            rows = []
            for name, raw in sorted(self._perf_stats.items()):
                count = int(raw.get("count") or 0)
                total_ms = float(raw.get("total_ms") or 0.0)
                avg_ms = (total_ms / count) if count else 0.0
                samples = [float(x) for x in (raw.get("samples") or []) if isinstance(x, (int, float))]
                recent_avg_ms = (sum(samples) / len(samples)) if samples else avg_ms
                p95_ms = 0.0
                if samples:
                    ordered = sorted(samples)
                    idx = max(0, min(len(ordered) - 1, int(len(ordered) * 0.95) - 1))
                    p95_ms = ordered[idx]
                rows.append({
                    "metric": name,
                    "count": count,
                    "avg_ms": round(avg_ms, 3),
                    "recent_avg_ms": round(recent_avg_ms, 3),
                    "p95_ms": round(p95_ms, 3),
                    "max_ms": round(float(raw.get("max_ms") or 0.0), 3),
                    "last_ms": round(float(raw.get("last_ms") or 0.0), 3),
                })
        with self._stats_lock:
            nav_cache_hit = float(self._stat_counters.get("navigation.cache_hit") or 0.0)
            nav_cache_total = float(self._stat_counters.get("navigation.cache_total") or 0.0)
            nav_cache_bypass = float(self._stat_counters.get("navigation.cache_bypass_count") or 0.0)
            timeout_count = float(self._stat_counters.get("navigation.semantic_timeout_count") or 0.0)
            cache_hit_ratio = (nav_cache_hit / nav_cache_total * 100.0) if nav_cache_total else 0.0
            rows.append({
                "metric": "navigation.cache_hit_ratio",
                "count": int(nav_cache_total),
                "avg_ms": round(cache_hit_ratio, 3),
                "recent_avg_ms": round(cache_hit_ratio, 3),
                "p95_ms": round(cache_hit_ratio, 3),
                "max_ms": round(cache_hit_ratio, 3),
                "last_ms": round(cache_hit_ratio, 3),
            })
            rows.append({
                "metric": "navigation.cache_bypass_count",
                "count": int(nav_cache_bypass),
                "avg_ms": round(nav_cache_bypass, 3),
                "recent_avg_ms": round(nav_cache_bypass, 3),
                "p95_ms": round(nav_cache_bypass, 3),
                "max_ms": round(nav_cache_bypass, 3),
                "last_ms": round(nav_cache_bypass, 3),
            })
            rows.append({
                "metric": "navigation.semantic_timeout_count",
                "count": int(timeout_count),
                "avg_ms": round(timeout_count, 3),
                "recent_avg_ms": round(timeout_count, 3),
                "p95_ms": round(timeout_count, 3),
                "max_ms": round(timeout_count, 3),
                "last_ms": round(timeout_count, 3),
            })
            non_cache_samples = []
            if "navigation.non_cache" in self._perf_stats:
                raw = self._perf_stats.get("navigation.non_cache") or {}
                non_cache_samples = [float(x) for x in (raw.get("samples") or []) if isinstance(x, (int, float))]
            non_cache_p95 = 0.0
            if non_cache_samples:
                ordered = sorted(non_cache_samples)
                idx = max(0, min(len(ordered) - 1, int(len(ordered) * 0.95) - 1))
                non_cache_p95 = ordered[idx]
            rows.append({
                "metric": "navigation.non_cache_p95_ms",
                "count": len(non_cache_samples),
                "avg_ms": round(non_cache_p95, 3),
                "recent_avg_ms": round(non_cache_p95, 3),
                "p95_ms": round(non_cache_p95, 3),
                "max_ms": round(non_cache_p95, 3),
                "last_ms": round(non_cache_p95, 3),
            })
            index_rows = []
            now = time.time()
            for root_key, raw in sorted(self._index_state.items()):
                updated = float(raw.get("updated_at") or 0.0)
                index_rows.append({
                    "root": root_key,
                    "state": str(raw.get("state") or ""),
                    "ready": bool(raw.get("ready")),
                    "scan_mode": str(raw.get("scan_mode") or ""),
                    "clangd_found": bool(raw.get("clangd_found")),
                    "warmup_ms": float(raw.get("warmup_ms") or 0.0),
                    "age_s": round(max(0.0, now - updated), 3) if updated else 0.0,
                    "error": str(raw.get("error") or ""),
                })
        return {"success": True, "rows": rows, "index_state": index_rows}

    def get_navigation_state(self, project_id: str) -> Dict:
        return self._perf_metrics.get_navigation_state(project_id)
        if project_id not in self._projects:
            return {"success": False, "error": "工程未索引"}
        with self._stats_lock:
            nav_cache_hit = float(self._stat_counters.get("navigation.cache_hit") or 0.0)
            nav_cache_total = float(self._stat_counters.get("navigation.cache_total") or 0.0)
            nav_cache_bypass = float(self._stat_counters.get("navigation.cache_bypass_count") or 0.0)
            cache_hit_ratio = (nav_cache_hit / nav_cache_total * 100.0) if nav_cache_total else 0.0
        with self._last_navigation_lock:
            last = dict(self._last_navigation or {})
        definition = last.get("definition") or {}
        refs = last.get("references") or []
        return {
            "success": True,
            "project_id": project_id,
            "resolve_mode": str(last.get("resolve_mode") or ""),
            "perf_mode": str(last.get("perf_mode") or ""),
            "cache_hit_ratio": round(cache_hit_ratio, 3),
            "cache_bypass_count": int(nav_cache_bypass),
            "last_definition": {
                "path": definition.get("path", ""),
                "line": int(definition.get("line") or 0),
                "function_id": definition.get("function_id", ""),
                "kind": definition.get("kind", ""),
            },
            "last_reference_count": len(refs),
            "last_references": [
                {
                    "path": r.get("path", ""),
                    "line": int(r.get("line") or 0),
                    "function_id": r.get("function_id", ""),
                }
                for r in refs[:5]
            ],
        }

    def simulate_navigation_chain(
        self,
        project_id: str,
        steps: List[Dict[str, Any]],
        perf_mode: str = "coldish",
        enable_test: bool = False,
    ) -> Dict:
        return self._navigation_engine.simulate_navigation_chain(
            project_id=project_id,
            steps=steps,
            perf_mode=perf_mode,
            enable_test=enable_test,
        )
        if not enable_test:
            return {"success": False, "error": "simulate_navigation_chain 仅测试使用，请显式 enable_test=true"}
        if project_id not in self._projects:
            return {"success": False, "error": "工程未索引"}
        index = self._projects[project_id]
        history: List[Dict[str, Any]] = []
        nav_index = -1
        current: Dict[str, Any] = {}
        selected: Dict[str, Any] = {}
        traces: List[Dict[str, Any]] = []

        def _push_history(point: Dict[str, Any]) -> None:
            nonlocal history, nav_index
            if not point:
                return
            if nav_index >= 0 and nav_index < len(history) and history[nav_index] == point:
                return
            history = history[: nav_index + 1]
            history.append(dict(point))
            if len(history) > 80:
                history = history[-80:]
            nav_index = len(history) - 1

        for idx, step in enumerate(steps or []):
            action = str(step.get("action") or "").strip().lower()
            if action == "symbol_click":
                selected = {
                    "symbol": str(step.get("symbol") or ""),
                    "path": str(step.get("path") or ""),
                    "line": int(step.get("line") or 0),
                    "column": int(step.get("column") or 1),
                }
                traces.append({"step": idx, "action": action, "selected": dict(selected)})
                continue
            if action in {"go_definition", "expand"}:
                symbol = str(step.get("symbol") or selected.get("symbol") or "")
                path = str(step.get("path") or selected.get("path") or "")
                line = int(step.get("line") or selected.get("line") or 1)
                col = int(step.get("column") or selected.get("column") or 1)
                if current:
                    _push_history(current)
                nav = self.get_navigation_targets(
                    project_id,
                    symbol,
                    path,
                    line,
                    col,
                    int(step.get("limit") or 80),
                    perf_mode,
                )
                definition = nav.get("definition") or {}
                def_path = str(definition.get("path") or "")
                def_line = int(definition.get("line") or 0)
                fn_ctx = self._find_function_context_in_index(index, def_path, def_line) if def_path and def_line > 0 else {}
                branch_key = str(step.get("branch_key") or "")
                if action == "expand":
                    base = str(current.get("branch_key") or "")
                    branch_key = f"{base}>{symbol}" if base else (branch_key or symbol)
                current = {
                    "symbol": symbol,
                    "path": def_path or path,
                    "line": def_line or line,
                    "column": int(definition.get("column") or col),
                    "function_id": str(definition.get("function_id") or fn_ctx.get("id") or ""),
                    "branch_key": branch_key if action == "expand" else str(current.get("branch_key") or ""),
                    "resolve_mode": str(nav.get("resolve_mode") or ""),
                    "perf_mode": str(nav.get("perf_mode") or perf_mode),
                }
                _push_history(current)
                traces.append({"step": idx, "action": action, "ok": bool(nav.get("success")), "point": dict(current)})
                continue
            if action == "back":
                if nav_index > 0:
                    nav_index -= 1
                    current = dict(history[nav_index])
                traces.append({"step": idx, "action": action, "point": dict(current), "nav_index": nav_index})
                continue
            if action == "forward":
                if nav_index + 1 < len(history):
                    nav_index += 1
                    current = dict(history[nav_index])
                traces.append({"step": idx, "action": action, "point": dict(current), "nav_index": nav_index})
                continue
            traces.append({"step": idx, "action": action, "error": "unknown action"})
        return {
            "success": True,
            "perf_mode": perf_mode,
            "steps": traces,
            "history_size": len(history),
            "history_index": nav_index,
            "current": current,
        }

    def scan_project(self, root: str, scan_mode: str = "full") -> Dict:
        t0 = self._perf_begin()
        project_root = Path(root).resolve()
        if not project_root.exists():
            return {"success": False, "error": f"目录不存在: {project_root}"}

        self._source_cache.clear()
        with self._nav_cache_lock:
            self._nav_cache.clear()
        with self._search_cache_lock:
            self._search_cache.clear()
        mode = (scan_mode or "full").strip().lower()
        if mode not in {"full", "whitelist"}:
            mode = "full"
        files = self._collect_files(project_root, mode)
        file_records: List[Dict] = []
        function_records: List[Dict] = []
        token_index: Dict[str, List[Dict[str, Any]]] = {}
        lines_by_file: Dict[str, List[Dict[str, Any]]] = {}

        for path in files:
            rel = path.relative_to(project_root).as_posix()
            file_id = f"file:{rel}"
            text, raw_lines = self._read_source_cached(str(path))
            file_records.append({
                "id": file_id,
                "path": rel,
                "abs_path": str(path),
                "line_count": len(raw_lines),
            })
            function_records.extend(self._parse_functions(rel, file_id, str(path), text))
            lines_by_file[file_id] = [{"line_number": i + 1, "text": line} for i, line in enumerate(raw_lines)]
            for ln, line_text in enumerate(raw_lines, start=1):
                for m in re.finditer(r"\b[A-Za-z_]\w*\b", line_text or ""):
                    token = m.group(0)
                    token_index.setdefault(token.lower(), []).append({
                        "file_id": file_id,
                        "path": rel,
                        "line": ln,
                        "column": int(m.start()) + 1,
                        "token": token,
                        "text": line_text,
                    })

        # ---- O(1) lookup indexes ----
        _file_by_id = {f["id"]: f for f in file_records}
        _file_by_path = {f["path"]: f for f in file_records}
        _fn_by_id = {fn["id"]: fn for fn in function_records}
        _fns_by_file: Dict[str, List[Dict]] = {}
        for fn in function_records:
            _fns_by_file.setdefault(fn["file_id"], []).append(fn)
        _fn_count_by_file = {fid: len(fns) for fid, fns in _fns_by_file.items()}
        _abs_to_rel: Dict[str, str] = {}
        for f in file_records:
            _abs_to_rel[str(Path(f["abs_path"]).resolve()).lower()] = f["path"]

        fn_by_name: Dict[str, List[Dict]] = {}
        for fn in function_records:
            fn_by_name.setdefault(fn["name"], []).append(fn)

        calls: List[Dict] = []
        for fn in function_records:
            in_block_comment = False
            for line_no, raw_line in zip(range(fn["start_line"], fn["end_line"] + 1), fn["source"].splitlines()):
                line, in_block_comment = self._strip_comments_for_parse_line(raw_line, in_block_comment)
                for callee in CALL_RE.findall(line):
                    if callee in {"if", "for", "while", "switch", "return", "sizeof"}:
                        continue
                    target = self._pick_best_callee_candidate(fn, callee, fn_by_name.get(callee) or [])
                    if not target:
                        continue
                    calls.append({
                        "caller_id": fn["id"],
                        "callee_id": target["id"],
                        "caller_name": fn["name"],
                        "callee_name": callee,
                        "callsite_line": line_no,
                    })

        project_id = f"project:{project_root.as_posix()}"
        index = {
            "project": {
                "id": project_id,
                "root": str(project_root),
                "function_count": len(function_records),
                "call_count": len(calls),
                "scan_mode": mode,
            },
            "files": file_records,
            "functions": function_records,
            "calls": calls,
            "token_index": token_index,
            "_file_by_id": _file_by_id,
            "_file_by_path": _file_by_path,
            "_fn_by_id": _fn_by_id,
            "_fns_by_file": _fns_by_file,
            "_fn_count_by_file": _fn_count_by_file,
            "_abs_to_rel": _abs_to_rel,
            "_lines_by_file": lines_by_file,
        }
        with self._lock:
            self._projects[project_id] = index
        self._remember_project(index["project"])
        self._kickoff_clangd_warmup(index)
        self._perf_end("scan_project", t0)
        return {"success": True, "project": index["project"]}

    def list_recent_projects(self) -> Dict:
        if not self.recent_path.exists():
            return {"success": True, "projects": []}
        try:
            data = json.loads(self.recent_path.read_text(encoding="utf-8"))
            return {"success": True, "projects": data if isinstance(data, list) else []}
        except Exception:
            return {"success": True, "projects": []}

    def search(self, project_id: str, keyword: str, limit: int = 80) -> Dict:
        return self._search_engine.search(project_id, keyword, limit)
        t0 = self._perf_begin()
        index = self._projects[project_id]
        text = (keyword or "").strip().lower()
        if not text:
            return {"success": True, "results": []}
        cache_key = self._search_cache_key(project_id, text, int(limit or 80))
        cached = self._get_search_cache(cache_key)
        if cached is not None:
            self._perf_end("search", t0)
            return {"success": True, "results": cached[:limit]}
        results: List[Dict] = []
        seen = set()
        limit = max(1, int(limit or 80))

        for file_item in index["files"]:
            if text in file_item["path"].lower():
                key = ("file", file_item["id"])
                if key not in seen:
                    seen.add(key)
                    results.append({"kind": "file", "id": file_item["id"], "label": file_item["path"].split("/")[-1], "path": file_item["path"], "line": 1})

        for fn in index["functions"]:
            hay = f"{fn['name']} {fn.get('signature','')} {fn['path']}".lower()
            if text in hay:
                key = ("function", fn["id"])
                if key not in seen:
                    seen.add(key)
                    results.append({"kind": "function", "id": fn["id"], "label": fn["name"], "path": fn["path"], "line": fn["start_line"]})

        if re.fullmatch(r"[A-Za-z_]\w*", text):
            token_rows = index.get("token_index", {}).get(text, [])
        else:
            token_rows = []

        t_idx = self._perf_begin()
        _lines_cache: Dict[str, List[Dict]] = {}
        for row in token_rows:
            file_id = row.get("file_id") or ""
            line_no = int(row.get("line") or 0)
            path = row.get("path") or ""
            if not file_id or line_no <= 0:
                continue
            if file_id not in _lines_cache:
                _lines_cache[file_id] = self._lines_for_file(index, file_id)
            lines = _lines_cache[file_id]
            idx = max(0, line_no - 1)
            if idx >= len(lines):
                continue
            token = row.get("token") or ""
            match = self._match_symbol(lines, idx, token)
            kind = match[0] if match else "symbol"
            key = (kind, token, file_id, line_no)
            if key in seen:
                continue
            seen.add(key)
            results.append({"kind": kind, "id": token, "label": token, "path": path, "line": line_no})

        if not token_rows:
            # Non-token query: extract matching tokens from text-matching lines
            for file_item in index["files"]:
                fid = file_item["id"]
                if fid not in _lines_cache:
                    _lines_cache[fid] = self._lines_for_file(index, fid)
                lines_dicts = _lines_cache[fid]
                stop_file = False
                for idx, ld in enumerate(lines_dicts):
                    line_text = ld.get("text") or ""
                    if text not in line_text.lower():
                        continue
                    ln = idx + 1
                    for token in re.findall(r"\b[A-Za-z_]\w*\b", line_text):
                        if text not in token.lower():
                            continue
                        match = self._match_symbol(lines_dicts, idx, token)
                        kind = match[0] if match else "symbol"
                        key = (kind, token, fid, ln)
                        if key in seen:
                            continue
                        seen.add(key)
                        results.append({"kind": kind, "id": token, "label": token, "path": file_item["path"], "line": ln})
                        if len(results) >= limit:
                            stop_file = True
                            break
                    if stop_file:
                        break
                if len(results) >= limit:
                    break
        self._perf_end("search.index_hit", t_idx)

        need_text_scan = (not token_rows) or (not re.fullmatch(r"[A-Za-z_]\w*", text))
        if need_text_scan and len(results) < limit:
            t_scan = self._perf_begin()
            lines_by_file = index.get("_lines_by_file", {})
            for file_item in index["files"]:
                file_id = file_item["id"]
                lines = lines_by_file.get(file_id)
                if lines is None:
                    _, raw_lines = self._read_source_cached(file_item["abs_path"])
                    lines = [{"line_number": i + 1, "text": line} for i, line in enumerate(raw_lines)]
                    lines_by_file[file_id] = lines
                for row in lines:
                    ln = int(row.get("line_number") or 0)
                    line_text = str(row.get("text") or "")
                    if text not in line_text.lower():
                        continue
                    raw_key = ("text", file_id, ln)
                    if raw_key in seen:
                        continue
                    seen.add(raw_key)
                    snippet = line_text.strip()
                    if len(snippet) > 120:
                        snippet = snippet[:117] + "..."
                    results.append({
                        "kind": "text",
                        "id": f"{file_id}:{ln}",
                        "label": snippet or (keyword or "").strip(),
                        "path": file_item["path"],
                        "line": ln,
                    })
                    if len(results) >= limit:
                        break
                if len(results) >= limit:
                    break
            self._perf_end("search.text_scan", t_scan)

        kind_order = {"function": 0, "file": 1, "macro": 2, "struct": 3, "typedef": 4, "definition": 5, "declaration": 6, "text": 8, "symbol": 9}
        noisy_path_tokens = ("example", "demo", "sample", "test", "archive", "legacy", "backup")
        path_penalty_cache: Dict[str, int] = {}

        def _path_penalty(path: str) -> int:
            p = path or ""
            if p in path_penalty_cache:
                return path_penalty_cache[p]
            low = p.lower()
            score = 1 if any(token in low for token in noisy_path_tokens) else 0
            path_penalty_cache[p] = score
            return score

        def _match_rank(item: Dict) -> tuple:
            label_low = (item.get("label") or "").lower()
            path = item.get("path") or ""
            # Exact keyword match should rank ahead of fuzzy/substring matches.
            exact = 0 if label_low == text else 1
            return (
                kind_order.get(item.get("kind", ""), 9),
                exact,
                _path_penalty(path),
                path,
                int(item.get("line") or 0),
                item.get("label") or "",
            )

        results.sort(key=_match_rank)
        final_rows = results[:limit]
        self._put_search_cache(cache_key, final_rows)
        self._perf_end("search", t0)
        return {"success": True, "results": final_rows}

    def list_files(self, project_id: str) -> Dict:
        index = self._projects[project_id]
        fn_count = index.get("_fn_count_by_file", {})
        files = []
        for item in sorted(index["files"], key=lambda x: x["path"]):
            files.append({**item, "function_count": fn_count.get(item["id"], 0)})
        return {"success": True, "files": files}

    def get_file(self, project_id: str, file_id: str) -> Dict:
        index = self._projects[project_id]
        file_item = index["_file_by_id"][file_id]
        fns = index.get("_fns_by_file", {}).get(file_id, [])
        functions = sorted([self._summarize_function(fn) for fn in fns], key=lambda item: item["start_line"])
        return {"success": True, "file": {**file_item, "functions": functions}}

    def get_file_source(self, project_id: str, file_id: str) -> Dict:
        index = self._projects[project_id]
        file_item = index["_file_by_id"][file_id]
        text, raw_lines = self._read_source_cached(file_item["abs_path"])
        return {
            "success": True,
            "file_id": file_id,
            "path": file_item["path"],
            "abs_path": file_item["abs_path"],
            "source": text,
            "lines": [{"line_number": i + 1, "text": line} for i, line in enumerate(raw_lines)],
        }

    def save_file_source(self, project_id: str, file_id: str, content: str) -> Dict:
        index = self._projects[project_id]
        file_item = index["_file_by_id"][file_id]
        path = Path(file_item["abs_path"])
        path.write_text(content or "", encoding="utf-8", newline="\n")
        self._source_cache.pop(str(path.resolve()), None)
        with self._nav_cache_lock:
            self._nav_cache.clear()
        with self._search_cache_lock:
            self._search_cache.clear()
        return {"success": True, "file_id": file_id, "path": file_item["path"], "line_count": len((content or "").splitlines())}

    def get_function(self, project_id: str, function_id: str) -> Dict:
        index = self._projects[project_id]
        fn = index["_fn_by_id"][function_id]
        return {"success": True, "function": self._summarize_function(fn)}

    def get_function_source(self, project_id: str, function_id: str) -> Dict:
        index = self._projects[project_id]
        fn = index["_fn_by_id"][function_id]
        lines = fn["source"].splitlines()
        return {
            "success": True,
            "function_id": function_id,
            "path": fn["path"],
            "name": fn["name"],
            "signature": fn["signature"],
            "start_line": fn["start_line"],
            "end_line": fn["end_line"],
            "source": fn["source"],
            "lines": [{"line_number": i, "text": line} for i, line in zip(range(fn["start_line"], fn["end_line"] + 1), lines)],
        }

    def get_calls(self, project_id: str, function_id: str, direction: str = "out") -> Dict:
        t0 = self._perf_begin()
        index = self._projects[project_id]
        by_id = index.get("_fn_by_id", {})
        if direction == "in":
            relevant = [c for c in index["calls"] if c["callee_id"] == function_id]
            rows = []
            for call in relevant:
                fn = by_id.get(call["caller_id"])
                if not fn:
                    continue
                rows.append({"function_id": fn["id"], "name": fn["name"], "path": fn["path"], "line": call["callsite_line"], "def_line": fn["start_line"], "signature": fn["signature"]})
            self._perf_end("get_calls", t0)
            return {"success": True, "calls": rows}
        relevant = [c for c in index["calls"] if c["caller_id"] == function_id]
        rows = []
        for call in relevant:
            fn = by_id.get(call["callee_id"])
            if not fn:
                continue
            rows.append({"function_id": fn["id"], "name": fn["name"], "path": fn["path"], "line": call["callsite_line"], "def_line": fn["start_line"], "signature": fn["signature"]})
        self._perf_end("get_calls", t0)
        return {"success": True, "calls": rows}

    def select_folder(self) -> Dict:
        if not self.window:
            return {"success": False, "error": "窗口未初始化"}
        try:
            import webview  # type: ignore
            result = self.window.create_file_dialog(webview.FOLDER_DIALOG)
            if result and len(result) > 0:
                return {"success": True, "path": result[0]}
            return {"success": False, "error": "未选择文件夹"}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    def get_keil_compile_context(self, root_or_uvprojx: str, target_name: str = "") -> Dict:
        entry = Path(root_or_uvprojx or "").expanduser()
        if not entry.exists():
            return {"success": False, "error": f"路径不存在: {entry}"}

        uvprojx = entry if entry.is_file() else self._find_first_uvprojx(entry)
        if not uvprojx:
            return {"success": False, "error": "未找到 .uvprojx 工程文件"}

        try:
            tree = ET.parse(uvprojx)
            root = tree.getroot()
        except Exception as exc:
            return {"success": False, "error": f"解析 uvprojx 失败: {exc}"}

        targets = []
        selected_target = None
        for node in root.findall(".//Target"):
            name = (node.findtext("TargetName") or "").strip()
            if not name:
                continue
            if target_name and name != target_name:
                continue

            includes = self._split_semicolon(node.findtext(".//Cads/VariousControls/IncludePath"))
            defines = self._split_semicolon(node.findtext(".//Cads/VariousControls/Define"))
            misc = (node.findtext(".//Cads/VariousControls/MiscControls") or "").strip()
            cpu = (node.findtext(".//TargetOption/TargetCommonOption/Cpu") or "").strip()

            files = []
            for file_node in node.findall(".//Group/Files/File"):
                file_path = (
                    file_node.findtext("FilePath")
                    or file_node.findtext("PathWithFileName")
                    or file_node.findtext("FileName")
                    or ""
                ).strip()
                if not file_path:
                    continue
                full = (uvprojx.parent / file_path).resolve()
                files.append({
                    "path": file_path.replace("\\", "/"),
                    "abs_path": str(full),
                    "exists": full.exists(),
                })

            row = {
                "name": name,
                "cpu": cpu,
                "includes": includes,
                "defines": defines,
                "misc": misc,
                "files": files,
            }
            targets.append(row)
            if not selected_target:
                selected_target = row

        if not targets:
            return {"success": False, "error": "uvprojx 中未找到可用 Target"}

        target = selected_target or targets[0]
        compile_commands = self._build_compile_commands(uvprojx.parent, target)
        return {
            "success": True,
            "uvprojx": str(uvprojx),
            "project_dir": str(uvprojx.parent.resolve()),
            "target_count": len(targets),
            "target_names": [t["name"] for t in targets],
            "target": {
                "name": target["name"],
                "cpu": target["cpu"],
                "include_count": len(target["includes"]),
                "define_count": len(target["defines"]),
                "file_count": len(target["files"]),
                "includes": target["includes"],
                "defines": target["defines"],
                "misc": target["misc"],
            },
            "compile_commands": compile_commands,
        }

    def get_navigation_targets(
        self,
        project_id: str,
        symbol: str,
        current_path: str = "",
        current_line: int = 0,
        current_column: int = 0,
        limit: int = 160,
        perf_mode: str = "normal",
    ) -> Dict:
        return self._navigation_engine.get_navigation_targets(
            project_id=project_id,
            symbol=symbol,
            current_path=current_path,
            current_line=current_line,
            current_column=current_column,
            limit=limit,
            perf_mode=perf_mode,
        )
        t0 = self._perf_begin()
        name = (symbol or "").strip()
        if not name:
            return {"success": False, "error": "空符号"}
        if project_id not in self._projects:
            return {"success": False, "error": "工程未索引"}

        index = self._projects[project_id]
        normalized_path = (current_path or "").replace("\\", "/")
        cur_file_id = self._resolve_file_id_by_path(index, current_path)
        cache_key = self._nav_cache_key(
            project_id=project_id,
            symbol=name,
            current_path=normalized_path,
            current_line=int(current_line or 0),
            current_column=int(current_column or 0),
            limit=int(limit or 0),
        )
        cache_allowed = str(perf_mode or "normal").lower() != "coldish"
        self._stat_inc("navigation.cache_total")
        if cache_allowed:
            cached = self._get_nav_cache(cache_key)
            if cached:
                self._stat_inc("navigation.cache_hit")
                cached["message"] = str(cached.get("message") or "命中导航缓存")
                self._set_last_navigation(cached)
                self._perf_end("navigation", t0)
                return cached
        else:
            self._stat_inc("navigation.cache_bypass_count")

        perf_breakdown: Dict[str, float] = {}
        t_fast = self._perf_begin()
        definition = self._pick_definition(index, name, cur_file_id, current_line)
        perf_breakdown["def_pick_ms"] = round((time.perf_counter() - t_fast) * 1000.0, 3)
        self._perf_end("navigation.fast_resolve", t_fast)
        fast_confident = self._is_fast_resolve_confident(index, name, definition, normalized_path, cur_file_id, int(current_line or 0))
        local_refs: List[Dict[str, Any]] = []

        clangd_path = self._find_clangd_path()
        if clangd_path and not fast_confident:
            t_sem = self._perf_begin()
            sem = self._query_navigation_with_clangd(
                index=index,
                clangd_path=clangd_path,
                symbol=name,
                current_path=normalized_path,
                current_line=int(current_line or 1),
                current_column=int(current_column or 1),
                limit=limit,
            )
            perf_breakdown["semantic_ms"] = round((time.perf_counter() - t_sem) * 1000.0, 3)
            self._perf_end("navigation.semantic", t_sem)
            if "timeout" in str(sem.get("error") or "").lower():
                self._stat_inc("navigation.semantic_timeout_count")
            if sem.get("success") and (sem.get("definition") or sem.get("references")):
                sem_def = sem.get("definition") or {}
                sem_refs = sem.get("references") or []
                if sem_def and not self._is_confident_semantic_definition(sem_def, name):
                    sem_def = {}
                if sem_def and not self._semantic_def_matches_symbol(sem_def, name):
                    sem_def = {}
                t_pick = self._perf_begin()
                local_def = self._pick_definition(index, name, cur_file_id, current_line)
                sem_def = self._prefer_local_function_impl(sem_def, local_def, name)
                if not sem_def:
                    sem_def = local_def
                perf_breakdown["def_pick_sem_ms"] = round((time.perf_counter() - t_pick) * 1000.0, 3)
                self._perf_end("navigation.def_pick", t_pick)
                if not sem_refs:
                    t_refs = self._perf_begin()
                    sem_refs = self._collect_references(index, name, sem_def, cur_file_id, current_line, limit)
                    perf_breakdown["refs_collect_ms"] = round((time.perf_counter() - t_refs) * 1000.0, 3)
                    self._perf_end("navigation.refs_collect", t_refs)
                out = {
                    "success": True,
                    "engine": "clangd",
                    "message": f"语义引擎: clangd ({clangd_path})",
                    "clangd_path": clangd_path,
                    "perf_mode": "coldish" if not cache_allowed else "normal",
                    "resolve_mode": "fast+semantic",
                    "perf_breakdown": perf_breakdown,
                    "definition": sem_def,
                    "references": sem_refs[:limit],
                }
                if cache_allowed:
                    self._put_nav_cache(cache_key, out)
                self._set_last_navigation(out)
                self._perf_end("navigation", t0)
                if not cache_allowed:
                    self._perf_end("navigation.non_cache", t0)
                return out

        t_refs = self._perf_begin()
        local_refs = self._collect_references(index, name, definition, cur_file_id, current_line, limit)
        perf_breakdown["refs_collect_ms"] = round((time.perf_counter() - t_refs) * 1000.0, 3)
        self._perf_end("navigation.refs_collect", t_refs)
        fallback_msg = "clangd 未安装，当前使用增强文本引擎"
        if clangd_path and not fast_confident:
            fallback_msg = "clangd 语义查询失败，已自动降级到增强文本引擎"
        if fast_confident:
            fallback_msg = "已使用快速索引直达"
        out = {
            "success": True,
            "engine": "text" if not fast_confident else "fast",
            "message": fallback_msg,
            "clangd_path": clangd_path,
            "perf_mode": "coldish" if not cache_allowed else "normal",
            "resolve_mode": "fast_only" if fast_confident else "fallback_fast",
            "perf_breakdown": perf_breakdown,
            "definition": definition,
            "references": local_refs,
        }
        if cache_allowed:
            self._put_nav_cache(cache_key, out)
        self._set_last_navigation(out)
        self._perf_end("navigation", t0)
        if not cache_allowed:
            self._perf_end("navigation.non_cache", t0)
        return out

    def _remember_project(self, project: Dict) -> None:
        items = []
        if self.recent_path.exists():
            try:
                old = json.loads(self.recent_path.read_text(encoding="utf-8"))
                if isinstance(old, list):
                    items = old
            except Exception:
                items = []
        entry = {"id": project["id"], "root": project["root"], "function_count": project["function_count"], "call_count": project["call_count"]}
        items = [entry] + [x for x in items if x.get("root") != entry["root"]]
        self.recent_path.write_text(json.dumps(items[:12], ensure_ascii=False, indent=2), encoding="utf-8")

    def _find_first_uvprojx(self, root: Path) -> Optional[Path]:
        files = sorted(root.rglob("*.uvprojx"))
        return files[0] if files else None

    def _find_clangd_path(self) -> str:
        if self._cached_clangd_path and Path(self._cached_clangd_path).exists():
            return self._cached_clangd_path
        root = Path(__file__).resolve().parents[1]
        candidate_dirs = [
            root / "tools" / "clang+llvm-22.1.2-x86_64-pc-windows-msvc" / "bin",
            root / "tools" / "clangd" / "dist" / "clangd_22.1.0" / "bin",
            root / "tools" / "llvm" / "bin",
            root / "tools",
        ]
        for d in candidate_dirs:
            p = d / "clangd.exe"
            if p.exists():
                self._cached_clangd_path = str(p)
                return self._cached_clangd_path
        local = root / "tools"
        local_hits = list(local.rglob("clangd.exe")) if local.exists() else []
        if local_hits:
            self._cached_clangd_path = str(local_hits[0])
            return self._cached_clangd_path
        p = shutil.which("clangd")
        self._cached_clangd_path = p or ""
        return self._cached_clangd_path

    def _split_semicolon(self, raw: Optional[str]) -> List[str]:
        if not raw:
            return []
        items = []
        seen = set()
        for part in str(raw).split(";"):
            item = part.strip().strip('"')
            if not item:
                continue
            if item in seen:
                continue
            seen.add(item)
            items.append(item.replace("\\", "/"))
        return items

    def _build_compile_commands(self, project_dir: Path, target: Dict) -> List[Dict]:
        include_flags = []
        for inc in target.get("includes", []):
            abs_inc = (project_dir / inc).resolve()
            include_flags.append(f'-I"{abs_inc}"')

        define_flags = [f"-D{d}" for d in target.get("defines", [])]
        misc_flags = shlex.split(target.get("misc", "") or "")
        base_flags = include_flags + define_flags + misc_flags
        uv_rows: List[Dict[str, Any]] = []
        known_files: Dict[str, Path] = {}
        for item in target.get("files", []):
            abs_path = Path(item.get("abs_path", ""))
            ext = abs_path.suffix.lower()
            if ext not in {".c", ".cc", ".cpp", ".cxx"}:
                continue
            resolved = abs_path.resolve()
            known_files[str(resolved).lower()] = resolved
            uv_rows.append({
                "file": str(abs_path),
                "directory": str(project_dir.resolve()),
                "arguments": ["clang"] + base_flags + ["-c", str(abs_path)],
            })
        log_rows = self._build_compile_commands_from_keil_logs(project_dir, known_files)
        merged: Dict[str, Dict[str, Any]] = {}
        for row in uv_rows:
            key = str(Path(row.get("file", "")).resolve()).lower()
            merged[key] = row
        for row in log_rows:
            key = str(Path(row.get("file", "")).resolve()).lower()
            merged[key] = row
        return list(merged.values())

    def _build_compile_commands_from_keil_logs(self, project_dir: Path, known_files: Dict[str, Path]) -> List[Dict]:
        candidates = self._candidate_keil_log_files(project_dir)
        if not candidates:
            return []
        out: Dict[str, Dict[str, Any]] = {}
        for log_path in candidates:
            try:
                text = log_path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            for raw_line in text.splitlines():
                line = (raw_line or "").strip()
                low = line.lower()
                if ".c" not in low:
                    continue
                if not any(tool in low for tool in ("armclang", "armcc", "clang", "gcc")):
                    continue
                row = self._parse_keil_compile_line(project_dir, line, known_files)
                if not row:
                    continue
                out[str(Path(row["file"]).resolve()).lower()] = row
        return list(out.values())

    def _candidate_keil_log_files(self, project_dir: Path) -> List[Path]:
        rows: List[Path] = []
        patterns = ("*.log", "*.txt")
        for pattern in patterns:
            rows.extend(project_dir.rglob(pattern))
        ranked = []
        for path in rows:
            low = path.name.lower()
            if not any(x in low for x in ("build", "uv", "output", "log")):
                continue
            try:
                ranked.append((path.stat().st_mtime, path))
            except OSError:
                continue
        ranked.sort(reverse=True, key=lambda x: x[0])
        return [p for _, p in ranked[:12]]

    def _parse_keil_compile_line(self, project_dir: Path, line: str, known_files: Dict[str, Path]) -> Optional[Dict]:
        try:
            tokens = shlex.split(line, posix=False)
        except Exception:
            tokens = line.split()
        if not tokens:
            return None
        source = self._extract_source_from_tokens(project_dir, tokens, known_files)
        if not source:
            return None
        flags: List[str] = []
        i = 0
        while i < len(tokens):
            tok = str(tokens[i] or "").strip()
            if not tok:
                i += 1
                continue
            if tok in {"-I", "-D", "-std", "--target", "-mcpu", "-mfpu"} and i + 1 < len(tokens):
                flags.append(tok)
                flags.append(str(tokens[i + 1]))
                i += 2
                continue
            if tok.startswith(("-I", "-D", "-std=", "--target=", "-mcpu=", "-mfpu=", "-mthumb", "-f", "-W", "-O")):
                flags.append(tok)
            i += 1
        if not any(str(x).startswith("-I") for x in flags):
            return None
        return {
            "file": str(source),
            "directory": str(project_dir.resolve()),
            "arguments": ["clang"] + flags + ["-c", str(source)],
        }

    def _extract_source_from_tokens(self, project_dir: Path, tokens: List[str], known_files: Dict[str, Path]) -> Optional[Path]:
        for tok in tokens:
            raw = str(tok or "").strip().strip('"')
            low = raw.lower()
            if not low.endswith((".c", ".cc", ".cpp", ".cxx")):
                continue
            as_path = Path(raw)
            if not as_path.is_absolute():
                as_path = (project_dir / as_path).resolve()
            if as_path.exists():
                return as_path
            hit = known_files.get(str(as_path).lower())
            if hit:
                return hit
            # Handle logs that only keep file basename.
            base = as_path.name.lower()
            for _, candidate in known_files.items():
                if candidate.name.lower() == base:
                    return candidate
        return None

    def _query_navigation_with_clangd(
        self,
        index: Dict,
        clangd_path: str,
        symbol: str,
        current_path: str,
        current_line: int,
        current_column: int,
        limit: int,
    ) -> Dict:
        root_key = str(Path(index["project"]["root"]).resolve())
        now = time.time()
        disabled_until = float(self._clangd_persistent_disabled_until.get(root_key) or 0.0)
        if now < disabled_until:
            return self._query_navigation_with_clangd_oneshot(
                index=index,
                clangd_path=clangd_path,
                symbol=symbol,
                current_path=current_path,
                current_line=current_line,
                current_column=current_column,
                limit=limit,
            )
        sem = self._query_navigation_with_clangd_persistent(
            index=index,
            clangd_path=clangd_path,
            symbol=symbol,
            current_path=current_path,
            current_line=current_line,
            current_column=current_column,
            limit=limit,
        )
        if sem.get("success"):
            self._clangd_persistent_failures[root_key] = 0
            return sem
        fail_count = int(self._clangd_persistent_failures.get(root_key) or 0) + 1
        self._clangd_persistent_failures[root_key] = fail_count
        if fail_count <= 2:
            cooldown = 60.0
        elif fail_count <= 5:
            cooldown = 180.0
        else:
            cooldown = 600.0
        self._clangd_persistent_disabled_until[root_key] = time.time() + cooldown
        self._perf_record("navigation.semantic_fallback", cooldown)
        return self._query_navigation_with_clangd_oneshot(
            index=index,
            clangd_path=clangd_path,
            symbol=symbol,
            current_path=current_path,
            current_line=current_line,
            current_column=current_column,
            limit=limit,
        )

    def _query_navigation_with_clangd_persistent(
        self,
        index: Dict,
        clangd_path: str,
        symbol: str,
        current_path: str,
        current_line: int,
        current_column: int,
        limit: int,
    ) -> Dict:
        t0 = self._perf_begin()
        project_root = Path(index["project"]["root"]).resolve()
        current_abs = self._resolve_abs_path_by_rel(index, current_path)
        if not current_abs or not current_abs.exists():
            return {"success": False, "error": "当前文件路径无效"}
        ok, _ = self._ensure_compile_commands(project_root)
        if not ok:
            return {"success": False, "error": "compile_commands 不可用"}

        session = self._ensure_clangd_session(project_root, clangd_path)
        if not session:
            return {"success": False, "error": "clangd 会话不可用"}

        text = current_abs.read_text(encoding="utf-8", errors="ignore")
        lang = "cpp" if current_abs.suffix.lower() in {".cpp", ".cc", ".cxx", ".hpp", ".hh"} else "c"
        uri = current_abs.as_uri()
        line0 = max(0, int(current_line or 1) - 1)
        col0 = max(0, int(current_column or 1) - 1)
        lines = text.splitlines()
        if 0 <= line0 < len(lines):
            line_text = lines[line0]
            if not line_text[col0:col0 + len(symbol)] == symbol:
                probe = line_text.find(symbol)
                if probe >= 0:
                    col0 = probe
        pos = {"line": line0, "character": col0}
        try:
            with session["lock"]:
                version = int(session.get("version", 1)) + 1
                session["version"] = version
                self._clangd_send_packet(session, {
                    "jsonrpc": "2.0",
                    "method": "textDocument/didOpen",
                    "params": {"textDocument": {"uri": uri, "languageId": lang, "version": version, "text": text}},
                })
                def_id = self._clangd_next_id(session)
                ref_id = self._clangd_next_id(session)
                self._clangd_send_packet(session, {
                    "jsonrpc": "2.0",
                    "id": def_id,
                    "method": "textDocument/definition",
                    "params": {"textDocument": {"uri": uri}, "position": pos},
                })
                self._clangd_send_packet(session, {
                    "jsonrpc": "2.0",
                    "id": ref_id,
                    "method": "textDocument/references",
                    "params": {"textDocument": {"uri": uri}, "position": pos, "context": {"includeDeclaration": False}},
                })
                def_msg = self._clangd_wait_response(session, def_id, timeout=0.09)
                ref_msg = self._clangd_wait_response(session, ref_id, timeout=0.09)
                if not def_msg and not ref_msg:
                    raise RuntimeError("clangd persistent timeout")
            def_rows = self._lsp_locations_to_rows(index, (def_msg or {}).get("result"), symbol)
            ref_rows = self._lsp_locations_to_rows(index, (ref_msg or {}).get("result"), symbol)
            definition = self._pick_best_semantic_definition(index, def_rows, current_path, current_line)
            if definition:
                ref_rows = [r for r in ref_rows if not (r["path"] == definition["path"] and int(r["line"]) == int(definition["line"]))]
            self._perf_end("navigation.semantic_persistent", t0)
            return {"success": True, "definition": definition or {}, "references": ref_rows[:limit]}
        except Exception as exc:
            with self._clangd_session_lock:
                self._shutdown_clangd_session_locked()
            self._perf_end("navigation.semantic_persistent", t0)
            msg = str(exc) if exc else "clangd 常驻会话查询异常"
            return {"success": False, "error": msg}

    def _query_navigation_with_clangd_oneshot(
        self,
        index: Dict,
        clangd_path: str,
        symbol: str,
        current_path: str,
        current_line: int,
        current_column: int,
        limit: int,
    ) -> Dict:
        t0 = self._perf_begin()
        project_root = Path(index["project"]["root"]).resolve()
        current_abs = self._resolve_abs_path_by_rel(index, current_path)
        if not current_abs or not current_abs.exists():
            return {"success": False, "error": "当前文件路径无效"}

        ok, _ = self._ensure_compile_commands(project_root)
        if not ok:
            return {"success": False, "error": "compile_commands 不可用"}

        text = current_abs.read_text(encoding="utf-8", errors="ignore")
        lang = "cpp" if current_abs.suffix.lower() in {".cpp", ".cc", ".cxx", ".hpp", ".hh"} else "c"
        uri = current_abs.as_uri()
        line0 = max(0, int(current_line or 1) - 1)
        col0 = max(0, int(current_column or 1) - 1)
        lines = text.splitlines()
        if 0 <= line0 < len(lines):
            line_text = lines[line0]
            if not line_text[col0:col0 + len(symbol)] == symbol:
                probe = line_text.find(symbol)
                if probe >= 0:
                    col0 = probe
        pos = {"line": line0, "character": col0}
        try:
            init_id = 1
            def_id = 2
            ref_id = 3
            shutdown_id = 4
            packets = [
                {
                    "jsonrpc": "2.0",
                    "id": init_id,
                    "method": "initialize",
                    "params": {
                        "processId": None,
                        "rootUri": project_root.as_uri(),
                        "capabilities": {},
                        "workspaceFolders": [{"uri": project_root.as_uri(), "name": project_root.name}],
                    },
                },
                {"jsonrpc": "2.0", "method": "initialized", "params": {}},
                {
                    "jsonrpc": "2.0",
                    "method": "textDocument/didOpen",
                    "params": {"textDocument": {"uri": uri, "languageId": lang, "version": 1, "text": text}},
                },
                {"jsonrpc": "2.0", "id": def_id, "method": "textDocument/definition", "params": {"textDocument": {"uri": uri}, "position": pos}},
                {
                    "jsonrpc": "2.0",
                    "id": ref_id,
                    "method": "textDocument/references",
                    "params": {"textDocument": {"uri": uri}, "position": pos, "context": {"includeDeclaration": False}},
                },
                {"jsonrpc": "2.0", "id": shutdown_id, "method": "shutdown", "params": None},
                {"jsonrpc": "2.0", "method": "exit", "params": {}},
            ]

            data = b"".join(self._lsp_packet(p) for p in packets)
            proc = subprocess.Popen(
                [clangd_path, "--background-index=0", "--pch-storage=memory", f"--compile-commands-dir={project_root}"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            if not proc.stdin:
                return {"success": False, "error": "clangd stdin 不可用"}
            proc.stdin.write(data)
            proc.stdin.close()
            out, _ = proc.communicate(timeout=8)
            messages = self._lsp_parse_stream(out or b"")
            by_id = {m.get("id"): m for m in messages if isinstance(m, dict) and "id" in m}
            if init_id not in by_id or "result" not in by_id.get(init_id, {}):
                return {"success": False, "error": "clangd initialize 失败"}
            def_msg = by_id.get(def_id, {})
            ref_msg = by_id.get(ref_id, {})
            def_rows = self._lsp_locations_to_rows(index, def_msg.get("result"), symbol)
            ref_rows = self._lsp_locations_to_rows(index, ref_msg.get("result"), symbol)
            definition = self._pick_best_semantic_definition(index, def_rows, current_path, current_line)
            if definition:
                ref_rows = [r for r in ref_rows if not (r["path"] == definition["path"] and int(r["line"]) == int(definition["line"]))]
            self._perf_end("navigation.semantic_oneshot", t0)
            return {"success": True, "definition": definition or {}, "references": ref_rows[:limit]}
        except subprocess.TimeoutExpired:
            self._perf_end("navigation.semantic_oneshot", t0)
            return {"success": False, "error": "clangd oneshot timeout"}
        except Exception:
            self._perf_end("navigation.semantic_oneshot", t0)
            return {"success": False, "error": "clangd 查询异常"}

    def _ensure_clangd_session(self, project_root: Path, clangd_path: str) -> Dict[str, Any]:
        with self._clangd_session_lock:
            session = self._clangd_session
            if session:
                proc = session.get("proc")
                same_root = str(session.get("root") or "") == str(project_root)
                if proc and proc.poll() is None and same_root:
                    return session
                self._shutdown_clangd_session_locked()

            try:
                proc = subprocess.Popen(
                    [clangd_path, "--background-index", "--pch-storage=memory", f"--compile-commands-dir={project_root}"],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
                if not proc.stdin or not proc.stdout:
                    return {}
                q: "queue.Queue[Dict[str, Any]]" = queue.Queue()
                session = {
                    "proc": proc,
                    "stdin": proc.stdin,
                    "stdout": proc.stdout,
                    "queue": q,
                    "lock": threading.Lock(),
                    "root": str(project_root),
                    "next_id": 10,
                    "version": 1,
                }
                reader = threading.Thread(target=self._clangd_reader_loop, args=(session,), daemon=True)
                session["reader"] = reader
                reader.start()
                init_id = self._clangd_next_id(session)
                self._clangd_send_packet(session, {
                    "jsonrpc": "2.0",
                    "id": init_id,
                    "method": "initialize",
                    "params": {
                        "processId": None,
                        "rootUri": project_root.as_uri(),
                        "capabilities": {},
                        "workspaceFolders": [{"uri": project_root.as_uri(), "name": project_root.name}],
                    },
                })
                init_msg = self._clangd_wait_response(session, init_id, timeout=8.0)
                if not init_msg or "result" not in init_msg:
                    try:
                        proc.kill()
                    except Exception:
                        pass
                    return {}
                self._clangd_send_packet(session, {"jsonrpc": "2.0", "method": "initialized", "params": {}})
                self._clangd_session = session
                return session
            except Exception:
                return {}

    def _shutdown_clangd_session_locked(self) -> None:
        session = self._clangd_session
        self._clangd_session = {}
        if not session:
            return
        try:
            self._clangd_send_packet(session, {"jsonrpc": "2.0", "method": "exit", "params": {}})
        except Exception:
            pass
        proc = session.get("proc")
        if proc and proc.poll() is None:
            try:
                proc.kill()
            except Exception:
                pass

    def _clangd_next_id(self, session: Dict[str, Any]) -> int:
        cur = int(session.get("next_id") or 1)
        session["next_id"] = cur + 1
        return cur

    def _clangd_send_packet(self, session: Dict[str, Any], payload: Dict[str, Any]) -> None:
        stdin = session.get("stdin")
        if not stdin:
            raise RuntimeError("clangd stdin invalid")
        stdin.write(self._lsp_packet(payload))
        stdin.flush()

    def _clangd_wait_response(self, session: Dict[str, Any], req_id: int, timeout: float = 8.0) -> Optional[Dict[str, Any]]:
        q = session.get("queue")
        if not q:
            return None
        end_at = time.time() + timeout
        stash = session.setdefault("stash", [])
        for i, item in enumerate(list(stash)):
            if item.get("id") == req_id:
                stash.pop(i)
                return item
        while time.time() < end_at:
            remain = max(0.05, end_at - time.time())
            try:
                msg = q.get(timeout=remain)
            except Exception:
                continue
            if not isinstance(msg, dict):
                continue
            if msg.get("id") == req_id:
                return msg
            stash.append(msg)
        return None

    def _clangd_reader_loop(self, session: Dict[str, Any]) -> None:
        stdout = session.get("stdout")
        q = session.get("queue")
        proc = session.get("proc")
        if not stdout or not q:
            return
        while proc and proc.poll() is None:
            try:
                headers: Dict[str, str] = {}
                line = stdout.readline()
                if not line:
                    break
                while line and line not in {b"\r\n", b"\n"}:
                    text = line.decode("ascii", errors="ignore").strip()
                    if ":" in text:
                        k, v = text.split(":", 1)
                        headers[k.strip().lower()] = v.strip()
                    line = stdout.readline()
                length = int(headers.get("content-length", "0") or "0")
                if length <= 0:
                    continue
                body = stdout.read(length)
                if not body:
                    break
                msg = json.loads(body.decode("utf-8", errors="ignore"))
                if isinstance(msg, dict):
                    q.put(msg)
            except Exception:
                break

    def _ensure_compile_commands(self, project_root: Path) -> tuple[bool, str]:
        cc_path = project_root / "compile_commands.json"
        if cc_path.exists() and cc_path.stat().st_size > 20:
            self._set_index_state(project_root, compile_commands_ready=True)
            return True, ""
        ctx = self.get_keil_compile_context(str(project_root))
        if not ctx.get("success"):
            self._set_index_state(project_root, compile_commands_ready=False, error=str(ctx.get("error") or ""))
            return False, str(ctx.get("error") or "未找到 Keil 工程参数")
        rows = ctx.get("compile_commands") or []
        if not rows:
            self._set_index_state(project_root, compile_commands_ready=False, error="compile_commands 为空")
            return False, "compile_commands 为空"
        cc_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
        self._set_index_state(project_root, compile_commands_ready=True)
        return True, ""

    def _resolve_abs_path_by_rel(self, index: Dict, rel_path: str) -> Optional[Path]:
        target = (rel_path or "").replace("\\", "/")
        if not target:
            return None
        file_item = index.get("_file_by_path", {}).get(target)
        return Path(file_item["abs_path"]).resolve() if file_item else None

    def _lsp_packet(self, payload: Dict) -> bytes:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        header = f"Content-Length: {len(data)}\r\n\r\n".encode("ascii")
        return header + data

    def _lsp_parse_stream(self, raw: bytes) -> List[Dict]:
        out = []
        i = 0
        total = len(raw or b"")
        while i < total:
            j = raw.find(b"\r\n\r\n", i)
            if j < 0:
                break
            header = raw[i:j].decode("ascii", errors="ignore")
            length = 0
            for line in header.split("\r\n"):
                if line.lower().startswith("content-length:"):
                    try:
                        length = int(line.split(":", 1)[1].strip())
                    except Exception:
                        length = 0
            i = j + 4
            if length <= 0 or i + length > total:
                break
            body = raw[i:i + length]
            i += length
            try:
                msg = json.loads(body.decode("utf-8", errors="ignore"))
                if isinstance(msg, dict):
                    out.append(msg)
            except Exception:
                continue
        return out

    def _lsp_locations_to_rows(self, index: Dict, payload, symbol: str) -> List[Dict]:
        if payload is None:
            return []
        items = payload if isinstance(payload, list) else [payload]
        rows = []
        for it in items:
            uri = it.get("uri") or it.get("targetUri") or ""
            rng = it.get("range") or it.get("targetSelectionRange") or it.get("targetRange") or {}
            start = rng.get("start") or {}
            abs_path = self._uri_to_abs_path(uri)
            if not abs_path:
                continue
            rel = self._abs_to_rel_path(index, abs_path)
            if not rel:
                continue
            line = int(start.get("line", 0)) + 1
            col = int(start.get("character", 0)) + 1
            snippet = self._read_line_text(abs_path, line)
            fn = self._find_function_context_in_index(index, rel, line)
            rows.append({
                "path": rel,
                "line": line,
                "column": col,
                "label": symbol,
                "kind": "reference",
                "snippet": snippet[:220],
                "function_id": fn.get("id", ""),
                "function_name": fn.get("name", ""),
            })
        dedup = []
        seen = set()
        for r in rows:
            key = (r["path"], int(r["line"]), int(r["column"]))
            if key in seen:
                continue
            seen.add(key)
            dedup.append(r)
        return dedup

    def _uri_to_abs_path(self, uri: str) -> Optional[Path]:
        if not uri:
            return None
        p = urllib.parse.urlparse(uri)
        if p.scheme != "file":
            return None
        raw = urllib.parse.unquote(p.path or "")
        if re.match(r"^/[A-Za-z]:", raw):
            raw = raw[1:]
        return Path(raw).resolve()

    def _abs_to_rel_path(self, index: Dict, abs_path: Path) -> str:
        s = str(abs_path.resolve()).lower()
        rel = index.get("_abs_to_rel", {}).get(s)
        if rel:
            return rel
        root = Path(index["project"]["root"]).resolve()
        try:
            return abs_path.resolve().relative_to(root).as_posix()
        except Exception:
            return ""

    def _read_line_text(self, abs_path: Path, line_no: int) -> str:
        try:
            _, lines = self._read_source_cached(str(abs_path))
            if 1 <= line_no <= len(lines):
                return lines[line_no - 1].strip()
        except Exception:
            pass
        return ""

    def _pick_best_semantic_definition(self, index: Dict, rows: List[Dict], current_path: str, current_line: int) -> Dict:
        if not rows:
            return {}
        noisy_tokens = ("example", "demo", "sample", "test", "archive", "legacy", "backup")
        def rank(row: Dict) -> tuple:
            path = row.get("path", "")
            same_file = 0 if path == current_path else 1
            noise = 1 if any(t in path.lower() for t in noisy_tokens) else 0
            dist = abs(int(row.get("line") or 0) - int(current_line or 0)) if same_file == 0 else 0
            return (same_file, noise, dist, path, int(row.get("line") or 0))
        rows.sort(key=rank)
        best = dict(rows[0])
        best["kind"] = "definition"
        return best

    def _is_confident_semantic_definition(self, row: Dict, symbol: str) -> bool:
        snippet = (row.get("snippet") or "").strip()
        if not snippet:
            return False
        if snippet.startswith("#define"):
            return True
        if re.search(r"\btypedef\b|\bstruct\b|\benum\b", snippet):
            return True
        m = re.search(rf"\b{re.escape(symbol)}\b", snippet)
        if not m:
            return True
        prefix = snippet[:m.start()].strip()
        # Pure call-site like "foo();" should not be treated as definition.
        if prefix == "" and re.search(rf"\b{re.escape(symbol)}\s*\(", snippet) and ";" in snippet and "{" not in snippet:
            return False
        return True

    def _prefer_local_function_impl(self, sem_def: Dict, local_def: Dict, symbol: str) -> Dict:
        if not sem_def:
            return local_def or sem_def
        if not local_def:
            return sem_def
        if local_def.get("kind") != "function":
            return sem_def
        sem_path = str(sem_def.get("path") or "").lower()
        sem_kind = str(sem_def.get("kind") or "")
        snippet = str(sem_def.get("snippet") or "")
        sem_fn_name = str(sem_def.get("function_name") or "")
        if sem_fn_name and sem_fn_name != symbol:
            return local_def
        if sem_def.get("function_id") and sem_fn_name == symbol:
            return sem_def
        if sem_path.endswith(".h"):
            return local_def
        if sem_kind in {"definition", "declaration", "reference"} and re.search(rf"\b{re.escape(symbol)}\s*\([^)]*\)\s*;", snippet):
            return local_def
        return sem_def

    def _semantic_def_matches_symbol(self, row: Dict, symbol: str) -> bool:
        text = str(row.get("snippet") or "")
        if not text:
            return True
        return bool(re.search(rf"\b{re.escape(symbol)}\b", text))

    def _resolve_file_id_by_path(self, index: Dict, path: str) -> str:
        target = (path or "").replace("\\", "/")
        if not target:
            return ""
        file_item = index.get("_file_by_path", {}).get(target)
        return file_item["id"] if file_item else ""

    def _lines_for_file(self, index: Dict, file_id: str) -> List[Dict]:
        cached = index.get("_lines_by_file", {}).get(file_id)
        if cached is not None:
            return cached
        file_item = index.get("_file_by_id", {}).get(file_id)
        if not file_item:
            return []
        _, raw_lines = self._read_source_cached(file_item["abs_path"])
        lines = [{"line_number": i + 1, "text": line} for i, line in enumerate(raw_lines)]
        index.setdefault("_lines_by_file", {})[file_id] = lines
        return lines

    def _iter_token_rows(self, index: Dict, name: str) -> List[Dict]:
        return list(index.get("token_index", {}).get((name or "").lower(), []))

    def _pick_best_callee_candidate(self, caller_fn: Dict, callee_name: str, candidates: List[Dict]) -> Optional[Dict]:
        if not candidates:
            return None
        noisy_tokens = ("example", "demo", "sample", "test", "archive", "legacy", "backup")

        def _score(item: Dict) -> tuple:
            path = str(item.get("path") or "")
            same_file = 0 if path == str(caller_fn.get("path") or "") else 1
            noisy = 1 if any(t in path.lower() for t in noisy_tokens) else 0
            return (same_file, noisy, path, int(item.get("start_line") or 0))

        ordered = sorted(candidates, key=_score)
        return ordered[0] if ordered else None

    def _pick_definition(self, index: Dict, name: str, cur_file_id: str, cur_line: int) -> Dict:
        candidates: List[tuple] = []
        noisy_tokens = ("example", "demo", "sample", "test", "archive", "legacy", "backup")
        def path_penalty(path: str) -> int:
            p = (path or "").lower()
            return 1 if any(t in p for t in noisy_tokens) else 0

        for fn in index["functions"]:
            if fn["name"] != name:
                continue
            bias = 0 if fn["file_id"] == cur_file_id else 1
            dist = abs(int(cur_line or 0) - fn["start_line"]) if bias == 0 and cur_line else 0
            candidates.append((
                0,
                bias,
                path_penalty(fn["path"]),
                dist,
                fn["path"],
                fn["start_line"],
                {"path": fn["path"], "line": fn["start_line"], "column": 1, "kind": "function", "label": fn["name"], "function_id": fn["id"]},
            ))

        by_file: Dict[str, List[Dict]] = {}
        for row in self._iter_token_rows(index, name):
            file_id = row.get("file_id") or ""
            if not file_id:
                continue
            lines = by_file.setdefault(file_id, self._lines_for_file(index, file_id))
            i = int(row.get("line") or 0)
            if i <= 0 or i > len(lines):
                continue
            raw = str(row.get("text") or "")
            match = self._match_symbol(lines, i - 1, name)
            if not match:
                continue
            kind = match[0]
            if kind not in {"macro", "struct", "typedef", "definition", "declaration"}:
                continue
            path = row.get("path") or ""
            bias = 0 if file_id == cur_file_id else 1
            dist = abs(int(cur_line or 0) - i) if bias == 0 and cur_line else 0
            col = int(row.get("column") or max(1, raw.find(name) + 1))
            candidates.append((
                self._kind_priority(kind),
                bias,
                path_penalty(path),
                dist,
                path,
                i,
                {"path": path, "line": i, "column": max(1, col), "kind": kind, "label": name},
            ))

        if not candidates:
            return {}
        candidates.sort(key=lambda x: (x[0], x[1], x[2], x[3], x[4], x[5]))
        return candidates[0][6]

    def _collect_references(
        self,
        index: Dict,
        name: str,
        definition: Dict,
        cur_file_id: str,
        cur_line: int,
        limit: int,
    ) -> List[Dict]:
        def_path = definition.get("path", "")
        def_line = int(definition.get("line") or 0)
        rows = []
        for row in self._iter_token_rows(index, name):
            path = row.get("path") or ""
            file_id = row.get("file_id") or ""
            i = int(row.get("line") or 0)
            if not i:
                continue
            if path == def_path and i == def_line:
                continue
            snippet = str(row.get("text") or "").strip()
            bias = 0 if file_id == cur_file_id else 1
            dist = abs(int(cur_line or 0) - i) if bias == 0 and cur_line else 0
            fn = self._find_function_context_in_index(index, path, i)
            rows.append({
                "path": path,
                "line": i,
                "column": int(row.get("column") or 1),
                "label": name,
                "kind": "reference",
                "snippet": snippet[:220],
                "function_id": fn.get("id", ""),
                "function_name": fn.get("name", ""),
                "_sort": (bias, dist, path, i),
            })
        rows.sort(key=lambda r: r["_sort"])
        out = []
        for row in rows[:limit]:
            clean = dict(row)
            clean.pop("_sort", None)
            out.append(clean)
        return out

    def peek_symbol(self, project_id: str, symbol: str, current_file_id: Optional[str] = None, current_line: Optional[int] = None) -> Dict:
        t0 = self._perf_begin()
        index = self._projects[project_id]
        name = (symbol or "").strip()
        if not name:
            return {"success": False, "error": "空符号"}

        ordered_files = self._ordered_files(index, current_file_id)
        if self._looks_like_macro(name):
            macro = self._resolve_macro_peek(project_id, name, ordered_files, current_file_id, current_line)
            if macro:
                return macro
        candidates: List[tuple] = []
        by_file_lines: Dict[str, List[Dict]] = {}
        token_rows = self._iter_token_rows(index, name)
        for row in token_rows:
            file_id = row.get("file_id") or ""
            if not file_id:
                continue
            lines = by_file_lines.setdefault(file_id, self._lines_for_file(index, file_id))
            line_no = int(row.get("line") or 0)
            if line_no <= 0 or line_no > len(lines):
                continue
            match = self._match_symbol(lines, line_no - 1, name)
            if not match:
                continue
            kind, start_idx, end_idx = match
            distance = abs(line_no - int(current_line or 0)) if current_file_id == file_id and current_line else 0
            candidates.append((self._kind_priority(kind), 0 if current_file_id == file_id else 1, distance, line_no, file_id, kind, start_idx, end_idx))
        if not candidates:
            for file_item in ordered_files:
                source = self.get_file_source(project_id, file_item["id"])
                lines = source["lines"]
                for idx, line in enumerate(lines):
                    match = self._match_symbol(lines, idx, name)
                    if not match:
                        continue
                    kind, start_idx, end_idx = match
                    distance = abs(line["line_number"] - int(current_line or 0)) if current_file_id == file_item["id"] and current_line else 0
                    candidates.append((self._kind_priority(kind), 0 if current_file_id == file_item["id"] else 1, distance, line["line_number"], file_item["id"], kind, start_idx, end_idx))

        if not candidates:
            return {"success": False, "error": "未找到符号"}

        candidates.sort(key=lambda item: (item[0], item[1], item[2], item[3]))
        _, _, _, _, file_id, kind, start_idx, end_idx = candidates[0]
        source = self.get_file_source(project_id, file_id)
        if kind == "symbol":
            upgraded = self._upgrade_symbol_peek_target(
                project_id=project_id,
                symbol=name,
                current_file_id=current_file_id,
                current_line=current_line,
                source=source,
                file_id=file_id,
                start_idx=start_idx,
                end_idx=end_idx,
            )
            if upgraded:
                source = upgraded["source"]
                file_id = upgraded["file_id"]
                kind = upgraded["kind"]
                start_idx = upgraded["start_idx"]
                end_idx = upgraded["end_idx"]
        snippet = source["lines"][start_idx:end_idx + 1]
        facts = [{"label": "类型", "value": self._kind_label(kind)}]
        sections: List[Dict] = []

        if kind in {"definition", "declaration"}:
            decl = self._extract_declaration(source["lines"], start_idx, end_idx, name)
            if decl:
                facts.append({"label": "声明", "value": decl["declaration"]})
                if decl["type"]:
                    facts.append({"label": "变量类型", "value": decl["type"]})
                    type_section = self._resolve_type_definition(project_id, decl["type"], current_file_id)
                    if type_section:
                        sections.append(type_section)
            writes = self._find_symbol_lines(project_id, name, mode="write")
            reads = self._find_symbol_lines(project_id, name, mode="read")
            init_calls = self._find_call_usages(project_id, name, mode="init")
            pass_calls = self._find_call_usages(project_id, name, mode="call")
            if writes:
                sections.append({"title": "最近赋值", "items": writes})
            if reads:
                sections.append({"title": "最近读取", "items": reads})
            if init_calls:
                sections.append({"title": "初始化相关", "items": init_calls})
            if pass_calls:
                sections.append({"title": "传入函数", "items": pass_calls})
        elif kind == "macro":
            value = self._extract_define_value(snippet, name)
            if value:
                facts.append({"label": "值", "value": value})
        elif kind in {"struct", "typedef"}:
            sections.append({"title": "定义片段", "kind": "code", "path": source["path"], "line": snippet[0]["line_number"], "lines": snippet})

        self._perf_end("peek_symbol", t0)
        return {"success": True, "kind": kind, "symbol": name, "path": source["path"], "line": snippet[0]["line_number"], "lines": snippet, "facts": facts, "sections": sections}

    def _upgrade_symbol_peek_target(
        self,
        project_id: str,
        symbol: str,
        current_file_id: Optional[str],
        current_line: Optional[int],
        source: Dict,
        file_id: str,
        start_idx: int,
        end_idx: int,
    ) -> Optional[Dict]:
        # If initial match is only a usage-site symbol, try semantic/text navigation
        # and promote to declaration/definition/macro/type when available.
        path = source.get("path", "")
        line_no = int(current_line or (source["lines"][start_idx]["line_number"] if source.get("lines") else 1))
        nav = self.get_navigation_targets(project_id, symbol, path, line_no, 1, 120)
        if not nav.get("success"):
            return None
        definition = nav.get("definition") or {}
        def_path = definition.get("path")
        def_line = int(definition.get("line") or 0)
        if not def_path or def_line <= 0:
            return None
        index = self._projects[project_id]
        target_file = index.get("_file_by_path", {}).get(def_path)
        if not target_file:
            return None
        target_source = self.get_file_source(project_id, target_file["id"])
        lines = target_source.get("lines") or []
        pos = max(0, min(len(lines) - 1, def_line - 1))
        if not lines:
            return None
        match = self._match_symbol(lines, pos, symbol)
        if match:
            kind, s_idx, e_idx = match
            if kind in {"definition", "declaration", "macro", "struct", "typedef"}:
                return {"source": target_source, "file_id": target_file["id"], "kind": kind, "start_idx": s_idx, "end_idx": e_idx}
        s_idx = self._expand_definition_start(lines, pos)
        e_idx = self._find_statement_end(lines, pos)
        return {"source": target_source, "file_id": target_file["id"], "kind": "definition", "start_idx": s_idx, "end_idx": e_idx}

    def _resolve_macro_peek(self, project_id: str, name: str, ordered_files: List[Dict], current_file_id: Optional[str], current_line: Optional[int]) -> Optional[Dict]:
        chain: List[Dict] = []
        seen = set()
        current = name
        while current and current not in seen and len(chain) < 8:
            seen.add(current)
            define = self._find_macro_definition(project_id, current, ordered_files, current_file_id, current_line)
            if not define:
                synthetic = self._synthesize_macro_terminal(current)
                if synthetic:
                    chain.append(synthetic)
                break
            chain.append(define)
            nxt = self._next_macro_token(define["value"], seen)
            if not nxt:
                break
            current = nxt
        if not chain:
            return None
        first = chain[0]
        facts = [{"label": "类型", "value": "宏定义"}]
        if first.get("value"):
            facts.append({"label": "值", "value": first["value"]})
        final_value = chain[-1].get("resolved_value") or chain[-1].get("value") or ""
        if final_value and final_value != first.get("value", ""):
            facts.append({"label": "最终值", "value": final_value})
        mask = self._gpio_mask(final_value or first.get("value", ""))
        if mask:
            facts.append({"label": "位掩码", "value": mask})
        pin = self._infer_pin_label(project_id, name, chain, ordered_files)
        if pin:
            facts.append({"label": "推断引脚", "value": pin})
        items = []
        for item in chain:
            items.append({
                "name": item["name"],
                "detail": item.get("display", item.get("value", "")),
                "path": item.get("path", ""),
                "line": item.get("line", 0),
            })
        return {
            "success": True,
            "kind": "macro",
            "symbol": name,
            "path": first.get("path", ""),
            "line": first.get("line", 1),
            "lines": first.get("lines", []),
            "facts": facts,
            "sections": [{"title": "宏链路", "items": items}] if items else [],
        }

    def _collect_files(self, root: Path, scan_mode: str = "full") -> List[Path]:
        exts = {".c", ".h", ".cpp", ".hpp", ".cc"}
        skip_dirs = {
            "build", "dist", ".git", "__pycache__", "node_modules", "output", "out", "bin", "obj",
            "Listings", "RTE", "analysis_reports", "project_docs", "project_meta", "docs", "logs",
            ".kiro", ".windsurf", ".cache", ".idea", ".vscode", "legacy", "public", "CMSIS", "lib", "tools",
            "external", "third_party", "thirdparty",
        }
        preferred_roots = [
            "app", "board", "boot_sdk", "calibration", "cmd", "config", "core",
            "drivers", "hal", "hw_system", "protocol", "ranging", "storage", "usb", "user",
        ]
        mode = (scan_mode or "full").strip().lower()
        scan_roots = [root]
        if mode == "whitelist":
            scan_roots = [root / name for name in preferred_roots if (root / name).exists()]
            if not scan_roots:
                scan_roots = [root]
        files = []
        seen = set()
        for scan_root in scan_roots:
            for path in scan_root.rglob("*"):
                if not path.is_file() or path.suffix.lower() not in exts:
                    continue
                rel_parts = path.relative_to(root).parts[:-1]
                if any(part in skip_dirs for part in rel_parts):
                    continue
                norm = str(path.resolve()).lower()
                if norm in seen:
                    continue
                seen.add(norm)
                files.append(path)
        return files

    def _parse_functions(self, rel: str, file_id: str, abs_path: str, text: str) -> List[Dict]:
        lines = text.splitlines()
        parse_lines = self._build_parse_lines(lines)
        functions: List[Dict] = []
        ctrl_kw = {"if", "for", "while", "switch", "return", "sizeof", "case", "else", "do"}
        i = 0
        while i < len(lines):
            line = parse_lines[i]
            if "(" not in line:
                i += 1
                continue
            header = line.strip()
            if not header:
                i += 1
                continue
            if header.startswith(("if", "for", "while", "switch")):
                i += 1
                continue
            if "{" not in header:
                merged = [header]
                j = i + 1
                while j < len(parse_lines) and "{" not in parse_lines[j]:
                    merged.append(parse_lines[j].strip())
                    if ";" in parse_lines[j]:
                        break
                    j += 1
                if j >= len(parse_lines):
                    i += 1
                    continue
                merged.append(parse_lines[j].strip())
                header = " ".join(merged)
            header_clean = header
            ms = list(re.finditer(r"([A-Za-z_]\w*)\s*\(([^;{}]*)\)\s*\{", header_clean))
            if not ms:
                i += 1
                continue
            # Pick the last candidate whose prefix looks like a declaration prefix
            # (e.g. `static void`, `drv_status_t`) rather than comment text.
            m = None
            for cand in reversed(ms):
                prefix_probe = header_clean[: cand.start(1)]
                if self._is_likely_decl_prefix(prefix_probe):
                    m = cand
                    break
            if not m:
                i += 1
                continue
            name = m.group(1)
            if name in ctrl_kw:
                i += 1
                continue
            if name.isupper():
                i += 1
                continue
            prefix = header_clean[: m.start(1)].strip()
            # Skip call-like blocks/macros such as `point(...) {` without return type.
            if not prefix:
                i += 1
                continue
            if "(" in prefix:
                i += 1
                continue
            # Skip assignment/initializer expressions that happen to contain `name(...) {`.
            if "=" in prefix or prefix.endswith(","):
                i += 1
                continue
            # Prefix must look like a C/C++ decl specifier chain.
            if not re.search(r"[A-Za-z_]", prefix):
                i += 1
                continue
            brace = 0
            body: List[str] = []
            k = i
            while k < len(lines):
                brace += lines[k].count("{")
                brace -= lines[k].count("}")
                body.append(lines[k])
                if brace == 0 and "}" in lines[k]:
                    break
                k += 1
            start_line = i + 1
            end_line = k + 1
            functions.append({
                "id": f"func:{rel}:{name}:{start_line}",
                "file_id": file_id,
                "path": rel,
                "abs_path": abs_path,
                "name": name,
                "signature": header.replace("{", "").strip(),
                "start_line": start_line,
                "end_line": end_line,
                "source": "\n".join(body),
            })
            i = k + 1
        return functions

    def _is_likely_decl_prefix(self, prefix: str) -> bool:
        tail = (prefix or "").strip()[-180:]
        if not tail:
            return False
        low = tail.lower()
        if "@brief" in low or "@param" in low or "@return" in low:
            return False
        # Must end with an ASCII identifier chain (type/qualifiers), optionally pointers.
        if not re.search(r"([A-Za-z_]\w*|\*)\s*$", tail):
            return False
        # Avoid obvious comment marker tails.
        if re.search(r"[*]\s*$", tail) and not re.search(r"\b[A-Za-z_]\w*\s+\*+\s*$", tail):
            return False
        return True

    def _build_parse_lines(self, lines: List[str]) -> List[str]:
        cleaned: List[str] = []
        in_block_comment = False
        for raw_line in lines:
            line, in_block_comment = self._strip_comments_for_parse_line(raw_line, in_block_comment)
            cleaned.append(line)
        return cleaned

    def _strip_comments_for_parse_line(self, line: str, in_block_comment: bool) -> tuple[str, bool]:
        text = line or ""
        if in_block_comment:
            end = text.find("*/")
            if end < 0:
                return "", True
            text = text[end + 2:]
            in_block_comment = False
        while True:
            start = text.find("/*")
            if start < 0:
                break
            end = text.find("*/", start + 2)
            if end < 0:
                text = text[:start]
                in_block_comment = True
                break
            text = text[:start] + " " + text[end + 2:]
        text = re.sub(r"//.*$", "", text)
        return text, in_block_comment

    def _ordered_files(self, index: Dict, current_file_id: Optional[str]) -> List[Dict]:
        files = sorted(index["files"], key=lambda item: item["path"])
        if not current_file_id:
            return files
        current = [f for f in files if f["id"] == current_file_id]
        return current + [f for f in files if f["id"] != current_file_id]

    def _looks_like_macro(self, name: str) -> bool:
        return bool(re.fullmatch(r"[A-Z][A-Z0-9_]*", name or ""))

    def _find_macro_definition(self, project_id: str, name: str, ordered_files: List[Dict], current_file_id: Optional[str], current_line: Optional[int]) -> Optional[Dict]:
        index = self._projects[project_id]
        matches = []
        define_re = re.compile(rf"^\s*#\s*define\s+{re.escape(name)}\b")
        for row in self._iter_token_rows(index, name):
            file_id = row.get("file_id") or ""
            line_no = int(row.get("line") or 0)
            text = row.get("text") or ""
            path = row.get("path") or ""
            if not define_re.search(text):
                continue
            line_dict = {"line_number": line_no, "text": text}
            value = self._extract_define_value([line_dict], name)
            distance = abs(line_no - int(current_line or 0)) if current_file_id == file_id and current_line else 0
            matches.append((
                0 if current_file_id == file_id else 1,
                distance,
                line_no,
                {
                    "name": name,
                    "value": value,
                    "resolved_value": value,
                    "display": f"-> {value}" if value else "",
                    "path": path,
                    "line": line_no,
                    "lines": [line_dict],
                },
            ))
        if not matches:
            return None
        matches.sort(key=lambda item: (item[0], item[1], item[2]))
        return matches[0][3]

    def _next_macro_token(self, value: str, seen: set[str]) -> str:
        for token in re.findall(r"\b[A-Za-z_]\w*\b", value or ""):
            if token in seen:
                continue
            if self._looks_like_macro(token) or re.fullmatch(r"GPIO_PIN_\d+", token):
                return token
        return ""

    def _synthesize_macro_terminal(self, name: str) -> Optional[Dict]:
        m = re.fullmatch(r"GPIO_PIN_(\d+)", name or "")
        if not m:
            return None
        pin_no = int(m.group(1))
        value = f"0x{(1 << pin_no):04X} (1U << {pin_no})"
        return {
            "name": name,
            "value": value,
            "resolved_value": value,
            "display": f"-> {value}",
            "path": "(builtin)",
            "line": 1,
            "lines": [{"line_number": 1, "text": f"#define {name} {value}"}],
        }

    def _gpio_mask(self, value: str) -> str:
        m = re.search(r"GPIO_PIN_(\d+)", value or "")
        if m:
            pin_no = int(m.group(1))
            return f"0x{(1 << pin_no):04X} (1U << {pin_no})"
        m2 = re.search(r"0x[0-9A-Fa-f]+(?:\s*\(1U\s*<<\s*\d+\))?", value or "")
        return m2.group(0) if m2 else ""

    def _infer_pin_label(self, project_id: str, name: str, chain: List[Dict], ordered_files: List[Dict]) -> str:
        if not name.endswith("_PIN"):
            return ""
        pin_token = ""
        for item in reversed(chain):
            token = item.get("name") or item.get("value") or ""
            if re.search(r"GPIO_PIN_(\d+)", token):
                pin_token = token
                break
        if not pin_token:
            return ""
        port_name = f"{name[:-4]}_PORT"
        port_def = self._find_macro_definition(project_id, port_name, ordered_files, None, None)
        port_val = port_def.get("value", "") if port_def else ""
        pm = re.search(r"GPIO([A-Z])", port_val)
        nm = re.search(r"GPIO_PIN_(\d+)", pin_token)
        if pm and nm:
            return f"P{pm.group(1)}{nm.group(1)}"
        return ""

    def _match_symbol(self, lines: List[Dict], idx: int, name: str):
        text = lines[idx]["text"]
        clean = re.sub(r"/\*.*?\*/", " ", text)
        clean = re.sub(r"//.*$", "", clean)
        escaped = re.escape(name)
        if re.search(rf"^\s*#\s*define\s+{escaped}\b", clean):
            return ("macro", idx, idx)
        if re.search(rf"\b(?:typedef\s+)?struct\b.*\b{escaped}\b", clean):
            return ("struct", idx, min(len(lines) - 1, idx + 120))
        if self._is_typedef_alias_match(clean, name):
            return ("typedef", max(0, idx - 1), min(len(lines) - 1, idx + 1))
        if re.search(r"\}\s*" + escaped + r"\b", clean):
            start = self._find_block_start(lines, idx)
            if start is not None:
                start_clean = re.sub(r"/\*.*?\*/", " ", lines[start]["text"])
                if re.search(r"\b(?:typedef\s+)?struct\b", start_clean):
                    return ("struct", start, idx)
                if re.search(r"\b(?:typedef\s+)?enum\b", start_clean):
                    return ("typedef", start, idx)
        if re.search(rf"\bextern\b[^;]*\b{escaped}\b", clean):
            return ("declaration", idx, idx)
        multi_def = self._match_multiline_definition_start(lines, idx, name)
        if multi_def:
            return multi_def
        if self._looks_like_definition(clean, name):
            return ("definition", idx, idx)
        if re.search(rf"\b{escaped}\b", clean):
            return ("symbol", max(0, idx - 1), min(len(lines) - 1, idx + 1))
        return None

    def _is_typedef_alias_match(self, clean_line: str, name: str) -> bool:
        line = re.sub(r"\s+", " ", clean_line or "").strip()
        if not line:
            return False
        if not re.search(r"^\s*typedef\b", line):
            return False
        seg = line.split(";", 1)[0]
        escaped = re.escape(name)
        if not re.search(rf"\b{escaped}\b", seg):
            return False
        # Function-pointer typedef alias: typedef xxx (*name)(...)
        if re.search(rf"\(\s*\*\s*{escaped}\s*\)\s*\(", seg):
            return True
        # Normal typedef alias at declarator tail: typedef xxx name;
        if re.search(rf"\b{escaped}\b\s*(?:\[[^\]]*\]\s*)*$", seg):
            return True
        return False

    def _match_multiline_definition_start(self, lines: List[Dict], idx: int, name: str):
        clean = re.sub(r"/\*.*?\*/", " ", lines[idx]["text"])
        clean = re.sub(r"//.*$", "", clean)
        escaped = re.escape(name)
        # Match definitions like:
        #   const drv_interface_t g_xxx = {
        #       ...
        #   };
        if not re.search(rf"\b{escaped}\b\s*(?:\[[^\]]*\])?\s*=", clean):
            return None
        if "extern" in clean:
            return None
        if re.search(rf"\b{escaped}\b\s*\(", clean):
            return None
        start = self._expand_definition_start(lines, idx)
        end = self._find_statement_end(lines, idx)
        return ("definition", start, end)

    def _expand_definition_start(self, lines: List[Dict], idx: int) -> int:
        start = idx
        lower = max(0, idx - 4)
        for pos in range(idx - 1, lower - 1, -1):
            text = re.sub(r"/\*.*?\*/", " ", lines[pos]["text"])
            text = re.sub(r"//.*$", "", text).strip()
            if not text:
                continue
            if text.startswith("#") or ";" in text or "{" in text or "}" in text:
                break
            if "(" in text and ")" in text:
                break
            start = pos
        return start

    def _find_statement_end(self, lines: List[Dict], idx: int, max_lookahead: int = 240) -> int:
        brace = 0
        upper = min(len(lines) - 1, idx + max_lookahead)
        for pos in range(idx, upper + 1):
            text = re.sub(r"/\*.*?\*/", " ", lines[pos]["text"])
            text = re.sub(r"//.*$", "", text)
            brace += text.count("{")
            brace -= text.count("}")
            if ";" in text and brace <= 0:
                return pos
        return idx

    def _looks_like_definition(self, text: str, name: str) -> bool:
        cleaned = re.sub(r"/\*.*?\*/", " ", text)
        cleaned = re.sub(r"//.*$", "", cleaned)
        if "extern" in cleaned:
            return False
        if re.search(rf"[.&>-]\s*{re.escape(name)}\b", cleaned):
            return False
        m = re.search(rf"\b{re.escape(name)}\b\s*(?:\[[^\]]*\])?\s*(?:=\s*.*)?;", cleaned)
        if not m:
            return False
        # Plain assignment like "foo = 1;" is usage, not declaration.
        prefix = cleaned[:m.start()].strip()
        if not prefix:
            return False
        # Require at least one type-ish token before symbol.
        if not re.search(r"[A-Za-z_]", prefix):
            return False
        return True

    def _kind_priority(self, kind: str) -> int:
        return {"macro": 0, "struct": 1, "typedef": 1, "definition": 2, "declaration": 3, "symbol": 9}.get(kind, 9)

    def _kind_label(self, kind: str) -> str:
        return {"macro": "宏定义", "struct": "结构体", "typedef": "类型定义", "definition": "变量定义", "declaration": "变量声明", "symbol": "符号"}.get(kind, kind)

    def _extract_declaration(self, lines: List[Dict], start_idx: int, end_idx: int, name: str) -> Optional[Dict]:
        text = " ".join(lines[i]["text"].strip() for i in range(start_idx, end_idx + 1))
        text = re.sub(r"/\*.*?\*/", " ", text)
        text = re.sub(r"//.*$", "", text)
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            return None
        m = re.match(rf"^(?P<type>.*?)\b{re.escape(name)}\b(?:\s*\[[^\]]*\])?\s*(?:=\s*(?P<value>.*))?;?$", text)
        if not m:
            return {"declaration": text, "type": "", "value": ""}
        type_text = re.sub(r"\b(?:extern|static|const|volatile|register)\b", " ", m.group("type") or "")
        type_text = re.sub(r"\s+", " ", type_text).strip()
        return {"declaration": text.rstrip(";"), "type": type_text, "value": (m.group("value") or "").strip()}

    def _extract_define_value(self, snippet: List[Dict], name: str) -> str:
        if not snippet:
            return ""
        m = re.search(rf"^\s*#\s*define\s+{re.escape(name)}\b(.*)$", snippet[0]["text"])
        return (m.group(1) if m else "").strip()

    def _resolve_type_definition(self, project_id: str, type_name: str, current_file_id: Optional[str]) -> Optional[Dict]:
        target = type_name.replace("*", " ").strip().split()[-1] if type_name.strip() else ""
        if not target:
            return None
        index = self._projects[project_id]
        candidates = []
        _lines_cache: Dict[str, List[Dict]] = {}
        for row in self._iter_token_rows(index, target):
            file_id = row.get("file_id") or ""
            line_no = int(row.get("line") or 0)
            if not file_id or line_no <= 0:
                continue
            if file_id not in _lines_cache:
                _lines_cache[file_id] = self._lines_for_file(index, file_id)
            lines = _lines_cache[file_id]
            idx = max(0, line_no - 1)
            if idx >= len(lines):
                continue
            match = self._match_symbol(lines, idx, target)
            if not match or match[0] not in {"struct", "typedef"}:
                continue
            candidates.append((0 if file_id == current_file_id else 1, line_no, file_id, match[0], match[1], match[2]))
        if not candidates:
            return None
        candidates.sort(key=lambda item: (item[0], item[1]))
        _, _, file_id, kind, start_idx, end_idx = candidates[0]
        source = self.get_file_source(project_id, file_id)
        return {"title": "结构体定义" if kind == "struct" else "类型定义", "kind": "code", "path": source["path"], "line": source["lines"][start_idx]["line_number"], "lines": source["lines"][start_idx:end_idx + 1]}

    def _find_block_start(self, lines: List[Dict], idx: int) -> Optional[int]:
        lower = max(0, idx - 240)
        for pos in range(idx, lower - 1, -1):
            text = re.sub(r"/\*.*?\*/", " ", lines[pos]["text"])
            if re.search(r"\b(?:typedef\s+)?(?:enum|struct)\b", text):
                return pos
        return None

    def _find_function_context_in_index(self, index: Dict, path: str, line_no: int) -> Dict:
        file_item = index.get("_file_by_path", {}).get(path)
        fns = index.get("_fns_by_file", {}).get(file_item["id"], []) if file_item else []
        matched = [fn for fn in fns if fn["start_line"] <= line_no <= fn["end_line"]]
        if not matched:
            return {}
        matched.sort(key=lambda fn: (fn["end_line"] - fn["start_line"], fn["start_line"]))
        fn = matched[0]
        return {"id": fn["id"], "name": fn["name"]}

    def _find_function_context(self, project_id: str, path: str, line_no: int) -> Dict:
        index = self._projects[project_id]
        return self._find_function_context_in_index(index, path, line_no)

    def _find_symbol_lines(self, project_id: str, name: str, mode: str, limit: int = 8) -> List[Dict]:
        index = self._projects[project_id]
        rows = []
        _lines_cache: Dict[str, List[Dict]] = {}
        write_re = re.compile(rf"\b{re.escape(name)}\b\s*(?:\[[^\]]+\])?\s*=(?!=)|\.\s*{re.escape(name)}\b\s*=(?!=)|->\s*{re.escape(name)}\b\s*=(?!=)")
        for row in self._iter_token_rows(index, name):
            path = row.get("path") or ""
            file_id = row.get("file_id") or ""
            line_no = int(row.get("line") or 0)
            text = row.get("text") or ""
            if not line_no:
                continue
            if file_id not in _lines_cache:
                _lines_cache[file_id] = self._lines_for_file(index, file_id)
            lines = _lines_cache[file_id]
            idx = max(0, line_no - 1)
            if idx >= len(lines):
                continue
            match = self._match_symbol(lines, idx, name)
            if match and match[0] in {"definition", "declaration", "macro", "typedef", "struct"}:
                continue
            is_write = bool(write_re.search(text))
            if mode == "read" and is_write:
                continue
            if mode == "write" and not is_write:
                continue
            fn = self._find_function_context_in_index(index, path, line_no)
            display = f"{path} : {line_no}"
            if fn.get("name"):
                display = f"{display} · {fn['name']}"
            rows.append({
                "name": display,
                "detail": text.strip(),
                "path": path,
                "line": line_no,
                "function_id": fn.get("id", ""),
                "tag": self._classify_context("write" if is_write else "read", text, fn.get("name", ""), ""),
            })
        rows.sort(key=lambda item: (item["path"], item["line"]))
        return rows[:limit]

    def _find_call_usages(self, project_id: str, name: str, mode: str, limit: int = 8) -> List[Dict]:
        index = self._projects[project_id]
        init_pattern = re.compile(r"(init|default|reset|load|setup|config|set)", re.I)
        grouped: Dict[tuple, Dict] = {}
        for row in self._iter_token_rows(index, name):
            path = row.get("path") or ""
            line_no = int(row.get("line") or 0)
            text = row.get("text") or ""
            if not line_no:
                continue
            calls = [x for x in CALL_RE.findall(text) if x not in {"if", "for", "while", "switch", "return", "sizeof"} and x != name]
            if not calls:
                continue
            fn = self._find_function_context_in_index(index, path, line_no)
            for callee in calls:
                if mode == "init" and not init_pattern.search(callee):
                    continue
                key = (callee, fn.get("id", ""), path)
                item = grouped.setdefault(key, {
                    "name": f"{callee} · {fn.get('name', '')}".rstrip(" ·"),
                    "detail": f"{path} : {line_no}",
                    "path": path,
                    "line": line_no,
                    "function_id": fn.get("id", ""),
                    "count": 0,
                    "tag": self._classify_context(mode, text, fn.get("name", ""), callee),
                })
                item["count"] += 1
        rows = []
        for item in grouped.values():
            item["detail"] = f"{item['detail']} · {item['count']}次"
            rows.append(item)
        rows.sort(key=lambda item: (item["path"], item["line"], item["name"]))
        return rows[:limit]

    def _summarize_function(self, fn: Dict) -> Dict:
        return {key: fn[key] for key in ("id", "name", "path", "file_id", "start_line", "end_line", "signature")}

    def _classify_context(self, mode: str, line_text: str, owner_fn: str, callee: str) -> str:
        text = f"{line_text} {owner_fn} {callee}".lower()
        if any(k in text for k in ("load", "profile", "kv_", "config", "restore", "cal_data")):
            return "配置加载"
        if any(k in text for k in ("init", "default", "setup", "reset", "boot", "power_on", "main")):
            return "默认初始化"
        if mode == "write":
            return "运行时改写"
        return "运行时访问"
