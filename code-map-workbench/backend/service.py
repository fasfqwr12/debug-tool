from __future__ import annotations

import re
import threading
import json
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
            for line_no, line in zip(range(fn["start_line"], fn["end_line"] + 1), fn["source"].splitlines()):
                for callee in CALL_RE.findall(line):
                    if callee in {"if", "for", "while", "switch", "return", "sizeof"}:
                        continue
                    target = (fn_by_name.get(callee) or [None])[0]
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

        kind_order = {"function": 0, "file": 1, "macro": 2, "struct": 3, "typedef": 4, "definition": 5, "declaration": 6, "symbol": 9}
        results.sort(key=lambda item: (kind_order.get(item["kind"], 9), item["path"], item["line"], item["label"]))
        return {"success": True, "results": results[:limit]}

    def search(self, project_id: str, keyword: str, limit: int = 80) -> Dict:
        index = self._projects[project_id]
        text = (keyword or "").strip().lower()
        if not text:
            return {"success": True, "results": []}
        results: List[Dict] = []
        for file_item in index["files"]:
            hay = file_item["path"].lower()
            if text in hay:
                results.append({"kind": "file", "id": file_item["id"], "label": file_item["path"].split("/")[-1], "path": file_item["path"], "line": 1})
        for fn in index["functions"]:
            hay = f"{fn['name']} {fn.get('signature','')} {fn['path']}".lower()
            if text in hay:
                results.append({"kind": "function", "id": fn["id"], "label": fn["name"], "path": fn["path"], "line": fn["start_line"]})
        results.sort(key=lambda item: (item["kind"], item["path"], item["line"], item["label"]))
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
                rows.append({"function_id": fn["id"], "name": fn["name"], "path": fn["path"], "line": call["callsite_line"], "signature": fn["signature"]})
            return {"success": True, "calls": rows}
        relevant = [c for c in index["calls"] if c["caller_id"] == function_id]
        rows = []
        for call in relevant:
            fn = by_id.get(call["callee_id"])
            if not fn:
                continue
            rows.append({"function_id": fn["id"], "name": fn["name"], "path": fn["path"], "line": call["callsite_line"], "signature": fn["signature"]})
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
        functions: List[Dict] = []
        i = 0
        while i < len(lines):
            line = lines[i]
            if "(" not in line or ")" not in line:
                i += 1
                continue
            header = line.strip()
            if header.startswith(("if", "for", "while", "switch")):
                i += 1
                continue
            if "{" not in header:
                merged = [header]
                j = i + 1
                while j < len(lines) and "{" not in lines[j]:
                    merged.append(lines[j].strip())
                    if ";" in lines[j]:
                        break
                    j += 1
                if j >= len(lines):
                    i += 1
                    continue
                merged.append(lines[j].strip())
                header = " ".join(merged)
            m = re.search(r"([A-Za-z_]\w*)\s*\(([^;{}]*)\)\s*\{", header)
            if not m:
                i += 1
                continue
            name = m.group(1)
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
        if re.search(rf"\btypedef\b.*\b{escaped}\b", clean):
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
        if self._looks_like_definition(clean, name):
            return ("definition", idx, idx)
        if re.search(rf"\b{escaped}\b", clean):
            return ("symbol", max(0, idx - 1), min(len(lines) - 1, idx + 1))
        return None

    def _looks_like_definition(self, text: str, name: str) -> bool:
        cleaned = re.sub(r"/\*.*?\*/", " ", text)
        cleaned = re.sub(r"//.*$", "", cleaned)
        if "extern" in cleaned:
            return False
        if re.search(rf"[.&>-]\s*{re.escape(name)}\b", cleaned):
            return False
        return bool(re.search(rf"\b{re.escape(name)}\b\s*(?:\[[^\]]*\])?\s*(?:=\s*.*)?;", cleaned))

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

    def _find_function_context(self, project_id: str, path: str, line_no: int) -> Dict:
        index = self._projects[project_id]
        matched = [fn for fn in index["functions"] if fn["path"] == path and fn["start_line"] <= line_no <= fn["end_line"]]
        if not matched:
            return {}
        matched.sort(key=lambda fn: (fn["end_line"] - fn["start_line"], fn["start_line"]))
        fn = matched[0]
        return {"id": fn["id"], "name": fn["name"]}

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
