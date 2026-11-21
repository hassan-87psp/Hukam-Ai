"""Regression tests: Notepad close must not become an open or process kill."""
from __future__ import annotations

import threading
from unittest.mock import Mock

import pytest

from controller.actions.executor import Executor
from controller.config import ALL_CAPABILITIES, Config
from controller.security import validation
from controller.system import launcher, windows


def test_native_notepad_close_is_an_approved_allowlisted_action():
    assert validation.validate("app.close", {"app": "notepad"}) == {"app": "notepad"}
    with pytest.raises(validation.ValidationError):
        validation.validate("app.close", {"app": "chrome"})
    with pytest.raises(validation.ValidationError):
        validation.validate("app.close", {"app": "cmd.exe"})


def test_simulated_controller_does_not_open_notepad(sandbox, monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", True)
    launcher.simulated_calls.clear()
    ex = Executor(Config(), lambda: list(ALL_CAPABILITIES))
    result = ex.run("app.close", {"app": "notepad"}, threading.Event())
    assert result.ok is True
    assert result.result["windowClosed"] is True
    assert launcher.simulated_calls == [("app.close", "notepad")]


def test_closes_only_the_exact_active_notepad_window(monkeypatch):
    monkeypatch.setattr(windows, "IS_WINDOWS", True)
    first=windows.WindowInfo(101, "Untitled - Notepad", "notepad.exe", 1001)
    second=windows.WindowInfo(102, "Other - Notepad", "notepad.exe", 1002)
    monkeypatch.setattr(windows, "list_windows", lambda: [first, second])
    monkeypatch.setattr(windows, "active_window", lambda: second)
    import win32gui
    seen=[]
    alive={101,102}
    monkeypatch.setattr(win32gui, "PostMessage",
                        lambda hwnd,*args:(seen.append(hwnd),alive.discard(hwnd)))
    monkeypatch.setattr(win32gui, "IsWindow", lambda hwnd: hwnd in alive)
    result=windows.close_notepad_window()
    assert seen==[102]
    assert result["windowClosed"] is True
    assert result["verified"] is True
    assert 101 in alive


def test_multiple_notepad_windows_without_active_target_refuses_close(monkeypatch):
    monkeypatch.setattr(windows, "IS_WINDOWS", True)
    a=windows.WindowInfo(10,"A - Notepad","notepad.exe",10)
    b=windows.WindowInfo(11,"B - Notepad","notepad.exe",11)
    monkeypatch.setattr(windows,"list_windows",lambda:[a,b])
    monkeypatch.setattr(windows,"active_window",
                        lambda:windows.WindowInfo(50,"Chrome","chrome.exe",50))
    import win32gui
    sender=Mock()
    monkeypatch.setattr(win32gui,"PostMessage",sender)
    with pytest.raises(RuntimeError,match="Multiple Notepad"):
        windows.close_notepad_window()
    sender.assert_not_called()


def test_save_prompt_does_not_claim_window_closed(monkeypatch):
    monkeypatch.setattr(windows, "IS_WINDOWS", True)
    a=windows.WindowInfo(10,"*Unsaved - Notepad","notepad.exe",10)
    monkeypatch.setattr(windows,"list_windows",lambda:[a])
    monkeypatch.setattr(windows,"active_window",lambda:a)
    import win32gui
    send=Mock()
    monkeypatch.setattr(win32gui,"PostMessage",send)
    monkeypatch.setattr(win32gui,"IsWindow",lambda hwnd:True)
    ticks=iter([1,1,2,4])
    monkeypatch.setattr(windows.time,"monotonic",lambda:next(ticks,5))
    monkeypatch.setattr(windows.time,"sleep",lambda _:None)
    result=windows.close_notepad_window()
    send.assert_called_once()
    assert result["windowClosed"] is False
    assert result["verified"] is False
    assert result["needsUserDecision"] is True
