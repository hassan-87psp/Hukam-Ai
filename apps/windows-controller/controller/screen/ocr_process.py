"""Bounded read-only native OCR subprocess. Private pixels travel via pipes."""
from __future__ import annotations

import io
import json
import subprocess
import sys
import time
from dataclasses import asdict
from pathlib import Path

MAX_IMAGE = 16 * 1024 * 1024
MAX_WORDS = 6000
MAX_OUTPUT = 2 * 1024 * 1024
DEADLINE_SECONDS = 28.0


def worker_main():
    """Receive only a bounded PNG on stdin; return JSON word boxes on stdout."""
    from PIL import Image
    from ..whatsapp.visual_unread import _ocr_words_native
    try:
        raw = sys.stdin.buffer.read(MAX_IMAGE + 1)
        if not raw or len(raw) > MAX_IMAGE:
            return 2
        with Image.open(io.BytesIO(raw), formats=["PNG"]) as image:
            if image.width > 2560 or image.height > 2560:
                return 2
            image.load()
            words = _ocr_words_native(image)[:MAX_WORDS]
        result = json.dumps([asdict(w) for w in words], ensure_ascii=True).encode("ascii")
        if len(result)>MAX_OUTPUT:
            return 2
        sys.stdout.buffer.write(result)
        sys.stdout.buffer.flush()
        return 0
    except Exception:
        # Do not log image contents or recognized words.
        return 2


def recognize_isolated(image, cancel=None):
    from ..whatsapp.visual_unread import Word, VisualUnreadUnavailable
    if cancel is not None and cancel.is_set():
        raise VisualUnreadUnavailable("OCR cancelled before worker start")
    if image.width > 2560 or image.height > 2560:
        raise VisualUnreadUnavailable("OCR image exceeds safe dimensions")
    buffer=io.BytesIO()
    image.convert("RGB").save(buffer,format="PNG")
    raw=buffer.getvalue()
    if len(raw)>MAX_IMAGE:
        raise VisualUnreadUnavailable("OCR image exceeds safe byte limit")
    # Pytest adds its source root only to the parent's sys.path. The
    # child cannot rely on cwd or inheriting that in-memory mutation.
    cmd=([sys.executable] if getattr(sys,"frozen",False) else
         [sys.executable,str(Path(__file__).resolve().parents[2]/"hukm_entry.py")]) + ["--local-ocr-worker"]
    process=None
    try:
        deadline=time.monotonic()+DEADLINE_SECONDS
        process=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
        payload=raw
        while True:
            if cancel is not None and cancel.is_set():
                raise VisualUnreadUnavailable("OCR cancelled; read-only child stopped")
            left=deadline-time.monotonic()
            if left<=0:
                raise VisualUnreadUnavailable("Windows OCR worker exceeded its local deadline; no further click or read")
            try:
                output,_=process.communicate(input=payload,timeout=min(left,0.25))
                break
            except subprocess.TimeoutExpired:
                payload=None
        if cancel is not None and cancel.is_set():
            raise VisualUnreadUnavailable("OCR cancelled; no result returned")
        if process.returncode!=0 or len(output)>MAX_OUTPUT:
            raise VisualUnreadUnavailable(f"Windows OCR worker could not read the image (exit {process.returncode})")
        rows=json.loads(output)
        if not isinstance(rows,list) or len(rows)>MAX_WORDS:
            raise ValueError("Invalid OCR result")
        import math
        words=[]
        for row in rows:
            word=Word(**row)
            if (not isinstance(word.text,str) or len(word.text)>1000 or
                not all(isinstance(v,(int,float)) and math.isfinite(v) for v in (word.x,word.y,word.width,word.height)) or
                word.width<=0 or word.height<=0):
                raise ValueError("Invalid OCR word")
            words.append(word)
        return words
    except (OSError,ValueError,TypeError) as exc:
        raise VisualUnreadUnavailable("Local OCR worker unavailable; no names guessed") from exc
    finally:
        if process is not None:
            if process.poll() is None:
                process.kill()
            # Do not block the foreground worker indefinitely on pipe cleanup.
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
            for pipe in (process.stdin,process.stdout):
                if pipe is not None:
                    pipe.close()
