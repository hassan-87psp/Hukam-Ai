"""File search restricted to the allowed roots. Bounded by depth, entry count and time so it stays light."""
from __future__ import annotations

import os
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path

SKIP_DIRS = {
    "appdata", "node_modules", ".git", ".svn", "__pycache__", "$recycle.bin", "system volume information",
    ".venv", "venv", ".cache", ".npm", ".gradle", ".idea", ".vs", "temp", "tmp",
}


@dataclass
class FileHit:
    path: Path
    size: int
    mtime: float
    score: float
    root_key: str

    def as_dict(self) -> dict:
        return {
            "name": self.path.name,
            "path": str(self.path),
            "folder": str(self.path.parent),
            "ext": self.path.suffix.lower().lstrip("."),
            "size": self.size,
            "modified": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(self.mtime)),
            "modifiedTs": self.mtime,
            "root": self.root_key,
        }


def _tokens(q: str) -> list[str]:
    return [t for t in re.split(r"[\s_\-.]+", q.lower()) if t]


def score_name(name: str, tokens: list[str]) -> float:
    if not tokens:
        return 1.0
    n = name.lower()
    stem = n.rsplit(".", 1)[0]
    score = 0.0
    for t in tokens:
        if t not in n:
            return 0.0
        score += 2.0 if re.search(rf"(^|[\s_\-.]){re.escape(t)}", stem) else 1.0
    if stem == " ".join(tokens):
        score += 3
    return score


def search(
    roots: list[tuple[str, Path]],
    query: str = "",
    exts: list[str] | None = None,
    sort: str = "relevance",
    limit: int = 30,
    *,
    max_depth: int = 6,
    max_entries: int = 150_000,
    time_budget_s: float = 25.0,
    cancel: threading.Event | None = None,
) -> dict:
    tokens = _tokens(query)
    want = {"." + e.lower() for e in exts or []}
    hits: list[FileHit] = []
    scanned = 0
    truncated = False
    deadline = time.monotonic() + time_budget_s
    seen_roots: set[str] = set()

    for key, root in roots:
        try:
            rkey = str(root.resolve())
        except OSError:
            continue
        if rkey in seen_roots or not root.is_dir():
            continue
        seen_roots.add(rkey)
        stack: list[tuple[Path, int]] = [(root, 0)]
        while stack:
            if cancel is not None and cancel.is_set():
                return {"cancelled": True, "results": [], "count": 0, "scanned": scanned}
            if scanned >= max_entries or time.monotonic() > deadline:
                truncated = True
                stack.clear()
                break
            d, depth = stack.pop()
            try:
                with os.scandir(d) as it:
                    for e in it:
                        scanned += 1
                        name = e.name
                        if name.startswith((".", "~$")):
                            continue
                        try:
                            if e.is_dir(follow_symlinks=False):
                                if depth < max_depth and name.lower() not in SKIP_DIRS:
                                    stack.append((Path(e.path), depth + 1))
                                continue
                            if not e.is_file(follow_symlinks=False):
                                continue
                        except OSError:
                            continue
                        if want and os.path.splitext(name)[1].lower() not in want:
                            continue
                        s = score_name(name, tokens)
                        if s <= 0:
                            continue
                        try:
                            st = e.stat(follow_symlinks=False)
                        except OSError:
                            continue
                        hits.append(FileHit(Path(e.path), st.st_size, st.st_mtime, s, key))
            except (PermissionError, FileNotFoundError, NotADirectoryError, OSError):
                continue

    if sort == "latest":
        hits.sort(key=lambda h: h.mtime, reverse=True)
    else:
        hits.sort(key=lambda h: (h.score, h.mtime), reverse=True)
    return {
        "results": [h.as_dict() for h in hits[:limit]],
        "count": len(hits),
        "scanned": scanned,
        "truncated": truncated,
    }


def list_folder(path: Path, limit: int = 60) -> dict:
    items = []
    total = 0
    try:
        with os.scandir(path) as it:
            for e in it:
                if e.name.startswith((".", "~$")) or e.name.lower() == "desktop.ini":
                    continue
                total += 1
                try:
                    st = e.stat(follow_symlinks=False)
                    is_dir = e.is_dir(follow_symlinks=False)
                except OSError:
                    continue
                items.append(
                    {
                        "name": e.name,
                        "path": e.path,
                        "isDir": is_dir,
                        "ext": "" if is_dir else os.path.splitext(e.name)[1].lower().lstrip("."),
                        "size": 0 if is_dir else st.st_size,
                        "modified": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(st.st_mtime)),
                        "modifiedTs": st.st_mtime,
                    }
                )
    except FileNotFoundError:
        raise
    items.sort(key=lambda x: x["modifiedTs"], reverse=True)
    return {"path": str(path), "items": items[:limit], "total": total}
