# HUKM v1.9.7 — Owner-supervised Live Vision acceptance

This is a **testable Windows Controller build**. It includes local screen
preview support and safe UI navigation. Passing GitHub CI alone is **not**
evidence that Personal WhatsApp, calendar, Chrome, or multi-monitor real
account tasks succeed.

## Current capabilities under test

- **Live Screen:** HUKM website > Devices > paired laptop > Live Screen.
  Choose a *physical* monitor 1–N reported by Windows, click Start, approve
  the exact monitor in the local Windows popup. Up to 90 seconds/around 1 FPS,
  bounded in-memory frames. Website Stop, emergency pause, browser disconnect,
  or session expiry must terminate it. No frame persists to HUKM screenshot
  history or gets sent to Gemini by this preview.
- **Observe → Click → Verify:** UIA detects exact safe controls in the current
  supported foreground app. The separate approved command clicks once. It
  verifies a unique expected control in the *same* window and PID. **Not
  verified** means the click might have happened; never retry blindly.
- **WhatsApp Personal Desktop:** still requires exact chat/recipient
  verification and separate Send review; full unread sender coverage and
  negative tests must run against the owner's installed WhatsApp version.
- **Calendar / ChatGPT:** browser-specific reviewed drafts and signed-in
  profile, with separate action approvals and verification. A UI click is
  not API-level proof that a Calendar event was created or ChatGPT content
  finished downloading.

## Before installing

1. Confirm https://hukm-ai-relay.onrender.com/api/health replies with
   JSON version `1.9.7`. If Render is still older, **do not** use a new
   Controller against the mismatched relay protocol.
2. Verify the GitHub release EXE checksum against its paired `.sha256`.
   This installer is **unsigned**; a checksum alone does not prove publisher
   authenticity. Avoid any unofficial download or auto-install.
3. Make sure HUKM backup, login and paired device are available. Do not
   remove existing pairing or delete `%APPDATA%\\HUKM AI`.
4. Close the old Controller, run the one-file official
   `HUKM-Setup-v1.9.7.exe` interactively and retain the previous executable
   and Restore Previous Controller shortcut. Confirm `--version` says 1.9.7.
5. Resume HUKM, check that Devices reports the new version. Never interpret
   installer launch alone as installation success.

## Real laptop tests (do not use test messages to real people)

- [ ] Sign in from Android and from Chrome; ensure same owner account and
      paired machine appear, no new pairing necessary
- [ ] With laptop online, open Devices > Live Screen, select Monitor 1,
      approve locally, see moving preview, Stop and verify all frames stop
- [ ] Repeat Monitor 2 and Monitor 3 if physically connected; ensure
      wrong/unavailable monitor cannot start or silently switch
- [ ] Use Pause control during live view; verify the feed ends immediately
      and cannot resume until explicitly authorized again
- [ ] Use a harmless Notepad/Chrome test page, inspect safe UI controls,
      approve a single navigation, verify the *new* expected UI control
- [ ] Force missing/ambiguous target: no click, no fabricated completion
- [ ] Force missing expected result *after* a click: run is unverified, the
      next computer step is not executed, no automatic second click
- [ ] Personal WhatsApp Desktop Unread: compare all names/count with the
      app (10/10 rather than claiming 2/10 complete); use test chat only for
      reviewed reply and approved Send
- [ ] Chrome profile, ChatGPT, Calendar: verify signed-in matching account,
      multi-turn context, exact draft/Save boundaries and result status
- [ ] Confirm Render backup restore/flush, release SHA, and rollback on
      a second restart before calling release operational

## Deployment blocker

On 23 Nov 2026, Render's `hukm-ai-relay` service had a LIVE deployment
of older commit `8524f53a...` (v1.9.5) although GitHub `main`
had newer successful CI. Check **Issue #58** before assuming a GitHub
merge updates the website. Protect existing users, paired devices, chats,
projects and backup before an infrastructure change.

## Not implemented

No all-app autonomous live-video agent; no unattended sending, password
access, arbitrary shell, hidden controls, automatic WhatsApp delivery
verification, or perpetual remote screen recording. All impactful actions
retain the owner's explicit approval.
