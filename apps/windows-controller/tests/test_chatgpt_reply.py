"""Synthetic-only privacy and exact-thread guards for ChatGPT follow-ups."""
import threading
from types import SimpleNamespace

import pytest
from controller.browser import chatgpt, chatgpt_reply
from controller.security.validation import ValidationError, validate
from controller.system import launcher


def test_exact_user_prompt_prevents_cross_thread_response_mixup():
    g = [
        ("user", "Why did Gold rise today?"),
        ("assistant", "Gold rose after macro data."),
    ]
    assert chatgpt_reply.choose_visible_reply(g, "Why did Gold rise today?") == "Gold rose after macro data."
    with pytest.raises(chatgpt.ChatGPTError, match="exact question|uniquely"):
        chatgpt_reply.choose_visible_reply(g, "Why did BTC rise today?")


def test_last_assistant_only_no_guess_from_old_conversation():
    g = [
        ("user", "Gold outlook"),
        ("assistant", "Gold may rise"),
        ("user", "What about EURUSD?"),
        ("assistant", "EURUSD remains mixed"),
    ]
    with pytest.raises(chatgpt.ChatGPTError, match="last visible user turn"):
        chatgpt_reply.choose_visible_reply(g, "Gold outlook")
    assert chatgpt_reply.choose_visible_reply(g, "What about EURUSD?") == "EURUSD remains mixed"
    with pytest.raises(chatgpt.ChatGPTError, match="uniquely"):
        chatgpt_reply.choose_visible_reply([g[0],g[1],g[0],g[1]], "Gold outlook")


def test_url_must_be_exact_chatgpt_or_verified_general_conversation():
    assert chatgpt_reply._url_allowed("https://chatgpt.com/", "https://chatgpt.com/")
    assert chatgpt_reply._url_allowed(
        "https://chatgpt.com/c/9d44a11b-2288-4c66-9f4a-abbdda0009a2",
        "https://chatgpt.com/")
    assert not chatgpt_reply._url_allowed(
        "https://chatgpt.com.evil.example/c/9d44a11b-2288-4c66-9f4a-abbdda0009a2",
        "https://chatgpt.com/")
    assert not chatgpt_reply._url_allowed(
        "https://chatgpt.com/c/9d44a11b-2288-4c66-9f4a-abbdda0009a2",
        "https://chatgpt.com/g/g-p-project")
    assert not chatgpt_reply._url_allowed(
        "https://chatgpt.com/c/9d44a11b-2288-4c66-9f4a-abbdda0009a2?token=secret",
        "https://chatgpt.com/")


def test_chatgpt_read_does_not_transfer_any_content_in_simulation(monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", True)
    out=chatgpt_reply.read_visible_response(
        "https://chatgpt.com/", "Gold ka kya scene hai", threading.Event())
    assert out["responseRead"] is False and out["simulated"] is True
    assert "responseText" not in out


def test_exact_last_message_required_before_followup_input(monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", False)
    monkeypatch.setattr(chatgpt_reply,"_chrome_context",
       lambda *_: (SimpleNamespace(hwnd=22),object(),"https://chatgpt.com/c/thread-test1234"))
    monkeypatch.setattr(chatgpt_reply,"_visible_groups",
       lambda *_: ([("user","Previous unrelated message"),
                    ("assistant","Unrelated answer")],False))
    with pytest.raises(chatgpt.ChatGPTError, match="Exact previous question"):
        chatgpt_reply.draft_followup("https://chatgpt.com/c/thread-test1234",
            "Expected previous message", "Please explain", threading.Event())


def test_read_and_followup_parameters_require_exact_browser_identity():
    url="https://chatgpt.com/c/9d44a11b-2288-4c66-9f4a-abbdda0009a2"
    read=validate("chatgpt.read_response",{"projectUrl":url,"prompt":"Hello"})
    assert read["projectUrl"]==url and read["prompt"]=="Hello"
    follow=validate("chatgpt.followup_draft",{
        "projectUrl":url,"previousPrompt":"Hello","prompt":"Explain in detail"})
    assert follow["previousPrompt"]=="Hello"
    for target in ("https://chatgpt.com.evil.test/", "http://chatgpt.com/", "https://evil.test/"):
        with pytest.raises(ValidationError):
            validate("chatgpt.read_response",{"projectUrl":target,"prompt":"Hello"})
    with pytest.raises(ValidationError):
        validate("chatgpt.followup_draft",{"projectUrl":url,
            "previousPrompt":"","prompt":"Explain"})
