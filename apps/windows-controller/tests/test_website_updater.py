"""HUKM 1.8 website update path: verified official release and explicit consent."""
import hashlib
import json
import threading

import pytest

from controller import VERSION
from controller.actions.executor import Executor
from controller.config import ALL_CAPABILITIES, Config
from controller.security import validation as v
from controller.system import launcher, updater


def test_update_rejects_remote_exe_url_and_shell_arguments():
    assert v.validate("controller.update", {}) == {}
    for params in ({"url": "https://evil.example/bad.exe"},
                   {"path": "C:/Windows/bad.exe"},
                   {"command": "powershell.exe"}):
        with pytest.raises(v.ValidationError):
            v.validate("controller.update", params)


def test_updater_does_not_download_or_launch_in_simulated_controller(monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", True)
    launcher.simulated_calls.clear()
    ex = Executor(Config(), lambda: list(ALL_CAPABILITIES))
    result = ex.run("controller.update", {}, threading.Event())
    assert result.ok
    assert result.result["verified"] is False
    assert launcher.simulated_calls == [
        ("controller.update", "official release (simulation)")
    ]


def test_update_versions_prevent_downgrade_and_invalid_version():
    assert updater._version("v1.8.0") == (1, 8, 0)
    assert updater._version("1.8.1") > updater._version("v1.8.0")
    for invalid in ("1.8", "../../bad", "v1.8.0-preview", "v9999.0.0"):
        with pytest.raises(updater.UpdateError):
            updater._version(invalid)


def test_rejects_unofficial_release_redirect():
    import urllib.request
    redir=updater._LimitedRedirects()
    request=urllib.request.Request(updater.RELEASES_API)
    for bad in ("http://github.com/file",
                "https://evil.example/attacker.exe",
                "file:///C:/evil.exe",
                "https://github.com@evil.example/attacker"):
        with pytest.raises(updater.UpdateError):
            redir.redirect_request(request, None, 302, "moved", {}, bad)


def test_release_metadata_requires_both_exact_assets(monkeypatch):
    newer = (lambda: "v" + ".".join(
        map(str,(updater._version(VERSION)[0],updater._version(VERSION)[1],
                 updater._version(VERSION)[2] + 1))))()
    payload = {"tag_name": newer, "draft": False, "prerelease": False, "assets": []}
    monkeypatch.setattr(updater, "_read_bounded",
                        lambda url,limit: json.dumps(payload).encode())
    with pytest.raises(updater.UpdateError,match="missing"):
        updater._latest_assets()


def test_release_metadata_accepts_only_exact_repository_urls(monkeypatch):
    next_ver = "1.8.1"
    name = "HUKM-Setup-v" + next_ver + ".exe"
    base = "https://github.com/hassan-87psp/Hukam-Ai/releases/download/v" + next_ver + "/"
    payload = {"tag_name": "v" + next_ver, "draft": False, "prerelease": False,
               "assets": [
                   {"name": name, "size": 23000000,
                    "browser_download_url": base + name},
                   {"name": name + ".sha256", "size": 100,
                    "browser_download_url": base + name + ".sha256"}]}
    monkeypatch.setattr(updater, "_read_bounded",
                        lambda url,limit: json.dumps(payload).encode())
    version,exe,checksum,size=updater._latest_assets()
    assert version == next_ver and size == 23000000
    assert exe == base+name
    assert checksum == base+name+".sha256"
    payload["assets"][0]["browser_download_url"] = "https://example.com/fake.exe"
    with pytest.raises(updater.UpdateError,match="exact repository"):
        updater._latest_assets()


def test_checksum_format_must_include_exact_filename(monkeypatch):
    data=b"test"
    name="HUKM-Setup-v1.8.1.exe"
    digest=hashlib.sha256(data).hexdigest()
    monkeypatch.setattr(updater, "_read_bounded",
                        lambda url,limit:(digest+"  "+name).encode())
    assert updater._expected_digest("https://github.com/official",name)==digest
    with pytest.raises(updater.UpdateError,match="checksum"):
        updater._expected_digest("https://github.com/official","evil.exe")
