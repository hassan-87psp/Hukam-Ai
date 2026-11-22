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
    next_ver = "1.9.4"
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
    name="HUKM-Setup-v1.8.5.exe"
    digest=hashlib.sha256(data).hexdigest()
    monkeypatch.setattr(updater, "_read_bounded",
                        lambda url,limit:(digest+"  "+name).encode())
    assert updater._expected_digest("https://github.com/official",name)==digest
    with pytest.raises(updater.UpdateError,match="checksum"):
        updater._expected_digest("https://github.com/official","evil.exe")


def test_windows_owner_confirmation_is_topmost_foreground_and_defaults_to_no(monkeypatch):
    import ctypes
    class FakeMessageBox:
        calls=[]
        def __call__(self, parent, message, title, flags):
            self.calls.append((str(message),str(title),flags))
            return 7  # IDNO
    fake=FakeMessageBox()
    monkeypatch.setattr(ctypes.windll.user32,"MessageBoxW",fake)
    assert updater._local_confirm("1.8.4") is False
    _,title,flags=fake.calls[-1]
    assert "Owner-approved update" in title
    assert flags & 0x10000  # MB_SETFOREGROUND
    assert flags & 0x40000  # MB_TOPMOST
    assert flags & 0x100    # MB_DEFBUTTON2 (No)
    assert flags & 0x4      # MB_YESNO


def test_owner_cancel_does_not_spawn_installer(monkeypatch,tmp_path):
    from controller.system import launcher
    monkeypatch.setattr(launcher,"SIMULATE",False)
    monkeypatch.setattr(updater,"IS_WINDOWS",True)
    monkeypatch.setattr(updater,"data_dir",lambda:tmp_path)
    monkeypatch.setattr(updater,"_latest_assets",lambda:(
        "1.8.4","https://github.com/hassan-87psp/Hukam-Ai/releases/download/v1.8.4/HUKM-Setup-v1.8.4.exe",
        "https://github.com/hassan-87psp/Hukam-Ai/releases/download/v1.8.4/HUKM-Setup-v1.8.4.exe.sha256",
        23000000))
    monkeypatch.setattr(updater,"_expected_digest",lambda *_args:"a"*64)
    target=tmp_path/"Updates"/"HUKM-Setup-v1.8.4.exe"
    def stage(url,installer,digest,size):
        installer.parent.mkdir(parents=True,exist_ok=True)
        installer.write_bytes(b"test")
    monkeypatch.setattr(updater,"_stage",stage)
    monkeypatch.setattr(updater,"_local_confirm",lambda ver:False)
    monkeypatch.setattr(updater.subprocess,"Popen",
                        lambda *_args,**_kwargs: (_ for _ in ()).throw(AssertionError("Installer must not launch")))
    result=updater.update_from_website()
    assert result["installerLaunched"] is False
    assert result["verified"] is False


def test_installer_launch_reports_unverified_until_reconnected(monkeypatch,tmp_path):
    from controller.system import launcher
    monkeypatch.setattr(launcher,"SIMULATE",False)
    monkeypatch.setattr(updater,"IS_WINDOWS",True)
    monkeypatch.setattr(updater,"data_dir",lambda:tmp_path)
    monkeypatch.setattr(updater,"_latest_assets",lambda:(
        "1.8.4","https://github.com/hassan-87psp/Hukam-Ai/releases/download/v1.8.4/HUKM-Setup-v1.8.4.exe",
        "https://github.com/hassan-87psp/Hukam-Ai/releases/download/v1.8.4/HUKM-Setup-v1.8.4.exe.sha256",
        23000000))
    monkeypatch.setattr(updater,"_expected_digest",lambda *_args:"a"*64)
    monkeypatch.setattr(updater,"_stage",lambda _url,installer,_digest,_size:
                        (installer.parent.mkdir(parents=True,exist_ok=True),installer.write_bytes(b"test")))
    monkeypatch.setattr(updater,"_local_confirm",lambda version:True)
    launched=[]
    monkeypatch.setattr(updater.subprocess,"Popen",lambda cmd,**kwargs:launched.append(cmd))
    result=updater.update_from_website()
    assert launched and launched[0][0].endswith("HUKM-Setup-v1.8.4.exe")
    assert result["installerLaunched"] is True
    assert result["verified"] is False


def test_installer_launch_gracefully_stops_previous_exe_after_result(sandbox,monkeypatch):
    import asyncio
    from controller.actions.executor import Outcome
    from controller.communication.client import ControllerClient

    client=ControllerClient(Config(),"fake-token")
    sent=[]
    async def send(message):
        sent.append(message)
        return True
    monkeypatch.setattr(client,"send",send)
    monkeypatch.setattr(client.executor,"run",
                        lambda action,args,cancel:Outcome(True,{
                            "installerLaunched":True,"verified":False,
                            "latestVersion":"1.8.4"}))
    stopped=[]
    monkeypatch.setattr(client,"stop",lambda:stopped.append(True))
    async def action():
        await client.on_command({
            "id":"test-update-windows-release",
            "action":"controller.update","args":{},"timeoutMs":180000})
    try:
        asyncio.run(action())
        assert stopped == [True]
        assert any(m.get("type")=="result" and m["result"]["installerLaunched"] is True
                   for m in sent), "Report the launch BEFORE the old EXE exits"
    finally:
        client.pool.shutdown(wait=True)
