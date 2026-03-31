from __future__ import annotations

import re
import threading
import json
import shlex
import shutil
import subprocess
import urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Optional


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

    def set_window(self, window) -> None:
        self.window = window

    def scan_project(self, root: str) -> Dict:
        project_root = Path(root).resolve()
        if not project_root.exists():
            return {"success": False, "error": f"目录不存在: {project_root}"}

        files = self._collect_files(project_root)
        file_records: List[Dict] = []
        function_records: List[Dict] = []

        for path in files:
            rel = path.relative_to(project_root).as_posix()
            file_id = f"file:{rel}"
            text = path.read_text(encoding="utf-8", errors="ignore")
            file_records.append({
                "id": file_id,
                "path": rel,
                "abs_path": str(path),
                "line_count": len(text.splitlines()),
            })
            function_records.extend(self._parse_functions(rel, file_id, str(path), text))

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
            },
            "files": file_records,
            "functions": function_records,
            "calls": calls,
        }
        with self._lock:
            self._projects[project_id] = index
        self._remember_project(index["project"])
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
        index = self._projects[project_id]
        text = (keyword or "").strip().lower()
        if not text:
            return {"success": True, "results": []}
        results: List[Dict] = []
        seen = set()

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

        for file_item in index["files"]:
            source = self.get_file_source(project_id, file_item["id"])
            for idx, line in enumerate(source["lines"]):
                line_text = line["text"]
                if text not in line_text.lower():
                    continue
                raw_key = ("text", file_item["id"], line["line_number"])
                if raw_key not in seen:
                    seen.add(raw_key)
                    snippet = (line_text or "").strip()
                    if len(snippet) > 120:
                        snippet = snippet[:117] + "..."
                    results.append({
                        "kind": "text",
                        "id": f"{file_item['id']}:{line['line_number']}",
                        "label": snippet or (keyword or "").strip(),
                        "path": source["path"],
                        "line": line["line_number"],
                    })
                for token in re.findall(r"\b[A-Za-z_]\w*\b", line_text):
                    if text not in token.lower():
                        continue
                    match = self._match_symbol(source["lines"], idx, token)
                    kind = match[0] if match else "symbol"
                    key = (kind, token, file_item["id"], line["line_number"])
                    if key in seen:
                        continue
                    seen.add(key)
                    results.append({"kind": kind, "id": token, "label": token, "path": source["path"], "line": line["line_number"]})

        kind_order = {"function": 0, "file": 1, "macro": 2, "struct": 3, "typedef": 4, "definition": 5, "declaration": 6, "text": 8, "symbol": 9}
        noisy_path_tokens = ("example", "demo", "sample", "test", "archive", "legacy", "backup")

        def _path_penalty(path: str) -> int:
            low = (path or "").lower()
            return 1 if any(token in low for token in noisy_path_tokens) else 0

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
        return {"success": True, "results": results[:limit]}

    def list_files(self, project_id: str) -> Dict:
        index = self._projects[project_id]
        files = []
        for item in sorted(index["files"], key=lambda x: x["path"]):
            files.append({
                **item,
                "function_count": sum(1 for fn in index["functions"] if fn["file_id"] == item["id"]),
            })
        return {"success": True, "files": files}

    def get_file(self, project_id: str, file_id: str) -> Dict:
        index = self._projects[project_id]
        file_item = next(item for item in index["files"] if item["id"] == file_id)
        functions = [self._summarize_function(fn) for fn in index["functions"] if fn["file_id"] == file_id]
        functions.sort(key=lambda item: item["start_line"])
        return {"success": True, "file": {**file_item, "functions": functions}}

    def get_file_source(self, project_id: str, file_id: str) -> Dict:
        index = self._projects[project_id]
        file_item = next(item for item in index["files"] if item["id"] == file_id)
        text = Path(file_item["abs_path"]).read_text(encoding="utf-8", errors="ignore")
        lines = text.splitlines()
        return {
            "success": True,
            "file_id": file_id,
            "path": file_item["path"],
            "abs_path": file_item["abs_path"],
            "source": text,
            "lines": [{"line_number": i + 1, "text": line} for i, line in enumerate(lines)],
        }

    def save_file_source(self, project_id: str, file_id: str, content: str) -> Dict:
        index = self._projects[project_id]
        file_item = next(item for item in index["files"] if item["id"] == file_id)
        path = Path(file_item["abs_path"])
        path.write_text(content or "", encoding="utf-8", newline="\n")
        return {"success": True, "file_id": file_id, "path": file_item["path"], "line_count": len((content or "").splitlines())}

    def get_function(self, project_id: str, function_id: str) -> Dict:
        index = self._projects[project_id]
        fn = next(item for item in index["functions"] if item["id"] == function_id)
        return {"success": True, "function": self._summarize_function(fn)}

    def get_function_source(self, project_id: str, function_id: str) -> Dict:
        index = self._projects[project_id]
        fn = next(item for item in index["functions"] if item["id"] == function_id)
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
        index = self._projects[project_id]
        by_id = {fn["id"]: fn for fn in index["functions"]}
        if direction == "in":
            relevant = [c for c in index["calls"] if c["callee_id"] == function_id]
            rows = []
            for call in relevant:
                fn = by_id.get(call["caller_id"])
                if not fn:
                    continue
                rows.append({"function_id": fn["id"], "name": fn["name"], "path": fn["path"], "line": call["callsite_line"], "def_line": fn["start_line"], "signature": fn["signature"]})
            return {"success": True, "calls": rows}
        relevant = [c for c in index["calls"] if c["caller_id"] == function_id]
        rows = []
        for call in relevant:
            fn = by_id.get(call["callee_id"])
            if not fn:
                continue
            rows.append({"function_id": fn["id"], "name": fn["name"], "path": fn["path"], "line": call["callsite_line"], "def_line": fn["start_line"], "signature": fn["signature"]})
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
    ) -> Dict:
        name = (symbol or "").strip()
        if not name:
            return {"success": False, "error": "空符号"}
        if project_id not in self._projects:
            return {"success": False, "error": "工程未索引"}

        index = self._projects[project_id]
        cur_file_id = self._resolve_file_id_by_path(index, current_path)
        clangd_path = self._find_clangd_path()
        if clangd_path:
            sem = self._query_navigation_with_clangd(
                index=index,
                clangd_path=clangd_path,
                symbol=name,
                current_path=current_path,
                current_line=int(current_line or 1),
                current_column=int(current_column or 1),
                limit=limit,
            )
            if sem.get("success") and (sem.get("definition") or sem.get("references")):
                sem_def = sem.get("definition") or {}
                sem_refs = sem.get("references") or []
                if sem_def and not self._is_confident_semantic_definition(sem_def, name):
                    sem_def = {}
                if sem_def and not self._semantic_def_matches_symbol(sem_def, name):
                    sem_def = {}
                local_def = self._pick_definition(index, name, cur_file_id, current_line)
                sem_def = self._prefer_local_function_impl(sem_def, local_def, name)
                if not sem_def:
                    sem_def = local_def
                if not sem_refs:
                    sem_refs = self._collect_references(index, name, sem_def, cur_file_id, current_line, limit)
                return {
                    "success": True,
                    "engine": "clangd",
                    "message": f"语义引擎: clangd ({clangd_path})",
                    "clangd_path": clangd_path,
                    "definition": sem_def,
                    "references": sem_refs[:limit],
                }

        definition = self._pick_definition(index, name, cur_file_id, current_line)
        refs = self._collect_references(index, name, definition, cur_file_id, current_line, limit)
        fallback_msg = "clangd 未安装，当前使用增强文本引擎"
        if clangd_path:
            fallback_msg = "clangd 语义查询失败，已自动降级到增强文本引擎"
        return {
            "success": True,
            "engine": "text",
            "message": fallback_msg,
            "clangd_path": clangd_path,
            "definition": definition,
            "references": refs,
        }

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
        rows = []
        for item in target.get("files", []):
            abs_path = Path(item.get("abs_path", ""))
            ext = abs_path.suffix.lower()
            if ext not in {".c", ".cc", ".cpp", ".cxx"}:
                continue
            rows.append({
                "file": str(abs_path),
                "directory": str(project_dir.resolve()),
                "arguments": ["clang"] + base_flags + ["-c", str(abs_path)],
            })
        return rows

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
                [clangd_path, "--background-index=0", f"--compile-commands-dir={project_root}"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            if not proc.stdin:
                return {"success": False, "error": "clangd stdin 不可用"}
            proc.stdin.write(data)
            proc.stdin.close()
            out, _ = proc.communicate(timeout=20)
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
            return {"success": True, "definition": definition or {}, "references": ref_rows[:limit]}
        except Exception:
            return {"success": False, "error": "clangd 查询异常"}

    def _ensure_compile_commands(self, project_root: Path) -> tuple[bool, str]:
        cc_path = project_root / "compile_commands.json"
        if cc_path.exists() and cc_path.stat().st_size > 20:
            return True, ""
        ctx = self.get_keil_compile_context(str(project_root))
        if not ctx.get("success"):
            return False, str(ctx.get("error") or "未找到 Keil 工程参数")
        rows = ctx.get("compile_commands") or []
        if not rows:
            return False, "compile_commands 为空"
        cc_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
        return True, ""

    def _resolve_abs_path_by_rel(self, index: Dict, rel_path: str) -> Optional[Path]:
        target = (rel_path or "").replace("\\", "/")
        if not target:
            return None
        for f in index["files"]:
            if f["path"] == target:
                return Path(f["abs_path"]).resolve()
        return None

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
        s = str(abs_path).lower()
        for f in index["files"]:
            if str(Path(f["abs_path"]).resolve()).lower() == s:
                return f["path"]
        root = Path(index["project"]["root"]).resolve()
        try:
            return abs_path.resolve().relative_to(root).as_posix()
        except Exception:
            return ""

    def _read_line_text(self, abs_path: Path, line_no: int) -> str:
        try:
            lines = abs_path.read_text(encoding="utf-8", errors="ignore").splitlines()
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
        for f in index["files"]:
            if f["path"] == target:
                return f["id"]
        return ""

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

        escaped = re.escape(name)
        token_re = re.compile(rf"\b{escaped}\b")
        for f in index["files"]:
            src = Path(f["abs_path"]).read_text(encoding="utf-8", errors="ignore").splitlines()
            for i, raw in enumerate(src, start=1):
                if not token_re.search(raw):
                    continue
                lines = [{"line_number": n + 1, "text": t} for n, t in enumerate(src)]
                match = self._match_symbol(lines, i - 1, name)
                if not match:
                    continue
                kind = match[0]
                if kind not in {"macro", "struct", "typedef", "definition", "declaration"}:
                    continue
                bias = 0 if f["id"] == cur_file_id else 1
                dist = abs(int(cur_line or 0) - i) if bias == 0 and cur_line else 0
                col = raw.find(name) + 1
                candidates.append((
                    self._kind_priority(kind),
                    bias,
                    path_penalty(f["path"]),
                    dist,
                    f["path"],
                    i,
                    {"path": f["path"], "line": i, "column": max(1, col), "kind": kind, "label": name},
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
        escaped = re.escape(name)
        token_re = re.compile(rf"\b{escaped}\b")
        def_path = definition.get("path", "")
        def_line = int(definition.get("line") or 0)
        rows = []
        for f in index["files"]:
            src = Path(f["abs_path"]).read_text(encoding="utf-8", errors="ignore").splitlines()
            for i, raw in enumerate(src, start=1):
                m = token_re.search(raw)
                if not m:
                    continue
                if f["path"] == def_path and i == def_line:
                    continue
                snippet = raw.strip()
                bias = 0 if f["id"] == cur_file_id else 1
                dist = abs(int(cur_line or 0) - i) if bias == 0 and cur_line else 0
                fn = self._find_function_context_in_index(index, f["path"], i)
                rows.append({
                    "path": f["path"],
                    "line": i,
                    "column": m.start() + 1,
                    "label": name,
                    "kind": "reference",
                    "snippet": snippet[:220],
                    "function_id": fn.get("id", ""),
                    "function_name": fn.get("name", ""),
                    "_sort": (bias, dist, f["path"], i),
                })
        rows.sort(key=lambda r: r["_sort"])
        out = []
        for row in rows[:limit]:
            clean = dict(row)
            clean.pop("_sort", None)
            out.append(clean)
        return out

    def peek_symbol(self, project_id: str, symbol: str, current_file_id: Optional[str] = None, current_line: Optional[int] = None) -> Dict:
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
        target_file = next((f for f in index["files"] if f["path"] == def_path), None)
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

    def _collect_files(self, root: Path) -> List[Path]:
        exts = {".c", ".h", ".cpp", ".hpp", ".cc"}
        skip_dirs = {
            "build", "dist", ".git", "__pycache__", "node_modules", "output",
            "CMSIS", "lib", "Listings", "RTE", "analysis_reports", "project_docs",
            "project_meta", "docs", "logs", ".kiro", ".windsurf", "legacy", "public",
        }
        preferred_roots = [
            "app", "board", "boot_sdk", "calibration", "cmd", "config", "core",
            "drivers", "hal", "hw_system", "protocol", "ranging", "storage", "usb", "user",
        ]
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
        matches = []
        for file_item in ordered_files:
            source = self.get_file_source(project_id, file_item["id"])
            for idx, line in enumerate(source["lines"]):
                text = line["text"]
                if not re.search(rf"^\s*#\s*define\s+{re.escape(name)}\b", text):
                    continue
                value = self._extract_define_value([line], name)
                distance = abs(line["line_number"] - int(current_line or 0)) if current_file_id == file_item["id"] and current_line else 0
                matches.append((
                    0 if current_file_id == file_item["id"] else 1,
                    distance,
                    line["line_number"],
                    {
                        "name": name,
                        "value": value,
                        "resolved_value": value,
                        "display": f"-> {value}" if value else "",
                        "path": source["path"],
                        "line": line["line_number"],
                        "lines": [line],
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
        for file_item in self._ordered_files(index, current_file_id):
            source = self.get_file_source(project_id, file_item["id"])
            for idx, line in enumerate(source["lines"]):
                match = self._match_symbol(source["lines"], idx, target)
                if not match or match[0] not in {"struct", "typedef"}:
                    continue
                candidates.append((0 if file_item["id"] == current_file_id else 1, line["line_number"], file_item["id"], match[0], match[1], match[2]))
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
        matched = [fn for fn in index["functions"] if fn["path"] == path and fn["start_line"] <= line_no <= fn["end_line"]]
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
        for file_item in index["files"]:
            source = self.get_file_source(project_id, file_item["id"])
            for idx, line in enumerate(source["lines"]):
                text = line["text"]
                if not re.search(rf"\b{re.escape(name)}\b", text):
                    continue
                match = self._match_symbol(source["lines"], idx, name)
                if match and match[0] in {"definition", "declaration", "macro", "typedef", "struct"}:
                    continue
                is_write = bool(re.search(rf"\b{re.escape(name)}\b\s*(?:\[[^\]]+\])?\s*=(?!=)|\.\s*{re.escape(name)}\b\s*=(?!=)|->\s*{re.escape(name)}\b\s*=(?!=)", text))
                if mode == "read" and is_write:
                    continue
                if mode == "write" and not is_write:
                    continue
                fn = self._find_function_context(project_id, source["path"], line["line_number"])
                display = f"{source['path']} : {line['line_number']}"
                if fn.get("name"):
                    display = f"{display} · {fn['name']}"
                rows.append({
                    "name": display,
                    "detail": text.strip(),
                    "path": source["path"],
                    "line": line["line_number"],
                    "function_id": fn.get("id", ""),
                    "tag": self._classify_context("write" if is_write else "read", text, fn.get("name", ""), ""),
                })
        rows.sort(key=lambda item: (item["path"], item["line"]))
        return rows[:limit]

    def _find_call_usages(self, project_id: str, name: str, mode: str, limit: int = 8) -> List[Dict]:
        index = self._projects[project_id]
        symbol_pattern = re.compile(rf"(?:[&*]\s*)?\b{re.escape(name)}\b")
        init_pattern = re.compile(r"(init|default|reset|load|setup|config|set)", re.I)
        grouped: Dict[tuple, Dict] = {}
        for file_item in index["files"]:
            source = self.get_file_source(project_id, file_item["id"])
            for line in source["lines"]:
                text = line["text"]
                if not symbol_pattern.search(text):
                    continue
                calls = [x for x in CALL_RE.findall(text) if x not in {"if", "for", "while", "switch", "return", "sizeof"} and x != name]
                if not calls:
                    continue
                fn = self._find_function_context(project_id, source["path"], line["line_number"])
                for callee in calls:
                    if mode == "init" and not init_pattern.search(callee):
                        continue
                    key = (callee, fn.get("id", ""), source["path"])
                    item = grouped.setdefault(key, {
                        "name": f"{callee} · {fn.get('name', '')}".rstrip(" ·"),
                        "detail": f"{source['path']} : {line['line_number']}",
                        "path": source["path"],
                        "line": line["line_number"],
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
