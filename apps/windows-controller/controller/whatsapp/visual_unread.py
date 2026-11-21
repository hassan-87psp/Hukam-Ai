"""Last-resort local visual fallback for the owner's *visible* WhatsApp Desktop.

Uses the Windows on-device OCR engine, NOT Gemini, and captures only the
top-left chat pane in memory. It never captures the right-hand message pane,
uploads images, stores screenshots or clicks a guessed/fixed coordinate.
A short-lived, approved task must bring the real native window to foreground
before this module can run.

The WhatsApp layout is derived from the owner's November 2026 screenshot:
Chats / search / All / Unread N / Favourites, with each sender on the left
and a time/date on the right. It is a layout hypothesis, not a universal API.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass

from ..system import windows
from . import locator


class VisualUnreadUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class Word:
    text: str
    x: float
    y: float
    width: float
    height: float

    @property
    def cx(self) -> float:
        return self.x + self.width / 2

    @property
    def cy(self) -> float:
        return self.y + self.height / 2


def _ocr_words(image) -> list[Word]:
    """Windows OCR stays on this laptop. OCR backend is lazily imported."""
    try:
        from natocr import OCR
        # A fresh local OCR object avoids stale screenshots/recognition caches.
        pages = OCR(language="en").recognize(image)
        if not pages:
            return []
        words: list[Word] = []
        for element in pages[0].elements[:1300]:
            text = " ".join(str(element.text or "").split())
            box = element.bounds.bounds
            if text and len(box) == 4:
                x, y, width, height = map(float, box)
                if width > 0 and height > 0:
                    words.append(Word(text, x, y, width, height))
        return words
    except Exception as exc:
        # Do not expose OCR text/image/raw errors in web logs.
        raise VisualUnreadUnavailable(
            "Local Windows screen-text recognition is unavailable. "
            "The installed Windows OCR language/engine may be missing."
        ) from exc


def _safe_foreground(hwnd: int) -> None:
    import win32gui
    current = windows.active_window()
    if (not current or current.hwnd != hwnd or
            not locator.matches_desktop_window(current) or
            win32gui.GetForegroundWindow() != hwnd or
            not win32gui.IsWindowVisible(hwnd) or win32gui.IsIconic(hwnd)):
        raise VisualUnreadUnavailable(
            "Personal WhatsApp Desktop lost the foreground. No mouse click/read was made."
        )


def _capture_left(hwnd: int):
    """Return screenshot of ONLY native WhatsApp's left chat/sidebar pane."""
    import win32gui
    import mss
    from PIL import Image

    _safe_foreground(hwnd)
    left, top, right, bottom = win32gui.GetWindowRect(hwnd)
    window_width = right - left
    window_height = bottom - top
    if window_width < 690 or window_height < 530:
        raise VisualUnreadUnavailable(
            "WhatsApp Desktop window is too small for safe visual scanning; maximize it."
        )
    # Never capture right-hand chat bubbles, images, or message bodies.
    width = min(520, int(window_width * 0.57))
    height = min(920, window_height - 12)
    with mss.mss() as screen:
        raw = screen.grab({"left": left, "top": top,
                           "width": width, "height": height})
        image = Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")
    _safe_foreground(hwnd)
    return image, left, top


def locate_unread(words: list[Word], width: int, height: int) -> Word | None:
    """Require a visual Unread *between* the All and Favourites chips."""
    def text(w: Word) -> str:
        return re.sub(r"\s+", " ", w.text.strip()).casefold()

    # Only the chip row, never similarly worded chat previews below it.
    header = [w for w in words
              if 55 <= w.cy <= min(275, height * .34)
              and 65 <= w.cx <= min(width - 30, 440)]
    unread = [w for w in header
              if re.fullmatch(r"unread(?:\s*\d{1,3})?", text(w))]
    all_chips = [w for w in header if text(w) == "all"]
    favorites = [w for w in header
                 if text(w) in ("favourites", "favorites")]
    if len(unread) != 1 or len(all_chips) != 1 or len(favorites) != 1:
        return None
    candidate = unread[0]
    left = all_chips[0]
    right = favorites[0]
    if (not (left.cx + 22 < candidate.cx < right.cx - 22) or
            max(abs(left.cy - candidate.cy),
                abs(right.cy - candidate.cy)) > 23):
        return None
    if candidate.width < 28 or candidate.width > 150:
        return None
    return candidate


_SKIP = {
    "all", "unread", "favourites", "favorites", "chats", "archived",
    "get started", "new chat", "settings", "search", "status",
    "whatsapp", "calls", "new", "more", "groups", "today",
}
_PROMO = re.compile(
    r"(?:reach more customers|business broadcast|create a business|"
    r"update payment|start a new chat|get started|search or start)", re.I)
_DATE = re.compile(
    r"^(?:yesterday|today|mon|tue|wed|thu|fri|sat|sun|"
    r"\d{1,2}:\d{2}(?:\s*[ap]m)?|"
    r"\d{1,2}/\d{1,2}/\d{2,4})$", re.I)


def visible_sender_titles(words: list[Word], width: int, chip_bottom: float) -> list[str]:
    """Return only title-looking OCR lines supported by a nearby date/time.

    The WhatsApp chat previews below titles are *not* returned. If OCR can't
    pair a name with a row timestamp we don't invent a sender.
    """
    rows = [w for w in words
            if chip_bottom + 65 < w.cy < 900
            and 120 <= w.x < min(355, width - 130)
            and 10 <= w.height <= 33
            and len(w.text) <= 65
            and w.text.strip().casefold() not in _SKIP
            and not _PROMO.search(w.text)
            and not _DATE.fullmatch(w.text.strip())]
    times = [w for w in words
             if chip_bottom + 65 < w.cy < 900
             and w.cx >= width * .67
             and _DATE.fullmatch(w.text.strip())]
    result: list[str] = []
    for moment in sorted(times, key=lambda t: t.y):
        matches = [w for w in rows if 0 <= moment.cx - w.cx
                   and abs(w.cy - moment.cy) <= 15]
        if not matches:
            continue
        candidate = sorted(matches, key=lambda w: (w.x, abs(w.cy-moment.cy)))[0]
        title = candidate.text.strip()
        if len(title) < 2 or title.casefold() in _SKIP:
            continue
        if title not in result:
            result.append(title)
    return result[:12]


def _chip_background(image, chip: Word) -> int:
    """Sample empty area just before 'Unread' text, avoiding its glyphs."""
    x = int(chip.x - 10)
    y = int(chip.cy)
    if x < 3 or y < 3 or x >= image.width - 3 or y >= image.height - 3:
        return -1
    from PIL import ImageStat
    patch = image.crop((x-2, y-2, x+3, y+3)).convert("L")
    return int(ImageStat.Stat(patch).median[0])


def visual_scan_unread(active_hwnd: int) -> dict:
    """Approved, foreground-only local OCR + real mouse click + verified list."""
    import win32api
    import win32con
    import win32gui

    image, left, top = _capture_left(active_hwnd)
    words = _ocr_words(image)
    chip = locate_unread(words, image.width, image.height)
    if chip is None:
        raise VisualUnreadUnavailable(
            "Windows UIA and local visual OCR could not uniquely identify "
            "the All / Unread / Favourites row. No mouse click was attempted."
        )

    x, y = left + round(chip.cx), top + round(chip.cy)
    # Client-area/foreground check, not a guessed screen coordinate.
    rect = win32gui.GetClientRect(active_hwnd)
    ox, oy = win32gui.ClientToScreen(active_hwnd, (rect[0], rect[1]))
    ex, ey = win32gui.ClientToScreen(active_hwnd, (rect[2], rect[3]))
    if not (ox + 20 < x < ex - 20 and oy + 20 < y < ey - 20):
        raise VisualUnreadUnavailable("Unread control is outside the verified WhatsApp client area")

    before = _chip_background(image, chip)
    _safe_foreground(active_hwnd)
    previous_cursor = win32api.GetCursorPos()
    try:
        win32api.SetCursorPos((x, y))
        _safe_foreground(active_hwnd)
        win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    finally:
        try:
            win32api.SetCursorPos(previous_cursor)
        except Exception:
            pass
    time.sleep(.4)
    after_image, new_left, new_top = _capture_left(active_hwnd)
    if (left, top) != (new_left, new_top):
        raise VisualUnreadUnavailable(
            "WhatsApp window moved while scanning Unread; no names reported."
        )
    second_words = _ocr_words(after_image)
    selected_chip = locate_unread(second_words, after_image.width, after_image.height)
    if selected_chip is None:
        raise VisualUnreadUnavailable(
            "Unread was clicked but the filter row could not be reverified visually."
        )
    after = _chip_background(after_image, selected_chip)
    selection_verified = before >= 0 and after >= before + 7
    # If the chip already appeared selected, a click could have changed it.
    # Never label names 'verified unread' without positive visual evidence.
    if after >= 0 and before >= 0 and after + 7 < before:
        raise VisualUnreadUnavailable(
            "Unread filter appears to have switched off; no unread sender names reported."
        )

    senders = visible_sender_titles(second_words, after_image.width,
                                   selected_chip.y + selected_chip.height)
    if not senders:
        raise VisualUnreadUnavailable(
            "Unread filter was clicked but local OCR could not confirm any "
            "sender titles alongside their chat timestamps. No names guessed."
        )
    return {
        "supported": True,
        "senders": senders,
        "visibleChatCount": len(senders),
        "totalUnreadChats": None,
        "visibleOnly": True, "messagesRead": False,
        "filterClickAttempted": True,
        "filterSelectedVerified": selection_verified,
        "source": "Local Windows visual OCR of Personal WhatsApp chat list",
        "note": ("Unread chip changed to selected appearance. Only locally "
                 "recognized visible sender titles were returned."
                 if selection_verified else
                 "OCR located and clicked the visible Unread chip, but its "
                 "selected state could not be independently verified. These "
                 "are visible chat titles, not certified unread contacts."),
    }
