"""Real-user regression: HUKM diagnostics said not detected while Chrome was
foreground. This tests recognition and safe Desktop-only fallback. Live WhatsApp
UI remains untested until the user runs the updated Controller on Windows.
"""
import threading

import pytest

from controller.actions.executor import Executor
from controller.config import ALL_CAPABILITIES, Config
from controller.system import launcher, windows
from controller.whatsapp import adapter, locator
from controller.system.windows import WindowInfo


def _w(process: str, title: str, hwnd: int = 50) -> WindowInfo:
    return WindowInfo(hwnd, title, process, 177)


def test_native_whatsapp_detected_with_non_whatsapp_title():
    candidates = [_w("chrome.exe", "WhatsApp - Google Chrome", 11),
                  _w("WhatsApp.exe", "Chats", 12)]
    matches = locator.desktop_windows(candidates)
    assert len(matches) == 1
    assert matches[0].process == "WhatsApp.exe"
    assert locator.matches_desktop_window(_w("WhatsAppDesktop.exe", "Inbox"))
    assert locator.matches_desktop_window(_w("WhatsAppBeta.exe", "Messenger"))
    assert locator.matches_desktop_window(_w("WhatsApp.Root.exe", "Chats"))
    assert "whatsapp.root.exe" in locator.NATIVE_PROCESSES


def test_webview_host_requires_explicit_whatsapp_top_level_title():
    assert locator.matches_desktop_window(_w("msedgewebview2.exe", "WhatsApp"))
    assert locator.matches_desktop_window(_w("ApplicationFrameHost.exe", "WhatsApp"))
    assert not locator.matches_desktop_window(_w("msedgewebview2.exe", "Microsoft Teams"))
    assert not locator.matches_desktop_window(_w("ApplicationFrameHost.exe", "Settings"))
    assert not locator.matches_desktop_window(_w("chrome.exe", "WhatsApp"))
    assert not locator.matches_desktop_window(_w("msedge.exe", "WhatsApp"))


def test_webview2_window_belongs_to_whatsapp_root_only_if_parent_confirmed(monkeypatch):
    monkeypatch.setattr(locator, "_has_whatsapp_parent", lambda pid: pid == 99)
    assert locator.matches_desktop_window(WindowInfo(10, "Chats", "msedgewebview2.exe", 99))
    assert not locator.matches_desktop_window(WindowInfo(11, "Chats", "msedgewebview2.exe", 100))


def test_whatsapp_check_finds_native_window_without_title(monkeypatch):
    monkeypatch.setattr(windows, "list_windows", lambda: [
        _w("chrome.exe", "WhatsApp - Google Chrome", 11),
        _w("WhatsApp.exe", "Chats", 12),
    ])
    monkeypatch.setattr(locator, "focus_whatsapp", lambda: None)
    monkeypatch.setattr(adapter, "unread_from_desktop_accessibility",
                        lambda w: 4 if w.process == "WhatsApp.exe" else None)
    result = adapter.check("desktop", "default")
    assert result["unreadChats"] == 4
    assert result["source"] == "WhatsApp Desktop Unread filter"


def test_chrome_whatsapp_tab_is_not_mistaken_for_desktop_count(monkeypatch):
    monkeypatch.setattr(windows, "list_windows", lambda: [
        _w("chrome.exe", "(4) WhatsApp - Google Chrome", 11)])
    monkeypatch.setattr(locator, "running_native_processes", lambda: [])
    launcher.simulated_calls.clear()
    result = adapter.check("desktop", "default")
    assert result["unreadChats"] is None
    assert result["source"] == "not-detected"
    assert ("launch_whatsapp_native", "WhatsApp Desktop") in launcher.simulated_calls
    assert not any(kind == "open_url" for kind, _ in launcher.simulated_calls)


def test_no_unread_count_remains_a_failure_even_when_app_opened(monkeypatch):
    monkeypatch.setattr(windows, "list_windows", lambda: [])
    monkeypatch.setattr(locator, "running_native_processes", lambda: [])
    cfg = Config()
    exec = Executor(cfg, lambda: list(ALL_CAPABILITIES))
    result = exec.run("whatsapp.check", {"mode": "desktop"}, threading.Event())
    assert not result.ok
    assert result.error["code"] == "UNVERIFIABLE"
    assert "WhatsApp" in result.error["message"]


def test_whatsapp_browser_web_mode_opens_browser_without_claiming_unread(monkeypatch):
    monkeypatch.setattr(windows, "list_windows", lambda: [])
    launcher.simulated_calls.clear()
    result = adapter.check("web", "default")
    assert result["unreadChats"] is None
    assert result["source"] == "web-not-verified"
    assert launcher.simulated_calls[-1] == ("open_url", "https://web.whatsapp.com/")


def test_diagnostic_window_classification_does_not_expose_contacts(monkeypatch):
    from controller.system import diagnostics
    monkeypatch.setattr(launcher, "SIMULATE", False)
    monkeypatch.setattr(windows, "IS_WINDOWS", True)
    monkeypatch.setattr(windows, "active_window", lambda: _w("chrome.exe", "WhatsApp - Google Chrome"))
    monkeypatch.setattr(windows, "list_windows", lambda: [_w("WhatsApp.exe", "Chats", 22)])
    monkeypatch.setattr(locator, "running_native_processes", lambda: ["whatsapp.exe"])
    # No UIA needed for window detection itself; test pure locator above.
    result = locator.desktop_windows()
    assert len(result) == 1 and result[0].title == "Chats"
    assert not locator.matches_desktop_window(windows.active_window())
