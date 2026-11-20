"""WhatsApp Desktop adapter.

Unread counts are read only from explicit WhatsApp unread indicators:
the visible Unread filter via Windows UI Automation, or a numeric window
title such as "(3) WhatsApp". A plain "WhatsApp" title is NOT proof of
zero unread chats. No message bodies, screenshots, clipboard, or chat
previews are transmitted for this check.
"""
from __future__ import annotations

import re
from urllib.parse import quote

from ..system import launcher, windows

TITLE_RE = re.compile(r"^\s*\((\d{1,3})\)\s*WhatsApp\b", re.I)
DESKTOP_PROCESSES = {"whatsapp.exe", "whatsappdesktop.exe", "applicationframehost.exe", "msedgewebview2.exe"}
UNREAD_LABEL_RE = re.compile(
    r"^(?:unread(?:\s+(?:chats|messages))?\s*[:,(\-\s]*)(\d{1,3})\)?$",
    re.I,
)
UNREAD_REVERSE_RE = re.compile(r"^(\d{1,3})\s+unread(?:\s+chats)?$", re.I)


def open_whatsapp(mode: str, browser_pref: str) -> dict:
    """Prefer the installed WhatsApp app. Never silently swap to Chrome."""
    if mode == "desktop":
        try:
            before = windows.snapshot()
            launcher.open_uri("whatsapp:")
            procs = ["WhatsApp.exe", "WhatsAppDesktop.exe", "ApplicationFrameHost.exe", "msedgewebview2.exe"]
            seen = windows.wait_for_window(before, processes=procs, title_contains="WhatsApp", timeout=3)
            focused = windows.focus_by_process(procs, title_contains="WhatsApp") if seen != "unverifiable" else None
            return {
                "opened": "desktop", "messagesRead": False,
                "foreground": None if seen == "unverifiable" else focused is not None,
                "verified": None if seen == "unverifiable" else (seen is not None or focused is not None),
            }
        except (OSError, launcher.LaunchError):
            return {
                "opened": None,
                "needsChoice": True,
                "note": "WhatsApp Desktop could not be launched. Install it or say 'WhatsApp Web kholo' to use the browser.",
                "messagesRead": False,
            }
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
    if not windows.IS_WINDOWS or window.process.casefold() not in DESKTOP_PROCESSES:
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
        for index, (control, _depth) in enumerate(auto.WalkControl(root, maxDepth=12)):
            if index >= 550:
                break
            try:
                if control.IsOffscreen:
                    continue
                box = control.BoundingRectangle
                x, y = float(box.left), float(box.top)
                if not (left <= x < left + width * 0.44):
                    continue
                if not (top + 18 <= y <= top + min(260, height * 0.38)):
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
    wins = windows.list_windows()
    desktop = [w for w in wins if "whatsapp" in w.title.casefold()
               and w.process.casefold() in DESKTOP_PROCESSES]

    for w in desktop:
        count = unread_from_desktop_accessibility(w)
        if count is not None:
            return {
                "unreadChats": count,
                "source": "WhatsApp Desktop Unread filter",
                "note": "Count taken from the visible Unread badge; message contents were not read.",
                "messagesRead": False,
            }

    count = unread_from_titles([w.title for w in wins])
    if count is not None:
        return {
            "unreadChats": count,
            "source": "window title",
            "note": "Count taken from a numeric WhatsApp window title, not message contents.",
            "messagesRead": False,
        }
    if desktop or any("whatsapp" in w.title.casefold() for w in wins):
        return {
            "unreadChats": None,
            "source": "unavailable",
            "note": "WhatsApp is open but did not expose a readable Unread badge or numeric title. "
                    "The count is unknown, not zero. Keep WhatsApp Desktop visible and try again.",
            "messagesRead": False,
        }

    opened = open_whatsapp(mode, browser_pref)
    return {
        "unreadChats": None,
        "opened": opened.get("opened"),
        "note": "WhatsApp was not open, so it has been opened. Ask again after it loads.",
        "messagesRead": False,
    }


def compose(phone: str, message: str, mode: str, browser_pref: str) -> dict:
    if mode == "desktop":
        try:
            launcher.open_uri(f"whatsapp://send?phone={phone}&text={quote(message)}")
            return {"drafted": True, "sent": False, "via": "desktop"}
        except Exception:
            pass
    launcher.open_url(f"https://web.whatsapp.com/send?phone={phone}&text={quote(message)}", browser_pref)
    return {"drafted": True, "sent": False, "via": "web"}
