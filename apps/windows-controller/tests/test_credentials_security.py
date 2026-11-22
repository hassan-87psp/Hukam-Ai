"""Credential persistence regression tests with fake DPAPI, no personal data."""
import base64
import json
import sys
from types import SimpleNamespace

import pytest

from controller.security import credentials as c


@pytest.fixture
def device(monkeypatch, tmp_path):
    monkeypatch.setattr(c, "IS_WINDOWS", True)
    path = tmp_path / "device.json"
    monkeypatch.setattr(c, "_path", lambda: path)
    fake = SimpleNamespace(
        CryptProtectData=lambda data, *args: b"fake-dpapi:" + data[::-1],
        CryptUnprotectData=lambda data, *args: ("", data[len(b"fake-dpapi:"):][::-1]),
    )
    monkeypatch.setitem(sys.modules, "win32crypt", fake)
    return path, fake


def test_windows_never_falls_back_to_plaintext(device):
    path, fake = device
    def fail(*args):
        raise OSError("DPAPI unavailable")
    fake.CryptProtectData = fail
    with pytest.raises(RuntimeError, match="encryption failed"):
        c.save_device("https://example.test", "test-device", "test-token", "test")
    assert not path.exists()


def test_failed_encryption_keeps_previous_pairing(device):
    path, fake = device
    c.save_device("https://example.test", "old", "old-token", "test")
    original = path.read_bytes()
    def fail(*args):
        raise OSError("DPAPI unavailable")
    fake.CryptProtectData = fail
    with pytest.raises(RuntimeError):
        c.save_device("https://example.test", "new", "new-token", "test")
    assert path.read_bytes() == original


def test_legacy_plain_windows_token_migrates_before_use(device):
    path, _ = device
    path.write_text(json.dumps({"server_url":"https://example.test",
        "device_id":"test", "name":"test", "token_kind":"plain",
        "token":base64.b64encode(b"test-token").decode()}), encoding="utf-8")
    assert c.load_device()["token"] == "test-token"
    assert json.loads(path.read_text(encoding="utf-8"))["token_kind"] == "dpapi"
    assert c.load_device()["token"] == "test-token"


def test_legacy_file_preserved_when_migration_fails(device):
    path, fake = device
    path.write_text(json.dumps({"server_url":"https://example.test",
        "device_id":"test", "name":"test", "token_kind":"plain",
        "token":base64.b64encode(b"test-token").decode()}), encoding="utf-8")
    original = path.read_bytes()
    def fail(*args):
        raise OSError("DPAPI unavailable")
    fake.CryptProtectData = fail
    assert c.load_device() is None
    assert path.read_bytes() == original


def test_unknown_token_format_is_rejected(device):
    path, _ = device
    path.write_text(json.dumps({"token_kind":"unknown","token":"dGVzdA=="}), encoding="utf-8")
    assert c.load_device() is None


def test_atomic_replace_failure_preserves_old_file(device, monkeypatch):
    path, _ = device
    c.save_device("https://example.test", "old", "old-token", "test")
    original = path.read_bytes()
    def fail(*args):
        raise OSError("replace failed")
    monkeypatch.setattr(c.os, "replace", fail)
    with pytest.raises(OSError):
        c.save_device("https://example.test", "new", "new-token", "test")
    assert path.read_bytes() == original
    assert list(path.parent.iterdir()) == [path]
