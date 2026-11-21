# Step 15 — HUKM v1.9.0 release candidate and acceptance gates

Status: NOT approved for production release. Candidate branch only; existing v1.8.4 remains live and existing release assets are immutable. Candidate version aligned across relay, controller, setup, packaging guide and CI. Official publication now requires explicit manual workflow dispatch on main and both test jobs succeeding; do not use this as a substitute for acceptance.

## Evidence before candidate version bump
- Step 14 commit 240f26b23181952ed8a37e19297adc6c39d77cec: quality run 44936107071, TypeScript/build/relay job 136942972471, 292/292 passed (22 files), dependency audit zero known advisories, version check 1.8.4 succeeded. Windows and Python exact candidate verification not yet confirmed at this checkpoint.
- 24 commits ahead of unchanged main f0d001fb8307ddc729d7b61cccfec45c532f151c; all 14 development phases recorded in docs. Draft PR #42.

## Release candidate changes
- v1.9.0 contract, manual publication gate instead of automatic main release, verify both ZIP and EXE checksums. No release published or deployment initiated.
- Persist command start marker before action, refuse execution on journal failure, fail closed on corrupt journal, preserve prior claim when result save fails. Atomic temp file and fsync. This is bounded single-process deduplication, not proof of exactly-once input or durable cross-process locking.
- New tests verify disk-write failure and corrupt journal behavior.

## Required gates before release
1. Latest SHA: TypeScript, all relay and Python tests, npm full audit, Python resolved audit, frozen executable smoke, repeat install and recovery. Check version and artifact checksums.
2. Secure independent restore of live private snapshot, schema/data integrity, rollback rehearsal, snapshot retention and single-writer protection. Never overwrite production during test.
3. Real owner-controlled Windows acceptance: pairing, disconnect/reconnect, Stop, CPU/RAM idle and load, two or more monitors with mixed DPI, correct app/Chrome profile, Personal WhatsApp unread/read/draft/send/attachment to approved test recipient, exact file search, local confirmation and repeated update/rollback. No real account sends by unattended CI.
4. Verify natural Roman Urdu and context, user/project isolation, eight memory categories, 30 recipes against installed apps, Teach Mode scope (named fixed recipes only), reviewed correction context. Full demonstration-based learning and broader generic OCR remain incomplete.
5. Browser/phone visual checks; Calendar event ID and invitations/reschedule, email read/send, actual ChatGPT generated artifact provenance and automatic project-folder saving remain incomplete. Do not represent draft/open actions as finished provider actions.
6. Confirm cloud plan limits, Gemini live reachability without paid fallback, production health and backup, and version compatibility. Vercel preview quota is external; do not upgrade automatically. Artifacts are unsigned; explicit local review required.

Owner PC metrics and live provider outcomes are not supplied by simulated CI. No promise of bug-free or unlimited free cloud usage. No additional paid service introduced.
