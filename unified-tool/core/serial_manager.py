"""
Hybrid recovery module for ``core.serial_manager``.

Recovered source:
- _is_tcp_serial_port
- _parse_tcp_serial_port

Everything else is loaded from runtime bytecode for now.
"""

from __future__ import annotations

from runtime_loader import export_runtime_symbols, load_runtime_module


def _is_tcp_serial_port(port) -> bool:
    if not port:
        return False
    return str(port).lower().startswith("tcp://")


def _parse_tcp_serial_port(port):
    if not _is_tcp_serial_port(port):
        return None
    s = str(port)[6:]
    if ":" not in s:
        return None
    host, p = s.rsplit(":", 1)
    host = host.strip()
    try:
        n = int(p.strip())
        if not host or n <= 0 or n > 65535:
            return None
        return (host, n)
    except Exception:
        return None


_runtime_module = load_runtime_module(__file__, "core.serial_manager")
_runtime_module._is_tcp_serial_port = _is_tcp_serial_port
_runtime_module._parse_tcp_serial_port = _parse_tcp_serial_port
export_runtime_symbols(globals(), _runtime_module)

