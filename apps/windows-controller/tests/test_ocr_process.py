import subprocess
import threading
import pytest
from PIL import Image
from controller.screen import ocr_process as p
from controller.whatsapp.visual_unread import VisualUnreadUnavailable

def test_hanging_ocr_is_killed_after_cancel(monkeypatch):
    cancel=threading.Event()
    class Child:
        stdin=stdout=None
        returncode=None
        killed=False
        def communicate(self, input=None, timeout=None):
            cancel.set()
            raise subprocess.TimeoutExpired("test",timeout)
        def poll(self): return self.returncode
        def kill(self):
            self.killed=True
            self.returncode=-9
        def wait(self,timeout=None): return self.returncode
    child=Child()
    monkeypatch.setattr(p.subprocess,"Popen",lambda *a,**kw:child)
    with pytest.raises(VisualUnreadUnavailable,match="cancelled"):
        p.recognize_isolated(Image.new("RGB",(30,30)),cancel=cancel)
    assert child.killed

def test_pre_cancel_never_creates_child(monkeypatch):
    event=threading.Event();event.set()
    monkeypatch.setattr(p.subprocess,"Popen",lambda *a,**kw:pytest.fail("spawn after cancel"))
    with pytest.raises(VisualUnreadUnavailable,match="cancelled"):
        p.recognize_isolated(Image.new("RGB",(30,30)),cancel=event)
