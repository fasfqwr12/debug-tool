from __future__ import annotations

import time
from typing import Any, Dict


class PerfMetrics:
    def __init__(self, service: Any) -> None:
        self.svc = service

    def get_perf_stats(self) -> Dict:
        with self.svc._perf_lock:
            rows = []
            for name, raw in sorted(self.svc._perf_stats.items()):
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
        with self.svc._stats_lock:
            nav_cache_hit = float(self.svc._stat_counters.get("navigation.cache_hit") or 0.0)
            nav_cache_total = float(self.svc._stat_counters.get("navigation.cache_total") or 0.0)
            nav_cache_bypass = float(self.svc._stat_counters.get("navigation.cache_bypass_count") or 0.0)
            timeout_count = float(self.svc._stat_counters.get("navigation.semantic_timeout_count") or 0.0)
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
            if "navigation.non_cache" in self.svc._perf_stats:
                raw = self.svc._perf_stats.get("navigation.non_cache") or {}
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
            for root_key, raw in sorted(self.svc._index_state.items()):
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
        if project_id not in self.svc._projects:
            return {"success": False, "error": "工程未索引"}
        with self.svc._stats_lock:
            nav_cache_hit = float(self.svc._stat_counters.get("navigation.cache_hit") or 0.0)
            nav_cache_total = float(self.svc._stat_counters.get("navigation.cache_total") or 0.0)
            nav_cache_bypass = float(self.svc._stat_counters.get("navigation.cache_bypass_count") or 0.0)
            cache_hit_ratio = (nav_cache_hit / nav_cache_total * 100.0) if nav_cache_total else 0.0
        with self.svc._last_navigation_lock:
            last = dict(self.svc._last_navigation or {})
        definition = last.get("definition") or {}
        refs = last.get("references") or []
        return {
            "success": True,
            "project_id": project_id,
            "resolve_mode": str(last.get("resolve_mode") or ""),
            "perf_mode": str(last.get("perf_mode") or ""),
            "decision_source": str(last.get("decision_source") or ""),
            "ambiguity_count": int(last.get("ambiguity_count") or 0),
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
