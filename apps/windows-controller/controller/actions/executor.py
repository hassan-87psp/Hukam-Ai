"""Executes validated commands. Each handler returns a small JSON-able result or raises ActionError."""
from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Callable

from ..browser import web
from ..config import Config
from ..files import search as files
from ..screen import capture as screen
from ..security import validation as v
from ..system import apps, info, known_folders, launcher, windows
from ..whatsapp import adapter as wa

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
        seen = windows.wait_for_window(before, processes=apps.APP_PROCESSES.get(key), timeout=6)
        res = {"app": key, "label": apps.APP_LABELS.get(key, key), "launched": True, "target": Path(used).name if used else None}
        if seen == "unverifiable":
            res["windowDetected"] = None
        else:
            res["windowDetected"] = seen is not None
            if seen:
                res["windowTitle"] = seen.title
        return res

    def do_folder_open(self, a, _c):
        p = self.folder_path(a["folder"])
        before = windows.snapshot()
        launcher.open_path(p)
        seen = windows.wait_for_window(before, processes=["explorer.exe"], title_contains=p.name, timeout=4)
        return {"folder": a["folder"], "path": str(p), "windowDetected": None if seen == "unverifiable" else seen is not None}

    def do_folder_list(self, a, _c):
        p = self.folder_path(a["folder"])
        return {"folder": a["folder"], **files.list_folder(p, a["limit"])}

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
            launcher.open_path(p)
            return {"opened": True, "path": str(p), "name": p.name}
        r = self._search(a, cancel, 8)
        hits = r["results"]
        if not hits:
            raise ActionError("NOT_FOUND", "no matching file in your allowed folders")
        # Open directly only when the choice is unambiguous: one hit, or "latest" requested.
        if len(hits) == 1 or a.get("sort") == "latest":
            p = v.check_openable(Path(hits[0]["path"]), self.root_paths())
            launcher.open_path(p)
            return {"opened": True, "path": str(p), "name": p.name, "picked": "only match" if len(hits) == 1 else "most recent"}
        return {"opened": False, "ambiguous": True, "candidates": hits, "count": r["count"]}

    def do_file_reveal(self, a, _c):
        p = v.check_openable(Path(a["path"]), self.root_paths())
        launcher.reveal_in_explorer(p)
        return {"path": str(p), "folder": str(p.parent)}

    # -- browser --------------------------------------------------------
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

    # -- screen ---------------------------------------------------------
    def do_screen_capture(self, _a, _c):
        if not self.cfg.screen_capture:
            raise ActionError("NOT_ALLOWED", "screen capture is disabled in this laptop's controller config")
        shot = screen.capture()
        return {"width": shot["width"], "height": shot["height"], "bytes": shot["bytes"], "_screenshot": shot}

    # -- whatsapp -------------------------------------------------------
    def do_whatsapp_open(self, _a, _c):
        return wa.open_whatsapp(self.cfg.whatsapp_mode, self.cfg.browser)

    def do_whatsapp_check(self, _a, _c):
        if not launcher.IS_WINDOWS and not launcher.SIMULATE:
            raise ActionError("NOT_SUPPORTED", "WhatsApp check reads window titles and needs Windows")
        return wa.check(self.cfg.whatsapp_mode, self.cfg.browser)

    def do_whatsapp_compose(self, a, _c):
        return {"contact": a["contact"], **wa.compose(a["phone"], a["message"], self.cfg.whatsapp_mode, self.cfg.browser)}
