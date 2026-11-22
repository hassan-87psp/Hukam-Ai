"""Owner-approved Windows UI Automation inspection and label-based interaction.

No screenshots or message bodies are sent to Gemini. Inspection returns a bounded
list of interactive control labels from the foreground window only. Controls are
never searched in hidden/background apps; no OCR or computer-wide scraping.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
import unicodedata

from ..config import IS_WINDOWS
from ..system import launcher, windows

PROCESSES = {
    "chrome.exe", "msedge.exe", "firefox.exe",
    "whatsapp.exe", "whatsappdesktop.exe", "msedgewebview2.exe",
    "applicationframehost.exe", "notepad.exe", "explorer.exe",
}
ROLES = {"ButtonControl", "TabItemControl", "HyperlinkControl", "MenuItemControl",
         "CheckBoxControl", "RadioButtonControl", "ComboBoxControl"}
# Mutating controls are deliberately excluded from generic label clicks.
# Generic UIA activation is a low-impact navigation primitive, not a way to
# circumvent specific reviewed WhatsApp, Calendar, email or payment workflows.
# Reject dangerous verbs *anywhere* in a label (including after emoji/prefixes).
# We intentionally fail closed on ambiguous labels like "Next: Pay".
RISKY_WORDS = frozenset({
    "send", "sending", "delete", "remove", "pay", "payment", "purchase",
    "buy", "checkout", "submit", "confirm", "approve", "authorize",
    "publish", "share", "transfer", "withdraw", "deposit", "invite",
    "report", "block", "unblock", "call", "join", "upload", "install",
    "execute", "run", "post", "book", "order", "save", "accept", "apply",
    "logout", "signin", "signout", "login", "erase", "clear", "reset",
})
RISKY_PHRASES = (
    "log out", "sign out", "sign in", "place order", "check out",
    "video call", "voice call", "add payment", "make payment",
)
# Native WhatsApp and generic UWP/WebView containers need their own dedicated
# recipient/preview verification, never a generic automatic button click.
CLICK_PROCESSES = frozenset({
    "chrome.exe", "msedge.exe", "firefox.exe", "notepad.exe", "explorer.exe",
})


def safe_control_label(label: str) -> bool:
    cleaned = clean_label(label)
    if not cleaned:
        return False
    normalized = unicodedata.normalize("NFKC", cleaned).casefold()
    words = re.findall(r"\w+", normalized)
    if any(word in RISKY_WORDS for word in words):
        return False
    padded = " " + " ".join(words) + " "
    return not any(" " + phrase + " " in padded for phrase in RISKY_PHRASES)


def window_snapshot(active, controls: list[tuple[str, str]]) -> str:
    """Pure window+visible-control fingerprint for short-lived reviewed clicks."""
    data = {
        "hwnd": active.hwnd, "pid": active.pid,
        "process": active.process.casefold(), "title": active.title[:100],
        "controls": sorted((role, label.casefold()) for role, label in controls),
    }
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


class AccessibilityError(Exception):
    pass


# A snapshot is usable once, only within 90 seconds of a fresh foreground
# inspection on this controller process. Old approvals cannot replay clicks
# after a future reconnect, another window inspection or a long pause.
_OBSERVED: tuple[str, float] | None = None
OBSERVATION_TTL_S = 90.0


def _remember_observation(token: str) -> None:
    global _OBSERVED
    _OBSERVED = (token, time.monotonic())


def _consume_observation(token: str) -> None:
    global _OBSERVED
    observed = _OBSERVED
    _OBSERVED = None  # consume before attempting a click; no blind retry
    if (observed is None or observed[0] != token or
            time.monotonic() - observed[1] > OBSERVATION_TTL_S):
        raise AccessibilityError("The inspection expired or was already used; inspect again")


def clean_label(label: object) -> str:
    if not isinstance(label, str):
        return ""
    value = " ".join(label.strip().split())
    if not value or len(value) > 100:
        return ""
    if any(ord(c) < 32 for c in value):
        return ""
    return value


def inspect_controls(controls: list[tuple[str, str]]) -> list[dict]:
    """Pure testable filter; never includes text field content or message previews."""
    result = []
    seen = set()
    for role, name in controls:
        label = clean_label(name)
        if role not in ROLES or not label:
            continue
        key = (role, label.casefold())
        if key in seen:
            continue
        seen.add(key)
        result.append({"role": role, "label": label})
        if len(result) >= 60:
            break
    return result


def _active():
    if not IS_WINDOWS:
        raise AccessibilityError("Windows UI Automation needs an interactive Windows desktop")
    active = windows.active_window()
    if not active or active.process.casefold() not in PROCESSES:
        raise AccessibilityError("Focus an allowed browser, WhatsApp, Notepad or Explorer window")
    import win32gui
    if not win32gui.IsWindowVisible(active.hwnd) or win32gui.IsIconic(active.hwnd):
        raise AccessibilityError("The target window must be visible and restored")
    return active


def _visible_controls(root, max_nodes=850):
    import uiautomation as auto
    controls = []
    for index, (control, _depth) in enumerate(auto.WalkControl(root, maxDepth=12)):
        if index >= max_nodes:
            break
        try:
            if control.IsOffscreen or control.ControlTypeName not in ROLES:
                continue
            label = clean_label(control.Name)
            if label:
                controls.append((control, control.ControlTypeName, label))
        except (AttributeError, OSError, RuntimeError, ValueError):
            continue
    return controls


def inspect() -> dict:
    if launcher.SIMULATE:
        active = windows.WindowInfo(100, "Test Chrome", "chrome.exe", 1000)
        labels = [("ButtonControl", "Search"), ("ButtonControl", "🗑 Delete account")]
        token = window_snapshot(active, labels)
        _remember_observation(token)
        return {
            "window": active.title, "process": active.process,
            "snapshot": token,
            "controls": [{**x, "canActivate": safe_control_label(x["label"])}
                         for x in inspect_controls(labels)],
            "visibleOnly": True, "contentRead": False, "verified": True,
            "simulated": True,
        }
    active = _active()
    try:
        import uiautomation as auto
        import win32gui
        root = auto.ControlFromHandle(active.hwnd)
        labels = [(role, label) for _, role, label in _visible_controls(root)]
        if win32gui.GetForegroundWindow() != active.hwnd:
            raise AccessibilityError("Foreground window changed during inspection")
        allowed = active.process.casefold() in CLICK_PROCESSES
        token = window_snapshot(active, labels)
        _remember_observation(token)
        return {
            "window": active.title[:100], "process": active.process,
            "snapshot": token,
            "controls": [{**x, "canActivate": allowed and safe_control_label(x["label"])}
                         for x in inspect_controls(labels)],
            "visibleOnly": True, "contentRead": False, "verified": True,
            "note": "Only foreground interactive control labels, not text fields or chat message contents. Use the snapshot-bound control action for reviewed clicks.",
        }
    except AccessibilityError:
        raise
    except Exception as exc:
        raise AccessibilityError("Could not inspect interactive controls on this window") from exc


def activate(label: str) -> dict:
    # Legacy label-only activation is disabled in the v1.6.8 protocol.
    # Without a fresh observed-window fingerprint, a model could guess
    # a label on a different app than the one the owner inspected.
    raise AccessibilityError("Inspect the visible controls and use a snapshot-bound action")


def activate_observed(label: str, role: str, snapshot: str, cancel=None) -> dict:
    if cancel is not None and cancel.is_set():
        raise AccessibilityError("Click cancelled")
    if role not in ROLES or not safe_control_label(label):
        raise AccessibilityError("Sensitive or unsupported button requires a dedicated workflow")
    if launcher.SIMULATE:
        active = windows.WindowInfo(100, "Test Chrome", "chrome.exe", 1000)
        labels = [("ButtonControl", "Search"), ("ButtonControl", "🗑 Delete account")]
        if snapshot != window_snapshot(active, labels) or (role, label) not in labels:
            raise AccessibilityError("The observed window or button has changed; inspect again")
        _consume_observation(snapshot)
        launcher._record("ui.activate_observed", "label (redacted)")
        return {"inputDelivered": True, "verified": False, "simulated": True}
    active = _active()
    if active.process.casefold() not in CLICK_PROCESSES:
        raise AccessibilityError("Generic clicks are disabled for WhatsApp, system and WebView windows")
    try:
        import uiautomation as auto
        import win32gui
        root = auto.ControlFromHandle(active.hwnd)
        controls = _visible_controls(root)
        labels = [(control_role, control_label) for _, control_role, control_label in controls]
        if window_snapshot(active, labels) != snapshot:
            raise AccessibilityError("The visible window or controls changed; inspect again")
        matches = [ctrl for ctrl, observed_role, name in controls
                   if observed_role == role and name.casefold() == label.casefold()]
        if len(matches) != 1:
            raise AccessibilityError("The exact control is missing or ambiguous; inspect again")
        fresh = windows.active_window()
        if (not fresh or fresh.hwnd != active.hwnd or fresh.pid != active.pid
                or win32gui.GetForegroundWindow() != active.hwnd):
            raise AccessibilityError("Foreground window changed; no click performed")
        control = matches[0]
        if control.IsOffscreen or not control.IsEnabled:
            raise AccessibilityError("Target control is no longer visible or enabled")
        rect = control.BoundingRectangle
        left, top, right, bottom = rect.left, rect.top, rect.right, rect.bottom
        if right <= left or bottom <= top:
            raise AccessibilityError("Target has no visible bounds")
        point = ((left + right)//2, (top + bottom)//2)
        from ..system import desktop_input
        client = desktop_input._client_rect(active.hwnd)
        if not desktop_input.inside_client(point, client):
            raise AccessibilityError("Target is outside the foreground client")
        hit = win32gui.WindowFromPoint(point)
        if not hit or win32gui.GetAncestor(hit, 2) != active.hwnd:
            raise AccessibilityError("Target control is obscured")
        if cancel is not None and cancel.is_set():
            raise AccessibilityError("Click cancelled")
        if win32gui.GetForegroundWindow() != active.hwnd:
            raise AccessibilityError("Foreground changed before click")
        _consume_observation(snapshot)
        # Revalidate the selected original HWND, bounds and pointer immediately
        # before input. Do not resolve a NEW foreground window here.
        import win32api
        import win32con
        desktop_input._check_pointer(active.hwnd, point, client, cancel)
        win32api.SetCursorPos(point)
        desktop_input._check_pointer(active.hwnd, point, client, cancel)
        if win32api.GetCursorPos() != point:
            raise AccessibilityError("Mouse position changed before click")
        win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        return {
            "inputDelivered": True, "verified": False,
            "role": role, "label": label,
            "note": "The inspected control received a click in the same window. Final app or website outcome remains unverified.",
        }
    except AccessibilityError:
        raise
    except Exception as exc:
        raise AccessibilityError("UI Automation could not activate the inspected control") from exc



def verified_control_count(controls, role: str, label: str) -> int:
    """Count exact foreground UIA controls, not deduplicated display labels."""
    return sum(1 for _control, found_role, found_label in controls
               if found_role == role and found_label.casefold() == label.casefold())


def navigate_verified(args: dict, cancel=None) -> dict:
    """One approved local observe -> click -> verify navigation attempt.

    The owner approves the exact app/process and visible target. HUKM locates
    that control locally, rechecks its foreground snapshot, clicks it once,
    and only reports success if a NEW uniquely identified expected control
    appears in the SAME native window. No screenshots, coordinates or private
    UI text are sent to the model. Irreversible controls remain blocked.
    """
    if cancel is not None and cancel.is_set():
        raise AccessibilityError("Navigation cancelled before any input")
    label, role, process = args["label"], args["role"], args["process"]
    expect_label, expect_role = args.get("expectLabel"), args.get("expectRole")
    if process not in CLICK_PROCESSES or role not in ROLES or not safe_control_label(label):
        raise AccessibilityError("Only an exact safe navigation control is allowed")
    if expect_label is not None and (
            expect_role not in ROLES or not safe_control_label(expect_label)):
        raise AccessibilityError("Expected control is not safe or supported")

    before = inspect()  # fresh local foreground inspection creates a single-use token
    if before.get("process", "").casefold() != process:
        raise AccessibilityError("Foreground application differs from the approved process")
    candidates = [x for x in before.get("controls", [])
                  if x.get("label", "").casefold() == label.casefold()
                  and x.get("role") == role and x.get("canActivate") is True]
    if len(candidates) != 1:
        raise AccessibilityError("Approved control not uniquely visible; no click performed")
    if expect_label and any(x.get("role") == expect_role and
                            x.get("label", "").casefold() == expect_label.casefold()
                            for x in before.get("controls", [])):
        raise AccessibilityError(
            "Expected control was already present before navigation; cannot prove a new outcome")

    native_before = None if launcher.SIMULATE else _active()
    clicked = activate_observed(label, role, before["snapshot"], cancel=cancel)
    if not clicked.get("inputDelivered"):
        raise AccessibilityError("Navigation click was not verified as delivered")
    base = {
        "inputDelivered": True, "navigationVerified": False, "verified": False,
        "process": process, "targetRole": role, "targetLabel": label,
        "expectedRole": expect_role, "expectedLabel": expect_label,
    }
    if launcher.SIMULATE:
        return {**base, "simulated": True,
                "note": "Simulated navigation only; no real screen state checked"}
    if not expect_label:
        return {**base, "note":
                "Safe control clicked once. No expected UI evidence was specified; outcome unverified."}

    # Never click a second time after a possible state change. UIA polling is
    # read-only, short and bounded. Changed app/window or ambiguous controls
    # are unverified, NOT failures to automatically retry.
    import uiautomation as auto
    import win32gui
    reason = "Expected control not visible after the one approved click"
    for _ in range(6):
        if cancel is not None and cancel.is_set():
            reason = "Verification cancelled after click; do not retry automatically"
            break
        time.sleep(0.35)
        try:
            active = _active()
            if (active.hwnd != native_before.hwnd or
                    active.pid != native_before.pid or
                    active.process.casefold() != process or
                    win32gui.GetForegroundWindow() != native_before.hwnd):
                reason = "Foreground window changed after click; outcome not established"
                break
            root = auto.ControlFromHandle(active.hwnd)
            visible = _visible_controls(root, max_nodes=850)
            if win32gui.GetForegroundWindow() != native_before.hwnd:
                reason = "Foreground changed during verification"
                break
            matches = verified_control_count(visible, expect_role, expect_label)
            if matches == 1:
                return {**base, "navigationVerified": True, "verified": True,
                        "evidence": "new_unique_visible_control",
                        "note": "The expected control became visible in the same verified window. This verifies navigation only, not external delivery."}
            if matches > 1:
                reason = "Expected UI control is ambiguous after click"
                break
        except (AccessibilityError, OSError, RuntimeError):
            # UIA can temporarily detach during browser/WebView navigation.
            # Keep observing without any further click.
            reason = "Expected UI control could not be independently read"
        except Exception:
            reason = "UIA verification unavailable; action may have occurred"
    return {**base, "note": reason + ". Check the laptop before retrying."}

def scroll_active(steps: int, cancel=None) -> dict:
    """Bounded mouse-wheel input to the active allowlisted Windows app.

    Does not use a screen coordinate supplied by the model; the local
    Controller computes the center of the actual foreground window.
    """
    if cancel is not None and cancel.is_set():
        raise AccessibilityError("Scroll cancelled")
    if not isinstance(steps, int) or isinstance(steps, bool) or steps == 0 or abs(steps) > 5:
        raise AccessibilityError("scroll must be an integer from -5 to 5, excluding zero")
    if launcher.SIMULATE:
        launcher._record("ui.scroll", "wheel")
        return {"inputDelivered": True, "verified": False, "steps": steps, "simulated": True}
    active = _active()
    try:
        import win32api
        import win32con
        import win32gui
        left, top, right, bottom = win32gui.GetWindowRect(active.hwnd)
        if right - left < 240 or bottom - top < 180:
            raise AccessibilityError("Foreground application window is too small to scroll")
        if win32gui.GetForegroundWindow() != active.hwnd:
            raise AccessibilityError("Foreground window changed before scrolling")
        center = (int((left + right) / 2), int((top + bottom) / 2))
        hit = win32gui.WindowFromPoint(center)
        if not hit or win32gui.GetAncestor(hit, 2) != active.hwnd:
            raise AccessibilityError("Scroll target is obscured")
        win32api.SetCursorPos(center)
        hit = win32gui.WindowFromPoint(center)
        if (win32api.GetCursorPos() != center or not hit or
                win32gui.GetAncestor(hit, 2) != active.hwnd or
                win32gui.GetForegroundWindow() != active.hwnd or
                win32gui.GetWindowRect(active.hwnd) != (left, top, right, bottom) or
                (cancel is not None and cancel.is_set())):
            raise AccessibilityError("Scroll target changed or cancelled")
        win32api.mouse_event(win32con.MOUSEEVENTF_WHEEL, 0, 0, steps * 120, 0)
        return {"inputDelivered": True, "verified": False, "steps": steps,
                "window": active.title[:100], "process": active.process,
                "note": "Scroll wheel delivered inside the foreground app; the resulting page movement is not independently verified."}
    except AccessibilityError:
        raise
    except Exception as exc:
        raise AccessibilityError("Could not scroll the foreground application") from exc
