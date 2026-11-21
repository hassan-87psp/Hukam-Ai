"""WhatsApp Desktop adapter.

Unread counts are read only from explicit WhatsApp unread indicators:
the visible Unread filter via Windows UI Automation, or a numeric window
title such as "(3) WhatsApp". A plain "WhatsApp" title is NOT proof of
zero unread chats. No message bodies, screenshots, clipboard, or chat
previews are transmitted for this check.
"""
from __future__ import annotations

import re
import time
from urllib.parse import quote

from ..system import launcher, windows
from . import locator

TITLE_RE = re.compile(r"^\s*\((\d{1,3})\)\s*WhatsApp\b", re.I)
DESKTOP_PROCESSES = set(locator.ALL_PROCESSES)
UNREAD_LABEL_RE = re.compile(
    r"^(?:unread(?:\s+(?:chats|messages))?\s*[:,(\-\s]*)(\d{1,3})\)?$",
    re.I,
)
UNREAD_REVERSE_RE = re.compile(r"^(\d{1,3})\s+unread(?:\s+chats)?$", re.I)


def open_whatsapp(mode: str, browser_pref: str) -> dict:
    """Prefer the installed WhatsApp app. Never silently swap to Chrome."""
    if mode == "desktop":
        if not launcher.SIMULATE:
            existing = locator.focus_whatsapp()
            if existing:
                return {"opened": "desktop", "messagesRead": False,
                        "foreground": True, "verified": True,
                        "note": "Existing Personal WhatsApp Desktop window focused."}
        try:
            launcher.open_uri("whatsapp:")
            if launcher.SIMULATE:
                return {"opened": "desktop", "messagesRead": False,
                        "foreground": None, "verified": None}
            # ShellExecute returns immediately; Windows app activation needs
            # an actual *new or existing* window before we can claim success.
            end = time.monotonic() + 5.0
            while time.monotonic() < end:
                focused = locator.focus_whatsapp()
                if focused:
                    return {"opened": "desktop", "messagesRead": False,
                            "foreground": True, "verified": True}
                time.sleep(0.25)
            visible = locator.desktop_windows()
            return {"opened": "desktop", "messagesRead": False,
                    "foreground": False, "verified": False,
                    "note": "WhatsApp launch requested, but its desktop window could not be focused. Check taskbar or Windows app installation.",
                    "windowDetected": bool(visible)}
        except (OSError, launcher.LaunchError):
            return {"opened": None, "needsChoice": True, "verified": False,
                    "note": "WhatsApp Desktop could not be launched. Open the installed WhatsApp Windows app, not WhatsApp Web.",
                    "messagesRead": False}
    if mode != "web":
        raise launcher.LaunchError("WhatsApp mode must be desktop or web")
    launcher.open_url("https://web.whatsapp.com/", browser_pref)
    return {"opened": "web", "messagesRead": False}


def unread_from_titles(titles: list[str]) -> int | None:
    """Plain WhatsApp title is unknown, not zero."""
    counts = [int(m.group(1)) for t in titles if (m := TITLE_RE.search(t))]
    return max(counts) if counts else None


def count_from_accessibility_items(items: list[tuple[str, float, float]]) -> int | None:
    """Read an explicit Unread badge, never infer from chat previews.

    Items are (accessible name, x position, y position) inside only the
    WhatsApp sidebar's top filter area. Names are not logged or returned.
    """
    for raw, _x, _y in items:
        label = " ".join(raw.split()).strip()
        match = UNREAD_LABEL_RE.fullmatch(label) or UNREAD_REVERSE_RE.fullmatch(label)
        if match:
            return int(match.group(1))
    # Some WhatsApp releases expose the tab and number as adjacent controls.
    for label, x, y in items:
        if label.strip().casefold() not in ("unread", "unread chats", "unread messages"):
            continue
        candidates = []
        for value, vx, vy in items:
            if re.fullmatch(r"\d{1,3}", value.strip()) and -10 <= vx - x <= 140 and abs(vy - y) <= 24:
                candidates.append(int(value.strip()))
        if len(candidates) == 1:
            return candidates[0]
    return None


def unread_from_desktop_accessibility(window: windows.WindowInfo) -> int | None:
    """Best effort: inspect visible top-left Unread filter of WhatsApp Desktop.

    UI Automation names can change between WhatsApp releases; absence is
    reported as unknown rather than '0'. No network transfer of UIA text.
    """
    if not windows.IS_WINDOWS or not locator.matches_desktop_window(window):
        return None
    try:
        import uiautomation as auto
        root = auto.ControlFromHandle(window.hwnd)
        rect = root.BoundingRectangle
        left, top = float(rect.left), float(rect.top)
        width, height = float(rect.width()), float(rect.height())
        if width < 280 or height < 220:
            return None
        items: list[tuple[str, float, float]] = []
        for index, (control, _depth) in enumerate(auto.WalkControl(root, maxDepth=14)):
            if index >= 900:
                break
            try:
                if control.IsOffscreen:
                    continue
                box = control.BoundingRectangle
                x, y = float(box.left), float(box.top)
                if not (left <= x < left + width * 0.53):
                    continue
                if not (top + 12 <= y <= top + min(340, height * 0.43)):
                    continue
                name = str(control.Name or "").strip()
                if 0 < len(name) <= 90:
                    items.append((name, x, y))
            except (AttributeError, TypeError, ValueError, OSError, RuntimeError):
                continue
        return count_from_accessibility_items(items)
    except Exception:
        # Unsupported accessibility tree is not evidence of zero unread chats.
        return None


def check(mode: str, browser_pref: str) -> dict:
    # Native Desktop only: a Chrome/Edge WhatsApp Web tab does not count
    # as the installed Personal WhatsApp Windows app.
    desktop = locator.desktop_windows()
    launch_result = None
    if mode == "desktop" and not desktop:
        launch_result = open_whatsapp("desktop", browser_pref)
        desktop = locator.desktop_windows()
    if desktop:
        # Bring the selected app to the foreground, since UIA labels may be
        # unavailable in an inactive or minimized UWP window.
        focused = locator.focus_whatsapp()
        ordered = [focused] if focused else []
        ordered.extend(w for w in desktop if not focused or w.hwnd != focused.hwnd)
        for w in ordered:
            count = unread_from_desktop_accessibility(w)
            if count is not None:
                return {
                    "unreadChats": count, "source": "WhatsApp Desktop Unread filter",
                    "note": "Count from a visible Unread badge. Message bodies were not accessed.",
                    "messagesRead": False,
                }
        count = unread_from_titles([w.title for w in desktop])
        if count is not None:
            return {
                "unreadChats": count, "source": "window title",
                "note": "Count from the installed WhatsApp Desktop window title; no chats were read.",
                "messagesRead": False,
            }
        return {"unreadChats": None, "source": "unavailable", "messagesRead": False,
                "windowDetected": True, "foreground": focused is not None,
                "note": "WhatsApp Desktop was detected but did not expose a readable Unread badge or numeric title. "
                        "Its count is UNKNOWN, not zero. Open the Unread filter in the Windows app."}
    running = locator.running_native_processes()
    return {"unreadChats": None, "messagesRead": False,
            "opened": launch_result.get("opened") if launch_result else None,
            "source": "not-detected", "windowDetected": False,
            "processRunning": bool(running),
            "note": "WhatsApp Desktop process is running but its app window is inaccessible. Restore it from the taskbar."
                    if running else
                    "WhatsApp Desktop is not detected. Open the installed Windows WhatsApp application (not a Chrome tab), then try again."}


def compose(phone: str, message: str, mode: str, browser_pref: str) -> dict:
    if mode == "desktop":
        try:
            launcher.open_uri(f"whatsapp://send?phone={phone}&text={quote(message)}")
            return {"drafted": True, "sent": False, "via": "desktop"}
        except Exception:
            pass
    launcher.open_url(f"https://web.whatsapp.com/send?phone={phone}&text={quote(message)}", browser_pref)
    return {"drafted": True, "sent": False, "via": "web"}
