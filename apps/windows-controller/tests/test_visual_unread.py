"""On-device visual WhatsApp fallback without touching real private chats.

OCR is mocked for CI. Live Windows OCR compatibility is a separate acceptance
test because the signed-in WhatsApp app isn't available in GitHub Actions.
"""
from types import SimpleNamespace
import sys

import pytest

from controller.whatsapp import visual_unread as vu, unread_senders


def words():
    return [
        vu.Word("Chats",95,65,60,21),
        vu.Word("All",107,185,26,17),
        vu.Word("Unread 8",163,183,72,19),
        vu.Word("Favourites",257,184,86,20),
        vu.Word("Reach more customers faster",130,237,235,21),
        vu.Word("Yesterday",394,373,75,18),
        vu.Word("Bhabi HQ Bina Forever",159,373,200,21),
        vu.Word("Wasalam ok",159,401,116,16),
        vu.Word("10:21 pm",394,792,72,16),
        vu.Word("Saeed Umar",159,792,136,21),
        vu.Word("0:34",159,819,35,17),
    ]


def test_native_ocr_backend_reads_a_clean_synthetic_unread_label():
    # Real Windows OCR API capability smoke, not a signed-in WhatsApp test.
    import sys
    if sys.platform != "win32":
        pytest.skip("Windows built-in OCR engine only")
    from pathlib import Path
    from PIL import Image, ImageDraw, ImageFont
    canvas=Image.new("RGB",(610,260),(24,24,24))
    paint=ImageDraw.Draw(canvas)
    font_path=Path("C:/Windows/Fonts/arial.ttf")
    font=ImageFont.truetype(str(font_path),36) if font_path.exists() else ImageFont.load_default()
    paint.text((35,84),"All",fill="white",font=font)
    paint.text((180,84),"Unread 8",fill="white",font=font)
    paint.text((410,84),"Favourites",fill="white",font=font)
    labels=vu._ocr_words(canvas)
    assert any("unread" in w.text.casefold() for w in labels)


def test_unread_button_between_verified_all_and_favourites():
    label=vu.locate_unread(words(),520,920)
    assert label is not None and "unread" in label.text.lower()


def test_no_click_without_all_or_favourites_anchor():
    all_words=words()
    assert vu.locate_unread(
        [w for w in all_words if w.text!="All"],520,920) is None
    assert vu.locate_unread(
        [w for w in all_words if w.text!="Favourites"],520,920) is None
    assert vu.locate_unread([
        vu.Word("Unread",170,490,70,21),
        vu.Word("All",108,491,25,21),
        vu.Word("Favourites",250,490,80,21),
    ],520,920) is None


def test_no_click_if_two_unread_candidates_or_wrong_order():
    x=words()
    assert vu.locate_unread(x+[vu.Word("Unread",182,186,67,18)],520,920) is None
    wrong=[vu.Word("Favourites",90,185,90,18),
           vu.Word("Unread",200,185,62,18),
           vu.Word("All",300,185,29,18)]
    assert vu.locate_unread(wrong,520,920) is None


def test_only_timestamp_paired_titles_excludes_previews_and_promo():
    result=vu.visible_sender_titles(words(),520,202)
    assert result==["Bhabi HQ Bina Forever","Saeed Umar"]
    assert "Wasalam ok" not in result
    assert "Reach more customers faster" not in result


def test_without_timestamp_do_not_guess_names():
    x=[w for w in words() if w.text not in ("Yesterday","10:21 pm")]
    assert vu.visible_sender_titles(x,520,202)==[]


def test_unread_visual_scan_requires_verified_native_foreground(monkeypatch):
    import win32api
    import win32con
    import win32gui
    from PIL import Image

    mouse=[]
    before=Image.new("RGB",(520,920),(22,23,23))
    after=Image.new("RGB",(520,920),(40,42,42))
    screenshots=iter([(before,0,0),(after,0,0)])
    monkeypatch.setattr(vu,"_capture_left",lambda hwnd:next(screenshots))
    monkeypatch.setattr(vu,"_ocr_words",lambda img: words())
    monkeypatch.setattr(vu,"_safe_foreground",lambda hwnd: None if hwnd==120 else (_ for _ in ()).throw(RuntimeError("wrong HWND")))
    monkeypatch.setattr(win32gui,"GetClientRect",lambda hwnd:(0,0,520,920))
    monkeypatch.setattr(win32gui,"ClientToScreen",lambda hwnd,pos:pos)
    monkeypatch.setattr(win32api,"GetCursorPos",lambda:(0,0))
    monkeypatch.setattr(win32api,"SetCursorPos",lambda point:mouse.append(("cursor",point)))
    monkeypatch.setattr(win32api,"mouse_event",lambda kind,*args:mouse.append(("mouse",kind)))
    monkeypatch.setattr(vu.time,"sleep",lambda sec:None)

    result=vu.visual_scan_unread(120)
    assert result["senders"]==["Bhabi HQ Bina Forever","Saeed Umar"]
    assert result["filterSelectedVerified"] is True
    assert result["messagesRead"] is False
    assert sum(1 for x in mouse if x==("mouse",win32con.MOUSEEVENTF_LEFTDOWN))==1
    assert sum(1 for x in mouse if x==("mouse",win32con.MOUSEEVENTF_LEFTUP))==1


def test_no_mouse_if_ocr_misses_header(monkeypatch):
    from PIL import Image
    import win32api
    monkeypatch.setattr(vu,"_capture_left",
                        lambda hwnd:(Image.new("RGB",(520,920)),0,0))
    monkeypatch.setattr(vu,"_ocr_words",lambda image:[vu.Word("Unread",153,180,60,20)])
    event=[]
    monkeypatch.setattr(win32api,"mouse_event",lambda *args:event.append(args))
    with pytest.raises(vu.VisualUnreadUnavailable,match="No mouse click"):
        vu.visual_scan_unread(120)
    assert event==[]


def test_existing_uia_no_match_routes_to_local_vision(monkeypatch):
    from controller.system import launcher, windows
    from controller.whatsapp import locator, unread_filter
    monkeypatch.setattr(launcher,"SIMULATE",False)
    monkeypatch.setattr(unread_senders,"IS_WINDOWS",True)
    fake=windows.WindowInfo(120,"WhatsApp","WhatsApp.exe",123)
    monkeypatch.setattr(locator,"focus_whatsapp",lambda:fake)
    monkeypatch.setattr(windows,"active_window",lambda:fake)
    root=SimpleNamespace(BoundingRectangle=SimpleNamespace(
        left=0,top=0,right=1100,bottom=900))
    fake_uia=SimpleNamespace(ControlFromHandle=lambda hwnd:root)
    monkeypatch.setitem(sys.modules,"uiautomation",fake_uia)
    monkeypatch.setattr(unread_filter,"candidates",lambda root,rect:[])
    called=[]
    monkeypatch.setattr(vu,"visual_scan_unread",
                        lambda hwnd,cancel=None:(called.append(hwnd),{"senders":["Ali"],"filterSelectedVerified":True})[1])
    assert unread_senders.read_unread_senders()["senders"]==["Ali"]
    assert called==[120]


def test_cancellation_after_first_ocr_prevents_mouse_click(monkeypatch):
    import threading
    import win32api
    from PIL import Image
    cancelled=threading.Event()
    image=Image.new("RGB",(520,920),(28,28,28))
    monkeypatch.setattr(vu,"_capture_left",lambda hwnd:(image,0,0))
    def ocr_result(_image):
        cancelled.set()
        return words()
    monkeypatch.setattr(vu,"_ocr_words",ocr_result)
    mouse=[]
    monkeypatch.setattr(win32api,"mouse_event",lambda *a:mouse.append(a))
    with pytest.raises(vu.VisualUnreadUnavailable,match="cancelled"):
        vu.visual_scan_unread(120,cancel=cancelled)
    assert mouse==[]


def test_cancellation_after_click_does_not_return_names(monkeypatch):
    import threading
    import win32api
    import win32con
    import win32gui
    from PIL import Image
    cancelled=threading.Event()
    image=Image.new("RGB",(520,920),(28,28,28))
    monkeypatch.setattr(vu,"_capture_left",lambda hwnd:(image,0,0))
    monkeypatch.setattr(vu,"_ocr_words",lambda image:words())
    monkeypatch.setattr(vu,"_safe_foreground",lambda hwnd:None)
    monkeypatch.setattr(win32gui,"GetClientRect",lambda hwnd:(0,0,520,920))
    monkeypatch.setattr(win32gui,"ClientToScreen",lambda hwnd,p:p)
    monkeypatch.setattr(win32api,"GetCursorPos",lambda:(0,0))
    monkeypatch.setattr(win32api,"SetCursorPos",lambda p:None)
    def clicked(kind,*args):
        if kind == win32con.MOUSEEVENTF_LEFTUP:
            cancelled.set()
    monkeypatch.setattr(win32api,"mouse_event",clicked)
    with pytest.raises(vu.VisualUnreadUnavailable,match="cancelled"):
        vu.visual_scan_unread(120,cancel=cancelled)


def test_cancelled_before_first_capture_never_interacts(monkeypatch):
    import threading
    import win32api
    cancelled=threading.Event()
    cancelled.set()
    monkeypatch.setattr(vu,"_capture_left",
                        lambda hwnd: (_ for _ in ()).throw(AssertionError("capture after Stop")))
    mouse=[]
    monkeypatch.setattr(win32api,"mouse_event",lambda *a:mouse.append(a))
    with pytest.raises(vu.VisualUnreadUnavailable,match="cancelled"):
        vu.visual_scan_unread(120,cancel=cancelled)
    assert mouse==[]
