"""Discover the Unread chip in the installed WhatsApp Desktop accessibility tree.

Never guess an unlabeled click coordinate. Deduplicate Text/parent/Button
exposure of the *same* chip; reject distinct candidate positions. The returned
control is used only for an approved foreground action. No contact names,
message bodies or UIA text leave the Windows Controller.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

_FILTER = re.compile(
    r"^(?:unread(?:\s+(?:chats|messages))?|(?:unread(?:\s+(?:chats|messages))?)\s*"
    r"[:(•\-]?\s*\d{1,3}\)?|\d{1,3}\s+unread(?:\s+(?:chats|messages))?)$",
    re.I,
)
_ID = re.compile(r"^(?:btn|button|tab|chip|filter)?"
                 r"(?:unread|unreadchats|unreadmessages)"
                 r"(?:filter)?(?:btn|button|tab|chip)?$", re.I)
ROLES = {"ButtonControl", "TabItemControl", "RadioButtonControl",
         "TextControl", "CheckBoxControl", "GroupControl"}


@dataclass
class Candidate:
    control: object
    role: str
    left: float
    top: float
    right: float
    bottom: float

    @property
    def cx(self) -> float:
        return (self.left + self.right) / 2

    @property
    def cy(self) -> float:
        return (self.top + self.bottom) / 2


def _match(control) -> bool:
    # Some UIA providers throw on one property but expose others. Probe each
    # independently so a readable Name is not lost to a missing HelpText.
    try:
        name = " ".join(str(control.Name or "").split()).strip()
        if _FILTER.fullmatch(name):
            return True
    except Exception:
        pass
    try:
        automation_id = re.sub(r"[^a-z0-9]", "", str(control.AutomationId or "").casefold())
        if _ID.fullmatch(automation_id):
            return True
    except Exception:
        pass
    try:
        help_text = " ".join(str(control.HelpText or "").split()).strip()
        return bool(_FILTER.fullmatch(help_text))
    except Exception:
        return False


def candidates(root, rect, max_nodes=1900):
    import uiautomation as auto
    left, top, right, bottom = rect
    width, height = right - left, bottom - top
    found = []
    for index, (ctrl, _depth) in enumerate(auto.WalkControl(root, maxDepth=15)):
        if index >= max_nodes:
            break
        try:
            if ctrl.IsOffscreen:
                continue
            role = str(ctrl.ControlTypeName or "")
            if role not in ROLES or not _match(ctrl):
                continue
            b = ctrl.BoundingRectangle
            x, y, rx, by = map(float, (b.left, b.top, b.right, b.bottom))
            if (rx - x < 16 or rx - x > 320 or by - y < 12 or by - y > 96
                or x < left or rx > left + width * .58
                or y < top + 8 or by > top + min(430, height * .55)):
                continue
            found.append(Candidate(ctrl, role, x, y, rx, by))
        except Exception:
            continue
    return found


def choose_unique(items: list[Candidate]) -> tuple[Candidate | None, str]:
    """Treat child text and its clickable parent as one target, never 2 filters."""
    if not items:
        return None, "missing"
    clusters: list[list[Candidate]] = []
    for item in sorted(items, key=lambda c: (c.cy, c.cx)):
        group = next((g for g in clusters if any(
            abs(item.cy - m.cy) <= 27 and abs(item.cx - m.cx) <= 65
            for m in g)), None)
        if group is None:
            clusters.append([item])
        else:
            group.append(item)
    if len(clusters) != 1:
        return None, "ambiguous"
    priority = {"ButtonControl": 0, "TabItemControl": 1,
                "RadioButtonControl": 2, "CheckBoxControl": 3,
                "TextControl": 4, "GroupControl": 5}
    # When WhatsApp exposes a Button and its child Text separately, the
    # clickable parent is chosen without treating the pair as ambiguity.
    group = clusters[0]
    group.sort(key=lambda c: (priority.get(c.role, 9),
                              -((c.right-c.left)*(c.bottom-c.top))))
    return group[0], "unique"


def state(control) -> bool | None:
    for fn, attr in (("GetSelectionItemPattern", "IsSelected"),
                     ("GetTogglePattern", "ToggleState")):
        try:
            p = getattr(control, fn)()
            if p is not None:
                return bool(getattr(p, attr))
        except Exception:
            continue
    return None
