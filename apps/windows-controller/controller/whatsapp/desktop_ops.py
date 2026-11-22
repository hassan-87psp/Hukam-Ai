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
from . import locator, visual_reply

PROCESSES = {"whatsapp.exe", "whatsappdesktop.exe", "msedgewebview2.exe", "applicationframehost.exe"}
# Volatile, process-local authorization chain. No chat bodies or file data stored.
_pending_attachment: dict | None = None


class DesktopWhatsAppError(Exception):
    pass


def invalidate_attachment() -> None:
    global _pending_attachment
    _pending_attachment = None


def _check_cancel(cancel):
    if cancel is not None and cancel.is_set():
        raise DesktopWhatsAppError("WhatsApp action cancelled; no further input")


def _same_window(active, cancel=None):
    _check_cancel(cancel)
    current = windows.active_window()
    if (not current or current.hwnd != active.hwnd or current.pid != active.pid
            or not locator.matches_desktop_window(current)):
        raise DesktopWhatsAppError("WhatsApp Desktop target changed; no further input")


def _type_guarded(editor, text, check, cancel=None):
    from ..browser.operator import _send_unicode
    for character in text:
        _check_cancel(cancel)
        check()
        if (not editor.HasKeyboardFocus or editor.IsOffscreen or not editor.IsEnabled
                or getattr(editor, "IsPassword", None) is not False):
            raise DesktopWhatsAppError("WhatsApp input field focus or safety changed")
        _send_unicode(character)
    _check_cancel(cancel)


def _active_root():
    if not IS_WINDOWS:
        raise DesktopWhatsAppError("Personal WhatsApp Desktop needs Windows")
    active = windows.active_window()
    if not active or not locator.matches_desktop_window(active):
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


def _visible_contact_matches(root, rect, expected: str):
    """Find an exact title in visible LEFT chat rows, never a contact directory.

    Header names (right pane) and previews cannot be selected by mistake.
    A duplicate exact match is ambiguous and must fail closed.
    """
    left, top, width, height = rect
    exact = expected.strip().casefold()
    return [
        c for c, name, kind, x, y, right, bottom in _controls(root, max_nodes=1500)
        if name.casefold() == exact and kind in ("TextControl", "ButtonControl")
        and left + 6 <= x <= left + width * 0.48
        and right <= left + width * 0.56
        and top + height * 0.15 <= y <= top + height * 0.91
        and bottom <= top + height * 0.94
    ]


def _sidebar_search(root, rect):
    """Return one empty, visible WhatsApp in-app search field, if exposed."""
    left, top, width, height = rect
    choices = []
    for c, name, kind, x, y, right, _bottom in _controls(root, max_nodes=1150):
        if kind != "EditControl" or not (left + 4 <= x <= left + width * 0.48):
            continue
        if not (top + 10 <= y <= top + min(225, height * 0.35)):
            continue
        label = name.casefold()
        if label in ("search", "search chats", "search or start new chat",
                     "search or start a new chat", "search chats or messages",
                     "search or start chat") or label.startswith("search chats"):
            choices.append(c)
    return choices[0] if len(choices) == 1 else None


def select_chat(expected_contact: str, cancel=None) -> dict:
    """Find and select the one *exact* chat in the native WhatsApp UI.

    This is an approved local UI action. It does not send anything, read
    message contents, scrape contacts, or switch to WhatsApp Web.
    """
    invalidate_attachment()
    _check_cancel(cancel)
    searched=False
    clicked=False
    matches=[]
    if launcher.SIMULATE:
        launcher._record("whatsapp.select_chat", "contact (redacted)")
        return {"chatSelected": True, "recipientVerified": True,
                "messagesRead": False, "sent": False,
                "verified": True, "simulated": True}
    if not isinstance(expected_contact, str) or not expected_contact.strip():
        raise DesktopWhatsAppError("An exact WhatsApp contact name is required")
    try:
        import uiautomation as auto
        active = windows.active_window()
        if not active or not locator.matches_desktop_window(active):
            if locator.focus_whatsapp() is None:
                raise DesktopWhatsAppError(
                    "Personal WhatsApp Desktop is not foreground; open the installed app")
        active, root, rect = _active_root()
        matches = _visible_contact_matches(root, rect, expected_contact)
        searched = False
        if not matches:
            editor = _sidebar_search(root, rect)
            if editor is None:
                raise DesktopWhatsAppError(
                    "Contact is not visible and WhatsApp's in-app Search is not accessible. "
                    "Search for the contact manually in Desktop, then try again")
            try:
                current = str(editor.GetValuePattern().Value or "")
            except Exception as exc:
                raise DesktopWhatsAppError(
                    "WhatsApp search field contents are not safely accessible") from exc
            if current.strip():
                raise DesktopWhatsAppError(
                    "WhatsApp Search already contains text. Clear it before searching another contact")
            if cancel is not None and cancel.is_set():
                raise DesktopWhatsAppError("Chat selection cancelled before search")
            editor.SetFocus()
            if not windows.active_window() or windows.active_window().hwnd != active.hwnd:
                raise DesktopWhatsAppError("WhatsApp lost foreground before search")
            _type_guarded(editor, expected_contact, lambda: _same_window(active, cancel), cancel)
            searched = True
            end = time.monotonic() + 3.0
            while time.monotonic() < end:
                if cancel is not None and cancel.is_set():
                    raise DesktopWhatsAppError("Chat selection cancelled")
                time.sleep(0.25)
                if not windows.active_window() or windows.active_window().hwnd != active.hwnd:
                    raise DesktopWhatsAppError("WhatsApp lost foreground during search")
                root = auto.ControlFromHandle(active.hwnd)
                matches = _visible_contact_matches(root, rect, expected_contact)
                if matches:
                    break
        if len(matches) != 1:
            raise DesktopWhatsAppError(
                "WhatsApp did not expose exactly one matching chat title; no chat was selected. "
                "Check the visible results in Personal WhatsApp Desktop")
        if cancel is not None and cancel.is_set():
            raise DesktopWhatsAppError("Chat selection cancelled before clicking")
        if not windows.active_window() or windows.active_window().hwnd != active.hwnd:
            raise DesktopWhatsAppError("WhatsApp lost foreground; no chat selected")
        clicked=True
        matches[0].Click()
        # UIA may return from Click before React/WebView updates its chat header.
        for _ in range(8):
            if cancel is not None and cancel.is_set():
                raise DesktopWhatsAppError("Chat selection cancelled")
            if not windows.active_window() or windows.active_window().hwnd != active.hwnd:
                raise DesktopWhatsAppError("WhatsApp lost foreground after chat selection")
            time.sleep(0.20)
            root = auto.ControlFromHandle(active.hwnd)
            try:
                _check_selected_contact(root, rect, expected_contact)
                return {"chatSelected": True, "recipientVerified": True,
                        "selectedContact": expected_contact, "verified": True,
                        "messagesRead": False, "sent": False,
                        "searchUsed": searched,
                        "note": "Exact WhatsApp Desktop chat header matched. No message was read or sent."}
            except DesktopWhatsAppError:
                continue
        raise DesktopWhatsAppError(
            "Clicked a chat result but could not verify its exact contact header. "
            "Do not read or send until the contact is confirmed")
    except DesktopWhatsAppError as exc:
        if clicked or searched or len(matches)>1:
            raise
        try:
            return visual_reply.select_chat_visual(expected_contact,cancel)
        except visual_reply.VisualReplyUnavailable as other:
            raise DesktopWhatsAppError(str(exc)+"; local visual selection: "+str(other)) from other
    except Exception as exc:
        if clicked or searched:
            raise DesktopWhatsAppError("WhatsApp selection uncertain; inspect manually before retry") from exc
        try:
            return visual_reply.select_chat_visual(expected_contact,cancel)
        except visual_reply.VisualReplyUnavailable as other:
            raise DesktopWhatsAppError("Exact visual chat selection unavailable: "+str(other)) from other


def read_selected(expected_contact: str | None = None, cancel=None) -> dict:
    _check_cancel(cancel)
    if launcher.SIMULATE:
        return {"visibleMessages": ["Test message only"], "messagesRead": True,
                "visibleOnly": True, "transferredToAccount": True, "simulated": True}
    try:
        _active, root, rect = _active_root()
        if expected_contact:
            _check_selected_contact(root, rect, expected_contact)
        messages = visible_texts(root, max_items=8)
        # WhatsApp chats can switch while UIA walks the visible tree. Verify
        # the SAME native app/window and, for named reads, the exact contact
        # again AFTER collecting text, before returning private content.
        after, fresh_root, fresh_rect = _active_root()
        _check_cancel(cancel)
        if after.hwnd != _active.hwnd or after.pid != _active.pid:
            raise DesktopWhatsAppError(
                "WhatsApp window changed while reading. Private message text discarded")
        if expected_contact:
            _check_selected_contact(fresh_root, fresh_rect, expected_contact)
    except DesktopWhatsAppError as exc:
        if not expected_contact:
            raise
        try:
            return visual_reply.read_selected_visual(expected_contact,cancel)
        except visual_reply.VisualReplyUnavailable as other:
            raise DesktopWhatsAppError(str(exc)+"; visual read: "+str(other)) from other
    except Exception as exc:
        if not expected_contact:
            raise DesktopWhatsAppError("WhatsApp UI Automation text unavailable") from exc
        try:
            return visual_reply.read_selected_visual(expected_contact,cancel)
        except visual_reply.VisualReplyUnavailable as other:
            raise DesktopWhatsAppError("Local OCR chat read unavailable: "+str(other)) from other
    if not messages:
        if expected_contact:
            try:
                return visual_reply.read_selected_visual(expected_contact,cancel)
            except visual_reply.VisualReplyUnavailable as exc:
                raise DesktopWhatsAppError("No verified visible messages: "+str(exc)) from exc
        raise DesktopWhatsAppError("No readable messages in the selected, visible chat")
    # Whitelisted visible chat-pane text only. May include on-screen UI text;
    # do not pretend it represents the complete conversation.
    return {
        "visibleMessages": [m[:240] for m in messages[-8:]],
        "messagesRead": True, "visibleOnly": True, "transferredToAccount": True,
        "note": "Only currently visible right-side chat text was returned. It is stored in your authenticated HUKM command history.",
    }


def draft_reply(expected_contact: str, message: str, cancel=None) -> dict:
    invalidate_attachment()
    _check_cancel(cancel)
    typing_started=False
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
        _same_window(active, cancel)
        _check_selected_contact(root, rect, expected_contact)
        typing_started=True
        _type_guarded(composer, message, lambda: _same_window(active, cancel), cancel)
        after, fresh_root, fresh_rect = _active_root()
        if after.hwnd != active.hwnd or after.pid != active.pid:
            raise DesktopWhatsAppError("WhatsApp changed after typing; inspect draft manually")
        _check_selected_contact(fresh_root, fresh_rect, expected_contact)
        if str(_composer(fresh_root, fresh_rect).GetValuePattern().Value or "") != message:
            raise DesktopWhatsAppError("Entered draft did not match exact requested text. Review manually; no Send performed")
        return {"recipientVerified": True, "draftEntered": True,
                "sent": False, "verified": False, "contact": expected_contact,
                "note": "Text entered in the selected WhatsApp chat. Review on laptop; it has NOT been sent."}
    except DesktopWhatsAppError as exc:
        if typing_started:
            raise  # Potential partial input: never type the same draft again
        try:
            return visual_reply.draft_reply_visual(expected_contact,message,cancel)
        except visual_reply.VisualReplyUnavailable as other:
            raise DesktopWhatsAppError(str(exc)+"; visual draft: "+str(other)) from other
    except Exception as exc:
        if typing_started:
            raise DesktopWhatsAppError("Draft input uncertain; inspect WhatsApp before retry") from exc
        try:
            return visual_reply.draft_reply_visual(expected_contact,message,cancel)
        except visual_reply.VisualReplyUnavailable as other:
            raise DesktopWhatsAppError("UIA and visual composer unavailable: "+str(other)) from other


def _file_fingerprint(path: str, cancel=None) -> tuple[int, str]:
    """Limit approved attachment to 25MB and pin exact file bytes against swap."""
    from pathlib import Path
    import hashlib
    p = Path(path)
    if not p.is_file() or p.stat().st_size <= 0 or p.stat().st_size > 25 * 1024 * 1024:
        raise DesktopWhatsAppError("Attachment file must be 1 byte to 25 MB")
    before = p.stat()
    sha = hashlib.sha256()
    total = 0
    with p.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            _check_cancel(cancel)
            total += len(chunk)
            if total > 25 * 1024 * 1024:
                raise DesktopWhatsAppError("Attachment exceeded size limit while reading")
            sha.update(chunk)
    after = p.stat()
    if (total != before.st_size or after.st_size != before.st_size
            or after.st_mtime_ns != before.st_mtime_ns or after.st_ino != before.st_ino):
        raise DesktopWhatsAppError("Attachment changed while being checked")
    return total, sha.hexdigest()


def attach_preview(expected_contact: str, path: str, cancel=None) -> dict:
    global _pending_attachment
    # A failed new preview must not leave the previous file authorized for
    # a later Send. Invalidate old state before touching any WhatsApp controls.
    _pending_attachment = None
    _check_cancel(cancel)
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
        size_before, digest_before = _file_fingerprint(path, cancel)
        _same_window(active, cancel)
        _check_selected_contact(root, rect, expected_contact)
        buttons[0].Click()
        time.sleep(0.2)
        _same_window(active, cancel)
        root = auto.ControlFromHandle(active.hwnd)
        options = [
            c for c, name, kind, _x, _y, _r, _b in _controls(root)
            if name.casefold() in ("document", "documents")
            and kind in ("MenuItemControl", "ButtonControl", "TextControl")
        ]
        if len(options) != 1:
            raise DesktopWhatsAppError("WhatsApp's Document attachment menu is not accessible")
        _same_window(active, cancel)
        _check_selected_contact(root, rect, expected_contact)
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
        picker_hwnd = picker.NativeWindowHandle
        def verify_picker():
            _check_cancel(cancel)
            if (win32gui.GetForegroundWindow() != picker_hwnd
                    or win32gui.GetAncestor(picker_hwnd, 3) != active.hwnd):
                raise DesktopWhatsAppError("File picker is not owned by the selected WhatsApp window")
        verify_picker()
        edit.SetFocus()
        from ..browser.operator import _press_key
        _type_guarded(edit, path, verify_picker, cancel)
        if str(edit.GetValuePattern().Value or "") != path:
            raise DesktopWhatsAppError("File picker filename does not match approved path")
        verify_picker()
        _press_key("enter")
        # Require unchanged bytes from before opening the dialog.
        size, digest = _file_fingerprint(path, cancel)
        if (size, digest) != (size_before, digest_before):
            raise DesktopWhatsAppError("Attachment changed during preview; no Send authorized")
        _check_cancel(cancel)
        _pending_attachment = {"contact": expected_contact, "path": path,
            "hwnd": active.hwnd, "pid": active.pid, "sha256": digest, "size": size,
            "createdAt": time.monotonic()}
        # This only requests attachment preview; user must verify recipient
        # and file before pressing Send.
        return {"attachmentRequested": True, "sent": False, "verified": False,
                "contact": expected_contact, "fileName": path.rsplit("\\",1)[-1],
                "note": "Attachment selected in the native dialog; delivery was NOT verified or sent."}
    except DesktopWhatsAppError:
        raise
    except Exception as exc:
        raise DesktopWhatsAppError("WhatsApp attachment controls differ on this app version") from exc


def send_reviewed(expected_contact: str, expected_message: str, cancel=None) -> dict:
    """One approved WhatsApp Send attempt, guarded by exact draft and chat.

    This action is deliberately separate from draft_reply. The relay must have
    authenticated the owner and displayed the exact recipient and message in a
    dedicated approval card. Never issue Enter or a generic app-level Send.
    """
    invalidate_attachment()
    _check_cancel(cancel)
    if launcher.SIMULATE:
        launcher._record("whatsapp.send_reviewed", "recipient and text (redacted)")
        return {"sendAttempted": True, "sentUiConfirmed": True,
                "deliveryVerified": False, "verified": False, "simulated": True,
                "note": "SIMULATED Send only; no WhatsApp delivery occurred."}
    try:
        active, root, rect = _active_root()
        _check_selected_contact(root, rect, expected_contact)
        editor = _composer(root, rect)
        try:
            current = str(editor.GetValuePattern().Value or "")
        except Exception as exc:
            raise DesktopWhatsAppError(
                "Cannot read existing WhatsApp draft to compare with exact reviewed message; no Send attempted"
            ) from exc
        if current != expected_message:
            raise DesktopWhatsAppError(
                "WhatsApp draft does not exactly match approved message. Nothing was sent."
            )
        left, top, width, height = rect
        choices = [
            c for c, name, kind, x, y, right, _bottom in _controls(root)
            if kind == "ButtonControl" and name.casefold() in ("send", "send message")
            and (left + width * 0.65 <= x <= left + width)
            and (top + height * 0.70 <= y <= top + height)
        ]
        if len(choices) != 1:
            raise DesktopWhatsAppError(
                "Exactly one visible WhatsApp Send button was not found; no Send attempted"
            )
        # Double-check app focus and contact after locating the button, never
        # execute a stale UIA handle if user switches to a different chat/app.
        _same_window(active, cancel)
        fresh, fresh_root, fresh_rect = _active_root()
        if fresh.hwnd != active.hwnd or fresh.pid != active.pid:
            raise DesktopWhatsAppError("WhatsApp window changed; no Send attempted")
        _check_selected_contact(fresh_root, fresh_rect, expected_contact)
        if str(_composer(fresh_root, fresh_rect).GetValuePattern().Value or "") != expected_message:
            raise DesktopWhatsAppError("WhatsApp draft changed; no Send attempted")
        if cancel is not None and cancel.is_set():
            raise DesktopWhatsAppError("WhatsApp Send cancelled before clicking")
        _same_window(active, cancel)
        # Never auto-retry after this click: the message may have actually sent.
        try:
            choices[0].Click(simulateMove=False)
        except Exception:
            return {"sendAttempted": "unknown", "sentUiConfirmed": False,
                    "deliveryVerified": False, "verified": False, "contact": expected_contact,
                    "note": "WhatsApp Send click raised an error. Message MAY have sent; check the chat manually and NEVER retry automatically."}
    except DesktopWhatsAppError:
        raise
    except Exception as exc:
        raise DesktopWhatsAppError("Could not safely verify the WhatsApp Send button or exact draft") from exc

    # A click may send or queue the message. We cannot prove WhatsApp server
    # delivery via UI Automation, even if the composer becomes empty.
    try:
        import uiautomation as auto
        for _ in range(12):
            time.sleep(0.25)
            if not windows.active_window() or windows.active_window().hwnd != active.hwnd:
                break
            root2 = auto.ControlFromHandle(active.hwnd)
            editor2 = _composer(root2, rect)
            if not str(editor2.GetValuePattern().Value or "").strip():
                return {
                    "sendAttempted": True, "draftCleared": True,
                    "sentUiConfirmed": False, "deliveryVerified": False,
                    "verified": False, "contact": expected_contact,
                    "note": "WhatsApp Send was clicked and composer cleared. Delivery is NOT verified; do not retry automatically or a duplicate may be sent.",
                }
    except Exception:
        pass
    return {"sendAttempted": True, "draftCleared": False,
            "sentUiConfirmed": False, "deliveryVerified": False,
            "verified": False, "contact": expected_contact,
            "note": "WhatsApp Send button was clicked. The app did not expose proof of delivery. Check the chat on the laptop; NEVER retry automatically."}


def send_attachment_reviewed(expected_contact: str, path: str, cancel=None) -> dict:
    """Separate final approval for the *same* file selected into a WhatsApp preview.

    Fail closed on wrong recipient, changed file contents, stale preview,
    changed native window, missing visible filename or ambiguous Send button.
    No automatic retries, ever.
    """
    if launcher.SIMULATE:
        launcher._record("whatsapp.send_attachment_reviewed", "attachment (redacted)")
        return {"sendAttempted": True, "deliveryVerified": False,
                "verified": False, "simulated": True,
                "note": "SIMULATED attachment Send; no WhatsApp delivery occurred."}
    global _pending_attachment
    pending = _pending_attachment
    _pending_attachment = None  # consume on any real attempt, even failure
    _check_cancel(cancel)
    if not pending or pending["contact"] != expected_contact or pending["path"] != path:
        raise DesktopWhatsAppError(
            "No matching HUKM attachment preview in this session; choose the file again first"
        )
    if time.monotonic() - pending["createdAt"] > 120.0:
        _pending_attachment = None
        raise DesktopWhatsAppError("Attachment preview expired; start a new approved preview")
    active, root, rect = _active_root()
    if active.hwnd != pending["hwnd"] or active.pid != pending.get("pid"):
        raise DesktopWhatsAppError("WhatsApp Desktop window changed; attachment Send blocked")
    _check_selected_contact(root, rect, expected_contact)
    size, digest = _file_fingerprint(path, cancel)
    if size != pending["size"] or digest != pending["sha256"]:
        raise DesktopWhatsAppError("Attachment contents changed after preview; Send blocked")
    left, top, width, height = rect
    filename = path.rsplit("\\", 1)[-1]
    preview_labels = [
        name for _, name, role, x, y, _right, _bottom in _controls(root)
        if name.casefold() == filename.casefold()
        and x >= left + width * 0.25
        and top + height * 0.10 <= y <= top + height * 0.85
        and role in ("TextControl", "ButtonControl", "EditControl")
    ]
    if not preview_labels:
        raise DesktopWhatsAppError(
            "The exact selected filename is not visible in the WhatsApp attachment preview; Send blocked"
        )
    sends = [
        c for c, name, kind, x, y, _r, _b in _controls(root)
        if kind == "ButtonControl" and name.casefold() in ("send", "send message")
        and x >= left + width * 0.65 and y >= top + height * 0.66
    ]
    if len(sends) != 1:
        raise DesktopWhatsAppError("A unique Send button is not visible in the attachment preview")
    if cancel is not None and cancel.is_set():
        raise DesktopWhatsAppError("Attachment Send cancelled before clicking")
    _same_window(active, cancel)
    fresh, fresh_root, fresh_rect = _active_root()
    if fresh.hwnd != active.hwnd or fresh.pid != active.pid:
        raise DesktopWhatsAppError("WhatsApp Desktop window changed before Send")
    _check_selected_contact(fresh_root, fresh_rect, expected_contact)
    _same_window(active, cancel)
    try:
        sends[0].Click(simulateMove=False)
    except Exception:
        return {"sendAttempted": "unknown", "deliveryVerified": False, "verified": False,
                "fileName": filename, "contact": expected_contact,
                "note": "Attachment Send click outcome is unknown. File may already be sent; check WhatsApp and NEVER retry automatically."}
    return {"sendAttempted": True, "deliveryVerified": False, "verified": False,
            "fileName": filename, "contact": expected_contact,
            "note": "Attachment Send clicked in reviewed WhatsApp preview. Delivery is NOT verified. Check the chat before any further action."}
