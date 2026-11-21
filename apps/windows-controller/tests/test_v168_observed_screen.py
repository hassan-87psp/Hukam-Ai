"""HUKM v1.6.8 observed-window GUI control safety regression tests.

Simulation only: no personal apps, mouse, WhatsApp or private accounts touched.
"""
import threading
from dataclasses import replace

import pytest

from controller.actions.executor import Executor
from controller.config import Config, ALL_CAPABILITIES
from controller.screen import accessibility as uia
from controller.security import validation
from controller.system import launcher, windows


def test_normalized_sensitive_labels_fail_closed_after_icons_or_prefixes():
    blocked = (
        "🗑 Delete account", "Next: Pay now", "Continue to Checkout",
        "Send message", "✓ Submit form", "Admin — Approve payment",
        "Action: Transfer funds", "📤 Upload documents", "Save and Publish",
        "Sign in", "Log Out", "Place Order", "Video call",
        "Reset password", "Agree & Accept", "Report user",
    )
    for name in blocked:
        assert not uia.safe_control_label(name), name
    for name in ("Search", "Next page", "Back", "File", "View details", "Settings", "New tab"):
        assert uia.safe_control_label(name), name


def test_observed_token_binds_window_process_pid_title_and_control_set():
    w = windows.WindowInfo(110, "Reports — Chrome", "chrome.exe", 5678)
    labels = [("ButtonControl", "Search"), ("TabItemControl", "Home")]
    token = uia.window_snapshot(w, labels)
    assert len(token) == 64 and token == uia.window_snapshot(w, list(reversed(labels)))
    assert token != uia.window_snapshot(replace(w, hwnd=111), labels)
    assert token != uia.window_snapshot(replace(w, pid=5679), labels)
    assert token != uia.window_snapshot(replace(w, title="Payments — Chrome"), labels)
    assert token != uia.window_snapshot(w, labels+[("ButtonControl", "Pay now")])


def test_simulated_inspection_lists_only_safe_clickable_controls(monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", True)
    scan = uia.inspect()
    assert scan["process"] == "chrome.exe"
    assert scan["contentRead"] is False and scan["verified"] is True
    controls = {x["label"]: x for x in scan["controls"]}
    assert controls["Search"]["canActivate"] is True
    assert controls["🗑 Delete account"]["canActivate"] is False
    assert len(scan["snapshot"]) == 64


def test_exact_snapshot_click_requires_same_role_label_and_fingerprint(monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", True)
    scan = uia.inspect()
    approved = {"label": "Search", "role": "ButtonControl", "snapshot": scan["snapshot"]}
    clean = validation.validate("ui.activate_observed", approved)
    ex = Executor(Config(), lambda: list(ALL_CAPABILITIES))
    ok = ex.run("ui.activate_observed", clean, threading.Event())
    assert ok.ok and ok.result["inputDelivered"] is True
    assert ok.result["verified"] is False
    repeated = ex.run("ui.activate_observed", clean, threading.Event())
    assert not repeated.ok, "Snapshot must be single-use"

    for wrong in (
        {**approved, "snapshot": "0" * 64},
        {**approved, "role": "TabItemControl"},
        {**approved, "label": "Different button"},
    ):
        outcome = ex.run("ui.activate_observed", wrong, threading.Event())
        assert not outcome.ok

    denied = ex.run("ui.activate_observed", {
        **approved, "label": "🗑 Delete account"
    }, threading.Event())
    assert not denied.ok
    assert denied.error["code"] == "NOT_ALLOWED"


def test_stale_observation_expires_without_any_mouse_input(monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", True)
    scan = uia.inspect()
    token = scan["snapshot"]
    monkeypatch.setattr(uia, "_OBSERVED", (token, uia.time.monotonic()-uia.OBSERVATION_TTL_S-1))
    with pytest.raises(uia.AccessibilityError, match="expired"):
        uia.activate_observed("Search", "ButtonControl", token)


def test_new_inspection_invalidates_previous_token(monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", True)
    original = uia.inspect()["snapshot"]
    monkeypatch.setattr(uia, "_OBSERVED", ("b" * 64, uia.time.monotonic()))
    with pytest.raises(uia.AccessibilityError, match="expired"):
        uia.activate_observed("Search", "ButtonControl", original)


def test_unbound_legacy_clicks_not_executable_and_cross_app_generic_blocked():
    with pytest.raises(validation.ValidationError):
        validation.validate("ui.activate", {"label": "Search"})
    assert "whatsapp.exe" not in uia.CLICK_PROCESSES
    assert "msedgewebview2.exe" not in uia.CLICK_PROCESSES
    assert "applicationframehost.exe" not in uia.CLICK_PROCESSES


def test_malformed_snapshot_or_role_rejected_even_if_button_label_safe():
    base = {"label": "Search", "role": "ButtonControl", "snapshot": "a" * 64}
    for modified in (
        {"snapshot": "a" * 63},
        {"snapshot": "A" * 64},
        {"role": "TextControl"},
        {"role": ["ButtonControl"]},
        {"label": "Send"},
        {"label": "Next: Pay"},
    ):
        with pytest.raises(validation.ValidationError):
            validation.validate("ui.activate_observed", {**base, **modified})


def test_cancelled_or_disabled_input_never_attempts_inspected_control(monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", True)
    scan = uia.inspect()
    args = {"label": "Search", "role": "ButtonControl", "snapshot": scan["snapshot"]}
    cfg = Config()
    cfg.capabilities = [x for x in ALL_CAPABILITIES if x != "input"]
    refused = Executor(cfg, lambda: list(ALL_CAPABILITIES)).run(
        "ui.activate_observed", args, threading.Event())
    assert not refused.ok and refused.error["code"] == "CAPABILITY_DISABLED"
    stop = threading.Event()
    stop.set()
    cancelled = Executor(Config(), lambda: list(ALL_CAPABILITIES)).run(
        "ui.activate_observed", args, stop)
    assert not cancelled.ok and cancelled.error["code"] == "CANCELLED"
