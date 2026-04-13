from __future__ import annotations

import time
from typing import Any, Dict, List


class NavigationEngine:
    def __init__(self, service: Any) -> None:
        self.svc = service

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
        t0 = self.svc._perf_begin()
        name = (symbol or "").strip()
        if not name:
            return {"success": False, "error": "空符号"}
        if project_id not in self.svc._projects:
            return {"success": False, "error": "工程未索引"}

        index = self.svc._projects[project_id]
        normalized_path = (current_path or "").replace("\\", "/")
        cur_file_id = self.svc._resolve_file_id_by_path(index, current_path)
        cache_key = self.svc._nav_cache_key(
            project_id=project_id,
            symbol=name,
            current_path=normalized_path,
            current_line=int(current_line or 0),
            current_column=int(current_column or 0),
            limit=int(limit or 0),
        )
        cache_allowed = str(perf_mode or "normal").lower() != "coldish"
        self.svc._stat_inc("navigation.cache_total")
        if cache_allowed:
            cached = self.svc._get_nav_cache(cache_key)
            if cached:
                self.svc._stat_inc("navigation.cache_hit")
                cached["message"] = str(cached.get("message") or "命中导航缓存")
                self.svc._set_last_navigation(cached)
                self.svc._perf_end("navigation", t0)
                return cached
        else:
            self.svc._stat_inc("navigation.cache_bypass_count")

        perf_breakdown: Dict[str, float] = {}
        t_fast = self.svc._perf_begin()
        definition = self.svc._pick_definition(index, name, cur_file_id, current_line)
        perf_breakdown["def_pick_ms"] = round((time.perf_counter() - t_fast) * 1000.0, 3)
        self.svc._perf_end("navigation.fast_resolve", t_fast)
        fast_confident = self.svc._is_fast_resolve_confident(
            index, name, definition, normalized_path, cur_file_id, int(current_line or 0)
        )
        local_refs: List[Dict[str, Any]] = []
        decision_source = "fast"
        ambiguity_count = len([fn for fn in index.get("functions", []) if fn.get("name") == name])

        clangd_path = self.svc._find_clangd_path()
        if clangd_path and not fast_confident:
            t_sem = self.svc._perf_begin()
            sem = self.svc._query_navigation_with_clangd(
                index=index,
                clangd_path=clangd_path,
                symbol=name,
                current_path=normalized_path,
                current_line=int(current_line or 1),
                current_column=int(current_column or 1),
                limit=limit,
            )
            perf_breakdown["semantic_ms"] = round((time.perf_counter() - t_sem) * 1000.0, 3)
            self.svc._perf_end("navigation.semantic", t_sem)
            if "timeout" in str(sem.get("error") or "").lower():
                self.svc._stat_inc("navigation.semantic_timeout_count")
            if sem.get("success") and (sem.get("definition") or sem.get("references")):
                sem_def = sem.get("definition") or {}
                sem_refs = sem.get("references") or []
                if sem_def and not self.svc._is_confident_semantic_definition(sem_def, name):
                    sem_def = {}
                if sem_def and not self.svc._semantic_def_matches_symbol(sem_def, name):
                    sem_def = {}
                t_pick = self.svc._perf_begin()
                local_def = self.svc._pick_definition(index, name, cur_file_id, current_line)
                sem_def = self.svc._prefer_local_function_impl(sem_def, local_def, name)
                if not sem_def:
                    sem_def = local_def
                    decision_source = "local"
                else:
                    decision_source = "semantic"
                perf_breakdown["def_pick_sem_ms"] = round((time.perf_counter() - t_pick) * 1000.0, 3)
                self.svc._perf_end("navigation.def_pick", t_pick)
                if not sem_refs:
                    t_refs = self.svc._perf_begin()
                    sem_refs = self.svc._collect_references(index, name, sem_def, cur_file_id, current_line, limit)
                    perf_breakdown["refs_collect_ms"] = round((time.perf_counter() - t_refs) * 1000.0, 3)
                    self.svc._perf_end("navigation.refs_collect", t_refs)
                out = {
                    "success": True,
                    "engine": "clangd",
                    "message": f"语义引擎: clangd ({clangd_path})",
                    "clangd_path": clangd_path,
                    "perf_mode": "coldish" if not cache_allowed else "normal",
                    "resolve_mode": "fast+semantic",
                    "decision_source": decision_source,
                    "ambiguity_count": ambiguity_count,
                    "perf_breakdown": perf_breakdown,
                    "definition": sem_def,
                    "references": sem_refs[:limit],
                }
                if cache_allowed:
                    self.svc._put_nav_cache(cache_key, out)
                self.svc._set_last_navigation(out)
                self.svc._perf_end("navigation", t0)
                if not cache_allowed:
                    self.svc._perf_end("navigation.non_cache", t0)
                return out

        t_refs = self.svc._perf_begin()
        local_refs = self.svc._collect_references(index, name, definition, cur_file_id, current_line, limit)
        perf_breakdown["refs_collect_ms"] = round((time.perf_counter() - t_refs) * 1000.0, 3)
        self.svc._perf_end("navigation.refs_collect", t_refs)
        fallback_msg = "clangd 未安装，当前使用增强文本引擎"
        if clangd_path and not fast_confident:
            fallback_msg = "clangd 语义查询失败，已自动降级到增强文本引擎"
            decision_source = "fallback"
        if fast_confident:
            fallback_msg = "已使用快速索引直达"
            decision_source = "fast"
        out = {
            "success": True,
            "engine": "text" if not fast_confident else "fast",
            "message": fallback_msg,
            "clangd_path": clangd_path,
            "perf_mode": "coldish" if not cache_allowed else "normal",
            "resolve_mode": "fast_only" if fast_confident else "fallback_fast",
            "decision_source": decision_source,
            "ambiguity_count": ambiguity_count,
            "perf_breakdown": perf_breakdown,
            "definition": definition,
            "references": local_refs,
        }
        if cache_allowed:
            self.svc._put_nav_cache(cache_key, out)
        self.svc._set_last_navigation(out)
        self.svc._perf_end("navigation", t0)
        if not cache_allowed:
            self.svc._perf_end("navigation.non_cache", t0)
        return out

    def simulate_navigation_chain(
        self,
        project_id: str,
        steps: List[Dict[str, Any]],
        perf_mode: str = "coldish",
        enable_test: bool = False,
    ) -> Dict:
        if not enable_test:
            return {"success": False, "error": "simulate_navigation_chain 仅测试使用，请显式 enable_test=true"}
        if project_id not in self.svc._projects:
            return {"success": False, "error": "工程未索引"}
        index = self.svc._projects[project_id]
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

        for idx_step, step in enumerate(steps or []):
            action = str(step.get("action") or "").strip().lower()
            if action == "symbol_click":
                selected = {
                    "symbol": str(step.get("symbol") or ""),
                    "path": str(step.get("path") or ""),
                    "line": int(step.get("line") or 0),
                    "column": int(step.get("column") or 1),
                }
                traces.append({"step": idx_step, "action": action, "selected": dict(selected)})
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
                fn_ctx = self.svc._find_function_context_in_index(index, def_path, def_line) if def_path and def_line > 0 else {}
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
                    "decision_source": str(nav.get("decision_source") or ""),
                    "ambiguity_count": int(nav.get("ambiguity_count") or 0),
                }
                _push_history(current)
                traces.append({"step": idx_step, "action": action, "ok": bool(nav.get("success")), "point": dict(current)})
                continue
            if action == "back":
                if nav_index > 0:
                    nav_index -= 1
                    current = dict(history[nav_index])
                traces.append({"step": idx_step, "action": action, "point": dict(current), "nav_index": nav_index})
                continue
            if action == "forward":
                if nav_index + 1 < len(history):
                    nav_index += 1
                    current = dict(history[nav_index])
                traces.append({"step": idx_step, "action": action, "point": dict(current), "nav_index": nav_index})
                continue
            traces.append({"step": idx_step, "action": action, "error": "unknown action"})
        return {
            "success": True,
            "perf_mode": perf_mode,
            "steps": traces,
            "history_size": len(history),
            "history_index": nav_index,
            "current": current,
        }
