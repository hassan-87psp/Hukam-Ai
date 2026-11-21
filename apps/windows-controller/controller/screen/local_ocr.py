"""Explicit approved single-monitor OCR; no screenshot persistence or cloud vision."""
from ..system import launcher
from .capture import _capture_image
from ..whatsapp.visual_unread import _ocr_words, VisualUnreadUnavailable

class ScreenOCRError(RuntimeError):
    pass

def _cancel(cancel):
    if cancel is not None and cancel.is_set():
        raise ScreenOCRError("Screen OCR cancelled; no text returned")

def bounded_text(words):
    text = " ".join(str(word.text).strip() for word in words if str(word.text).strip())
    return text[:6000], len(text) > 6000

def read_monitor(monitor: int, cancel=None) -> dict:
    from PIL import Image
    _cancel(cancel)
    try:
        img, bounds, count = _capture_image(monitor=monitor, cancel=cancel)
        img.thumbnail((2560, 2560), Image.Resampling.LANCZOS)
        _cancel(cancel)
        if launcher.SIMULATE:
            text, limited = "Synthetic screen text for testing only", False
        else:
            text, limited = bounded_text(_ocr_words(img))
        _cancel(cancel)
        return {"ocrRead": True, "text": text, "monitor": monitor,
                "monitorCount": count, "sourceBounds": bounds,
                "truncated": limited, "simulated": launcher.SIMULATE,
                "verified": False, "source": "local Windows OCR (approximate)",
                "note": "Visible text estimate only; not a complete or verified screen interpretation."}
    except VisualUnreadUnavailable as exc:
        raise ScreenOCRError("Windows OCR unavailable or timed out. Check installed Windows OCR languages.") from exc
    except (OSError, ValueError, RuntimeError) as exc:
        if isinstance(exc, ScreenOCRError):
            raise
        raise ScreenOCRError("Selected monitor could not be read safely; no screenshot uploaded.") from exc
