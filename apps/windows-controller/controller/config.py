"""Controller configuration stored in %APPDATA%\\HUKM AI\\config.json (or ~/.config/hukm-ai on other OSes)."""
from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from .security.transport import relay_origin

IS_WINDOWS = sys.platform == "win32"

ALL_CAPABILITIES = ["system", "apps", "folders", "files", "browser", "youtube", "screen", "input", "whatsapp"]

DEFAULT_APPS = [
    "chrome", "edge", "notepad", "calculator", "explorer", "vscode",
    "word", "excel", "powerpoint", "paint", "settings", "taskmgr",
]

DEFAULT_ALLOWED_FOLDERS = ["downloads", "documents", "desktop", "pictures", "music", "videos"]


def data_dir() -> Path:
    override = os.environ.get("HUKM_DATA_DIR")
    if override:
        p = Path(override)
    elif IS_WINDOWS:
        p = Path(os.environ.get("APPDATA", Path.home())) / "HUKM AI"
    else:
        p = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "hukm-ai"
    p.mkdir(parents=True, exist_ok=True)
    return p


@dataclass
class Config:
    server_url: str = ""
    # Known folders the controller may open/list/search. Keys from DEFAULT_ALLOWED_FOLDERS.
    allowed_folders: list[str] = field(default_factory=lambda: list(DEFAULT_ALLOWED_FOLDERS))
    # Additional absolute directories the user explicitly allows for file search/open.
    extra_allowed_dirs: list[str] = field(default_factory=list)
    apps: list[str] = field(default_factory=lambda: list(DEFAULT_APPS))
    # Capabilities this laptop is willing to provide at all (the web app can narrow these further).
    capabilities: list[str] = field(default_factory=lambda: [c for c in ALL_CAPABILITIES])
    screen_capture: bool = True
    browser: str = "default"  # default | chrome | edge
    whatsapp_mode: str = "desktop"  # desktop | web; installed Windows app by default
    search_max_depth: int = 6
    search_max_entries: int = 150_000
    search_time_budget_s: float = 25.0
    heartbeat_s: int = 20
    log_level: str = "INFO"

    @classmethod
    def path(cls) -> Path:
        return data_dir() / "config.json"

    @classmethod
    def load(cls) -> "Config":
        p = cls.path()
        cfg = cls()
        if p.exists():
            try:
                raw = json.loads(p.read_text(encoding="utf-8"))
                for k, v in (raw.items() if isinstance(raw, dict) else []):
                    if hasattr(cfg, k):
                        setattr(cfg, k, v)
            except (OSError, ValueError):
                pass
        # A malformed or old config must never crash the controller or create
        # an unbounded heartbeat loop. Keep explicitly disabled capabilities.
        def clean_list(value: object, allowed: list[str], fallback: list[str]) -> list[str]:
            if not isinstance(value, list):
                return list(fallback)
            return list(dict.fromkeys(x for x in value if isinstance(x, str) and x in allowed))

        cfg.capabilities = clean_list(cfg.capabilities, ALL_CAPABILITIES, ALL_CAPABILITIES)
        cfg.apps = clean_list(cfg.apps, DEFAULT_APPS, DEFAULT_APPS)
        cfg.allowed_folders = clean_list(
            cfg.allowed_folders, DEFAULT_ALLOWED_FOLDERS + ["home"], DEFAULT_ALLOWED_FOLDERS
        )
        if not isinstance(cfg.extra_allowed_dirs, list):
            cfg.extra_allowed_dirs = []
        cfg.extra_allowed_dirs = [
            x for x in cfg.extra_allowed_dirs if isinstance(x, str) and x and len(x) <= 1024
        ][:30]
        if cfg.browser not in ("default", "chrome", "edge"):
            cfg.browser = "default"
        # The user's Personal WhatsApp Desktop is the permanent default.
        # Legacy saved "web" settings cannot silently reroute laptop commands.
        # Explicit user requests for WhatsApp Web still work as web.open.
        cfg.whatsapp_mode = "desktop"
        cfg.screen_capture = cfg.screen_capture is True
        if not cfg.screen_capture and "screen" in cfg.capabilities:
            cfg.capabilities.remove("screen")
        def bounded_number(v: object, low: float, high: float, default: float) -> float:
            return float(v) if type(v) in (int, float) and low <= float(v) <= high else default
        cfg.heartbeat_s = int(bounded_number(cfg.heartbeat_s, 10, 45, 20))
        cfg.search_max_depth = int(bounded_number(cfg.search_max_depth, 1, 10, 6))
        cfg.search_max_entries = int(bounded_number(cfg.search_max_entries, 1000, 300000, 150000))
        cfg.search_time_budget_s = bounded_number(cfg.search_time_budget_s, 1, 60, 25)
        if cfg.log_level not in ("DEBUG", "INFO", "WARNING", "ERROR"):
            cfg.log_level = "INFO"
        if not isinstance(cfg.server_url, str):
            cfg.server_url = ""
        return cfg

    def save(self) -> None:
        self.path().write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")

    def ws_url(self) -> str:
        base = relay_origin(self.server_url)
        if base.startswith("https://"):
            return "wss://" + base[len("https://"):] + "/ws/device"
        if base.startswith("http://"):
            return "ws://" + base[len("http://"):] + "/ws/device"
        raise ValueError("server_url must start with http:// or https://")
