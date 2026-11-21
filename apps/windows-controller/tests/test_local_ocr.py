import threading
from types import SimpleNamespace
import pytest
from controller.screen import local_ocr
from controller.security import validation
from controller.system import launcher
from controller.actions.executor import Executor
from controller.config import Config,ALL_CAPABILITIES

def test_ocr_mode_is_distinct_and_cancelable(monkeypatch):
    monkeypatch.setattr(launcher,"SIMULATE",True)
    args=validation.validate("screen.capture",{"monitor":1,"textOnly":True})
    assert args=={"monitor":1,"textOnly":True}
    result=Executor(Config(),lambda:list(ALL_CAPABILITIES)).run("screen.capture",args,threading.Event())
    assert result.ok and result.result["ocrRead"] and result.result["simulated"]
    assert result.result["verified"] is False
    assert result.screenshot is None
    assert "dataBase64" not in result.result
    stop=threading.Event();stop.set()
    with pytest.raises(local_ocr.ScreenOCRError,match="cancelled"):
        local_ocr.read_monitor(1,stop)

def test_ocr_invalid_target_and_bounded_text():
    for args in ({"textOnly":True},{"monitor":1,"textOnly":False},{"monitor":17,"textOnly":True}):
        with pytest.raises(validation.ValidationError):
            validation.validate("screen.capture",args)
    text,truncated=local_ocr.bounded_text([SimpleNamespace(text="x"*6100)])
    assert len(text)==6000 and truncated
