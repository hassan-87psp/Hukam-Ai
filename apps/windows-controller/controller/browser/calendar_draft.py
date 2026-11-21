"""Google/Outlook Calendar pre-filled compose link in a saved Chrome profile.

Creates an event DRAFT in the logged-in browser, NOT an event on the server.
There is no OAuth authorization in HUKM yet, so saving/inviting cannot be
claimed as complete. Uses officially documented Google Calendar template URL
and well-known Outlook web compose deep link, whose structure may change.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from . import profiles


class CalendarDraftError(Exception):
    pass


def _utc(value: str) -> datetime:
    if not isinstance(value, str) or len(value) != 20 or not value.endswith("Z"):
        raise CalendarDraftError("UTC time must be YYYY-MM-DDTHH:MM:SSZ")
    try:
        dt = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise CalendarDraftError("Invalid event date") from exc
    return dt


def event_url(provider: str, title: str, start: str, end: str,
              time_zone: str, details: str = "", location: str = "") -> str:
    begin, finish = _utc(start), _utc(end)
    if not begin < finish or finish - begin > timedelta(hours=24):
        raise CalendarDraftError("Event must have a positive duration of up to 24 hours")
    if begin < datetime.now(timezone.utc) - timedelta(minutes=5):
        raise CalendarDraftError("Cannot compose an event in the past")
    if begin > datetime.now(timezone.utc) + timedelta(days=366):
        raise CalendarDraftError("Event date must be within the next year")
    if provider == "google":
        params = {"action": "TEMPLATE", "text": title,
                  "dates": begin.strftime("%Y%m%dT%H%M%SZ") + "/" + finish.strftime("%Y%m%dT%H%M%SZ"),
                  "ctz": time_zone, "details": details, "location": location}
        return "https://calendar.google.com/calendar/r/eventedit?" + urlencode(params)
    if provider == "outlook":
        params = {"path": "/calendar/action/compose", "rru": "addevent",
                  "subject": title, "startdt": begin.strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "enddt": finish.strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "body": details, "location": location}
        return "https://outlook.office.com/calendar/0/deeplink/compose?" + urlencode(params)
    raise CalendarDraftError("Provider must be google or outlook")


def open_event_draft(args: dict) -> dict:
    url = event_url(args["provider"], args["title"], args["startUtc"],
                    args["endUtc"], args["timeZone"], args.get("details", ""),
                    args.get("location", ""))
    try:
        out = profiles.open_in_profile(url, args["profile"])
    except profiles.ProfileError as exc:
        raise CalendarDraftError(str(exc)) from exc
    return {"provider": args["provider"], "title": args["title"],
            "startUtc": args["startUtc"], "endUtc": args["endUtc"],
            "timeZone": args["timeZone"], "eventDraftOpened": bool(out.get("opened")),
            "eventSaved": False, "invitesSent": False, "verified": False,
            "note": "Pre-filled Calendar composer opened. Review time/attendees and click Save manually. No event ID was created or verified."}
