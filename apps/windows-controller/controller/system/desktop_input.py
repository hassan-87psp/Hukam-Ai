"""Explicitly approved foreground mouse and keyboard control for owned Windows apps.

This is a MANUAL desktop input primitive, not an autonomous model tool.
Never targets terminals, WhatsApp, password dialogs or hidden/background windows.
All mouse pixels are absolute virtual-desktop coordinates and must remain
inside the current foreground application's *client* area. No screenshots,
clipboard contents or typed text are recorded by this module.
"""
from __future__ import annotations

import time

from ..browser import operator as keyboard
from ..system import launcher, windows

ALLOWED_APPS = {
    "chrome.exe", "msedge.exe", "firefox.exe", "notepad.exe", "explorer.exe",
    "winword.exe", "excel.exe", "powerpnt.exe", "mspaint.exe",
}
MOUSE_KINDS = {"click", "double_click", "right_click", "drag"}
KEYS = {
    "enter", "tab", "shift+tab", "escape", "backspace", "home", "end",
    "arrowdown", "arrowup", "arrowleft", "arrowright",
    "ctrl+a", "ctrl+c", "ctrl+v", "ctrl+z", "ctrl+s",
}


class DesktopInputError(RuntimeError):
    pass


def inside_client(point: tuple[int, int], rect: tuple[int, int, int, int]) -> bool:
    """Pure boundary check; accepts negative coordinates on second monitors."""
    x, y = point
    left, top, right, bottom = rect
    return left <= x < right and top <= y < bottom


def _foreground():
    if not windows.IS_WINDOWS:
        raise DesktopInputError("Desktop input needs an interactive Windows session")
    w = windows.active_window()
    if not w or w.process.casefold() not in ALLOWED_APPS:
        raise DesktopInputError(
            "Focus an allowed Chrome, Edge, Firefox, Explorer, Notepad, Word, Excel, PowerPoint or Paint window")
    import win32gui
    if not win32gui.IsWindowVisible(w.hwnd) or win32gui.IsIconic(w.hwnd):
        raise DesktopInputError("The foreground application must be visible and restored")
    if win32gui.GetForegroundWindow() != w.hwnd:
        raise DesktopInputError("Foreground window changed before input")
    return w


def _client_rect(hwnd: int) -> tuple[int, int, int, int]:
    import win32gui
    left, top, right, bottom = win32gui.GetClientRect(hwnd)
    origin_x, origin_y = win32gui.ClientToScreen(hwnd, (left, top))
    end_x, end_y = win32gui.ClientToScreen(hwnd, (right, bottom))
    return origin_x, origin_y, end_x, end_y


def _ensure_target(hwnd: int) -> None:
    import win32gui
    if win32gui.GetForegroundWindow() != hwnd or not win32gui.IsWindowVisible(hwnd) or win32gui.IsIconic(hwnd):
        raise DesktopInputError("Target window lost focus; input stopped")


def control(args: dict) -> dict:
    kind = args["kind"]
    if launcher.SIMULATE:
        # Never include typed content or coordinates in logs.
        launcher._record("desktop.control", kind)
        return {"kind": kind, "inputDelivered": True, "verified": False,
                "simulated": True}
    active = _foreground()
    import win32api
    import win32con

    rect = _client_rect(active.hwnd)
    if rect[2] - rect[0] < 160 or rect[3] - rect[1] < 100:
        raise DesktopInputError("The foreground app is too small to control reliably")

    if kind in MOUSE_KINDS:
        origin = (args["x"], args["y"])
        if not inside_client(origin, rect):
            raise DesktopInputError("Mouse target must be inside the foreground window content area")
        destination = (args["toX"], args["toY"]) if kind == "drag" else None
        if destination and not inside_client(destination, rect):
            raise DesktopInputError("Drag destination must remain inside the same window")
        _ensure_target(active.hwnd)
        win32api.SetCursorPos(origin)
        if kind == "click" or kind == "double_click":
            count = 2 if kind == "double_click" else 1
            for _ in range(count):
                _ensure_target(active.hwnd)
                win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
                win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
                if count == 2:
                    time.sleep(0.065)
        elif kind == "right_click":
            win32api.mouse_event(win32con.MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
            win32api.mouse_event(win32con.MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
        else:
            held = False
            try:
                win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
                held = True
                for i in range(1, 13):
                    _ensure_target(active.hwnd)
                    x = round(origin[0] + (destination[0] - origin[0]) * i / 12)
                    y = round(origin[1] + (destination[1] - origin[1]) * i / 12)
                    win32api.SetCursorPos((x, y))
                    time.sleep(0.012)
            finally:
                if held:
                    win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    elif kind == "scroll":
        _ensure_target(active.hwnd)
        center = ((rect[0] + rect[2]) // 2, (rect[1] + rect[3]) // 2)
        win32api.SetCursorPos(center)
        win32api.mouse_event(win32con.MOUSEEVENTF_WHEEL, 0, 0, args["steps"] * 120, 0)
    elif kind == "type":
        # Never type into an element reported as a password field.
        try:
            import uiautomation as auto
            focused = auto.GetFocusedControl()
            if focused is not None and getattr(focused, "IsPassword", False):
                raise DesktopInputError("Typing into password fields is blocked")
        except DesktopInputError:
            raise
        except Exception:
            # UIA inability to inspect the input focus is not permission to
            # type into an unknown field.
            raise DesktopInputError("Could not verify focused input field safety")
        _ensure_target(active.hwnd)
        keyboard._send_unicode(args["text"])
    elif kind == "key":
        if args["key"] not in KEYS:
            raise DesktopInputError("Unsupported keyboard shortcut")
        _ensure_target(active.hwnd)
        keyboard._press_key(args["key"])
    else:
        raise DesktopInputError("Unsupported desktop input operation")

    return {"kind": kind, "window": active.title[:100], "process": active.process,
            "inputDelivered": True, "verified": False,
            "note": "Input delivered to the foreground app. The resulting document or website state is not independently verified."}
