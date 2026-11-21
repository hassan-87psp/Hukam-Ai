"""Executes validated commands. Each handler returns a small JSON-able result or raises ActionError."""
from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Callable

from ..browser import web
from ..browser import operator as browser_operator
from ..browser import profiles as browser_profiles
from ..browser import calendar_draft, chatgpt, email_draft
from ..config import Config
from ..files import search as files
from ..screen import capture as screen
from ..screen import accessibility
from ..system import desktop_input
from ..security import validation as v
from ..system import apps, info, known_folders, launcher, windows, diagnostics, updater
from ..whatsapp import adapter as wa
from ..whatsapp import reader as wa_reader
from ..whatsapp import unread_senders as wa_senders
from ..whatsapp import desktop_ops as wa_desktop

log = logging.getLogger("hukm.exec")


class ActionError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class Outcome:
    def __init__(self, ok: bool, result: dict | None = None, error: dict | None = None, screenshot: dict | None = None, duration_ms: int = 0):
        self.ok, self.result, self.error, self.screenshot, self.duration_ms = ok, result or {}, error, screenshot, duration_ms

    def to_message(self, command_id: str) -> dict:
        m = {"type": "result", "commandId": command_id, "ok": self.ok, "result": self.result, "durationMs": self.duration_ms}
        if self.error:
            m["error"] = self.error
        if self.screenshot:
            m["screenshot"] = self.screenshot
        return m


class Executor:
    def __init__(self, cfg: Config, enabled_caps: Callable[[], list[str]]):
        self.cfg = cfg
        self.enabled_caps = enabled_caps

    # -- helpers --------------------------------------------------------
    def roots(self) -> list[tuple[str, Path]]:
        return known_folders.allowed_roots(self.cfg.allowed_folders, self.cfg.extra_allowed_dirs)

    def root_paths(self) -> list[Path]:
        return [p for _, p in self.roots()]

    def folder_path(self, key: str) -> Path:
        if key not in self.cfg.allowed_folders:
            raise ActionError("NOT_ALLOWED", f"the {key} folder is not in the controller's allowed folders")
        p = known_folders.resolve(key)
        if not p.is_dir():
            raise ActionError("NOT_FOUND", f"{key} folder does not exist at {p}")
        return p

    def search_roots(self, location: str | None) -> list[tuple[str, Path]]:
        if location:
            return [(location, self.folder_path(location))]
        return self.roots()

    # -- entry ----------------------------------------------------------
    def run(self, action: str, args: dict, cancel: threading.Event) -> Outcome:
        t0 = time.monotonic()
        try:
            # Futures queued behind a slow UIA operation can expire while
            # waiting for the single foreground worker. Never execute an
            # expired/cancelled instruction after it finally gets a worker.
            if cancel.is_set():
                raise ActionError("CANCELLED", "Command cancelled before laptop execution")
            cap = v.CAPABILITY_OF.get(action)
            if cap and cap not in self.cfg.capabilities:
                raise ActionError("CAPABILITY_DISABLED", f"'{cap}' is turned off in this laptop's controller config")
            if cap and cap not in self.enabled_caps():
                raise ActionError("CAPABILITY_DISABLED", f"'{cap}' is turned off for this device in the web app")
            clean = v.validate(action, args)
            handler = getattr(self, "do_" + action.replace(".", "_"))
            res = handler(clean, cancel)
            shot = res.pop("_screenshot", None) if isinstance(res, dict) else None
            return Outcome(True, res, screenshot=shot, duration_ms=int((time.monotonic() - t0) * 1000))
        except ActionError as e:
            return Outcome(False, error={"code": e.code, "message": e.message}, duration_ms=int((time.monotonic() - t0) * 1000))
        except v.ValidationError as e:
            return Outcome(False, error={"code": "NOT_ALLOWED", "message": str(e)}, duration_ms=int((time.monotonic() - t0) * 1000))
        except FileNotFoundError as e:
            return Outcome(False, error={"code": "NOT_FOUND", "message": f"not found: {e}"}, duration_ms=int((time.monotonic() - t0) * 1000))
        except launcher.LaunchError as e:
            return Outcome(False, error={"code": "LAUNCH_FAILED", "message": str(e)}, duration_ms=int((time.monotonic() - t0) * 1000))
        except Exception as e:  # noqa: BLE001 — report, never crash the controller
            log.warning("action %s failed: %s: %s", action, type(e).__name__, e)
            log.debug("traceback", exc_info=True)
            return Outcome(False, error={"code": "FAILED", "message": f"{type(e).__name__}: {e}"[:300]}, duration_ms=int((time.monotonic() - t0) * 1000))

    # -- system ---------------------------------------------------------
    def do_app_open(self, a, _c):
        key = a["app"]
        if key not in self.cfg.apps or key not in apps.APP_CANDIDATES:
            raise ActionError("NOT_ALLOWED", f"{key} is not in this laptop's application allowlist")
        before = windows.snapshot()
        used = launcher.start_program(apps.APP_CANDIDATES[key])
        processes = apps.APP_PROCESSES.get(key) or []
        seen = windows.wait_for_window(before, processes=processes, timeout=4)
        res = {"app": key, "label": apps.APP_LABELS.get(key, key), "launched": True, "target": Path(used).name if used else None}
        if seen == "unverifiable":
            res["windowDetected"] = None
            res["foreground"] = None
        else:
            focused = windows.focus_by_process(processes) if processes else None
            if focused is None and seen is not None and windows.bring_to_front(seen):
                focused = seen
            res["windowDetected"] = seen is not None or focused is not None
            res["foreground"] = focused is not None
            if focused or seen:
                res["windowTitle"] = (focused or seen).title
        return res

    def do_controller_update(self, _a, cancel):
        if cancel.is_set():
            raise ActionError("CANCELLED", "Update cancelled before laptop execution")
        try:
            return updater.update_from_website(cancel=cancel)
        except updater.UpdateCancelled as exc:
            raise ActionError("CANCELLED", str(exc)) from exc
        except updater.UpdateError as exc:
            raise ActionError("UPDATE_UNAVAILABLE", str(exc)) from exc

    def do_app_close(self, a, cancel):
        if cancel.is_set():
            raise ActionError("CANCELLED", "Notepad close cancelled")
        if a.get("app") != "notepad":
            raise ActionError("NOT_ALLOWED", "Only verified Notepad close is supported")
        if launcher.SIMULATE:
            launcher._record("app.close", "notepad")
            return {"app": "notepad", "windowClosed": True,
                    "verified": True, "simulated": True}
        try:
            return windows.close_notepad_window()
        except FileNotFoundError as exc:
            raise ActionError("NOT_FOUND", str(exc)) from exc
        except RuntimeError as exc:
            raise ActionError("CLOSE_NOT_SAFE", str(exc)) from exc

    def do_folder_open(self, a, _c):
        p = self.folder_path(a["folder"])
        before = windows.snapshot()
        launcher.open_path(p)
        seen = windows.wait_for_window(before, processes=["explorer.exe"], title_contains=p.name, timeout=3)
        focused = windows.focus_by_process(["explorer.exe"], title_contains=p.name) if seen != "unverifiable" else None
        return {
            "folder": a["folder"], "path": str(p),
            "windowDetected": None if seen == "unverifiable" else (seen is not None or focused is not None),
            "foreground": None if seen == "unverifiable" else focused is not None,
        }

    def do_folder_list(self, a, cancel):
        p = self.folder_path(a["folder"])
        result = files.list_folder(p, a["limit"], cancel=cancel)
        if result.get("cancelled"):
            raise ActionError("CANCELLED", "Folder listing cancelled")
        return {"folder": a["folder"], **result}

    def do_device_status(self, _a, _c):
        return info.device_status()

    def do_apps_list(self, _a, _c):
        wins = windows.list_windows()
        if not wins and not launcher.IS_WINDOWS:
            raise ActionError("NOT_SUPPORTED", "listing windows is only available on Windows")
        grouped: dict[str, dict] = {}
        for w in wins:
            g = grouped.setdefault(w.process or "unknown", {"process": w.process, "windows": []})
            g["windows"].append(w.title[:120])
        items = sorted(grouped.values(), key=lambda g: g["process"].lower())
        return {"count": len(items), "apps": items, "windowCount": len(wins)}

    def do_window_active(self, _a, _c):
        w = windows.active_window()
        if not w:
            raise ActionError("NOT_SUPPORTED", "active window is only available on Windows")
        return w.as_dict()

    def do_window_focus(self, a, _c):
        w = windows.focus_window(a["title"])
        if not w:
            raise ActionError("NOT_FOUND", f"no open window matching '{a['title']}'")
        return w.as_dict()

    def do_system_lock(self, _a, _c):
        if launcher.SIMULATE:
            launcher._record("lock", "workstation")
        else:
            windows.lock_workstation()
        return {"locked": True}

    # -- files ----------------------------------------------------------
    def _search(self, a, cancel, limit):
        return files.search(
            self.search_roots(a.get("location")), a.get("query", ""), a.get("ext"), a.get("sort", "relevance"), limit,
            max_depth=self.cfg.search_max_depth, max_entries=self.cfg.search_max_entries,
            time_budget_s=self.cfg.search_time_budget_s, cancel=cancel,
        )

    def do_file_search(self, a, cancel):
        r = self._search(a, cancel, a.get("limit", 30))
        if r.get("cancelled"):
            raise ActionError("CANCELLED", "search was cancelled")
        r["searched"] = [str(p) for _, p in self.search_roots(a.get("location"))]
        return r

    def do_file_open(self, a, cancel):
        if "path" in a:
            p = v.check_openable(Path(a["path"]), self.root_paths())
            if cancel.is_set():
                raise ActionError("CANCELLED", "File open cancelled")
            launcher.open_path(p)
            return {"opened": True, "path": str(p), "name": p.name}
        r = self._search(a, cancel, 8)
        if r.get("cancelled") or cancel.is_set():
            raise ActionError("CANCELLED", "File search cancelled")
        hits = r["results"]
        if r.get("truncated"):
            return {"opened": False, "ambiguous": bool(hits), "truncated": True,
                    "candidates": hits, "count": r["count"],
                    "note": "Search incomplete. Choose an exact file or narrow the folder; latest or unique match is not verified."}
        if not hits:
            raise ActionError("NOT_FOUND", "no matching file in your allowed folders")
        # Open directly only when the choice is unambiguous: one hit, or "latest" requested.
        if r["count"] == 1 or a.get("sort") == "latest":
            p = v.check_openable(Path(hits[0]["path"]), self.root_paths())
            if cancel.is_set():
                raise ActionError("CANCELLED", "File open cancelled")
            launcher.open_path(p)
            return {"opened": True, "path": str(p), "name": p.name, "picked": "only match" if len(hits) == 1 else "most recent"}
        return {"opened": False, "ambiguous": True, "candidates": hits, "count": r["count"]}

    def do_file_reveal(self, a, _c):
        p = v.check_openable(Path(a["path"]), self.root_paths())
        launcher.reveal_in_explorer(p)
        return {"path": str(p), "folder": str(p.parent)}

    # -- browser --------------------------------------------------------
    def do_browser_profile_open(self, a, _c):
        try:
            return browser_profiles.open_in_profile(a["url"],a["profile"])
        except browser_profiles.ProfileError as exc:
            raise ActionError("PROFILE_UNAVAILABLE",str(exc)) from exc

    def do_notepad_type(self, a, _c):
        if launcher.SIMULATE:
            launcher._record("notepad.type", "text (redacted)")
            return {"inputDelivered": True, "verified": False, "simulated": True}
        from ..system import windows
        active = windows.active_window()
        if not active or active.process.casefold() != "notepad.exe" or "notepad" not in active.title.casefold():
            raise ActionError("NOT_ALLOWED", "Open Notepad and bring its editing window to the foreground")
        try:
            import win32gui
            if not win32gui.IsWindowVisible(active.hwnd) or win32gui.IsIconic(active.hwnd):
                raise ActionError("NOT_ALLOWED", "Notepad window is not visible")
            browser_operator._send_unicode(a["text"])
        except RuntimeError as exc:
            raise ActionError("INPUT_FAILED", str(exc)) from exc
        return {"app": "notepad", "inputDelivered": True, "verified": False,
                "note": "Text delivered to Notepad. Document content is not independently verified."}

    def do_browser_control(self, a, cancel):
        try:
            return browser_operator.control(a, cancel)
        except RuntimeError as exc:
            raise ActionError("NOT_ALLOWED", str(exc)) from exc

    def do_web_open(self, a, _c):
        used = launcher.open_url(a["url"], self.cfg.browser)
        return {"url": a["url"], "browser": used}

    def do_web_search(self, a, _c):
        url = web.web_search_url(a["query"])
        used = launcher.open_url(url, self.cfg.browser)
        return {"query": a["query"], "url": url, "browser": used}

    def do_youtube_search(self, a, _c):
        url = web.youtube_search_url(a["query"])
        launcher.open_url(url, self.cfg.browser)
        return {"query": a["query"], "url": url, "mode": "search"}

    def do_youtube_play(self, a, _c):
        top = web.resolve_top_video(a["query"])
        if top:
            vid, title = top
            url = web.youtube_watch_url(vid)
            launcher.open_url(url, self.cfg.browser)
            return {"query": a["query"], "mode": "video", "videoId": vid, "title": title, "url": url,
                    "note": "Opened the top search result. Autoplay depends on the browser's autoplay policy."}
        url = web.youtube_search_url(a["query"])
        launcher.open_url(url, self.cfg.browser)
        return {"query": a["query"], "mode": "search", "url": url,
                "note": "Could not determine a reliable top video, so the search results were opened instead."}

    def do_diagnostics_probe(self, _a, _c):
        return diagnostics.probe(self.cfg)

    # -- approved screen and browser observation ------------------------
    def do_ui_scroll(self, a, cancel):
        if cancel.is_set():
            raise ActionError("CANCELLED", "Scroll cancelled")
        try:
            return accessibility.scroll_active(a["steps"], cancel=cancel)
        except accessibility.AccessibilityError as exc:
            raise ActionError("ACCESSIBILITY_UNAVAILABLE", str(exc)) from exc

    def do_ui_inspect(self, _a, _c):
        try:
            return accessibility.inspect()
        except accessibility.AccessibilityError as exc:
            raise ActionError("ACCESSIBILITY_UNAVAILABLE", str(exc)) from exc

    def do_ui_activate(self, a, cancel):
        if cancel.is_set():
            raise ActionError("CANCELLED", "Action cancelled before click")
        try:
            return accessibility.activate(a["label"])
        except accessibility.AccessibilityError as exc:
            raise ActionError("ACCESSIBILITY_UNAVAILABLE", str(exc)) from exc

    def do_ui_activate_observed(self, a, cancel):
        if cancel.is_set():
            raise ActionError("CANCELLED", "Inspected button click cancelled")
        try:
            return accessibility.activate_observed(a["label"], a["role"], a["snapshot"], cancel=cancel)
        except accessibility.AccessibilityError as exc:
            raise ActionError("WINDOW_CHANGED", str(exc)) from exc

    def do_desktop_control(self, a, cancel):
        if cancel.is_set():
            raise ActionError("CANCELLED", "Desktop input cancelled before execution")
        try:
            return desktop_input.control(a, cancel=cancel)
        except desktop_input.DesktopInputError as exc:
            raise ActionError("DESKTOP_INPUT_REFUSED", str(exc)) from exc
        except RuntimeError as exc:
            raise ActionError("DESKTOP_INPUT_REFUSED", str(exc)) from exc

    def do_email_inbox_open(self, a, cancel):
        if cancel.is_set():
            raise ActionError("CANCELLED", "Email inbox opening cancelled")
        try:
            return email_draft.open_inbox(a)
        except email_draft.EmailDraftError as exc:
            raise ActionError("EMAIL_INBOX_FAILED", str(exc)) from exc

    def do_email_compose_draft(self, a, cancel):
        if cancel.is_set():
            raise ActionError("CANCELLED", "Email drafting cancelled")
        try:
            return email_draft.open_compose(a)
        except email_draft.EmailDraftError as exc:
            raise ActionError("EMAIL_DRAFT_FAILED", str(exc)) from exc

    def do_calendar_event_draft(self, a, cancel):
        if cancel.is_set():
            raise ActionError("CANCELLED", "Calendar draft cancelled")
        try:
            return calendar_draft.open_event_draft(a)
        except calendar_draft.CalendarDraftError as exc:
            raise ActionError("CALENDAR_DRAFT_FAILED", str(exc)) from exc

    def do_calendar_save_reviewed(self, a, cancel):
        if cancel.is_set():
            raise ActionError("CANCELLED", "Calendar Save cancelled before execution")
        try:
            return calendar_draft.save_reviewed(a, cancel)
        except calendar_draft.CalendarDraftError as exc:
            raise ActionError("CALENDAR_SAVE_NOT_SAFE", str(exc)) from exc

    def do_chatgpt_prompt_draft(self, a, cancel):
        if cancel.is_set():
            raise ActionError("CANCELLED", "ChatGPT draft cancelled")
        try:
            return chatgpt.draft_prompt(a["projectUrl"], a["prompt"], cancel)
        except chatgpt.ChatGPTError as exc:
            raise ActionError("CHATGPT_UI_UNAVAILABLE", str(exc)) from exc

    def do_chatgpt_submit_prompt(self, a, cancel):
        if cancel.is_set():
            raise ActionError("CANCELLED", "ChatGPT submit cancelled")
        try:
            return chatgpt.submit_prompt(a["projectUrl"], a["prompt"], cancel)
        except chatgpt.ChatGPTError as exc:
            raise ActionError("CHATGPT_UI_UNAVAILABLE", str(exc)) from exc

    def do_chatgpt_download_visible(self, a, cancel):
        if cancel.is_set():
            raise ActionError("CANCELLED", "ChatGPT download cancelled")
        p = self.folder_path("downloads")
        try:
            if "assetFolder" in a:
                from ..browser.project_asset import checked_directory, copy_reviewed_candidate
                target = checked_directory(Path(a["assetFolder"]), self.root_paths())
            else:
                target = None
            result = chatgpt.download_visible(a["projectUrl"], p, cancel)
            candidate_mtime = result.pop("_candidateMtimeNs", None)
            if target is not None and not result.get("simulated"):
                result.update(copy_reviewed_candidate(
                    p, target, self.root_paths(), result.get("fileName"),
                    result.get("sizeBytes"), candidate_mtime, cancel))
            return result
        except chatgpt.ChatGPTError as exc:
            raise ActionError("CHATGPT_UI_UNAVAILABLE", str(exc)) from exc

    # -- screen ---------------------------------------------------------
    def do_screen_capture(self, a, cancel):
        if not self.cfg.screen_capture:
            raise ActionError("NOT_ALLOWED", "screen capture is disabled in this laptop's controller config")
        shot = screen.capture(monitor=a.get("monitor", 1), cancel=cancel)
        return {**{k: shot[k] for k in ("width", "height", "bytes", "monitor", "monitorCount", "sourceBounds", "simulated")},
                "_screenshot": shot}

    # -- whatsapp -------------------------------------------------------
    def do_whatsapp_open(self, a, _c):
        # Personal Desktop is the default regardless of an old saved Web preference.
        # An explicit "WhatsApp Web" instruction carries mode="web".
        return wa.open_whatsapp(a.get("mode", "desktop"), self.cfg.browser)

    def do_whatsapp_check(self, a, _c):
        if not launcher.IS_WINDOWS and not launcher.SIMULATE:
            raise ActionError("NOT_SUPPORTED", "WhatsApp check reads window titles and needs Windows")
        result = wa.check(a.get("mode", "desktop"), self.cfg.browser)
        if result.get("unreadChats") is None:
            raise ActionError("UNVERIFIABLE", result.get(
                "note", "WhatsApp unread count is unknown, not zero."))
        # A counted unread chat must come from an explicit Desktop badge/title.
        if result.get("source") not in ("WhatsApp Desktop Unread filter", "window title"):
            raise ActionError("UNVERIFIABLE", "WhatsApp unread indicator was not verified")
        return result

    def do_whatsapp_unread_senders(self, _a, cancel):
        if cancel.is_set():
            raise ActionError("CANCELLED", "WhatsApp unread scan cancelled before execution")
        try:
            return wa_senders.read_unread_senders(cancel)
        except wa_senders.UnreadSendersUnavailable as e:
            raise ActionError("UNVERIFIABLE", str(e)) from e

    def do_whatsapp_select_chat(self, a, cancel):
        if cancel.is_set():
            raise ActionError("CANCELLED", "WhatsApp chat selection cancelled")
        try:
            return wa_desktop.select_chat(a["contact"], cancel)
        except wa_desktop.DesktopWhatsAppError as exc:
            raise ActionError("WHATSAPP_UI_UNAVAILABLE", str(exc)) from exc

    def do_whatsapp_read_selected(self, a, cancel):
        if cancel.is_set():
            raise ActionError("CANCELLED", "Reading cancelled")
        try:
            return wa_desktop.read_selected(a.get("contact"), cancel)
        except wa_desktop.DesktopWhatsAppError as exc:
            raise ActionError("WHATSAPP_UI_UNAVAILABLE", str(exc)) from exc

    def do_whatsapp_draft_reply(self, a, cancel):
        if cancel.is_set():
            raise ActionError("CANCELLED", "Draft cancelled")
        try:
            return wa_desktop.draft_reply(a["contact"], a["message"], cancel)
        except wa_desktop.DesktopWhatsAppError as exc:
            raise ActionError("WHATSAPP_UI_UNAVAILABLE", str(exc)) from exc

    def do_whatsapp_send_reviewed(self, a, cancel):
        if cancel.is_set():
            raise ActionError("CANCELLED", "WhatsApp Send cancelled before execution")
        try:
            return wa_desktop.send_reviewed(a["contact"], a["message"], cancel)
        except wa_desktop.DesktopWhatsAppError as exc:
            raise ActionError("WHATSAPP_SEND_NOT_SAFE", str(exc)) from exc

    def do_whatsapp_attach_preview(self, a, cancel):
        if cancel.is_set():
            raise ActionError("CANCELLED", "Attachment cancelled")
        path = v.check_openable(Path(a["path"]), self.root_paths())
        allowed = {".png", ".jpg", ".jpeg", ".webp", ".pdf", ".docx",
                   ".xlsx", ".pptx", ".txt", ".csv", ".mp4", ".zip"}
        if not path.is_file() or path.suffix.casefold() not in allowed:
            raise ActionError("NOT_ALLOWED", "Only a supported file inside allowed local folders can be attached")
        try:
            return wa_desktop.attach_preview(a["contact"], str(path), cancel)
        except wa_desktop.DesktopWhatsAppError as exc:
            raise ActionError("WHATSAPP_UI_UNAVAILABLE", str(exc)) from exc

    def do_whatsapp_send_attachment_reviewed(self, a, cancel):
        if cancel.is_set():
            raise ActionError("CANCELLED", "Attachment Send cancelled before execution")
        path = v.check_openable(Path(a["path"]), self.root_paths())
        if not path.is_file():
            raise ActionError("NOT_ALLOWED", "Attachment no longer exists in allowed folders")
        try:
            return wa_desktop.send_attachment_reviewed(a["contact"], str(path), cancel)
        except wa_desktop.DesktopWhatsAppError as exc:
            raise ActionError("WHATSAPP_SEND_NOT_SAFE", str(exc)) from exc

    def do_whatsapp_compose(self, a, cancel):
        """One owner-approved draft in the installed Personal WhatsApp Desktop.

        Never follow an HTTPS/web.whatsapp.com fallback, even when a stale
        configuration says whatsapp_mode=web. Does NOT press Send.
        """
        if cancel.is_set():
            raise ActionError("CANCELLED", "WhatsApp draft cancelled")
        try:
            opened = wa.open_whatsapp("desktop", self.cfg.browser)
            if not launcher.SIMULATE and opened.get("verified") is not True:
                raise ActionError("WHATSAPP_DESKTOP_UNAVAILABLE",
                    opened.get("note", "Personal WhatsApp Desktop could not be focused"))
            selected = wa_desktop.select_chat(a["contact"], cancel)
            if cancel.is_set():
                raise ActionError("CANCELLED", "WhatsApp draft cancelled before typing")
            drafted = wa_desktop.draft_reply(a["contact"], a["message"], cancel)
            return {"contact": a["contact"], "via": "desktop", "sent": False,
                    "recipientVerified": selected.get("recipientVerified", False),
                    **drafted}
        except wa_desktop.DesktopWhatsAppError as exc:
            raise ActionError("WHATSAPP_UI_UNAVAILABLE", str(exc)) from exc

    def do_whatsapp_read_visible(self, _a, _c):
        try:
            return wa_reader.read_visible_aloud()
        except wa_reader.ReadError as e:
            raise ActionError("NOT_SUPPORTED", str(e)) from e
