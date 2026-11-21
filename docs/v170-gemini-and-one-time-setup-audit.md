# HUKM v1.7.0 — Gemini and One-Time Windows Setup Audit

## Verified from current repository (2026-11-21)
- The HUKM Node relay has authenticated owner APIs, persistent SQLite Projects, independent approvals and a Gemini text chat adapter and separate structured planner.
- Both Gemini paths use `GEMINI_API_KEY` **on the relay server only**. Default configured model is `gemini-3.5-flash-lite`; it is a documented Gemini API model, but access/quotas/response quality depend on the owner's Google project, location and live service.
- A successful GitHub Actions CI test confirms mocked Gemini response handling and supervised plan validation. It **does not** prove the production Gemini API key works, that the model responds now, that Roman Urdu is accurate or that a laptop task succeeded.
- The website Settings > AI engine now has an **owner-initiated Test Gemini Connection** button. It calls authenticated `POST /api/ai/diagnostics` (CSRF checked, quota-limited), tests **one harmless chat and one non-executing planned action**, and shows separate model, latency and sanitized failure-code results. It never sends private chat, screenshots, Project notes, WhatsApp contents or credentials and never executes a proposed plan. Model output is not displayed or stored.
- If the Gemini API key is unconfigured, the diagnostic reports this; it does not fabricate successful connectivity. Both tests may consume small Gemini API quota.
- The Devices screen compares the actual reported controller version with `/api/system` instead of stale hard-coded v1.6.0 / v1.4.1 text.
- A **separate one-file Inno Setup EXE** packaging workflow was added to Windows CI in addition to the legacy ZIP. It installs the controller in the current Windows user's LocalAppData without requesting administrator permissions or enabling autostart by default. Existing AppData pairing is not erased. The EXE and its SHA-256 checksum are built and tested on a temporary Windows runner profile.
- **Do not confuse a build artifact with a production download:** GitHub Actions artifacts themselves may be delivered in an outer ZIP; direct website distribution is still pending. The one-file Setup EXE is currently unsigned, so we do not auto-publish it as a trusted production installer.

## What requires the owner's real environment
1. **Gemini live authentication**: the deployed relay needs `GEMINI_API_KEY` and access to its selected model. Run Settings > AI engine > Test Gemini Connection **after** the live backend is confirmed.
2. **Render selection**: connected Render account reports workspace `My Workspace`, but the Render service tool requires owner confirmation of workspace before inspecting service/deploys. Do not silently select it.
3. **Live backend**: attempts to retrieve `https://hukm-ai-relay.onrender.com/api/health` via public research browser were inaccessible. This is *not* conclusive proof the website is down; it means live health is unverified here.
4. **Windows actual device**: controller installed, signed-in user, paired token persistence, reboot, Start/Stop, four monitors and actual personal WhatsApp Desktop have not been accepted on the user's laptop.
5. **Voice**: Web Speech recognition / Roman Urdu translation are device/service dependent and have not been measured against real microphone input.
6. **Email & Calendar**: browser compose/event drafts exist; OAuth-backed verified email reading/Send, event IDs/invitations and account bindings remain unimplemented.
7. **Cloud files and ChatGPT downloads**: no general-purpose independently verified file manager/editor or guaranteed media downloads.
8. **Repository security**: GitHub repository is currently public. Production secrets must never be committed. Confirm hosting compatibility before switching visibility.
9. **Production auto-updates**: not yet implemented. A trusted website-managed updater needs a signed or attestable release manifest, pinned update origin, SHA-256 verification, explicit owner approval, safe download staging, automatic rollback and no uncontrolled background installation. A one-file Setup EXE alone does not solve subsequent updates.

## Acceptance sequence before calling HUKM production ready
- Verify Render workspace/service/commit and live HTTPS `/api/health`, persistent DB backups and authenticated WebSocket.
- Run Settings > AI engine > Test Gemini Connection. Both Chat and Planner must return a live response. This only verifies momentary availability, not answer correctness.
- Test one-file Setup EXE on a real Windows machine and confirm pairing survives an update without duplicate device records or unwanted Autostart.
- Test approved mock UI actions, WhatsApp Desktop non-sensitive test chat, audio and saved Project workflows.
- Implement safe website-driven update checks and signed / checked releases, then test update failure/rollback and lost connection.
- Review results with the owner. Never mark software 100% accurate on mocked tests alone.

## Current interim behavior
The owner may use the website for cloud/relay chat and supervised tasks when the relay is actually online. To act on the owner's **personal** Windows laptop, a local Windows Controller remains necessary due browser sandbox security. The requested one-time installer is being prepared; later website-based update controls require separate implementation and acceptance.
