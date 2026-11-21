"""Event-driven reconnect tests; no real sockets or Windows input."""
import asyncio
import json
from types import SimpleNamespace

import pytest
from controller.communication import client as module
from controller.communication.client import ControllerClient
from controller.config import Config

@pytest.fixture
def controller(tmp_path, monkeypatch):
    monkeypatch.setenv("HUKM_DATA_DIR", str(tmp_path))
    c = ControllerClient(Config(server_url="https://example.test"), "test-only")
    yield c
    c.pool.shutdown(wait=True)

def test_stale_or_unacknowledged_command_never_executes(controller):
    executed=[]
    controller.executor.run=lambda *args: executed.append(args)
    async def no_ack(_):
        return False
    controller.send=no_ack
    async def scenario():
        await controller.on_command({"id":"stale","action":"app.open"}, -1)
        await controller.on_command({"id":"noack","action":"app.open"})
    asyncio.run(scenario())
    assert executed == []
    assert not controller.dedupe.seen("stale")
    assert not controller.dedupe.seen("noack")

def test_rejects_command_before_welcome(controller, monkeypatch):
    class Socket:
        async def send(self, raw): pass
        async def recv(self):
            return json.dumps({"type":"command","command":{"id":"early","action":"app.open"}})
    class Connection:
        async def __aenter__(self): return Socket()
        async def __aexit__(self, *args): pass
    monkeypatch.setattr(module.websockets,"connect",lambda *a,**k:Connection())
    with pytest.raises(RuntimeError, match="acknowledge"):
        asyncio.run(controller.connect_once())
    assert controller.ws is None
    assert not controller.dedupe.seen("early")

def test_heartbeat_failure_closes_socket(controller, monkeypatch):
    closed=[]
    async def broken(_):
        raise OSError("network")
    async def close():
        closed.append(True)
    monkeypatch.setattr(controller,"heartbeat",broken)
    asyncio.run(controller._heartbeat_guard(SimpleNamespace(close=close)))
    assert closed == [True]

def test_short_clean_disconnects_back_off(controller, monkeypatch):
    sleeps=[]
    async def short_connection(): pass
    async def fake_wait(coro, timeout):
        coro.close()
        sleeps.append(timeout)
        if len(sleeps)>=5:
            controller.stop_event.set()
        raise asyncio.TimeoutError()
    monkeypatch.setattr(controller,"connect_once",short_connection)
    monkeypatch.setattr(module.asyncio,"wait_for",fake_wait)
    monkeypatch.setattr(module.random,"uniform",lambda a,b:0)
    asyncio.run(controller.run_forever())
    assert sleeps == [1,2,4,8,16]

def test_heartbeat_config_stays_below_relay_watchdog(tmp_path, monkeypatch):
    monkeypatch.setenv("HUKM_DATA_DIR",str(tmp_path))
    Config.path().write_text('{"heartbeat_s":120}',encoding="utf-8")
    assert Config.load().heartbeat_s == 20
    Config.path().write_text('[]',encoding="utf-8")
    assert Config.load().heartbeat_s == 20
