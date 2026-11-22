"""Owner-approved WhatsApp visual fallback: never send or invent a recipient.

All OCR screenshots/Windows events are mocked; live WhatsApp needs a separate
owner acceptance. The visual fallback prepares only a checked draft.
"""
from types import SimpleNamespace
import pytest

from controller.whatsapp import visual_reply, visual_unread as vu, desktop_ops
from controller.system import launcher, windows


def test_header_requires_full_exact_name_not_substring():
    w=[vu.Word("Adnan",10,20,45,15),vu.Word("Agent",60,20,43,15),
       vu.Word("Visa",109,20,31,15),vu.Word("Bina",145,20,36,15),
       vu.Word("Forever",187,20,53,15)]
    assert len(visual_reply._phrase_hits(w,"Adnan Agent Visa Bina Forever"))==1
    assert visual_reply._phrase_hits(w,"Adnan Agent Visa Bina")==[]
    assert visual_reply._phrase_hits(w,"Adnan Agent Visa Bina Foreve") == []
    assert visual_reply._phrase_hits(w,"Adnan Agent Visa Bina Forever fake") == []


def test_exact_contact_already_selected_avoids_any_click(monkeypatch):
    window=windows.WindowInfo(200,"WhatsApp","WhatsApp.Root.exe",500)
    monkeypatch.setattr(visual_reply.locator,"focus_whatsapp",lambda:window)
    monkeypatch.setattr(visual_reply,"exact_header",lambda *a:True)
    monkeypatch.setattr(visual_reply,"_click_at",lambda *a:pytest.fail("no extra click"))
    result=visual_reply.select_chat_visual("Known Contact")
    assert result["recipientVerified"] is True
    assert result["sent"] is False


def test_visual_draft_requires_exact_header_and_does_not_send(monkeypatch):
    import controller.browser.operator as keyboard
    from PIL import Image
    window=windows.WindowInfo(200,"WhatsApp","WhatsApp.Root.exe",500)
    monkeypatch.setattr(visual_reply.locator,"focus_whatsapp",lambda:window)
    monkeypatch.setattr(visual_reply,"exact_header",lambda *a:True)
    monkeypatch.setattr(visual_reply,"_same",lambda *a:None)
    image=Image.new("RGB",(600,150))
    typed=[]
    monkeypatch.setattr(visual_reply,"_composer_words",lambda *args:(
        image,[vu.Word("Type",80,88,31,12),vu.Word("a",116,88,8,12),
               vu.Word("message",130,88,59,12)] if not typed else
        [vu.Word("Okay",80,88,41,12)],0,0))
    monkeypatch.setattr(visual_reply,"_click_at",lambda *a:typed.append("clicked"))
    monkeypatch.setattr(keyboard,"_send_unicode",lambda value:typed.append(value))
    result=visual_reply.draft_reply_visual("Known Contact","Okay")
    assert result["draftEntered"] is True and result["sent"] is False
    assert "".join(v for v in typed if len(v)==1)=="Okay"
    with pytest.raises(visual_reply.VisualReplyUnavailable,match="one line"):
        visual_reply.draft_reply_visual("Known Contact","Hi\nSend")
    assert not hasattr(visual_reply,"send_reviewed_visual")


def test_visual_draft_refuses_unverified_recipient_without_typing(monkeypatch):
    window=windows.WindowInfo(200,"WhatsApp","WhatsApp.Root.exe",500)
    monkeypatch.setattr(visual_reply.locator,"focus_whatsapp",lambda:window)
    monkeypatch.setattr(visual_reply,"exact_header",lambda *a:False)
    monkeypatch.setattr(visual_reply,"_click_at",lambda *a:pytest.fail("unverified recipient clicked"))
    with pytest.raises(visual_reply.VisualReplyUnavailable,match="recipient header"):
        visual_reply.draft_reply_visual("Wrong Contact","Hello")


def test_desktop_uia_missing_falls_back_to_one_exact_visual_chat(monkeypatch):
    native=windows.WindowInfo(200,"WhatsApp","WhatsApp.Root.exe",500)
    monkeypatch.setattr(launcher,"SIMULATE",False)
    monkeypatch.setattr(desktop_ops,"_active_root",lambda:(native,object(),(0,0,1200,950)))
    monkeypatch.setattr(desktop_ops,"_visible_contact_matches",lambda *a:[])
    monkeypatch.setattr(desktop_ops,"_sidebar_search",lambda *a:None)
    selected=[]
    monkeypatch.setattr(visual_reply,"select_chat_visual",lambda name,cancel=None:(
        selected.append(name) or {"chatSelected":True,"recipientVerified":True,"sent":False}))
    r=desktop_ops.select_chat("Known Contact")
    assert selected==["Known Contact"] and r["sent"] is False


def test_uia_reply_fallback_never_types_twice_on_partial_input(monkeypatch):
    native=windows.WindowInfo(200,"WhatsApp","WhatsApp.Root.exe",500)
    monkeypatch.setattr(launcher,"SIMULATE",False)
    monkeypatch.setattr(desktop_ops,"_active_root",lambda:(native,object(),(0,0,1200,950)))
    monkeypatch.setattr(desktop_ops,"_check_selected_contact",lambda *a:None)
    fake=SimpleNamespace(GetValuePattern=lambda:SimpleNamespace(Value=""),
                         SetFocus=lambda:None)
    monkeypatch.setattr(desktop_ops,"_composer",lambda *a:fake)
    monkeypatch.setattr(desktop_ops,"_same_window",lambda *a:None)
    monkeypatch.setattr(desktop_ops,"_type_guarded",lambda *a:(_ for _ in ()).throw(
        desktop_ops.DesktopWhatsAppError("partial typing")))
    monkeypatch.setattr(visual_reply,"draft_reply_visual",lambda *a:pytest.fail("duplicate draft"))
    with pytest.raises(desktop_ops.DesktopWhatsAppError,match="partial typing"):
        desktop_ops.draft_reply("Known Contact","Hello")
