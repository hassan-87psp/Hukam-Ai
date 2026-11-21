"""List *visible unread conversation senders* from WhatsApp Desktop.

This action is opt-in and ALWAYS requires an owner approval. The controller
first selects the application's Unread filter and then reads only the FIRST
accessible title in each visible chat row. No preview/message body or contact
directory is scanned. If WhatsApp's accessibility tree does not expose chat
rows, return an explicit unsupported result. Never guess names or counts.

Sender names are returned to the authenticated HUKM account and thus stored
in command history. This is distinct from offline-only read_visible_aloud.
"""
from __future__ import annotations

import re
import time

from ..config import IS_WINDOWS
from ..system import launcher, windows
from . import locator

_UNREAD = re.compile(r"^unread(?:\s+(?:chats|messages))?(?:\s+\d{1,3})?$", re.I)
_SKIP = {"unread", "all", "favorites", "favourites", "groups", "search",
         "new chat", "chats", "whatsapp", "archived", "settings", "status",
         "calls", "communities", "message", "voice call"}
_TIME = re.compile(r"^\d{1,2}:\d{2}(?:\s*[ap]m)?$", re.I)


class UnreadSendersUnavailable(Exception):
    pass


def first_row_title(children: list[tuple[str, float, float]], row_top: float) -> str | None:
    """Restrict candidates to the upper portion of a known chat row."""
    candidates = []
    for raw, y, x in children:
        value = " ".join(raw.split()).strip()
        if not value or len(value) > 65:
            continue
        if not (row_top <= y <= row_top + 31):
            continue
        if value.casefold() in _SKIP or _TIME.fullmatch(value):
            continue
        if re.fullmatch(r"\d+", value):
            continue
        candidates.append((y, x, value))
    if not candidates:
        return None
    candidates.sort(key=lambda a: (a[0], a[1]))
    return candidates[0][2]


def _is_visible(control) -> bool:
    try:
        return not control.IsOffscreen
    except (AttributeError, RuntimeError, OSError):
        return False


def _bounding(control):
    box = control.BoundingRectangle
    return float(box.left), float(box.top), float(box.right), float(box.bottom)


def read_unread_senders() -> dict:
    if launcher.SIMULATE:
        return {"supported": True, "senders": ["Test Contact"],
                "visibleOnly": True, "messagesRead": False,
                "filterSelected": True, "simulated": True}

    if not IS_WINDOWS:
        raise UnreadSendersUnavailable("WhatsApp Desktop sender reading requires Windows")
    active = windows.active_window()
    if not active or not locator.matches_desktop_window(active):
        # Explicitly approved: focus a verified native WhatsApp desktop window.
        # Never pull private chat content from Chrome/Edge WhatsApp Web tabs.
        active = locator.focus_whatsapp()
        if active is None:
            from .adapter import open_whatsapp
            opened = open_whatsapp("desktop", "default")
            if opened.get("verified") is True:
                active = locator.focus_whatsapp()
        if active is None:
            raise UnreadSendersUnavailable(
                "WhatsApp Desktop window not detected or could not be focused. "
                "Open installed WhatsApp app and run HUKM diagnostics.")

    try:
        import uiautomation as auto
        root = auto.ControlFromHandle(active.hwnd)
        left, top, right, bottom = _bounding(root)
        width, height = right - left, bottom - top
        if width < 360 or height < 350:
            raise UnreadSendersUnavailable("Make WhatsApp Desktop visible and larger before checking senders")

        unread_control = None
        for index, (ctrl, _depth) in enumerate(auto.WalkControl(root, maxDepth=10)):
            if index >= 650:
                break
            if not _is_visible(ctrl):
                continue
            x, y, _, _ = _bounding(ctrl)
            if not (left <= x <= left + width * 0.46 and top + 15 <= y <= top + min(270, height * 0.42)):
                continue
            name = " ".join(str(ctrl.Name or "").split()).strip()
            if _UNREAD.fullmatch(name):
                unread_control = ctrl
                break
        if unread_control is None:
            raise UnreadSendersUnavailable("WhatsApp did not expose its Unread filter to Windows accessibility")

        unread_control.Click()
        time.sleep(0.35)

        rows: list[tuple[float, str]] = []
        for index, (ctrl, _depth) in enumerate(auto.WalkControl(root, maxDepth=12)):
            if index >= 1100:
                break
            if not _is_visible(ctrl):
                continue
            if str(getattr(ctrl, "ControlTypeName", "")) not in ("ListItemControl", "DataItemControl"):
                continue
            x, y, rx, by = _bounding(ctrl)
            if not (left + 20 <= x < left + width * 0.47 and
                    rx <= left + width * 0.55 and
                    top + 150 <= y <= bottom - 60 and
                    38 <= by - y <= 150):
                continue
            children: list[tuple[str, float, float]] = []
            for child_index, (child, _level) in enumerate(auto.WalkControl(ctrl, maxDepth=4)):
                if child_index >= 65:
                    break
                if not _is_visible(child):
                    continue
                if str(getattr(child, "ControlTypeName", "")) != "TextControl":
                    continue
                cx, cy, _, _ = _bounding(child)
                if cx < x or cx > rx:
                    continue
                title = str(child.Name or "").strip()
                if title:
                    children.append((title, cy, cx))
            name = first_row_title(children, y)
            if name:
                rows.append((y, name))
            if len(rows) >= 15:
                break
        unique = list(dict.fromkeys(v for _, v in sorted(rows, key=lambda r: r[0])))
        if not unique:
            # Could be genuinely empty, but without an exposed numeric unread
            # indicator cannot certify there are zero conversations.
            raise UnreadSendersUnavailable(
                "Unread filter opened, but WhatsApp did not expose readable chat-row titles; no names verified"
            )
        return {
            "supported": True, "senders": unique[:12],
            "visibleOnly": True, "messagesRead": False, "filterSelected": True,
            "source": "WhatsApp Desktop Unread filter (Windows accessibility, best effort)",
            "note": "Only currently visible unread chat titles were listed; message contents were not read.",
        }
    except UnreadSendersUnavailable:
        raise
    except Exception as exc:
        raise UnreadSendersUnavailable(
            "WhatsApp Desktop accessibility controls are unavailable on this version"
        ) from exc
