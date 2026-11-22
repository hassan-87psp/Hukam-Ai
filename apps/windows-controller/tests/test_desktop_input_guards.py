"""Regression tests for cooperative foreground input guards, without real mouse input."""
import sys
import threading
from types import SimpleNamespace

import pytest

from controller.system import desktop_input as d


@pytest.fixture
def desktop(monkeypatch):
    state = SimpleNamespace(rect=(-900, 30, -100, 630), point=(-800, 100),
                            hit=100, events=[], typed=[], cancel=threading.Event())
    monkeypatch.setattr(d.launcher, "SIMULATE", False)
    monkeypatch.setattr(d, "_foreground", lambda: SimpleNamespace(hwnd=100, title="Test", process="notepad.exe"))
    monkeypatch.setattr(d, "_ensure_target", lambda hwnd: None)
    monkeypatch.setattr(d, "_client_rect", lambda hwnd: state.rect)
    gui = SimpleNamespace(WindowFromPoint=lambda point: state.hit,
                          GetAncestor=lambda hwnd, flag: hwnd)
    con = SimpleNamespace(MOUSEEVENTF_LEFTDOWN=1, MOUSEEVENTF_LEFTUP=2,
                          MOUSEEVENTF_RIGHTDOWN=3, MOUSEEVENTF_RIGHTUP=4,
                          MOUSEEVENTF_WHEEL=5)
    def move(point):
        state.point = point
    def event(kind, *args):
        state.events.append(kind)
    api = SimpleNamespace(SetCursorPos=move, GetCursorPos=lambda: state.point,
                          mouse_event=event)
    monkeypatch.setitem(sys.modules, "win32gui", gui)
    monkeypatch.setitem(sys.modules, "win32api", api)
    monkeypatch.setitem(sys.modules, "win32con", con)
    monkeypatch.setattr(d.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(d.keyboard, "_send_unicode", state.typed.append)
    return state, api, con


def test_negative_monitor_coordinates_remain_supported(desktop):
    state, _, con = desktop
    result = d.control({"kind": "click", "x": -800, "y": 100}, cancel=state.cancel)
    assert state.events == [con.MOUSEEVENTF_LEFTDOWN, con.MOUSEEVENTF_LEFTUP]
    assert result["inputDelivered"] and not result["verified"]


def test_obscured_target_blocks_mouse_input(desktop):
    state, _, _ = desktop
    state.hit = 200
    with pytest.raises(d.DesktopInputError, match="obscured"):
        d.control({"kind": "click", "x": -800, "y": 100})
    assert state.events == []


def test_window_moves_after_cursor_positioning(desktop):
    state, api, _ = desktop
    def move(point):
        state.point = point
        state.rect = (-700, 30, 100, 630)
    api.SetCursorPos = move
    with pytest.raises(d.DesktopInputError, match="moved or resized"):
        d.control({"kind": "right_click", "x": -800, "y": 100})
    assert not state.events


def test_cancelled_drag_releases_held_mouse_button(desktop):
    state, api, con = desktop
    def event(kind, *args):
        state.events.append(kind)
        if kind == con.MOUSEEVENTF_LEFTDOWN:
            state.cancel.set()
    api.mouse_event = event
    with pytest.raises(d.DesktopInputError, match="interrupted"):
        d.control({"kind": "drag", "x": -800, "y": 100, "toX": -300, "toY": 200},
                  cancel=state.cancel)
    assert state.events == [con.MOUSEEVENTF_LEFTDOWN, con.MOUSEEVENTF_LEFTUP]
    assert state.point == (-800, 100)


def test_second_click_is_blocked_after_cancel(desktop):
    state, api, con = desktop
    def event(kind, *args):
        state.events.append(kind)
        if kind == con.MOUSEEVENTF_LEFTUP:
            state.cancel.set()
    api.mouse_event = event
    with pytest.raises(d.DesktopInputError, match="interrupted"):
        d.control({"kind": "double_click", "x": -800, "y": 100}, cancel=state.cancel)
    assert state.events == [con.MOUSEEVENTF_LEFTDOWN, con.MOUSEEVENTF_LEFTUP]


@pytest.mark.parametrize("focus", [None, SimpleNamespace(), SimpleNamespace(IsPassword=True)])
def test_unknown_or_password_focus_refuses_typing(desktop, monkeypatch, focus):
    state, _, _ = desktop
    monkeypatch.setitem(sys.modules, "uiautomation", SimpleNamespace(GetFocusedControl=lambda: focus))
    with pytest.raises(d.DesktopInputError, match="typing blocked"):
        d.control({"kind": "type", "text": "abc"})
    assert state.typed == []


def test_focus_changes_to_password_during_typing(desktop, monkeypatch):
    state, _, _ = desktop
    monkeypatch.setitem(sys.modules, "uiautomation", SimpleNamespace(
        GetFocusedControl=lambda: SimpleNamespace(IsPassword=bool(state.typed))))
    with pytest.raises(d.DesktopInputError, match="typing blocked"):
        d.control({"kind": "type", "text": "abc"}, cancel=state.cancel)
    assert state.typed == ["a"]


def test_already_cancelled_input_does_not_touch_foreground(desktop, monkeypatch):
    state, _, _ = desktop
    state.cancel.set()
    monkeypatch.setattr(d, "_foreground", lambda: pytest.fail("Window touched after cancellation"))
    with pytest.raises(d.DesktopInputError, match="interrupted"):
        d.control({"kind": "scroll", "steps": 1}, cancel=state.cancel)

def test_visible_mouse_movement_leaves_cursor_at_target(desktop):
    state, api, con=desktop
    visited=[]
    def move(point):
        visited.append(point)
        state.point=point
    api.SetCursorPos=move
    d.control({"kind":"click","x":-250,"y":400})
    assert len(visited)==24 and len(set(visited))>10
    assert state.point==(-250,400)
    assert state.events==[con.MOUSEEVENTF_LEFTDOWN,con.MOUSEEVENTF_LEFTUP]

def test_owner_mouse_intervention_prevents_click(desktop):
    state,api,_=desktop
    def move(point):
        state.point=(point[0]+10,point[1])
    api.SetCursorPos=move
    with pytest.raises(d.DesktopInputError,match="Mouse moved"):
        d.control({"kind":"click","x":-250,"y":400})
    assert not state.events
