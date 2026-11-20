"""Outbound WebSocket connection to the relay. Event-driven: idle cost is one heartbeat every ~20 s."""
from __future__ import annotations

import asyncio
import json
import logging
import random
import threading
from concurrent.futures import ThreadPoolExecutor

import websockets

from .. import VERSION
from ..actions.dedupe import DedupeStore
from ..actions.executor import Executor, Outcome
from ..config import Config, data_dir
from ..security.validation import CAPABILITY_OF
from ..system import info, known_folders

log = logging.getLogger("hukm.client")


class Fatal(Exception):
    """Unrecoverable (revoked/unauthorised) — stop reconnecting."""


class ControllerClient:
    def __init__(self, cfg: Config, token: str, *, on_status=None):
        self.cfg = cfg
        self.token = token
        self.on_status = on_status or (lambda s: None)
        self.paused = False
        self.enabled_caps: list[str] = list(cfg.capabilities)
        self.executor = Executor(cfg, lambda: self.enabled_caps)
        self.dedupe = DedupeStore(data_dir() / "executed.json")
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="hukm-act")
        self.cancels: dict[str, threading.Event] = {}
        self.outbox: dict[str, dict] = {}  # results not yet acknowledged by the relay
        self.ws = None
        self.loop: asyncio.AbstractEventLoop | None = None
        self.stop_event = asyncio.Event()

    # ---- protocol ---------------------------------------------------
    def hello(self) -> dict:
        os_name, os_ver = info.os_info()
        roots = known_folders.allowed_roots(self.cfg.allowed_folders, self.cfg.extra_allowed_dirs)
        return {
            "type": "hello",
            "controllerVersion": VERSION,
            "os": os_name,
            "osVersion": os_ver,
            "hostname": info.hostname(),
            "capabilities": self.cfg.capabilities,
            "config": {
                "allowedDirs": [{"key": k, "path": str(p)} for k, p in roots],
                "apps": self.cfg.apps,
                "screenCapture": self.cfg.screen_capture,
                "browser": self.cfg.browser,
            },
        }

    async def send(self, msg: dict) -> bool:
        ws = self.ws
        if ws is None:
            return False
        try:
            await ws.send(json.dumps(msg))
            return True
        except Exception:
            return False

    async def handle(self, msg: dict) -> None:
        t = msg.get("type")
        if t == "welcome":
            self.paused = bool(msg.get("paused"))
            self.enabled_caps = [c for c in msg.get("enabledCapabilities", []) if c in self.cfg.capabilities]
            self.on_status("paused" if self.paused else "online")
            log.info("connected as %s%s", msg.get("deviceId"), " (PAUSED by emergency stop)" if self.paused else "")
            for m in list(self.outbox.values()):
                await self.send(m)
        elif t == "command":
            await self.on_command(msg["command"])
        elif t == "cancel":
            ev = self.cancels.get(msg.get("commandId", ""))
            if ev:
                ev.set()
                log.info("cancel requested for %s", msg.get("commandId"))
        elif t == "result_ack":
            self.outbox.pop(msg.get("commandId", ""), None)
        elif t == "pause":
            self.paused = True
            for ev in self.cancels.values():
                ev.set()
            self.on_status("paused")
            log.warning("EMERGENCY STOP — controller paused; no commands will run until resumed from the web app")
        elif t == "resume":
            self.paused = False
            self.on_status("online")
            log.info("resumed")
        elif t == "capabilities":
            self.enabled_caps = [c for c in msg.get("enabledCapabilities", []) if c in self.cfg.capabilities]
            log.info("capabilities updated: %s", ", ".join(self.enabled_caps))
        elif t == "revoked":
            log.error("this device was unpaired from the web app")
            raise Fatal("revoked")

    async def on_command(self, cmd: dict) -> None:
        cid = str(cmd.get("id", ""))
        action = str(cmd.get("action", ""))
        await self.send({"type": "ack", "commandId": cid})
        cached = self.dedupe.get(cid)
        if self.dedupe.seen(cid):
            log.info("duplicate delivery of %s ignored", cid)
            if cached:
                await self.send(cached)
            return
        if self.paused:
            out = Outcome(False, error={"code": "PAUSED", "message": "controller is paused"})
            await self.finish(cid, out)
            return
        if action not in CAPABILITY_OF:
            await self.finish(cid, Outcome(False, error={"code": "NOT_ALLOWED", "message": f"unknown action {action}"}))
            return
        self.dedupe.mark_started(cid)
        await self.send({"type": "started", "commandId": cid})
        log.info("▶ %s %s", action, json.dumps(cmd.get("args", {}), ensure_ascii=False)[:200])
        ev = threading.Event()
        self.cancels[cid] = ev
        timeout = max(1.0, float(cmd.get("timeoutMs", 30000)) / 1000.0)
        loop = asyncio.get_running_loop()
        try:
            out = await asyncio.wait_for(loop.run_in_executor(self.pool, self.executor.run, action, cmd.get("args") or {}, ev), timeout)
        except asyncio.TimeoutError:
            ev.set()
            out = Outcome(False, error={"code": "TIMEOUT", "message": "action took too long on the laptop"})
        finally:
            self.cancels.pop(cid, None)
        if ev.is_set() and out.ok:
            log.info("command %s finished after cancel was requested", cid)
        log.info("%s %s %s", "✔" if out.ok else "✖", action, (out.error or {}).get("message", ""))
        await self.finish(cid, out)

    async def finish(self, cid: str, out: Outcome) -> None:
        msg = out.to_message(cid)
        self.dedupe.store_result(cid, msg)
        self.outbox[cid] = msg
        await self.send(msg)

    # ---- loops ------------------------------------------------------
    async def heartbeat(self, ws) -> None:
        info.stats()  # prime psutil's cpu counter
        while True:
            await asyncio.sleep(self.cfg.heartbeat_s)
            await ws.send(json.dumps({"type": "heartbeat", "stats": info.stats()}))

    async def connect_once(self) -> None:
        url = self.cfg.ws_url()
        headers = {"Authorization": f"Bearer {self.token}"}
        try:
            conn = websockets.connect(url, additional_headers=headers, max_size=4 * 1024 * 1024, ping_interval=25, ping_timeout=20, open_timeout=15)
        except TypeError:  # websockets < 14
            conn = websockets.connect(url, extra_headers=headers, max_size=4 * 1024 * 1024, ping_interval=25, ping_timeout=20, open_timeout=15)
        async with conn as ws:
            self.ws = ws
            await ws.send(json.dumps(self.hello()))
            hb = asyncio.create_task(self.heartbeat(ws))
            try:
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except ValueError:
                        continue
                    if msg.get("type") == "command":
                        asyncio.create_task(self._guard(self.handle(msg)))
                    else:
                        await self.handle(msg)
            finally:
                hb.cancel()
                self.ws = None

    async def _guard(self, coro) -> None:
        try:
            await coro
        except Exception:
            log.exception("command handling failed")

    async def run_forever(self) -> None:
        self.loop = asyncio.get_running_loop()
        delay = 1.0
        while not self.stop_event.is_set():
            try:
                self.on_status("connecting")
                await self.connect_once()
                delay = 1.0
            except Fatal:
                self.on_status("revoked")
                return
            except Exception as e:  # noqa: BLE001
                status = getattr(getattr(e, "response", None), "status_code", None) or getattr(e, "status_code", None)
                if status in (401, 403):
                    self.on_status("unauthorized")
                    log.error("relay rejected this device (%s). Pair again with: hukm-controller pair", status)
                    return
                log.warning("connection lost (%s) — retrying in %.0fs", type(e).__name__, delay)
            self.on_status("offline")
            try:
                await asyncio.wait_for(self.stop_event.wait(), timeout=delay + random.uniform(0, 0.5))
            except asyncio.TimeoutError:
                pass
            delay = min(delay * 2, 30.0)

    def stop(self) -> None:
        if self.loop:
            self.loop.call_soon_threadsafe(self.stop_event.set)
            if self.ws is not None:
                asyncio.run_coroutine_threadsafe(self.ws.close(), self.loop)
