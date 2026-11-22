"""Bounded live preview uses in-RAM frames and a separate local owner consent."""
import asyncio
import base64

import pytest
from controller.communication.client import ControllerClient
from controller.config import Config


@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setenv("HUKM_DATA_DIR",str(tmp_path))
    obj=ControllerClient(Config(server_url="https://example.test"),"test-only")
    obj.enabled_caps=["system","screen"]
    yield obj
    obj.pool.shutdown(wait=True)


def test_live_rejects_invalid_monitor_without_prompt(client,monkeypatch):
    shown=[]
    monkeypatch.setattr(client,"_local_live_permission",lambda: shown.append(True))
    sent=[]
    async def send(msg):
        sent.append(msg)
        return True
    client.send=send
    asyncio.run(client.handle({"type":"live_screen.start","sessionId":"live_fake","monitor":0,"durationSeconds":90}))
    assert shown==[]
    assert len(sent)==1 and sent[0]["type"]=="live_screen.denied"


def test_live_denied_locally_never_captures(client,monkeypatch):
    from controller.screen import capture
    monkeypatch.setattr(client,"_local_live_permission",lambda: False)
    monkeypatch.setattr(capture,"capture",lambda *_a,**_kw:pytest.fail("capture without consent"))
    sent=[]
    async def send(m):
        sent.append(m)
        return True
    client.send=send
    async def scenario():
        await client.handle({"type":"live_screen.start","sessionId":"live_denied","monitor":1,"durationSeconds":90})
        await asyncio.wait_for(client.live_task,2)
    asyncio.run(scenario())
    assert [m["type"] for m in sent]==["live_screen.denied","live_screen.ended"]
    assert not any(m["type"]=="live_screen.frame" for m in sent)


def test_approved_live_frames_stay_in_memory_and_stop_is_immediate(client,monkeypatch):
    from controller.screen import capture
    monkeypatch.setattr(client,"_local_live_permission",lambda: True)
    frame=base64.b64encode(b"J"*250).decode()
    monkeypatch.setattr(capture,"capture",lambda *_a,**_kw:{
        "mime":"image/jpeg","dataBase64":frame,"width":640,"height":360,
        "simulated":False})
    sent=[]
    async def send(m):
        sent.append(m)
        return True
    client.send=send
    async def scenario():
        await client.handle({"type":"live_screen.start","sessionId":"live_approved","monitor":1,"durationSeconds":90})
        for _ in range(100):
            if any(m["type"]=="live_screen.frame" for m in sent):break
            await asyncio.sleep(.01)
        assert any(m["type"]=="live_screen.ready" for m in sent)
        assert any(m["type"]=="live_screen.frame" for m in sent)
        await client.handle({"type":"live_screen.stop","sessionId":"live_approved"})
        for _ in range(100):
            if any(m["type"]=="live_screen.ended" for m in sent):break
            await asyncio.sleep(.01)
        assert any(m["type"]=="live_screen.ended" for m in sent)
        assert client.live_session is None
    asyncio.run(scenario())


def test_emergency_pause_revokes_live_preview(client,monkeypatch):
    monkeypatch.setattr(client,"_local_live_permission",lambda: True)
    from controller.screen import capture
    monkeypatch.setattr(capture,"capture",lambda *_a,**_kw:{
        "mime":"image/jpeg","dataBase64":base64.b64encode(b"J"*200).decode(),
        "width":600,"height":300,"simulated":False})
    sent=[]
    async def send(m):
        sent.append(m)
        return True
    client.send=send
    async def scenario():
        await client.handle({"type":"live_screen.start","sessionId":"live_pause","monitor":1,"durationSeconds":90})
        await asyncio.sleep(.04)
        await client.handle({"type":"pause"})
        await asyncio.sleep(.04)
        assert client.paused is True
        assert client.live_session is None
    asyncio.run(scenario())
