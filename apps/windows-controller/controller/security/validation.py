"""Defence-in-depth validation. The relay validates every command too, but the controller never trusts the network."""
from __future__ import annotations

import os
import re
from pathlib import Path
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

KNOWN_FOLDERS = ["downloads", "documents", "desktop", "pictures", "music", "videos", "home"]

ALLOWED_FILTER_EXTS = {
    "pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "txt", "md", "rtf",
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "mp4", "mkv", "avi", "mov", "mp3", "wav", "m4a",
    "zip", "rar", "7z", "json", "html", "mq4", "mq5", "ex4", "ex5", "set",
}

# Never opened through HUKM, even inside allowed folders: these can run code.
BLOCKED_OPEN_EXTS = {
    ".exe", ".msi", ".bat", ".cmd", ".com", ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh",
    ".scr", ".pif", ".lnk", ".url", ".reg", ".hta", ".cpl", ".msc", ".jar", ".dll", ".sys", ".inf", ".appref-ms",
    ".application", ".gadget", ".msp", ".mst", ".psc1", ".scf", ".iso", ".img", ".vhd", ".vhdx",
}

ACTIONS = {
    "app.open", "folder.open", "folder.list", "file.search", "file.open", "file.reveal", "web.open", "web.search",
    "youtube.search", "youtube.play", "device.status", "apps.list", "window.active", "window.focus", "screen.capture",
    "diagnostics.probe", "ui.inspect", "ui.activate", "ui.scroll", "calendar.event_draft", "calendar.save_reviewed", "chatgpt.prompt_draft", "chatgpt.submit_prompt", "chatgpt.download_visible",
    "whatsapp.read_selected", "whatsapp.draft_reply", "whatsapp.send_reviewed", "whatsapp.attach_preview", "whatsapp.send_attachment_reviewed",
    "browser.control", "browser.profile_open", "notepad.type", "system.lock", "whatsapp.open", "whatsapp.check", "whatsapp.compose", "whatsapp.read_visible", "whatsapp.unread_senders",
}

CAPABILITY_OF = {
    "app.open": "apps", "folder.open": "folders", "folder.list": "files", "file.search": "files", "file.open": "files",
    "file.reveal": "files", "web.open": "browser", "web.search": "browser", "youtube.search": "youtube", "youtube.play": "youtube",
    "device.status": "system", "apps.list": "system", "window.active": "system", "window.focus": "input",
    "screen.capture": "screen", "diagnostics.probe": "system", "ui.inspect": "screen", "ui.activate": "input", "ui.scroll": "input",
    "calendar.event_draft": "browser", "calendar.save_reviewed": "browser", "chatgpt.prompt_draft": "browser", "chatgpt.submit_prompt": "browser",
    "chatgpt.download_visible": "browser", "whatsapp.read_selected": "whatsapp",
    "whatsapp.draft_reply": "whatsapp", "whatsapp.send_reviewed": "whatsapp", "whatsapp.attach_preview": "whatsapp", "browser.control": "input", "browser.profile_open": "browser", "notepad.type": "input", "system.lock": "system", "whatsapp.open": "whatsapp", "whatsapp.check": "whatsapp",
    "whatsapp.compose": "whatsapp", "whatsapp.read_visible": "whatsapp", "whatsapp.unread_senders": "whatsapp",
}


class ValidationError(Exception):
    pass


def _str(v, field: str, max_len: int, required: bool = True) -> str:
    if v is None or v == "":
        if required:
            raise ValidationError(f"{field} is required")
        return ""
    if not isinstance(v, str):
        raise ValidationError(f"{field} must be a string")
    s = v.strip()
    if len(s) > max_len:
        raise ValidationError(f"{field} too long")
    if re.search(r"[\x00-\x1f]", s):
        raise ValidationError(f"{field} contains control characters")
    return s


def safe_url(v) -> str:
    s = _str(v, "url", 2048)
    u = urlparse(s)
    if u.scheme not in ("http", "https") or not u.netloc or "@" in u.netloc:
        raise ValidationError("only plain http/https URLs are allowed")
    return s


def exts(v) -> list[str]:
    if not v:
        return []
    if not isinstance(v, list) or len(v) > 10:
        raise ValidationError("invalid ext list")
    out = []
    for e in v:
        x = str(e).lower().lstrip(".")
        if x not in ALLOWED_FILTER_EXTS:
            raise ValidationError(f"extension .{x} not allowed")
        out.append(x)
    return out


def folder_key(v, required=True) -> str | None:
    if not v:
        if required:
            raise ValidationError("folder is required")
        return None
    if v not in KNOWN_FOLDERS:
        raise ValidationError("unknown folder")
    return v


def is_within(path: Path, roots: list[Path]) -> bool:
    try:
        rp = path.resolve(strict=False)
    except OSError:
        return False
    for r in roots:
        try:
            rr = r.resolve(strict=False)
        except OSError:
            continue
        if rp == rr or rr in rp.parents:
            return True
    return False


def check_openable(path: Path, roots: list[Path]) -> Path:
    if str(path).startswith("\\\\"):
        raise ValidationError("network paths are not allowed")
    if ".." in Path(str(path)).parts:
        raise ValidationError("path traversal is not allowed")
    if not is_within(path, roots):
        raise ValidationError("this location is outside the folders you allowed")
    if path.suffix.lower() in BLOCKED_OPEN_EXTS:
        raise ValidationError(f"{path.suffix} files can run code, so HUKM will not open them")
    if not path.exists():
        raise FileNotFoundError(str(path))
    return path


def validate(action: str, args: dict) -> dict:
    if action not in ACTIONS:
        raise ValidationError(f"unsupported action {action}")
    if not isinstance(args, dict):
        raise ValidationError("args must be an object")
    a = args
    if action == "app.open":
        return {"app": _str(a.get("app"), "app", 40)}
    if action in ("folder.open",):
        return {"folder": folder_key(a.get("folder"))}
    if action == "folder.list":
        lim = a.get("limit", 60)
        return {"folder": folder_key(a.get("folder")), "limit": max(1, min(int(lim) if isinstance(lim, (int, float)) else 60, 200))}
    if action in ("file.search", "file.open") and "path" not in a:
        out = {
            "query": _str(a.get("query"), "query", 120, required=False),
            "ext": exts(a.get("ext")),
            "location": folder_key(a.get("location"), required=False),
            "sort": "latest" if a.get("sort") == "latest" else "relevance",
        }
        if action == "file.search":
            lim = a.get("limit", 30)
            out["limit"] = max(1, min(int(lim) if isinstance(lim, (int, float)) else 30, 100))
        return out
    if action in ("file.open", "file.reveal"):
        p = _str(a.get("path"), "path", 1024)
        return {"path": p}
    if action == "web.open":
        return {"url": safe_url(a.get("url"))}
    if action in ("web.search", "youtube.search", "youtube.play"):
        return {"query": _str(a.get("query"), "query", 200)}
    if action == "ui.scroll":
        steps = a.get("steps")
        if not isinstance(steps, int) or isinstance(steps, bool) or steps == 0 or abs(steps) > 5:
            raise ValidationError("scroll steps must be between -5 and 5")
        return {"steps": steps}
    if action == "ui.activate":
        label = _str(a.get("label"), "label", 100)
        if re.match(r"^(?:send|delete|remove|purchase|pay|submit|confirm|approve|publish|share|sign out|log out|block|report|transfer|call|video call|join)(?:\b|\s)", label, re.I):
            raise ValidationError("sensitive button requires dedicated workflow")
        return {"label": label}
    if action in ("calendar.event_draft", "calendar.save_reviewed"):
        provider = a.get("provider")
        if provider not in ("google", "outlook"):
            raise ValidationError("unsupported Calendar provider")
        title = _str(a.get("title"), "title", 100)
        profile = _str(a.get("profile"), "profile", 80)
        if not re.fullmatch(r"(?:Default|Profile [1-9][0-9]?)", profile):
            raise ValidationError("invalid Chrome profile directory")
        start, end = a.get("startUtc"), a.get("endUtc")
        iso = r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"
        if not isinstance(start, str) or not isinstance(end, str) or not re.fullmatch(iso, start) or not re.fullmatch(iso, end):
            raise ValidationError("UTC timestamps must be YYYY-MM-DDTHH:MM:SSZ")
        try:
            begin = datetime.strptime(start, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            finish = datetime.strptime(end, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except ValueError as exc:
            raise ValidationError("invalid Calendar date") from exc
        now = datetime.now(timezone.utc)
        if not begin < finish or finish - begin > timedelta(days=1) or begin < now - timedelta(minutes=5) or begin > now + timedelta(days=366):
            raise ValidationError("Calendar event dates invalid")
        tz = _str(a.get("timeZone"), "timeZone", 70)
        if not re.fullmatch(r"[A-Za-z_]+(?:/[A-Za-z0-9_+\-]+){0,2}", tz):
            raise ValidationError("invalid IANA time zone")
        return {"provider": provider, "title": title, "profile": profile,
                "startUtc": start, "endUtc": end, "timeZone": tz,
                "details": _str(a.get("details"), "details", 500, required=False),
                "location": _str(a.get("location"), "location", 120, required=False)}
    if action in ("chatgpt.prompt_draft", "chatgpt.submit_prompt", "chatgpt.download_visible"):
        url = _str(a.get("projectUrl"), "projectUrl", 500)
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != "chatgpt.com" or parsed.username or parsed.password or parsed.fragment:
            raise ValidationError("Only HTTPS ChatGPT Project URLs are supported")
        out = {"projectUrl": url}
        if action != "chatgpt.download_visible":
            prompt = a.get("prompt")
            if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 1800 or re.search(r"[\x00-\x08\x0b-\x1f]", prompt):
                raise ValidationError("invalid ChatGPT prompt")
            out["prompt"] = prompt
        return out
    if action in ("whatsapp.draft_reply", "whatsapp.send_reviewed"):
        contact = _str(a.get("contact"), "contact", 80)
        message = a.get("message")
        if not isinstance(message, str) or not message.strip() or len(message) > 1000 or re.search(r"[\x00-\x08\x0b-\x1f]", message):
            raise ValidationError("invalid WhatsApp reply")
        return {"contact": contact, "message": message}
    if action == "whatsapp.attach_preview":
        return {"contact": _str(a.get("contact"), "contact", 80),
                "path": _str(a.get("path"), "path", 1024)}
    if action == "browser.profile_open":
        profile = _str(a.get("profile"), "profile", 80)
        if not re.fullmatch(r"(?:Default|Profile [1-9][0-9]?)", profile):
            raise ValidationError("invalid Chrome profile")
        url = safe_url(a.get("url"))
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname not in ("chatgpt.com", "calendar.google.com", "outlook.office.com"):
            raise ValidationError("unsupported Chrome profile destination")
        return {"profile": profile, "url": url}
    if action == "notepad.type":
        text = a.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > 1200 or re.search(r"[\x00-\x08\x0b-\x1f]", text):
            raise ValidationError("invalid Notepad text")
        return {"text": text}
    if action == "browser.control":
        kind = a.get("kind")
        if kind == "click":
            x, y = a.get("x"), a.get("y")
            if type(x) is not int or type(y) is not int or not (0 <= x <= 9999 and 0 <= y <= 9999):
                raise ValidationError("invalid browser click coordinates")
            return {"kind": kind, "x": x, "y": y}
        if kind == "type":
            return {"kind": kind, "text": _str(a.get("text"), "text", 1000)}
        if kind == "scroll":
            steps = a.get("steps")
            if type(steps) is not int or steps == 0 or not -5 <= steps <= 5:
                raise ValidationError("invalid browser scroll")
            return {"kind": kind, "steps": steps}
        if kind == "key":
            key = a.get("key")
            if key not in ("enter", "tab", "escape", "backspace", "home", "end", "arrowdown",
                           "arrowup", "ctrl+l", "ctrl+a"):
                raise ValidationError("browser key not allowed")
            return {"kind": kind, "key": key}
        raise ValidationError("unsupported browser input")
    if action == "window.focus":
        return {"title": _str(a.get("title"), "title", 200)}
    if action in ("whatsapp.open", "whatsapp.check"):
        mode = a.get("mode")
        if mode is None:
            return {}
        if mode not in ("desktop", "web"):
            raise ValidationError("WhatsApp mode must be desktop or web")
        return {"mode": mode}
    if action == "whatsapp.compose":
        phone = _str(a.get("phone"), "phone", 15)
        if not re.fullmatch(r"\d{8,15}", phone):
            raise ValidationError("invalid phone number")
        return {"contact": _str(a.get("contact"), "contact", 60), "message": _str(a.get("message"), "message", 1000), "phone": phone}
    return {}
