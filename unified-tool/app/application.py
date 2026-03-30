"""
Clean recovery draft for `app/application.py`.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Optional

from PyQt6.QtWidgets import QApplication
from qfluentwidgets import Theme, setTheme, setThemeColor

from core.connection.manager import ConnectionManager
from core.utils.config import Config
from core.utils.events import EventBus, Events
from core.utils.logger import logger
from .main_window_new import MainWindow


_RUNTIME_APP_APPLICATION = None


def _load_runtime_application_module():
    global _RUNTIME_APP_APPLICATION
    if _RUNTIME_APP_APPLICATION is not None:
        return _RUNTIME_APP_APPLICATION

    here = Path(__file__).resolve()
    candidates = [
        here.parents[1] / "runtime" / "app" / "application.pyc",  # unified-tool/runtime
        here.parents[2] / "runtime" / "app" / "application.pyc",  # legacy sibling runtime
    ]
    runtime_pyc = next((p for p in candidates if p.exists()), candidates[0])
    spec = importlib.util.spec_from_file_location("_recovered_runtime_app_application", runtime_pyc)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load runtime application module from {runtime_pyc}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _RUNTIME_APP_APPLICATION = module
    return module


class Application:
    _instance = None

    def __init__(self, qt_app: QApplication):
        super().__init__()
        Application._instance = self
        self._qt_app = qt_app
        self._main_window = None
        self._event_bus = EventBus.instance()
        self._conn_manager = ConnectionManager.instance()
        qt_app.aboutToQuit.connect(self._on_quit)

    @classmethod
    def instance(cls):
        return cls._instance

    def run(self):
        logger.info("==================================================")
        logger.info(f"启动 {Config.get('app.name')} v{Config.get('app.version')}")
        logger.info("==================================================")

        self._main_window = MainWindow()
        self._apply_theme()
        self._main_window.show()
        self._event_bus.emit(Events.APP_READY)
        logger.info("应用启动完成")

    def _apply_theme(self):
        setTheme(Theme.LIGHT)
        setThemeColor("#10b981")
        self._qt_app.setStyleSheet(self._get_light_theme())

    def _get_light_theme(self):
        return _load_runtime_application_module().Application._get_light_theme(self)

    def _get_dark_theme(self):
        return _load_runtime_application_module().Application._get_dark_theme(self)

    def _on_quit(self):
        logger.info("应用正在关闭...")
        self._event_bus.emit(Events.APP_CLOSING)
        self._conn_manager.close_all()
        Config.save()
        logger.info("应用已关闭")
