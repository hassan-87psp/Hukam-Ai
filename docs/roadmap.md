# Roadmap

## Next (V1.1)
- Run the manual Windows test guide; fix anything it finds; publish a signed `hukm-controller.exe`.
- Tray icon for the controller (status + pause) instead of a console window.
- Autostart option at Windows sign-in (opt-in).
- Two-factor authentication (TOTP) for the owner account.
- Benchmark voice accuracy for ur-PK / en-PK / hi-IN on real phones; tune the phrase dictionary from failures.

## V1.2 — richer control (each behind approval rules)
- Browser extension adapter: switch tabs, read current URL, click a result, pause/play video.
- Mouse/keyboard input (type text into the focused window) with per-action approval.
- Close app gracefully (WM_CLOSE, so apps prompt to save) — approval required.
- File preview thumbnails sent to the phone (images/PDF first page), size-capped.
- Scheduled automations with a visible schedule list, per-run notifications and a global kill switch.

## AI connectivity (optional, never required)
1. Verify “Sign in with ChatGPT” plan-usage eligibility on the laptop (steps in integration-status.md).
2. If eligible: `ChatGPTPlanProvider` in the controller — free-form text → HUKM function tools → same validation → same approval rules.
3. Optional self-hosted model provider on a separate machine.
4. Optional paid-API provider, off by default and clearly labelled.

## Platform
- Optional Postgres/Supabase backend (schema maps 1:1; add RLS policies).
- Multi-device targeting in the composer (“on the office PC…”).
- Natural cloud TTS voices for Urdu as an opt-in engine.
- Official WhatsApp Business Platform adapter (for business numbers) — read/send with templates and consent.
