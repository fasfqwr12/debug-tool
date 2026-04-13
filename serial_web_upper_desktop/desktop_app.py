import socket
import subprocess
import sys
import time
import webbrowser
import os
from pathlib import Path

import webview


def pick_free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def wait_http_ready(url: str, timeout_sec: float = 12.0) -> bool:
    import urllib.request

    end = time.time() + timeout_sec
    while time.time() < end:
        try:
            with urllib.request.urlopen(url, timeout=1.0) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.2)
    return False


def main():
    base = Path(__file__).resolve().parent
    port = pick_free_port()
    url = f"http://127.0.0.1:{port}/"

    if getattr(sys, "frozen", False):
        # Frozen mode: spawn self in backend-only mode.
        proc = subprocess.Popen(
            [
                sys.executable,
                "--serve",
                str(port),
            ],
            cwd=str(base),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    else:
        # Source mode: use python -m uvicorn.
        proc = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "app:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
                "--log-level",
                "warning",
            ],
            cwd=str(base),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    try:
        if not wait_http_ready(url, timeout_sec=12.0):
            proc.terminate()
            raise RuntimeError("后端服务启动失败")

        window = webview.create_window(
            "多串口并行上位机 (桌面版)",
            url=url,
            width=1360,
            height=860,
            min_size=(1100, 700),
        )

        def _on_closed():
            if proc is not None and proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=3)
                except Exception:
                    proc.kill()

        window.events.closed += _on_closed
        webview.start()

    except Exception as exc:
        if proc is not None and proc.poll() is None:
            proc.terminate()
        print(f"启动失败: {exc}")
        try:
            webbrowser.open(url)
        except Exception:
            pass


def serve_mode(port: int):
    os.environ.setdefault("PYDANTIC_DISABLE_PLUGINS", "1")
    import uvicorn
    from app import app as api_app

    uvicorn.run(api_app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--serve":
        serve_mode(int(sys.argv[2]))
    else:
        main()
