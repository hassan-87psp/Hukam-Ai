import pytest
from controller.actions.dedupe import DedupeStore

def test_command_claim_fails_closed_when_journal_cannot_write(tmp_path,monkeypatch):
    path=tmp_path/"executed.json"
    journal=DedupeStore(path)
    assert journal.mark_started("old")
    previous=path.read_bytes()
    def fail():
        raise OSError("disk full")
    monkeypatch.setattr(journal,"_trim_and_save",fail)
    with pytest.raises(OSError):
        journal.mark_started("new")
    assert not journal.seen("new")
    assert journal.seen("old")
    assert path.read_bytes()==previous

def test_corrupt_journal_is_not_silently_reset(tmp_path):
    path=tmp_path/"executed.json"
    path.write_text("broken",encoding="utf-8")
    with pytest.raises(RuntimeError,match="cannot be read safely"):
        DedupeStore(path)
    assert path.read_text(encoding="utf-8")=="broken"
