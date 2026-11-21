"""v1.7.0 final acceptance regression: no silent WhatsApp Web fallback.

These tests simulate native Windows actions; live signed-in WhatsApp remains a
separate final user-machine acceptance, not part of automated CI.
"""
import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

from controller import VERSION
from controller.config import Config
from controller.system import launcher, diagnostics
from controller.whatsapp import adapter, unread_senders


def test_release_version_and_privacy_safe_diagnostics(monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", True)
    d=diagnostics.probe(Config(whatsapp_mode="web"))
    assert re.fullmatch(r"\d+\.\d+\.\d+", VERSION)
    setup = (Path(__file__).resolve().parents[1] / "packaging" / "HUKM-Setup.iss").read_text(encoding="utf-8")
    assert f\'#define HUKM_VERSION "{VERSION}"\' in setup
    assert d["controllerVersion"] == VERSION
    assert d["effectiveWhatsAppDefault"] == "desktop"
    assert d["automaticWhatsAppWebFallback"] is False
    assert d["singleInstanceLockEnabled"] is True
    assert d["privateDataCollected"] is False
    assert d["whatsappCapabilityEnabled"] is True
    assert "whatsappSearchControlAccessible" in d
    assert "whatsappUnreadFilterAccessible" in d


def test_legacy_web_config_migrates_to_desktop_default(tmp_path, monkeypatch):
    monkeypatch.setenv("HUKM_DATA_DIR", str(tmp_path))
    Config.path().write_text(json.dumps({"whatsapp_mode":"web"}),encoding="utf-8")
    cfg=Config.load()
    assert cfg.whatsapp_mode == "desktop"


def test_desktop_draft_never_enters_web_browser(monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", True)
    launcher.simulated_calls.clear()
    with pytest.raises(launcher.LaunchError,match="automatic WhatsApp Web fallback"):
        adapter.compose("60123456789","Hello","desktop","default")
    assert not launcher.simulated_calls
    # Web remains available only to *explicit* Web-mode routing.
    result=adapter.compose("60123456789","Hello","web","default")
    assert result["via"] == "web"
    assert launcher.simulated_calls[-1][0] == "open_url"


def test_native_launcher_is_not_whatsapp_uri(monkeypatch):
    monkeypatch.setattr(launcher,"SIMULATE",True)
    launcher.simulated_calls.clear()
    result=adapter.open_whatsapp("desktop","default")
    assert result["opened"]=="desktop"
    assert result["messagesRead"] is False
    assert launcher.simulated_calls == [
        ("launch_whatsapp_native","WhatsApp Desktop")
    ]


def test_unread_filter_state_can_be_unknown(monkeypatch):
    active=SimpleNamespace(GetSelectionItemPattern=lambda:SimpleNamespace(IsSelected=True))
    inactive=SimpleNamespace(GetSelectionItemPattern=lambda:SimpleNamespace(IsSelected=False))
    missing=SimpleNamespace(GetSelectionItemPattern=lambda:None,
                            GetTogglePattern=lambda:None)
    assert unread_senders._unread_filter_selected(active) is True
    assert unread_senders._unread_filter_selected(inactive) is False
    assert unread_senders._unread_filter_selected(missing) is None
