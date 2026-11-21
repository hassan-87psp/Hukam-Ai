# Security

HUKM can act on a personal computer, so security is part of the product, not an add-on.

## Current v1.7.0 safety boundaries

**Windows Stop, pause and disconnect are best-effort safeguards, not a promise to undo a completed click.** The controller registers a cancellation signal before asynchronous command dispatch, remembers early cancels, invalidates work from disconnected WebSocket sessions and serializes OS input. If Stop arrives after an irreversible click, the result is `INTERRUPTED_UNVERIFIED`; HUKM does not claim success or automatically retry. Verify the target app yourself before sending another command.

**Current WhatsApp scope:** Personal WhatsApp Desktop has explicitly reviewed Send actions for an exact selected recipient/message or attachment. Unlike the original V1, sending is possible after separate owner approval, but delivery is **not** independently confirmed. It is not a bulk messaging tool. Sensitive GUI controls, payments, file deletion and system command execution are blocked or require dedicated reviewed actions.

**UI action safety:** The owner first inspects visible UIA controls. The inspection fingerprint is bound to foreground window identity and labels, expires in 90 seconds and can be consumed only once. Generic Send, Pay, Upload and Delete buttons are blocked. Manual desktop mouse/keyboard input is also owner-reviewed and allowlisted; this is not guaranteed safe against every third-party page.

**Outstanding production risks:** no completed real-laptop or WhatsApp acceptance test; no official OAuth-backed Email read/Send; unverified Calendar Save; no provider-confirmed screenshot result; no full autonomous visual outcome verification. Review production secrets, repository visibility, HTTPS proxying, backup restore and startup controls before live use.

## Original V1 threat model (historical)
| Threat | Mitigation |
|---|---|
| Stranger claims a freshly deployed relay | First account needs the **setup code printed in the relay console**; only one owner account can exist. |
| Password guessing | scrypt (N=16384) hashes; 10 attempts / 5 min per IP and per email; failed logins audited. |
| Stolen browser session | httpOnly, SameSite=Lax cookie (`Secure` behind HTTPS with `TRUST_PROXY=1`); sessions listed and revocable; password change signs out other sessions; 30-day expiry. |
| CSRF | Every authenticated state-changing request must carry `x-hukm-client: web` (cannot be set cross-site without CORS, which the relay never grants) and a JSON content type. |
| Cross-site WebSocket hijacking | `/ws/client` checks the `Origin` host against the request host (plus `ALLOWED_ORIGINS`). |
| Rogue “laptop” connects | Devices need a **single-use, 10-minute, 8-character pairing code** created by the logged-in owner (10 claims / 10 min per IP). Device tokens are 256-bit random, stored only as SHA-256 hashes on the relay, DPAPI-encrypted on the laptop. |
| Compromised web account widens access | Allowed folders, allowed apps and screen capture are configured **on the laptop**. The web app can only *narrow* capabilities. |
| Malicious/odd command text | The original V1 used a small deterministic allowlist; current releases also use reviewed Gemini plans and separately approved, validated actions. No shell or unrestricted scripts are available to the AI. |
| Path tricks | `..`, UNC paths and anything outside allowed roots are refused (checked on relay **and** controller); executables/scripts (`.exe .bat .ps1 .lnk .vbs …`) are never opened. |
| URL tricks | Only `http/https` without credentials; `file:`, `javascript:` etc. rejected. |
| Replay / duplicates | Idempotency keys on the relay; executed-ID store on the controller. |
| Silent surveillance | No continuous capture, no webcam/mic on the laptop. Screenshots need approval by default, are stored privately (auth-checked endpoint) and deleted after the retention window (default 24 h). The controller is a visible console window. |
| Consequential actions | V1 did not support sending messages. In current versions, exact-recipient WhatsApp Desktop sending is a separately reviewed action with unverified delivery; do not use V1 limitations as the current security policy. |
| Runaway activity | Emergency stop (pause all devices + cancel commands), per-device pause, unpair = immediate token revocation, rate limit 60 commands/min. |
| Abuse of WhatsApp | Original V1 drafted messages only; current versions also permit a single explicitly reviewed Send to a verified selected contact, without automatic retries. |
| Privileged credentials leaking | There are no service-role keys anywhere. The relay holds the only database. |

## Headers
API and static responses send `Content-Security-Policy` (self + Google Fonts), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: microphone=(self)`.

## Audit trail
`audit_logs` records logins (and failures), pairing, connects, renames, capability changes, pause/resume, unpair, every command created/approved/rejected/cancelled/completed/failed, settings changes, screenshot deletion. Visible under **Activity History → Audit log**; retained per the history retention setting.

## Operational advice
* Always expose the relay over **HTTPS** only.
* Keep `data/` private and backed up; it contains the database and screenshots.
* Use a long unique password; sign out sessions you don't recognise (Settings → Security).
* Remove devices you no longer use (Devices → Remove).
* Known gaps: no 2FA yet, no per-user encryption at rest of the SQLite file, unsigned controller exe — see roadmap.
