"""Remembers executed command IDs (persisted) so a redelivered command is never executed twice."""
from __future__ import annotations

import json
import os
import tempfile
import threading
from collections import OrderedDict
from pathlib import Path


class DedupeStore:
    def __init__(self, path: Path, capacity: int = 500):
        self.path = path
        self.capacity = capacity
        self._lock = threading.Lock()
        self._items: "OrderedDict[str, dict | None]" = OrderedDict()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            for k, val in data:
                self._items[k] = val
        except FileNotFoundError:
            pass
        except (OSError, ValueError, TypeError) as exc:
            raise RuntimeError("Command recovery journal cannot be read safely; do not automatically reset it") from exc

    def seen(self, cid: str) -> bool:
        with self._lock:
            return cid in self._items

    def get(self, cid: str) -> dict | None:
        with self._lock:
            return self._items.get(cid)

    def mark_started(self, cid: str) -> bool:
        """Returns False if the ID was already started (duplicate)."""
        with self._lock:
            if cid in self._items:
                return False
            previous = self._items.copy()
            self._items[cid] = None
            try:
                self._trim_and_save()
            except OSError:
                self._items = previous
                raise
            return True

    def store_result(self, cid: str, message: dict) -> None:
        slim = {k: val for k, val in message.items() if k != "screenshot"}
        with self._lock:
            self._items[cid] = slim
            self._trim_and_save()

    def _trim_and_save(self) -> None:
        while len(self._items) > self.capacity:
            self._items.popitem(last=False)
        tmp = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.path.parent,
                                             prefix=".executed-", suffix=".tmp", delete=False) as f:
                tmp = Path(f.name)
                json.dump(list(self._items.items()), f)
                f.flush()
                os.fsync(f.fileno())
            tmp.replace(self.path)
        finally:
            if tmp is not None:
                tmp.unlink(missing_ok=True)
