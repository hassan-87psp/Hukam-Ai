"""Reliability tests: desktop focus and defensive config loading."""
import json

from controller.config import Config
from controller.system import windows


def test_config_handles_malformed_values(monkeypatch, tmp_path):
    monkeypatch.setenv("HUKM_DATA_DIR", str(tmp_path))
    config_path = Config.path()
    config_path.write_text(json.dumps({
        "capabilities": "whatsapp",
        "apps": ["notepad", "unknown", 7],
        "allowed_folders": "all",
        "extra_allowed_dirs": "C:/",
        "whatsapp_mode": "../bad",
        "browser": "untrusted",
        "heartbeat_s": 0,
        "search_max_entries": 999999999,
        "search_max_depth": -1,
        "search_time_budget_s": 0,
        "log_level": "VERBOSE",
        "screen_capture": "yes",
    }), encoding="utf-8")
    cfg = Config.load()
    assert isinstance(cfg.capabilities, list)
    assert cfg.apps == ["notepad"]
    assert cfg.allowed_folders == ["downloads", "documents", "desktop", "pictures", "music", "videos"]
    assert cfg.extra_allowed_dirs == []
    assert cfg.whatsapp_mode == "desktop"
    assert cfg.browser == "default"
    assert cfg.heartbeat_s == 20
    assert cfg.search_max_entries == 150000
    assert cfg.search_max_depth == 6
    assert cfg.search_time_budget_s == 25
    assert cfg.log_level == "INFO"
    assert cfg.screen_capture is False


def test_automated_focus_never_picks_chrome_for_whatsapp(monkeypatch):
    monkeypatch.setattr(windows, "IS_WINDOWS", True)
    items = [
        windows.WindowInfo(10, "WhatsApp - Google Chrome", "chrome.exe", 1),
        windows.WindowInfo(11, "WhatsApp", "WhatsApp.exe", 2),
    ]
    monkeypatch.setattr(windows, "list_windows", lambda: items)
    called = []
    monkeypatch.setattr(windows, "bring_to_front", lambda w: called.append(w.hwnd) or True)
    target = windows.focus_by_process(["WhatsApp.exe"], title_contains="WhatsApp")
    assert target == items[1]
    assert called == [11]


def test_focus_reports_unavailable_platform(monkeypatch):
    monkeypatch.setattr(windows, "IS_WINDOWS", False)
    assert windows.focus_by_process(["notepad.exe"]) is None
    assert windows.bring_to_front(windows.WindowInfo(1, "test", "notepad.exe", 1)) is False
