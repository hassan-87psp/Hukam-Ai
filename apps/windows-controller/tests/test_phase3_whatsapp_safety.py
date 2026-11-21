"""Phase 3 regression: serial WhatsApp operations and no cross-chat private data.

Tests use simulated in-process controllers; they do not open WhatsApp or send.
"""
import asyncio
import threading
import time

import pytest

from controller.actions.executor import Executor, Outcome
from controller.communication.client import ControllerClient
from controller.config import ALL_CAPABILITIES, Config
from controller.system import launcher, windows
from controller.whatsapp import desktop_ops, unread_senders


def test_foreground_actions_are_serial_even_when_commands_arrive_together(tmp_path, monkeypatch):
    monkeypatch.setenv("HUKM_DATA_DIR", str(tmp_path))
    client = ControllerClient(Config(), "test-token")
    running = 0
    peak = 0
    seen = []
    guard = threading.Lock()

    def fake_run(action, args, cancel):
        nonlocal running, peak
        with guard:
            running += 1
            peak = max(peak, running)
        time.sleep(0.04)
        with guard:
            running -= 1
            seen.append(action)
        return Outcome(True, {"verified": False})

    client.executor.run = fake_run
    sent = []

    async def fake_send(message):
        sent.append(message)
        await asyncio.sleep(0)
        return True

    client.send = fake_send

    async def both():
        await asyncio.gather(
            client.on_command({"id": "select-1", "action": "whatsapp.select_chat",
                               "args": {"contact": "Test"}}),
            client.on_command({"id": "read-2", "action": "whatsapp.read_selected",
                               "args": {"contact": "Test"}}),
        )
    try:
        asyncio.run(both())
        assert sorted(seen) == ["whatsapp.read_selected", "whatsapp.select_chat"]
        assert peak == 1, "WhatsApp UI actions must not run on two OS threads"
        assert len([m for m in sent if m["type"] == "result"]) == 2
    finally:
        client.pool.shutdown(wait=True)


def test_duplicate_command_claim_is_atomic(tmp_path, monkeypatch):
    monkeypatch.setenv("HUKM_DATA_DIR", str(tmp_path))
    client = ControllerClient(Config(), "test-token")
    calls = []

    def fake_run(action, args, cancel):
        calls.append(action)
        time.sleep(0.01)
        return Outcome(True, {"verified": False})

    client.executor.run = fake_run

    async def fake_send(_message):
        await asyncio.sleep(0)
        return True

    client.send = fake_send
    async def duplicate():
        await asyncio.gather(
            client.on_command({"id": "same-command", "action": "whatsapp.open", "args": {}}),
            client.on_command({"id": "same-command", "action": "whatsapp.open", "args": {}}),
        )

    try:
        asyncio.run(duplicate())
        assert calls == ["whatsapp.open"]
        assert client.dedupe.seen("same-command")
    finally:
        client.pool.shutdown(wait=True)


def test_controller_skips_cancelled_command_before_any_laptop_input(monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", True)
    cancel = threading.Event()
    cancel.set()
    executor = Executor(Config(), lambda: list(ALL_CAPABILITIES))
    outcome = executor.run("whatsapp.open", {"mode": "desktop"}, cancel)
    assert not outcome.ok
    assert outcome.error["code"] == "CANCELLED"


def test_named_read_discards_content_if_whatsapp_window_changes(monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", False)
    previous = windows.WindowInfo(10, "Chats", "WhatsApp.exe", 5)
    next_window = windows.WindowInfo(11, "Chats", "WhatsApp.exe", 5)
    captures = iter([(previous, object(), (0., 0., 800., 600.)),
                     (next_window, object(), (0., 0., 800., 600.))])
    monkeypatch.setattr(desktop_ops, "_active_root", lambda: next(captures))
    monkeypatch.setattr(desktop_ops, "_check_selected_contact", lambda *args: None)
    monkeypatch.setattr(desktop_ops, "visible_texts", lambda *args, **kwargs: ["Private test only"])
    with pytest.raises(desktop_ops.DesktopWhatsAppError, match="window changed"):
        desktop_ops.read_selected("Ali")


def test_named_read_discards_content_if_selected_contact_changes(monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", False)
    native = windows.WindowInfo(10, "Chats", "WhatsApp.exe", 5)
    monkeypatch.setattr(desktop_ops, "_active_root",
                        lambda: (native, object(), (0., 0., 800., 600.)))
    calls = []

    def verify(*args):
        calls.append(True)
        if len(calls) == 2:
            raise desktop_ops.DesktopWhatsAppError("Selected contact switched")

    monkeypatch.setattr(desktop_ops, "_check_selected_contact", verify)
    monkeypatch.setattr(desktop_ops, "visible_texts", lambda *args, **kwargs: ["Private test only"])
    with pytest.raises(desktop_ops.DesktopWhatsAppError, match="contact switched"):
        desktop_ops.read_selected("Ali")
    assert len(calls) == 2


def test_unread_sender_scan_rejects_foreground_switch(monkeypatch):
    native = windows.WindowInfo(10, "WhatsApp", "WhatsApp.exe", 5)
    browser = windows.WindowInfo(11, "WhatsApp Web", "chrome.exe", 6)
    monkeypatch.setattr(windows, "active_window", lambda: native)
    unread_senders._assert_same_native_foreground(10)
    monkeypatch.setattr(windows, "active_window", lambda: browser)
    with pytest.raises(unread_senders.UnreadSendersUnavailable, match="lost focus"):
        unread_senders._assert_same_native_foreground(10)
