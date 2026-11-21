"""Approval-gated Personal WhatsApp Desktop workflows.

Operate ONLY the currently foreground WhatsApp desktop conversation. Never
harvest background chats, never read contacts database, never use an unofficial
WhatsApp protocol or bypass the logged-in app.

Read: only displayed message text (max 8 items) is returned to owner's HUKM
account with explicit approval; this WILL be retained in command history.
Draft: verify the selected contact header before input and never press Send.
Attach: verify local file path, selected contact and native Open dialog; do not
send the preview. The user can still choose to send manually.

WhatsApp UIA controls change between versions; missing accessibility yields
a clear failure, never guessed action success.
"""
from __future__ import annotations

import time

from ..config import IS_WINDOWS
from ..system import launcher, windows
from .reader import visible_texts

PROCESSES = {"whatsapp.exe", "whatsappdesktop.exe", "msedgewebview2.exe", "applicationframehost.exe"}


class DesktopWhatsAppError(Exception):
    pass


def _active_root():
    if not IS_WINDOWS:
        raise DesktopWhatsAppError("Personal WhatsApp Desktop needs Windows")
    active = windows.active_window()
    if not active or active.process.casefold() not in PROCESSES or "whatsapp" not in active.title.casefold():
        raise DesktopWhatsAppError("Focus the installed WhatsApp Desktop and select the intended chat")
    import win32gui
    if not win32gui.IsWindowVisible(active.hwnd) or win32gui.IsIconic(active.hwnd):
        raise DesktopWhatsAppError("WhatsApp window is minimized or hidden")
    import uiautomation as auto
    root = auto.ControlFromHandle(active.hwnd)
    rect = root.BoundingRectangle
    left, top = float(rect.left), float(rect.top)
    width, height = float(rect.width()), float(rect.height())
    if width < 400 or height < 350:
        raise DesktopWhatsAppError("Make WhatsApp window larger and visible")
    return active, root, (left, top, width, height)


def _controls(root, max_nodes=1050):
    import uiautomation as auto
    for index, (c, _depth) in enumerate(auto.WalkControl(root, maxDepth=13)):
        if index >= max_nodes:
            break
        try:
            if c.IsOffscreen:
                continue
            name = " ".join(str(c.Name or "").strip().split())
            b = c.BoundingRectangle
            yield c, name, str(c.ControlTypeName), float(b.left), float(b.top), float(b.right), float(b.bottom)
        except (AttributeError, ValueError, OSError, RuntimeError):
            continue


def _check_selected_contact(root, rect, expected: str) -> None:
    left, top, width, height = rect
    matching = []
    for c, name, kind, x, y, _right, _bottom in _controls(root):
        if name.casefold() != expected.casefold() or kind not in (
                "TextControl", "ButtonControl", "HyperlinkControl"):
            continue
        if left + width * 0.38 <= x <= left + width * 0.88 and top <= y <= top + height * 0.19:
            matching.append(c)
    if len(matching) != 1:
        raise DesktopWhatsAppError(
            "Could not verify the exact selected WhatsApp recipient in the chat header; no action performed"
        )


def _composer(root, rect):
    left, top, width, height = rect
    matches = []
    for c, name, kind, x, y, right, _bottom in _controls(root):
        if kind not in ("EditControl", "DocumentControl"):
            continue
        if not (left + width * 0.40 <= x <= left + width * 0.95):
            continue
        if not (top + height * 0.76 <= y <= top + height * 0.99):
            continue
        if any(word in name.casefold() for word in ("search", "caption", "contact")):
            continue
        if kind == "EditControl" or "message" in name.casefold():
            matches.append(c)
    if len(matches) != 1:
        raise DesktopWhatsAppError(
            "WhatsApp message composer not uniquely accessible; no text was entered"
        )
    return matches[0]


def read_selected() -> dict:
    if launcher.SIMULATE:
        return {"visibleMessages": ["Test message only"], "messagesRead": True,
                "visibleOnly": True, "transferredToAccount": True, "simulated": True}
    try:
        _active, root, _rect = _active_root()
        messages = visible_texts(root, max_items=8)
    except DesktopWhatsAppError:
        raise
    except Exception as exc:
        raise DesktopWhatsAppError("WhatsApp Desktop accessibility text is unavailable") from exc
    if not messages:
        raise DesktopWhatsAppError("No readable messages in the selected, visible chat")
    # Whitelisted visible chat-pane text only. May include on-screen UI text;
    # do not pretend it represents the complete conversation.
    return {
        "visibleMessages": [m[:240] for m in messages[-8:]],
        "messagesRead": True, "visibleOnly": True, "transferredToAccount": True,
        "note": "Only currently visible right-side chat text was returned. It is stored in your authenticated HUKM command history.",
    }


def draft_reply(expected_contact: str, message: str) -> dict:
    if launcher.SIMULATE:
        launcher._record("whatsapp.draft_reply", "message (redacted)")
        return {"recipientVerified": True, "draftEntered": True,
                "sent": False, "verified": False, "simulated": True}
    try:
        active, root, rect = _active_root()
        _check_selected_contact(root, rect, expected_contact)
        composer = _composer(root, rect)
        # Avoid replacing an existing draft. If the app doesn't expose the
        # composer value safely, fail instead of blindly inserting text.
        try:
            value = str(composer.GetValuePattern().Value or "")
        except Exception as exc:
            raise DesktopWhatsAppError(
                "WhatsApp does not expose the editor's existing text; drafting aborted to avoid overwriting"
            ) from exc
        if value.strip():
            raise DesktopWhatsAppError("Composer already contains a draft; clear it manually before retrying")
        composer.SetFocus()
        if windows.active_window().hwnd != active.hwnd:
            raise DesktopWhatsAppError("Foreground window changed; no WhatsApp reply was typed")
        from ..browser.operator import _send_unicode
        _send_unicode(message)
        return {"recipientVerified": True, "draftEntered": True,
                "sent": False, "verified": False, "contact": expected_contact,
                "note": "Text entered in the selected WhatsApp chat. Review on laptop; it has NOT been sent."}
    except DesktopWhatsAppError:
        raise
    except Exception as exc:
        raise DesktopWhatsAppError("WhatsApp composer input failed on this Desktop version") from exc


def attach_preview(expected_contact: str, path: str) -> dict:
    if launcher.SIMULATE:
        launcher._record("whatsapp.attach_preview", "file (redacted)")
        return {"attachmentPreview": True, "sent": False, "verified": False, "simulated": True}
    try:
        import uiautomation as auto
        active, root, rect = _active_root()
        _check_selected_contact(root, rect, expected_contact)
        left, top, width, height = rect
        buttons = [
            c for c, name, kind, x, y, _rx, _by in _controls(root)
            if kind == "ButtonControl" and name.casefold() in ("attach", "attach file", "attachment")
            and x > left + width * 0.4 and y > top + height * 0.70
        ]
        if len(buttons) != 1:
            raise DesktopWhatsAppError("WhatsApp attachment button is not accessible")
        buttons[0].Click()
        time.sleep(0.2)
        root = auto.ControlFromHandle(active.hwnd)
        options = [
            c for c, name, kind, _x, _y, _r, _b in _controls(root)
            if name.casefold() in ("document", "documents")
            and kind in ("MenuItemControl", "ButtonControl", "TextControl")
        ]
        if len(options) != 1:
            raise DesktopWhatsAppError("WhatsApp's Document attachment menu is not accessible")
        options[0].Click()
        time.sleep(0.35)
        picker = auto.WindowControl(ClassName="#32770", searchDepth=2)
        if not picker.Exists(1):
            raise DesktopWhatsAppError("Windows file-picker dialog did not open")
        edit = picker.EditControl(Name="File name:", searchDepth=6)
        if not edit.Exists(1):
            edit = picker.EditControl(AutomationId="1148", searchDepth=6)
        if not edit.Exists(1):
            raise DesktopWhatsAppError("File picker filename field unavailable")
        import win32gui
        if win32gui.GetForegroundWindow() != picker.NativeWindowHandle:
            raise DesktopWhatsAppError("File picker is not the foreground dialog")
        edit.SetFocus()
        from ..browser.operator import _send_unicode, _press_key
        _send_unicode(path)
        _press_key("enter")
        # This only requests attachment preview; user must verify recipient
        # and file before pressing Send.
        return {"attachmentRequested": True, "sent": False, "verified": False,
                "contact": expected_contact, "fileName": path.rsplit("\\",1)[-1],
                "note": "Attachment selected in the native dialog; delivery was NOT verified or sent."}
    except DesktopWhatsAppError:
        raise
    except Exception as exc:
        raise DesktopWhatsAppError("WhatsApp attachment controls differ on this app version") from exc
