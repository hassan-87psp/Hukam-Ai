"""Phase 2 safety regression for explicit foreground desktop input.

No mouse movements or keystrokes are executed on a real machine in these tests.
"""
import threading

import pytest

from controller.actions.executor import Executor
from controller.config import Config, ALL_CAPABILITIES
from controller.security import validation
from controller.system import desktop_input, launcher


def test_mouse_coordinates_support_multi_monitor_but_reject_outside_client():
    assert desktop_input.inside_client((-900, 320), (-1920, 0, -1, 1080))
    assert not desktop_input.inside_client((0, 320), (-1920, 0, -1, 1080))
    assert not desktop_input.inside_client((-1921, 320), (-1920, 0, -1, 1080))
    assert not desktop_input.inside_client((-900, 1080), (-1920, 0, -1, 1080))


@pytest.mark.parametrize("payload", [
    {"kind": "click", "x": 120, "y": 220},
    {"kind": "double_click", "x": 120, "y": 220},
    {"kind": "right_click", "x": -900, "y": 220},
    {"kind": "drag", "x": 120, "y": 220, "toX": 140, "toY": 250},
    {"kind": "type", "text": "Report title"},
    {"kind": "key", "key": "ctrl+c"},
    {"kind": "key", "key": "shift+tab"},
    {"kind": "scroll", "steps": -2},
])
def test_valid_desktop_input_is_bounded_and_never_claims_verified(payload, monkeypatch):
    validated = validation.validate("desktop.control", payload)
    monkeypatch.setattr(launcher, "SIMULATE", True)
    executor = Executor(Config(), lambda: list(ALL_CAPABILITIES))
    outcome = executor.run("desktop.control", validated, threading.Event())
    assert outcome.ok
    assert outcome.result["inputDelivered"] is True
    assert outcome.result["verified"] is False


@pytest.mark.parametrize("payload", [
    {"kind": "click", "x": 32000.5, "y": 20},
    {"kind": "click", "x": True, "y": 20},
    {"kind": "click", "x": 32001, "y": 20},
    {"kind": "drag", "x": 10, "y": 20, "toX": 40000, "toY": 100},
    {"kind": "right_click", "x": 3},
    {"kind": "type", "text": ""},
    {"kind": "type", "text": "   "},
    {"kind": "key", "key": "win+r"},
    {"kind": "key", "key": "ctrl+alt+del"},
    {"kind": "scroll", "steps": 100},
    {"kind": ["click"], "x": 10, "y": 30},
    {"kind": "shell", "cmd": "del everything"},
])
def test_rejects_unsafe_or_malformed_desktop_input(payload):
    with pytest.raises(validation.ValidationError):
        validation.validate("desktop.control", payload)


def test_input_capability_and_cancellation_cannot_be_bypassed(monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", True)
    disabled = Config()
    disabled.capabilities = [cap for cap in ALL_CAPABILITIES if cap != "input"]
    executor = Executor(disabled, lambda: list(ALL_CAPABILITIES))
    rejected = executor.run("desktop.control", {"kind": "key", "key": "tab"}, threading.Event())
    assert not rejected.ok
    assert rejected.error["code"] == "CAPABILITY_DISABLED"

    active = Executor(Config(), lambda: list(ALL_CAPABILITIES))
    cancelled = threading.Event()
    cancelled.set()
    denied = active.run("desktop.control", {"kind": "key", "key": "tab"}, cancelled)
    assert not denied.ok
    assert denied.error["code"] == "CANCELLED"


def test_desktop_input_never_runs_on_unsupported_background_platform(monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", False)
    monkeypatch.setattr(desktop_input.windows, "IS_WINDOWS", False)
    with pytest.raises(desktop_input.DesktopInputError):
        desktop_input.control({"kind": "click", "x": 100, "y": 100})
