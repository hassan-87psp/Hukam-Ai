"""Device credential storage. On Windows the token is encrypted with DPAPI (bound to the Windows user account)."""
from __future__ import annotations

import base64
import json
import os
import tempfile
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
            raise RuntimeError("Windows credential encryption failed; no token saved") from None
    # Non-Windows development only: restricted local file.
    return "plain", base64.b64encode(data).decode()


def _unprotect(kind: str, value: str) -> bytes:
    raw = base64.b64decode(value)
    if kind == "dpapi":
        import win32crypt  # type: ignore

        return win32crypt.CryptUnprotectData(raw, None, None, None, 0)[1]
    if kind != "plain":
        raise ValueError("Unknown credential format")
    return raw


def save_device(server_url: str, device_id: str, token: str, name: str) -> None:
    kind, enc = _protect(token.encode())
    p = _path()
    # Atomic replacement preserves existing pairing on encryption/write failure.
    fd, temp = tempfile.mkstemp(prefix="device-", suffix=".tmp", dir=p.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump({"server_url": server_url, "device_id": device_id, "name": name,
                       "token_kind": kind, "token": enc}, out)
            out.flush()
            os.fsync(out.fileno())
        if not IS_WINDOWS:
            os.chmod(temp, 0o600)
        os.replace(temp, p)
    finally:
        try:
            os.unlink(temp)
        except FileNotFoundError:
            pass


def load_device() -> Optional[dict]:
    p = _path()
    if not p.exists():
        return None
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        kind = d.get("token_kind", "plain")
        token = _unprotect(kind, d["token"]).decode()
        if IS_WINDOWS and kind == "plain":
            # Migrate old unencrypted Windows credentials before connecting.
            # On failure preserve the old file and refuse the connection.
            save_device(d["server_url"], d["device_id"], token, d.get("name", ""))
            d["token_kind"] = "dpapi"
        d["token"] = token
        return d
    except Exception:
        return None


def forget_device() -> bool:
    p = _path()
    if p.exists():
        p.unlink()
        return True
    return False
