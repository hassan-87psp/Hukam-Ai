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


def _check_capture_owner(hwnd,left,top,width,height):
    """Reject sampled regions obscured by another top-level window."""
    import win32gui
    for dx,dy in ((25,30),(width//2,30),(width-25,30),
                  (25,height//2),(width//2,height//2),(width-25,height//2)):
        hit=win32gui.WindowFromPoint((left+dx,top+dy))
        if not hit or win32gui.GetAncestor(hit,2)!=hwnd:
            raise VisualUnreadUnavailable("WhatsApp capture area is overlapped by another window")


def _is_maximized(hwnd):
    # pywin32's win32gui does not export IsZoomed on supported builds.
    # GetWindowPlacement is supported and showCmd uses SW_SHOWMAXIMIZED.
    import win32gui
    import win32con
    return win32gui.GetWindowPlacement(hwnd)[1] == win32con.SW_SHOWMAXIMIZED


def _monitor_rect(hwnd):
    import win32api
    return tuple(win32api.GetMonitorInfo(win32api.MonitorFromWindow(hwnd, 2))["Monitor"])


def _visible_region(rect, monitor):
    """Keep maximized invisible frame margins out of the physical OCR crop.

    Coordinates remain signed virtual desktop pixels on either monitor.
    Refuse large clipping instead of guessing the position of the sidebar.
    """
    left, top, right, bottom = rect
    ml, mt, mr, mb = monitor
    width, height = right - left, bottom - top
    x, y = max(left, ml), max(top, mt)
    capture_width = min(520, int(width * .57))
    capture_height = min(920, bottom - y - 12, mb - y)
    if (width < 690 or height < 530 or capture_height < 400
            or x - left > 24 or y - top > 24
            or x + capture_width > min(right, mr)):
        raise VisualUnreadUnavailable(
            "WhatsApp window is too small or sidebar clipped; maximize on one monitor.")
    return x, y, capture_width, capture_height


def _same_capture(hwnd, image, left, top):
    import win32gui
    return _visible_region(win32gui.GetWindowRect(hwnd), _monitor_rect(hwnd)) == (
        left, top, image.width, image.height)


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
        monitor = _monitor_rect(hwnd)
        left, top, width, height = _visible_region(rect, monitor)
        _check_capture_owner(hwnd,left,top,width,height)
        raw = screen.grab({"left": left, "top": top,
                           "width": width, "height": height})
        _safe_foreground(hwnd)
        if win32gui.GetWindowRect(hwnd) != rect or _monitor_rect(hwnd) != monitor:
            raise VisualUnreadUnavailable("WhatsApp moved during capture.")
        _check_capture_owner(hwnd,left,top,width,height)
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
        heads=[w for w in heads if any(w.cy+0.4*h<q.cy for q in searches)]
        if len(heads)!=1:
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
    import win32gui
    current=win32gui.GetWindowRect(hwnd)
    if native.get("windowRect")!=list(current) or not _same_capture(hwnd,image,left,top):
        native={}
    chip=_chip_from_probe(native,left,top,image)
    if chip is not None:
        log.info("WhatsApp recognition path=bounded-native-accessibility")
        return image,left,top,words,chip,native
    _ensure_not_cancelled(cancel)
    _safe_foreground(hwnd)
    import win32con
    if not _is_maximized(hwnd):
        # An owner-approved read can restore/maximize its verified app.
        # Never move another application; no mouse click on unknown pixels.
        win32gui.ShowWindow(hwnd,win32con.SW_MAXIMIZE)
        time.sleep(.35)
    _ensure_not_cancelled(cancel)
    image,left,top=_capture_left(hwnd)
    # Use the same top-header geometry that succeeded in the owner's
    # Windows diagnostic; keep the full screenshot only for later row reading.
    header_height=min(image.height, max(240, min(400, round(image.width*.6))))
    header=image.crop((0,0,image.width,header_height))
    try:
        words=_ocr_words(header,cancel=cancel)
    except VisualUnreadUnavailable:
        _ensure_not_cancelled(cancel)
        words=[]
    _ensure_not_cancelled(cancel)
    _header_diagnostics(words,image,"native-header-retry")
    chip=locate_unread(words,image.width,image.height)
    if chip is None:
        # A different local OCR preprocessing pass, only if raw header failed.
        words=_ocr_enlarged(header,cancel)
        _ensure_not_cancelled(cancel)
        _header_diagnostics(words,image,"enlarged-header-retry")
        chip=locate_unread(words,image.width,image.height)
    if chip is not None and _search_header(words,chip)=="search unread chats":
        # Already selected: need fresh full-row OCR, not header-only names.
        _ensure_not_cancelled(cancel)
        row_words=_ocr_words(image,cancel=cancel)
        split=chip.cy+chip.height*2
        words=[w for w in words if w.cy<=split]+[w for w in row_words if w.cy>split]
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
    """First try native row geometry, then a bounded compact-font transform.

    A filtered list with a *single* visible chat must also be supported;
    demanding two aligned timestamps silently rejected that valid case.
    No names are reported without a corroborating right-column timestamp.
    """
    regular=visible_sender_titles(words,width,chip.y+chip.height)
    if regular or not _search_header(words,chip):
        return regular
    factor=19/max(7,chip.height)
    if factor<=1.12 or factor>2.8:
        return []
    scaled=[Word(w.text,w.x*factor,w.y*factor,w.width*factor,w.height*factor) for w in words]
    # The user has a 520px WhatsApp sidebar, but compact fonts shrink the
    # visible timestamp column. Infer its right edge from actual date labels,
    # never a fixed 355px name boundary. Reject ambiguous competing columns.
    moments=[w for w in words
             if w.cy>chip.y+chip.height+35 and
             w.cx>=max(chip.x+chip.width+3*chip.height,width*.31) and
             _DATE.fullmatch(w.text.strip())]
    if not moments:
        return []
    clusters=[[v for v in moments
               if abs((v.x+v.width)-(w.x+w.width))<=max(16,chip.height*2.5)]
              for w in moments]
    group=max(clusters,key=len)
    if len(group)>1 and any(len(g)==len(group) and g!=group for g in clusters):
        return []
    if len(group)==1 and len(moments)>1:
        # Multiple unaligned apparent timestamp columns are ambiguous.
        return []
    edge=max(w.x+w.width for w in group)
    inferred_width=min(round(width*factor),round((edge+22)*factor))
    return visible_sender_titles(scaled,inferred_width,(chip.y+chip.height)*factor)


_SKIP = {
    "all", "unread", "favourites", "favorites", "chats", "archived",
    "get started", "new chat", "settings", "search", "status",
    "whatsapp", "calls", "new", "more", "groups", "today",
}
_PROMO = re.compile(
    r"(?:reach more customers|business broadcast|create a business|"
    r"update payment|start a new chat|get started|search or start)", re.I)
_DATE = re.compile(
    r"^(?:yesterday|today|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|"
    r"thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|"
    r"\d{1,2}[:.]\d{2}(?:\s*[ap]\.?m\.?)?|"
    r"\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?|"
    r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2})$",re.I)


def visible_sender_titles(words: list[Word], width: int, chip_bottom: float) -> list[str]:
    """Extract only timestamp-aligned chat headings, never their preview lines.

    The former fixed x=120..355 cutoff dropped compact and multi-word chat
    titles. Derive text bounds from the *actual timestamp* on that row.
    WhatsApp may OCR '6:25' and 'PM' as two words; the clock alone anchors it.
    """
    row_top=chip_bottom+max(34,min(60,chip_bottom*.22))
    times=sorted((w for w in words if row_top<w.cy<min(920,chip_bottom+850)
                  and w.cx>=width*.60 and _DATE.fullmatch(w.text.strip())),
                 key=lambda w:(w.cy,w.x))
    names=[]
    for moment in times:
        minimum=max(82,width*.17)
        cutoff=min(width*.86,moment.x-max(9,moment.height*.7))
        # The timestamp is on the heading line; a lower preview line does
        # not qualify even if it contains a tempting contact-like string.
        tolerance=max(13,1.35*moment.height)
        possible=[w for w in words
                  if row_top<w.cy<min(920,chip_bottom+850)
                  and minimum<=w.x<cutoff and w.x+w.width<=cutoff
                  and 7<=w.height<=40 and len(w.text)<=65
                  and abs(w.cy-moment.cy)<=tolerance
                  and w.text.strip().casefold() not in _SKIP
                  and not _PROMO.search(w.text)
                  and not _DATE.fullmatch(w.text.strip())
                  and w.text.strip() not in ("AM","PM","am","pm")]
        if not possible:
            continue
        nearest=min(possible,key=lambda w:(abs(w.cy-moment.cy),w.x))
        line=sorted((w for w in possible
                     if abs(w.cy-nearest.cy)<=max(4,.72*max(nearest.height,w.height))),
                    key=lambda w:w.x)
        if not line:
            continue
        parts=[line[0]]
        for word in line[1:]:
            previous=parts[-1]
            if word.x-(previous.x+previous.width)>max(17,1.45*max(word.height,previous.height)):
                break
            parts.append(word)
        title=" ".join(w.text.strip() for w in parts).strip()
        if 2<=len(title)<=65 and title.casefold() not in _SKIP and title not in names:
            names.append(title)
    return names[:12]


def _row_geometry_diagnostics(words,image,chip,stage):
    """Privacy-safe telemetry: geometry/counts only, NEVER names or previews."""
    row=[w for w in words if chip.y+chip.height+30<w.cy<image.height]
    dates=[w for w in row if _DATE.fullmatch(w.text.strip())]
    right=[w for w in dates if w.cx>=image.width*.60]
    log.info("WhatsApp row recognition stage=%s crop=%dx%d words=%d row_words=%d "
             "date_tokens=%d right_date_tokens=%d timestamp_geometry=%s",
             stage,image.width,image.height,len(words),len(row),len(dates),
             len(right),[(round(w.x),round(w.y),round(w.width),round(w.height))
                         for w in right[:8]])


def _explicit_empty_unread(words,chip,width):
    """Require the explicit empty-list wording; missing rows are NOT zero."""
    content=[w for w in words if chip.y+chip.height+48<w.cy<900
             and 0<=w.x<w.x+w.width<=width]
    for anchor in content:
        if anchor.text.strip().casefold() not in ("no","you"):
            continue
        nearby=sorted((w for w in content
                       if abs(w.cy-anchor.cy)<=max(7,anchor.height*.8)
                       and anchor.x<=w.x<=anchor.x+300),key=lambda w:w.x)
        sentence=" ".join(w.text.strip().casefold() for w in nearby)
        if sentence in ("no unread chats","no unread messages",
                        "no unread conversations","you have no unread chats",
                        "you have no unread messages"):
            return True
    return False

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



def _capture_for_scan(hwnd,cancel):
    """Resize the verified app once if it is truly too small to inspect."""
    try:
        return _capture_left(hwnd)
    except VisualUnreadUnavailable as exc:
        if "too small" not in str(exc):
            # One pre-click recovery of the SAME native window. Never retry
            # a click or accept a newly selected unrelated app.
            if not any(reason in str(exc) for reason in ("overlapped","foreground","moved during capture")):
                raise
            _ensure_not_cancelled(cancel)
            recovered=locator.focus_whatsapp()
            if recovered is None or recovered.hwnd!=hwnd:
                raise
            _ensure_not_cancelled(cancel)
            return _capture_left(hwnd)
    _ensure_not_cancelled(cancel)
    _safe_foreground(hwnd)
    import win32gui
    import win32con
    if _is_maximized(hwnd):
        raise VisualUnreadUnavailable("WhatsApp client is too small even when maximized")
    win32gui.ShowWindow(hwnd,win32con.SW_MAXIMIZE)
    time.sleep(.35)
    _ensure_not_cancelled(cancel)
    return _capture_left(hwnd)


def visual_read_count(hwnd,cancel=None):
    """Read a count without clicking any control or opening any conversation."""
    _ensure_not_cancelled(cancel)
    image,left,top=_capture_for_scan(hwnd,cancel)
    try:
        words=_ocr_words(image,cancel=cancel)
    except VisualUnreadUnavailable:
        _ensure_not_cancelled(cancel)
        words=[]
    chip=locate_unread(words,image.width,image.height)
    if chip is not None:
        count=_verified_badge_count(words,chip)
        if count is not None:
            _safe_foreground(hwnd)
            _ensure_not_cancelled(cancel)
            return count
    image,left,top,words,chip,native=_recover_before_click(hwnd,image,left,top,words,cancel)
    count=native.get("count")
    if count is None and chip is not None and not native:
        count=_verified_badge_count(words,chip)
    _safe_foreground(hwnd)
    _ensure_not_cancelled(cancel)
    return count


def _green_badge(image,w):
    """Color evidence corroborates an OCR numeral; never count colored blobs."""
    pad=max(3,round(w.height*.65))
    box=(max(0,int(w.x-pad)),max(0,int(w.y-pad)),
         min(image.width,int(w.x+w.width+pad)),min(image.height,int(w.y+w.height+pad)))
    if box[2]<=box[0] or box[3]<=box[1]:
        return False
    patch=image.crop(box).convert("RGB")
    pixels=list(patch.getdata())
    return bool(pixels) and sum(g>=95 and g-r>=32 and g-b>=18 for r,g,b in pixels)/len(pixels)>=.24


def _conversation_counts(image,words,names,chip):
    """Only associate an explicit green numeric badge with a unique title/time row."""
    h=max(8,min(chip.height,26))
    counts={}
    for name in names:
        matches=[]
        for moment in words:
            if not _DATE.fullmatch(moment.text.strip()) or moment.cy<=chip.cy+3*h:
                continue
            row=sorted((w for w in words if w.x+w.width<moment.x-h*.45 and
                w.x>=max(0,chip.x-5*h) and abs(w.cy-moment.cy)<=max(4,.5*h) and
                not _DATE.fullmatch(w.text.strip())),key=lambda w:w.x)
            if not row:
                continue
            # Require the exact already-recognized sender title on that row.
            if " ".join(w.text.strip() for w in row).casefold()!=name.casefold():
                continue
            badges=[w for w in words if re.fullmatch(r"[1-9]\d{0,3}",w.text.strip()) and
                    .45*h<=w.cy-moment.cy<=3.5*h and
                    abs(w.cx-(moment.x+moment.width))<=2.2*h and _green_badge(image,w)]
            if len(badges)==1:
                matches.append(int(badges[0].text.strip()))
        if len(matches)==1:
            counts[name]=matches[0]
    return [{"name":name,"unreadMessages":counts.get(name)} for name in names]


def _result_counts(image,words,senders,chip,count,verified):
    rows=_conversation_counts(image,words,senders,chip) if verified else [
        {"name":name,"unreadMessages":None} for name in senders]
    # Matching visible unique rows to an explicit app badge is still not
    # a provider API proof of complete coverage. Do not certify a total
    # unread-message count from a partial OCR viewport.
    return {"conversations":rows,"totalUnreadMessages":None,
            "totalUnreadChats":count if verified else None,
            "unreadCountVerified":count is not None and verified}


def _collect_unread_pages(hwnd, image, left, top, words, chip, badge, cancel):
    """Read the selected native Unread sidebar, scrolling ONLY that pane.

    No conversations are opened. Every accepted title comes from a timestamp-
    corroborated row of the local screenshot. A matching badge count establishes
    visible coverage, not message-body access or provider API verification.
    """
    import hashlib
    import win32api
    import win32con
    import win32gui
    from ..system.pointer_motion import move_visible, PointerInterrupted

    _ensure_not_cancelled(cancel)
    found=[]
    seen=set()
    pages=0
    stop="limit"
    first_words=words
    previous_digest=None
    unchanged=0
    cap=12  # bounded owner-approved scan; never an unbounded cursor loop
    scan_started=time.monotonic()
    for index in range(cap):
        _ensure_not_cancelled(cancel)
        if time.monotonic()-scan_started>65:
            stop="time_budget"
            break
        _safe_foreground(hwnd)
        if not _same_capture(hwnd,image,left,top):
            stop="window_changed"
            break
        if index:
            # Each fresh screenshot is of the SAME WhatsApp window/sidebar.
            try:
                words=_ocr_words(image,cancel=cancel)
            except VisualUnreadUnavailable:
                _ensure_not_cancelled(cancel)
                stop="ocr_unavailable"
                break
            new_chip=locate_unread(words,image.width,image.height)
            if new_chip is None or abs(new_chip.cy-chip.cy)>max(10,chip.height):
                stop="filter_not_verified"
                break
        pages+=1
        names=_visible_titles_for_layout(words,image.width,chip)
        if not names and index==0 and _explicit_empty_unread(words,chip,image.width):
            return {"senders":[],"visibleChatCount":0,"scanPages":pages,
                    "allBadgeChatsMatched":badge==0,"scanStopped":"explicit_empty",
                    "conversations":[]}
        for name in names:
            key=name.casefold().strip()
            if key and key not in seen:
                seen.add(key)
                found.append(name)
        log.info("WhatsApp unread page=%d verified_titles=%d unique_total=%d badge_known=%s",
                 pages,len(names),len(found),badge is not None)
        if badge is not None and len(found)>=badge:
            stop="badge_matched"
            break
        if len(found)>=100:
            stop="names_limit"
            break
        # Only a verified point well INSIDE the chat list receives a wheel
        # event; it is never a click or a drag, and never the right message pane.
        target_x=left+round(min(image.width-70,max(chip.cx+12,image.width*.40)))
        target_y=top+round(min(image.height-85,max(chip.cy+145,image.height*.70)))
        def guard():
            _ensure_not_cancelled(cancel)
            _safe_foreground(hwnd)
            if not _same_capture(hwnd,image,left,top):
                raise VisualUnreadUnavailable("WhatsApp moved while scrolling the Unread list")
            hit=win32gui.WindowFromPoint((target_x,target_y))
            if not hit or win32gui.GetAncestor(hit,2)!=hwnd:
                raise VisualUnreadUnavailable("WhatsApp Unread list was obscured while scrolling")
        try:
            move_visible((target_x,target_y),guard)
        except PointerInterrupted as exc:
            raise VisualUnreadUnavailable(str(exc)) from exc
        guard()
        if tuple(win32api.GetCursorPos())!=(target_x,target_y):
            raise VisualUnreadUnavailable("Cursor moved before unread scrolling")
        # Sample only left chat rows, excluding right-side message bodies.
        row_top=max(0,min(image.height-30,round(chip.cy+chip.height+45)))
        digest=hashlib.sha256(image.crop((0,row_top,image.width,image.height)).tobytes()).digest()
        guard()
        win32api.mouse_event(win32con.MOUSEEVENTF_WHEEL,0,0,-360,0)
        time.sleep(.36)
        _ensure_not_cancelled(cancel)
        new_image,new_left,new_top=_capture_left(hwnd)
        if (left,top)!=(new_left,new_top) or new_image.size!=image.size:
            stop="window_changed"
            break
        after_digest=hashlib.sha256(new_image.crop((0,row_top,image.width,image.height)).tobytes()).digest()
        unchanged = unchanged+1 if after_digest==digest else 0
        image=new_image
        # Two verified no-change pages signal bottom/no scroll.
        if unchanged>=2:
            stop="end_of_list"
            break
    complete=(badge is not None and len(found)==badge)
    return {"senders":found,"visibleChatCount":len(found),
            "scanPages":pages,"allBadgeChatsMatched":complete,
            "scanStopped":stop,"conversations":[
                {"name":name,"unreadMessages":None} for name in found],
            "unverifiedChatCount":max(0,badge-len(found)) if badge is not None else None}


def visual_scan_unread(active_hwnd: int, cancel=None) -> dict:
    """Approved, foreground-only local OCR + real mouse click + verified list."""
    import win32api
    import win32con
    import win32gui

    started = time.monotonic()
    _ensure_not_cancelled(cancel)
    log.info("WhatsApp unread visual stage=first_capture")
    image, left, top = _capture_for_scan(active_hwnd,cancel)
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
        # Already selected. Never click a second time; scan the visible list
        # page by page, using only a verified left-sidebar wheel target.
        scan=_collect_unread_pages(active_hwnd,image,left,top,words,chip,badge,cancel)
        _ensure_not_cancelled(cancel)
        _safe_foreground(active_hwnd)
        if not scan["senders"] and scan["scanStopped"]!="explicit_empty":
            raise VisualUnreadUnavailable("Unread selected but no sender rows could be verified after bounded sidebar scan.")
        return {"supported":True,**scan,"totalUnreadChats":badge if badge is not None else None,
                "unreadCountVerified":badge is not None,"totalUnreadMessages":None,
                "visibleOnly":True,"messagesRead":False,
                "filterClickAttempted":False,"filterSelectedVerified":True,
                "source":"Local Windows OCR of verified Personal WhatsApp Unread sidebar",
                "note":"Scrolled only the WhatsApp left Unread list. No chats opened or messages sent."}

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
        if not _same_capture(active_hwnd,image,left,top):
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
        if native_after.get("windowRect")!=list(win32gui.GetWindowRect(active_hwnd)):
            native_after={}
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

    _row_geometry_diagnostics(second_words,after_image,selected_chip,"post-click-original")
    senders = _visible_titles_for_layout(second_words,after_image.width,selected_chip)
    if not senders:
        # Different OCR preprocessing on the SAME verified screenshot.
        # No repeat click, no chat opening, no screenshot retention/upload.
        _ensure_not_cancelled(cancel)
        log.info("WhatsApp unread visual stage=enhanced_post_click_ocr")
        try:
            enhanced=_ocr_enlarged(after_image,cancel)
        except VisualUnreadUnavailable:
            _ensure_not_cancelled(cancel)
            enhanced=[]
        if enhanced:
            # A second OCR transform may lose tiny filter labels yet read the
            # larger chat rows correctly. The original filter was independently
            # verified on this SAME captured image; reuse its trusted header.
            cutoff=selected_chip.y+selected_chip.height+35
            header_words=[w for w in second_words if w.cy<cutoff]
            row_words=[w for w in enhanced if w.cy>=cutoff]
            merged=header_words+row_words
            _row_geometry_diagnostics(merged,after_image,selected_chip,"post-click-enhanced")
            senders=_visible_titles_for_layout(merged,after_image.width,selected_chip)
            if senders or _explicit_empty_unread(merged,selected_chip,after_image.width):
                second_words=merged
    if not senders:
        # Only an explicitly observed empty state can establish zero. The
        # absence of OCR-recognized rows does NOT establish an empty inbox.
        empty=(selection_verified and (
            _explicit_empty_unread(second_words,selected_chip,after_image.width)))
        if empty:
            return {"supported":True,"senders":[],"visibleChatCount":0,
                    "totalUnreadChats":0,"unreadCountVerified":True,
                    "totalUnreadMessages":0,"visibleOnly":False,
                    "messagesRead":False,"filterClickAttempted":True,
                    "filterSelectedVerified":True,
                    "source":"Explicit WhatsApp empty Unread-filter list"}
        # Another page may contain the sender names; the bounded, verified
        # sidebar scan below must run before reporting an OCR failure.
        log.info("WhatsApp first page had no verifiable sender row; checking more Unread pages")
    if not selection_verified:
        raise VisualUnreadUnavailable(
            "Sender rows recognized, but Unread filter selection was not verified; "
            "no unverified unread names reported."
        )
    _ensure_not_cancelled(cancel)
    scan=_collect_unread_pages(active_hwnd,after_image,left,top,second_words,
                               selected_chip,count_after,cancel)
    if not scan["senders"] and scan["scanStopped"]!="explicit_empty":
        raise VisualUnreadUnavailable("Unread list scanned but no timestamp-verified chat names were found. Do not infer zero.")
    return {"supported":True,**scan,
            "totalUnreadChats":count_after if count_after is not None else None,
            "unreadCountVerified":count_after is not None,
            "totalUnreadMessages":None,"visibleOnly":True,
            "messagesRead":False,"filterClickAttempted":True,
            "filterSelectedVerified":True,
            "source":"Local Windows OCR of Personal WhatsApp Unread chat list",
            "note":"Unread selected, left sidebar scanned page by page; no conversations opened or messages sent."
    }
