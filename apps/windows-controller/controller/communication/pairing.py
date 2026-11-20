"""Claim a pairing code shown in the web app (Devices → Pair new device)."""
from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.request

from .. import VERSION
from ..system import info


class PairingError(Exception):
    pass


def claim(server_url: str, code: str, timeout: float = 15.0) -> dict:
    os_name, os_ver = info.os_info()
    body = json.dumps({"code": code.strip(), "hostname": info.hostname(), "os": os_name, "osVersion": os_ver, "controllerVersion": VERSION}).encode()
    url = server_url.rstrip("/") + "/api/pair/claim"
    if not url.startswith(("http://", "https://")):
        raise PairingError("server URL must start with https:// (or http:// for a local relay)")
    req = urllib.request.Request(url, data=body, method="POST", headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode())["error"]["message"]
        except Exception:
            msg = f"HTTP {e.code}"
        raise PairingError(msg) from None
    except urllib.error.URLError as e:
        raise PairingError(f"could not reach the relay: {e.reason}") from None
