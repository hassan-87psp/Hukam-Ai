"""Resolve Windows known folders (handles OneDrive-redirected Desktop/Documents)."""
from __future__ import annotations

import os
from pathlib import Path

from ..config import IS_WINDOWS

_GUIDS = {
    "downloads": "{374DE290-123F-4565-9164-39C4925E467B}",
    "documents": "{FDD39AD0-238F-46AF-ADB4-6C85480369C7}",
    "desktop": "{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}",
    "pictures": "{33E28130-4E1E-4676-835A-98395C3BC3BB}",
    "music": "{4BD8D571-6D19-48D3-BE97-422220080E43}",
    "videos": "{18989B1D-99B5-455B-841C-AB7C74E4DDFC}",
}

_FALLBACK = {
    "downloads": "Downloads", "documents": "Documents", "desktop": "Desktop",
    "pictures": "Pictures", "music": "Music", "videos": "Videos",
}


def _win_known_folder(guid: str) -> str | None:
    try:
        import ctypes
        from ctypes import wintypes

        class GUID(ctypes.Structure):
            _fields_ = [("Data1", wintypes.DWORD), ("Data2", wintypes.WORD), ("Data3", wintypes.WORD), ("Data4", wintypes.BYTE * 8)]

        g = GUID()
        ctypes.oledll.ole32.CLSIDFromString(ctypes.c_wchar_p(guid), ctypes.byref(g))
        out = ctypes.c_wchar_p()
        ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(g), 0, None, ctypes.byref(out))
        path = out.value
        ctypes.windll.ole32.CoTaskMemFree(out)
        return path
    except Exception:
        return None


def resolve(key: str) -> Path:
    override = os.environ.get(f"HUKM_FOLDER_{key.upper()}")
    if override:
        return Path(override)
    if key == "home":
        return Path.home()
    if IS_WINDOWS and key in _GUIDS:
        p = _win_known_folder(_GUIDS[key])
        if p:
            return Path(p)
    return Path.home() / _FALLBACK.get(key, key)


def allowed_roots(allowed_folders: list[str], extra_dirs: list[str]) -> list[tuple[str, Path]]:
    roots = [(k, resolve(k)) for k in allowed_folders]
    for d in extra_dirs:
        p = Path(os.path.expandvars(os.path.expanduser(d)))
        if p.is_absolute():
            roots.append(("custom", p))
    return roots
