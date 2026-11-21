"""Approved, bounded browser input on the user's own Windows desktop.

This is intentionally NOT a shell/terminal/desktop-wide remote control API.
Only a currently foreground Chrome/Edge/Firefox window can be targeted.
Every input action requires owner approval in the HUKM relay. Never logs text.
A successful OS input means *delivered*, not that a website task succeeded.
"""
from __future__ import annotations

import ctypes
import sys
from ctypes import wintypes

from ..system import launcher, windows

BROWSERS = {"chrome.exe", "msedge.exe", "firefox.exe"}
KEYS = {
    "enter": 0x0D, "tab": 0x09, "escape": 0x1B,
    "backspace": 0x08, "home": 0x24, "end": 0x23,
    "arrowdown": 0x28, "arrowup": 0x26,
    "arrowleft": 0x25, "arrowright": 0x27,
    "ctrl+l": 0x4C, "ctrl+a": 0x41,
    "ctrl+c": 0x43, "ctrl+v": 0x56, "ctrl+z": 0x5A, "ctrl+s": 0x53,
    "shift+tab": 0x09,
}
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004


def _send_unicode(text: str) -> None:
    # Keyboard layout independent Unicode injection; no clipboard access.
    ULONG_PTR = ctypes.c_ulonglong if sys.maxsize > 2**32 else ctypes.c_ulong

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [
            ("wVk", wintypes.WORD), ("wScan", wintypes.WORD),
            ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD),
            ("dwExtraInfo", ULONG_PTR),
        ]

    class INPUTUNION(ctypes.Union):
        _fields_ = [("ki", KEYBDINPUT)]

    class INPUT(ctypes.Structure):
        _fields_ = [("type", wintypes.DWORD), ("value", INPUTUNION)]

    user32 = ctypes.windll.user32
    for i in range(0, len(raw := text.encode("utf-16-le")), 2):
        scan = int.from_bytes(raw[i:i + 2], "little")
        down = INPUT(1, INPUTUNION(ki=KEYBDINPUT(0, scan, KEYEVENTF_UNICODE, 0, 0)))
        up = INPUT(1, INPUTUNION(ki=KEYBDINPUT(0, scan, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, 0, 0)))
        sent = user32.SendInput(2, ctypes.byref((INPUT * 2)(down, up)), ctypes.sizeof(INPUT))
        if sent != 2:
            raise RuntimeError("Windows did not accept keyboard input")


def _press_key(key: str) -> None:
    import win32api
    import win32con
    if key == "shift+tab":
        win32api.keybd_event(win32con.VK_SHIFT, 0, 0, 0)
        try:
            win32api.keybd_event(KEYS[key], 0, 0, 0)
            win32api.keybd_event(KEYS[key], 0, win32con.KEYEVENTF_KEYUP, 0)
        finally:
            win32api.keybd_event(win32con.VK_SHIFT, 0, win32con.KEYEVENTF_KEYUP, 0)
    elif key.startswith("ctrl+"):
        win32api.keybd_event(win32con.VK_CONTROL, 0, 0, 0)
        try:
            win32api.keybd_event(KEYS[key], 0, 0, 0)
            win32api.keybd_event(KEYS[key], 0, win32con.KEYEVENTF_KEYUP, 0)
        finally:
            win32api.keybd_event(win32con.VK_CONTROL, 0, win32con.KEYEVENTF_KEYUP, 0)
    else:
        win32api.keybd_event(KEYS[key], 0, 0, 0)
        win32api.keybd_event(KEYS[key], 0, win32con.KEYEVENTF_KEYUP, 0)


def _check_target(hwnd: int, cancel=None) -> None:
    if cancel is not None and cancel.is_set():
        raise RuntimeError("Browser input interrupted")
    import win32gui
    if win32gui.GetForegroundWindow() != hwnd or not win32gui.IsWindowVisible(hwnd) or win32gui.IsIconic(hwnd):
        raise RuntimeError("Browser target changed or is no longer visible")


def _check_text_target(hwnd: int, cancel=None) -> None:
    _check_target(hwnd, cancel)
    try:
        import uiautomation as auto
        focused = auto.GetFocusedControl()
        is_password = getattr(focused, "IsPassword", None)
        if focused is None or is_password is None or bool(is_password):
            raise RuntimeError("Unknown or password field; browser typing blocked")
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError("Cannot verify browser typing target") from exc
    _check_target(hwnd, cancel)


def control(args: dict, cancel=None) -> dict:
    if cancel is not None and cancel.is_set():
        raise RuntimeError("Browser input interrupted")
    kind = args["kind"]
    if launcher.SIMULATE:
        # Only metadata: typing contents must never enter logs.
        launcher._record("browser.control", kind if kind != "type" else "type (redacted)")
        return {"kind": kind, "inputDelivered": True, "verified": False, "simulated": True}
    if not windows.IS_WINDOWS:
        raise RuntimeError("Browser control is supported only on Windows")

    active = windows.active_window()
    if not active or active.process.casefold() not in BROWSERS:
        raise RuntimeError("Bring Chrome, Edge or Firefox to the foreground before browser control")
    import win32api
    import win32con
    import win32gui

    _check_target(active.hwnd, cancel)

    if kind == "click":
        x, y = args["x"], args["y"]
        left, top, right, bottom = win32gui.GetWindowRect(active.hwnd)
        # Prevent clicking the taskbar or unrelated apps outside browser.
        if not (left <= x < right and top <= y < bottom):
            raise RuntimeError("Click coordinates are outside the foreground browser window")
        point = (x, y)
        def check_pointer():
            _check_target(active.hwnd, cancel)
            if win32gui.GetWindowRect(active.hwnd) != (left, top, right, bottom):
                raise RuntimeError("Browser window moved or resized")
            hit = win32gui.WindowFromPoint(point)
            if not hit or win32gui.GetAncestor(hit, 2) != active.hwnd:
                raise RuntimeError("Browser target is obscured")
        check_pointer()
        win32api.SetCursorPos(point)
        check_pointer()
        if win32api.GetCursorPos() != point:
            raise RuntimeError("Browser pointer moved")
        win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    elif kind == "type":
        for char in args["text"]:
            _check_text_target(active.hwnd, cancel)
            _send_unicode(char)
    elif kind == "scroll":
        # Wheel delivery follows pointer location on Windows. Refuse to
        # scroll over another application's window.
        _check_target(active.hwnd, cancel)
        hit = win32gui.WindowFromPoint(win32api.GetCursorPos())
        if not hit or win32gui.GetAncestor(hit, 2) != active.hwnd:
            raise RuntimeError("Move the mouse over the foreground browser before scrolling")
        _check_target(active.hwnd, cancel)
        win32api.mouse_event(win32con.MOUSEEVENTF_WHEEL, 0, 0, args["steps"] * 120, 0)
    elif kind == "key":
        _check_target(active.hwnd, cancel)
        _press_key(args["key"])
    else:
        raise RuntimeError("Unsupported browser input")

    _check_target(active.hwnd, cancel)
    return {
        "kind": kind, "browser": active.process,
        "inputDelivered": True, "verified": False,
        "note": "Input delivered to the foreground browser. The website result has not been independently verified.",
    }
