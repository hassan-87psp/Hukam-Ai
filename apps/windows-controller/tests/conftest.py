import os
import sys
from pathlib import Path

import pytest

# Always simulate OS side effects in tests (nothing is actually launched).
os.environ["HUKM_SIMULATE"] = "1"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture()
def sandbox(tmp_path, monkeypatch):
    """Fake known folders + isolated controller data dir."""
    monkeypatch.setenv("HUKM_DATA_DIR", str(tmp_path / "appdata"))
    folders = {}
    for k in ["downloads", "documents", "desktop", "pictures", "music", "videos"]:
        p = tmp_path / k.capitalize()
        p.mkdir()
        monkeypatch.setenv(f"HUKM_FOLDER_{k.upper()}", str(p))
        folders[k] = p
    secret = tmp_path / "Private"
    secret.mkdir()
    (secret / "invoice-secret.pdf").write_text("x")
    return folders
