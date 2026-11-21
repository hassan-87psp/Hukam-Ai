"""Claim a pairing code shown in the web app (Devices → Pair new device)."""
from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.request

from .. import VERSION
from ..system import info
from ..security.transport import relay_origin


class PairingError(Exception):
    pass


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise PairingError("Pairing redirect refused; verify the exact relay origin")


def claim(server_url: str, code: str, timeout: float = 15.0) -> dict:
    try:
        base = relay_origin(server_url)
    except ValueError as exc:
        raise PairingError(str(exc)) from exc
    os_name, os_ver = info.os_info()
    body = json.dumps({"code": code.strip(), "hostname": info.hostname(), "os": os_name, "osVersion": os_ver, "controllerVersion": VERSION}).encode()
    url = base + "/api/pair/claim"
    req = urllib.request.Request(url, data=body, method="POST", headers={"content-type": "application/json"})
    try:
        opener = urllib.request.build_opener(_NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context()))
        with opener.open(req, timeout=timeout) as r:
            raw = r.read(65537)
            if len(raw) > 65536:
                raise PairingError("Pairing response too large")
            result = json.loads(raw.decode())
            if not isinstance(result, dict):
                raise PairingError("Invalid pairing response")
            return result
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read(8192).decode())["error"]["message"]
        except Exception:
            msg = f"HTTP {e.code}"
        raise PairingError(msg) from None
    except urllib.error.URLError as e:
        raise PairingError(f"could not reach the relay: {e.reason}") from None
