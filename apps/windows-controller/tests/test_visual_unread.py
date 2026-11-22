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


def fixture_scanned_names(names):
    return {"senders":names,"visibleChatCount":len(names),
            "scanPages":1,"allBadgeChatsMatched":False,
            "scanStopped":"synthetic_fixture","conversations":[
                {"name":name,"unreadMessages":None} for name in names]}


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
    # This older test isolates the verified first click; page-walk has
    # separate full regression tests and must not consume extra screenshots.
    monkeypatch.setattr(vu,"_collect_unread_pages",lambda *a:
        fixture_scanned_names(["Bhabi HQ Bina Forever","Saeed Umar"]))

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
    monkeypatch.setattr(vu,"_collect_unread_pages",lambda *a:
        fixture_scanned_names(["Synthetic contact"]))
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
    monkeypatch.setattr(vu,"_is_maximized",lambda hwnd:True)
    monkeypatch.setattr(vu,"_safe_foreground",lambda hwnd:None)
    monkeypatch.setattr(vu,"_capture_left",lambda hwnd:(image,0,0))
    def enlarged(crop,cancel):
        calls.append(crop.size)
        return labels
    monkeypatch.setattr(vu,"_ocr_enlarged",enlarged)
    monkeypatch.setattr(vu,"_ocr_words",lambda im,cancel=None:labels+[first] if im.height==920 else [])
    result=vu._recover_before_click(120,image,0,0,[],None)
    assert calls==[(520,312)]
    assert result[4] is not None and result[4].text=="Unread"
    assert first in result[3]


def test_maximized_detection_uses_supported_win32_api(monkeypatch):
    import win32gui
    import win32con
    monkeypatch.setattr(win32gui,"GetWindowPlacement",lambda hwnd:(0,win32con.SW_SHOWMAXIMIZED,(0,0),(0,0),(0,0,1200,900)))
    assert vu._is_maximized(120)
    monkeypatch.setattr(win32gui,"GetWindowPlacement",lambda hwnd:(0,win32con.SW_SHOWNORMAL,(0,0),(0,0),(0,0,1200,900)))
    assert not vu._is_maximized(120)


def test_raw_header_ocr_recovers_actual_compact_chip_without_enlarging(monkeypatch):
    from PIL import Image
    import win32gui
    image=Image.new("RGB",(520,920))
    data=[vu.Word("Chats",77,56,50,15),
          vu.Word("Search",120,107,39,10),
          vu.Word("All",88,149,16,10),
          vu.Word("Unread",135,149,40,10),
          vu.Word("Favourites",217,149,59,10),
          vu.Word("Groups",308,150,41,12)]
    calls=[]
    monkeypatch.setattr(vu,"_probe_native",lambda *a:{})
    monkeypatch.setattr(win32gui,"GetWindowRect",lambda hwnd:(1912,-8,3848,1048))
    monkeypatch.setattr(vu,"_safe_foreground",lambda hwnd:None)
    monkeypatch.setattr(vu,"_is_maximized",lambda hwnd:True)
    monkeypatch.setattr(vu,"_capture_left",lambda hwnd:(image,1920,0))
    def raw(crop,cancel=None):
        calls.append(crop.size)
        return data
    monkeypatch.setattr(vu,"_ocr_words",raw)
    monkeypatch.setattr(vu,"_ocr_enlarged",lambda *a:pytest.fail("native header already verified"))
    result=vu._recover_before_click(120,image,1920,0,[],None)
    assert calls==[(520,312)]
    assert result[4]==data[3]
    assert (result[1]+round(result[4].cx),result[2]+round(result[4].cy))==(2075,154)


# Real HUKM v1.9.2 capture reached Unread successfully but could not
# correlate timestamp and sender OCR; these cases guard that regression.
def test_owner_post_click_timestamps_and_multiword_titles():
    chip=vu.Word("Unread",168,182,55,12)
    header=[vu.Word("Chats",97,69,62,19),
            vu.Word("Search",150,133,49,12),
            vu.Word("All",110,185,19,12),chip,
            vu.Word("Favourites",277,185,75,12),
            vu.Word("Groups",389,185,52,12)]
    # Compact Windows OCR may split the clock and its meridiem.
    conversations=[
        vu.Word("Ayesha",155,277,57,12),vu.Word("Family",219,277,43,12),
        vu.Word("6:25",425,277,33,12),vu.Word("PM",462,277,16,12),
        vu.Word("Hi",155,304,12,12),  # preview: must never become a title
        vu.Word("Office",155,365,41,12),vu.Word("Team",201,365,38,12),
        vu.Word("Yesterday",412,365,75,12),
        vu.Word("Meeting",155,389,47,12)]
    assert vu.locate_unread(header,520,920)==chip
    assert vu._visible_titles_for_layout(header+conversations,520,chip)==[
        "Ayesha Family","Office Team"]
    assert vu.visible_sender_titles(conversations,520,chip.y+chip.height)==[
        "Ayesha Family","Office Team"]


def test_compact_single_unread_chat_does_not_require_two_timestamps():
    chip=vu.locate_unread(compact_words(),520,920)
    assert chip is not None
    data=compact_words()+[
        vu.Word("Sample",69,156,40,11),
        vu.Word("Single",113,156,36,11),
        vu.Word("Yesterday",185,156,45,10),
        vu.Word("Preview",69,178,42,10)]
    assert vu._visible_titles_for_layout(data,520,chip)==["Sample Single"]


def test_name_words_after_original_355px_cap_are_preserved():
    chip=vu.Word("Unread",165,185,58,12)
    rows=[vu.Word("The",165,315,26,14),
          vu.Word("Official",199,315,63,14),
          vu.Word("Support",270,315,64,14),
          vu.Word("Team",341,315,39,14),
          vu.Word("6:35",431,315,37,12)]
    assert vu.visible_sender_titles(rows,520,chip.y+chip.height)==[
        "The Official Support Team"]


def test_unread_preview_is_never_mistaken_for_title_without_right_timestamp():
    no_time=[vu.Word("Support",160,310,63,14),
             vu.Word("Hi",160,335,18,12),
             vu.Word("10:23",165,335,36,12)]
    assert vu.visible_sender_titles(no_time,520,198)==[]


def test_empty_list_needs_explicit_text_not_an_absent_sender():
    chip=vu.Word("Unread",168,182,55,12)
    words=[vu.Word("No",171,400,17,13),
           vu.Word("unread",194,400,48,13),
           vu.Word("chats",248,400,35,13)]
    assert vu._explicit_empty_unread(words,chip,520)
    assert not vu._explicit_empty_unread([],chip,520)
    assert not vu._explicit_empty_unread([
        vu.Word("No",171,400,17,13),
        vu.Word("unread",194,430,48,13),
        vu.Word("chats",248,460,35,13)],chip,520)


def test_extended_timestamp_formats():
    for value in ("Sunday","11/22","22-11-2026","6:25","6:25 PM",
                  "Nov 22","10.45","Yesterday"):
        assert vu._DATE.fullmatch(value)
    for value in ("hello","9","waiting","invoice","0"):
        assert vu._DATE.fullmatch(value) is None



def test_owner_post_click_enhanced_ocr_reads_verified_chat_without_second_click(monkeypatch):
    """Simulate the owner's exact v1.9.2 stage sequence and a split OCR result."""
    from PIL import Image
    import win32api
    import win32gui
    from controller.system import pointer_motion

    screenshot=Image.new("RGB",(520,920))
    header=[
        vu.Word("Chats",97,69,62,19),
        vu.Word("Search",150,133,49,12),
        vu.Word("All",110,185,19,12),
        vu.Word("Unread",168,182,55,12),
        vu.Word("Favourites",277,185,75,12),
    ]
    # Alternative image preprocessing recovers rows, but not small header text.
    enhanced_rows=[
        vu.Word("Ayesha",155,277,57,12),
        vu.Word("Family",219,277,43,12),
        vu.Word("6:25",425,277,33,12),
        vu.Word("PM",462,277,16,12),
    ]
    seen=[]
    monkeypatch.setattr(vu,"_capture_for_scan",lambda *_:(screenshot,0,0))
    monkeypatch.setattr(vu,"_capture_left",lambda *_:(screenshot,0,0))
    monkeypatch.setattr(vu,"_ocr_words",lambda *_a,**_kw:header)
    monkeypatch.setattr(vu,"_ocr_enlarged",lambda *_a,**_kw:enhanced_rows)
    monkeypatch.setattr(vu,"_safe_foreground",lambda *_:None)
    monkeypatch.setattr(vu,"_same_capture",lambda *_:True)
    samples=iter([10,20])
    monkeypatch.setattr(vu,"_chip_background",lambda *_:next(samples))
    monkeypatch.setattr(win32gui,"GetClientRect",lambda hwnd:(0,0,1200,1000))
    monkeypatch.setattr(win32gui,"ClientToScreen",lambda hwnd,p:p)
    monkeypatch.setattr(win32gui,"WindowFromPoint",lambda p:100)
    monkeypatch.setattr(win32gui,"GetAncestor",lambda hwnd,what:100)
    monkeypatch.setattr(win32api,"GetCursorPos",lambda :(196,188))
    monkeypatch.setattr(win32api,"mouse_event",lambda *args:seen.append(args))
    monkeypatch.setattr(pointer_motion,"move_visible",lambda point,guard:guard())
    monkeypatch.setattr(vu.time,"sleep",lambda *_:None)
    monkeypatch.setattr(vu,"_collect_unread_pages",lambda *a:
        fixture_scanned_names(["Ayesha Family"]))
    result=vu.visual_scan_unread(100)
    assert result["senders"]==["Ayesha Family"]
    assert result["filterClickAttempted"] is True
    assert result["filterSelectedVerified"] is True
    assert result["unreadCountVerified"] is False
    assert len(seen)==2, "one click = one button down + one button up"


def test_post_click_logs_geometry_but_not_private_sender_or_preview(caplog):
    from PIL import Image
    import logging
    words=[
        vu.Word("Private Person",155,277,90,12),
        vu.Word("Private preview content",155,305,200,11),
        vu.Word("6:25",425,277,33,12),
    ]
    with caplog.at_level(logging.INFO):
        vu._row_geometry_diagnostics(words,Image.new("RGB",(520,920)),
                                     vu.Word("Unread",168,182,55,12),"test")
    assert "Private Person" not in caplog.text
    assert "Private preview content" not in caplog.text
    assert "timestamp_geometry" in caplog.text


def test_unread_scan_scrolls_list_only_and_returns_all_timestamp_verified_titles(monkeypatch):
    from PIL import Image
    import win32api, win32gui, win32con
    from controller.system import pointer_motion
    chip=vu.Word("Unread",168,182,55,12)
    anchors=[
        vu.Word("Chats",97,69,62,19),vu.Word("Search",150,133,49,12),
        vu.Word("All",110,185,19,12),chip,vu.Word("Favourites",277,185,75,12)]
    page1=anchors+[vu.Word("First",155,370,42,15),vu.Word("Yesterday",401,370,78,13)]
    page2=anchors+[vu.Word("Second",155,370,55,15),vu.Word("Yesterday",401,370,78,13)]
    first=Image.new("RGB",(520,920),(15,15,15))
    second=Image.new("RGB",(520,920),(20,20,20))
    calls=[]
    monkeypatch.setattr(vu,"_safe_foreground",lambda *_:None)
    monkeypatch.setattr(vu,"_same_capture",lambda *_:True)
    monkeypatch.setattr(vu,"_capture_left",lambda *_:(second,0,0))
    monkeypatch.setattr(vu,"_ocr_words",lambda *a,**k:page2)
    monkeypatch.setattr(vu,"_ocr_enlarged",lambda *a,**k:[])
    monkeypatch.setattr(win32gui,"WindowFromPoint",lambda *_:200)
    monkeypatch.setattr(win32gui,"GetAncestor",lambda *_:200)
    pos=[0,0]
    def move(point,guard):
        guard();pos[:]=point
    monkeypatch.setattr(pointer_motion,"move_visible",move)
    monkeypatch.setattr(win32api,"GetCursorPos",lambda:tuple(pos))
    monkeypatch.setattr(win32api,"mouse_event",lambda *args:calls.append(args))
    monkeypatch.setattr(vu.time,"sleep",lambda *_:None)
    result=vu._collect_unread_pages(200,first,0,0,page1,chip,2,None)
    assert result["senders"]==["First","Second"]
    assert result["visibleChatCount"]==2
    assert result["scanPages"]==2
    assert result["allBadgeChatsMatched"] is True
    assert result["scanStopped"]=="badge_matched"
    assert len(calls)==1 and calls[0][0]==win32con.MOUSEEVENTF_WHEEL
    assert calls[0][3]==-120  # one notch with overlap, never skip whole pages
    assert pos==[round(chip.cx),round(chip.cy)]  # hover moved off chat rows
    assert not any(call[0]==win32con.MOUSEEVENTF_LEFTDOWN for call in calls)


def test_unread_scan_never_claims_full_coverage_when_badge_exceeds_verified_names(monkeypatch):
    from PIL import Image
    import win32api, win32gui
    from controller.system import pointer_motion
    chip=vu.Word("Unread",168,182,55,12)
    words=[
        vu.Word("Chats",97,69,62,19),vu.Word("Search",150,133,49,12),
        vu.Word("All",110,185,19,12),chip,vu.Word("Favourites",277,185,75,12),
        vu.Word("One",155,370,33,15),vu.Word("Yesterday",401,370,78,13)]
    image=Image.new("RGB",(520,920),(15,15,15))
    pos=[0,0]
    monkeypatch.setattr(vu,"_safe_foreground",lambda *_:None)
    monkeypatch.setattr(vu,"_same_capture",lambda *_:True)
    monkeypatch.setattr(vu,"_capture_left",lambda *_:(image,0,0))
    monkeypatch.setattr(vu,"_ocr_words",lambda *_a,**_kw:words)
    monkeypatch.setattr(vu,"_ocr_enlarged",lambda *a,**k:[])
    monkeypatch.setattr(win32gui,"WindowFromPoint",lambda *_:200)
    monkeypatch.setattr(win32gui,"GetAncestor",lambda *_:200)
    monkeypatch.setattr(pointer_motion,"move_visible",lambda point,guard:(guard(),pos.__setitem__(slice(None),point)))
    monkeypatch.setattr(win32api,"GetCursorPos",lambda:tuple(pos))
    monkeypatch.setattr(win32api,"mouse_event",lambda *args:None)
    monkeypatch.setattr(vu.time,"sleep",lambda *_:None)
    result=vu._collect_unread_pages(200,image,0,0,words,chip,10,None)
    assert result["senders"]==["One"]
    assert result["allBadgeChatsMatched"] is False
    assert result["unverifiedChatCount"]==9
    assert result["scanStopped"]=="end_of_list"


def test_unread_scrolling_stops_if_filter_header_is_lost(monkeypatch):
    from PIL import Image
    import win32api,win32gui
    from controller.system import pointer_motion
    chip=vu.Word("Unread",168,182,55,12)
    items=[
       vu.Word("Chats",97,69,62,19),vu.Word("Search",150,133,49,12),
       vu.Word("All",110,185,19,12),chip,vu.Word("Favourites",277,185,75,12),
       vu.Word("One",155,370,33,15),vu.Word("Yesterday",401,370,78,13)]
    image=Image.new("RGB",(520,920),(20,20,20));pos=[0,0]
    monkeypatch.setattr(vu,"_safe_foreground",lambda *_:None)
    monkeypatch.setattr(vu,"_same_capture",lambda *_:True)
    monkeypatch.setattr(vu,"_capture_left",lambda *_:(image,0,0))
    monkeypatch.setattr(vu,"_ocr_words",lambda *_a,**_kw:[])
    monkeypatch.setattr(vu,"_ocr_enlarged",lambda *a,**k:[])
    monkeypatch.setattr(win32gui,"WindowFromPoint",lambda *_:200)
    monkeypatch.setattr(win32gui,"GetAncestor",lambda *_:200)
    monkeypatch.setattr(pointer_motion,"move_visible",lambda point,guard:(guard(),pos.__setitem__(slice(None),point)))
    monkeypatch.setattr(win32api,"GetCursorPos",lambda:tuple(pos))
    monkeypatch.setattr(win32api,"mouse_event",lambda *args:None)
    monkeypatch.setattr(vu.time,"sleep",lambda *_:None)
    out=vu._collect_unread_pages(200,image,0,0,items,chip,10,None)
    assert out["senders"]==["One"]
    assert out["allBadgeChatsMatched"] is False
    assert out["scanStopped"]=="filter_not_verified"


def test_scanned_page_recovers_small_timestamp_and_title_via_enhanced_local_ocr(monkeypatch):
    from PIL import Image
    chip=vu.Word("Unread",168,182,55,12)
    header=[vu.Word("Chats",97,69,62,19),vu.Word("Search",150,133,49,12),
            vu.Word("All",110,185,19,12),chip,
            vu.Word("Favourites",277,185,75,12)]
    first=header+[vu.Word("First",155,370,42,15),
                  vu.Word("Yesterday",401,370,78,13)]
    # Alternative OCR recovers a second tiny timestamp from SAME image.
    extra=[vu.Word("First",155,370,42,15),vu.Word("Yesterday",401,370,78,13),
           vu.Word("Second",155,446,55,15),vu.Word("6:42",427,446,39,12)]
    image=Image.new("RGB",(520,920),(20,20,20))
    monkeypatch.setattr(vu,"_safe_foreground",lambda *_:None)
    monkeypatch.setattr(vu,"_same_capture",lambda *_:True)
    monkeypatch.setattr(vu,"_ocr_enlarged",lambda *_a,**_kw:extra)
    data=vu._collect_unread_pages(200,image,0,0,first,chip,2,None)
    assert data["senders"]==["First","Second"]
    assert data["allBadgeChatsMatched"] is True
    assert data["scanPages"]==1


def test_verified_empty_unread_filter_is_zero_without_numeric_badge(monkeypatch):
    from PIL import Image
    chip=vu.Word("Unread",168,182,55,12)
    words=[
        vu.Word("Chats",97,69,62,19),vu.Word("Search",150,133,49,12),
        vu.Word("All",110,185,19,12),chip,
        vu.Word("Favourites",277,185,75,12),
        vu.Word("No",160,380,23,13),vu.Word("unread",188,380,50,13),
        vu.Word("chats",243,380,35,13),
    ]
    image=Image.new("RGB",(520,920))
    monkeypatch.setattr(vu,"_capture_for_scan",lambda *_:(image,0,0))
    monkeypatch.setattr(vu,"_ocr_words",lambda *a,**kw:words)
    monkeypatch.setattr(vu,"_safe_foreground",lambda *_:None)
    monkeypatch.setattr(vu,"_search_header",lambda *_:"search unread chats")
    monkeypatch.setattr(vu,"_collect_unread_pages",lambda *_args,**_kw:{
        "senders":[],"visibleChatCount":0,"scanPages":1,
        "allBadgeChatsMatched":True,"scanStopped":"explicit_empty",
        "conversations":[],
    })
    data=vu.visual_scan_unread(200)
    assert data["senders"]==[]
    assert data["totalUnreadChats"]==0
    assert data["unreadCountVerified"] is True
    assert data["source"]=="Explicit WhatsApp empty Unread-filter list"
    assert data["filterClickAttempted"] is False


def test_2k_whatsapp_sidebar_includes_below_920px_rows_and_more_than_twelve_chats():
    """A tall sidebar may show all 16 unread conversations without scrolling."""
    chip=vu.Word("Unread",168,182,55,12)
    header=[vu.Word("Chats",97,69,62,19),vu.Word("All",110,185,19,12),chip,
            vu.Word("Favourites",277,185,75,12)]
    names=[f"Contact {i:02d}" for i in range(16)]
    rows=[]
    for i,name in enumerate(names):
        y=286+i*68
        rows.extend((vu.Word(name,155,y,95,15),vu.Word(f"10:{i:02d}",418,y,45,13),
                     vu.Word("Message preview should not be reported",155,y+25,260,13)))
    observed=vu._visible_titles_for_layout(header+rows,520,chip)
    assert observed==names
    assert observed[-1]=="Contact 15"
    assert len(observed)==16


def test_2k_sidebar_does_not_guess_names_without_row_timestamps():
    chip=vu.Word("Unread",168,182,55,12)
    words=[vu.Word("Private preview is not a contact",155,1270,260,14),
           vu.Word("Contact Without Clock",155,1160,190,14)]
    assert vu.visible_sender_titles(words,520,chip.y+chip.height)==[]


def test_2k_monitor_capture_is_not_silently_clipped_at_920px():
    # Real 2K and 4K monitors must permit the lower WhatsApp chat rows.
    region=vu._visible_region((0,0,1450,1432),(0,0,2560,1440))
    assert region==(0,0,520,1420)
    assert region[3]>1300
    region_4k=vu._visible_region((3840,0,5500,2158),(3840,0,7680,2160))
    assert region_4k==(3840,0,520,1600)
    # The existing 1080p capture remains bounded for performance/privacy.
    assert vu._visible_region((0,0,1350,1060),(0,0,1920,1080))==(0,0,520,920)


def test_2k_monitor_negative_virtual_desktop_origin_keeps_correct_geometry():
    region=vu._visible_region((-1928,-8,-480,1432),(-1920,0,0,1440))
    assert region==(-1920,0,520,1420)
    assert region[0]<0
