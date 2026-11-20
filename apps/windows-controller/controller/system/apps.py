"""Allowlisted applications. Keys must match KNOWN_APPS in packages/command-protocol."""
from __future__ import annotations

APP_LABELS = {
    "chrome": "Google Chrome", "edge": "Microsoft Edge", "notepad": "Notepad", "calculator": "Calculator",
    "explorer": "File Explorer", "vscode": "VS Code", "word": "Microsoft Word", "excel": "Microsoft Excel",
    "powerpoint": "PowerPoint", "paint": "Paint", "settings": "Windows Settings", "taskmgr": "Task Manager",
}

# Candidate launch targets, tried in order. Fixed strings only.
APP_CANDIDATES: dict[str, list[str]] = {
    "chrome": [
        r"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
        r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
        r"%LocalAppData%\Google\Chrome\Application\chrome.exe",
        "chrome.exe",
    ],
    "edge": [r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe", "msedge.exe"],
    "notepad": ["notepad.exe"],
    "calculator": ["calc.exe"],
    "explorer": ["explorer.exe"],
    "vscode": [r"%LocalAppData%\Programs\Microsoft VS Code\Code.exe", r"%ProgramFiles%\Microsoft VS Code\Code.exe", "code"],
    "word": ["winword.exe"],
    "excel": ["excel.exe"],
    "powerpoint": ["powerpnt.exe"],
    "paint": ["mspaint.exe"],
    "settings": ["ms-settings:"],
    "taskmgr": ["taskmgr.exe"],
}

# Process names used to confirm the app's window appeared.
APP_PROCESSES: dict[str, list[str]] = {
    "chrome": ["chrome.exe"], "edge": ["msedge.exe"], "notepad": ["notepad.exe"],
    "calculator": ["calculatorapp.exe", "calc.exe", "applicationframehost.exe"], "explorer": ["explorer.exe"],
    "vscode": ["code.exe"], "word": ["winword.exe"], "excel": ["excel.exe"], "powerpoint": ["powerpnt.exe"],
    "paint": ["mspaint.exe"], "settings": ["systemsettings.exe", "applicationframehost.exe"], "taskmgr": ["taskmgr.exe"],
}
