"""Top-level window enumeration, active window and focusing (pywin32 on Windows; graceful no-ops elsewhere)."""
from __future__ import annotations

import time
from dataclasses import dataclass

from ..config import IS_WINDOWS


@dataclass(frozen=True)
class WindowInfo:
    hwnd: int
    title: str
    process: str
    pid: int

    def as_dict(self) -> dict:
        return {"title": self.title, "process": self.process, "pid": self.pid}


def _proc_name(pid: int) -> str:
    try:
        import psutil

        return psutil.Process(pid).name()
    except Exception:
        return ""


def list_windows() -> list[WindowInfo]:
    if not IS_WINDOWS:
        return []
    import win32con
    import win32gui
    import win32process

    out: list[WindowInfo] = []

    def cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return True
        title = win32gui.GetWindowText(hwnd)
        if not title:
            return True
        ex = win32gui.GetWindowLong(hwnd, win32con.GWL_EXSTYLE)
        if ex & win32con.WS_EX_TOOLWINDOW:
            return True
        if win32gui.GetWindow(hwnd, win32con.GW_OWNER):
            return True
        # skip cloaked UWP shells (e.g. hidden Settings/Calculator frames)
        try:
            import ctypes

            cloaked = ctypes.c_int(0)
            ctypes.windll.dwmapi.DwmGetWindowAttribute(hwnd, 14, ctypes.byref(cloaked), ctypes.sizeof(cloaked))
            if cloaked.value:
                return True
        except Exception:
            pass
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        out.append(WindowInfo(hwnd, title, _proc_name(pid), pid))
        return True

    win32gui.EnumWindows(cb, None)
    return [w for w in out if w.title not in ("Program Manager", "Windows Input Experience")]


def active_window() -> WindowInfo | None:
    if not IS_WINDOWS:
        return None
    import win32gui
    import win32process

    hwnd = win32gui.GetForegroundWindow()
    if not hwnd:
        return None
    _, pid = win32process.GetWindowThreadProcessId(hwnd)
    return WindowInfo(hwnd, win32gui.GetWindowText(hwnd), _proc_name(pid), pid)


def bring_to_front(window: WindowInfo) -> bool:
    """Restore a minimized app and verify it actually receives focus.

    Windows can deny SetForegroundWindow; report that honestly instead of
    claiming a window is visible when only its process was launched.
    """
    if not IS_WINDOWS:
        return False
    import win32con
    import win32gui

    try:
        if win32gui.IsIconic(window.hwnd):
            win32gui.ShowWindow(window.hwnd, win32con.SW_RESTORE)
        try:
            win32gui.SetForegroundWindow(window.hwnd)
        except Exception:
            # The foreground-lock rule sometimes allows an ALT key sequence.
            try:
                import win32api

                win32api.keybd_event(0x12, 0, 0, 0)
                win32api.keybd_event(0x12, 0, 2, 0)
                win32gui.SetForegroundWindow(window.hwnd)
            except Exception:
                return False
        return win32gui.GetForegroundWindow() == window.hwnd
    except Exception:
        return False


def focus_window(title_part: str) -> WindowInfo | None:
    """Focus a matching title, or return None when Windows denied focus."""
    needle = title_part.lower()
    for w in list_windows():
        if needle in w.title.lower() and bring_to_front(w):
            return w
    return None


def focus_by_process(processes: list[str], title_contains: str | None = None) -> WindowInfo | None:
    """Focus an already-running *installed application*, never an unrelated browser tab.

    Process names are taken from HUKM's fixed app allowlist, not arbitrary
    remote commands. An optional title helps distinguish Windows app frames.
    """
    if not IS_WINDOWS:
        return None
    allowed = {p.casefold() for p in processes}
    if not allowed:
        return None
    needle = title_contains.casefold() if title_contains else None
    for w in list_windows():
        if w.process.casefold() not in allowed:
            continue
        if needle and needle not in w.title.casefold():
            continue
        if bring_to_front(w):
            return w
    return None


def snapshot() -> set[int]:
    return {w.hwnd for w in list_windows()}


def wait_for_window(before: set[int], *, processes: list[str] | None = None, title_contains: str | None = None, timeout: float = 5.0):
    """Wait for a new (or matching) window after a launch. Returns WindowInfo, or None if unverifiable/not seen.

    Returns the string "unverifiable" when window inspection isn't available (non-Windows/simulation).
    """
    if not IS_WINDOWS:
        return "unverifiable"
    procs = {p.lower() for p in processes or []}
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        for w in list_windows():
            matches_proc = not procs or w.process.lower() in procs
            matches_title = not title_contains or title_contains.lower() in w.title.lower()
            if matches_proc and matches_title and (w.hwnd not in before or title_contains):
                return w
        time.sleep(0.25)
    return None


def lock_workstation() -> None:
    if not IS_WINDOWS:
        raise RuntimeError("locking is only supported on Windows")
    import ctypes

    if not ctypes.windll.user32.LockWorkStation():
        raise RuntimeError("Windows refused to lock the workstation")
