# Step 2 — Free software integration (native adaptation candidate)

## Scope, cost and upstream sources
- OpenClaw (MIT): https://github.com/openclaw/openclaw and https://github.com/openclaw/openclaw/blob/main/docs/tools/skills.md — controlled skill catalog and authorization enforced outside model text.
- Microsoft UFO² (MIT): https://github.com/microsoft/UFO and https://microsoft.github.io/UFO/ufo2/overview/ — app-specific execution, native accessibility and visual fallback, verification separate from input.
- Browser Use (MIT): https://github.com/browser-use/browser-use — real browser state and validated interactions. Current upstream uses a model-driven Python REPL; HUKM must NOT import arbitrary-code execution or cloud browser subscriptions.
- This change is original HUKM implementation informed by public architectures, not installation, vendoring or a fork of those projects. No third-party source files incorporated. Upstream license applies to upstream code; if later importing files, pin revision and preserve required notices, review transitive dependencies.
- Keep existing PyWinRT, UI Automation, pywin32, MSS, Pillow, psutil, websockets, Node and SQLite. No new heavy Python/Node runtime libraries, second gateway, local LLM, cloud-browser subscription, or paid service. Existing Gemini and hosting quotas still apply.

## Implemented in candidate
- Central static tool registry with 37 existing allowlisted action names grouped by application family. Gemini's catalog and server validation use the same source; removes prompt/validator mismatch (ui.activate was advertised but rejected). No authorization expansion or model-provided executable skills. This is not the 30 verified starter workflows in Step 11.
- Browser adapter now propagates cancellation, checks foreground visibility and target identity, rejects obscured mouse targets, blocks unknown/password typing, checks each character and keeps input-delivered distinct from website success.
- Tests exercise registry parity, restricted actions, approvals, cancellation, focus change, password detection, overlap and unverified browser results.
- Existing WhatsApp OCR, native UIA inspection and other audited controller guards remain unchanged. No CDP/Playwright connection to the personal Chrome profile, arbitrary JS/Python, clipboard reads or remote-debugging port enabled.

## Step 1 evidence carried forward
Workflow #282 (44931745524) passed on bf87a43a344e1505322b18c9d77d4aaf3f98d568, including 269 TypeScript tests and Windows controller/installer checks. The draft is based on the intact v1.8.4 production baseline. Targeted 14-file secret pattern scan found no matching keys; inventory 223 files, no typical tracked credential/database/private-key filename. Full historical scanning and independent live restore are not certified. Render logs previously showed successful save/restore; no data copied or modified. npm production audit has two moderate React Router advisories; dev install reports high/critical advisories too; Python audit and compatible dependency remediation still required. Vercel preview limited by free build quota. No release or paid upgrade.

## Exit and later phases
Latest combined CI must pass before this change is considered regression-verified. Native personal Windows acceptance, browser focus performance, actual Chrome profile interaction, dependency vulnerability remediation, privacy review, cloud quota and data recovery gates remain open. Do not call this full OpenClaw/UFO/Browser Use parity. No production merge or new release until version and release gates are met.

## Static follow-up review
- Removed the remaining legacy allowlist reference from deterministic command routing, ensuring both planner and no-model route use the same registry.
- Workflow #282 Windows logs: 190 passed, 1 skipped; official release skipped by design.
- Existing npm lockfile v3 licenses (entries, not unique projects): MIT 253, ISC 12, Apache-2.0 5, CC-BY-4.0 1, BSD-3-Clause 1, 4 not recorded. This metadata scan is not a legal certification. Existing React Router 6.30.6, Vite 5.4.21, Vitest 2.1.9, esbuild 0.24.2/0.21.5/0.28.2 and ws 8.23.0 remain unchanged. Resolve known advisories before release; avoid force upgrades.
