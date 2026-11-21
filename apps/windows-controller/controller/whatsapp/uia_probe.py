"""Disposable read-only WhatsApp accessibility probe; no UI input."""
import json
import logging
import subprocess
import sys
import time
from pathlib import Path

log=logging.getLogger(__name__)
LIMIT=9.0


def inspect_native(hwnd):
    from .visual_unread import _safe_foreground
    from . import unread_filter
    import uiautomation as auto
    import win32gui
    _safe_foreground(hwnd)
    root=auto.ControlFromHandle(hwnd)
    w=win32gui.GetWindowRect(hwnd)
    items=unread_filter.candidates(root,w,max_nodes=450)
    choice,status=unread_filter.choose_unique(items)
    if choice is None:
        return {"status":status}
    if choice.role not in ("ButtonControl","TabItemControl","RadioButtonControl","CheckBoxControl"):
        return {"status":"not-actionable"}
    if not choice.control.IsEnabled or choice.control.IsOffscreen:
        return {"status":"disabled-or-hidden"}
    _safe_foreground(hwnd)
    from .unread_senders import _unread_filter_selected
    import re
    name=" ".join(str(choice.control.Name or "").split())
    count=re.fullmatch(r"unread(?:\s+chats)?\s*[:(]?\s*(\d{1,3})\)?",name,re.I)
    return {"status":"unique","bounds":[choice.left,choice.top,choice.right,choice.bottom],
            "selected":_unread_filter_selected(choice.control),
            "count":int(count.group(1)) if count else None}


def worker_main(raw):
    try:
        hwnd=int(raw)
        if hwnd<=0:return 2
        result=inspect_native(hwnd)
        sys.stdout.write(json.dumps(result,separators=(",",":")))
        sys.stdout.flush()
        return 0
    except Exception:
        return 2


def probe(hwnd,cancel=None):
    if cancel is not None and cancel.is_set():
        return {"status":"cancelled"}
    cmd=([sys.executable] if getattr(sys,"frozen",False) else
        [sys.executable,str(Path(__file__).resolve().parents[2]/"hukm_entry.py")])
    process=None
    try:
        process=subprocess.Popen(cmd+["--whatsapp-uia-worker",str(hwnd)],
            stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
        deadline=time.monotonic()+LIMIT
        while time.monotonic()<deadline:
            if cancel is not None and cancel.is_set():
                return {"status":"cancelled"}
            try:
                raw,_=process.communicate(timeout=.25)
                break
            except subprocess.TimeoutExpired:
                continue
        else:
            log.info("WhatsApp native accessibility probe timed out")
            return {"status":"timeout"}
        if process.returncode!=0 or len(raw)>4096:
            return {"status":"unavailable"}
        result=json.loads(raw)
        if not isinstance(result,dict) or result.get("status")!="unique":
            return {"status":"unavailable"}
        bounds=result.get("bounds")
        if not isinstance(bounds,list) or len(bounds)!=4 or not all(
                type(n) in (int,float) and -100000<=n<=100000 for n in bounds):
            return {"status":"invalid"}
        count=result.get("count")
        return {"status":"unique","bounds":bounds,
                "selected":result.get("selected") if type(result.get("selected")) is bool else None,
                "count":count if type(count) is int and 0<=count<=999 else None}
    except (OSError,ValueError,TypeError):
        return {"status":"unavailable"}
    finally:
        if process is not None:
            if process.poll() is None:
                process.kill()
            try:process.wait(timeout=2)
            except subprocess.TimeoutExpired:pass
            if process.stdout is not None:process.stdout.close()
