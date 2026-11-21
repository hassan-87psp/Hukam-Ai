"""Owner-approved Windows UI Automation inspection and label-based interaction.

No screenshots or message bodies are sent to Gemini. Inspection returns a bounded
list of interactive control labels from the foreground window only. Controls are
never searched in hidden/background apps; no OCR or computer-wide scraping.
"""
from __future__ import annotations

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
DANGEROUS = {
    "send", "send message", "delete", "remove", "purchase", "pay", "submit",
    "confirm", "approve", "publish", "share", "sign out", "log out",
    "block", "report", "transfer", "call", "video call", "join",
}


class AccessibilityError(Exception):
    pass


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
        return {"window": "Test Chrome", "process": "chrome.exe",
                "controls": inspect_controls([("ButtonControl", "Search"), ("TextControl", "Private message")]),
                "visibleOnly": True, "contentRead": False, "verified": True, "simulated": True}
    active = _active()
    try:
        import uiautomation as auto
        root = auto.ControlFromHandle(active.hwnd)
        labels = [(role, label) for _, role, label in _visible_controls(root)]
        return {"window": active.title[:100], "process": active.process,
                "controls": inspect_controls(labels), "visibleOnly": True,
                "contentRead": False, "verified": True,
                "note": "Only foreground interactive control labels, not text fields or chat message contents."}
    except Exception as exc:
        raise AccessibilityError("Could not inspect interactive controls on this window") from exc


def activate(label: str) -> dict:
    if label.casefold().strip() in DANGEROUS:
        raise AccessibilityError("Sensitive buttons require a dedicated approved workflow")
    if launcher.SIMULATE:
        launcher._record("ui.activate", "label (redacted)")
        return {"inputDelivered": True, "verified": False, "simulated": True}
    active = _active()
    try:
        import uiautomation as auto
        root = auto.ControlFromHandle(active.hwnd)
        matches = [ctrl for ctrl, _, name in _visible_controls(root) if name.casefold() == label.casefold()]
        if len(matches) != 1:
            raise AccessibilityError("A single visible control with that exact label was not found")
        # Re-check the foreground window; never click a control from another app.
        if windows.active_window().hwnd != active.hwnd:
            raise AccessibilityError("Foreground window changed; no click performed")
        matches[0].Click(simulateMove=False)
        return {"inputDelivered": True, "verified": False, "label": label,
                "note": "UI Automation activated the exact visible control; final website result is unverified."}
    except AccessibilityError:
        raise
    except Exception as exc:
        raise AccessibilityError("UI Automation could not activate this control") from exc
