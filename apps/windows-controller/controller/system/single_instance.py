"""Only ONE HUKM Windows Controller per interactive Windows session.

A Windows named mutex prevents two copies of the same paired device from
competing for the relay connection after manual start/autostart. The guard is
local-only; it never reads remote credentials, user files or message bodies.
"""
from __future__ import annotations

from ..config import IS_WINDOWS

MUTEX_NAME = r"Local\HUKM_AI_PERSONAL_WINDOWS_CONTROLLER"
ERROR_ALREADY_EXISTS = 183


def acquire(name: str = MUTEX_NAME):
    if not IS_WINDOWS:
        return True  # Non-Windows development/simulation.
    import ctypes
    from ctypes import wintypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    create = kernel.CreateMutexW
    create.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
    create.restype = wintypes.HANDLE
    handle = create(None, False, name)
    if not handle:
        raise OSError("Windows could not create HUKM's single-instance lock")
    if ctypes.get_last_error() == ERROR_ALREADY_EXISTS:
        kernel.CloseHandle(handle)
        return None
    return handle


def release(handle) -> None:
    if not IS_WINDOWS or handle in (None, True):
        return
    import ctypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    kernel.CloseHandle.restype = ctypes.c_int
    kernel.CloseHandle(handle)
