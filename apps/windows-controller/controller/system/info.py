"""Permitted device information (no personal data beyond what the Devices page shows)."""
from __future__ import annotations

import platform
import socket

import psutil

# Reuse one process sampler. Nonblocking measurements, no background worker.
_process = None

def controller_stats() -> dict:
    global _process
    try:
        if _process is None:
            _process = psutil.Process()
        return {"controllerMemoryMb": round(_process.memory_info().rss / 1024**2, 1),
                "controllerCpuPercent": _process.cpu_percent(interval=None)}
    except (OSError, psutil.Error):
        return {}


def os_info() -> tuple[str, str]:
    system = platform.system() or "Unknown"
    if system == "Windows":
        rel, ver = platform.release(), platform.version()
        try:
            build = int(ver.split(".")[-1])
            if rel == "10" and build >= 22000:
                rel = "11"
        except ValueError:
            pass
        return "Windows", f"{rel} (build {ver})"
    return system, platform.release()


def hostname() -> str:
    return socket.gethostname()


def stats() -> dict:
    out: dict = {"cpu": psutil.cpu_percent(interval=None), "memory": psutil.virtual_memory().percent}
    try:
        b = psutil.sensors_battery()
        out["battery"] = round(b.percent) if b else None
        out["plugged"] = bool(b.power_plugged) if b else None
    except Exception:
        out["battery"] = None
        out["plugged"] = None
    out.update(controller_stats())
    return out


def device_status() -> dict:
    os_name, os_ver = os_info()
    vm = psutil.virtual_memory()
    boot = psutil.boot_time()
    import time

    s = stats()
    s.update(
        {
            "hostname": hostname(),
            "os": os_name,
            "osVersion": os_ver,
            "memoryTotalGb": round(vm.total / 1024**3, 1),
            "memoryUsedGb": round(vm.used / 1024**3, 1),
            "uptimeHours": round((time.time() - boot) / 3600, 1),
        }
    )
    return s
