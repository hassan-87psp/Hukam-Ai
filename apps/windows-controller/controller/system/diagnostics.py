"""Owner-approved Windows capability probe without private text/screenshots.

Reports why screen / WhatsApp / browser automation may not work. No message
bodies, contact names, passwords, screenshots, cookies or clipboard data read.
"""
from __future__ import annotations

import os
from pathlib import Path
from ..system import launcher, windows
from .. import VERSION
from ..config import Config
from ..whatsapp import locator as wa_locator


def probe(cfg: Config | None = None) -> dict:
    cfg = cfg or Config.load()
    # Version and mode are operational metadata, not device credentials.
    status = {
        "controllerVersion": VERSION,
        "configuredWhatsAppMode": cfg.whatsapp_mode,
        "effectiveWhatsAppDefault": "desktop",
        "automaticWhatsAppWebFallback": False,
        "singleInstanceLockEnabled": True,
        "whatsappCapabilityEnabled": "whatsapp" in cfg.capabilities,
    }
    if launcher.SIMULATE:
        return {
            **status,
            "windowsInteractive": True, "uiautomationInstalled": True,
            "whatsappDesktopWindow": True, "whatsappProcessRunning": True,
            "whatsappWindowCount": 1, "whatsappForeground": False,
            "whatsappChromeTabDetected": False,
            "whatsappAccessibilityTreeReadable": True,
            "whatsappUnreadBadgeReadable": False,
            "whatsappUnreadFilterAccessible": True,
            "whatsappSearchControlAccessible": True,
            "whatsappDiagnosis": "Desktop window available; focus WhatsApp to inspect unread indicators",
            "chromeProfileDirectories": ["Default", "Profile 1"],
            "activeApp": "chrome.exe", "monitorCount": 2,
            "privateDataCollected": False, "simulated": True, "verified": True,
        }
    result = {
        **status,
        "windowsInteractive": windows.IS_WINDOWS,
        "uiautomationInstalled": False,
        "whatsappDesktopWindow": False,
        "whatsappProcessRunning": False,
        "whatsappWindowCount": 0,
        "whatsappForeground": False, "whatsappChromeTabDetected": False,
        "whatsappAccessibilityTreeReadable": False,
        "whatsappUnreadBadgeReadable": False,
        "whatsappUnreadFilterAccessible": False,
        "whatsappSearchControlAccessible": False,
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
        all_windows = windows.list_windows()
        whatsapp_windows = wa_locator.desktop_windows(all_windows)
        running = wa_locator.running_native_processes()
        result["whatsappChromeTabDetected"] = any(
            w.process.casefold() in ("chrome.exe", "msedge.exe")
            and "whatsapp" in w.title.casefold() for w in all_windows
        )
        result["whatsappDesktopWindow"] = bool(whatsapp_windows)
        result["whatsappWindowCount"] = len(whatsapp_windows)
        result["whatsappProcessRunning"] = bool(running) or bool(whatsapp_windows)
        result["whatsappForeground"] = bool(
            active and wa_locator.matches_desktop_window(active))
        if whatsapp_windows and result["uiautomationInstalled"]:
            try:
                import uiautomation as auto
                native = next((w for w in whatsapp_windows if active and w.hwnd == active.hwnd),
                              whatsapp_windows[0])
                root = auto.ControlFromHandle(native.hwnd)
                # Only check whether the UIA tree is usable: do NOT collect
                # child Name/Value, contact labels or message contents.
                count = 0
                for ctrl, _depth in auto.WalkControl(root, maxDepth=10):
                    count += 1
                    try:
                        # Compare only fixed UI labels; no contact, chat
                        # preview or message text leaves the controller.
                        if ctrl.IsOffscreen:
                            continue
                        name = str(ctrl.Name or "").casefold().strip()
                        role = str(ctrl.ControlTypeName or "")
                        if (name == "unread" or name.startswith("unread chats")
                                or name.startswith("unread messages")):
                            result["whatsappUnreadFilterAccessible"] = True
                        if role == "EditControl" and (
                            name in ("search", "search chats", "search or start new chat",
                                     "search chats or messages")
                            or name.startswith("search chats")):
                            result["whatsappSearchControlAccessible"] = True
                    except Exception:
                        pass
                    if count >= 350:
                        break
                result["whatsappAccessibilityTreeReadable"] = count >= 3
                if result["whatsappAccessibilityTreeReadable"]:
                    from ..whatsapp.adapter import unread_from_desktop_accessibility
                    result["whatsappUnreadBadgeReadable"] = (
                        unread_from_desktop_accessibility(native) is not None
                    )
            except Exception:
                # No private data or raw UIA exceptions in diagnostic results.
                pass
        result["whatsappDiagnosis"] = (
            "WhatsApp Desktop was found, but UIA controls are not readable. "
            "Check the installed app is unlocked, foreground and visible."
            if result["whatsappDesktopWindow"] and result["uiautomationInstalled"]
                and not result["whatsappAccessibilityTreeReadable"]
            else "Windows UI Automation is not installed in the Controller; update the Controller."
            if result["whatsappDesktopWindow"] and not result["uiautomationInstalled"]
            else "WhatsApp Desktop is foreground. Unread indicator is not exposed; "
                 "open its Unread filter or request an approved visible-sender scan."
            if result["whatsappForeground"] and not result["whatsappUnreadBadgeReadable"]
            else "WhatsApp Desktop is foreground and a readable Unread indicator is available."
            if result["whatsappForeground"] and result["whatsappUnreadBadgeReadable"]
            else "WhatsApp Desktop is foreground and visible. Try an unread check."
            if result["whatsappForeground"]
            else "WhatsApp Desktop window detected in background. Say 'WhatsApp Desktop kholo' to focus it."
            if whatsapp_windows
            else "WhatsApp process is running, but no accessible top-level window was detected. Restore the app from taskbar."
            if running
            else "WhatsApp Web/browser tab detected, but the installed Personal WhatsApp Desktop app is NOT detected. Open the real Windows application, not this Chrome tab."
            if result["whatsappChromeTabDetected"]
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
