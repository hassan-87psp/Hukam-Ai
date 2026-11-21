"""Launching things on the desktop. All OS side effects go through here, so tests can run in simulation."""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
import webbrowser
from pathlib import Path

from ..config import IS_WINDOWS

log = logging.getLogger("hukm.launcher")

# HUKM_SIMULATE=1 records launches instead of performing them (used by automated tests on non-Windows hosts).
SIMULATE = os.environ.get("HUKM_SIMULATE") == "1"
simulated_calls: list[tuple[str, str]] = []


class LaunchError(Exception):
    pass


def _record(kind: str, target: str) -> None:
    simulated_calls.append((kind, target))
    log.info("SIMULATED %s %s", kind, target)


def open_path(path: Path | str) -> None:
    """Open a file or folder with its default handler (Explorer for folders)."""
    target = str(path)
    if SIMULATE:
        return _record("open_path", target)
    if IS_WINDOWS:
        os.startfile(target)  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", target])
    else:
        subprocess.Popen(["xdg-open", target], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def reveal_in_explorer(path: Path) -> None:
    if SIMULATE:
        return _record("reveal", str(path))
    if IS_WINDOWS:
        # Passing a list (no shell) keeps the path from being interpreted as arguments.
        subprocess.Popen(["explorer.exe", f"/select,{path}"])
    else:
        open_path(path.parent)


def _browser_exe(pref: str) -> str | None:
    if not IS_WINDOWS or pref == "default":
        return None
    candidates = {
        "chrome": [
            os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
        ],
        "edge": [
            os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
            os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        ],
    }.get(pref, [])
    for c in candidates:
        if os.path.exists(c):
            return c
    return None


def open_url(url: str, browser_pref: str = "default") -> str:
    """Open an http(s) URL. Returns which browser was used."""
    if not url.startswith(("http://", "https://")):
        raise LaunchError("refusing to open a non-http URL")
    if SIMULATE:
        _record("open_url", url)
        return "simulated"
    exe = _browser_exe(browser_pref)
    if exe:
        subprocess.Popen([exe, url])
        return browser_pref
    if not webbrowser.open(url, new=2):
        raise LaunchError("no web browser could be started")
    return "default"


def open_uri(uri: str) -> None:
    """Open a registered protocol URI such as ms-settings: or whatsapp:. Only fixed, known schemes are passed here."""
    if SIMULATE:
        return _record("open_uri", uri)
    if IS_WINDOWS:
        os.startfile(uri)  # type: ignore[attr-defined]
    else:
        raise LaunchError("protocol URIs are only supported on Windows")



def launch_personal_whatsapp() -> None:
    """Start only the *installed* native Windows WhatsApp app.

    Do not use whatsapp: URI. Third-party/default URI handlers can open
    Chrome or WhatsApp Web without the user asking for Web. The one
    PowerShell query only enumerates local Start-menu app identifiers;
    it never executes code derived from a user command or contact.
    """
    if SIMULATE:
        return _record("launch_whatsapp_native", "WhatsApp Desktop")
    if not IS_WINDOWS:
        raise LaunchError("Personal WhatsApp Desktop requires Windows")

    candidates = [
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "WhatsApp", "WhatsApp.exe"),
        shutil.which("WhatsApp.exe"),
        shutil.which("WhatsAppDesktop.exe"),
    ]
    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            try:
                subprocess.Popen([candidate], close_fds=True)
                return
            except OSError:
                continue
    # Microsoft Store installs frequently have no ordinary executable path.
    # Query the fixed Windows Start-menu registry rather than a generic URL.
    script = (
        "Get-StartApps | Where-Object { $_.Name -match '^WhatsApp(?:\s|$)' } "
        "| Select-Object -First 6 Name, AppID | ConvertTo-Json -Compress"
    )
    try:
        import json
        import re
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        output = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
            capture_output=True, text=True, timeout=7, check=False, creationflags=flags,
        )
        if output.returncode == 0 and output.stdout.strip():
            entries = json.loads(output.stdout)
            if isinstance(entries, dict):
                entries = [entries]
            for entry in entries if isinstance(entries, list) else []:
                if not isinstance(entry, dict):
                    continue
                name = str(entry.get("Name", ""))
                app_id = str(entry.get("AppID", ""))
                if not re.match(r"^WhatsApp(?:\s|$)", name, re.I):
                    continue
                if "whatsapp" not in app_id.casefold() or not re.fullmatch(r"[A-Za-z0-9_.!\-]{5,190}", app_id):
                    continue
                subprocess.Popen(["explorer.exe", "shell:AppsFolder\\" + app_id],
                                 close_fds=True)
                return
    except (OSError, ValueError, TimeoutError, subprocess.TimeoutExpired):
        pass
    raise LaunchError(
        "Personal WhatsApp Desktop native launcher could not find the installed app. "
        "Open it from Windows Start; HUKM will not switch to WhatsApp Web."
    )

def start_program(candidates: list[str]) -> str:
    """Start the first candidate that resolves. Candidates are fixed allowlist entries, never user text."""
    if SIMULATE:
        _record("start_program", candidates[0])
        return candidates[0]
    for c in candidates:
        expanded = os.path.expandvars(c)
        if expanded.endswith(":"):
            open_uri(expanded)
            return expanded
        if os.path.isabs(expanded):
            if os.path.exists(expanded):
                subprocess.Popen([expanded])
                return expanded
            continue
        found = shutil.which(expanded)
        if found:
            try:
                subprocess.Popen([found])
            except OSError:
                if not IS_WINDOWS:
                    raise
                # e.g. WinError 740 for auto-elevating tools such as Task Manager; ShellExecute handles UAC.
                os.startfile(found)  # type: ignore[attr-defined]
            return found
        if IS_WINDOWS:
            # App Paths registry entries (chrome.exe, winword.exe, …) resolve through ShellExecute.
            try:
                os.startfile(expanded)  # type: ignore[attr-defined]
                return expanded
            except OSError:
                continue
    raise LaunchError("application is not installed or could not be found")
