"""File search restricted to the allowed roots. Bounded by depth, entry count and time so it stays light."""
from __future__ import annotations

import os
import heapq
import stat
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path

SKIP_DIRS = {
    "appdata", "node_modules", ".git", ".svn", "__pycache__", "$recycle.bin", "system volume information",
    ".venv", "venv", ".cache", ".npm", ".gradle", ".idea", ".vs", "temp", "tmp",
}


INCOMPLETE_EXTS = {".crdownload", ".part", ".partial", ".download", ".tmp"}

def _safe_entry(entry, metadata) -> bool:
    # Includes Windows junctions and other reparse targets, not just symlinks.
    return not entry.is_symlink() and not (
        getattr(metadata, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
    )

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
    limit = max(1, min(limit, 200))
    heap = []
    scanned = count = 0
    truncated = incomplete = False
    deadline = time.monotonic() + time_budget_s
    seen_dirs: set[str] = set()
    for key, root in roots:
        try:
            root = root.resolve(strict=True)
            if not root.is_dir():
                incomplete = True
                continue
        except (OSError, RuntimeError):
            incomplete = True
            continue
        stack = [(root, 0)]
        while stack:
            if cancel is not None and cancel.is_set():
                return {"cancelled": True, "results": [], "count": 0, "scanned": scanned}
            if scanned >= max_entries or time.monotonic() >= deadline:
                truncated = True
                break
            directory, depth = stack.pop()
            try:
                resolved = directory.resolve(strict=True)
                if not resolved.is_relative_to(root):
                    incomplete = True
                    continue
                identity = os.path.normcase(str(resolved))
                if identity in seen_dirs:
                    continue
                seen_dirs.add(identity)
                with os.scandir(resolved) as entries:
                    for entry in entries:
                        if cancel is not None and cancel.is_set():
                            return {"cancelled": True, "results": [], "count": 0, "scanned": scanned}
                        if scanned >= max_entries or time.monotonic() >= deadline:
                            truncated = True
                            break
                        scanned += 1
                        name = entry.name
                        if name.startswith((".", "~$")) or name.casefold() == "desktop.ini":
                            continue
                        try:
                            st = entry.stat(follow_symlinks=False)
                            if not _safe_entry(entry, st):
                                continue
                            if stat.S_ISDIR(st.st_mode):
                                if name.casefold() not in SKIP_DIRS:
                                    if depth < max_depth:
                                        stack.append((Path(entry.path), depth + 1))
                                    else:
                                        truncated = True
                                continue
                            if not stat.S_ISREG(st.st_mode):
                                continue
                        except OSError:
                            incomplete = True
                            continue
                        suffix = Path(name).suffix.casefold()
                        if suffix in INCOMPLETE_EXTS or (want and suffix not in want):
                            continue
                        score = score_name(name, tokens)
                        if score <= 0:
                            continue
                        count += 1
                        hit = FileHit(Path(entry.path), st.st_size, st.st_mtime, score, key)
                        rank = (st.st_mtime,) if sort == "latest" else (score, st.st_mtime)
                        candidate = (rank, count, hit)
                        if len(heap) < limit:
                            heapq.heappush(heap, candidate)
                        elif candidate[:2] > heap[0][:2]:
                            heapq.heapreplace(heap, candidate)
            except (OSError, RuntimeError):
                incomplete = True
            if scanned >= max_entries or time.monotonic() >= deadline:
                truncated = True
                break
        if scanned >= max_entries or time.monotonic() >= deadline:
            truncated = True
            break
    if cancel is not None and cancel.is_set():
        return {"cancelled": True, "results": [], "count": 0, "scanned": scanned}
    return {
        "results": [hit.as_dict() for _, _, hit in sorted(heap, reverse=True)],
        "count": count, "scanned": scanned, "truncated": truncated or incomplete,
    }


def list_folder(path: Path, limit: int = 60, cancel=None) -> dict:
    items = []
    total = scanned = 0
    truncated = False
    deadline = time.monotonic() + 10
    try:
        with os.scandir(path) as it:
            for e in it:
                if cancel is not None and cancel.is_set():
                    return {"cancelled": True, "items": [], "total": 0}
                if scanned >= 10000 or time.monotonic() >= deadline:
                    truncated = True
                    break
                scanned += 1
                if e.name.startswith((".", "~$")) or e.name.lower() == "desktop.ini":
                    continue
                try:
                    st = e.stat(follow_symlinks=False)
                    if not _safe_entry(e, st):
                        continue
                    is_dir = stat.S_ISDIR(st.st_mode)
                    if not is_dir and (not stat.S_ISREG(st.st_mode) or Path(e.name).suffix.casefold() in INCOMPLETE_EXTS):
                        continue
                except OSError:
                    truncated = True
                    continue
                total += 1
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
    return {"path": str(path), "items": items[:limit], "total": total, "truncated": truncated or total > limit}
