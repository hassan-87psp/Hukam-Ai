"""Device credential storage. On Windows the token is encrypted with DPAPI (bound to the Windows user account)."""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Optional

from ..config import IS_WINDOWS, data_dir


def _path() -> Path:
    return data_dir() / "device.json"


def _protect(data: bytes) -> tuple[str, str]:
    if IS_WINDOWS:
        try:
            import win32crypt  # type: ignore

            blob = win32crypt.CryptProtectData(data, "HUKM AI device token", None, None, None, 0)
            return "dpapi", base64.b64encode(blob).decode()
        except Exception:
            pass
    return "plain", base64.b64encode(data).decode()


def _unprotect(kind: str, value: str) -> bytes:
    raw = base64.b64decode(value)
    if kind == "dpapi":
        import win32crypt  # type: ignore

        return win32crypt.CryptUnprotectData(raw, None, None, None, 0)[1]
    return raw


def save_device(server_url: str, device_id: str, token: str, name: str) -> None:
    kind, enc = _protect(token.encode())
    p = _path()
    p.write_text(json.dumps({"server_url": server_url, "device_id": device_id, "name": name, "token_kind": kind, "token": enc}), encoding="utf-8")
    if not IS_WINDOWS:
        os.chmod(p, 0o600)


def load_device() -> Optional[dict]:
    p = _path()
    if not p.exists():
        return None
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        d["token"] = _unprotect(d.get("token_kind", "plain"), d["token"]).decode()
        return d
    except Exception:
        return None


def forget_device() -> bool:
    p = _path()
    if p.exists():
        p.unlink()
        return True
    return False
