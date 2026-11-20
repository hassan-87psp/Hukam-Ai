import os
import threading
import time
from pathlib import Path

import pytest

from controller.actions.dedupe import DedupeStore
from controller.actions.executor import Executor
from controller.browser.web import extract_top_video, youtube_search_url
from controller.config import ALL_CAPABILITIES, Config
from controller.files.search import score_name, search
from controller.security import validation as v
from controller.system import launcher
from controller.whatsapp import adapter as whatsapp_adapter
from controller.whatsapp.adapter import unread_from_titles, count_from_accessibility_items


def make_exec(**over):
    cfg = Config()
    for k, val in over.items():
        setattr(cfg, k, val)
    return Executor(cfg, lambda: list(ALL_CAPABILITIES))


def run(ex, action, args):
    return ex.run(action, args, threading.Event())


# ---- validation -----------------------------------------------------------

def test_rejects_unknown_actions_and_bad_urls():
    with pytest.raises(v.ValidationError):
        v.validate("shell.exec", {"cmd": "del"})
    with pytest.raises(v.ValidationError):
        v.validate("web.open", {"url": "file:///C:/Windows"})
    with pytest.raises(v.ValidationError):
        v.validate("web.open", {"url": "javascript:alert(1)"})
    with pytest.raises(v.ValidationError):
        v.validate("file.search", {"query": "x", "ext": ["exe"]})
    assert v.validate("web.open", {"url": "https://example.com"}) == {"url": "https://example.com"}


def test_check_openable_blocks_outside_and_executables(sandbox, tmp_path):
    roots = list(sandbox.values())
    (sandbox["downloads"] / "setup.exe").write_text("x")
    with pytest.raises(v.ValidationError):
        v.check_openable(sandbox["downloads"] / "setup.exe", roots)
    with pytest.raises(v.ValidationError):
        v.check_openable(tmp_path / "Private" / "invoice-secret.pdf", roots)
    with pytest.raises(v.ValidationError):
        v.check_openable(sandbox["downloads"] / ".." / "Private" / "invoice-secret.pdf", roots)


# ---- file search ------------------------------------------------------------

def test_search_finds_only_inside_allowed_roots(sandbox):
    (sandbox["downloads"] / "Invoice March.pdf").write_text("a")
    sub = sandbox["documents"] / "Clients" / "2026"
    sub.mkdir(parents=True)
    (sub / "invoice_april.pdf").write_text("b")
    (sub / "invoice_april.xlsx").write_text("c")
    (sandbox["documents"] / "notes.txt").write_text("d")
    ex = make_exec()
    out = run(ex, "file.search", {"query": "invoice", "ext": ["pdf"]})
    assert out.ok, out.error
    names = {r["name"] for r in out.result["results"]}
    assert names == {"Invoice March.pdf", "invoice_april.pdf"}  # Private/invoice-secret.pdf never appears


def test_search_latest_on_desktop(sandbox):
    a = sandbox["desktop"] / "old.xlsx"
    b = sandbox["desktop"] / "new.xlsx"
    a.write_text("1")
    b.write_text("2")
    os.utime(a, (time.time() - 1000, time.time() - 1000))
    out = run(make_exec(), "file.search", {"query": "", "ext": ["xlsx", "xls", "csv"], "location": "desktop", "sort": "latest"})
    assert [r["name"] for r in out.result["results"]] == ["new.xlsx", "old.xlsx"]


def test_search_respects_cancel(sandbox):
    ev = threading.Event()
    ev.set()
    r = search([("downloads", sandbox["downloads"])], "x", cancel=ev)
    assert r["cancelled"]


def test_score_name():
    assert score_name("Invoice March.pdf", ["invoice"]) > 0
    assert score_name("report.pdf", ["invoice"]) == 0


# ---- actions (simulated launches) -------------------------------------------

def test_folder_open(sandbox):
    launcher.simulated_calls.clear()
    out = run(make_exec(), "folder.open", {"folder": "downloads"})
    assert out.ok
    assert launcher.simulated_calls == [("open_path", str(sandbox["downloads"]))]


def test_folder_not_allowed(sandbox):
    out = run(make_exec(allowed_folders=["documents"]), "folder.open", {"folder": "downloads"})
    assert not out.ok and out.error["code"] == "NOT_ALLOWED"


def test_file_open_single_match_and_ambiguous(sandbox):
    (sandbox["desktop"] / "report.pdf").write_text("x")
    launcher.simulated_calls.clear()
    out = run(make_exec(), "file.open", {"query": "", "ext": ["pdf"], "location": "desktop"})
    assert out.ok and out.result["opened"]
    assert launcher.simulated_calls[-1][0] == "open_path"
    (sandbox["desktop"] / "other.pdf").write_text("y")
    out2 = run(make_exec(), "file.open", {"query": "", "ext": ["pdf"], "location": "desktop"})
    assert out2.ok and out2.result["ambiguous"] and len(out2.result["candidates"]) == 2


def test_file_open_path_outside_roots_is_refused(sandbox, tmp_path):
    out = run(make_exec(), "file.open", {"path": str(tmp_path / "Private" / "invoice-secret.pdf")})
    assert not out.ok and out.error["code"] == "NOT_ALLOWED"


def test_app_allowlist(sandbox):
    launcher.simulated_calls.clear()
    ok = run(make_exec(), "app.open", {"app": "notepad"})
    assert ok.ok and launcher.simulated_calls[-1] == ("start_program", "notepad.exe")
    bad = run(make_exec(apps=["chrome"]), "app.open", {"app": "notepad"})
    assert not bad.ok and bad.error["code"] == "NOT_ALLOWED"


def test_capability_disabled_locally(sandbox):
    out = run(make_exec(capabilities=["system"]), "folder.open", {"folder": "downloads"})
    assert not out.ok and out.error["code"] == "CAPABILITY_DISABLED"


def test_web_search_url(sandbox):
    launcher.simulated_calls.clear()
    out = run(make_exec(), "web.search", {"query": "Forex news"})
    assert out.ok
    assert launcher.simulated_calls[-1] == ("open_url", "https://www.google.com/search?q=Forex+news")


def test_youtube_play_falls_back_honestly(sandbox, monkeypatch):
    from controller.browser import web

    monkeypatch.setattr(web, "resolve_top_video", lambda q: None)
    out = run(make_exec(), "youtube.play", {"query": "gold analysis"})
    assert out.ok and out.result["mode"] == "search"
    monkeypatch.setattr(web, "resolve_top_video", lambda q: ("abcdefghijk", "Gold Analysis Today"))
    out = run(make_exec(), "youtube.play", {"query": "gold analysis"})
    assert out.result["mode"] == "video" and out.result["url"].endswith("abcdefghijk")


def test_whatsapp_compose_never_sends(sandbox):
    launcher.simulated_calls.clear()
    out = run(make_exec(), "whatsapp.compose", {"contact": "Ali", "message": "Main 10 minute mein call karunga", "phone": "923001234567"})
    assert out.ok and out.result["sent"] is False
    assert launcher.simulated_calls[-1][0] == "open_uri"
    assert launcher.simulated_calls[-1][1].startswith("whatsapp://send?phone=923001234567&text=Main%2010")

def test_whatsapp_opens_desktop_by_default_or_web_on_request(sandbox):
    launcher.simulated_calls.clear()
    out = run(make_exec(), "whatsapp.open", {})
    assert out.ok and out.result["opened"] == "desktop"
    assert launcher.simulated_calls[-1] == ("open_uri", "whatsapp:")
    other = run(make_exec(), "whatsapp.open", {"mode": "web"})
    assert other.ok and other.result["opened"] == "web"
    assert launcher.simulated_calls[-1] == ("open_url", "https://web.whatsapp.com/")

def test_whatsapp_invalid_mode_blocked(sandbox):
    out = run(make_exec(), "whatsapp.open", {"mode": "invalid"})
    assert not out.ok and out.error["code"] == "NOT_ALLOWED"


def test_device_status(sandbox):
    out = run(make_exec(), "device.status", {})
    assert out.ok and "memory" in out.result and "hostname" in out.result


# ---- parsing helpers --------------------------------------------------------

def test_youtube_extraction():
    html = '..."videoRenderer":{"videoId":"dQw4w9WgXcQ","thumbnail":{},"title":{"runs":[{"text":"Gold Analysis \\u0026 Forecast"}]}...'
    assert extract_top_video(html) == ("dQw4w9WgXcQ", "Gold Analysis & Forecast")
    assert extract_top_video("<html>nothing</html>") is None
    assert youtube_search_url("gold analysis") == "https://www.youtube.com/results?search_query=gold+analysis"


def test_whatsapp_title_count():
    assert unread_from_titles(["(3) WhatsApp - Google Chrome", "Notepad"]) == 3
    assert unread_from_titles(["WhatsApp - Google Chrome"]) is None
    assert unread_from_titles(["Notepad"]) is None

def test_whatsapp_unread_filter_badge_and_split_accessibility_controls():
    assert count_from_accessibility_items([("Chats", 53, 90), ("Unread 4", 95, 125)]) == 4
    assert count_from_accessibility_items([("Unread", 94, 125), ("4", 158, 125)]) == 4
    assert count_from_accessibility_items([("Unread", 94, 125), ("5", 158, 200)]) is None
    assert count_from_accessibility_items([("Chats", 53, 90), ("Unread", 94, 125)]) is None


def test_whatsapp_check_unknown_is_not_falsely_zero(monkeypatch):
    from controller.system.windows import WindowInfo
    monkeypatch.setattr(whatsapp_adapter.windows, "list_windows",
                        lambda: [WindowInfo(18, "WhatsApp", "WhatsApp.exe", 101)])
    monkeypatch.setattr(whatsapp_adapter, "unread_from_desktop_accessibility", lambda _w: None)
    result = whatsapp_adapter.check("desktop", "default")
    assert result["unreadChats"] is None
    assert result["source"] == "unavailable"
    assert result["messagesRead"] is False
    assert "unknown" in result["note"].lower()


def test_whatsapp_check_uses_accessibility_badge_when_title_omits_count(monkeypatch):
    from controller.system.windows import WindowInfo
    monkeypatch.setattr(whatsapp_adapter.windows, "list_windows",
                        lambda: [WindowInfo(18, "WhatsApp", "WhatsApp.exe", 101)])
    monkeypatch.setattr(whatsapp_adapter, "unread_from_desktop_accessibility", lambda _w: 4)
    result = whatsapp_adapter.check("desktop", "default")
    assert result["unreadChats"] == 4
    assert result["source"] == "WhatsApp Desktop Unread filter"
    assert result["messagesRead"] is False



# ---- dedupe -----------------------------------------------------------------

def test_dedupe_persists(tmp_path):
    p = tmp_path / "x.json"
    d = DedupeStore(p)
    assert d.mark_started("c1")
    assert not d.mark_started("c1")
    d.store_result("c1", {"type": "result", "commandId": "c1", "ok": True, "screenshot": {"big": 1}})
    d2 = DedupeStore(p)
    assert d2.seen("c1") and "screenshot" not in d2.get("c1")
