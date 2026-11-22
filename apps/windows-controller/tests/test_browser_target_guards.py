"""Browser guard regressions using synthetic windows and no native input."""
import sys
import threading
from types import SimpleNamespace

import pytest
from controller.browser import operator as browser


@pytest.fixture
def fake_browser(monkeypatch):
    state = {"focus": 10, "hit": 10, "pointer": (20, 20), "password": False}
    events = []
    monkeypatch.setattr(browser.launcher, "SIMULATE", False)
    monkeypatch.setattr(browser.windows, "IS_WINDOWS", True)
    monkeypatch.setattr(browser.windows, "active_window",
                        lambda: SimpleNamespace(hwnd=10, process="chrome.exe"))
    monkeypatch.setitem(sys.modules, "win32gui", SimpleNamespace(
        GetForegroundWindow=lambda: state["focus"],
        IsWindowVisible=lambda hwnd: True, IsIconic=lambda hwnd: False,
        GetWindowRect=lambda hwnd: (0, 0, 200, 200),
        WindowFromPoint=lambda point: state["hit"], GetAncestor=lambda hit, root: hit))
    monkeypatch.setitem(sys.modules, "win32api", SimpleNamespace(
        GetCursorPos=lambda: state["pointer"],
        SetCursorPos=lambda value: state.update(pointer=value),
        mouse_event=lambda *args: events.append(("mouse", args))))
    monkeypatch.setitem(sys.modules, "win32con", SimpleNamespace(
        MOUSEEVENTF_LEFTDOWN=2, MOUSEEVENTF_LEFTUP=4, MOUSEEVENTF_WHEEL=2048))
    monkeypatch.setitem(sys.modules, "uiautomation", SimpleNamespace(
        GetFocusedControl=lambda: SimpleNamespace(IsPassword=state["password"])))
    monkeypatch.setattr(browser, "_send_unicode", lambda value: events.append(("type", value)))
    return state, events


def test_pre_cancelled_browser_input_sends_nothing(fake_browser):
    _, events = fake_browser
    cancel = threading.Event()
    cancel.set()
    with pytest.raises(RuntimeError, match="interrupted"):
        browser.control({"kind":"type","text":"a"}, cancel)
    assert events == []


def test_focus_change_stops_typing(fake_browser, monkeypatch):
    state, events = fake_browser
    def send(value):
        events.append(value)
        state["focus"] = 99
    monkeypatch.setattr(browser, "_send_unicode", send)
    with pytest.raises(RuntimeError, match="target changed"):
        browser.control({"kind":"type","text":"ab"})
    assert events == ["a"]


def test_password_or_unknown_input_is_blocked(fake_browser):
    state, events = fake_browser
    for flag in (True, None):
        state["password"] = flag
        with pytest.raises(RuntimeError, match="password field"):
            browser.control({"kind":"type","text":"a"})
    assert events == []


def test_overlapping_window_blocks_click_and_scroll(fake_browser):
    state, events = fake_browser
    state["hit"] = 99
    with pytest.raises(RuntimeError, match="obscured"):
        browser.control({"kind":"click","x":20,"y":20})
    with pytest.raises(RuntimeError, match="foreground browser"):
        browser.control({"kind":"scroll","steps":-2})
    assert events == []


def test_valid_native_input_never_claims_site_success(fake_browser):
    _, events = fake_browser
    result = browser.control({"kind":"type","text":"ab"})
    assert events == [("type","a"),("type","b")]
    assert result["inputDelivered"] is True and result["verified"] is False
