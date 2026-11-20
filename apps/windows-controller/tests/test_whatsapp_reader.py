"""WhatsApp reader privacy tests: no message bodies in HTTP/WS results."""
from controller.whatsapp import reader
from controller.actions.executor import Executor
from controller.config import Config, ALL_CAPABILITIES
from controller.system import launcher


def test_read_visible_simulation_returns_no_private_text(monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", True)
    result = reader.read_visible_aloud()
    assert result["messagesRead"] is True
    assert result["textTransferred"] is False
    assert "messages" not in result
    assert "text" not in result


def test_reader_requires_whatsapp_native_foreground(monkeypatch):
    from controller.system import windows
    monkeypatch.setattr(launcher, "SIMULATE", False)
    monkeypatch.setattr(reader, "IS_WINDOWS", True)
    monkeypatch.setattr(windows, "active_window", lambda: windows.WindowInfo(18, "WhatsApp - Google Chrome", "chrome.exe", 5))
    try:
        reader.read_visible_aloud()
        assert False, "should not read Chrome"
    except reader.ReadError as e:
        assert "WhatsApp Desktop" in str(e)


def test_reader_requires_whatsapp_capability(monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", True)
    ex = Executor(Config(capabilities=["system"]), lambda: ["system"])
    import threading
    outcome = ex.run("whatsapp.read_visible", {}, threading.Event())
    assert outcome.ok is False
    assert outcome.error["code"] == "CAPABILITY_DISABLED"


def test_read_visible_does_not_return_raw_messages(monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", True)
    import threading
    ex = Executor(Config(), lambda: list(ALL_CAPABILITIES))
    msg = ex.run("whatsapp.read_visible", {}, threading.Event()).to_message("test")
    assert msg["ok"] is True
    assert msg["result"]["textTransferred"] is False
    assert "message" not in msg["result"]
    assert "content" not in msg["result"]
