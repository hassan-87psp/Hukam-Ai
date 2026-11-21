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

def test_recovery_journal_never_retains_private_result(tmp_path):
    import json
    path=tmp_path/"executed.json"
    old={"type":"result","commandId":"old","ok":True,"result":{"text":"private legacy text"}}
    path.write_text(json.dumps([["old",old]]),encoding="utf-8")
    journal=DedupeStore(path)
    assert journal.seen("old") and "private legacy text" not in path.read_text()
    assert journal.mark_started("new")
    journal.store_result("new",{"type":"result","commandId":"new","ok":True,"result":{"message":"private new text"}})
    assert "private new text" not in path.read_text()
    assert DedupeStore(path).get("new")["error"]["code"]=="RESULT_NOT_RETAINED"

def test_outbox_bounded_and_ack_releases_budget(tmp_path,monkeypatch):
    from controller.communication import client
    from controller.config import Config
    monkeypatch.setattr(client,"data_dir",lambda:tmp_path)
    c=client.ControllerClient(Config(),"synthetic")
    try:
        for i in range(25):
            c._remember_result(str(i),{"result":{"text":"x"*200}})
        assert len(c.outbox)==16
        assert "0" not in c.outbox
        c._remember_result("large",{"screenshot":"x"*(7*1024*1024)})
        assert "large" not in c.outbox
        n=c.outbox_bytes
        c._drop_result("24")
        assert c.outbox_bytes<n
    finally:c.pool.shutdown(wait=True)
