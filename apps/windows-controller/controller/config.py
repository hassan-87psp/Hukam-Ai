"""Controller configuration stored in %APPDATA%\\HUKM AI\\config.json (or ~/.config/hukm-ai on other OSes)."""
from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

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
    whatsapp_mode: str = "web"  # web | desktop
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
                for k, v in raw.items():
                    if hasattr(cfg, k):
                        setattr(cfg, k, v)
            except (OSError, ValueError):
                pass
        cfg.capabilities = [c for c in cfg.capabilities if c in ALL_CAPABILITIES]
        cfg.apps = [a for a in cfg.apps if a in DEFAULT_APPS]
        cfg.allowed_folders = [f for f in cfg.allowed_folders if f in DEFAULT_ALLOWED_FOLDERS + ["home"]]
        if not cfg.screen_capture and "screen" in cfg.capabilities:
            cfg.capabilities.remove("screen")
        return cfg

    def save(self) -> None:
        self.path().write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")

    def ws_url(self) -> str:
        base = self.server_url.rstrip("/")
        if base.startswith("https://"):
            return "wss://" + base[len("https://"):] + "/ws/device"
        if base.startswith("http://"):
            return "ws://" + base[len("http://"):] + "/ws/device"
        raise ValueError("server_url must start with http:// or https://")
