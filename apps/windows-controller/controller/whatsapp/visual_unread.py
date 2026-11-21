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

import logging
import re
import time
from dataclasses import dataclass

from ..system import windows
from . import locator


log = logging.getLogger(__name__)


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


def _prepare_ocr_image(image):
    """Enlarge tiny desktop text for Windows OCR, preserve original geometry.

    WhatsApp's 2026 dark desktop uses 12-15 px filter labels; native OCR can
    miss them entirely at 1x. Upscale locally without network calls, then
    transform recognized rectangles back to the original screenshot units.
    The OCR bitmap is capped below common WinRT maximum dimensions.
    """
    from PIL import Image

    source = image.convert("RGB")
    scale = min(2.0, 1900.0 / max(source.width, source.height))
    if scale <= 1.05:
        return source, 1.0
    width = round(source.width * scale)
    height = round(source.height * scale)
    return source.resize((width, height), Image.Resampling.LANCZOS), scale


def _ocr_words(image) -> list[Word]:
    """Direct Windows.Media.Ocr word rectangles, no model/cloud/wrapper.

    The WinRT APIs are an on-device last resort when WhatsApp UIAutomation
    hides its controls. We intentionally retain *individual word bounding
    boxes*, not only OCR lines: titles and right-column timestamps must be
    differentiated geometrically before HUKM can report senders.
    """
    try:
        import asyncio
        import io
        prepared_image, scale = _prepare_ocr_image(image)
        from winrt.windows.media import ocr
        from winrt.windows.graphics import imaging
        from winrt.windows.storage import streams

        async def recognize() -> list[Word]:
            engine = ocr.OcrEngine.try_create_from_user_profile_languages()
            if engine is None:
                raise VisualUnreadUnavailable(
                    "No local Windows OCR language pack is available.")
            buffer = io.BytesIO()
            prepared_image.save(buffer, format="PNG")
            stream = streams.InMemoryRandomAccessStream()
            writer = streams.DataWriter(stream)
            writer.write_bytes(buffer.getvalue())
            await writer.store_async()
            await writer.flush_async()
            stream.seek(0)
            decoder = await imaging.BitmapDecoder.create_async(stream)
            bitmap = await decoder.get_software_bitmap_async()
            result = await engine.recognize_async(bitmap)
            output: list[Word] = []
            for line in result.lines:
                for word in line.words:
                    value = " ".join(str(word.text or "").split())
                    b = word.bounding_rect
                    if value and b.width > 0 and b.height > 0:
                        output.append(Word(
                            value, float(b.x) / scale, float(b.y) / scale,
                            float(b.width) / scale, float(b.height) / scale))
            return output

        # PyWinRT can take longer on the first invocation. Bound each OCR
        # stage so the relay deadline does not expire while WinRT is still
        # initializing. A pending worker must never click after cancellation.
        async def bounded():
            return await asyncio.wait_for(recognize(), timeout=22.0)

        return asyncio.run(bounded())
    except VisualUnreadUnavailable:
        raise
    except TimeoutError as exc:
        raise VisualUnreadUnavailable(
            "Windows OCR scan exceeded its 22-second local limit; no unverified mouse action was attempted."
        ) from exc
    except Exception as exc:
        raise VisualUnreadUnavailable(
            "Windows on-device OCR could not initialize or recognize the "
            "WhatsApp chat pane. Check local Windows OCR language support."
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


def _header_labels(words: list[Word], width: int, height: int) -> dict[str, bool]:
    """Only diagnostic BOOLEAN flags for fixed UI words, never chat/contact text."""
    limit_y = min(400, height * .46)
    header = [w for w in words
              if 45 <= w.cy <= limit_y and 65 <= w.cx <= min(width - 22, 480)]
    values = [re.sub(r"\s+", " ", w.text.strip()).casefold() for w in header]
    return {
        "all": "all" in values,
        "unread": any(re.fullmatch(r"unread(?:\s*\d{1,3})?", v) for v in values),
        "favourites": "favourites" in values or "favorites" in values,
        "chats": "chats" in values,
    }


def locate_unread(words: list[Word], width: int, height: int) -> Word | None:
    """Find Unread using confirmed left-side anchors, not a blind coordinate.

    WhatsApp's Favourites chip is optional in recent builds and Windows OCR
    often misses it. Require a unique All + Unread row and, if Favourites
    wasn't recognized, a separate Chats heading ABOVE the row. Reject
    uncertain or duplicated rows instead of clicking arbitrary text.
    Coordinates scale with the captured pane height for Windows DPI settings.
    """
    def label(w: Word) -> str:
        return re.sub(r"\s+", " ", w.text.strip()).casefold()

    header = [w for w in words
              if 45 <= w.cy <= min(400, height * .46)
              and 65 <= w.cx <= min(width - 22, 480)]
    unread = [w for w in header
              if re.fullmatch(r"unread(?:\s*\d{1,3})?", label(w))]
    all_chips = [w for w in header if label(w) == "all"]
    favourites = [w for w in header if label(w) in ("favourites", "favorites")]
    if len(unread) != 1 or len(all_chips) != 1 or len(favourites) > 1:
        return None

    candidate, left = unread[0], all_chips[0]
    # Unread is immediately to the right of All on the same chip row.
    if not (left.cx + 20 < candidate.cx < left.cx + 240
            and abs(left.cy - candidate.cy) <= 24):
        return None
    if not (25 <= candidate.width <= 155 and 11 <= candidate.height <= 44):
        return None

    if favourites:
        right = favourites[0]
        if not (candidate.cx + 20 < right.cx < candidate.cx + 260
                and abs(right.cy - candidate.cy) <= 24):
            return None
    else:
        # Two matched chip words alone could be conversation preview text.
        # A separately recognized Chats heading must precede the chip row.
        headings = [w for w in header if label(w) == "chats"
                    and w.cy + 38 < candidate.cy
                    and w.cx < candidate.cx]
        if len(headings) != 1:
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
        # Windows OCR returns *words*, not entire sender names. Build one
        # single-line title from adjacent word rectangles, stopping well
        # before the separate right-hand timestamp column.
        candidates = sorted(
            (w for w in rows if w.x + w.width < moment.x - 16
             and abs(w.cy - moment.cy) <= 15), key=lambda w: w.x)
        if not candidates:
            continue
        parts = [candidates[0]]
        for word in candidates[1:]:
            prev = parts[-1]
            if word.x - (prev.x + prev.width) > 21:
                break
            parts.append(word)
        title = " ".join(part.text for part in parts).strip()
        if len(title) < 2 or len(title) > 65 or title.casefold() in _SKIP:
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


def _ensure_not_cancelled(cancel) -> None:
    if cancel is not None and cancel.is_set():
        raise VisualUnreadUnavailable(
            "Unread scan was cancelled or disconnected; no further mouse action or names will be reported."
        )


def visual_scan_unread(active_hwnd: int, cancel=None) -> dict:
    """Approved, foreground-only local OCR + real mouse click + verified list."""
    import win32api
    import win32con
    import win32gui

    started = time.monotonic()
    _ensure_not_cancelled(cancel)
    log.info("WhatsApp unread visual stage=first_capture")
    image, left, top = _capture_left(active_hwnd)
    _ensure_not_cancelled(cancel)
    log.info("WhatsApp unread visual stage=first_ocr")
    words = _ocr_words(image)
    _ensure_not_cancelled(cancel)
    log.info("WhatsApp unread visual stage=first_ocr_complete elapsed=%.1fs",
             time.monotonic() - started)
    chip = locate_unread(words, image.width, image.height)
    if chip is None:
        evidence = _header_labels(words, image.width, image.height)
        # Boolean fixed-label diagnostics only; do not log OCR's private chat text.
        log.info("WhatsApp unread header detected all=%s unread=%s favourites=%s chats=%s",
                 evidence["all"], evidence["unread"], evidence["favourites"], evidence["chats"])
        raise VisualUnreadUnavailable(
            "Local WhatsApp OCR could not verify the All / Unread chip row "
            "(All: %s, Unread: %s, Chats heading: %s, Favourites: %s). "
            "No mouse click was attempted." %
            tuple("yes" if evidence[k] else "no"
                  for k in ("all", "unread", "chats", "favourites"))
        )

    x, y = left + round(chip.cx), top + round(chip.cy)
    # Client-area/foreground check, not a guessed screen coordinate.
    rect = win32gui.GetClientRect(active_hwnd)
    ox, oy = win32gui.ClientToScreen(active_hwnd, (rect[0], rect[1]))
    ex, ey = win32gui.ClientToScreen(active_hwnd, (rect[2], rect[3]))
    if not (ox + 20 < x < ex - 20 and oy + 20 < y < ey - 20):
        raise VisualUnreadUnavailable("Unread control is outside the verified WhatsApp client area")

    before = _chip_background(image, chip)
    _ensure_not_cancelled(cancel)
    _safe_foreground(active_hwnd)
    previous_cursor = win32api.GetCursorPos()
    try:
        win32api.SetCursorPos((x, y))
        _ensure_not_cancelled(cancel)
        _safe_foreground(active_hwnd)
        win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    finally:
        try:
            win32api.SetCursorPos(previous_cursor)
        except Exception:
            pass
    log.info("WhatsApp unread visual stage=clicked elapsed=%.1fs",
             time.monotonic() - started)
    _ensure_not_cancelled(cancel)
    time.sleep(.4)
    _ensure_not_cancelled(cancel)
    after_image, new_left, new_top = _capture_left(active_hwnd)
    if (left, top) != (new_left, new_top):
        raise VisualUnreadUnavailable(
            "WhatsApp window moved while scanning Unread; no names reported."
        )
    _ensure_not_cancelled(cancel)
    log.info("WhatsApp unread visual stage=second_ocr")
    second_words = _ocr_words(after_image)
    _ensure_not_cancelled(cancel)
    log.info("WhatsApp unread visual stage=second_ocr_complete elapsed=%.1fs",
             time.monotonic() - started)
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
    _ensure_not_cancelled(cancel)
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
