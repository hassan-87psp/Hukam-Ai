# HUKM Step 1 — Stabilization audit (2026-11-22)

Status: integration candidate; do not treat this as a release or completed audit. Main baseline: f0d001fb8307ddc729d7b61cccfec45c532f151c (v1.8.4). Source recovery branch: audit/step1-baseline-v1.8.4. No live database or device configuration has been copied or changed.

## Inventory and verified evidence
- Baseline recursive Git tree: 218 tracked files, not truncated. Inventory is not a line-by-line review of all files.
- Reviewed README, architecture/security/deployment notes, root/web/relay package manifests, Python runtime/dev requirements, relay config/db/backup and server startup/flush call sites, CI workflow and PRs #38/#40/#41 (including test patches).
- Existing lightweight controller dependencies already include psutil, MSS, Pillow, Windows OCR projections, pywin32 and uiautomation. Do not install duplicate automation stacks or heavy local AI models by default.
- Relay is Node 22.13+ with SQLite and WebSockets. React Vite PWA needs the authenticated relay API, not an independently hosted static page alone.
- Existing optional SQLite snapshot adapter uses a separate private storage endpoint with server-side credentials. Presence of code does not establish production configuration, data integrity or restoration.
- Prior individual PR workflow runs 44926032730, 44926929545, 44928096693: web/relay typecheck, npm production high/critical audit, tests/build; simulated controller unit/relay E2E, Windows package and installer smoke tests all succeeded. Official release job skipped. These runs do not establish combined results or personal Windows/WhatsApp acceptance.

## Changes in candidate
- Combine reviewed PRs #38 (OCR independent header fallback), #40 (updater cancellation) and #41 (desktop input checks). Copy unchanged blobs from proposal heads; combine only two non-overlapping executor call sites, with exact comparison to individual heads.
- Add missing .gitignore for local runtime databases, configuration/credentials and generated outputs. Does not remove any tracked files or scrub historic secrets.
- No dependency installs, database migrations, release version changes or production deployment.

## Open findings / release gates
1. **High — data durability:** backup.ts accepts an optional HTTPS snapshot URL/token; startup calls restoreCloudSnapshot before opening SQLite. Existing snapshot may replace local database, and current validation checks size/header rather than complete integrity, freshness or rollback history. Snapshot checkpoint result and retry behavior need review. Verify actual backup configuration, isolated restore/integrity checks, snapshot retention/versioning and failure recovery before changing production data or hosting. Do not restore over newer data or reuse unrelated application tables. No live backup verified here.
2. **High — real desktop safety:** actual focus, mid-action interruption, multi-monitor DPI, native UIA and Personal WhatsApp Desktop remain unverified; mock and installer smoke tests are not acceptance.
3. **High — deployment:** historical PR Vercel check failed with build-rate-limit. Verify actual Render relay version and same-origin /api and /ws, avoid unnecessary preview builds and paid upgrades. No production settings changed.
4. **Medium — supply chain:** npm high/critical production audit passed only for individual runs. Python ranges/dev dependencies are not fully pinned; no independent Python vulnerability/license/secret scan or resolved dependency lock verified. Review before introducing additional third-party code.
5. **Medium — updater trust:** fixed GitHub asset source, SHA-256 and local owner confirmation are existing safeguards; installer is unsigned and checksum shares release trust boundary. Stop is cooperative, not atomic; cannot reverse started installer or click. Keep immutable release versions, verify installed version after reconnect, and test rollback separately.
6. **Medium — repository policy:** main branch API reports protected=false. Review free available branch/ruleset protections and restrict release authorization; do not assume protection is configured.
7. **Medium — privacy:** existing docs describe explicit approval and no arbitrary shell. Verify model input boundaries and logs, data retention, no credential/OTP capture and consent for sensitive actions. Current code has not received a full security review.
8. **Medium — feature gaps:** README documents Gmail/Outlook links only, calendar unverified, actual personal WhatsApp unverified, and real-desk acceptance outstanding. Preserve distinction between code and deployed functionality.

## Exit gates
- Combined CI green, compare changed files and no unrelated changes.
- Review remaining source/security/dependency findings and record scope and unresolved risks.
- Confirm live backup/isolated restore before any data-affecting deployment; do not infer backup merely from source branch.
- No automatic merge or v1.8.4 asset replacement. Release separately with new version and successful real Windows acceptance.
- No paid service or API activated. Keep cloud-first design and lightweight controller.
