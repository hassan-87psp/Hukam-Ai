"""Strict, owner-approved read of the current ChatGPT assistant message.

This reads only the foreground Chrome UI Automation tree. There is NO browser
network request, cookie access, Javascript injection, external OCR upload,
automatic Gemini call, or hidden-conversation scraping.

A specific previously approved user prompt must be visible in a unique
"You said" group and immediately followed by ONE visible "ChatGPT said"
group. Only the observed assistant group's text is returned. Unsupported
accessibility layouts fail closed instead of pretending an answer was read.
The returned text may be viewport-limited, and is NEVER called a complete
verified AI answer.
"""
from __future__ import annotations

import re
import time
from urllib.parse import urlparse

from ..system import desktop_input, launcher, windows
from . import chatgpt


def _clean(text: str) -> str:
    return " ".join(text.split()).strip()


def _url_allowed(actual_url: str, expected_url: str) -> bool:
    """Exact expected URL, or a bounded ChatGPT conversation redirect.

    For a named custom GPT/Project, a root /c URL cannot prove association
    with that Project, so reject it rather than switching accounts silently.
    """
    if chatgpt.matches_project(actual_url, expected_url):
        return True
    try:
        actual, expected = urlparse(actual_url), urlparse(expected_url)
        if (actual.scheme != expected.scheme or actual.scheme != "https" or
                actual.hostname != expected.hostname or actual.hostname != "chatgpt.com" or
                actual.port not in (None, 443) or actual.username or actual.password or
                actual.query or actual.fragment):
            return False
        p = actual.path.rstrip("/")
        if not re.fullmatch(r"/c/[A-Za-z0-9-]{12,90}", p):
            return False
        return expected.path.rstrip("/") == ""
    except (ValueError, TypeError):
        return False


def choose_visible_reply(
    groups: list[tuple[str, str]], expected_prompt: str
) -> str:
    """Pure extraction: do not confuse any user, sidebar or tool text with AI output."""
    wanted = _clean(expected_prompt)
    hits = [i for i, (who, body) in enumerate(groups)
            if who == "user" and _clean(body) == wanted]
    if len(hits) != 1:
        raise chatgpt.ChatGPTError(
            "Exact previous question was not uniquely visible in the current ChatGPT conversation")
    after = groups[hits[0] + 1:]
    if not after or after[0][0] != "assistant":
        raise chatgpt.ChatGPTError(
            "A matching assistant reply was not uniquely visible after the exact question")
    if len(after) != 1:
        raise chatgpt.ChatGPTError(
            "Question is not the last visible user turn or several replies are present")
    reply = after[0][1].strip()
    if not reply or len(_clean(reply)) < 4:
        raise chatgpt.ChatGPTError("Visible ChatGPT reply is empty or too short to verify")
    return reply


def _chrome_context(expected_url: str, cancel=None):
    desktop_input._check_cancel(cancel)
    if not chatgpt.IS_WINDOWS:
        raise chatgpt.ChatGPTError("ChatGPT response reading needs Windows")
    active = windows.active_window()
    if not active or active.process.casefold() != "chrome.exe":
        raise chatgpt.ChatGPTError("Focus the exact signed-in ChatGPT Chrome tab first")
    import win32gui
    if not win32gui.IsWindowVisible(active.hwnd) or win32gui.IsIconic(active.hwnd):
        raise chatgpt.ChatGPTError("Chrome is hidden or minimized; no reading attempted")
    import uiautomation as auto
    root = auto.ControlFromHandle(active.hwnd)
    found_urls: list[str] = []
    for idx, (control, _) in enumerate(auto.WalkControl(root, maxDepth=8)):
        desktop_input._check_cancel(cancel)
        if idx >= 500:
            raise chatgpt.ChatGPTError("Chrome address scan incomplete")
        try:
            if control.IsOffscreen or control.ControlTypeName != "EditControl":
                continue
            name = _clean(str(control.Name or "")).casefold()
            if any(t in name for t in ("address", "search bar", "location")):
                raw = str(control.GetValuePattern().Value or "")
                if raw.startswith("https://"): found_urls.append(raw)
        except (AttributeError, RuntimeError, ValueError, OSError):
            continue
    exact = sorted(set(url for url in found_urls if _url_allowed(url, expected_url)))
    if len(exact) != 1:
        raise chatgpt.ChatGPTError(
            "Exact ChatGPT tab or owner-approved thread URL not verifiable")
    return active, root, exact[0]


def _group_author(name: str) -> str | None:
    value = _clean(name).casefold().rstrip(":")
    if value in ("you said", "you said:", "user said"):
        return "user"
    if value in ("chatgpt said", "assistant said", "chatgpt replied"):
        return "assistant"
    return None


def _group_text(root, cancel=None) -> str:
    import uiautomation as auto
    chunks: list[str] = []
    for j, (ctrl, _) in enumerate(auto.WalkControl(root, maxDepth=9)):
        desktop_input._check_cancel(cancel)
        if j >= 700:
            raise chatgpt.ChatGPTError("ChatGPT message exceeds safe visible accessibility scan")
        try:
            if ctrl.IsOffscreen or ctrl.ControlTypeName != "TextControl":
                continue
            line = _clean(str(ctrl.Name or ""))
            if (line and line not in ("You said:", "ChatGPT said:") and
                line.casefold() not in ("copy", "edit", "share", "retry", "thumbs up",
                                       "thumbs down", "read aloud")):
                if not chunks or chunks[-1] != line:
                    chunks.append(line)
        except (AttributeError, RuntimeError, ValueError, OSError):
            continue
    return "\n".join(chunks)


def _visible_groups(root, cancel=None) -> tuple[list[tuple[str, str]], bool]:
    import uiautomation as auto
    groups: list[tuple[str, str]] = []
    generating = False
    for j, (ctrl, _) in enumerate(auto.WalkControl(root, maxDepth=17)):
        desktop_input._check_cancel(cancel)
        if j >= 2000:
            raise chatgpt.ChatGPTError("Visible ChatGPT page scan incomplete")
        try:
            if ctrl.IsOffscreen:
                continue
            role = ctrl.ControlTypeName
            name = str(ctrl.Name or "")
            if role == "ButtonControl" and _clean(name).casefold() in (
                "stop generating", "stop response", "stop streaming"):
                generating = True
            author = _group_author(name) if role in (
                "GroupControl", "PaneControl", "DocumentControl") else None
            if author:
                if len(groups) >= 28:
                    raise chatgpt.ChatGPTError("Too many message groups; narrow the current chat")
                body = _group_text(ctrl, cancel)
                groups.append((author, body))
        except (AttributeError, RuntimeError, ValueError, OSError):
            continue
    return groups, generating


def read_visible_response(expected_url: str, expected_prompt: str, cancel=None) -> dict:
    desktop_input._check_cancel(cancel)
    if launcher.SIMULATE:
        launcher._record("chatgpt.read_response", "visible assistant response (redacted)")
        return {"responseRead": False, "responseVerified": False,
                "verified": False, "simulated": True}
    if not expected_prompt.strip():
        raise chatgpt.ChatGPTError("Exact previously submitted question required")
    deadline = time.monotonic() + 33
    last: str | None = None
    stable = 0
    target_hwnd: int | None = None
    target_url: str | None = None
    while time.monotonic() < deadline:
        desktop_input._check_cancel(cancel)
        active, root, url = _chrome_context(expected_url, cancel)
        if target_hwnd is not None and (target_hwnd != active.hwnd or target_url != url):
            raise chatgpt.ChatGPTError("ChatGPT window/thread switched during response read")
        target_hwnd, target_url = active.hwnd, url
        groups, generating = _visible_groups(root, cancel)
        try:
            body = choose_visible_reply(groups, expected_prompt)
        except chatgpt.ChatGPTError:
            body = None
        if body is not None and not generating:
            if body == last:
                stable += 1
            else:
                stable, last = 1, body
            if stable >= 3:
                # Never claim all paragraphs are present in a viewport-only read.
                truncated = len(body) > 4000
                return {
                    "responseRead": True,
                    "responseVerified": False,
                    "promptMatched": True,
                    "responseText": body[:4000],
                    "truncated": truncated,
                    "coverage": "visible-only",
                    "threadUrl": target_url,
                    "verified": False,
                    "note": "Visible ChatGPT assistant text read from approved Chrome. "
                            "Off-screen paragraphs and provider completion are not independently verified.",
                }
        else:
            last, stable = None, 0
        time.sleep(0.85)
    raise chatgpt.ChatGPTError(
        "Unique stable visible assistant response unavailable. "
        "ChatGPT may still be generating, or this page layout is not supported.")


def draft_followup(expected_url: str, previous_prompt: str, prompt: str, cancel=None) -> dict:
    """Draft in the SAME foreground thread after proving the prior user turn."""
    desktop_input._check_cancel(cancel)
    if launcher.SIMULATE:
        launcher._record("chatgpt.followup_draft", "follow-up (redacted)")
        return {"promptDrafted": True, "submitted": False,
                "previousPromptMatched": False, "verified": False, "simulated": True}
    active, root, current_url = _chrome_context(expected_url, cancel)
    if not chatgpt.matches_project(current_url, expected_url):
        raise chatgpt.ChatGPTError("Follow-up must target the exact reviewed conversation URL")
    groups, generating = _visible_groups(root, cancel)
    if generating:
        raise chatgpt.ChatGPTError("ChatGPT is still generating; follow-up blocked")
    choose_visible_reply(groups, previous_prompt)
    # Independent fresh foreground identity and exact URL are rechecked by
    # the existing draft function before each character. No blind typing.
    result = chatgpt.draft_prompt(current_url, prompt, cancel)
    if windows.active_window() is None or windows.active_window().hwnd != active.hwnd:
        raise chatgpt.ChatGPTError("Chrome window changed during follow-up")
    return {**result, "previousPromptMatched": True}
