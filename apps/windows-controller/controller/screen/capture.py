"""On-demand capture of ONE explicitly selected display. Never continuous."""
from __future__ import annotations

import base64
import io

from ..system import launcher

MAX_PIXELS = 40_000_000
MAX_JPEG_BYTES = 2_000_000


def _capture_image(*, monitor: int = 1, cancel=None):
    import mss
    from PIL import Image

    def check_cancel():
        if cancel is not None and cancel.is_set():
            raise RuntimeError("Screen capture cancelled")

    check_cancel()
    if type(monitor) is not int or not 1 <= monitor <= 16:
        raise ValueError("Select a physical monitor numbered 1–16")
    if launcher.SIMULATE:
        if monitor != 1:
            raise ValueError("Only monitor 1 is available in simulation")
        mon = {"left": 0, "top": 0, "width": 640, "height": 360}
        count = 1
        img = Image.new("RGB", (640, 360), (40, 45, 50))
    else:
        factory = getattr(mss, "MSS", None) or mss.mss
        with factory() as sct:
            monitors = sct.monitors
            count = len(monitors) - 1
            if monitor > count:
                raise ValueError(f"Monitor {monitor} unavailable; {count} physical monitor(s) detected")
            # MSS index zero is the whole virtual desktop, never capture it.
            mon = dict(monitors[monitor])
            if mon["width"] <= 0 or mon["height"] <= 0 or mon["width"] * mon["height"] > MAX_PIXELS:
                raise ValueError("Selected monitor exceeds safe capture size")
            check_cancel()
            shot = sct.grab(mon)
            img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
    check_cancel()
    return img, mon, count


def capture(max_width: int = 1280, quality: int = 60, *, monitor: int = 1, cancel=None) -> dict:
    from PIL import Image

    def check_cancel():
        if cancel is not None and cancel.is_set():
            raise RuntimeError("Screen capture cancelled")

    img, mon, count = _capture_image(monitor=monitor, cancel=cancel)
    img.thumbnail((max_width, 1280), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    data = buf.getvalue()
    check_cancel()
    if len(data) > MAX_JPEG_BYTES:
        raise ValueError("Screenshot exceeds upload limit")
    return {"mime": "image/jpeg", "dataBase64": base64.b64encode(data).decode(),
            "width": img.width, "height": img.height, "bytes": len(data),
            "monitor": monitor, "monitorCount": count,
            "sourceBounds": {k: mon[k] for k in ("left", "top", "width", "height")},
            "simulated": launcher.SIMULATE}
