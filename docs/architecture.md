# Architecture

## Components

```
┌──────────────────────────┐        ┌────────────────────────────────────┐        ┌──────────────────────────────┐
│ Web app (apps/web)       │ HTTPS  │ Relay (apps/relay)                 │  WSS   │ Windows controller           │
│ React PWA, phone+desktop │◄──────►│ Node 22, node:sqlite, ws           │◄───────│ (apps/windows-controller)    │
│ • deterministic parser   │  REST  │ • auth (scrypt, httpOnly cookie)   │outbound│ Python 3.10+, asyncio        │
│   for instant ack        │   +    │ • pairing codes, device tokens     │ only   │ • validates every command    │
│ • Web Speech in/out      │  WS    │ • parser + validation (authority)  │        │ • allowlisted adapters       │
│ • brain orb (Canvas 2D)  │/ws/    │ • queue, approvals, timeouts       │/ws/    │ • dedupe store, result outbox│
└──────────────────────────┘client  │ • audit log, screenshots, retention│device  │ • visible console window     │
                                    └────────────────────────────────────┘        └──────────────────────────────┘
```

* The laptop **only makes outbound connections** — no Windows port is opened.
* The relay is a single small process (≈100 KB bundle) serving the API, both WebSockets and the built web app. It is free to self-host: run it on the laptop itself behind a Cloudflare Tunnel, or on any small VPS.
* `packages/command-protocol` is shared by the web app (instant acknowledgment) and the relay (the authority). The controller mirrors the validation in Python (defence in depth).

### Why not Supabase?
The brief suggested Supabase as an option. A device-scoped credential for Realtime would need either a service-role key on the laptop (forbidden by the brief) or custom JWT minting in an Edge Function. The self-contained relay keeps device tokens separate from user sessions, is fully testable offline (it is, see docs/testing.md), and costs nothing to run. The data model maps 1:1 to Postgres if you later move to Supabase (see roadmap).

## Command lifecycle

```
text/voice ─► parseCommand() ─► validateCommand() ─► requiresApproval?
                                                       │yes                 │no
                                              awaiting_approval ──approve──► pending ──dispatch──► (ack) ──started──► running ──result──► completed | failed
                                                       │reject/expire                                  │ timeout / cancel / emergency stop
                                                   cancelled | timed_out                         timed_out | cancelled
```

| Field | Meaning |
|---|---|
| `id` | relay-generated command ID |
| `clientRequestId` | idempotency key from the browser; repeats return the same command (`duplicate: true`) |
| `deviceId` | target laptop |
| `action`, `args` | validated structured command (never free text, never a shell) |
| `status` | `pending`, `awaiting_approval`, `running`, `completed`, `failed`, `cancelled`, `timed_out` |
| `createdAt/approvedAt/dispatchedAt/startedAt/finishedAt/durationMs` | timeline |
| `result` / `error {code,message}` | exactly what the controller reported |

Duplicate execution is prevented twice: the relay only dispatches undelivered `pending` commands, and the controller keeps a persisted list of executed IDs (a redelivered ID returns the cached result instead of running again). Results sit in the controller's outbox until the relay acknowledges them, so a result produced during a disconnect is delivered after reconnecting. Late results for commands that already timed out are acknowledged but ignored.

Timeouts: per action (10–45 s) after dispatch; queued commands for an offline laptop expire after `QUEUE_TTL_MS` (5 min); approvals after `APPROVAL_TTL_MS` (10 min).

## WebSocket protocol (shared-types)

Device → relay: `hello` (version, OS, capabilities, allowed folders/apps), `heartbeat` (CPU/RAM/battery every 20 s), `ack`, `started`, `result` (optional JPEG screenshot).
Relay → device: `welcome`, `command`, `cancel`, `result_ack`, `pause`, `resume`, `capabilities`, `revoked`.
Relay → browser: `command.updated`, `device.updated`, `device.removed`, `automation.updated`, `settings.updated`.

## Data model (database/migrations/001_init.sql)
`users`, `sessions`, `devices`, `pairing_codes`, `commands`, `command_approvals`, `connection_events`, `automations`, `user_settings`, `audit_logs`, `screenshots` — all indexed for the queries the relay runs; every row is scoped by `user_id` (see database/security/README.md).

## Command engine
Deterministic, no model: Urdu-script phrases are mapped to Roman tokens, spelling variants are normalised (“kholo / khol do / open karo / chalao”), then ordered rules pick one of 20 allowlisted actions and extract arguments (folder, file type, “latest”, search query, contact + message). Anything else gets a helpful “not understood” reply — it is never turned into a script. The `AIProvider` interface (`packages/command-protocol/src/provider.ts`) lets a future model propose the *same* structured actions, which still pass the same validation.

## Performance notes
* Controller idle cost: one heartbeat every 20 s; measured RSS in the Linux test run ≈ 28 MB (Windows will differ — measure with Task Manager).
* No continuous screen capture; one ≤1280 px JPEG (q60) per approved request.
* File search is bounded (depth 6, 150 k entries, 25 s, skips AppData/node_modules/.git…).
* Web: route-level code splitting; the orb is lazy-loaded, capped at ~40 fps, pauses when hidden/off-screen, renders a single static frame with reduced motion. Initial JS ≈ 94 KB gzipped (React + app shell).
