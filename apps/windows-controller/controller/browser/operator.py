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
    "ctrl+l": 0x4C, "ctrl+a": 0x41,
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
    if key.startswith("ctrl+"):
        win32api.keybd_event(win32con.VK_CONTROL, 0, 0, 0)
        try:
            win32api.keybd_event(KEYS[key], 0, 0, 0)
            win32api.keybd_event(KEYS[key], 0, win32con.KEYEVENTF_KEYUP, 0)
        finally:
            win32api.keybd_event(win32con.VK_CONTROL, 0, win32con.KEYEVENTF_KEYUP, 0)
    else:
        win32api.keybd_event(KEYS[key], 0, 0, 0)
        win32api.keybd_event(KEYS[key], 0, win32con.KEYEVENTF_KEYUP, 0)


def control(args: dict) -> dict:
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

    if not win32gui.IsWindowVisible(active.hwnd) or win32gui.IsIconic(active.hwnd):
        raise RuntimeError("Browser window must be visible and not minimized")

    if kind == "click":
        x, y = args["x"], args["y"]
        left, top, right, bottom = win32gui.GetWindowRect(active.hwnd)
        # Prevent clicking the taskbar or unrelated apps outside browser.
        if not (left <= x < right and top <= y < bottom):
            raise RuntimeError("Click coordinates are outside the foreground browser window")
        win32api.SetCursorPos((x, y))
        win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    elif kind == "type":
        _send_unicode(args["text"])
    elif kind == "scroll":
        win32api.mouse_event(win32con.MOUSEEVENTF_WHEEL, 0, 0, args["steps"] * 120, 0)
    elif kind == "key":
        _press_key(args["key"])
    else:
        raise RuntimeError("Unsupported browser input")

    return {
        "kind": kind, "browser": active.process,
        "inputDelivered": True, "verified": False,
        "note": "Input delivered to the foreground browser. The website result has not been independently verified.",
    }
