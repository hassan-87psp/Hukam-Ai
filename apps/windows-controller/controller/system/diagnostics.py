"""Owner-approved Windows capability probe without private text/screenshots.

Reports why screen / WhatsApp / browser automation may not work. No message
bodies, contact names, passwords, screenshots, cookies or clipboard data read.
"""
from __future__ import annotations

import os
from pathlib import Path
from ..system import launcher, windows


def probe() -> dict:
    if launcher.SIMULATE:
        return {
            "windowsInteractive": True, "uiautomationInstalled": True,
            "whatsappDesktopWindow": True, "chromeProfileDirectories": ["Default", "Profile 1"],
            "activeApp": "chrome.exe", "monitorCount": 2,
            "privateDataCollected": False, "simulated": True, "verified": True,
        }
    result = {
        "windowsInteractive": windows.IS_WINDOWS,
        "uiautomationInstalled": False,
        "whatsappDesktopWindow": False,
        "chromeProfileDirectories": [],
        "activeApp": None,
        "monitorCount": None,
        "privateDataCollected": False,
        "verified": True,
    }
    if not windows.IS_WINDOWS:
        return result
    try:
        import uiautomation  # noqa: F401
        result["uiautomationInstalled"] = True
    except ImportError:
        pass
    try:
        active = windows.active_window()
        result["activeApp"] = active.process if active else None
        result["whatsappDesktopWindow"] = any(
            "whatsapp" in w.title.casefold()
            for w in windows.list_windows()
            if w.process.casefold() in (
                "whatsapp.exe", "whatsappdesktop.exe",
                "msedgewebview2.exe", "applicationframehost.exe")
        )
    except Exception:
        pass
    try:
        base = os.environ.get("LOCALAPPDATA")
        if base:
            root = Path(base) / "Google" / "Chrome" / "User Data"
            result["chromeProfileDirectories"] = [
                p.name for p in root.iterdir()
                if p.is_dir() and (p.name == "Default" or
                                  p.name.startswith("Profile ") and p.name[8:].isdigit())
            ][:15] if root.is_dir() else []
    except OSError:
        pass
    try:
        import mss
        with mss.mss() as sct:
            result["monitorCount"] = max(0, len(sct.monitors) - 1)
    except Exception:
        pass
    return result
