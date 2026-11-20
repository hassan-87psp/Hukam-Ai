"""WhatsApp adapter boundary.

What V1 really does:
  * open    — opens WhatsApp Web (or the desktop app if configured).
  * check   — reads the unread-chat count WhatsApp shows in its window title, e.g. "(3) WhatsApp".
              It does not read message contents.
  * compose — opens WhatsApp's official click-to-chat link with the text pre-filled.
              It never presses Send; the user sends it on the laptop.

Not implemented (needs an official, authorised integration): reading messages, listing chats, auto-sending.
"""
from __future__ import annotations

import re
from urllib.parse import quote

from ..system import launcher, windows

TITLE_RE = re.compile(r"^\((\d+)\)\s*WhatsApp\b", re.I)


def open_whatsapp(mode: str, browser_pref: str) -> dict:
    if mode == "desktop":
        try:
            launcher.open_uri("whatsapp:")
            return {"opened": "desktop"}
        except Exception:
            pass
    launcher.open_url("https://web.whatsapp.com/", browser_pref)
    return {"opened": "web"}


def unread_from_titles(titles: list[str]) -> int | None:
    found = None
    for t in titles:
        m = TITLE_RE.search(t)
        if m:
            found = max(found or 0, int(m.group(1)))
        elif re.search(r"\bWhatsApp\b", t) and found is None:
            found = 0
    return found


def check(mode: str, browser_pref: str) -> dict:
    titles = [w.title for w in windows.list_windows()]
    count = unread_from_titles(titles)
    if count is None:
        opened = open_whatsapp(mode, browser_pref)
        return {
            "unreadChats": None,
            "opened": opened["opened"],
            "note": "WhatsApp was not open, so it has been opened. Ask again in a few seconds once it has loaded "
            "(and keep the WhatsApp tab active — the count is read from the window title).",
            "messagesRead": False,
        }
    return {
        "unreadChats": count,
        "source": "window title",
        "note": "Only the unread chat count is visible to HUKM. Message contents are not read in Version 1.",
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
