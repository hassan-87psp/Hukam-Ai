"""Opt-in Windows sign-in autostart.

No remote command can enable this. The user must run
'run-controller.bat autostart on' locally. Startup is visible/minimized so the
user can stop the controller by closing its window; no silent hidden service.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from ..config import IS_WINDOWS

NAME = "HUKM AI Controller.cmd"


def startup_path() -> Path:
    if not IS_WINDOWS:
        raise RuntimeError("Autostart is only supported on Windows")
    appdata = os.environ.get("APPDATA")
    if not appdata:
        raise RuntimeError("APPDATA is not configured on this Windows profile")
    return Path(appdata) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup" / NAME


def _launch_line() -> str:
    if getattr(sys, "frozen", False):
        target = Path(sys.executable).resolve()
    else:
        target = Path(__file__).resolve().parents[2] / "run-controller.bat"
    value = str(target)
    if any(ch in value for ch in ('"', "%", "\n", "\r")):
        raise RuntimeError("Unsupported characters in the controller install path")
    if not target.is_file():
        raise FileNotFoundError(f"Controller launcher not found: {target}")
    return f'start "" /min "{value}" run'


def enable() -> Path:
    dest = startup_path()
    dest.parent.mkdir(parents=True, exist_ok=True)
    content = "@echo off\r\nREM HUKM AI personal controller. Close its window to stop remote control.\r\n" + _launch_line() + "\r\n"
    dest.write_text(content, encoding="utf-8")
    return dest


def disable() -> bool:
    dest = startup_path()
    if dest.exists():
        dest.unlink()
        return True
    return False


def is_enabled() -> bool:
    return startup_path().is_file()
