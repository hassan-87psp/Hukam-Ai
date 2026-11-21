"""Owner-approved Gmail/Outlook browser drafts (never sends or reads mail).

Only an exact saved local Chrome profile is used. No OAuth tokens, browser
cookies, passwords, email bodies from the inbox or third-party API calls are
read by HUKM. Deep-link compose URLs are best-effort: Chrome launch is NOT
proof the mailbox is logged in or the draft was saved.
"""
from __future__ import annotations

from urllib.parse import urlencode
from . import profiles


class EmailDraftError(Exception):
    pass


def _mail_host(provider: str) -> str:
    if provider == "google":
        return "mail.google.com"
    if provider == "outlook":
        return "outlook.office.com"
    raise EmailDraftError("Only Gmail and Outlook are supported")


def inbox_url(provider: str) -> str:
    host = _mail_host(provider)
    return ("https://mail.google.com/mail/u/0/#inbox" if provider == "google"
            else "https://outlook.office.com/mail/")


def compose_url(provider: str, recipient: str, subject: str, body: str) -> str:
    """Compose only; URL construction never submits an email."""
    _mail_host(provider)
    if provider == "google":
        query = urlencode({"view": "cm", "fs": "1", "to": recipient,
                           "su": subject, "body": body})
        return "https://mail.google.com/mail/?" + query
    query = urlencode({"to": recipient, "subject": subject, "body": body})
    return "https://outlook.office.com/mail/deeplink/compose?" + query


def open_inbox(args: dict) -> dict:
    provider = args["provider"]
    try:
        launched = profiles.open_in_profile(inbox_url(provider), args["profile"])
    except profiles.ProfileError as exc:
        raise EmailDraftError(str(exc)) from exc
    return {"provider": provider, "profile": args["profile"],
            "inboxOpenRequested": bool(launched.get("opened")),
            "messagesRead": False, "verified": False,
            "note": "Gmail/Outlook inbox launch requested in your selected existing Chrome profile. Login, inbox and unread counts are NOT verified."}


def open_compose(args: dict) -> dict:
    provider = args["provider"]
    recipient = args["to"]
    try:
        launched = profiles.open_in_profile(
            compose_url(provider, recipient, args["subject"], args["body"]),
            args["profile"],
        )
    except profiles.ProfileError as exc:
        raise EmailDraftError(str(exc)) from exc
    return {"provider": provider, "profile": args["profile"],
            "to": recipient, "subject": args["subject"],
            "composeRequested": bool(launched.get("opened")),
            "emailSent": False, "draftSavedVerified": False, "verified": False,
            "note": "A pre-filled compose link was opened in the selected Chrome profile. Review the recipient and fields in the provider UI. HUKM did NOT click Send, and draft saving is unverified."}
