"""End-to-end: real relay (Node) ↔ real controller client, with OS launches simulated.

Skipped automatically if Node or the built relay (apps/relay/dist/server.js) is missing.
"""
import asyncio
import json
import os
import shutil
import socket
import subprocess
import threading
import time
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
RELAY = ROOT / "apps" / "relay" / "dist" / "server.js"

pytestmark = pytest.mark.skipif(not shutil.which("node") or not RELAY.exists(), reason="node or built relay missing")


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Api:
    def __init__(self, base):
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={"content-type": "application/json", "x-hukm-client": "web"})
        try:
            with self.opener.open(req, timeout=10) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"null")


@pytest.fixture()
def relay(tmp_path):
    port = free_port()
    env = dict(os.environ, PORT=str(port), HOST="127.0.0.1", DATA_DIR=str(tmp_path / "relay"), SETUP_CODE="E2E-CODE",
               PUBLIC_DIR=str(tmp_path / "none"), NODE_NO_WARNINGS="1")
    proc = subprocess.Popen(["node", str(RELAY)], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            urllib.request.urlopen(base + "/api/health", timeout=1)
            break
        except Exception:
            time.sleep(0.1)
    yield base
    proc.terminate()
    proc.wait(5)


def wait_status(api, cid, statuses, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        _, c = api.call("GET", f"/api/commands/{cid}")
        if c["status"] in statuses:
            return c
        time.sleep(0.1)
    raise AssertionError(f"command stayed {c['status']}")


def test_full_journey(relay, sandbox):
    from controller.communication.client import ControllerClient
    from controller.communication.pairing import claim
    from controller.config import Config
    from controller.security import credentials
    from controller.system import launcher

    api = Api(relay)
    assert api.call("POST", "/api/auth/setup", {"email": "owner@hukm.pk", "name": "Owner", "password": "a-long-password", "setupCode": "E2E-CODE"})[0] == 200
    _, pc = api.call("POST", "/api/devices/pairing-code", {"name": "HUKM-Laptop"})

    # controller pairs with the code and stores its credentials
    r = claim(relay, pc["code"])
    credentials.save_device(relay, r["deviceId"], r["deviceToken"], r["name"])
    dev = credentials.load_device()
    assert dev["token"] == r["deviceToken"]

    cfg = Config()
    cfg.server_url = relay
    (sandbox["downloads"] / "Invoice March.pdf").write_text("x")
    client = ControllerClient(cfg, dev["token"])
    t = threading.Thread(target=lambda: asyncio.run(client.run_forever()), daemon=True)
    t.start()

    # dashboard sees the laptop online
    for _ in range(50):
        _, devs = api.call("GET", "/api/devices")
        if devs and devs[0]["online"] and devs[0]["controllerConfig"]:
            break
        time.sleep(0.1)
    assert devs[0]["online"] and devs[0]["name"] == "HUKM-Laptop"

    # "Downloads folder kholo" → executed by controller → result → history
    launcher.simulated_calls.clear()
    _, out = api.call("POST", "/api/commands", {"text": "Downloads folder kholo.", "source": "text", "clientRequestId": "e2e-1"})
    done = wait_status(api, out["command"]["id"], ["completed", "failed"])
    assert done["status"] == "completed", done
    assert done["result"]["path"] == str(sandbox["downloads"])
    assert ("open_path", str(sandbox["downloads"])) in launcher.simulated_calls

    # file search through the whole pipeline
    _, out = api.call("POST", "/api/commands", {"text": "invoice pdf search karo"})
    done = wait_status(api, out["command"]["id"], ["completed", "failed"])
    assert [x["name"] for x in done["result"]["results"]] == ["Invoice March.pdf"]

    # screenshot requires approval; approve and get a real (mss) or failed result — never fake success
    _, out = api.call("POST", "/api/commands", {"text": "laptop ki screen dikhao"})
    assert out["command"]["status"] == "awaiting_approval"
    api.call("POST", f"/api/commands/{out['command']['id']}/approve")
    done = wait_status(api, out["command"]["id"], ["completed", "failed"])
    if done["status"] == "completed":
        assert done["screenshotId"]
    else:
        assert done["error"]["message"]

    # emergency stop reaches the controller
    api.call("POST", "/api/emergency-stop")
    for _ in range(30):
        if client.paused:
            break
        time.sleep(0.1)
    assert client.paused

    _, hist = api.call("GET", "/api/commands")
    assert len(hist) >= 3
    client.stop()
    t.join(5)
