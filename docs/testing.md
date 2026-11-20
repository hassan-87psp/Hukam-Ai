# Testing

## Automated tests — results of the run before delivery (20 Nov 2026)

| Suite | Command | Result |
|---|---|---|
| Command protocol (parser, Urdu/Roman/English, validation, approvals, messages) | `npm test` | **60 passed** |
| Relay integration (real HTTP + WebSocket server, fake device) | `npm test` | **25 passed** |
| Controller unit tests (validation, file search, allowlists, executor, YouTube parsing, WhatsApp title parsing, dedupe) | `npm run test:controller` | **19 passed** |
| Relay ↔ real Python controller end-to-end (Node relay process + controller client, launches simulated) | `npm run test:controller` | **1 passed** |
| Browser journey (Playwright, Chrome, desktop 1440×900 + mobile 390×844) | `tests/e2e/ui-journey.mjs` | **completed** — see below |
| Type checks | `npm run typecheck` | clean |

Environment: Linux container, Node 22.23, Python 3.13. **No Windows machine was available**, so OS-level effects (Explorer opening, apps launching, screenshots, window titles, DPAPI, PyInstaller build) ran in simulation (`HUKM_SIMULATE=1`) or were not exercised.

### Coverage of the required test areas
| Area | Where |
|---|---|
| Authentication | relay.test.ts › authentication (setup code, wrong password, unauthenticated, CSRF) |
| Device pairing | relay.test.ts › device pairing (single-use code, bad token); test_e2e_relay.py |
| Command validation / unauthorized commands | parser.test.ts › validation; relay.test.ts › rejects invalid structured commands; test_controller.py › validation |
| Device disconnection / reconnection | relay.test.ts › queues while offline and delivers on reconnect; expires queued commands |
| Duplicate commands | relay.test.ts › clientRequestId; test_controller.py › dedupe |
| Command timeouts | relay.test.ts › times out…, ignores a late result |
| File search | test_controller.py › search only inside allowed roots, latest, cancel; E2E |
| Browser actions | test_controller.py › web search URL, YouTube fallback/extraction |
| Error handling | relay.test.ts › reports device failures honestly; E2E screenshot failure surfaced |
| Pending approvals | relay.test.ts › approval then execute, rejection never dispatched, WhatsApp always approval |
| Mobile / desktop layout | browser journey screenshots (docs/screenshots) |
| Urdu text handling | parser.test.ts › Urdu script cases incl. compose with Urdu message |
| Voice permission failures | code paths (insecure context, unsupported browser, `not-allowed`) — **manual** on devices |

### Browser journey (what actually happened)
Setup → pair (code generated in UI, controller paired by CLI) → laptop shown Online → commands: `Downloads folder kholo` ✔, `Chrome kholo` ✔, `Meri invoice wali file search karo` ✔, `Browser mein Forex news search karo` ✔, `laptop ka status batao` ✔, `aaj mausam kaisa hai` → “not understood” reply (no command sent), `Desktop par latest Excel file dhoondo` ✔ (0 results, said so), `Mujhe laptop ki screen dikhao` → approval → **failed honestly** (no display in container), `YouTube par Gold analysis play karo` → results page opened with the honest “couldn't determine top video” note (YouTube not reachable from the sandbox) → emergency stop paused the controller → resumed. Controller RSS during the run ≈ 28 MB.

## Manual test guide (real Windows laptop)
Run with the relay URL over HTTPS and the controller window visible. Tick each:

**Pairing & status**
- [ ] Pair with a code; the dashboard shows the laptop Online within 2 s.
- [ ] Close the controller window → Offline within ~75 s (or immediately on clean exit). Reopen → Online.
- [ ] Put the laptop to sleep and wake it → it reconnects by itself.

**Core commands** (type them; then repeat by voice)
- [ ] `Downloads folder kholo` → Explorer opens Downloads; card says Completed.
- [ ] `Chrome kholo`, `Notepad kholo`, `Calculator kholo` → app opens; `windowDetected` true.
- [ ] `Meri invoice wali file search karo` → only files inside allowed folders.
- [ ] `Desktop par jo PDF hai woh kholo` → opens if exactly one PDF, otherwise shows choices.
- [ ] Files page → Open / Open folder on a result.
- [ ] `YouTube par Gold analysis play karo` → a video page opens (or results, with the note).
- [ ] `Browser mein Forex news search karo` → Google results.
- [ ] `Computer par kaunsi applications open hain?` → list matches the taskbar.
- [ ] `Mujhe laptop ki screen dikhao` → approve → screenshot appears; it disappears after the retention window.
- [ ] `laptop lock karo` → approve → Windows locks.
- [ ] `Current command cancel karo` while a long search runs → Cancelled.

**Safety**
- [ ] Settings → Devices: disable *Files* → file commands fail with “disabled”.
- [ ] Ask to open something in `C:\Windows` via Files API → refused.
- [ ] Put `test.bat` in Downloads and try to open it → refused.
- [ ] Emergency Stop → controller logs EMERGENCY STOP; new commands fail; Resume works.
- [ ] Remove device → controller exits with “unpaired”; its token no longer connects.

**WhatsApp**
- [ ] `WhatsApp kholo` → WhatsApp Web opens.
- [ ] With WhatsApp Web the active tab and unread chats present → `WhatsApp check karo` shows the same number as the tab title.
- [ ] Add contact Ali → `Ali ko message likho ke main 10 minute mein call karunga` → approval shows recipient + text → approve → chat opens with text typed, **not sent**.

**Voice (phone)**
- [ ] Android Chrome over HTTPS: mic permission prompt, ur-PK recognition of 5 commands — note accuracy.
- [ ] iPhone Safari: same.
- [ ] Deny mic permission → clear message and text fallback.
- [ ] Spoken reply: with an Urdu voice installed and without.

**Performance**
- [ ] Task Manager: controller CPU ≈ 0 % idle, memory (note the value).
- [ ] Phone: dashboard scrolling smooth; orb pauses when the tab is hidden.
