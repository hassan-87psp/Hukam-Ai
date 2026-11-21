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


def _ocr_words_native(image) -> list[Word]:
    """Direct Windows.Media.Ocr word rectangles, no model/cloud/wrapper.

    The WinRT APIs are an on-device last resort when WhatsApp UIAutomation
    hides its controls. We intentionally retain *individual word bounding
    boxes*, not only OCR lines: titles and right-column timestamps must be
    differentiated geometrically before HUKM can report senders.
    """
    try:
        import asyncio
        import io
        from winrt.windows.media import ocr
        from winrt.windows.graphics import imaging
        from winrt.windows.storage import streams

        async def recognize() -> list[Word]:
            engine = ocr.OcrEngine.try_create_from_user_profile_languages()
            if engine is None:
                raise VisualUnreadUnavailable(
                    "No local Windows OCR language pack is available.")
            buffer = io.BytesIO()
            image.convert("RGB").save(buffer, format="PNG")
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
                            value, float(b.x), float(b.y),
                            float(b.width), float(b.height)))
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

def _ocr_words(image, cancel=None) -> list[Word]:
    # Native asynchronous WinRT calls can hang beyond asyncio cancellation.
    # A read-only child process is disposable, unlike the serial input worker.
    from ..screen.ocr_process import recognize_isolated
    return recognize_isolated(image, cancel=cancel)

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

    # Initialize MSS BEFORE sampling any coordinates. On Windows its first
    # initialization may change process DPI awareness. Sampling a logical
    # window rectangle first and then grabbing physical pixels can produce
    # mismatched origins on multi-display setups.
    with mss.mss() as screen:
        _safe_foreground(hwnd)
        rect = win32gui.GetWindowRect(hwnd)
        left, top, right, bottom = rect
        window_width = right - left
        window_height = bottom - top
        if window_width < 690 or window_height < 530:
            raise VisualUnreadUnavailable(
                "WhatsApp Desktop window is too small for safe visual scanning; maximize it."
            )
        width = min(520, int(window_width * 0.57))
        height = min(920, window_height - 12)
        raw = screen.grab({"left": left, "top": top,
                           "width": width, "height": height})
        _safe_foreground(hwnd)
        if win32gui.GetWindowRect(hwnd) != rect:
            raise VisualUnreadUnavailable("WhatsApp moved during capture. Maximize it on one monitor and retry.")
        image = Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")
    return image, left, top


def _legacy_unread(words: list[Word], width: int, height: int) -> Word | None:
    """Locate a uniquely supported chip; fail closed on conflicting anchors."""
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
    if len(unread) != 1 or len(all_chips) != 1 or len(favorites) > 1:
        return None
    candidate = unread[0]
    left = all_chips[0]
    if not (28 <= candidate.width <= 150 and
            22 < candidate.cx - left.cx <= 160 and
            0 <= candidate.x - (left.x + left.width) <= 95 and
            abs(left.cy - candidate.cy) <= 18):
        return None

    if favorites:
        right = favorites[0]
        if not (candidate.cx + 22 < right.cx and
                abs(right.cy - candidate.cy) <= 23):
            return None
        return candidate

    # Favourites may be clipped or omitted by OCR. Require a distinct Chats
    # heading above the adjacent All/Unread pair as an independent anchor.
    # This is deliberately narrower than accepting an isolated Unread word.
    headings = [w for w in words if text(w) == "chats"
                and 30 <= w.cy <= candidate.cy - 40
                and 40 <= candidate.cy - w.cy <= 180
                and 35 <= w.x <= left.x + 25
                and 10 <= w.height <= 45]
    if len(headings) != 1:
        return None
    # A recognized Groups chip must not contradict the inferred ordering.
    groups = [w for w in header if text(w) == "groups"]
    if groups and (len(groups) != 1 or
                   groups[0].cx <= candidate.cx + 22 or
                   abs(groups[0].cy - candidate.cy) > 23):
        return None
    return candidate


def _text(w: Word) -> str:
    return " ".join(w.text.casefold().split())


def _search_header(words, chip):
    """Read only known search-placeholder anchors above the actual chip row."""
    row = [w for w in words if chip.cy - max(100,chip.height*8) <= w.cy < chip.cy-chip.height
           and 0 <= w.x < chip.x+chip.height*7]
    for anchor in row:
        if not _text(anchor).startswith("search"):
            continue
        nearby=sorted((w for w in row if w.x >= anchor.x and
                       abs(w.cy-anchor.cy) <= max(4,anchor.height*.45)),key=lambda w:w.x)
        phrase=" ".join(_text(w) for w in nearby)
        if phrase in ("search unread chats","search all chats","search or start a new chat","search chats","search"):
            return phrase
    return None


def _compact_unread(words,width,height):
    # Proportional geometry, plus independent Chats and search anchors.
    # No click on an isolated Unread label or arbitrary chat row.
    header=[w for w in words if 0<=w.x and w.x+w.width<=width and
            18<=w.cy<=min(300,height*.34) and 7<=w.height<=48]
    hits=[]
    for chip in header:
        if not re.fullmatch(r"unread(?:\s*\d{1,3})?",_text(chip)):
            continue
        h=chip.height
        if not 2*h <= chip.width <= 10*h or not _search_header(words,chip):
            continue
        aligned=[w for w in header if abs(w.cy-chip.cy)<=max(5,.55*h)]
        alls=[w for w in aligned if _text(w)=="all" and
              h*.3<=w.width<=4*h and
              0<=chip.x-(w.x+w.width)<=5*h]
        right=[w for w in aligned if _text(w) in ("favourites","favorites") and
               0<=w.x-(chip.x+chip.width)<=10*h]
        # The Chats title can start at the very top of a compact window.
        # Chip-row bounds must not also exclude that independent heading.
        headings=[w for w in words if _text(w)=="chats" and
                  0<=w.y and 7<=w.height<=48 and w.x+w.width<=width and
                  2*h<=chip.cy-w.cy<=18*h and w.x<=chip.x and
                  w.x>=max(0,chip.x-12*h)]
        if len(alls)==len(right)==len(headings)==1:
            hits.append(chip)
    return hits[0] if len(hits)==1 else None



def _adaptive_unread(words,width,height):
    """Resolve local sibling geometry, not a fixed set of five exact labels."""
    candidates=[]
    for chip in words:
        if not re.fullmatch(r"unread(?:\s*[:(]?\d{1,3}\)?)?",_text(chip)):
            continue
        h=chip.height
        if not (6<=h<=65 and 1.8*h<=chip.width<=13*h and
                0<=chip.x<width-chip.width and 10<=chip.cy<=min(height*.42,420)):
            continue
        # Require an actual Chats heading and a separate Search anchor ABOVE
        # the candidate. The Unread word inside a Search placeholder is not
        # itself a filter. Nearby row labels use scale-relative spacing.
        heads=[w for w in words if _text(w)=="chats" and
               1.8*h<=chip.cy-w.cy<=22*h and 0<=w.x<=chip.x+2*h]
        searches=[w for w in words if re.fullmatch(r"search(?:\s+.*)?",_text(w)) and
                  .9*h<=chip.cy-w.cy<=14*h and 0<=w.x<=chip.x+4*h]
        if len(heads)!=1 or not any(heads[0].cy+0.4*h<w.cy for w in searches):
            continue
        aligned=[w for w in words if abs(w.cy-chip.cy)<=max(4,.5*h)]
        left=[w for w in aligned if _text(w)=="all" and
              -h*.15<=chip.x-w.x-w.width<=7*h]
        right=[w for w in aligned if _text(w) in ("favourites","favorites","groups") and
               -h*.15<=w.x-chip.x-chip.width<=13*h]
        # At least one adjacent known filter plus independent top-of-pane
        # anchors. Never accept an isolated word or two distinct targets.
        if len(left)>1 or not (len(left)==1 or right):
            continue
        candidates.append(chip)
    return candidates[0] if len(candidates)==1 else None


def _header_diagnostics(words,image,stage):
    # Redact all names, previews, timestamps and arbitrary OCR text. Only
    # allowlisted UI labels and positions appear in the diagnostic log.
    labels=[]
    for w in words:
        name=_text(w)
        if name in ("chats","all","unread","favourites","favorites","groups","search","search chats","search unread chats","search all chats") or re.fullmatch(r"unread\s+\d{1,3}",name):
            if w.cy<=min(image.height*.45,440):
                labels.append((re.sub(r"\d+","#",name),round(w.x),round(w.y),round(w.width),round(w.height)))
    log.info("WhatsApp recognition stage=%s crop=%dx%d words=%d known_header_geometry=%s",
             stage,image.width,image.height,len(words),labels[:24])


def _ocr_enlarged(image,cancel):
    # Different image preprocessing, not a repeated identical attempt.
    from PIL import Image, ImageOps
    factor=min(2.5,2560/max(image.size))
    if factor<1.15:
        factor=1.0
    contrast=ImageOps.autocontrast(image.convert("L")).convert("RGB")
    if factor!=1:
        contrast=contrast.resize((round(image.width*factor),round(image.height*factor)),Image.Resampling.LANCZOS)
    return [Word(w.text,w.x/factor,w.y/factor,w.width/factor,w.height/factor)
            for w in _ocr_words(contrast,cancel=cancel)]


def _probe_native(hwnd,cancel):
    from .uia_probe import probe
    _ensure_not_cancelled(cancel)
    return probe(hwnd,cancel=cancel)


def _chip_from_probe(probe,left,top,image):
    box=probe.get("bounds")
    if not isinstance(box,list) or len(box)!=4:
        return None
    x,y,r,b=box
    x-=left;r-=left;y-=top;b-=top
    if not (0<=x<r<=image.width and 0<=y<b<=image.height and
            b-y>=8 and r-x>=12):
        return None
    return Word("Unread",x,y,r-x,b-y)


def _recover_before_click(hwnd,image,left,top,words,cancel):
    """One native probe and one different, fresh local OCR attempt, no click."""
    _header_diagnostics(words,image,"initial-miss")
    native=_probe_native(hwnd,cancel)
    chip=_chip_from_probe(native,left,top,image)
    if chip is not None:
        log.info("WhatsApp recognition path=bounded-native-accessibility")
        return image,left,top,words,chip,native
    _ensure_not_cancelled(cancel)
    _safe_foreground(hwnd)
    import win32gui
    import win32con
    if not win32gui.IsZoomed(hwnd):
        # An owner-approved read can restore/maximize its verified app.
        # Never move another application; no mouse click on unknown pixels.
        win32gui.ShowWindow(hwnd,win32con.SW_MAXIMIZE)
        time.sleep(.35)
    _ensure_not_cancelled(cancel)
    image,left,top=_capture_left(hwnd)
    words=_ocr_enlarged(image,cancel)
    _header_diagnostics(words,image,"enlarged-retry")
    chip=locate_unread(words,image.width,image.height)
    return image,left,top,words,chip,{}


def _verified_badge_count(words,chip):
    combined=re.fullmatch(r"unread\s*[:(]?\s*(\d{1,3})\)?",_text(chip))
    if combined:
        return int(combined.group(1))
    if _text(chip)!="unread":
        return None
    digits=[w for w in words if re.fullmatch(r"\d{1,3}",_text(w)) and
            abs(w.cy-chip.cy)<=max(3,chip.height*.5) and
            0<=w.x-chip.x-chip.width<=chip.height*1.5]
    return int(_text(digits[0])) if len(digits)==1 else None

def locate_unread(words: list[Word], width: int, height: int) -> Word | None:
    matches=[w for w in (_legacy_unread(words,width,height),
                         _compact_unread(words,width,height),
                         _adaptive_unread(words,width,height)) if w is not None]
    if not matches or any(w!=matches[0] for w in matches[1:]):
        return None
    # A second same-row Unread candidate remains ambiguous, even if another
    # method selected only one. Ignore labels in separate Search rows.
    target=matches[0]
    peers=[w for w in words if re.fullmatch(r"unread(?:\s*[:(]?\d{1,3}\)?)?",_text(w))
           and abs(w.cy-target.cy)<=max(4,target.height*.5)]
    return target if len(peers)==1 else None


def _visible_titles_for_layout(words, width, chip):
    # Keep established full-size row recognition. Compact font layouts use
    # scale-normalized geometry; require corroborated header and a distinct
    # right timestamp column with at least two matching rows.
    regular=visible_sender_titles(words,width,chip.y+chip.height)
    if regular or not _search_header(words,chip):
        return regular
    factor=19/max(7,chip.height)
    if factor<=1.12 or factor>2.8:
        return []
    scaled=[Word(w.text,w.x*factor,w.y*factor,w.width*factor,w.height*factor) for w in words]
    moments=[w for w in scaled if w.cy>(chip.y+chip.height)*factor+65 and
             w.cx>=max(chip.x+chip.width+chip.height*5, width*.32)*factor and _DATE.fullmatch(w.text.strip())]
    # Right edge rather than timestamp length: "Yesterday" and clock times
    # differ in width but share the same right-aligned chat column.
    clusters=[[v for v in moments if abs((v.x+v.width)-(w.x+w.width))<=24] for w in moments]
    usable=[group for group in clusters if len(group)>=2]
    if not usable:
        return []
    group=max(usable,key=len)
    if any(len(g)==len(group) and g!=group for g in usable):
        return []
    edge=max(w.x+w.width for w in group)
    return visible_sender_titles(scaled,min(round(width*factor),round(edge+20)),(chip.y+chip.height)*factor)

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
    try:
        words = _ocr_words(image, cancel=cancel)
    except VisualUnreadUnavailable:
        _ensure_not_cancelled(cancel)
        words=[]
    _ensure_not_cancelled(cancel)
    log.info("WhatsApp unread visual stage=first_ocr_complete elapsed=%.1fs",
             time.monotonic() - started)
    chip = locate_unread(words, image.width, image.height)
    native={}
    if chip is None:
        image,left,top,words,chip,native=_recover_before_click(active_hwnd,image,left,top,words,cancel)
    if chip is None:
        raise VisualUnreadUnavailable(
            "Unread filter not identified after bounded local OCR, native UIA and enlarged OCR recovery. "
            "No mouse click was attempted; see privacy-safe header geometry in controller logs."
        )
    badge=native.get("count") if native.get("count") is not None else (_verified_badge_count(words,chip) if not native else None)
    if badge==0:
        # Explicit observed badge, not a missing label or an empty OCR result.
        _safe_foreground(active_hwnd)
        _ensure_not_cancelled(cancel)
        return {"supported":True,"senders":[],"visibleChatCount":0,
                "totalUnreadChats":0,"unreadCountVerified":True,"totalUnreadMessages":0,
                "visibleOnly":False,"messagesRead":False,"filterClickAttempted":False,
                "filterSelectedVerified":True,"source":"Explicit WhatsApp Unread zero badge"}

    if native.get("selected") is True or _search_header(words,chip)=="search unread chats":
        senders=_visible_titles_for_layout(words,image.width,chip)
        _ensure_not_cancelled(cancel)
        _safe_foreground(active_hwnd)
        if not senders:
            raise VisualUnreadUnavailable("Unread filter is visible but sender rows could not be verified. No names guessed.")
        return {"supported":True,"senders":senders,"visibleChatCount":len(senders),
                "totalUnreadChats":badge,"unreadCountVerified":badge is not None,"visibleOnly":True,"messagesRead":False,
                "filterClickAttempted":False,"filterSelectedVerified":True,
                "source":"Local Windows visual OCR of existing Personal WhatsApp Unread filter",
                "note":"Existing Unread search placeholder confirms the visible filter; no additional click."}

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
    # Revalidate the exact capture geometry and foreground hit target
    # before moving, throughout visible motion, and just before clicking.
    from ..system.pointer_motion import move_visible, PointerInterrupted
    def guard():
        _ensure_not_cancelled(cancel)
        _safe_foreground(active_hwnd)
        current = win32gui.GetWindowRect(active_hwnd)
        w, h = current[2]-current[0], current[3]-current[1]
        if current[:2] != (left, top) or (min(520,int(w*0.57)),min(920,h-12)) != image.size:
            raise VisualUnreadUnavailable("WhatsApp moved or resized before click; no mouse click attempted.")
        client = win32gui.GetClientRect(active_hwnd)
        a,b=win32gui.ClientToScreen(active_hwnd,(client[0],client[1]))
        c,d=win32gui.ClientToScreen(active_hwnd,(client[2],client[3]))
        if not (a+20<x<c-20 and b+20<y<d-20):
            raise VisualUnreadUnavailable("Unread target is outside the current WhatsApp client")
        hit=win32gui.WindowFromPoint((x,y))
        if not hit or win32gui.GetAncestor(hit,2)!=active_hwnd:
            raise VisualUnreadUnavailable("Unread control is obscured by another window; no click attempted.")
    try:
        move_visible((x,y),guard)
    except PointerInterrupted as exc:
        raise VisualUnreadUnavailable(str(exc)) from exc
    guard()
    if tuple(win32api.GetCursorPos())!=(x,y):
        raise VisualUnreadUnavailable("Pointer changed before click; no names reported.")
    win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    # Leave the pointer at the actual clicked control, not its old position.
    log.info("WhatsApp unread visual stage=clicked elapsed=%.1fs",
             time.monotonic() - started)
    _ensure_not_cancelled(cancel)
    time.sleep(.4)
    _ensure_not_cancelled(cancel)
    after_image, new_left, new_top = _capture_left(active_hwnd)
    if (left, top) != (new_left, new_top) or after_image.size != image.size:
        raise VisualUnreadUnavailable(
            "WhatsApp window moved while scanning Unread; no names reported. Maximize WhatsApp on one monitor, select All, then retry without moving the window."
        )
    _ensure_not_cancelled(cancel)
    log.info("WhatsApp unread visual stage=second_ocr")
    second_words = _ocr_words(after_image, cancel=cancel)
    _ensure_not_cancelled(cancel)
    log.info("WhatsApp unread visual stage=second_ocr_complete elapsed=%.1fs",
             time.monotonic() - started)
    selected_chip = locate_unread(second_words, after_image.width, after_image.height)
    native_after={}
    if selected_chip is None or native:
        native_after=_probe_native(active_hwnd,cancel)
        selected_chip=selected_chip or _chip_from_probe(native_after,left,top,after_image)
    if selected_chip is None:
        raise VisualUnreadUnavailable(
            "Unread click attempted but filter could not be independently reverified; no repeat click."
        )
    after = _chip_background(after_image, selected_chip)
    selection_verified = (native_after.get("selected") is True or
                          _search_header(second_words,selected_chip)=="search unread chats" or
                          (not native and before >= 0 and after >= before + 7))
    if native_after.get("selected") is False:
        selection_verified=False
    count_after=native_after.get("count") if native_after.get("count") is not None else (
        _verified_badge_count(second_words,selected_chip) if not native_after else None)
    # If the chip already appeared selected, a click could have changed it.
    # Never label names 'verified unread' without positive visual evidence.
    if native_after.get("selected") is False or (native_after.get("selected") is not True and _search_header(second_words,selected_chip)!="search unread chats" and after >= 0 and before >= 0 and after + 7 < before):
        raise VisualUnreadUnavailable(
            "Unread filter appears to have switched off; no unread sender names reported."
        )

    senders = _visible_titles_for_layout(second_words,after_image.width,selected_chip)
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
        "totalUnreadChats": count_after if selection_verified else None,
        "unreadCountVerified": count_after is not None and selection_verified,
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
