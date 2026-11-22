"""Owner-approved visual fallback for Personal WhatsApp Desktop chat actions.

Only local Windows OCR. No screenshots or message bodies are sent to cloud by
this module, except an explicitly approved read_selected result. This does NOT
use WhatsApp Web, an undocumented API, or fixed coordinates. Never auto-retry
a Send after any click; WhatsApp delivery cannot be independently established.
"""
from __future__ import annotations

import re
import time

from . import locator, visual_unread as vu
from ..system import windows

class VisualReplyUnavailable(RuntimeError):
    pass


def _norm(value):
    return " ".join(str(value or "").split()).casefold()


def _same(hwnd,cancel=None):
    vu._ensure_not_cancelled(cancel)
    vu._safe_foreground(hwnd)


def _capture_band(hwnd, zone, cancel=None):
    import mss
    import win32gui
    from PIL import Image
    _same(hwnd,cancel)
    rect=win32gui.GetWindowRect(hwnd)
    monitor=vu._monitor_rect(hwnd)
    left=max(rect[0],monitor[0]);top=max(rect[1],monitor[1])
    right=min(rect[2],monitor[2]);bottom=min(rect[3],monitor[3])
    width=right-left;height=bottom-top
    if width<750 or height<540 or left-rect[0]>24 or top-rect[1]>24:
        raise VisualReplyUnavailable("WhatsApp must be visible on one monitor; no input attempted")
    # Right chat header/composer text often begins just after a ~520px
    # sidebar on a 1920px monitor. A .33 screen crop would cut off the first
    # letters of names and the "Type a message" placeholder. Message-body
    # reads stay further right to avoid harvesting the left sidebar.
    right_fraction=.33 if zone=="messages" else .25
    x=left+round(width*right_fraction)
    w=max(10,min(right-x-20,round(width*(.63 if zone=="messages" else .71))))
    if zone=="header":
        y=top+10;h=min(170,height//4)
    elif zone=="composer":
        y=bottom-175;h=150
    elif zone=="messages":
        y=top+180;h=max(1,height-390)
    else:
        raise VisualReplyUnavailable("Unknown bounded WhatsApp visual region")
    if h<55 or w<250 or y<top or y+h>bottom:
        raise VisualReplyUnavailable("WhatsApp visual region is clipped")
    with mss.mss() as screen:
        raw=screen.grab({"left":x,"top":y,"width":w,"height":h})
        _same(hwnd,cancel)
        if win32gui.GetWindowRect(hwnd)!=rect or vu._monitor_rect(hwnd)!=monitor:
            raise VisualReplyUnavailable("WhatsApp moved while reading local visual region")
        image=Image.frombytes("RGB",raw.size,raw.bgra,"raw","BGRX")
    try:
        words=vu._ocr_words(image,cancel=cancel)
    except vu.VisualUnreadUnavailable as exc:
        raise VisualReplyUnavailable("Local OCR cannot read WhatsApp visual region") from exc
    return image,words,x,y


def _phrase_hits(words,phrase):
    """Match an ENTIRE OCR line segment, never a prefix of a longer name."""
    wanted=_norm(phrase)
    hits=[]
    for first in words:
        margin=max(22,2.0*first.height)
        previous=[w for w in words if w is not first and
                  abs(w.cy-first.cy)<=max(6,first.height*.75)
                  and 0<=first.x-(w.x+w.width)<=margin]
        if previous:
            continue  # Cannot begin inside a longer nearby name/draft
        line=sorted([w for w in words
                     if abs(w.cy-first.cy)<=max(6,first.height*.75)
                     and w.x>=first.x],key=lambda w:w.x)
        current=[]
        last=None
        for i,w in enumerate(line):
            if last and w.x-(last.x+last.width)>max(34,2.5*w.height):
                break
            current.append(w)
            value=_norm(" ".join(q.text for q in current))
            if value==wanted:
                following=line[i+1] if i+1<len(line) else None
                if following is None or following.x-(w.x+w.width)>max(22,2.0*w.height):
                    hits.append((current[0],current[-1]))
                break
            if len(value)>len(wanted)+4:
                break
            last=w
    return hits

def exact_header(hwnd,expected,cancel=None):
    _,words,_,_=_capture_band(hwnd,"header",cancel)
    hits=_phrase_hits(words,expected)
    return len(hits)==1


def _click_at(hwnd,point,cancel=None):
    import win32api,win32con,win32gui
    from ..system.pointer_motion import move_visible, PointerInterrupted
    def guard():
        _same(hwnd,cancel)
        hit=win32gui.WindowFromPoint(point)
        if not hit or win32gui.GetAncestor(hit,2)!=hwnd:
            raise VisualReplyUnavailable("WhatsApp visual target is obstructed; no click")
    try:
        move_visible(point,guard)
    except PointerInterrupted as exc:
        raise VisualReplyUnavailable(str(exc)) from exc
    guard()
    if tuple(win32api.GetCursorPos())!=tuple(point):
        raise VisualReplyUnavailable("Cursor changed before verified WhatsApp click")
    win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN,0,0,0,0)
    win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP,0,0,0,0)


def _search_exact_contact_visual(hwnd, expected, image, words, left, top, chip, cancel=None):
    """Search a non-visible contact only through a confirmed empty WhatsApp Search box.

    This is an on-device OCR fallback, not WhatsApp Web or contact database
    access. If focus, the query, the unique result or final header cannot be
    verified, fail closed. No message is typed into the chat composer.
    """
    # Only a unique Search placeholder ABOVE the verified All/Unread chips
    # proves that clicking here would target the application's Search field.
    searches=[w for w in words if _norm(w.text)=="search" and
              25<=w.cy<chip.cy-max(13,chip.height) and
              image.width*.09<=w.cx<=image.width*.72 and
              7<=w.height<=40]
    if len(searches)!=1:
        raise VisualReplyUnavailable(
            "Contact is off-screen and an empty WhatsApp Search field cannot be verified. Select it manually.")
    field=searches[0]
    _same(hwnd,cancel)
    _click_at(hwnd,(left+round(field.cx),top+round(field.cy)),cancel)
    _same(hwnd,cancel)
    from ..browser.operator import _send_unicode
    typed=False
    try:
        for character in expected:
            _same(hwnd,cancel)
            typed=True
            _send_unicode(character)
    except Exception as exc:
        raise VisualReplyUnavailable(
            "WhatsApp Search typing was interrupted; inspect search text before retrying") from exc
    if not typed:
        raise VisualReplyUnavailable("Empty contact name rejected")
    time.sleep(.5)
    _same(hwnd,cancel)
    new_image,new_left,new_top=vu._capture_left(hwnd)
    if (new_left,new_top)!=(left,top) or new_image.size!=image.size:
        raise VisualReplyUnavailable("WhatsApp moved during Search. No result clicked")
    result_words=vu._ocr_words(new_image,cancel=cancel)
    # Confirm the exact query in the input row before trusting a result;
    # otherwise keystrokes may have landed in an unrelated control.
    query=[hit for hit in _phrase_hits(result_words,expected)
           if hit[0].cy<chip.cy-max(10,chip.height*.5) and
           hit[0].x<=image.width*.73]
    if len(query)!=1:
        raise VisualReplyUnavailable(
            "Typed WhatsApp Search query cannot be verified; no recipient clicked. Inspect Search manually.")
    # Search results may not show a timestamp. Require a unique ENTIRE
    # contact-title line in the left result region and verify the exact
    # right-hand chat header after the click before allowing a draft.
    matches=[]
    for hit in _phrase_hits(result_words,expected):
        start,end=hit
        if not (chip.cy+max(25,2*chip.height)<start.cy<image.height-30 and
                image.width*.15<=start.x<=image.width*.75 and
                end.x+end.width<image.width*.90):
            continue
        matches.append((left+round(start.cx),top+round(start.cy)))
    matches=list(dict.fromkeys(matches))
    if len(matches)!=1:
        raise VisualReplyUnavailable(
            "WhatsApp Search did not expose exactly one verified contact title. Select the result manually.")
    _same(hwnd,cancel)
    _click_at(hwnd,matches[0],cancel)
    time.sleep(.45)
    _same(hwnd,cancel)
    if not exact_header(hwnd,expected,cancel):
        raise VisualReplyUnavailable(
            "Search result clicked, but exact WhatsApp chat header was NOT verified. No draft or Send.")
    return {"chatSelected":True,"recipientVerified":True,
            "selectedContact":expected,"verified":True,"messagesRead":False,
            "sent":False,"source":"local WhatsApp OCR exact Search and right header",
            "note":"Verified one searched WhatsApp Desktop chat, no message sent."}


def select_chat_visual(expected,cancel=None):
    active=locator.focus_whatsapp()
    if active is None:
        raise VisualReplyUnavailable("Personal WhatsApp Desktop not foreground")
    hwnd=active.hwnd
    if exact_header(hwnd,expected,cancel):
        return {"chatSelected":True,"recipientVerified":True,
                "selectedContact":expected,"verified":True,"messagesRead":False,
                "sent":False,"source":"verified WhatsApp visible header",
                "note":"Already-selected exact recipient verified by local OCR; no click"}
    image,left,top=vu._capture_left(hwnd)
    words=vu._ocr_words(image,cancel=cancel)
    chip=vu.locate_unread(words,image.width,image.height)
    if chip is None:
        raise VisualReplyUnavailable("WhatsApp sidebar layout not verified; cannot choose recipient")
    titles=vu._visible_titles_for_layout(words,image.width,chip)
    if sum(_norm(v)==_norm(expected) for v in titles)!=1:
        # A verified empty Search placeholder can find off-screen contacts,
        # but a nonempty/unverifiable Search input is never overwritten.
        return _search_exact_contact_visual(hwnd,expected,image,words,left,top,chip,cancel)
    # Reconstruct the exact title in the SAME right-timestamp-supported row,
    # never by a substring in a preview or an arbitrary screen coordinate.
    moments=[w for w in words if vu._DATE.fullmatch(w.text.strip())
             and w.cy>chip.cy+65 and w.cx>=image.width*.6]
    hits=[]
    for moment in moments:
        tokens=sorted([w for w in words
                if chip.cy+65<w.cy<image.height and
                image.width*.17<=w.x<min(image.width*.86,moment.x-10)
                and w.x+w.width<moment.x-8 and
                abs(w.cy-moment.cy)<=max(13,1.35*moment.height)
                and not vu._DATE.fullmatch(w.text.strip())],
                key=lambda w:w.x)
        if not tokens:
            continue
        baseline=min(tokens,key=lambda w:(abs(w.cy-moment.cy),w.x))
        line=sorted((w for w in tokens if
                     abs(w.cy-baseline.cy)<=max(4,.72*max(w.height,baseline.height))),
                    key=lambda w:w.x)
        for hit in _phrase_hits(line,expected):
            x=left+round(hit[0].cx)
            y=top+round(hit[0].cy)
            hits.append((x,y))
    unique=list(dict.fromkeys(hits))
    if len(unique)!=1:
        raise VisualReplyUnavailable("Could not uniquely locate the exact visible recipient row")
    _same(hwnd,cancel)
    _click_at(hwnd,unique[0],cancel)
    time.sleep(.35)
    _same(hwnd,cancel)
    if not exact_header(hwnd,expected,cancel):
        raise VisualReplyUnavailable("Chat row clicked but exact recipient header was not verified. Do not draft or send.")
    return {"chatSelected":True,"recipientVerified":True,
            "selectedContact":expected,"verified":True,"messagesRead":False,
            "sent":False,"source":"local OCR exact chat and recipient header",
            "note":"Opened one verified visible WhatsApp Desktop chat. No message sent."}


def _composer_words(hwnd,cancel=None):
    image,words,x,y=_capture_band(hwnd,"composer",cancel)
    return image,words,x,y


def _composer_placeholder(words,image):
    # A generic single word "Message" might be a chat bubble, not a
    # composer. Require a longer, independently identifiable placeholder.
    for phrase in ("Type a message","Write a message","Type message"):
        matches=_phrase_hits(words,phrase)
        matches=[m for m in matches if m[0].cy>=image.height*.28 and
                 m[0].x<image.width*.75]
        if len(matches)==1:
            return matches[0][0]
    return None


def _exact_draft(words,message,image=None):
    matches=_phrase_hits(words,message)
    if image is not None:
        # Reject an old bubble ABOVE the composer; verify only the lower
        # composer portion of the read-only WhatsApp OCR capture.
        matches=[(a,b) for a,b in matches if
                 image.height*.48<=a.cy<=image.height*.97 and
                 a.x>=0 and b.x+b.width<image.width*.95]
    return len(matches)==1


def verified_visual_draft(hwnd, expected, message, cancel=None):
    """Read-only second opinion before a separately approved UIA Send click.

    There is deliberately NO visual Send click: WhatsApp's unlabeled paper-plane
    icon must never be guessed from a coordinate or keyboard Enter.
    """
    if not exact_header(hwnd,expected,cancel):
        return False
    image,words,_x,_y=_composer_words(hwnd,cancel)
    if not _exact_draft(words,message,image):
        return False
    return exact_header(hwnd,expected,cancel)


def draft_reply_visual(expected,message,cancel=None):
    if not message or len(message)>240 or any(ch in message for ch in ("\r","\n","\t")):
        raise VisualReplyUnavailable(
            "Visual draft accepts one line up to 240 characters; no text entered")
    active=locator.focus_whatsapp()
    if active is None:
        raise VisualReplyUnavailable("Personal WhatsApp Desktop not foreground")
    if not exact_header(active.hwnd,expected,cancel):
        raise VisualReplyUnavailable("Exact WhatsApp recipient header not verified before draft")
    image,words,left,top=_composer_words(active.hwnd,cancel)
    placeholder=_composer_placeholder(words,image)
    if placeholder is None:
        raise VisualReplyUnavailable(
            "Empty WhatsApp message composer not uniquely visible; existing draft was not changed")
    _same(active.hwnd,cancel)
    _click_at(active.hwnd,(left+round(placeholder.cx),top+round(placeholder.cy)),cancel)
    if not exact_header(active.hwnd,expected,cancel):
        raise VisualReplyUnavailable("Recipient changed before typing. No draft entered.")
    from ..browser.operator import _send_unicode
    # Never press Enter, click Send, or paste arbitrary clipboard contents.
    for character in message:
        _same(active.hwnd,cancel)
        _send_unicode(character)
    _same(active.hwnd,cancel)
    if not exact_header(active.hwnd,expected,cancel):
        raise VisualReplyUnavailable("Recipient changed during draft; inspect WhatsApp manually. No Send attempted.")
    after_image,after,_,_=_composer_words(active.hwnd,cancel)
    if not _exact_draft(after,message,after_image):
        raise VisualReplyUnavailable(
            "Draft text could not be reverified from local WhatsApp OCR. It MAY be present; inspect manually before retry.")
    return {"recipientVerified":True,"draftEntered":True,"sent":False,
            "verified":False,"contact":expected,"source":"local WhatsApp visual composer OCR",
            "note":"Exact draft verified visually. It has NOT been sent; separate owner confirmation required."}


def read_selected_visual(expected,cancel=None):
    if not expected:
        raise VisualReplyUnavailable("An exact recipient is required for visual message reading")
    active=locator.focus_whatsapp()
    if active is None or not exact_header(active.hwnd,expected,cancel):
        raise VisualReplyUnavailable("Exact WhatsApp chat header not verified")
    _,words,_,_=_capture_band(active.hwnd,"messages",cancel)
    if not exact_header(active.hwnd,expected,cancel):
        raise VisualReplyUnavailable("Recipient changed while reading; no text returned")
    # Visible right-pane OCR only; sender/direction and complete history cannot
    # be inferred from bubble positions. The owner approved this read.
    lines={}
    for w in words:
        if not w.text.strip():
            continue
        key=round(w.cy/16)
        lines.setdefault(key,[]).append(w)
    results=[" ".join(w.text for w in sorted(line,key=lambda w:w.x))
             for _,line in sorted(lines.items())]
    results=[v[:240] for v in results if len(v)>1]
    if not results:
        raise VisualReplyUnavailable("No locally readable text in selected chat")
    return {"visibleMessages":results[-8:],"messagesRead":True,
            "visibleOnly":True,"transferredToAccount":True,
            "source":"local visual OCR of verified selected WhatsApp chat",
            "note":"Visible right-pane OCR only. Text stored in authenticated HUKM command history; message direction not inferred."}


