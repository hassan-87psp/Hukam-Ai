"""Owner-approved, fixed-source HUKM updater (not a general remote code runner).

No arbitrary URLs, scripts or command-line arguments from the cloud. The
website can only request that this installed controller discover an official
GitHub Release, download the exact versioned installer, verify its SHA-256
and ask the actual Windows user before launching the interactive installer.

The installer is currently UNSIGNED. A checksum from the SAME GitHub release
protects against accidental corruption but is not publisher authentication.
A compromised HUKM repository could alter both assets: code signing is still
required before unattended/zero-prompt production updates can be enabled.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

from .. import VERSION
from ..config import IS_WINDOWS, data_dir
from . import launcher

log = logging.getLogger("hukm.updater")

RELEASES_API = "https://api.github.com/repos/hassan-87psp/Hukam-Ai/releases/latest"
ALLOWED_HOSTS = {"api.github.com", "github.com",
                 "release-assets.githubusercontent.com", "objects.githubusercontent.com"}
MAX_INSTALLER_BYTES = 120 * 1024 * 1024
MAX_METADATA_BYTES = 96 * 1024
MAX_CHECKSUM_BYTES = 2048


class UpdateError(Exception):
    pass


class _LimitedRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlsplit(newurl)
        if (parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS
                or parsed.username or parsed.password):
            raise UpdateError("Update was redirected outside official GitHub HTTPS hosts")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _read_bounded(url: str, limit: int) -> bytes:
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS
            or parsed.username or parsed.password):
        raise UpdateError("Only fixed GitHub HTTPS release downloads are allowed")
    opener = urllib.request.build_opener(_LimitedRedirects())
    headers = {"User-Agent": "HUKM-Windows-Updater/" + VERSION,
               "Accept": "application/vnd.github+json"}
    try:
        log.info("HUKM updater verifying official GitHub metadata (no user data uploaded)")
        with opener.open(urllib.request.Request(url, headers=headers), timeout=20) as response:
            data = response.read(limit + 1)
        if len(data) > limit:
            raise UpdateError("Release response exceeded safety limit")
        return data
    except (OSError, ValueError) as exc:
        raise UpdateError("GitHub release request failed: " + type(exc).__name__ +
                          ". Check laptop internet, firewall and GitHub access.") from exc


def _version(value: str) -> tuple[int, int, int]:
    if not re.fullmatch(r"(?:v)?[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}", value):
        raise UpdateError("Release has an invalid semantic version")
    return tuple(map(int, value.lstrip("v").split(".")))


def _latest_assets() -> tuple[str, str, str, int]:
    try:
        release = json.loads(_read_bounded(RELEASES_API, MAX_METADATA_BYTES))
    except (ValueError, TypeError) as exc:
        raise UpdateError("GitHub Releases returned invalid update metadata") from exc
    if not isinstance(release, dict) or release.get("draft") or release.get("prerelease"):
        raise UpdateError("The official HUKM stable release is not available")
    tag = str(release.get("tag_name", ""))
    ver = tag.removeprefix("v")
    _version(tag)
    if _version(ver) <= _version(VERSION):
        return ver, "", "", 0

    expected_name = "HUKM-Setup-v" + ver + ".exe"
    assets = release.get("assets")
    if not isinstance(assets, list):
        raise UpdateError("Official release does not contain installer assets")
    matching = {}
    for entry in assets:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name")
        if name in (expected_name, expected_name + ".sha256") and name not in matching:
            matching[name] = entry
    if set(matching) != {expected_name, expected_name + ".sha256"}:
        raise UpdateError("Official release is missing the exact setup or checksum")
    exe = matching[expected_name]
    size = exe.get("size", 0)
    if type(size) is not int or size < 100_000 or size > MAX_INSTALLER_BYTES:
        raise UpdateError("Official setup size is outside allowed bounds")

    def exact_asset_url(entry: dict, name: str) -> str:
        url = entry.get("browser_download_url")
        expected = ("https://github.com/hassan-87psp/Hukam-Ai/releases/download/" +
                    tag + "/" + name)
        if url != expected:
            raise UpdateError("Release installer URL did not match the exact repository, tag and filename")
        return url

    return ver, exact_asset_url(exe, expected_name), exact_asset_url(
        matching[expected_name + ".sha256"], expected_name + ".sha256"), size


def _expected_digest(checksum_url: str, name: str) -> str:
    text = _read_bounded(checksum_url, MAX_CHECKSUM_BYTES).decode("ascii", "strict").strip()
    match = re.fullmatch(r"([0-9a-fA-F]{64})\s+\*?" + re.escape(name), text)
    if not match:
        raise UpdateError("Installer release checksum has an invalid format")
    return match.group(1).lower()


def _stage(url: str, target: Path, expected_digest: str, expected_size: int) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(target.parent).free
    if free < expected_size + 40 * 1024 * 1024:
        raise UpdateError("Insufficient free disk space to stage HUKM update")
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname != "github.com":
        raise UpdateError("Update source must be official GitHub Releases")
    opener = urllib.request.build_opener(_LimitedRedirects())
    request = urllib.request.Request(url, headers={"User-Agent": "HUKM-Windows-Updater/" + VERSION})
    temporary = target.with_suffix(".partial")
    digest = hashlib.sha256()
    size = 0
    try:
        with opener.open(request, timeout=30) as response, temporary.open("wb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_INSTALLER_BYTES or size > expected_size:
                    raise UpdateError("Installer exceeded the size stated by the official release")
                digest.update(chunk)
                output.write(chunk)
        if size != expected_size or digest.hexdigest() != expected_digest:
            raise UpdateError("HUKM update SHA-256 integrity verification failed")
        os.replace(temporary, target)
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass


def _local_confirm(version: str) -> bool:
    import ctypes
    # MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2 | MB_TOPMOST
    # MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2 |
    # MB_SETFOREGROUND | MB_TOPMOST. Bring this confirmation to the owner's
    # visible desktop rather than leaving an unnoticed modal behind Chrome.
    flags = 0x00000004 | 0x00000030 | 0x00000100 | 0x00010000 | 0x00040000
    message = (
        "Official HUKM update v" + version + " was downloaded and SHA-256 verified.\n\n"
        "This build is not yet code-signed. GitHub repository ownership is "
        "the release trust source.\n\n"
        "Start the normal Windows installer now? HUKM will disconnect the "
        "old Controller AFTER reporting the installer launch so that Windows "
        "can replace its executable. Then complete the setup and start HUKM "
        "again. Existing pairing will be preserved.\n\n"
        "Choose No to cancel. Nothing will be installed without local approval."
    )
    return ctypes.windll.user32.MessageBoxW(None, message,
                                               "HUKM AI — Owner-approved update", flags) == 6


def update_from_website() -> dict:
    if launcher.SIMULATE:
        launcher._record("controller.update", "official release (simulation)")
        return {"updateAvailable": False, "simulated": True, "verified": False}
    if not IS_WINDOWS:
        raise UpdateError("Updates require the installed Windows Controller")
    log.info("HUKM update stage=checking_release current_version=%s", VERSION)
    version, exe_url, checksum_url, size = _latest_assets()
    log.info("HUKM update stage=release_checked latest_version=%s", version)
    if not exe_url:
        return {"updateAvailable": False, "currentVersion": VERSION,
                "latestVersion": version, "verified": True}
    installer = data_dir() / "Updates" / ("HUKM-Setup-v" + version + ".exe")
    log.info("HUKM update stage=checking_checksum")
    expected = _expected_digest(checksum_url, installer.name)
    if installer.exists():
        digest = hashlib.sha256()
        with installer.open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                digest.update(chunk)
        if installer.stat().st_size != size or digest.hexdigest() != expected:
            installer.unlink()
    if not installer.exists():
        log.info("HUKM update stage=downloading_installer size_bytes=%d", size)
        _stage(exe_url, installer, expected, size)
    log.info("HUKM update stage=verified_checksum latest_version=%s", version)
    log.info("HUKM update stage=awaiting_local_windows_confirmation")
    if not _local_confirm(version):
        log.info("HUKM update stage=cancelled_on_windows")
        return {"updateAvailable": True, "latestVersion": version,
                "installerLaunched": False, "verified": False,
                "note": "Update cancelled on the Windows laptop. No installer ran."}
    try:
        # Never use SHELL, PowerShell, arbitrary URLs, or silent install flags.
        # Normal Inno Setup UI performs the local install. A new controller
        # version is NOT verified until its next authenticated device hello.
        # Separate signed-OS process. No shell, user-supplied arguments or
        # auto-install switches. Setup prompts the local Windows owner.
        subprocess.Popen([str(installer)], close_fds=True)
        log.info("HUKM update stage=installer_launched latest_version=%s", version)
    except OSError as exc:
        raise UpdateError("Windows could not start the verified HUKM installer") from exc
    return {"updateAvailable": True, "latestVersion": version,
            "installerLaunched": True, "verified": False,
            "note": "Installer launched with local approval. Update completion is UNKNOWN until the new controller reconnects with the expected version."}
