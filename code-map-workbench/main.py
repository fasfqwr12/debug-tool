from __future__ import annotations

import json
import mimetypes
import threading
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from backend.service import CodeMapService

try:
    import webview  # type: ignore
    HAS_WEBVIEW = True
except Exception:
    webview = None  # type: ignore
    HAS_WEBVIEW = False


mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")

ROOT = Path(__file__).resolve().parent
WEB_ROOT = ROOT / "web"
SERVICE = CodeMapService()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:
        return

    def do_GET(self) -> None:
        raw_path = self.path.split("?", 1)[0].split("#", 1)[0]
        if raw_path == "/":
            raw_path = "/index.html"
        if raw_path.startswith("/api/"):
            self.send_response(404)
            self.end_headers()
            return
        rel = urllib.parse.unquote(raw_path).lstrip("/")
        target = (WEB_ROOT / rel).resolve()
        if not str(target).startswith(str(WEB_ROOT.resolve())) or not target.exists():
            self.send_response(404)
            self.end_headers()
            return
        ctype, _ = mimetypes.guess_type(str(target))
        ctype = ctype or "application/octet-stream"
        if ctype.startswith("text/") or ctype in {"application/javascript", "application/json"}:
            ctype = f"{ctype}; charset=utf-8"
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        if self.path != "/api/call":
            self.send_response(404)
            self.end_headers()
            return
        size = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(size)
        try:
            payload = json.loads(body.decode("utf-8"))
            method = payload.get("method")
            params = payload.get("params", [])
            if not method or not hasattr(SERVICE, method):
                raise AttributeError(f"unknown method: {method}")
            result = getattr(SERVICE, method)(*params)
            data = json.dumps(result, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as exc:
            data = json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    url = f"http://127.0.0.1:{port}/"
    print(f"Code Map Workbench: {url}")
    if HAS_WEBVIEW:
        window = webview.create_window(
            title=f"Code Map Workbench :{port}",
            url=url,
            width=1440,
            height=920,
            min_size=(1100, 720),
            text_select=True,
            background_color="#0b1020",
        )
        SERVICE.set_window(window)
        try:
            webview.start(debug=False)
        finally:
            server.shutdown()
        return

    webbrowser.open(url)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
