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


def test_missing_favourites_uses_independent_chats_heading():
    x = [w for w in words() if w.text != "Favourites"]
    label = vu.locate_unread(x, 520, 920)
    assert label is not None and label.text == "Unread 8"


def test_no_click_without_independent_header_anchors():
    x = words()
    assert vu.locate_unread(
        [w for w in x if w.text != "All"], 520, 920) is None
    assert vu.locate_unread(
        [w for w in x if w.text not in ("Favourites", "Chats")], 520, 920) is None
    assert vu.locate_unread([
        vu.Word("Unread", 170, 490, 70, 21),
        vu.Word("All", 108, 491, 25, 21),
        vu.Word("Favourites", 250, 490, 80, 21),
    ], 520, 920) is None


def test_fallback_rejects_bad_geometry_and_conflicting_anchors():
    x = [w for w in words() if w.text != "Favourites"]
    assert vu.locate_unread(x + [vu.Word("Unread", 180, 185, 67, 18)], 520, 920) is None
    assert vu.locate_unread(x + [vu.Word("Chats", 96, 102, 60, 21)], 520, 920) is None
    assert vu.locate_unread(x + [vu.Word("Groups", 85, 185, 50, 20)], 520, 920) is None
    assert vu.locate_unread(x + [vu.Word("Favourites", 257, 240, 86, 20)], 520, 920) is None
    far = [w for w in x if not w.text.startswith("Unread")]
    assert vu.locate_unread(far + [vu.Word("Unread", 340, 183, 72, 19)], 520, 920) is None
    off_row = [w for w in x if not w.text.startswith("Unread")]
    assert vu.locate_unread(off_row + [vu.Word("Unread", 163, 220, 72, 19)], 520, 920) is None


def test_fallback_accepts_aligned_groups_to_right():
    x = [w for w in words() if w.text != "Favourites"]
    assert vu.locate_unread(x + [vu.Word("Groups", 257, 184, 60, 20)], 520, 920) is not None


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
    monkeypatch.setattr(vu,"_ocr_words",lambda img, cancel=None: words())
    monkeypatch.setattr(vu,"_safe_foreground",lambda hwnd: None if hwnd==120 else (_ for _ in ()).throw(RuntimeError("wrong HWND")))
    monkeypatch.setattr(win32gui,"GetClientRect",lambda hwnd:(0,0,520,920))
    monkeypatch.setattr(win32gui,"ClientToScreen",lambda hwnd,pos:pos)
    pointer=[(0,0)]
    monkeypatch.setattr(win32gui,"GetWindowRect",lambda hwnd:(0,0,1000,1000))
    monkeypatch.setattr(vu,"_monitor_rect",lambda hwnd:(0,0,1920,1080))
    monkeypatch.setattr(win32gui,"WindowFromPoint",lambda point:120)
    monkeypatch.setattr(win32gui,"GetAncestor",lambda hwnd,flag:120)
    monkeypatch.setattr(win32api,"GetCursorPos",lambda:pointer[0])
    def move(point):
        pointer[0]=point
        mouse.append(("cursor",point))
    monkeypatch.setattr(win32api,"SetCursorPos",move)
    monkeypatch.setattr(win32api,"mouse_event",lambda kind,*args:mouse.append(("mouse",kind)))
    monkeypatch.setattr(vu.time,"sleep",lambda sec:None)

    result=vu.visual_scan_unread(120)
    assert result["senders"]==["Bhabi HQ Bina Forever","Saeed Umar"]
    assert result["filterSelectedVerified"] is True
    assert result["messagesRead"] is False
    assert len([x for x in mouse if x[0]=="cursor"])==24
    assert pointer[0]==(199,192)
    assert sum(1 for x in mouse if x==("mouse",win32con.MOUSEEVENTF_LEFTDOWN))==1
    assert sum(1 for x in mouse if x==("mouse",win32con.MOUSEEVENTF_LEFTUP))==1


def test_no_mouse_if_ocr_misses_header(monkeypatch):
    from PIL import Image
    import win32api
    monkeypatch.setattr(vu,"_capture_left",
                        lambda hwnd:(Image.new("RGB",(520,920)),0,0))
    monkeypatch.setattr(vu,"_ocr_words",lambda image, cancel=None:[vu.Word("Unread",153,180,60,20)])
    monkeypatch.setattr(vu,"_recover_before_click",lambda hwnd,img,left,top,words,cancel:(img,left,top,words,None,{}))
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
    def ocr_result(_image, cancel=None):
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
    monkeypatch.setattr(vu,"_ocr_words",lambda image, cancel=None:words())
    monkeypatch.setattr(vu,"_safe_foreground",lambda hwnd:None)
    monkeypatch.setattr(win32gui,"GetClientRect",lambda hwnd:(0,0,520,920))
    monkeypatch.setattr(win32gui,"ClientToScreen",lambda hwnd,p:p)
    pointer=[(0,0)]
    monkeypatch.setattr(win32gui,"GetWindowRect",lambda hwnd:(0,0,1000,1000))
    monkeypatch.setattr(vu,"_monitor_rect",lambda hwnd:(0,0,1920,1080))
    monkeypatch.setattr(win32gui,"WindowFromPoint",lambda point:120)
    monkeypatch.setattr(win32gui,"GetAncestor",lambda hwnd,flag:120)
    monkeypatch.setattr(win32api,"GetCursorPos",lambda:pointer[0])
    monkeypatch.setattr(win32api,"SetCursorPos",lambda p:pointer.__setitem__(0,p))
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


def test_capture_initializes_dpi_context_before_window_rect(monkeypatch):
    import mss
    import win32gui
    from PIL import Image
    initialized = False
    class Screen:
        def __enter__(self):
            nonlocal initialized
            initialized = True
            return self
        def __exit__(self, *args):
            pass
        def grab(self, rect):
            assert initialized
            assert rect["left"] == -1920
            assert rect["top"] == 0
            return SimpleNamespace(size=(rect["width"],rect["height"]),
                bgra=bytes(rect["width"]*rect["height"]*4))
    def rect(hwnd):
        assert initialized, "Do not sample logical coordinates before MSS initializes"
        return (-1920,0,-200,1080)
    monkeypatch.setattr(mss,"mss",Screen)
    monkeypatch.setattr(win32gui,"GetWindowRect",rect)
    monkeypatch.setattr(vu,"_monitor_rect",lambda hwnd:(-1920,0,0,1080))
    monkeypatch.setattr(vu,"_safe_foreground",lambda hwnd:None)
    monkeypatch.setattr(vu,"_check_capture_owner",lambda *a:None)
    image,left,top=vu._capture_left(120)
    assert (left,top)==(-1920,0)
    assert image.size==(520,920)


def test_capture_rejects_window_motion_before_any_ocr(monkeypatch):
    import mss
    import win32gui
    class Screen:
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def grab(self,rect): return None
    rectangles=iter([(0,0,1200,1000),(8,0,1208,1000)])
    monkeypatch.setattr(mss,"mss",Screen)
    monkeypatch.setattr(win32gui,"GetWindowRect",lambda hwnd:next(rectangles))
    monkeypatch.setattr(vu,"_monitor_rect",lambda hwnd:(0,0,1920,1080))
    monkeypatch.setattr(vu,"_safe_foreground",lambda hwnd:None)
    monkeypatch.setattr(vu,"_check_capture_owner",lambda *a:None)
    with pytest.raises(vu.VisualUnreadUnavailable,match="moved during capture"):
        vu._capture_left(120)

def compact_words():
    return [vu.Word("Chats",25,5,35,12),vu.Word("Search",29,32,29,9),
            vu.Word("unread",62,32,34,9),vu.Word("chats",98,32,24,9),
            vu.Word("All",33,62,14,10),vu.Word("Unread",65,62,33,10),
            vu.Word("9",101,62,6,10),vu.Word("Favourites",121,62,51,10)]

def test_compact_chip_row_with_search_unread_placeholder():
    x=compact_words()
    chip=vu.locate_unread(x,520,920)
    assert chip is not None and chip.x==65 and chip.y==62
    assert vu._search_header(x,chip)=="search unread chats"
    assert vu.locate_unread([w for w in x if w.text!="Chats"],520,920) is None
    assert vu.locate_unread(x+[vu.Word("Unread",75,62,33,10)],520,920) is None

def test_existing_unread_selection_does_not_click(monkeypatch):
    from PIL import Image
    import win32api
    x=compact_words()
    # The compact test fixture represents a real selection, not real contacts.
    monkeypatch.setattr(vu,"_capture_left",lambda hwnd:(Image.new("RGB",(520,920)),0,0))
    monkeypatch.setattr(vu,"_ocr_words",lambda image,cancel=None:x)
    monkeypatch.setattr(vu,"_safe_foreground",lambda hwnd:None)
    monkeypatch.setattr(vu,"_visible_titles_for_layout",lambda *a:["Synthetic contact"])
    monkeypatch.setattr(win32api,"mouse_event",lambda *a:pytest.fail("already selected: no click"))
    result=vu.visual_scan_unread(120)
    assert result["filterSelectedVerified"] is True
    assert result["filterClickAttempted"] is False


def test_compact_layout_extracts_actual_sender_rows_without_mock():
    x=compact_words()+[
        vu.Word("Sample",69,156,40,11),vu.Word("One",113,156,19,11),
        vu.Word("Yesterday",185,156,45,10),vu.Word("Preview",69,172,42,10),
        vu.Word("Sample",69,213,40,11),vu.Word("Two",113,213,19,11),
        vu.Word("Yesterday",185,213,45,10)]
    chip=vu.locate_unread(x,520,920)
    assert chip is not None
    assert vu._visible_titles_for_layout(x,520,chip)==["Sample One","Sample Two"]

def test_adaptive_filter_needs_only_one_sibling_and_independent_header():
    # Newer narrow UI: Favourites is clipped; ordinary Search contains
    # the word unread in a different row. No hardcoded actual screen point.
    x=[vu.Word("Chats",16,5,35,14),vu.Word("Search",20,42,31,11),
       vu.Word("unread",55,42,36,11),vu.Word("chats",94,42,24,11),
       vu.Word("All",25,80,15,11),vu.Word("Unread",68,80,41,11)]
    assert vu.locate_unread(x,260,600)==x[-1]
    assert vu.locate_unread(x+[vu.Word("Unread",128,80,41,11)],260,600) is None
    assert vu.locate_unread([x[-1]],260,600) is None

def test_zero_requires_explicit_label_or_adjacent_badge():
    chip=vu.Word("Unread",60,80,42,12)
    assert vu._verified_badge_count([chip],chip) is None
    assert vu._verified_badge_count([chip,vu.Word("0",107,81,7,10)],chip)==0
    assert vu._verified_badge_count([chip,vu.Word("0",107,130,7,10)],chip) is None

def test_uia_bounds_must_be_inside_the_original_capture():
    from PIL import Image
    image=Image.new("RGB",(400,700))
    native={"bounds":[-1860,80,-1780,110],"selected":True}
    assert vu._chip_from_probe(native,-1920,0,image).x==60
    assert vu._chip_from_probe(native,0,0,image) is None

def test_green_explicit_count_associates_with_one_title_row():
    from PIL import Image,ImageDraw
    image=Image.new("RGB",(520,920),(20,20,20))
    paint=ImageDraw.Draw(image)
    paint.ellipse((465,392,490,417),fill=(16,190,105))
    x=[vu.Word("Sample",159,373,70,20),vu.Word("Contact",234,373,72,20),
        vu.Word("Yesterday",394,373,75,18),vu.Word("3",474,400,8,12)]
    rows=vu._conversation_counts(image,x,["Sample Contact"],vu.Word("Unread",163,183,72,19))
    assert rows==[{"name":"Sample Contact","unreadMessages":3}]
    empty=Image.new("RGB",(520,920),(20,20,20))
    assert vu._conversation_counts(empty,x,["Sample Contact"],vu.Word("Unread",163,183,72,19))[0]["unreadMessages"] is None

def test_capture_rejects_obscured_native_window(monkeypatch):
    import win32gui
    monkeypatch.setattr(win32gui,"WindowFromPoint",lambda point:810)
    monkeypatch.setattr(win32gui,"GetAncestor",lambda hwnd,flag:810)
    with pytest.raises(vu.VisualUnreadUnavailable,match="overlapped"):
        vu._check_capture_owner(120,0,0,520,920)

def test_recovery_uses_native_candidate_without_repeating_ocr(monkeypatch):
    from PIL import Image
    import win32gui
    im=Image.new("RGB",(520,920))
    native={"status":"unique","bounds":[130,110,200,145],
            "windowRect":[0,0,1000,1000],"selected":True,"count":2}
    monkeypatch.setattr(vu,"_probe_native",lambda hwnd,cancel:native)
    monkeypatch.setattr(win32gui,"GetWindowRect",lambda hwnd:(0,0,1000,1000))
    monkeypatch.setattr(vu,"_monitor_rect",lambda hwnd:(0,0,1920,1080))
    monkeypatch.setattr(vu,"_ocr_enlarged",lambda *a:pytest.fail("unnecessary duplicate OCR"))
    result=vu._recover_before_click(120,im,0,0,[],None)
    assert result[4] is not None and result[5]["selected"] is True


def test_owner_actual_unread_geometry_and_second_monitor_origin():
    # Fixed-label rectangles from the successful read-only 96 DPI diagnostic.
    data=[vu.Word("Chats",77,56,50,15),
          vu.Word("Search",120,107,39,10),
          vu.Word("All",88,149,16,10),
          vu.Word("Unread",135,149,40,10),
          vu.Word("Favourites",217,149,59,10),
          vu.Word("Groups",308,150,41,12)]
    region=vu._visible_region((1912,-8,3848,1048),(1920,0,3840,1080))
    assert region==(1920,0,520,920)
    chip=vu.locate_unread(data,region[2],region[3])
    assert chip==data[3]
    assert (region[0]+round(chip.cx),region[1]+round(chip.cy))==(2075,154)
    assert vu._verified_badge_count(data,chip) is None
    assert vu._verified_badge_count(data+[vu.Word("9",180,149,7,10)],chip)==9
    assert vu.locate_unread(data+[vu.Word("Unread",180,149,40,10)],520,920) is None


def test_visible_region_left_and_above_primary_and_large_clipping():
    assert vu._visible_region((-1928,-1088,8,-32),(-1920,-1080,0,0))==(-1920,-1080,520,920)
    with pytest.raises(vu.VisualUnreadUnavailable,match="clipped"):
        vu._visible_region((1700,0,3700,1000),(1920,0,3840,1080))


def test_same_capture_geometry_rejects_moved_monitor(monkeypatch):
    import win32gui
    from PIL import Image
    image=Image.new("RGB",(520,920))
    monkeypatch.setattr(win32gui,"GetWindowRect",lambda hwnd:(1912,-8,3848,1048))
    monkeypatch.setattr(vu,"_monitor_rect",lambda hwnd:(1920,0,3840,1080))
    assert vu._same_capture(120,image,1920,0)
    assert not vu._same_capture(120,image,1912,-8)


def test_header_recovery_uses_fresh_crop_and_keeps_first_sender(monkeypatch):
    from PIL import Image
    import win32gui
    image=Image.new("RGB",(520,920))
    labels=compact_words()
    first=vu.Word("Sample",69,156,40,11)
    calls=[]
    monkeypatch.setattr(vu,"_probe_native",lambda *a:{})
    monkeypatch.setattr(win32gui,"GetWindowRect",lambda hwnd:(0,0,1000,1000))
    monkeypatch.setattr(win32gui,"IsZoomed",lambda hwnd:True)
    monkeypatch.setattr(vu,"_safe_foreground",lambda hwnd:None)
    monkeypatch.setattr(vu,"_capture_left",lambda hwnd:(image,0,0))
    def enlarged(crop,cancel):
        calls.append(crop.size)
        return labels
    monkeypatch.setattr(vu,"_ocr_enlarged",enlarged)
    monkeypatch.setattr(vu,"_ocr_words",lambda im,cancel=None:labels+[first])
    result=vu._recover_before_click(120,image,0,0,[],None)
    assert calls==[(520,312)]
    assert result[4] is not None and result[4].text=="Unread"
    assert first in result[3]
