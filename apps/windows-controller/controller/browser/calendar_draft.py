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

def _same_prefilled_editor(actual_url: str, expected_url: str) -> bool:
    """A reviewed Save must target the *exact* previously prefilled event URL."""
    from urllib.parse import parse_qsl, urlparse
    try:
        actual = urlparse(actual_url)
        expected = urlparse(expected_url)
    except (TypeError, ValueError):
        return False
    try:
        return (actual.scheme == expected.scheme == "https"
                and actual.hostname == expected.hostname
                and actual.port in (None, 443) and expected.port in (None, 443)
                and actual.path.rstrip("/") == expected.path.rstrip("/")
                and sorted(parse_qsl(actual.query, keep_blank_values=True)) ==
                    sorted(parse_qsl(expected.query, keep_blank_values=True))
                and not actual.username and not actual.password and not actual.fragment)
    except ValueError:
        return False


def save_reviewed(args: dict, cancel=None) -> dict:
    """User-confirmed Calendar Save via the foreground logged-in Chrome editor.

    URL, title and active app must match before clicking an exact visible Save.
    If the website redirects/changes any of them, the automation fails closed.
    This cannot prove a Google/Outlook API event ID or invitation delivery.
    """
    from ..system import launcher, windows, desktop_input
    from .reviewed_input import check_window, click_reviewed
    desktop_input._check_cancel(cancel)
    if launcher.SIMULATE:
        launcher._record("calendar.save_reviewed", "event (redacted)")
        return {"saveAttempted": True, "eventCreatedVerified": False,
                "invitesSentVerified": False, "verified": False, "simulated": True}
    import time
    import uiautomation as auto
    expected_url = event_url(args["provider"], args["title"], args["startUtc"],
                             args["endUtc"], args["timeZone"], args.get("details", ""),
                             args.get("location", ""))
    active = windows.active_window()
    if not active or active.process.casefold() != "chrome.exe":
        raise CalendarDraftError("Focus the correct Calendar event editor in Chrome first")
    import win32gui
    if not win32gui.IsWindowVisible(active.hwnd) or win32gui.IsIconic(active.hwnd):
        raise CalendarDraftError("Calendar Chrome window is hidden or minimized")
    root = auto.ControlFromHandle(active.hwnd)
    urls = []
    title_matches = []
    save_buttons = []
    bounds = root.BoundingRectangle
    left, top, width, height = float(bounds.left), float(bounds.top), float(bounds.width()), float(bounds.height())
    for n, (c, _depth) in enumerate(auto.WalkControl(root, maxDepth=13)):
        if n >= 1200:
            break
        try:
            if c.IsOffscreen:
                continue
            name = str(c.Name or "").strip()
            role = c.ControlTypeName
            rect = c.BoundingRectangle
            if role == "EditControl":
                try:
                    value = str(c.GetValuePattern().Value or "")
                except Exception:
                    continue
                if value.startswith("http") and any(word in name.casefold()
                     for word in ("address", "search bar", "location")):
                    urls.append(value)
                elif value == args["title"] and name.casefold() in (
                     "title", "add title", "event title", "subject", "event name"):
                    title_matches.append(c)
            if role == "ButtonControl" and name.casefold() == "save":
                if left + width * 0.30 <= rect.left <= left + width and top <= rect.top <= top + height * 0.55:
                    save_buttons.append(c)
        except (AttributeError, OSError, RuntimeError, ValueError):
            continue
    if not any(_same_prefilled_editor(url, expected_url) for url in urls):
        raise CalendarDraftError(
            "Calendar address bar does not exactly match the reviewed pre-filled event. Save blocked."
        )
    if len(title_matches) != 1:
        raise CalendarDraftError("Event title field does not match the reviewed title or is not readable")
    if len(save_buttons) != 1:
        raise CalendarDraftError("A unique visible Calendar Save button is unavailable; no Save attempted")
    if not windows.active_window() or windows.active_window().hwnd != active.hwnd:
        raise CalendarDraftError("Foreground Chrome window changed; no Save attempted")
    # This can submit the real event, so never retry if the click outcome is unknown.
    try:
        check_window(active, cancel)
        # URL + title cannot verify modified times/attendees. Require a live
        # local owner check of the complete visible editor before committing.
        import ctypes
        flags = 0x0001 | 0x0030 | 0x0100 | 0x00040000
        answer = ctypes.windll.user32.MessageBoxW(active.hwnd,
            "Review the exact event title, date, time, calendar account and attendees in Chrome. "
            "HUKM cannot independently verify all edited fields. OK authorizes one Save attempt; Cancel leaves the draft.",
            "HUKM Calendar — local review", flags)
        if answer != 1:
            raise CalendarDraftError("Owner cancelled final Calendar Save")
        check_window(active, cancel)
        if str(title_matches[0].GetValuePattern().Value or "") != args["title"]:
            raise CalendarDraftError("Calendar title changed after review")
        click_reviewed(active, save_buttons[0], cancel)
    except (CalendarDraftError, desktop_input.DesktopInputError):
        raise
    except Exception:
        return {"saveAttempted": "unknown", "eventCreatedVerified": False,
                "invitesSentVerified": False, "verified": False,
                "note": "Save may have been clicked before UIA errored. Check the Calendar manually; NEVER retry automatically."}
    # We cannot infer saved calendar event IDs from a toast or URL navigation,
    # so report attempt only. The owner can confirm in Calendar UI.
    return {"saveAttempted": True, "eventCreatedVerified": False,
            "invitesSentVerified": False, "verified": False,
            "note": "Clicked Calendar Save in a reviewed pre-filled editor. Event ID and invitations were NOT independently verified. Check the calendar; do not retry automatically."}
