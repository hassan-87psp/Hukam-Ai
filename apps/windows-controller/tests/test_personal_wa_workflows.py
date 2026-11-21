"""Tests for newly staged Personal WhatsApp and browser workflows.

These validate pure logic and simulated controller actions only. A real
WhatsApp Desktop/Chrome account still requires a manual acceptance suite.
"""
from datetime import datetime, timedelta, timezone
import threading

import pytest

from controller.actions.executor import Executor
from controller.browser import calendar_draft, chatgpt
from controller.config import ALL_CAPABILITIES, Config
from controller.screen import accessibility
from controller.security import validation as v
from controller.system import launcher
from controller.whatsapp import desktop_ops


def ex():
    return Executor(Config(), lambda: list(ALL_CAPABILITIES))


def run(action, args):
    return ex().run(action, args, threading.Event())


def test_diagnostics_does_not_collect_private_data():
    result = run("diagnostics.probe", {})
    assert result.ok
    assert result.result["privateDataCollected"] is False
    assert result.result["uiautomationInstalled"] is True


def test_approved_foreground_scroll_is_bounded_and_unverified():
    assert v.validate("ui.scroll", {"steps": -2}) == {"steps": -2}
    out = run("ui.scroll", {"steps": -2})
    assert out.ok and out.result["inputDelivered"] is True
    assert out.result["verified"] is False
    for bad in [0, 6, -6, 1.5, True]:
        with pytest.raises(v.ValidationError):
            v.validate("ui.scroll", {"steps": bad})


def test_inspect_controls_never_reads_text_fields():
    controls = [
        ("ButtonControl", "Search"),
        ("TextControl", "private personal message"),
        ("EditControl", "my password"),
        ("ButtonControl", "Search"),
        ("MenuItemControl", "New tab"),
    ]
    result = accessibility.inspect_controls(controls)
    assert result == [{"role": "ButtonControl", "label": "Search"},
                      {"role": "MenuItemControl", "label": "New tab"}]
    assert run("ui.inspect", {}).result["contentRead"] is False


def test_ui_activate_denies_direct_send_delete_buttons(sandbox):
    for label in ("Send", "Delete", "Send message", "Purchase", "Pay now"):
        with pytest.raises(v.ValidationError):
            v.validate("ui.activate", {"label": label})
    with pytest.raises(v.ValidationError):
        v.validate("ui.activate", {"label": "Search"})
    from controller.screen import accessibility
    observed = accessibility.inspect()
    checked = v.validate("ui.activate_observed", {
        "label": "Search", "role": "ButtonControl", "snapshot": observed["snapshot"],
    })
    result = run("ui.activate_observed", checked)
    assert result.ok and result.result["verified"] is False


def test_calendar_draft_is_not_event_creation(sandbox):
    start = (datetime.now(timezone.utc) + timedelta(days=2)).replace(microsecond=0)
    end = start + timedelta(minutes=45)
    args = {
        "provider": "google", "title": "HUKM Test Meeting",
        "profile": "Profile 1", "startUtc": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "endUtc": end.strftime("%Y-%m-%dT%H:%M:%SZ"), "timeZone": "Asia/Kuala_Lumpur",
        "details": "", "location": "",
    }
    clean = v.validate("calendar.event_draft", args)
    url = calendar_draft.event_url(args["provider"], args["title"], args["startUtc"],
                                   args["endUtc"], args["timeZone"])
    assert "calendar.google.com/calendar/r/eventedit" in url
    assert "HUKM+Test+Meeting" in url
    google = run("calendar.event_draft", clean)
    assert google.ok and google.result["eventSaved"] is False and google.result["verified"] is False
    save = run("calendar.save_reviewed", v.validate("calendar.save_reviewed", args))
    assert save.ok and save.result["saveAttempted"] is True
    assert save.result["eventCreatedVerified"] is False
    assert save.result["verified"] is False
    editor_url = calendar_draft.event_url("google", args["title"], args["startUtc"],
        args["endUtc"], args["timeZone"])
    assert calendar_draft._same_prefilled_editor(editor_url, editor_url)
    assert not calendar_draft._same_prefilled_editor(
        editor_url.replace("HUKM+Test+Meeting", "Different+Event"), editor_url)
    assert not calendar_draft._same_prefilled_editor("https://evil.test/", editor_url)
    args["provider"] = "outlook"
    outlook = run("calendar.event_draft", v.validate("calendar.event_draft", args))
    assert outlook.ok and outlook.result["invitesSent"] is False
    with pytest.raises(v.ValidationError):
        v.validate("calendar.event_draft", {**args, "startUtc": "2001-01-01T03:00:00Z"})
    with pytest.raises(v.ValidationError):
        v.validate("calendar.save_reviewed", {**args, "startUtc": "2001-01-01T03:00:00Z"})


def test_whatsapp_read_and_draft_are_explicit_and_not_sent(sandbox):
    assert run("whatsapp.read_selected", {}).result["transferredToAccount"] is True
    args = v.validate("whatsapp.draft_reply", {"contact": "Test Contact", "message": "Kal 3 PM milte hain"})
    r = run("whatsapp.draft_reply", args)
    assert r.ok and r.result["sent"] is False
    assert r.result["draftEntered"] is True
    result = run("whatsapp.send_reviewed", v.validate("whatsapp.send_reviewed", args))
    assert result.ok and result.result["sendAttempted"] is True
    assert result.result["deliveryVerified"] is False
    assert result.result["verified"] is False
    with pytest.raises(v.ValidationError):
        v.validate("whatsapp.draft_reply", {"contact": "Test", "message": ""})
    with pytest.raises(v.ValidationError):
        v.validate("whatsapp.send_reviewed", {"contact": "Test", "message": ""})


def test_whatsapp_attachment_only_allowed_path_and_preview(sandbox, tmp_path):
    safe = sandbox["downloads"] / "image.png"
    safe.write_bytes(b"png")
    good = run("whatsapp.attach_preview", v.validate("whatsapp.attach_preview",
               {"contact": "Test Contact", "path": str(safe)}))
    assert good.ok and good.result["sent"] is False
    blocked = run("whatsapp.attach_preview", {"contact": "Test Contact", "path": str(tmp_path / "secret.pdf")})
    assert not blocked.ok
    executable = sandbox["downloads"] / "malware.exe"
    executable.write_bytes(b"exe")
    assert not run("whatsapp.attach_preview", {"contact": "Test Contact", "path": str(executable)}).ok


def test_stale_whatsapp_attachment_authorization_is_invalidated_on_new_preview(sandbox):
    # Even if a new preview fails, it must never leave the older file/send
    # authorized for a different or accidentally retried attachment.
    desktop_ops._pending_attachment = {
        "contact": "Previous Contact", "path": "C:\\old\\report.pdf",
        "hwnd": 123, "createdAt": 0, "sha256": "old", "size": 5,
    }
    result = desktop_ops.attach_preview("Ali", "C:\\Users\\Test\\Downloads\\new.pdf")
    assert result["simulated"] is True
    assert desktop_ops._pending_attachment is None


def test_chatgpt_completed_file_snapshot_requires_known_type_and_size(tmp_path):
    target = tmp_path / "new-banner.png"
    target.write_bytes(b"12345")
    (tmp_path / "image.png.crdownload").write_bytes(b"partial")
    (tmp_path / "readme.exe").write_bytes(b"danger")
    files = chatgpt._files(tmp_path)
    assert files["new-banner.png"][1] == 5
    assert "image.png.crdownload" not in files
    assert "readme.exe" not in files


def test_chatgpt_project_url_and_draft_constraints(sandbox):
    url = "https://chatgpt.com/g/g-p-project123"
    assert chatgpt.matches_project(url, url)
    assert not chatgpt.matches_project("https://chatgpt.com/", url)
    assert not chatgpt.matches_project("https://evil.example/g/g-p-project123", url)
    draft = v.validate("chatgpt.prompt_draft", {"projectUrl": url, "prompt": "Create a gold banner"})
    assert run("chatgpt.prompt_draft", draft).result["submitted"] is False
    submitted = run("chatgpt.submit_prompt", draft)
    assert submitted.ok and submitted.result["responseVerified"] is False
    d = run("chatgpt.download_visible", v.validate("chatgpt.download_visible", {"projectUrl": url}))
    assert d.ok and d.result["downloadVerified"] is True
    with pytest.raises(v.ValidationError):
        v.validate("chatgpt.prompt_draft", {"projectUrl": "https://evil.example", "prompt": "Hi"})


def test_no_controller_action_logs_private_args():
    import inspect
    from controller.communication.client import ControllerClient
    src = inspect.getsource(ControllerClient.on_command)
    assert 'json.dumps(cmd.get("args"' not in src
    assert 'arguments redacted' in src
