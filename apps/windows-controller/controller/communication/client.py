"""Outbound WebSocket connection to the relay. Event-driven: idle cost is one heartbeat every ~20 s."""
from __future__ import annotations

import asyncio
from contextlib import suppress
import json
import logging
import random
import threading
import time
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
        # Windows UI Automation, keyboard, WhatsApp selection, draft and Send all
        # share the foreground desktop. Two workers can race on different chats.
        # Serialize ALL OS actions; a queued action is rechecked for cancellation
        # by Executor.run before it touches the desktop.
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="hukm-act")
        self.cancels: dict[str, threading.Event] = {}
        self.cancelled_early: dict[str, float] = {}
        self.connection_epoch = 0
        self.active_commands: set[asyncio.Task] = set()
        self.outbox: dict[str, dict] = {}  # results not yet acknowledged by the relay
        self.ws = None
        self.loop: asyncio.AbstractEventLoop | None = None
        self.stop_event = asyncio.Event()

    def cancel_active(self, reason: str) -> None:
        """Best-effort stop; actions already delivered to Windows cannot be undone.

        Runs on the event loop thread. Pending single-worker executions see
        the cancellation flag before they touch the desktop.
        """
        count = len(self.cancels)
        for event in tuple(self.cancels.values()):
            event.set()
        if count:
            log.warning("cancelled %d active/queued laptop action(s): %s", count, reason)

    def invalidate_connection(self, reason: str) -> None:
        """Invalidate every command from the old socket on the event-loop thread."""
        self.connection_epoch += 1
        self.cancel_active(reason)
        from ..whatsapp.desktop_ops import invalidate_attachment
        invalidate_attachment()

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
            cid = str(msg.get("commandId", ""))
            ev = self.cancels.get(cid)
            if ev:
                ev.set()
            elif cid:
                # A cancel can arrive while the command ACK is still on the
                # wire, before its cancellation flag exists. Remember it.
                self.cancelled_early[cid] = time.monotonic()
                if len(self.cancelled_early) > 256:
                    oldest = min(self.cancelled_early, key=self.cancelled_early.get)
                    self.cancelled_early.pop(oldest, None)
            log.info("cancel requested for %s", cid[:16])
        elif t == "result_ack":
            self.outbox.pop(msg.get("commandId", ""), None)
        elif t == "pause":
            self.paused = True
            self.cancel_active("emergency pause")
            from ..whatsapp.desktop_ops import invalidate_attachment
            invalidate_attachment()
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

    async def on_command(self, cmd: dict, epoch: int | None = None) -> None:
        cid = str(cmd.get("id", ""))
        action = str(cmd.get("action", ""))
        epoch = self.connection_epoch if epoch is None else epoch
        if not cid or epoch != self.connection_epoch or self.stop_event.is_set():
            return
        if not await self.send({"type": "ack", "commandId": cid}):
            # No acknowledged delivery means no local side effect is safe.
            return
        # Atomically claim the ID before any input. A previously claimed ID
        # is NEVER executed twice, even after a WebSocket reconnect.
        if not self.dedupe.mark_started(cid):
            cached = self.dedupe.get(cid)
            log.info("duplicate delivery of %s ignored", cid)
            if cached:
                await self.send(cached)
            return

        # Register the cancellation flag BEFORE the first await after claiming
        # the command. Otherwise an emergency pause can arrive while "started"
        # is being sent and miss the action entirely.
        ev = threading.Event()
        if cid in self.cancelled_early:
            ev.set()
            self.cancelled_early.pop(cid, None)
        if epoch != self.connection_epoch:
            ev.set()
        self.cancels[cid] = ev
        try:
            if self.paused:
                await self.finish(cid, Outcome(False, error={
                    "code": "PAUSED", "message": "Controller is paused; no new action started",
                }))
                return
            if action not in CAPABILITY_OF:
                await self.finish(cid, Outcome(False, error={
                    "code": "NOT_ALLOWED", "message": f"unknown action {action}",
                }))
                return

            await self.send({"type": "started", "commandId": cid})
            if self.paused or epoch != self.connection_epoch:
                ev.set()
            if ev.is_set():
                await self.finish(cid, Outcome(False, error={
                    "code": "CANCELLED",
                    "message": "Action stopped before entering the Windows execution worker",
                }))
                return

            # Never log private user arguments such as WhatsApp messages,
            # mail recipient details or ChatGPT prompts.
            log.info("▶ action=%s command=%s (arguments redacted)", action, cid[:16])
            timeout = max(1.0, float(cmd.get("timeoutMs", 30000)) / 1000.0)
            loop = asyncio.get_running_loop()
            try:
                out = await asyncio.wait_for(
                    loop.run_in_executor(self.pool, self.executor.run, action, cmd.get("args") or {}, ev),
                    timeout,
                )
            except asyncio.TimeoutError:
                ev.set()
                out = Outcome(False, error={
                    "code": "TIMEOUT_UNVERIFIED",
                    "message": "Windows action timed out. It may already have happened; check the target app before retrying.",
                })

            if ev.is_set():
                # A click or Send may have been attempted before the Stop,
                # timeout or connection loss reached Windows. Never claim
                # completed, cancelled-with-no-side-effect, or auto-retryable.
                out = Outcome(False, error={
                    "code": "INTERRUPTED_UNVERIFIED",
                    "message": "Action interrupted by Stop, timeout or disconnect. It may already have happened; verify manually before another attempt.",
                })
            log.info("%s %s %s", "✔" if out.ok else "✖", action, (out.error or {}).get("message", ""))
            await self.finish(cid, out)
            if action == "controller.update" and out.ok and out.result.get("installerLaunched") is True:
                # Replacing the running one-file Windows executable while it
                # is locked by this same process caused owners to approve
                # website updates but remain on the old Controller version.
                # First send the exact installer-launched (NOT installed)
                # result to the relay. Then release the EXE before the local
                # installer reaches its file-copy step. Existing pairing is
                # stored separately in AppData and is not revoked.
                log.info("HUKM update stage=exiting_old_controller_after_result")
                await asyncio.sleep(1.25)
                self.stop()
        finally:
            self.cancels.pop(cid, None)

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
            self.connection_epoch += 1
            self.ws = ws
            hb = None
            try:
                if self.stop_event.is_set():
                    return
                await ws.send(json.dumps(self.hello()))
                # Authenticate the application-level session before accepting
                # any commands, including commands queued before reconnect.
                welcome = json.loads(await asyncio.wait_for(ws.recv(), timeout=20))
                if not isinstance(welcome, dict) or welcome.get("type") not in ("welcome", "revoked"):
                    raise RuntimeError("Relay did not acknowledge the controller hello")
                await self.handle(welcome)
                hb = asyncio.create_task(self._heartbeat_guard(ws))
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except ValueError:
                        continue
                    if not isinstance(msg, dict):
                        continue
                    if msg.get("type") == "command":
                        command = msg.get("command")
                        if not isinstance(command, dict) or not command.get("id"):
                            continue
                        # Bound the queue. Disconnect rather than execute
                        # unbounded pending work or silently lose a command.
                        if len(self.active_commands) >= 16:
                            log.warning("Controller queue full; closing connection")
                            return
                        task = asyncio.create_task(self._guard(
                            self.on_command(command, self.connection_epoch)))
                        self.active_commands.add(task)
                        task.add_done_callback(self.active_commands.discard)
                    elif msg.get("type") != "welcome":
                        await self.handle(msg)
            finally:
                # Any command that has not registered a cancellation Event yet
                # also fails due to the epoch mismatch on its next await.
                # The relay may already have timed out/cancelled these
                # commands. Do not permit old queued actions to execute while
                # this device is offline or after it reconnects.
                self.invalidate_connection("WebSocket disconnected")
                if hb is not None:
                    hb.cancel()
                    with suppress(asyncio.CancelledError):
                        await hb
                self.ws = None

    async def _heartbeat_guard(self, ws) -> None:
        try:
            await self.heartbeat(ws)
        except asyncio.CancelledError:
            raise
        except Exception:
            # A dead heartbeat must not leave an apparently connected socket.
            log.warning("Heartbeat failed; reconnecting")
            with suppress(Exception):
                await asyncio.wait_for(ws.close(), timeout=5)

    async def _guard(self, coro) -> None:
        try:
            await coro
        except Exception:
            log.exception("command handling failed")

    async def run_forever(self) -> None:
        self.loop = asyncio.get_running_loop()
        delay = 1.0
        while not self.stop_event.is_set():
            started = time.monotonic()
            try:
                self.on_status("connecting")
                await self.connect_once()
            except Fatal:
                self.on_status("revoked")
                return
            except Exception as e:  # noqa: BLE001
                status = getattr(getattr(e, "response", None), "status_code", None) or getattr(e, "status_code", None)
                if status in (401, 403):
                    self.on_status("unauthorized")
                    log.error("relay rejected this device (%s). Pair again with: hukm-controller pair", status)
                    return
                log.warning("connection lost (%s)", type(e).__name__)
            # Only reset the retry delay after a stable connection. A server
            # that accepts and immediately closes must not cause a hot loop.
            if time.monotonic() - started >= 60:
                delay = 1.0
            self.on_status("offline")
            if self.stop_event.is_set():
                break
            try:
                await asyncio.wait_for(self.stop_event.wait(), timeout=delay + random.uniform(0, min(delay * 0.25, 5.0)))
            except asyncio.TimeoutError:
                pass
            delay = min(delay * 2, 60.0)

    def stop(self) -> None:
        if self.loop:
            self.loop.call_soon_threadsafe(self.invalidate_connection, "controller stopping")
            self.loop.call_soon_threadsafe(self.stop_event.set)
            if self.ws is not None:
                asyncio.run_coroutine_threadsafe(self.ws.close(), self.loop)
