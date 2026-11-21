"""Phase 4: approved mail drafts and Calendar contracts; simulated only."""
import threading
from urllib.parse import parse_qs, urlparse
from datetime import datetime, timedelta, timezone

import pytest

from controller.actions.executor import Executor
from controller.browser import email_draft, calendar_draft
from controller.config import Config, ALL_CAPABILITIES
from controller.security import validation as v
from controller.system import launcher


def run(action, args):
    return Executor(Config(), lambda: list(ALL_CAPABILITIES)).run(action, args, threading.Event())


@pytest.mark.parametrize("provider,host", [
    ("google", "mail.google.com"),
    ("outlook", "outlook.office.com"),
])
def test_email_inbox_opens_only_in_requested_existing_chrome_profile(provider, host, monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", True)
    args = v.validate("email.inbox_open", {"provider": provider, "profile": "Profile 2"})
    result = run("email.inbox_open", args)
    assert result.ok
    assert result.result["messagesRead"] is False
    assert result.result["verified"] is False
    assert ("open_chrome_profile", "Profile 2: " + host) in launcher.simulated_calls


@pytest.mark.parametrize("provider,host", [
    ("google", "mail.google.com"),
    ("outlook", "outlook.office.com"),
])
def test_compose_url_encodes_reviewed_recipient_subject_body(provider, host):
    raw = {"provider": provider, "profile": "Default", "to": "staff@example.com",
           "subject": "Meeting + Planning", "body": "Hello, report? & please confirm."}
    clean = v.validate("email.compose_draft", raw)
    url = email_draft.compose_url(clean["provider"], clean["to"], clean["subject"], clean["body"])
    parsed = urlparse(url)
    assert parsed.scheme == "https" and parsed.hostname == host
    assert "staff@example.com" not in parsed.netloc
    params = parse_qs(parsed.query)
    assert params["to"] == ["staff@example.com"]
    assert params["body"] == ["Hello, report? & please confirm."]
    assert params["subject" if provider == "outlook" else "su"] == ["Meeting + Planning"]
    result = run("email.compose_draft", clean)
    assert result.ok
    assert result.result["emailSent"] is False
    assert result.result["draftSavedVerified"] is False
    assert result.result["verified"] is False


@pytest.mark.parametrize("bad", [
    {"provider": "unknown", "profile": "Default"},
    {"provider": "google", "profile": "../Default"},
    {"provider": "google", "profile": "Profile 100"},
    {"provider": "google", "profile": "Default", "to": "test@example.com\nBcc: x@evil.test", "subject": "Hi", "body": "Hello"},
    {"provider": "google", "profile": "Default", "to": "alice@example.com,bob@example.com", "subject": "Hi", "body": "Hello"},
    {"provider": "google", "profile": "Default", "to": "unknown", "subject": "Hi", "body": "Hello"},
    {"provider": "google", "profile": "Default", "to": "a@example.com", "subject": "", "body": "Hello"},
    {"provider": "outlook", "profile": "Default", "to": "a@example.com", "subject": "Hi", "body": ""},
    {"provider": "outlook", "profile": "Default", "to": "a@example.com", "subject": "Hi", "body": "X" * 1001},
])
def test_bad_email_inputs_fail_closed(bad):
    action = "email.inbox_open" if "to" not in bad else "email.compose_draft"
    with pytest.raises(v.ValidationError):
        v.validate(action, bad)


def test_email_requires_enabled_browser_capability(monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", True)
    cfg = Config()
    cfg.capabilities = [name for name in ALL_CAPABILITIES if name != "browser"]
    ex = Executor(cfg, lambda: list(ALL_CAPABILITIES))
    result = ex.run("email.inbox_open", {"provider": "google", "profile": "Default"}, threading.Event())
    assert not result.ok
    assert result.error["code"] == "CAPABILITY_DISABLED"


def test_calendar_url_has_utc_and_timezone_and_never_claims_saved(monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", True)
    begin = datetime.now(timezone.utc) + timedelta(days=2)
    begin = begin.replace(microsecond=0)
    finish = begin + timedelta(minutes=45)
    raw = {"provider": "google", "profile": "Profile 1", "title": "HUKM Review",
           "startUtc": begin.strftime("%Y-%m-%dT%H:%M:%SZ"),
           "endUtc": finish.strftime("%Y-%m-%dT%H:%M:%SZ"),
           "timeZone": "Asia/Kuala_Lumpur", "details": "", "location": ""}
    cleaned = v.validate("calendar.event_draft", raw)
    u = urlparse(calendar_draft.event_url(cleaned["provider"], cleaned["title"],
                  cleaned["startUtc"], cleaned["endUtc"], cleaned["timeZone"]))
    q = parse_qs(u.query)
    assert q["ctz"] == ["Asia/Kuala_Lumpur"]
    assert q["dates"][0].endswith("Z")
    result = run("calendar.event_draft", cleaned)
    assert result.ok
    assert result.result["eventSaved"] is False and result.result["invitesSent"] is False
