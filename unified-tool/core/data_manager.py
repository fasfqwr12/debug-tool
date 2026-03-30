"""
Hybrid recovery module for ``core.data_manager``.

Recovered source:
- DataManager._parse_legacy_temperature_remark
- DataManager._resolve_session_temperature
- DataManager._resolve_session_alias
- get_data_manager

Everything else is loaded from runtime bytecode for now.
"""

from __future__ import annotations

import re

from runtime_loader import export_runtime_symbols, load_runtime_module


def _parse_legacy_temperature_remark(remark):
    text = (remark or "").strip()
    if not text:
        return None
    match = re.fullmatch(r"([+-]?\d+(?:\.\d+)?)\s*(?:℃|°C|C)?", text, re.IGNORECASE)
    if not match:
        return None
    try:
        return float(match.group(1))
    except Exception:
        return None


def _resolve_session_temperature(self, session):
    temp_val = session.test_temperature if session.test_temperature is not None else None
    legacy_temp = self._parse_legacy_temperature_remark(session.remark)
    try:
        if legacy_temp is not None and (temp_val is None or float(temp_val) == 25.0):
            return float(legacy_temp)
        if temp_val is not None:
            return float(temp_val)
        try:
            if legacy_temp is not None:
                return float(legacy_temp)
            return 25.0
        except Exception:
            return 25.0
    except Exception:
        try:
            if legacy_temp is not None:
                return float(legacy_temp)
            return 25.0
        except Exception:
            return 25.0


def _resolve_session_alias(self, session, fallback):
    alias = (session.device_alias or "").strip()
    if alias:
        return alias

    remark = (session.remark or "").strip()
    if remark:
        if self._parse_legacy_temperature_remark(remark) is None:
            return remark
    return fallback


def get_data_manager():
    return data_manager


_runtime_module = load_runtime_module(__file__, "core.data_manager")

_runtime_module.DataManager._parse_legacy_temperature_remark = staticmethod(_parse_legacy_temperature_remark)
_runtime_module.DataManager._resolve_session_temperature = _resolve_session_temperature
_runtime_module.DataManager._resolve_session_alias = _resolve_session_alias
_runtime_module.get_data_manager = get_data_manager

export_runtime_symbols(globals(), _runtime_module)

