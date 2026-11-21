"""Supervised ChatGPT website interaction via Chrome's Windows accessibility.

A dedicated, already logged-in Chrome profile must be opened by the owner.
No ChatGPT/API credentials are read or used. The current browser URL MUST match
the configured project URL before any typing, submission or download.

Draft doesn't submit. Submit needs separate owner approval and verifies the
composer already contains the exact expected text. Download checks for a new
file in Downloads; it does not infer success just from clicking the button.
UIA controls vary with browser and ChatGPT versions; fail closed if unavailable.
"""
from __future__ import annotations

import time
from pathlib import Path
from urllib.parse import urlparse

from ..config import IS_WINDOWS
from ..system import launcher, windows


class ChatGPTError(Exception):
    pass


def matches_project(active_url: str, expected_url: str) -> bool:
    try:
        actual = urlparse(active_url)
        expected = urlparse(expected_url)
    except (ValueError, TypeError):
        return False
    return (actual.scheme == expected.scheme == "https"
            and actual.hostname == expected.hostname == "chatgpt.com"
            and actual.path.rstrip("/") == expected.path.rstrip("/"))


def _chrome_context(expected_url: str):
    if not IS_WINDOWS:
        raise ChatGPTError("ChatGPT UI automation is supported on Windows only")
    active = windows.active_window()
    if not active or active.process.casefold() != "chrome.exe":
        raise ChatGPTError("Bring the intended ChatGPT Chrome window to the foreground")
    import win32gui
    if not win32gui.IsWindowVisible(active.hwnd) or win32gui.IsIconic(active.hwnd):
        raise ChatGPTError("Chrome must be visible and restored")
    import uiautomation as auto
    root = auto.ControlFromHandle(active.hwnd)
    urls = []
    for index, (control, _depth) in enumerate(auto.WalkControl(root, maxDepth=8)):
        if index >= 450:
            break
        try:
            if control.IsOffscreen or control.ControlTypeName != "EditControl":
                continue
            name = str(control.Name or "").casefold()
            if not any(k in name for k in ("address", "search bar", "location")):
                continue
            value = str(control.GetValuePattern().Value or "")
            if value.startswith("http"):
                urls.append(value)
        except (AttributeError, OSError, RuntimeError, ValueError):
            continue
    if not any(matches_project(u, expected_url) for u in urls):
        raise ChatGPTError("Could not verify this Chrome tab is the exact configured ChatGPT Project URL")
    return active, root


def _interactive(root, role: str, name_list: tuple[str, ...], max_depth: int = 14):
    import uiautomation as auto
    found = []
    for index, (ctrl, _depth) in enumerate(auto.WalkControl(root, maxDepth=max_depth)):
        if index >= 1200:
            break
        try:
            if ctrl.IsOffscreen or ctrl.ControlTypeName != role:
                continue
            if str(ctrl.Name or "").strip().casefold() in name_list:
                found.append(ctrl)
        except (AttributeError, OSError, RuntimeError, ValueError):
            continue
    return found


def _composer(root):
    for role in ("EditControl", "DocumentControl"):
        found = _interactive(root, role, (
            "ask anything", "message chatgpt", "message", "send a message",
            "prompt", "type a message",
        ))
        if len(found) == 1:
            return found[0]
    raise ChatGPTError("ChatGPT composer was not uniquely accessible; no prompt was entered")


def draft_prompt(expected_url: str, prompt: str) -> dict:
    if launcher.SIMULATE:
        launcher._record("chatgpt.prompt_draft", "prompt (redacted)")
        return {"promptDrafted": True, "submitted": False, "verified": False, "simulated": True}
    try:
        active, root = _chrome_context(expected_url)
        editor = _composer(root)
        try:
            before = str(editor.GetValuePattern().Value or "")
        except Exception as exc:
            raise ChatGPTError("Could not inspect existing ChatGPT composer contents") from exc
        if before.strip():
            raise ChatGPTError("ChatGPT composer contains an existing draft; clear it manually first")
        editor.SetFocus()
        if windows.active_window().hwnd != active.hwnd:
            raise ChatGPTError("Chrome focus changed before typing")
        from .operator import _send_unicode
        _send_unicode(prompt)
        return {"promptDrafted": True, "submitted": False, "verified": False,
                "note": "Prompt typed in the configured ChatGPT Project. Review it and approve submission separately."}
    except ChatGPTError:
        raise
    except Exception as exc:
        raise ChatGPTError("ChatGPT composer draft failed on this website version") from exc


def submit_prompt(expected_url: str, expected_prompt: str) -> dict:
    if launcher.SIMULATE:
        launcher._record("chatgpt.submit_prompt", "prompt (redacted)")
        return {"submitted": True, "responseVerified": False, "verified": False, "simulated": True}
    try:
        _active, root = _chrome_context(expected_url)
        editor = _composer(root)
        try:
            current = str(editor.GetValuePattern().Value or "")
        except Exception as exc:
            raise ChatGPTError("Cannot verify the exact draft before submitting") from exc
        if current != expected_prompt:
            raise ChatGPTError("ChatGPT draft does not exactly match the reviewed text; submission blocked")
        buttons = _interactive(root, "ButtonControl", ("send prompt", "send message", "send"))
        if len(buttons) != 1:
            raise ChatGPTError("ChatGPT Send button not uniquely accessible")
        buttons[0].Click()
        return {"submitted": True, "responseVerified": False, "verified": False,
                "note": "ChatGPT Send button clicked. Generated result has not yet been verified."}
    except ChatGPTError:
        raise
    except Exception as exc:
        raise ChatGPTError("Unable to submit ChatGPT prompt safely") from exc


def _files(folder: Path) -> dict[str, float]:
    allowed = {".png", ".jpg", ".jpeg", ".webp", ".pdf", ".txt", ".docx"}
    try:
        return {p.name: p.stat().st_mtime for p in folder.iterdir()
                if p.is_file() and p.suffix.casefold() in allowed}
    except OSError:
        return {}


def download_visible(expected_url: str, downloads: Path, cancel=None) -> dict:
    """Wait for a unique visible ChatGPT Download control after generation.

    This is allowed only in the exact user-configured ChatGPT Project tab.
    No blind click, no guessed URL, no Chrome profile switching.
    """
    if launcher.SIMULATE:
        launcher._record("chatgpt.download_visible", "visible download")
        return {"downloadVerified": True, "fileName": "test-image.png",
                "simulated": True}
    try:
        # ChatGPT image generation can take longer than the next model step;
        # do not immediately fail just because the Download button is absent.
        deadline = time.monotonic() + 75.0
        chosen = None
        while time.monotonic() < deadline:
            if cancel is not None and cancel.is_set():
                raise ChatGPTError("ChatGPT download cancelled before selecting a file")
            active, root = _chrome_context(expected_url)
            buttons = _interactive(root, "ButtonControl", ("download", "download image", "save image"))
            if len(buttons) > 1:
                raise ChatGPTError("More than one Download button is visible; select the intended result manually")
            if len(buttons) == 1 and buttons[0].IsEnabled:
                chosen = (active, buttons[0])
                break
            time.sleep(0.85)
        if chosen is None:
            raise ChatGPTError(
                "No single visible Download button appeared before timeout. Generation may still be running."
            )
        active, button = chosen
        if not windows.active_window() or windows.active_window().hwnd != active.hwnd:
            raise ChatGPTError("Chrome focus changed, so Download was not clicked")
        before = _files(downloads)
        button.Click()
        download_deadline = time.monotonic() + 22.0
        while time.monotonic() < download_deadline:
            if cancel is not None and cancel.is_set():
                raise ChatGPTError("Download monitoring stopped; file transfer may still continue in Chrome")
            current = _files(downloads)
            new_files = sorted((x for x in current if x not in before), key=lambda x: current[x], reverse=True)
            if new_files:
                path = downloads / new_files[0]
                if path.stat().st_size > 0:
                    return {"downloadVerified": True, "fileName": path.name,
                            "sizeBytes": path.stat().st_size, "verified": True,
                            "note": "Unique visible Download button clicked and a new finished file detected in Downloads."}
            time.sleep(0.4)
        raise ChatGPTError(
            "Download button was clicked but no new finished image/document was detected. "
            "Check Chrome Downloads; do not assume success."
        )
    except ChatGPTError:
        raise
    except Exception as exc:
        raise ChatGPTError("ChatGPT visible download could not be verified") from exc
