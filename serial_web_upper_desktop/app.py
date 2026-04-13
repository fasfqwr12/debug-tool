import asyncio
import csv
import io
import json
import os
import queue
import re
import sys
import threading
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import serial
os.environ.setdefault("PYDANTIC_DISABLE_PLUGINS", "1")
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from serial import SerialException
from serial.tools import list_ports

PROBE_CMD = bytes.fromhex("AA EE F0 00 00 00 00 F0 BB FF")
SUPPORTED_ENCODINGS = {"auto", "utf-8", "gbk", "ascii", "latin1"}


def parse_hex_string(text: str) -> bytes:
    cleaned = text.strip()
    if not cleaned:
        return b""

    cleaned = cleaned.replace(",", " ").replace("0x", " ").replace("0X", " ")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    parts = cleaned.split(" ") if " " in cleaned else [cleaned]

    data = bytearray()
    for part in parts:
        part = part.strip()
        if not part:
            continue
        if len(part) % 2 == 1:
            part = "0" + part
        if not re.fullmatch(r"[0-9a-fA-F]+", part):
            raise ValueError(f"非法HEX字节: {part}")
        data.extend(bytes.fromhex(part))
    return bytes(data)


def now_str() -> str:
    return datetime.now().strftime("%H:%M:%S")


def decode_hex_text(hex_text: str, encoding: str) -> tuple[str, str]:
    if not hex_text:
        return "", ""
    try:
        data = bytes.fromhex(hex_text.replace(" ", ""))
    except Exception:
        return "", "invalid_hex"

    enc = (encoding or "auto").lower()
    if enc not in SUPPORTED_ENCODINGS:
        enc = "auto"

    if enc == "auto":
        for cand in ("utf-8", "gbk", "latin1"):
            try:
                return data.decode(cand), ""
            except Exception:
                continue
        return "", "decode_failed"

    try:
        return data.decode(enc), ""
    except Exception as exc:
        return "", f"{enc}: {exc}"


@dataclass
class PortState:
    port: str
    is_open: bool = False
    has_device: bool = False
    last_rx_at: float = 0.0
    last_rx_hex: str = ""
    rx_total: int = 0
    tx_total: int = 0
    last_probe_tx: float = 0.0
    probe_waiting: bool = False
    last_error: str = ""


class ConnectReq(BaseModel):
    ports: list[str] = Field(default_factory=list)
    baud: int = 115200
    timeout: float = 0.1
    auto_reconnect: bool = True


class DisconnectReq(BaseModel):
    ports: list[str] = Field(default_factory=list)
    all: bool = False


class SendReq(BaseModel):
    hex: str
    ports: list[str] = Field(default_factory=list)
    target: str = "selected"  # selected | all


class ScanReq(BaseModel):
    ports: list[str] = Field(default_factory=list)
    wait_ms: int = 800


class ScheduleStartReq(BaseModel):
    hex: str
    interval_ms: int = 1000
    ports: list[str] = Field(default_factory=list)
    target: str = "all"  # selected | all


class AutoPickReq(BaseModel):
    baud: int = 115200
    timeout: float = 0.1
    auto_reconnect: bool = True
    wait_connect_ms: int = 1200
    scan_wait_ms: int = 800
    keep_only_devices: bool = False


class EventHub:
    def __init__(self):
        self.clients: set[WebSocket] = set()
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    def set_loop(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop

    async def register(self, ws: WebSocket):
        await ws.accept()
        self.clients.add(ws)

    def unregister(self, ws: WebSocket):
        self.clients.discard(ws)

    async def _broadcast(self, payload: dict[str, Any]):
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_text(json.dumps(payload, ensure_ascii=False))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    def publish(self, payload: dict[str, Any]):
        if not self.loop:
            return
        self.loop.call_soon_threadsafe(asyncio.create_task, self._broadcast(payload))


class SerialWorker(threading.Thread):
    def __init__(
        self,
        port: str,
        baud: int,
        timeout: float,
        auto_reconnect: bool,
        manager: "SerialManager",
    ):
        super().__init__(daemon=True)
        self.port = port
        self.baud = baud
        self.timeout = timeout
        self.auto_reconnect = auto_reconnect
        self.manager = manager

        self._stop_evt = threading.Event()
        self._write_q: queue.Queue[bytes] = queue.Queue()
        self._ser = None

    def update_settings(self, baud: int, timeout: float, auto_reconnect: bool):
        self.baud = baud
        self.timeout = timeout
        self.auto_reconnect = auto_reconnect

    def stop(self):
        self._stop_evt.set()
        self._close_safely()

    def is_open(self) -> bool:
        return bool(self._ser and self._ser.is_open)

    def send(self, data: bytes) -> bool:
        if not data:
            return False
        self._write_q.put(data)
        return True

    def _close_safely(self):
        if self._ser:
            try:
                self._ser.close()
            except Exception:
                pass
            finally:
                self._ser = None

    def _try_open(self) -> bool:
        try:
            # serial_for_url supports COMx and loop://, useful for real device + local test.
            self._ser = serial.serial_for_url(self.port, baudrate=self.baud, timeout=self.timeout)
            self.manager.on_open(self.port, f"已连接 {self.port} @ {self.baud}")
            return True
        except Exception as exc:
            self.manager.on_error(self.port, f"连接失败: {exc}")
            self._ser = None
            return False

    def _flush_writes(self):
        if not self.is_open():
            return
        while True:
            try:
                data = self._write_q.get_nowait()
            except queue.Empty:
                break
            try:
                self._ser.write(data)
                self._ser.flush()
                self.manager.on_tx(self.port, data)
            except Exception as exc:
                self.manager.on_error(self.port, f"发送异常: {exc}")
                self._close_safely()
                break

    def run(self):
        while not self._stop_evt.is_set():
            if not self.is_open():
                ok = self._try_open()
                if not ok:
                    if self.auto_reconnect and not self._stop_evt.is_set():
                        time.sleep(1.0)
                        continue
                    break

            try:
                self._flush_writes()

                if self._ser.in_waiting:
                    buf = self._ser.read(self._ser.in_waiting)
                else:
                    buf = self._ser.read(1)
                if buf:
                    self.manager.on_rx(self.port, buf)
            except (SerialException, OSError) as exc:
                self.manager.on_close(self.port, f"串口断开: {exc}")
                self._close_safely()
                if not self.auto_reconnect:
                    break
                time.sleep(0.8)
            except Exception as exc:
                self.manager.on_error(self.port, f"读取异常: {exc}")
                self._close_safely()
                if not self.auto_reconnect:
                    break
                time.sleep(0.8)

        self._close_safely()
        self.manager.on_close(self.port, "线程已停止")


class SerialManager:
    def __init__(self, hub: EventHub):
        self.hub = hub
        self.lock = threading.Lock()
        self.states: dict[str, PortState] = {}
        self.workers: dict[str, SerialWorker] = {}
        self.port_logs: dict[str, list[dict[str, Any]]] = {}
        self.max_logs_per_port = 5000

        self.scheduler_running = False
        self.scheduler_thread: Optional[threading.Thread] = None

    def _emit(self, typ: str, **data):
        payload = {"type": typ, "time": now_str(), **data}
        self.hub.publish(payload)

    def _append_port_log(
        self,
        port: str,
        event: str,
        *,
        direction: str = "",
        hex_data: str = "",
        size: int = 0,
        message: str = "",
    ):
        rec = {
            "ts": time.time(),
            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "port": port,
            "event": event,
            "direction": direction,
            "hex": hex_data,
            "size": size,
            "message": message,
            "remark": message,
        }
        logs = self.port_logs.setdefault(port, [])
        logs.append(rec)
        if len(logs) > self.max_logs_per_port:
            del logs[: len(logs) - self.max_logs_per_port]

    def _snapshot(self):
        with self.lock:
            states = [asdict(s) for s in self.states.values()]
            sched_running = self.scheduler_running
        return {"states": states, "scheduler_running": sched_running}

    def emit_snapshot(self):
        self._emit("state_snapshot", snapshot=self._snapshot())

    def log(self, msg: str):
        self._emit("log", message=msg)

    def list_ports(self) -> list[str]:
        ports = [p.device for p in list_ports.comports()]
        with self.lock:
            for p in ports:
                self.states.setdefault(p, PortState(port=p))
                self.port_logs.setdefault(p, [])
            stale = [p for p in self.states if p not in ports and p not in self.workers]
            for p in stale:
                self.states.pop(p, None)
        self.log(f"刷新串口: {', '.join(ports) if ports else '无'}")
        self.emit_snapshot()
        return ports

    def connect_ports(self, ports: list[str], baud: int, timeout: float, auto_reconnect: bool) -> list[str]:
        started = []
        with self.lock:
            for port in ports:
                st = self.states.setdefault(port, PortState(port=port))
                st.last_error = ""
                if port in self.workers:
                    self.workers[port].update_settings(baud, timeout, auto_reconnect)
                    continue
                wk = SerialWorker(port, baud, timeout, auto_reconnect, self)
                self.workers[port] = wk
                wk.start()
                started.append(port)
        for p in started:
            self.log(f"{p} 启动连接线程")
        self.emit_snapshot()
        return started

    def disconnect_ports(self, ports: list[str]):
        with self.lock:
            for port in ports:
                wk = self.workers.pop(port, None)
                if wk:
                    wk.stop()
                st = self.states.setdefault(port, PortState(port=port))
                st.is_open = False
                st.probe_waiting = False
                st.last_error = ""
        for p in ports:
            self.log(f"{p} 手动断开")
        self.emit_snapshot()

    def connected_ports(self) -> list[str]:
        with self.lock:
            return [p for p, wk in self.workers.items() if wk.is_open()]

    def send_to_ports(self, ports: list[str], data: bytes):
        with self.lock:
            for port in ports:
                wk = self.workers.get(port)
                if wk:
                    wk.send(data)

    def scan_ports(self, ports: list[str], wait_ms: int) -> dict[str, Any]:
        if not ports:
            return {"scanned": [], "found": []}

        wait_ms = max(100, int(wait_ms))
        tx_time = time.time()

        with self.lock:
            for port in ports:
                st = self.states.setdefault(port, PortState(port=port))
                st.has_device = False
                st.last_probe_tx = tx_time
                st.probe_waiting = True

        self.send_to_ports(ports, PROBE_CMD)
        self.log(f"并行扫码已发送，端口数: {len(ports)}，等待 {wait_ms}ms")

        time.sleep(wait_ms / 1000.0)

        found = []
        with self.lock:
            for p in ports:
                st = self.states.get(p)
                if not st:
                    continue
                if st.probe_waiting and st.last_probe_tx == tx_time:
                    st.probe_waiting = False
                if st.has_device:
                    found.append(p)
                    self.log(f"{p} 探测结果: 有设备")
                else:
                    self.log(f"{p} 探测结果: 无回复")

        result = {"scanned": ports, "found": found}
        self._emit("scan_result", result=result)
        self.emit_snapshot()
        return result

    def start_scheduler(self, data: bytes, interval_ms: int, ports: list[str], target: str):
        interval_ms = max(20, int(interval_ms))
        if self.scheduler_running:
            raise ValueError("定时发送已在运行")

        self.scheduler_running = True

        def loop():
            self.log(f"定时发送启动: {data.hex(' ').upper()} every {interval_ms}ms")
            while self.scheduler_running:
                if target == "selected":
                    send_ports = ports
                else:
                    send_ports = self.connected_ports()
                self.send_to_ports(send_ports, data)
                time.sleep(interval_ms / 1000.0)
            self.log("定时发送已停止")
            self.emit_snapshot()

        self.scheduler_thread = threading.Thread(target=loop, daemon=True)
        self.scheduler_thread.start()
        self.emit_snapshot()

    def stop_scheduler(self):
        self.scheduler_running = False

    def auto_pick(self, req: AutoPickReq) -> dict[str, Any]:
        ports = self.list_ports()
        if not ports:
            return {"ports": [], "found": []}

        self.connect_ports(ports, req.baud, req.timeout, req.auto_reconnect)
        self.log(f"自动筛选开始: 已尝试连接 {len(ports)} 个串口")

        time.sleep(max(100, req.wait_connect_ms) / 1000.0)
        connected = self.connected_ports()
        if not connected:
            self.log("自动筛选结束: 没有已连接串口，可能被占用或权限不足")
            return {"ports": ports, "found": []}

        result = self.scan_ports(connected, req.scan_wait_ms)
        found_set = set(result["found"])

        if req.keep_only_devices:
            to_close = [p for p in connected if p not in found_set]
            if to_close:
                self.disconnect_ports(to_close)
                self.log(f"已断开非设备端口: {', '.join(to_close)}")

        self._emit("auto_pick_result", result=result)
        self.emit_snapshot()
        return result

    def on_open(self, port: str, msg: str):
        with self.lock:
            st = self.states.setdefault(port, PortState(port=port))
            st.is_open = True
            st.last_error = ""
            self._append_port_log(port, "port_open", message=msg)
        self._emit("port_open", port=port, message=msg)
        self.emit_snapshot()

    def on_close(self, port: str, msg: str):
        with self.lock:
            st = self.states.setdefault(port, PortState(port=port))
            st.is_open = False
            self._append_port_log(port, "port_close", message=msg)
        self._emit("port_close", port=port, message=msg)
        self.emit_snapshot()

    def on_error(self, port: str, msg: str):
        with self.lock:
            st = self.states.setdefault(port, PortState(port=port))
            st.is_open = False
            st.last_error = msg
            self._append_port_log(port, "error", message=msg)
        self._emit("error", port=port, message=msg)
        self.emit_snapshot()

    def on_tx(self, port: str, data: bytes):
        hex_data = data.hex(" ").upper()
        with self.lock:
            st = self.states.setdefault(port, PortState(port=port))
            st.tx_total += len(data)
            self._append_port_log(port, "tx", direction="TX", hex_data=hex_data, size=len(data))
        self._emit("tx", port=port, hex=hex_data, size=len(data))
        self.emit_snapshot()

    def on_rx(self, port: str, data: bytes):
        hex_data = data.hex(" ").upper()
        with self.lock:
            st = self.states.setdefault(port, PortState(port=port))
            st.rx_total += len(data)
            st.last_rx_at = time.time()
            st.last_rx_hex = hex_data
            st.is_open = True
            if st.probe_waiting and st.last_probe_tx > 0 and st.last_rx_at >= st.last_probe_tx:
                st.has_device = True
                st.probe_waiting = False
            self._append_port_log(port, "rx", direction="RX", hex_data=hex_data, size=len(data))
        self._emit("rx", port=port, hex=hex_data, size=len(data))
        self.emit_snapshot()

    def get_logs(
        self,
        *,
        port: Optional[str] = None,
        view_port: Optional[str] = None,
        direction: str = "ALL",
        event: str = "ALL",
        keyword: str = "",
        start_ts: Optional[float] = None,
        end_ts: Optional[float] = None,
        limit: int = 200,
        encoding: str = "auto",
    ) -> list[dict[str, Any]]:
        lim = max(1, min(limit, 5000))
        target_port = view_port or port
        direction_u = (direction or "ALL").upper()
        event_l = (event or "ALL").lower()
        keyword_l = (keyword or "").strip().lower()

        with self.lock:
            if target_port:
                logs = list(self.port_logs.get(target_port, []))
            else:
                logs = []
                for _, recs in self.port_logs.items():
                    logs.extend(recs)
                logs.sort(key=lambda x: x.get("ts", 0.0))

        filtered = []
        for rec in logs:
            ts = float(rec.get("ts", 0.0))
            if start_ts is not None and ts < start_ts:
                continue
            if end_ts is not None and ts > end_ts:
                continue
            if direction_u in ("RX", "TX") and (rec.get("direction", "").upper() != direction_u):
                continue
            if event_l != "all" and str(rec.get("event", "")).lower() != event_l:
                continue

            row = dict(rec)
            txt, decode_err = decode_hex_text(str(row.get("hex", "")), encoding)
            row["text"] = txt
            row["decode_error"] = decode_err
            row["remark"] = row.get("message", "")

            if keyword_l:
                hay = " ".join(
                    [
                        str(row.get("port", "")),
                        str(row.get("event", "")),
                        str(row.get("direction", "")),
                        str(row.get("hex", "")),
                        str(row.get("text", "")),
                        str(row.get("message", "")),
                    ]
                ).lower()
                if keyword_l not in hay:
                    continue
            filtered.append(row)

        if len(filtered) > lim:
            filtered = filtered[-lim:]
        return filtered

    def export_logs_csv(
        self,
        *,
        port: Optional[str] = None,
        view_port: Optional[str] = None,
        direction: str = "ALL",
        event: str = "ALL",
        keyword: str = "",
        start_ts: Optional[float] = None,
        end_ts: Optional[float] = None,
        encoding: str = "auto",
    ) -> str:
        logs = self.get_logs(
            port=port,
            view_port=view_port,
            direction=direction,
            event=event,
            keyword=keyword,
            start_ts=start_ts,
            end_ts=end_ts,
            limit=5000,
            encoding=encoding,
        )
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(["time", "port", "event", "direction", "size", "hex", "text", "decode_error", "message"])
        for r in logs:
            writer.writerow(
                [
                    r.get("time", ""),
                    r.get("port", ""),
                    r.get("event", ""),
                    r.get("direction", ""),
                    r.get("size", 0),
                    r.get("hex", ""),
                    r.get("text", ""),
                    r.get("decode_error", ""),
                    r.get("message", ""),
                ]
            )
        return out.getvalue()


app = FastAPI(title="Serial Web Upper")
if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
    base_dir = Path(sys._MEIPASS)  # type: ignore[attr-defined]
else:
    base_dir = Path(__file__).resolve().parent
hub = EventHub()
manager = SerialManager(hub)

app.mount("/static", StaticFiles(directory=str(base_dir / "static")), name="static")


@app.on_event("startup")
async def on_startup():
    hub.set_loop(asyncio.get_running_loop())
    manager.log("服务启动")


@app.on_event("shutdown")
async def on_shutdown():
    manager.stop_scheduler()
    manager.disconnect_ports(list(manager.workers.keys()))


@app.get("/")
def index():
    return FileResponse(str(base_dir / "static" / "index.html"))


@app.get("/api/ports")
def api_ports():
    return {"ports": manager.list_ports()}


@app.get("/api/state")
def api_state():
    return manager._snapshot()


@app.get("/api/logs")
def api_logs(
    port: Optional[str] = Query(default=None),  # backward compatibility
    view_port: Optional[str] = Query(default=None),
    direction: str = Query(default="ALL"),
    event: str = Query(default="ALL"),
    keyword: str = Query(default=""),
    start_ts: Optional[float] = Query(default=None),
    end_ts: Optional[float] = Query(default=None),
    limit: int = Query(default=200),
    encoding: str = Query(default="auto"),
):
    target_port = view_port or port
    logs = manager.get_logs(
        view_port=target_port,
        direction=direction,
        event=event,
        keyword=keyword,
        start_ts=start_ts,
        end_ts=end_ts,
        limit=limit,
        encoding=encoding,
    )
    return {"port": target_port, "logs": logs}


@app.get("/api/logs/export")
def api_logs_export(
    port: Optional[str] = Query(default=None),  # backward compatibility
    view_port: Optional[str] = Query(default=None),
    direction: str = Query(default="ALL"),
    event: str = Query(default="ALL"),
    keyword: str = Query(default=""),
    start_ts: Optional[float] = Query(default=None),
    end_ts: Optional[float] = Query(default=None),
    encoding: str = Query(default="auto"),
):
    target_port = view_port or port
    csv_text = manager.export_logs_csv(
        view_port=target_port,
        direction=direction,
        event=event,
        keyword=keyword,
        start_ts=start_ts,
        end_ts=end_ts,
        encoding=encoding,
    )
    name = f"serial_logs_{target_port}.csv" if target_port else "serial_logs_all.csv"
    return Response(
        content=csv_text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@app.post("/api/connect")
def api_connect(req: ConnectReq):
    ports = req.ports or manager.list_ports()
    if not ports:
        return {"started": [], "message": "没有可连接串口"}
    started = manager.connect_ports(ports, req.baud, req.timeout, req.auto_reconnect)
    return {"started": started, "requested": ports}


@app.post("/api/disconnect")
def api_disconnect(req: DisconnectReq):
    ports = list(manager.workers.keys()) if req.all else req.ports
    manager.disconnect_ports(ports)
    return {"disconnected": ports}


@app.post("/api/send")
def api_send(req: SendReq):
    try:
        data = parse_hex_string(req.hex)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not data:
        raise HTTPException(status_code=400, detail="HEX为空")

    if req.target == "all":
        ports = manager.connected_ports()
    else:
        ports = req.ports

    manager.send_to_ports(ports, data)
    return {"sent_ports": ports, "hex": data.hex(" ").upper(), "size": len(data)}


@app.post("/api/scan")
def api_scan(req: ScanReq):
    ports = req.ports or manager.connected_ports()
    result = manager.scan_ports(ports, req.wait_ms)
    return result


@app.post("/api/schedule/start")
def api_schedule_start(req: ScheduleStartReq):
    try:
        data = parse_hex_string(req.hex)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not data:
        raise HTTPException(status_code=400, detail="HEX为空")

    try:
        manager.start_scheduler(data, req.interval_ms, req.ports, req.target)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {"running": True}


@app.post("/api/schedule/stop")
def api_schedule_stop():
    manager.stop_scheduler()
    return {"running": False}


@app.post("/api/auto-pick")
def api_auto_pick(req: AutoPickReq):
    result = manager.auto_pick(req)
    return result


@app.websocket("/ws/events")
async def ws_events(ws: WebSocket):
    await hub.register(ws)
    try:
        await ws.send_text(json.dumps({"type": "state_snapshot", "snapshot": manager._snapshot()}, ensure_ascii=False))
        while True:
            # Keepalive read; messages from client are optional.
            await ws.receive_text()
    except WebSocketDisconnect:
        hub.unregister(ws)
    except Exception:
        hub.unregister(ws)
