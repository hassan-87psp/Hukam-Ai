"""Open a known site in a specifically configured local Chrome profile.

Windows Chrome profiles are directories inside the existing local User Data.
This never copies cookies, reads account tokens, or creates a new profile.
A missing profile fails rather than silently opening the wrong account.
"""
from __future__ import annotations
import os
import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse

from ..config import IS_WINDOWS
from ..system import launcher


class ProfileError(Exception):
    pass


def open_in_profile(url: str, profile: str) -> dict:
    if not isinstance(profile, str) or not re.fullmatch(r"(?:Default|Profile [1-9][0-9]?)", profile):
        raise ProfileError("Chrome profile must be Default or Profile 1 through Profile 99")
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in (
        "chatgpt.com", "calendar.google.com", "mail.google.com", "outlook.office.com"
    ) or parsed.username or parsed.password:
        raise ProfileError("Only configured ChatGPT/Google/Outlook HTTPS destinations are supported")
    if launcher.SIMULATE:
        launcher._record("open_chrome_profile", profile + ": " + parsed.hostname)
        return {"opened": True, "profile": profile, "site": parsed.hostname,
                "verified": False, "simulated": True}
    if not IS_WINDOWS:
        raise ProfileError("Chrome profile selection requires Windows")
    base = os.environ.get("LOCALAPPDATA")
    if not base:
        raise ProfileError("Windows LOCALAPPDATA is unavailable")
    folder = Path(base) / "Google" / "Chrome" / "User Data" / profile
    if not folder.is_dir():
        raise ProfileError("Saved Chrome profile directory was not found on this laptop: " + profile)
    try:
        if folder.resolve(strict=True).parent != folder.parent.resolve(strict=True):
            raise ProfileError("Chrome profile points outside the existing User Data directory")
    except (OSError, RuntimeError) as exc:
        raise ProfileError("Chrome profile directory cannot be verified") from exc
    exe = launcher._browser_exe("chrome")
    if not exe:
        raise ProfileError("Google Chrome executable is not installed")
    try:
        subprocess.Popen([exe, "--profile-directory=" + profile, url], shell=False,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as exc:
        raise ProfileError("Chrome could not start with the selected profile") from exc
    return {"opened": True, "profile": profile, "site": parsed.hostname, "verified": False,
            "note": "Chrome was launched with the selected profile. Login and page load are not independently verified."}
