"""Step 7 regressions: synthetic contacts, no real messages or files sent."""
import threading
from types import SimpleNamespace

import pytest

from controller.whatsapp import adapter, desktop_ops as wa, unread_senders
from controller.system import launcher, windows

def test_conflicting_unread_indicators_are_unknown():
    assert adapter.unread_from_titles(["(2) WhatsApp","(3) WhatsApp"]) is None
    assert adapter.count_from_accessibility_items([("Unread 2",10,10),("Unread 3",10,10)]) is None
    assert adapter.count_from_accessibility_items([("Unread 2",10,10),("Unread 2",10,10)]) == 2

def test_typing_stops_when_field_focus_changes(monkeypatch):
    from controller.browser import operator
    sent=[]
    editor=SimpleNamespace(HasKeyboardFocus=True,IsOffscreen=False,IsEnabled=True,IsPassword=False)
    def write(value):
        sent.append(value)
        editor.HasKeyboardFocus=False
    monkeypatch.setattr(operator,"_send_unicode",write)
    with pytest.raises(wa.DesktopWhatsAppError,match="focus"):
        wa._type_guarded(editor,"ab",lambda:None)
    assert sent==["a"]

def test_attachment_final_send_checks_recipient_and_consumes_state(monkeypatch):
    monkeypatch.setattr(launcher,"SIMULATE",False)
    native=windows.WindowInfo(10,"WhatsApp","WhatsApp.exe",5)
    monkeypatch.setattr(wa,"_active_root",lambda:(native,object(),(0,0,800,600)))
    monkeypatch.setattr(wa,"_pending_attachment",{"contact":"Alice","path":"test.pdf",
        "hwnd":10,"pid":5,"createdAt":wa.time.monotonic(),"size":4,"sha256":"test"})
    def wrong(*args):
        raise wa.DesktopWhatsAppError("wrong recipient")
    monkeypatch.setattr(wa,"_check_selected_contact",wrong)
    with pytest.raises(wa.DesktopWhatsAppError,match="wrong recipient"):
        wa.send_attachment_reviewed("Alice","test.pdf")
    assert wa._pending_attachment is None
    with pytest.raises(wa.DesktopWhatsAppError,match="No matching"):
        wa.send_attachment_reviewed("Alice","test.pdf")

def test_attachment_fingerprint_respects_cancellation(tmp_path):
    path=tmp_path/"sample.pdf"
    path.write_bytes(b"sample")
    cancel=threading.Event()
    cancel.set()
    with pytest.raises(wa.DesktopWhatsAppError,match="cancelled"):
        wa._file_fingerprint(str(path),cancel)

def test_cancelled_unread_scan_does_not_report_names(monkeypatch):
    monkeypatch.setattr(launcher,"SIMULATE",True)
    cancel=threading.Event()
    cancel.set()
    with pytest.raises(unread_senders.UnreadSendersUnavailable,match="cancelled"):
        unread_senders.read_unread_senders(cancel)
