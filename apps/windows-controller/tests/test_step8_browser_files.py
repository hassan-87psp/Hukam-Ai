"""Bounded local file metadata scans and approved browser navigation."""
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from controller.files import search as files
from controller.actions.executor import Executor
from controller.config import Config, ALL_CAPABILITIES
from controller.security import validation
from controller.system import launcher

def test_flat_folder_bound_and_top_k(tmp_path):
    for i in range(30):
        (tmp_path/f"invoice{i}.pdf").write_bytes(b"x")
    r=files.search([("downloads",tmp_path)],"invoice",limit=3,max_entries=7)
    assert r["scanned"]==7
    assert r["truncated"] is True
    assert len(r["results"])==3

def test_partial_downloads_are_excluded(tmp_path):
    (tmp_path/"invoice.pdf").write_bytes(b"x")
    (tmp_path/"invoice.pdf.crdownload").write_bytes(b"x")
    r=files.search([("downloads",tmp_path)],"invoice")
    assert [x["name"] for x in r["results"]]==["invoice.pdf"]
    with pytest.raises(validation.ValidationError):
        validation.check_openable(tmp_path/"invoice.pdf.crdownload",[tmp_path])

def test_incomplete_search_never_opens_file(monkeypatch,tmp_path):
    path=tmp_path/"invoice.pdf"
    path.write_bytes(b"x")
    ex=Executor(Config(),lambda:list(ALL_CAPABILITIES))
    monkeypatch.setattr(ex,"_search",lambda *a:{"results":[{"path":str(path)}],"count":1,"truncated":True})
    launch=Mock()
    monkeypatch.setattr(launcher,"open_path",launch)
    r=ex.run("file.open",{"query":"invoice","sort":"latest"},threading.Event())
    assert r.ok and r.result["opened"] is False and r.result["truncated"]
    launch.assert_not_called()

def test_reparse_entries_do_not_cross_root():
    entry=SimpleNamespace(is_symlink=lambda:False)
    assert not files._safe_entry(entry,SimpleNamespace(st_file_attributes=0x400))
    assert files._safe_entry(entry,SimpleNamespace(st_file_attributes=0))

def test_tab_and_download_keys_are_reviewed_allowlist():
    for key in ("ctrl+t","ctrl+tab","ctrl+shift+tab","ctrl+j"):
        assert validation.validate("browser.control",{"kind":"key","key":key})["key"]==key
    with pytest.raises(validation.ValidationError):
        validation.validate("browser.control",{"kind":"key","key":"ctrl+w"})
