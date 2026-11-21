"""Controller v1.6.9: Stop/cancel/disconnect race regressions.

All actions run against test stubs; no real Windows UI or personal accounts.
"""
import asyncio
import threading
from pathlib import Path

from controller.actions.executor import Outcome
from controller.communication.client import ControllerClient
from controller.config import Config


def make_client(tmp_path, monkeypatch):
    monkeypatch.setenv("HUKM_DATA_DIR", str(tmp_path))
    client = ControllerClient(Config(), "fake-device-token")
    sends = []
    async def send(message):
        sends.append(message)
        await asyncio.sleep(0)
        return True
    client.send = send
    return client, sends


def test_cancel_during_ack_prevents_any_laptop_input(tmp_path, monkeypatch):
    client, sent = make_client(tmp_path, monkeypatch)
    executed = []
    async def send(message):
        sent.append(message)
        if message["type"] == "ack":
            await client.handle({"type": "cancel", "commandId": "early-cancel"})
        return True
    client.send = send
    client.executor.run = lambda *args: executed.append(args) or Outcome(True, {})
    try:
        asyncio.run(client.on_command({"id": "early-cancel", "action": "whatsapp.open", "args": {}}))
        assert executed == []
        results = [m for m in sent if m["type"] == "result"]
        assert len(results) == 1
        assert results[0]["ok"] is False
        assert results[0]["error"]["code"] == "CANCELLED"
    finally:
        client.pool.shutdown(wait=True)


def test_emergency_pause_while_started_is_sent_prevents_execution(tmp_path, monkeypatch):
    client, sent = make_client(tmp_path, monkeypatch)
    executed = []
    async def send(message):
        sent.append(message)
        if message["type"] == "started":
            await client.handle({"type": "pause"})
        return True
    client.send = send
    client.executor.run = lambda *args: executed.append(args) or Outcome(True, {})
    try:
        asyncio.run(client.on_command({"id": "pause-race", "action": "whatsapp.open", "args": {}}))
        assert client.paused is True
        assert executed == []
        results = [m for m in sent if m["type"] == "result"]
        assert len(results) == 1
        assert results[0]["ok"] is False
    finally:
        client.pool.shutdown(wait=True)


def test_disconnect_during_ack_invalidates_old_socket_command(tmp_path, monkeypatch):
    client, sent = make_client(tmp_path, monkeypatch)
    executed = []
    async def send(message):
        sent.append(message)
        if message["type"] == "ack":
            client.connection_epoch += 1
            client.cancel_active("lost connection")
        return True
    client.send = send
    client.executor.run = lambda *args: executed.append(args) or Outcome(True, {})
    try:
        asyncio.run(client.on_command({"id": "stale-connection", "action": "whatsapp.open", "args": {}}))
        assert executed == []
        result = next(m for m in sent if m["type"] == "result")
        assert result["ok"] is False
    finally:
        client.pool.shutdown(wait=True)


def test_cancelled_inflight_action_never_reports_success(tmp_path, monkeypatch):
    client, sent = make_client(tmp_path, monkeypatch)
    worker_started = threading.Event()
    def slow_action(_action, _args, cancel):
        worker_started.set()
        assert cancel.wait(timeout=2), "Test cancellation did not reach worker"
        # Simulates an irreversible OS click that occurred before Stop arrived.
        return Outcome(True, {"inputDelivered": True, "verified": False})
    client.executor.run = slow_action

    async def scenario():
        task = asyncio.create_task(client.on_command(
            {"id": "maybe-clicked", "action": "whatsapp.open", "args": {}}))
        for _ in range(100):
            if worker_started.is_set():
                break
            await asyncio.sleep(.01)
        assert worker_started.is_set()
        await client.handle({"type": "cancel", "commandId": "maybe-clicked"})
        await task
    try:
        asyncio.run(scenario())
        result = next(m for m in sent if m["type"] == "result")
        assert result["ok"] is False
        assert result["error"]["code"] == "INTERRUPTED_UNVERIFIED"
        assert "verify manually" in result["error"]["message"]
        assert client.dedupe.seen("maybe-clicked")
        assert client.cancels == {}
    finally:
        client.pool.shutdown(wait=True)


def test_disconnect_cancels_queued_and_active_events(tmp_path, monkeypatch):
    client, _sent = make_client(tmp_path, monkeypatch)
    a, b = threading.Event(), threading.Event()
    client.cancels.update({"a": a, "b": b})
    try:
        client.cancel_active("relay disconnected")
        assert a.is_set() and b.is_set()
    finally:
        client.pool.shutdown(wait=True)
