"""Autostart never runs unless the local user explicitly opts in."""
import pytest

from controller.system import autostart


def test_autostart_requires_windows(monkeypatch):
    monkeypatch.setattr(autostart, "IS_WINDOWS", False)
    with pytest.raises(RuntimeError, match="Windows"):
        autostart.enable()


def test_autostart_on_off_status_only_writes_user_startup(monkeypatch, tmp_path):
    monkeypatch.setattr(autostart, "IS_WINDOWS", True)
    monkeypatch.setenv("APPDATA", str(tmp_path))
    assert autostart.is_enabled() is False
    path = autostart.enable()
    assert path == tmp_path / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup" / "HUKM AI Controller.cmd"
    content = path.read_text(encoding="utf-8")
    assert 'start "" /min "' in content
    assert "run-controller.bat" in content
    assert "run" in content
    assert "password" not in content
    assert autostart.is_enabled() is True
    assert autostart.disable() is True
    assert autostart.is_enabled() is False
    assert autostart.disable() is False
