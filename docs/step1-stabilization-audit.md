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

## Follow-up — combined checks and snapshot failure fix
- Combined stabilization commit 38f4421d0036a5e1a313b090348d0a683d772ffc: GitHub workflow #279 (44930313374) passed both web/relay and Windows simulated/package jobs; official release skipped. Vercel preview status succeeded. No production deploy or real-device acceptance established.
- Source-level finding: clearing dirty before checkpoint/read could lose a retry after a local exception; ignoring WAL checkpoint row could upload an incomplete main-file snapshot. Candidate now rejects busy/incomplete checkpoint and restores dirty on any local snapshot preparation error. Five isolated mock regression cases added; new combined CI must pass. These do not prove live backup integrity, snapshot freshness, restore or retention.
- Render workspace is not selected; live deployment and backup configuration remain unverified. No production credentials or personal data accessed. No other application data modified.

- Workflow #280 (44930609654): 262 existing TypeScript tests passed, 5 new tests failed because their handcrafted header used a literal backslash-zero rather than a NUL byte. Windows job and Vercel preview passed. Replaced synthetic header with an actual temporary SQLite database; added a real WAL checkpoint and isolated restore/integrity round-trip with mocked HTTP transport. Production backup code is unchanged in this correction. New CI result pending; live restore remains unverified.

## Final audit follow-up evidence and release gates
- Workflow #281 (44930930467) completed successfully on 943896bbd914e4865c6746c131c04ccceba85038: 268/268 TypeScript tests across 16 files, including six backup tests and SQLite integrity round-trip. Windows controller simulation/installer job passed. npm production audit reports two moderate React Router advisories (GHSA-wrjc-x8rr-h8h6 and GHSA-337j-9hxr-rhxg); full npm install advisory count was eight (five moderate, one high, two critical), including dev/build dependencies. The high/critical production gate alone does NOT establish dependency security. Do not run forced major upgrades without compatible lockfile and regression verification.
- Confirmed Render HUKM service (free, single instance, main auto-deploy): deployment dep-dc0ruoavcj2c73bj3lg0 live at baseline f0d001fb8307ddc729d7b61cccfec45c532f151c. Read-only logs on Nov 21 UTC show restore success at 15:58:07 (462848 bytes), and multiple saves, latest observed 16:04:41 (475136 bytes). No production database downloaded or overwritten. These are successful application log events, not independent current snapshot integrity, freshness or retention verification.
- Vercel free build-rate limit remains a deployment gate; no upgrade authorized. Do not merge main simply to bypass this limit: Render auto-deploys main.
- Security source review: Windows credential module silently wrote base64 plaintext on DPAPI failure. Candidate now fails closed, migrates legacy plain credentials before use (no overwrite on failure), uses atomic local write and handles CLI save error. Six isolated regression tests included. Backup auth requests now reject redirects, require safe HTTPS URL, and check downloaded SQLite integrity and migration schema in temporary file before replacement; corrupt-snapshot preservation test added.
- Remaining high-risk architectural gates: live isolated snapshot restore/retention, stale-snapshot conflict resolution and multi-writer prevention (Step 3); real Windows/UI/WhatsApp and update rollback acceptance (Steps 4–7, 15); dependency audit incl dev and Python, compatible updates and license review (Step 2); remote HTTP pairing, strict token/log/privacy boundary verification, repository protection (Step 14, security ongoing). Do not treat these recorded risks as resolved. Current release remains v1.8.4; consolidated draft is not a production release. 
- Step 1 scoped inventory and stabilization report covers reviewed critical paths; full line-by-line audit of 218 files, full vulnerability/secret scanning and production acceptance are not established. Latest security patch must pass combined CI before its test gate can close.
