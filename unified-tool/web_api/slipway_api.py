"""
Hybrid recovery module for ``web_api.slipway_api``.

Recovered source (SlipwayApiMixin helpers):
- _dbg
- _get_slipway_soft_limit_mm
- slipway_get_debug_log
- slipway_clear_debug_log
- slipway_save_debug_log
- _measure_int
- _copy_items_tail
- _is_simulation_mode
- _get_slipway_controller
- _get_rotary_controller
- _get_loop
- _run_async

Everything else is loaded from runtime bytecode for now.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime

from core.utils.logger import logger
from runtime_loader import export_runtime_symbols, load_runtime_module


def _dbg(self, level, msg, extra=None):
    if not self._debug_enabled:
        return None
    try:
        item = {
            "time": datetime.now().strftime("%H:%M:%S.%f")[:-3],
            "level": level,
            "msg": msg,
        }
        if extra:
            item["extra"] = extra
        self._debug_log.append(item)
        if len(self._debug_log) > self._debug_log_max:
            self._debug_log = self._debug_log[-self._debug_log_max :]
        return None
    except Exception:
        return None


def _get_slipway_soft_limit_mm(self, default):
    try:
        if hasattr(self, "tool_profile_get"):
            prof_res = self.tool_profile_get(None)
            if isinstance(prof_res, dict) and prof_res.get("success"):
                profile = prof_res.get("profile") or {}
                slipway = profile.get("slipway") or {}
                value = slipway.get("max_position_mm")
                limit = float(value)
                if limit > 0:
                    return limit
        return float(default)
    except Exception as e:
        logger.debug(f"读取滑台软限位失败，使用默认值: {e}")
        return float(default)


def slipway_get_debug_log(self, limit=None):
    try:
        n = int(limit) if limit is not None else 500
        n = max(1, min(5000, n))
    except Exception:
        n = 500
    return {"success": True, "items": self._debug_log[-n:] if self._debug_log else []}


def slipway_clear_debug_log(self):
    try:
        self._debug_log = []
        return {"success": True}
    except Exception:
        return {"success": True}


def slipway_save_debug_log(self):
    try:
        base_dir = os.path.join(os.path.dirname(__file__), "..", "data", "exports")
        base_dir = os.path.abspath(base_dir)
        os.makedirs(base_dir, exist_ok=True)

        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        path_jsonl = os.path.join(base_dir, f"slipway_test_debug_{ts}.jsonl")
        path_log = os.path.join(base_dir, f"slipway_test_debug_{ts}.log")
        items = self._debug_log or []

        with open(path_jsonl, "w", encoding="utf-8") as f:
            for it in items:
                f.write(json.dumps(it, ensure_ascii=False) + "\n")

        with open(path_log, "w", encoding="utf-8") as f:
            for it in items:
                t = it.get("time", "")
                lvl = it.get("level", "")
                msg = it.get("msg", "")
                extra = it.get("extra", None)
                if extra is None:
                    f.write(f"{t} | {lvl:<5} | {msg}\n")
                    continue
                try:
                    extra_str = json.dumps(extra, ensure_ascii=False)
                except Exception:
                    extra_str = str(extra)
                f.write(f"{t} | {lvl:<5} | {msg} | {extra_str}\n")

        return {
            "success": True,
            "path": path_log,
            "path_log": path_log,
            "path_jsonl": path_jsonl,
            "count": len(items),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def _measure_int(value, default):
    try:
        return int(value)
    except Exception:
        return default


def _copy_items_tail(self, items, limit):
    if not items:
        return []
    seq = items
    if limit is not None:
        try:
            n = max(int(limit), 0)
        except Exception:
            n = 0
        if n == 0:
            seq = []
        elif len(seq) > n:
            seq = seq[-n:]

    copied = []
    for item in seq:
        if isinstance(item, dict):
            copied.append(item.copy())
        else:
            copied.append(item)
    return copied


def _is_simulation_mode(self):
    try:
        if getattr(_runtime_module, "HAS_SIMULATION", False):
            sm = _runtime_module.get_simulation_manager()
            return sm.enabled
        return False
    except Exception:
        sm = _runtime_module.SimulationManager()
        return sm.enabled


def _get_slipway_controller(self):
    try:
        from core.device_hub import get_device_hub

        hub = get_device_hub()
        ctrl = getattr(hub, "slipway", None)
        if ctrl and getattr(ctrl, "is_connected", False):
            self._install_tool_event_bridge(ctrl)
            return ctrl
        if self._slipway and getattr(self._slipway, "is_connected", False):
            self._install_tool_event_bridge(self._slipway)
            return self._slipway
        return None
    except Exception:
        if self._slipway and getattr(self._slipway, "is_connected", False):
            self._install_tool_event_bridge(self._slipway)
            return self._slipway
        return None


def _get_rotary_controller(self):
    try:
        from core.device_hub import get_device_hub

        hub = get_device_hub()
        ctrl = getattr(hub, "rotary", None)
        if ctrl and getattr(ctrl, "is_connected", False):
            self._install_tool_event_bridge(ctrl)
            return ctrl
        if self._rotary and getattr(self._rotary, "is_connected", False):
            self._install_tool_event_bridge(self._rotary)
            return self._rotary
        return None
    except Exception:
        if self._rotary and getattr(self._rotary, "is_connected", False):
            self._install_tool_event_bridge(self._rotary)
            return self._rotary
        return None


def _get_loop(self):
    if self._loop is None or self._loop.is_closed():
        try:
            self._loop = asyncio.get_event_loop()
            return self._loop
        except RuntimeError:
            self._loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._loop)
            return self._loop
    return self._loop


def _run_async(self, coro, timeout):
    loop = self._get_loop()
    if loop.is_running():
        future = asyncio.run_coroutine_threadsafe(coro, loop)
        try:
            return future.result(timeout=timeout)
        except TimeoutError:
            future.cancel()
            logger.error(f"[_run_async] 协程执行超时 ({timeout}秒)")
            raise
    else:
        async def with_timeout():
            return await asyncio.wait_for(coro, timeout=timeout)

        try:
            return loop.run_until_complete(with_timeout())
        except asyncio.TimeoutError:
            logger.error(f"[_run_async] 协程执行超时 ({timeout}秒)")
            raise TimeoutError(f"协程执行超时 ({timeout}秒)")


def _ui_notify(self, level, message, topic, extra=None):
    try:
        from ws_bus import ws_broadcast

        payload = {
            "level": str(level or "info"),
            "message": str(message or ""),
            "time": time.strftime("%H:%M:%S"),
        }
        payload.update(extra or {})
        ws_broadcast(str(topic or "ui_notify"), payload)
    except Exception:
        return None


def _build_test_progress_state(self, mode, resume_from, params=None, segments=None, error=None):
    progress = {
        "mode": mode,
        "resume_from": max(int(resume_from or 0), 0),
        "result_count": len(self._test_results),
    }
    if params is not None:
        progress["params"] = params
    if segments is not None:
        progress["segments"] = segments

    result_tail = self._copy_items_tail(self._test_results, self.TEST_PROGRESS_RESULTS_LIMIT)
    if result_tail:
        progress["results"] = result_tail
        progress["last_result"] = result_tail[-1]
    if error:
        progress["error"] = error
    return progress


def _build_test_complete_payload(self, stats, session_id, is_resume):
    payload = {
        "stats": stats,
        "session_id": session_id,
        "failed_points": self._copy_items_tail(self._failed_points, self.TEST_FAILED_POINTS_LIMIT),
        "result_count": len(self._test_results),
    }
    if self._test_results:
        last_result = self._test_results[-1]
        payload["last_result"] = last_result.copy() if isinstance(last_result, dict) else last_result
    if is_resume:
        payload["is_resume"] = True
    return payload


def _trim_post_test_cache(self):
    try:
        if len(self._test_results) > self.TEST_POSTRUN_RESULTS_LIMIT:
            trimmed = len(self._test_results) - self.TEST_POSTRUN_RESULTS_LIMIT
            self._test_results = self._test_results[-self.TEST_POSTRUN_RESULTS_LIMIT :]
            logger.info(f"[Memory] 滑台结果缓存已裁剪，释放 {trimmed} 条，保留 {len(self._test_results)} 条")

        if len(self._failed_points) > self.TEST_FAILED_POINTS_LIMIT:
            trimmed_failed = len(self._failed_points) - self.TEST_FAILED_POINTS_LIMIT
            self._failed_points = self._failed_points[-self.TEST_FAILED_POINTS_LIMIT :]
            logger.info(f"[Memory] 失败点缓存已裁剪，释放 {trimmed_failed} 条，保留 {len(self._failed_points)} 条")
    except Exception as e:
        logger.debug(f"[Memory] 裁剪滑台测试缓存失败: {e}")


_runtime_module = load_runtime_module(__file__, "web_api.slipway_api")

_runtime_module.SlipwayApiMixin._dbg = _dbg
_runtime_module.SlipwayApiMixin._get_slipway_soft_limit_mm = _get_slipway_soft_limit_mm
_runtime_module.SlipwayApiMixin.slipway_get_debug_log = slipway_get_debug_log
_runtime_module.SlipwayApiMixin.slipway_clear_debug_log = slipway_clear_debug_log
_runtime_module.SlipwayApiMixin.slipway_save_debug_log = slipway_save_debug_log
_runtime_module.SlipwayApiMixin._measure_int = staticmethod(_measure_int)
_runtime_module.SlipwayApiMixin._copy_items_tail = _copy_items_tail
_runtime_module.SlipwayApiMixin._is_simulation_mode = _is_simulation_mode
_runtime_module.SlipwayApiMixin._get_slipway_controller = _get_slipway_controller
_runtime_module.SlipwayApiMixin._get_rotary_controller = _get_rotary_controller
_runtime_module.SlipwayApiMixin._get_loop = _get_loop
_runtime_module.SlipwayApiMixin._run_async = _run_async
_runtime_module.SlipwayApiMixin._ui_notify = _ui_notify
_runtime_module.SlipwayApiMixin._build_test_progress_state = _build_test_progress_state
_runtime_module.SlipwayApiMixin._build_test_complete_payload = _build_test_complete_payload
_runtime_module.SlipwayApiMixin._trim_post_test_cache = _trim_post_test_cache

export_runtime_symbols(globals(), _runtime_module)
