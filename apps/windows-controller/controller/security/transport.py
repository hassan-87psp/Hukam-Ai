"""Validate the configured relay origin before exposing pairing credentials."""
from urllib.parse import urlsplit


def relay_origin(value: str) -> str:
    if not isinstance(value, str) or any(ord(c) <= 32 or ord(c) == 127 for c in value):
        raise ValueError("Invalid relay origin")
    try:
        p = urlsplit(value)
        port = p.port
        if (not p.hostname or p.username is not None or p.password is not None
                or p.path not in ("", "/") or p.query or p.fragment
                or "\\" in value or "?" in value or "#" in value):
            raise ValueError("Relay must be an origin without credentials, path, query or fragment")
        if port is not None and not 1 <= port <= 65535:
            raise ValueError("Invalid relay port")
        # Only explicit numeric loopback or localhost is permitted for local
        # development HTTP; not RFC1918/LAN, arbitrary hostnames or public hosts.
        if p.scheme != "https" and not (p.scheme == "http" and
                p.hostname in ("localhost", "127.0.0.1", "::1")):
            raise ValueError("Remote HUKM relay requires HTTPS")
        return p.scheme + "://" + p.netloc
    except (ValueError, TypeError) as exc:
        raise ValueError("Use an HTTPS relay origin (HTTP only for localhost development)") from exc
