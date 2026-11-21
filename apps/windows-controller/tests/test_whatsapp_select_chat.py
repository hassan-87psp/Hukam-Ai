"""Phase 2: personal WhatsApp selection is precise, reviewed and never sends."""
import sys
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from controller.actions.executor import Executor
from controller.config import ALL_CAPABILITIES, Config
from controller.system import launcher, windows
from controller.whatsapp import desktop_ops
from controller.security import validation


def test_selection_contract_and_no_implicit_send(sandbox):
    assert validation.validate("whatsapp.select_chat", {"contact": "Ali"}) == {"contact":"Ali"}
    assert validation.validate("whatsapp.read_selected", {"contact":"Ali"}) == {"contact":"Ali"}
    assert validation.validate("whatsapp.read_selected", {}) == {}
    with pytest.raises(validation.ValidationError):
        validation.validate("whatsapp.select_chat", {"contact":""})
    with pytest.raises(validation.ValidationError):
        validation.validate("whatsapp.select_chat", {"contact":"Ali\nSend"})
    ex=Executor(Config(),lambda:list(ALL_CAPABILITIES))
    import threading
    result=ex.run("whatsapp.select_chat",{"contact":"Ali"},threading.Event())
    assert result.ok
    assert result.result["simulated"] is True
    assert result.result["sent"] is False


def test_exact_contact_sidebar_match_excludes_header(monkeypatch):
    rect=(100.0,100.0,1000.0,700.0)
    marker=object()
    samples=[
       (marker,"Ali","TextControl",180.0,350.0,260.0,371.0),  # left sidebar
       (object(),"Ali","TextControl",760.0,145.0,800.0,166.0), # right header
       (object(),"Alina","TextControl",185.0,390.0,275.0,410.0),
       (object(),"Ali","TextControl",190.0,795.0,240.0,810.0), # bottom composer area
    ]
    monkeypatch.setattr(desktop_ops,"_controls",lambda root,max_nodes=1500:iter(samples))
    assert desktop_ops._visible_contact_matches(object(),rect,"aLi")==[marker]


def test_select_chat_clicks_only_unique_exact_sidebar_result(monkeypatch):
    monkeypatch.setattr(launcher,"SIMULATE",False)
    native=windows.WindowInfo(19,"Chats","WhatsApp.Root.exe",222)
    monkeypatch.setattr(windows,"active_window",lambda:native)
    monkeypatch.setattr(desktop_ops,"_active_root",
        lambda:(native,object(),(100.,100.,1000.,700.)))
    clicked=[]
    control=SimpleNamespace(Click=lambda:clicked.append("chat"))
    monkeypatch.setattr(desktop_ops,"_visible_contact_matches",
        lambda _root,_rect,expected:[control] if expected=="Ali" else [])
    monkeypatch.setattr(desktop_ops,"_check_selected_contact",
        lambda _root,_rect,expected:None if expected=="Ali" else (_ for _ in ()).throw(
            desktop_ops.DesktopWhatsAppError("wrong contact")))
    monkeypatch.setattr(desktop_ops.time,"sleep",lambda _x:None)
    monkeypatch.setitem(sys.modules,"uiautomation",
        SimpleNamespace(ControlFromHandle=lambda hwnd:object()))
    result=desktop_ops.select_chat("Ali")
    assert clicked==["chat"]
    assert result["chatSelected"] is True and result["recipientVerified"] is True
    assert result["sent"] is False and result["messagesRead"] is False
    assert result["selectedContact"]=="Ali"


def test_ambiguous_contact_never_clicks(monkeypatch):
    monkeypatch.setattr(launcher,"SIMULATE",False)
    native=windows.WindowInfo(19,"Chats","WhatsApp.exe",222)
    monkeypatch.setattr(windows,"active_window",lambda:native)
    monkeypatch.setattr(desktop_ops,"_active_root",
        lambda:(native,object(),(100.,100.,1000.,700.)))
    item=Mock()
    monkeypatch.setattr(desktop_ops,"_visible_contact_matches",
        lambda *_args:[item,item])
    monkeypatch.setitem(sys.modules,"uiautomation",
        SimpleNamespace(ControlFromHandle=lambda hwnd:object()))
    with pytest.raises(desktop_ops.DesktopWhatsAppError,match="exactly one"):
        desktop_ops.select_chat("Ali")
    item.Click.assert_not_called()


def test_read_selected_checks_named_chat_before_extracting_content(monkeypatch):
    monkeypatch.setattr(launcher,"SIMULATE",False)
    native=windows.WindowInfo(19,"Chats","WhatsApp.Root.exe",222)
    monkeypatch.setattr(desktop_ops,"_active_root",
        lambda:(native,object(),(100.,100.,1000.,700.)))
    monkeypatch.setattr(desktop_ops,"_check_selected_contact",
        lambda *_args:(_ for _ in ()).throw(desktop_ops.DesktopWhatsAppError("wrong recipient")))
    extractor=Mock()
    monkeypatch.setattr(desktop_ops,"visible_texts",extractor)
    with pytest.raises(desktop_ops.DesktopWhatsAppError,match="wrong recipient"):
        desktop_ops.read_selected("Ali")
    extractor.assert_not_called()
