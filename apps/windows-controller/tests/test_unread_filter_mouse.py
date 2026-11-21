"""UI Automation regression: HUKM restores WhatsApp and clicks the real Unread chip.

These tests simulate WinUI accessibility. Actual signed-in WhatsApp remains
a separate Windows acceptance test, never silently claimed by CI.
"""
from types import SimpleNamespace
import sys

import pytest

from controller.system import launcher, windows
from controller.whatsapp import unread_filter, unread_senders


class Control:
    def __init__(self,name,role,rect,auto_id="",children=None):
        self.Name=name
        self.ControlTypeName=role
        self.AutomationId=auto_id
        self.HelpText=""
        self.BoundingRectangle=SimpleNamespace(
            left=rect[0],top=rect[1],right=rect[2],bottom=rect[3])
        self.IsOffscreen=False
        self.children=children or []
        self.clicked=0
        self.selected=False

    def Click(self,simulateMove=False):
        assert simulateMove is True  # a visible mouse click, not hidden automation
        self.clicked+=1
        self.selected=True

    def GetSelectionItemPattern(self):
        return SimpleNamespace(IsSelected=self.selected)

    def GetTogglePattern(self):
        return None


def install_uia(monkeypatch,root):
    # A restored verified WhatsApp main window is required before the mouse
    # is allowed to click its Unread filter.
    monkeypatch.setattr(unread_senders.locator,"focus_whatsapp",
                        lambda:windows.active_window())
    fake=SimpleNamespace(
        WalkControl=lambda node,maxDepth=12: iter([(c,1) for c in node.children]),
        ControlFromHandle=lambda hwnd:root)
    monkeypatch.setitem(sys.modules,"uiautomation",fake)


def test_duplicate_unread_label_and_button_are_one_click(monkeypatch):
    parent=Control("Unread","ButtonControl",(130,110,240,154))
    text=Control("Unread","TextControl",(150,119,203,143))
    root=Control("WhatsApp","WindowControl",(0,0,1000,800),
                 children=[parent,text])
    install_uia(monkeypatch,root)
    items=unread_filter.candidates(root,(0,0,1000,800))
    choice,status=unread_filter.choose_unique(items)
    assert status=="unique"
    assert choice.control is parent


def test_unread_filter_can_be_found_by_accessibility_id(monkeypatch):
    button=Control("","ButtonControl",(120,113,250,155),"UnreadFilterButton")
    root=Control("WhatsApp","WindowControl",(0,0,1000,800),children=[button])
    install_uia(monkeypatch,root)
    choice,status=unread_filter.choose_unique(
        unread_filter.candidates(root,(0,0,1000,800)))
    assert status=="unique" and choice.control is button


def test_ambiguous_separate_filters_never_choose_one():
    first=unread_filter.Candidate(object(),"ButtonControl",90,110,155,150)
    second=unread_filter.Candidate(object(),"ButtonControl",320,110,398,150)
    choice,status=unread_filter.choose_unique([first,second])
    assert choice is None and status=="ambiguous"


def test_approved_unread_scan_mouse_clicks_button_and_reads_only_titles(monkeypatch):
    monkeypatch.setattr(launcher,"SIMULATE",False)
    monkeypatch.setattr(unread_senders,"IS_WINDOWS",True)
    native=windows.WindowInfo(120,"Chats","WhatsApp.exe",933)
    monkeypatch.setattr(windows,"active_window",lambda:native)
    button=Control("Unread","ButtonControl",(125,114,222,154))
    text=Control("Unread","TextControl",(141,123,194,140))
    title=Control("Ali","TextControl",(98,280,181,298))
    preview=Control("private message text","TextControl",(98,310,320,331))
    row=Control("","ListItemControl",(70,264,470,340),children=[title,preview])
    root=Control("","WindowControl",(0,0,1000,800),children=[button,text,row])
    install_uia(monkeypatch,root)
    monkeypatch.setattr(unread_senders.time,"sleep",lambda _seconds:None)
    result=unread_senders.read_unread_senders()
    assert button.clicked==1 and text.clicked==0
    assert result["senders"]==["Ali"]
    assert result["filterSelectedVerified"] is True
    assert result["messagesRead"] is False
    assert "private message text" not in str(result)


def test_ambiguous_unread_filter_does_not_touch_mouse(monkeypatch):
    monkeypatch.setattr(launcher,"SIMULATE",False)
    monkeypatch.setattr(unread_senders,"IS_WINDOWS",True)
    native=windows.WindowInfo(120,"Chats","WhatsApp.exe",933)
    monkeypatch.setattr(windows,"active_window",lambda:native)
    a=Control("Unread","ButtonControl",(100,110,155,151))
    b=Control("Unread","ButtonControl",(285,110,350,151))
    root=Control("","WindowControl",(0,0,1000,800),children=[a,b])
    install_uia(monkeypatch,root)
    # Ambiguous UIA may attempt independent local OCR, but NEVER a blind click.
    def no_visual_match(hwnd):
        raise unread_senders.visual_unread.VisualUnreadUnavailable(
            "No unique All/Unread/Favourites visual row; no mouse click made")
    monkeypatch.setattr(unread_senders.visual_unread,"visual_scan_unread",no_visual_match)
    with pytest.raises(unread_senders.UnreadSendersUnavailable,match="no mouse click"):
        unread_senders.read_unread_senders()
    assert a.clicked==b.clicked==0


def test_missing_unread_filter_does_not_blind_click(monkeypatch):
    monkeypatch.setattr(launcher,"SIMULATE",False)
    monkeypatch.setattr(unread_senders,"IS_WINDOWS",True)
    native=windows.WindowInfo(120,"Chats","WhatsApp.exe",933)
    monkeypatch.setattr(windows,"active_window",lambda:native)
    all_button=Control("All","ButtonControl",(25,110,74,153))
    root=Control("","WindowControl",(0,0,1000,800),children=[all_button])
    install_uia(monkeypatch,root)
    # If neither UIA nor visual anchors can identify Unread, no mouse event.
    def no_visual_match(hwnd):
        raise unread_senders.visual_unread.VisualUnreadUnavailable(
            "No unique All/Unread/Favourites visual row; no mouse click made")
    monkeypatch.setattr(unread_senders.visual_unread,"visual_scan_unread",no_visual_match)
    with pytest.raises(unread_senders.UnreadSendersUnavailable,match="no mouse click"):
        unread_senders.read_unread_senders()
    assert all_button.clicked==0


def test_minimized_main_whatsapp_window_is_restored_instead_of_small_popup(monkeypatch):
    from controller.whatsapp import locator
    import win32gui
    monkeypatch.setattr(windows,"IS_WINDOWS",True)
    popup=windows.WindowInfo(201,"WhatsApp notification","WhatsApp.exe",81)
    main=windows.WindowInfo(202,"Chats","WhatsApp.exe",81)
    foreground={"value":popup}
    monkeypatch.setattr(windows,"active_window",lambda:foreground["value"])
    monkeypatch.setattr(locator,"desktop_windows",lambda:[popup,main])
    monkeypatch.setattr(win32gui,"IsIconic",lambda hwnd:hwnd==202)
    monkeypatch.setattr(win32gui,"GetWindowRect",
                        lambda hwnd:(0,0,180,120) if hwnd==201 else (-32000,-32000,-31000,-31000))
    monkeypatch.setattr(win32gui,"GetWindowPlacement",
                        lambda hwnd:(0,0,0,(0,0),(20,20,970,720)))
    def restore(w):
        foreground["value"]=w
        return True
    monkeypatch.setattr(windows,"bring_to_front",restore)
    assert locator.focus_whatsapp()==main
