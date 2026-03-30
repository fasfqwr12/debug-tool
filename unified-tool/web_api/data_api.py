"""
Hybrid recovery module for ``web_api.data_api``.

Recovered source (DataApiMixin helpers):
- _safe_parse_export_raw
- _export_num_or_none
- _norm_export_reflectance
- _csv_escape

Everything else is loaded from runtime bytecode for now.
"""

from __future__ import annotations

import json

from runtime_loader import export_runtime_symbols, load_runtime_module


def _safe_parse_export_raw(self, raw_value):
    if not raw_value:
        return {}
    if isinstance(raw_value, dict):
        return raw_value
    try:
        parsed = json.loads(raw_value)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _export_num_or_none(self, value):
    try:
        number = float(value)
        return number if number == number else None
    except Exception:
        return None


def _norm_export_reflectance(self, value):
    if value in (None, ""):
        return 0
    try:
        number = float(value)
        if 0 <= number <= 1:
            number *= 100
        number = int(round(number))
        if number < 0:
            return 0
        if number > 100:
            return 100
        return number
    except Exception:
        return 0


def _csv_escape(self, value):
    text = "" if value is None else str(value)
    if any(ch in text for ch in (",", '"', "\n", "\r")):
        text = '"' + text.replace('"', '""') + '"'
    return text


_runtime_module = load_runtime_module(__file__, "web_api.data_api")

_runtime_module.DataApiMixin._safe_parse_export_raw = _safe_parse_export_raw
_runtime_module.DataApiMixin._export_num_or_none = _export_num_or_none
_runtime_module.DataApiMixin._norm_export_reflectance = _norm_export_reflectance
_runtime_module.DataApiMixin._csv_escape = _csv_escape

export_runtime_symbols(globals(), _runtime_module)

