"""Owner-approved Windows capability probe without private text/screenshots.

Reports why screen / WhatsApp / browser automation may not work. No message
bodies, contact names, passwords, screenshots, cookies or clipboard data read.
"""
from __future__ import annotations

import os
from pathlib import Path
from ..system import launcher, windows
from ..whatsapp import locator as wa_locator


def probe() -> dict:
    if launcher.SIMULATE:
        return {
            "windowsInteractive": True, "uiautomationInstalled": True,
            "whatsappDesktopWindow": True, "whatsappProcessRunning": True,
            "whatsappWindowCount": 1, "whatsappForeground": False,
            "whatsappDiagnosis": "Desktop window available; focus WhatsApp to inspect unread indicators",
            "chromeProfileDirectories": ["Default", "Profile 1"],
            "activeApp": "chrome.exe", "monitorCount": 2,
            "privateDataCollected": False, "simulated": True, "verified": True,
        }
    result = {
        "windowsInteractive": windows.IS_WINDOWS,
        "uiautomationInstalled": False,
        "whatsappDesktopWindow": False,
        "whatsappProcessRunning": False,
        "whatsappWindowCount": 0,
        "whatsappForeground": False,
        "whatsappDiagnosis": "unknown",
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
        whatsapp_windows = wa_locator.desktop_windows()
        running = wa_locator.running_native_processes()
        result["whatsappDesktopWindow"] = bool(whatsapp_windows)
        result["whatsappWindowCount"] = len(whatsapp_windows)
        result["whatsappProcessRunning"] = bool(running) or bool(whatsapp_windows)
        result["whatsappForeground"] = bool(
            active and wa_locator.matches_desktop_window(active))
        result["whatsappDiagnosis"] = (
            "WhatsApp Desktop is foreground and visible. Try an unread check."
            if result["whatsappForeground"]
            else "WhatsApp Desktop window detected in background. Say 'WhatsApp Desktop kholo' to focus it."
            if whatsapp_windows
            else "WhatsApp process is running, but no accessible top-level window was detected. Restore the app from taskbar."
            if running
            else "No installed WhatsApp Desktop window or process detected. Open the actual WhatsApp Windows app (not a Chrome tab)."
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
