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
})
HOST_PROCESSES = frozenset({"applicationframehost.exe", "msedgewebview2.exe"})
ALL_PROCESSES = NATIVE_PROCESSES | HOST_PROCESSES


def matches_desktop_window(w: windows.WindowInfo) -> bool:
    process = w.process.casefold()
    if process in NATIVE_PROCESSES:
        return True
    if process in HOST_PROCESSES and "whatsapp" in w.title.casefold():
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
    """Focus a known WhatsApp app window, never a browser tab or unrelated host."""
    for candidate in desktop_windows():
        if windows.bring_to_front(candidate):
            active = windows.active_window()
            if active and active.hwnd == candidate.hwnd:
                return active
    return None
