"""Remembers executed command IDs (persisted) so a redelivered command is never executed twice."""
from __future__ import annotations

import json
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
        except (OSError, ValueError, TypeError):
            pass

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
            self._items[cid] = None
            self._trim_and_save()
            return True

    def store_result(self, cid: str, message: dict) -> None:
        slim = {k: val for k, val in message.items() if k != "screenshot"}
        with self._lock:
            self._items[cid] = slim
            self._trim_and_save()

    def _trim_and_save(self) -> None:
        while len(self._items) > self.capacity:
            self._items.popitem(last=False)
        try:
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(list(self._items.items())), encoding="utf-8")
            tmp.replace(self.path)
        except OSError:
            pass
