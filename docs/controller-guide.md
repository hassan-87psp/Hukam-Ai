# Windows controller guide

`apps/windows-controller` — Python 3.10+, dependencies: `websockets`, `psutil`, `mss`, `Pillow`, `pywin32`. No admin rights needed. No local AI model.

## Commands
```
hukm-controller                       first run: asks relay URL + pairing code, then connects
hukm-controller pair --server URL --code ABCD-EFGH
hukm-controller run                   connect and accept commands (console window = remote access is ON)
hukm-controller status                show pairing status
hukm-controller unpair                forget local credentials (also click Remove in the web app)
hukm-controller config                print config path and current settings
```
From source: `python -m controller <command>` inside `apps/windows-controller`.

## Files (in `%APPDATA%\HUKM AI\`)
| File | Purpose |
|---|---|
| `config.json` | what this laptop allows (see below) |
| `device.json` | device ID + token, **encrypted with Windows DPAPI** (only your Windows user can decrypt it) |
| `executed.json` | last 500 executed command IDs (duplicate protection) |
| `controller.log` | rotating log (1 MB × 3) |

## config.json
See `config.example.json`. Key settings:
* `allowed_folders` — subset of `downloads, documents, desktop, pictures, music, videos, home`. Paths are resolved with Windows Known Folders, so OneDrive-redirected Desktop/Documents work.
* `extra_allowed_dirs` — additional absolute folders for file search/open (e.g. `D:\\Work`).
* `apps` — allowlisted app keys: `chrome, edge, notepad, calculator, explorer, vscode, word, excel, powerpoint, paint, settings, taskmgr`.
* `capabilities` — what this laptop offers at all. The web app can only narrow this.
* `screen_capture` — `false` removes screenshot capability entirely.
* `browser` — `default`, `chrome` or `edge`.
* `whatsapp_mode` — `web` (WhatsApp Web) or `desktop` (WhatsApp app via `whatsapp:` links).
* search limits — `search_max_depth`, `search_max_entries`, `search_time_budget_s`.

Restart the controller after editing.

## What each action does on Windows
| Action | Implementation | Verification reported back |
|---|---|---|
| `folder.open` | `os.startfile(<known folder>)` → Explorer | path + whether a new Explorer window with that name appeared within 4 s |
| `app.open` | fixed candidate paths / App Paths (`chrome.exe`, `winword.exe`…) | new window of the expected process within 6 s (`windowDetected`) |
| `file.search` / `folder.list` | `os.scandir` inside allowed roots only | results, counts, truncation flag |
| `file.open` / `file.reveal` | path must be inside allowed roots, not an executable/script; `os.startfile` / `explorer /select,` | opened path |
| `web.open`, `web.search`, `youtube.search` | default browser (or configured Chrome/Edge) with a built URL | URL |
| `youtube.play` | fetches YouTube's public results page, opens the first organic `videoRenderer` result; otherwise opens the results and says so | `mode: video | search` |
| `device.status` | psutil (CPU, RAM, battery, uptime, controller RAM) | values |
| `apps.list`, `window.active`, `window.focus` | pywin32 `EnumWindows` / `GetForegroundWindow` / `SetForegroundWindow` | titles + process names |
| `screen.capture` | `mss` primary monitor → ≤1280 px JPEG q60 | image (stored by relay, auto-deleted) |
| `system.lock` | `LockWorkStation()` (always needs approval) | locked |
| `whatsapp.open/check/compose` | see docs/integration-status.md | |

Never available: arbitrary shell commands, closing apps, deleting/modifying files, installing software, shutdown.

## Building the portable exe
On a Windows machine with Python 3.10+:
```
cd apps\windows-controller
packaging\build.bat
```
It creates a venv, installs `requirements-dev.txt`, **runs the tests**, then PyInstaller → `dist\hukm-controller.exe` (single file, console window). Expected size roughly 15–25 MB (not measured here — the build wasn't run on Windows in this delivery). Windows SmartScreen may warn about an unsigned exe; code-signing is on the roadmap.

## Emergency stop
The red **Stop** button in the web app pauses every device: running commands are cancelled, new ones are refused, and the controller logs `EMERGENCY STOP`. Resume from **Devices**. Locally, simply close the controller window.
