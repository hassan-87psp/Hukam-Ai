# HUKM v1.6.7 — Phase 6 Release & Deployment Readiness Audit

Date: 2026-11-21. This report describes **code and automation checks**, not permission to control any real account, nor a claim of successful operation on the owner's Windows desktop.

## Objective
Deliver one traceable HUKM Windows Controller build, a server/runtime readiness panel, a read-only production preflight and clear separation between CI, static website deployment, authenticated relay and real laptop testing.

## Phase 6 code deliverables

1. The relay and controller both advertise v1.6.7. `scripts/check-release-version.mjs` fails CI if the Windows version, relay version, setup guide, ZIP name or artifact name disagrees.
2. GitHub Actions builds the consolidated v1.6.7 Windows EXE, installs and smoke-tests it inside an isolated Windows runner, then uploads the nested installer ZIP together with its **SHA-256 checksum file** as one downloadable artifact.
3. `scripts/check-relay.mjs` performs **anonymous, read-only** GET checks against the supplied relay origin: `/api/health` returns JSON and the expected version, `/api/auth/status` returns the owner setup state, and `/api/runtime/status` refuses unauthenticated access with 401. Remote HTTP, auth embedded in URLs, redirects, HTML/static Pages and mismatched versions fail closed. It never sends cookies, usernames, tokens or commands.
4. The Dashboard shows an **authenticated runtime readiness card** with real relay-reported version, connected/paired controller count, Gemini configuration and pending approvals, and explicitly says Gemini reachability and actual laptop side effects remain unverified.
5. The tests run a disposable loopback relay and simulated HTML-only server to prove the deployment preflight recognizes real API behavior and rejects a static website, stale version or insecure URL.
6. README/current version guidance is updated so the historical Version 1 checklist does not misrepresent current capabilities.

## Important deployment distinction

- **GitHub Actions success:** code compiled and test environment behaved as asserted. It is not a real device or third-party account acceptance test.
- **GitHub Pages success:** only a static publishing workflow. The React app requires same-origin Node `/api` and `/ws` routes; GitHub Pages alone cannot operate the laptop and can misleadingly display an offline session.
- **Hosted HUKM relay:** required for shared web app, authentication, database, approvals, project memory and WebSockets; must stay online and use durable/restore-safe database storage.
- **Render:** public URL documented in Windows setup is `https://hukm-ai-relay.onrender.com`. At this audit the public health page could **not be independently retrieved** from the research browser. The connected Render tool requires selecting and confirming the correct workspace before accessing services/deploys. No Render deployment was triggered.
- **Real Windows Controller:** none of the automated tests confirm the user's personal WhatsApp Desktop, actual mouse/keyboard input, accurate Roman Urdu voice, active browser profile, microphone, multi-monitor DPI or Windows Autostart after reboot.

## Build integrity and update procedure

After a successful GitHub Actions build on `main`, open its Artifacts section and download `HUKM-Windows-Controller-v1.6.7`. Unzip the **GitHub artifact wrapper** to obtain:
- `HUKM-Windows-Controller-v1.6.7.zip` — consolidated Windows package.
- `HUKM-Windows-Controller-v1.6.7.zip.sha256` — expected hash.

On Windows PowerShell, run `Get-FileHash .\HUKM-Windows-Controller-v1.6.7.zip -Algorithm SHA256`, compare with the hash in the .sha256 file, and only then extract/install the inner ZIP. Keep prior pairing config, local data folder and the rollback EXE.

**Do not replace an existing live relay database or remove Windows credentials just to update the executable.** Backup and check account/data recovery first.

## Deferred acceptance checklist

The user explicitly deferred laptop testing. Therefore the following remain open and should **not** be marked complete by the next automated CI success:

- A. Confirm the actual Render service, correct workspace, environment and deployment commit; verify real backend /api health/owner auth and WebSocket connectivity with authorized access.
- B. Confirm the HUKM controller connects to the correct relay after a clean Windows install and reboot; pair one existing device without creating a duplicate.
- C. Test actual four-monitor mouse/keyboard actions, DPI, Notepad, Explorer and Chrome in the allowed foreground.
- D. Test Personal WhatsApp contact selection/read/draft/attachment and consented send only with test contacts; verify no wrong-contact leakage or duplicate sending.
- E. Test Roman Urdu/English mic input, playback, interrupted speech and browser permissions on the user's phone and Windows laptop.
- F. Test legitimate provider-account identity, email drafts and Calendar editor; official OAuth-backed reading/sending/confirmed event creation is **not implemented** in v1.6.7.
- G. Test Project A vs Project B chats/memory/tasks, owner approvals, restart recovery, interrupted work and cloud backup restore on production without overwriting newer user data.
- H. Test external image/ChatGPT download flows; final generated file, account state and expected output are not guaranteed.
- I. Review repo visibility, production secrets, domain, firewall, HTTPS, cookie proxy headers and data retention before production announcement.
- J. Collect acceptance outcomes, errors and screenshots without uploading personal chats, passwords or tokens by default.

## CLI

```bash
npm run check:release
npm run check:relay -- --url https://YOUR-AUTHORIZED-HUKM-RELAY --expected-version 1.6.7
```

Preflight results are scoped: **relay reachable**, **owner API available** and **anonymous private endpoint blocked** only. They never claim controller online, Gemini live working, actual emails/WhatsApp messages sent or desktop actions performed.
