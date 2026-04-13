from __future__ import annotations

import re
import time
from typing import Any, Dict, List


class SearchEngine:
    def __init__(self, service: Any) -> None:
        self.svc = service

    def search(self, project_id: str, keyword: str, limit: int = 80) -> Dict:
        t0 = self.svc._perf_begin()
        index = self.svc._projects[project_id]
        text = (keyword or "").strip().lower()
        if not text:
            return {"success": True, "results": []}
        cache_key = self.svc._search_cache_key(project_id, text, int(limit or 80))
        cached = self.svc._get_search_cache(cache_key)
        if cached is not None:
            self.svc._perf_end("search", t0)
            return {"success": True, "results": cached[:limit]}
        results: List[Dict] = []
        seen = set()
        limit = max(1, int(limit or 80))

        for file_item in index["files"]:
            if text in file_item["path"].lower():
                key = ("file", file_item["id"])
                if key not in seen:
                    seen.add(key)
                    results.append({
                        "kind": "file",
                        "id": file_item["id"],
                        "label": file_item["path"].split("/")[-1],
                        "path": file_item["path"],
                        "line": 1,
                    })

        for fn in index["functions"]:
            hay = f"{fn['name']} {fn.get('signature', '')} {fn['path']}".lower()
            if text in hay:
                key = ("function", fn["id"])
                if key not in seen:
                    seen.add(key)
                    results.append({
                        "kind": "function",
                        "id": fn["id"],
                        "label": fn["name"],
                        "path": fn["path"],
                        "line": fn["start_line"],
                    })

        if re.fullmatch(r"[A-Za-z_]\w*", text):
            token_rows = index.get("token_index", {}).get(text, [])
        else:
            token_rows = []

        t_idx = self.svc._perf_begin()
        _lines_cache: Dict[str, List[Dict]] = {}
        for row in token_rows:
            file_id = row.get("file_id") or ""
            line_no = int(row.get("line") or 0)
            path = row.get("path") or ""
            if not file_id or line_no <= 0:
                continue
            if file_id not in _lines_cache:
                _lines_cache[file_id] = self.svc._lines_for_file(index, file_id)
            lines = _lines_cache[file_id]
            idx = max(0, line_no - 1)
            if idx >= len(lines):
                continue
            token = row.get("token") or ""
            match = self.svc._match_symbol(lines, idx, token)
            kind = match[0] if match else "symbol"
            key = (kind, token, file_id, line_no)
            if key in seen:
                continue
            seen.add(key)
            results.append({"kind": kind, "id": token, "label": token, "path": path, "line": line_no})

        if not token_rows:
            for file_item in index["files"]:
                fid = file_item["id"]
                if fid not in _lines_cache:
                    _lines_cache[fid] = self.svc._lines_for_file(index, fid)
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
                        match = self.svc._match_symbol(lines_dicts, idx, token)
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
        self.svc._perf_end("search.index_hit", t_idx)

        need_text_scan = (not token_rows) or (not re.fullmatch(r"[A-Za-z_]\w*", text))
        if need_text_scan and len(results) < limit:
            t_scan = self.svc._perf_begin()
            lines_by_file = index.get("_lines_by_file", {})
            for file_item in index["files"]:
                file_id = file_item["id"]
                lines = lines_by_file.get(file_id)
                if lines is None:
                    _, raw_lines = self.svc._read_source_cached(file_item["abs_path"])
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
            self.svc._perf_end("search.text_scan", t_scan)

        kind_order = {
            "function": 0,
            "file": 1,
            "macro": 2,
            "struct": 3,
            "typedef": 4,
            "definition": 5,
            "declaration": 6,
            "text": 8,
            "symbol": 9,
        }
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
        self.svc._put_search_cache(cache_key, final_rows)
        self.svc._perf_end("search", t0)
        return {"success": True, "results": final_rows}
