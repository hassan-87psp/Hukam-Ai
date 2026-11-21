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
from . import locator, unread_filter, visual_unread

_UNREAD = re.compile(r"^unread(?:\s+(?:chats|messages))?(?:\s*[:(•\-]?\s*\d{1,3}\)?)?$", re.I)
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


def _unread_filter_selected(control) -> bool | None:
    """Try Windows UIA's actual selected/toggled state; do not infer from Click."""
    try:
        pattern = control.GetSelectionItemPattern()
        if pattern is not None:
            return bool(pattern.IsSelected)
    except Exception:
        pass
    try:
        pattern = control.GetTogglePattern()
        if pattern is not None:
            return int(pattern.ToggleState) == 1
    except Exception:
        pass
    return None


def _assert_same_native_foreground(expected_hwnd: int) -> None:
    """Fail closed if another app/window takes focus while reading sender titles."""
    current = windows.active_window()
    if not current or current.hwnd != expected_hwnd or not locator.matches_desktop_window(current):
        raise UnreadSendersUnavailable(
            "WhatsApp Desktop lost focus while checking unread senders; no contact names returned")


def read_unread_senders(cancel=None) -> dict:
    if cancel is not None and cancel.is_set():
        raise UnreadSendersUnavailable("WhatsApp unread scan cancelled")
    if launcher.SIMULATE:
        return {"supported": True, "senders": ["Test Contact"],
                "visibleOnly": True, "messagesRead": False,
                "filterSelected": True, "simulated": True}

    if not IS_WINDOWS:
        raise UnreadSendersUnavailable("WhatsApp Desktop sender reading requires Windows")
    # Always resolve the real/main native WhatsApp window, even when the
    # current foreground is a small WhatsApp helper toast or the full app is
    # minimized. The locator restores the verified chat window using Windows.
    active = locator.focus_whatsapp()
    if active is None:
        from .adapter import open_whatsapp
        opened = open_whatsapp("desktop", "default")
        if opened.get("verified") is True:
            active = locator.focus_whatsapp()
    if active is None:
        raise UnreadSendersUnavailable(
            "HUKM could not restore and focus the installed Personal WhatsApp "
            "Desktop main window. No WhatsApp Web tab was opened.")

    # WhatsApp on the owner's Windows 10 build exposes no reliable Unread
    # control through UIAutomation. Traversing its huge UIA tree delayed the
    # *visual* fallback until the relay's 30-second deadline had already
    # passed. Instead, observe the actual left chat pane locally FIRST.
    #
    # The visual scanner only clicks a unique Unread chip supported by All
    # and either Favourites or an independent Chats heading. It never uses
    # a fixed coordinate, inspects chat message bodies, or claims unread
    # names unless the result can be supported by the visible layout.
    try:
        return visual_unread.visual_scan_unread(active.hwnd, cancel=cancel)
    except visual_unread.VisualUnreadUnavailable as exc:
        raise UnreadSendersUnavailable(str(exc)) from exc
