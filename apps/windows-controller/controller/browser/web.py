"""Browser and YouTube helpers. URLs are built here from validated queries; no page scripting in V1."""
from __future__ import annotations

import json
import re
import urllib.request
from urllib.parse import quote_plus

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


def web_search_url(query: str) -> str:
    return "https://www.google.com/search?q=" + quote_plus(query)


def youtube_search_url(query: str) -> str:
    return "https://www.youtube.com/results?search_query=" + quote_plus(query)


def youtube_watch_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


_VID = re.compile(r'"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"')
_TITLE = re.compile(r'"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"')


def extract_top_video(html: str) -> tuple[str, str | None] | None:
    """Find the first organic video result (skips ads/shorts shelves that don't use videoRenderer)."""
    m = _VID.search(html)
    if not m:
        return None
    vid = m.group(1)
    title = None
    t = _TITLE.search(html, m.end())
    if t and t.start() - m.end() < 4000:
        try:
            title = json.loads('"' + t.group(1) + '"')
        except ValueError:
            title = t.group(1)
    return vid, title


def resolve_top_video(query: str, timeout: float = 8.0) -> tuple[str, str | None] | None:
    """Fetch the public YouTube results page and pick the first video. Returns None if it can't be determined."""
    req = urllib.request.Request(
        youtube_search_url(query), headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.8,ur;q=0.6"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            if r.status != 200:
                return None
            html = r.read(3_000_000).decode("utf-8", "replace")
    except Exception:
        return None
    return extract_top_video(html)
