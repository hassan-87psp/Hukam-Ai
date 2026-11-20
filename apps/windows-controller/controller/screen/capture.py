"""On-demand screenshot of the primary monitor. Never runs continuously; one image per approved command."""
from __future__ import annotations

import base64
import io


def capture(max_width: int = 1280, quality: int = 60) -> dict:
    import mss
    from PIL import Image

    factory = getattr(mss, "MSS", None) or mss.mss
    with factory() as sct:
        mon = sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0]
        shot = sct.grab(mon)
        img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
    if img.width > max_width:
        h = round(img.height * max_width / img.width)
        img = img.resize((max_width, h), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    data = buf.getvalue()
    return {"mime": "image/jpeg", "dataBase64": base64.b64encode(data).decode(), "width": img.width, "height": img.height, "bytes": len(data)}
