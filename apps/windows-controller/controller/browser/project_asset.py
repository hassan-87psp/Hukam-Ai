"""Copy a specific locally reviewed download, never infer artifact provenance."""
from pathlib import Path
import ctypes
import hashlib
import os
import stat
import tempfile

from ..security.validation import is_within
from ..system import desktop_input
from .chatgpt import ChatGPTError

MAX_BYTES=64*1024*1024
ALLOWED={".png",".jpg",".jpeg",".webp",".pdf",".txt",".docx"}

def _plain(path):
    meta=path.lstat()
    if path.is_symlink() or getattr(meta,"st_file_attributes",0)&stat.FILE_ATTRIBUTE_REPARSE_POINT:
        raise ChatGPTError("Asset paths through symbolic links or reparse points are not supported")
    return meta

def checked_directory(path, roots):
    if not path.is_absolute() or str(path).startswith("\\\\") or ".." in path.parts:
        raise ChatGPTError("Choose an existing local directory")
    try:
        for part in [path,*path.parents]:
            _plain(part)
        resolved=path.resolve(strict=True)
        if not resolved.is_dir() or not is_within(resolved,roots):
            raise ChatGPTError("Asset folder is outside permitted folders or not a directory")
        return resolved
    except (OSError,RuntimeError) as exc:
        raise ChatGPTError("Asset folder cannot be safely accessed") from exc

def _confirm(source,destination,size):
    # Prompt after candidate identification; default Cancel; no unattended copy.
    flags=0x1|0x30|0x100|0x10000|0x40000
    text=("Review this exact file in Downloads first. HUKM cannot independently verify that it is the generated ChatGPT artifact.\n\n"
          f"Source: {source}\nDestination: {destination}\nSize: {size} bytes\n\n"
          "OK copies this file locally without overwriting another file. Cancel leaves the original untouched.")
    return ctypes.windll.user32.MessageBoxW(None,text,"HUKM — review project file",flags)==1

def copy_reviewed_candidate(downloads,target,roots,name,size,mtime,cancel=None):
    desktop_input._check_cancel(cancel)
    source_dir=checked_directory(downloads,roots)
    target=checked_directory(target,roots)
    if (not isinstance(name,str) or Path(name).name!=name or name in (".","..")
            or any(c in name for c in "\\/:\x00") or Path(name).suffix.casefold() not in ALLOWED
            or type(size) is not int or not 0<size<=MAX_BYTES or type(mtime) is not int):
        raise ChatGPTError("No eligible exact download candidate")
    source=source_dir/name
    dest=target/name
    def check():
        desktop_input._check_cancel(cancel)
        meta=_plain(source)
        if not stat.S_ISREG(meta.st_mode) or (meta.st_size,meta.st_mtime_ns)!=(size,mtime):
            raise ChatGPTError("Download changed since detection; no project copy")
        if checked_directory(target,roots)!=target or checked_directory(source_dir,roots)!=source_dir:
            raise ChatGPTError("Asset folder changed")
        if dest.exists() or dest.is_symlink():
            raise ChatGPTError("Destination already exists; nothing overwritten")
        return meta
    tmp=None
    try:
        before=check()
        if not _confirm(source,dest,size):
            return {"assetSaved":False,"assetSaveCancelled":True}
        before=check()
        digest=hashlib.sha256()
        total=0
        with source.open("rb") as f:
            opened=os.fstat(f.fileno())
            if (opened.st_ino,opened.st_dev,opened.st_size,opened.st_mtime_ns)!=(before.st_ino,before.st_dev,size,mtime):
                raise ChatGPTError("Source changed before copy")
            with tempfile.NamedTemporaryFile(dir=target,prefix=".hukm-asset-",suffix=".tmp",delete=False) as output:
                tmp=Path(output.name)
                while True:
                    desktop_input._check_cancel(cancel)
                    chunk=f.read(1024*1024)
                    if not chunk:break
                    total+=len(chunk)
                    if total>size:raise ChatGPTError("Source grew during copy")
                    output.write(chunk);digest.update(chunk)
                output.flush();os.fsync(output.fileno())
            after=os.fstat(f.fileno())
            if total!=size or (after.st_size,after.st_mtime_ns)!=(size,mtime):
                raise ChatGPTError("Source changed during copy")
        last=check()
        if (last.st_ino,last.st_dev)!=(before.st_ino,before.st_dev):
            raise ChatGPTError("Source identity changed")
        desktop_input._check_cancel(cancel)
        # Atomic no-clobber commit on supported local filesystems. No fallback
        # that overwrites existing files, and no deletion of the source.
        os.link(tmp,dest)
        return {"assetSaved":True,"savedPath":str(dest),"savedSizeBytes":total,
                "savedSha256":digest.hexdigest(),"downloadVerified":False,"verified":False}
    except OSError as exc:
        raise ChatGPTError("Project copy unavailable; original download retained") from exc
    finally:
        if tmp is not None:
            try:tmp.unlink(missing_ok=True)
            except OSError:pass
