"""
应用层
提供应用主类和主窗口
"""

from .application import Application
from .welcome_page import WelcomePage
from .themes import ThemeManager

try:
    from .main_window import MainWindow
except Exception:
    from .main_window_new import MainWindow

__all__ = ["Application", "MainWindow", "WelcomePage", "ThemeManager"]
