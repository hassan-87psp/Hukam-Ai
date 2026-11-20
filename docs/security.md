# Security

HUKM can act on a personal computer, so security is part of the product, not an add-on.

## Threat model (V1)
| Threat | Mitigation |
|---|---|
| Stranger claims a freshly deployed relay | First account needs the **setup code printed in the relay console**; only one owner account can exist. |
| Password guessing | scrypt (N=16384) hashes; 10 attempts / 5 min per IP and per email; failed logins audited. |
| Stolen browser session | httpOnly, SameSite=Lax cookie (`Secure` behind HTTPS with `TRUST_PROXY=1`); sessions listed and revocable; password change signs out other sessions; 30-day expiry. |
| CSRF | Every authenticated state-changing request must carry `x-hukm-client: web` (cannot be set cross-site without CORS, which the relay never grants) and a JSON content type. |
| Cross-site WebSocket hijacking | `/ws/client` checks the `Origin` host against the request host (plus `ALLOWED_ORIGINS`). |
| Rogue “laptop” connects | Devices need a **single-use, 10-minute, 8-character pairing code** created by the logged-in owner (10 claims / 10 min per IP). Device tokens are 256-bit random, stored only as SHA-256 hashes on the relay, DPAPI-encrypted on the laptop. |
| Compromised web account widens access | Allowed folders, allowed apps and screen capture are configured **on the laptop**. The web app can only *narrow* capabilities. |
| Malicious/odd command text | Text is parsed into one of 20 allowlisted actions with validated arguments. No shell, no `eval`, no free-form scripts — not from text, voice, automations or a future AI provider. |
| Path tricks | `..`, UNC paths and anything outside allowed roots are refused (checked on relay **and** controller); executables/scripts (`.exe .bat .ps1 .lnk .vbs …`) are never opened. |
| URL tricks | Only `http/https` without credentials; `file:`, `javascript:` etc. rejected. |
| Replay / duplicates | Idempotency keys on the relay; executed-ID store on the controller. |
| Silent surveillance | No continuous capture, no webcam/mic on the laptop. Screenshots need approval by default, are stored privately (auth-checked endpoint) and deleted after the retention window (default 24 h). The controller is a visible console window. |
| Consequential actions | Always need explicit approval: WhatsApp drafts, locking. Configurable approval for screenshots, opening files/apps/sites. Approval cards show the exact action and target. Not possible at all in V1: delete/modify files, install, shutdown, payments, sending messages. |
| Runaway activity | Emergency stop (pause all devices + cancel commands), per-device pause, unpair = immediate token revocation, rate limit 60 commands/min. |
| Abuse of WhatsApp | Only saved contacts, one draft at a time, user presses Send; never bulk. |
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
