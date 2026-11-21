import threading
import pytest
from controller.browser import project_asset as a

def test_reviewed_copy_preserves_original_and_never_overwrites(tmp_path,monkeypatch):
    downloads=tmp_path/"downloads";downloads.mkdir()
    target=tmp_path/"assets";target.mkdir()
    f=downloads/"banner.png";f.write_bytes(b"synthetic")
    mt=f.stat().st_mtime_ns
    monkeypatch.setattr(a,"_confirm",lambda *args:True)
    out=a.copy_reviewed_candidate(downloads,target,[tmp_path],f.name,9,mt)
    assert out["assetSaved"] and not out["verified"]
    assert (target/f.name).read_bytes()==f.read_bytes()==b"synthetic"
    with pytest.raises(a.ChatGPTError,match="already exists"):
        a.copy_reviewed_candidate(downloads,target,[tmp_path],f.name,9,mt)

def test_cancel_or_modified_file_does_not_copy(tmp_path,monkeypatch):
    downloads=tmp_path/"downloads";downloads.mkdir()
    target=tmp_path/"assets";target.mkdir()
    f=downloads/"banner.png";f.write_bytes(b"abc")
    mt=f.stat().st_mtime_ns
    monkeypatch.setattr(a,"_confirm",lambda *args:False)
    assert a.copy_reviewed_candidate(downloads,target,[tmp_path],f.name,3,mt)["assetSaved"] is False
    def changed(*args):
        f.write_bytes(b"longer")
        return True
    monkeypatch.setattr(a,"_confirm",changed)
    with pytest.raises(a.ChatGPTError,match="changed"):
        a.copy_reviewed_candidate(downloads,target,[tmp_path],f.name,3,mt)
    assert not (target/f.name).exists()
    with pytest.raises(a.ChatGPTError):
        a.checked_directory(target,[downloads])
