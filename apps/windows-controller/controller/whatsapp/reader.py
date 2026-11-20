"""Read aloud visible WhatsApp Desktop chat text on the laptop only.

Privacy contract:
- Requires explicit approval on the relay and an already-open WhatsApp Desktop window.
- No screenshots, clipboard access, hidden chats, contact harvesting or sending.
- Never returns message text over the network, logs it, or stores it on disk.
- Uses offline Windows SAPI to speak, not the online HUKM voice service.
- Accessibility controls differ by WhatsApp Desktop version; report unavailability.
"""
from __future__ import annotations

import logging
import re

from ..config import IS_WINDOWS
from ..system import launcher, windows

log = logging.getLogger("hukm.whatsapp.reader")

PROCESSES = {"whatsapp.exe", "whatsappdesktop.exe", "applicationframehost.exe", "msedgewebview2.exe"}
SKIP_TEXT = {
    "whatsapp", "chats", "status", "calls", "communities", "settings", "archive",
    "archived", "search", "new chat", "message", "type a message",
    "attach", "send", "emoji", "voice message", "enter a message",
}


class ReadError(Exception):
    pass


def visible_texts(root, *, max_nodes: int = 900, max_items: int = 15) -> list[str]:
    """Conservative UIA extraction from the CURRENT right-side chat pane.

    UIAutomation's control tree is supplied by WhatsApp. We deliberately skip
    left-hand chat previews and toolbar, but exact UI support varies.
    """
    try:
        import uiautomation as auto
    except ImportError as exc:
        raise ReadError("WhatsApp accessibility reader not installed") from exc

    rect = getattr(root, "BoundingRectangle", None)
    if not rect:
        raise ReadError("WhatsApp accessibility area unavailable")
    try:
        left, top = float(rect.left), float(rect.top)
        width, height = float(rect.width()), float(rect.height())
    except (AttributeError, TypeError, ValueError) as exc:
        raise ReadError("WhatsApp window dimensions unavailable") from exc
    if width < 250 or height < 200:
        raise ReadError("WhatsApp window needs to be visible and maximized")

    min_x = left + width * 0.41
    min_y = top + height * 0.12
    max_y = top + height * 0.90
    found: list[str] = []
    seen: set[str] = set()

    try:
        walk = auto.WalkControl(root, maxDepth=12)
        for count, (control, _depth) in enumerate(walk):
            if count >= max_nodes:
                break
            try:
                if control.IsOffscreen:
                    continue
                if getattr(control, "ControlTypeName", "") not in ("TextControl", "DocumentControl"):
                    continue
                bounds = control.BoundingRectangle
                if not bounds or float(bounds.left) < min_x:
                    continue
                if not (min_y <= float(bounds.top) <= max_y):
                    continue
                name = str(control.Name or "").strip()
                name = " ".join(name.split())
                if not name or len(name) > 260:
                    continue
                if name.casefold() in SKIP_TEXT or re.fullmatch(r"\d{1,2}:\d{2}(?:\s*[AP]M)?", name, re.I):
                    continue
                if name.casefold() in seen:
                    continue
                seen.add(name.casefold())
                found.append(name)
                if len(found) >= max_items:
                    break
            except (AttributeError, RuntimeError, OSError, ValueError):
                continue
    except Exception as exc:
        raise ReadError("WhatsApp accessibility tree cannot be read") from exc
    return found


def read_visible_aloud() -> dict:
    if launcher.SIMULATE:
        return {
            "supported": True, "spokenOnDevice": True,
            "visibleItems": 2, "messagesRead": True,
            "scope": "visible chat only", "textTransferred": False, "simulated": True,
        }
    if not IS_WINDOWS:
        raise ReadError("Reading visible WhatsApp chat needs a Windows laptop")

    active = windows.active_window()
    if not active or "whatsapp" not in active.title.casefold() or active.process.casefold() not in PROCESSES:
        raise ReadError("Open WhatsApp Desktop, select a chat, then click Read visible chat")

    try:
        import uiautomation as auto
        root = auto.ControlFromHandle(active.hwnd)
        texts = visible_texts(root)
    except ReadError:
        raise
    except Exception as exc:
        raise ReadError("WhatsApp Desktop accessibility not supported on this version") from exc

    if not texts:
        return {
            "supported": False,
            "spokenOnDevice": False,
            "visibleItems": 0,
            "messagesRead": False,
            "textTransferred": False,
            "note": "No readable messages in the open chat. Select a conversation and try again.",
        }

    # Offline SAPI: no personal WhatsApp text crosses the network.
    message = " . ".join(texts[-12:])[:1400]
    try:
        import win32com.client
        speaker = win32com.client.Dispatch("SAPI.SpVoice")
        voices = speaker.GetVoices()
        for i in range(voices.Count):
            v = voices.Item(i)
            if any(label in v.GetDescription().casefold() for label in ("zira", "female", "uzma")):
                speaker.Voice = v
                break
        speaker.Rate = -1
        speaker.Speak(message)
    except Exception as exc:
        log.warning("WhatsApp offline voice playback failed: %s", type(exc).__name__)
        raise ReadError("Offline Windows voice failed to read the selected chat") from exc

    return {
        "supported": True,
        "spokenOnDevice": True,
        "visibleItems": len(texts),
        "messagesRead": True,
        "scope": "visible chat only",
        "textTransferred": False,
        "note": "Visible text was spoken on your Windows laptop; no message contents were sent to HUKM.",
    }
