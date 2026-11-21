"""Single-display capture tests (fake screen only)."""
import sys
import threading
from types import SimpleNamespace

import pytest
from controller.screen import capture
from controller.security import validation
from controller.system import launcher

def test_monitor_selection_and_negative_origin(monkeypatch):
    grabbed=[]
    monitors=[{"left":-200,"top":0,"width":400,"height":100},
              {"left":0,"top":0,"width":200,"height":100},
              {"left":-200,"top":0,"width":200,"height":100}]
    class Fake:
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def grab(self,m):
            grabbed.append(m)
            return SimpleNamespace(size=(m["width"],m["height"]),
                                    bgra=bytes(m["width"]*m["height"]*4))
    Fake.monitors=monitors
    monkeypatch.setattr(launcher,"SIMULATE",False)
    monkeypatch.setitem(sys.modules,"mss",SimpleNamespace(MSS=Fake))
    result=capture.capture(monitor=2)
    assert grabbed==[monitors[2]]
    assert result["monitor"]==2 and result["monitorCount"]==2
    assert result["sourceBounds"]["left"]==-200
    with pytest.raises(ValueError,match="unavailable"):
        capture.capture(monitor=3)
    assert len(grabbed)==1

def test_capture_validation_and_no_real_capture_in_simulation(monkeypatch):
    monkeypatch.setattr(launcher,"SIMULATE",True)
    assert capture.capture()["simulated"] is True
    for monitor in (0,17,True,"2",1.5):
        with pytest.raises(validation.ValidationError):
            validation.validate("screen.capture",{"monitor":monitor})
    assert validation.validate("screen.capture",{"monitor":2})=={"monitor":2}

def test_cancelled_capture_refuses_before_input(monkeypatch):
    monkeypatch.setattr(launcher,"SIMULATE",True)
    stop=threading.Event()
    stop.set()
    with pytest.raises(RuntimeError,match="cancelled"):
        capture.capture(cancel=stop)
