# Step 4 — Lightweight Windows Controller candidate

- Reuse the existing event-driven outbound WebSocket, single foreground execution worker and native libraries. No new local AI, service, background screen capture or polling loop.
- Require application-level welcome before commands; bound waiting to 20 seconds. Invalidate stale epoch before ACK, do not start work after failed ACK, cap active command task count at 16; close connection when saturated, preserving server reconciliation/duplicate safeguards.
- Heartbeat failure closes socket and triggers reconnect; await heartbeat cleanup when disconnected. Short clean disconnections also use exponential backoff (1–60 s with jitter), reset after a stable session; legacy configured heartbeat outside 10–45 s falls back to 20 s, below default 75 s server watchdog.
- Nonblocking psutil process CPU and resident memory telemetry is included with existing heartbeat/system status; actual personal-PC idle CPU/RAM and responsiveness targets remain unmeasured.
- Build relay before Windows E2E in CI (previously test could be skipped due missing dist). No real Windows input during automated tests.
- Step 3 regression correction: configure higher budget only in existing mocked-memory test suite; independent quota unit tests remain unchanged. No production caps raised.
- npm audit on committed dependency lock previously returned zero known advisories; latest combined CI required. No paid upgrade or production deployment.
