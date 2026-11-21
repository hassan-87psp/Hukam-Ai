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
from . import locator, unread_filter

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

        # New WhatsApp versions expose the same Unread chip as a Button AND
        # its child Text, or only as an AutomationId/HelpText. Selecting the
        # single raw "Unread" label was rejecting a genuine filter as ambiguous.
        items = unread_filter.candidates(root, (left, top, right, bottom))
        candidate, reason = unread_filter.choose_unique(items)
        if candidate is None:
            message = ("Multiple separate Unread controls were detected; I will not "
                       "click a guessed position."
                       if reason == "ambiguous" else
                       "WhatsApp Desktop's Unread filter is not accessible through "
                       "Windows UI Automation on this version. No blind mouse click "
                       "was attempted.")
            raise UnreadSendersUnavailable(message)

        _assert_same_native_foreground(active.hwnd)
        # This is a REAL local Windows pointer click on a VERIFIED Unread
        # control in the visible native app, not an arbitrary remote mouse
        # coordinate. The app is already restored/focused by locator.
        try:
            candidate.control.Click(simulateMove=True)
        except TypeError:
            # Compatibility with older UI Automation wrappers.
            candidate.control.Click()
        time.sleep(0.4)
        _assert_same_native_foreground(active.hwnd)
        # React/WebView can rebuild UIA controls after selection, therefore
        # verify a NEW tree rather than trusting a stale pre-click element.
        root = auto.ControlFromHandle(active.hwnd)
        refreshed = unread_filter.candidates(root, (left, top, right, bottom))
        current, current_reason = unread_filter.choose_unique(refreshed)
        if current is None and current_reason == "ambiguous":
            raise UnreadSendersUnavailable(
                "Unread filter changed to ambiguous controls after clicking; "
                "no chat names will be reported as verified unread.")
        selected = unread_filter.state(current.control) if current else None
        if selected is False:
            raise UnreadSendersUnavailable(
                "The WhatsApp Unread filter is not selected after the mouse click. "
                "No sender names will be labelled unread.")

        rows: list[tuple[float, str]] = []
        for index, (ctrl, _depth) in enumerate(auto.WalkControl(root, maxDepth=12)):
            if index >= 1100:
                break
            if not _is_visible(ctrl):
                continue
            if str(getattr(ctrl, "ControlTypeName", "")) not in (
                    "ListItemControl", "DataItemControl", "GroupControl", "ButtonControl"):
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
        _assert_same_native_foreground(active.hwnd)
        unique = list(dict.fromkeys(v for _, v in sorted(rows, key=lambda r: r[0])))
        if not unique:
            # Could be genuinely empty, but without an exposed numeric unread
            # indicator cannot certify there are zero conversations.
            raise UnreadSendersUnavailable(
                "Unread filter opened, but WhatsApp did not expose readable chat-row titles; no names verified"
            )
        return {
            "supported": True, "senders": unique[:12],
            "visibleChatCount": len(unique[:12]), "totalUnreadChats": None,
            "visibleOnly": True, "messagesRead": False,
            "filterClickAttempted": True, "filterSelectedVerified": selected is True,
            "source": "Personal WhatsApp Desktop visible chat titles",
            "note": ("Unread filter selection was verified by Windows UIA. Only visible names were read."
                     if selected is True else
                     "Clicked Unread, but this WhatsApp version does not expose whether the filter is selected. "
                     "These are visible chat titles, NOT verified unread senders. No message text was read."),
        }
    except UnreadSendersUnavailable:
        raise
    except Exception as exc:
        raise UnreadSendersUnavailable(
            "WhatsApp Desktop accessibility controls are unavailable on this version"
        ) from exc
