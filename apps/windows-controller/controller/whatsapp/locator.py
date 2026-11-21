"""Recognize installed Personal WhatsApp Desktop without treating Chrome tabs as the app.

WhatsApp releases use native WhatsApp.exe/WhatsAppDesktop.exe, a packaged
ApplicationFrameHost.exe, or WebView2. Native process identity is sufficient,
even when its window title is simply "Chats" or "Inbox". Generic host processes
require the *top-level window title* to identify WhatsApp. Chrome/Edge browser
tabs are intentionally never misclassified as desktop application windows.

This detector reads process names and top-level window titles only; it does not
read or transmit message bodies, contacts, or accessibility trees.
"""
from __future__ import annotations

from ..system import windows

NATIVE_PROCESSES = frozenset({
    "whatsapp.exe", "whatsappdesktop.exe", "whatsappbeta.exe",
    "whatsapp.root.exe",  # WhatsApp's 2026 WebView2/WinUI package host

})
HOST_PROCESSES = frozenset({"applicationframehost.exe", "msedgewebview2.exe"})
ALL_PROCESSES = NATIVE_PROCESSES | HOST_PROCESSES


def _has_whatsapp_parent(pid: int) -> bool:
    """For WebView2 top-level windows, identify the genuine WhatsApp parent.
    
    A generic msedgewebview2.exe can belong to dozens of unrelated apps.
    We must never classify one as WhatsApp just from its executable name.
    """
    if pid <= 0:
        return False
    try:
        import psutil
        proc = psutil.Process(pid)
        return any(parent.name().casefold() in NATIVE_PROCESSES
                   for parent in proc.parents()[:7])
    except (ImportError, OSError, RuntimeError):
        return False
    except Exception:
        # AccessDenied / NoSuchProcess differ by psutil version; fail closed.
        return False


def matches_desktop_window(w: windows.WindowInfo) -> bool:
    process = w.process.casefold()
    if process in NATIVE_PROCESSES:
        return True
    if process in HOST_PROCESSES and (
        "whatsapp" in w.title.casefold() or _has_whatsapp_parent(w.pid)
    ):
        return True
    return False


def desktop_windows(candidates: list[windows.WindowInfo] | None = None) -> list[windows.WindowInfo]:
    return [w for w in (windows.list_windows() if candidates is None else candidates)
            if matches_desktop_window(w)]


def running_native_processes() -> list[str]:
    """Report only executable names, never paths, arguments or user information."""
    try:
        import psutil
        names = set()
        for p in psutil.process_iter(["name"]):
            try:
                name = str(p.info.get("name") or "").casefold()
                if name in NATIVE_PROCESSES:
                    names.add(name)
            except (psutil.AccessDenied, psutil.NoSuchProcess, OSError):
                continue
        return sorted(names)
    except (ImportError, OSError, RuntimeError):
        return []


def focus_whatsapp() -> windows.WindowInfo | None:
    """Prefer the already active verified app; otherwise focus its main window.

    WhatsApp WinUI can expose several visible helper windows, so choose the
    largest real desktop window first instead of blindly focusing a toast.
    Never focus Chrome/Edge or an unrelated WebView2 process.
    """
    active = windows.active_window()
    if active and matches_desktop_window(active):
        return active
    candidates = desktop_windows()
    try:
        if windows.IS_WINDOWS:
            import win32gui

            def area(w: windows.WindowInfo) -> int:
                try:
                    left, top, right, bottom = win32gui.GetWindowRect(w.hwnd)
                    return max(0, right - left) * max(0, bottom - top)
                except Exception:
                    # pywintypes.error (invalid/stale HWND) is not always an
                    # OSError subclass. Ignore a stale helper, never crash.
                    return 0
            candidates.sort(key=area, reverse=True)
    except ImportError:
        pass
    for candidate in candidates:
        if windows.bring_to_front(candidate):
            foreground = windows.active_window()
            if foreground and foreground.hwnd == candidate.hwnd and matches_desktop_window(foreground):
                return foreground
    return None
