"""
Clean recovery draft for `app/themes.py`.
"""

from __future__ import annotations


THEMES = {
    "dark": {
        "name": "深色",
        "is_dark": True,
        "bg": "#0a0a0a",
        "bg2": "#1e1e1e",
        "bg3": "#252525",
        "bg_gradient": "qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 #0a0a0a, stop:0.5 #1a1a2e, stop:1 #0a0a0a)",
        "text": "#e0e0e0",
        "text2": "#888888",
        "text3": "#555555",
        "accent": "#00ff9d",
        "accent_dark": "#00cc7d",
        "accent_light": "#00ff9d40",
        "glow": "#00ff9d",
        "border": "#333333",
        "border_hover": "#00ff9d",
        "success": "#00ff9d",
        "warning": "#f97316",
        "danger": "#ff0055",
        "info": "#00d4ff",
        "card_shadow": "rgba(0, 255, 157, 0.15)",
    },
    "light": {
        "name": "浅色",
        "is_dark": False,
        "bg": "#f5f7fa",
        "bg2": "#ffffff",
        "bg3": "#f0f2f5",
        "bg_gradient": "qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 #f5f7fa, stop:0.5 #e8f4f0, stop:1 #f5f7fa)",
        "text": "#1a1a1a",
        "text2": "#666666",
        "text3": "#999999",
        "accent": "#10b981",
        "accent_dark": "#059669",
        "accent_light": "#10b98130",
        "glow": "#10b981",
        "border": "#e0e0e0",
        "border_hover": "#10b981",
        "success": "#10b981",
        "warning": "#f59e0b",
        "danger": "#ef4444",
        "info": "#3b82f6",
        "card_shadow": "rgba(16, 185, 129, 0.12)",
    },
}


class ThemeManager:
    _current = "dark"

    @classmethod
    def set_theme(cls, theme_name: str):
        if theme_name in THEMES:
            cls._current = theme_name

    @classmethod
    def get_theme(cls, name: str = None) -> dict:
        return THEMES.get(name or cls._current, THEMES["dark"])
