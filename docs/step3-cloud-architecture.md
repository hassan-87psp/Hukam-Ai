# Step 3 — Cloud-first architecture candidate

Existing Render relay, Vite UI, authenticated HTTP and device WebSocket remain on the same origin. Gemini inference stays cloud-side. Private backup gateway in Milvoy Supabase is existing infrastructure, not a new paid service. Read-only metadata confirmed private HUKM bucket and snapshot relay/hukm.db (479232 bytes, 2026-11-21 18:01:28 UTC). No production snapshot downloaded, copied or overwritten.

## Changes
- All real Gemini chat, planner, diagnostic and consented vision requests share one process-local budget: defaults 6/min, 60/24h and 2 concurrent, configurable via HUKM_GEMINI_RPM, HUKM_GEMINI_RPD and HUKM_GEMINI_CONCURRENCY. These are HUKM protective caps, not official Google quotas or a billing guarantee. Budget resets on process restart. Existing authenticated route limits remain.
- Observe 429 cooldown, reject overload, bound actual streamed response bytes, reject redirects; no automatic retry or alternate paid provider. Existing screenshot consent and action approvals unchanged.
- Backup restoration validates a bounded isolated SQLite file, refuses divergent existing data or pending local journal/WAL, and atomically creates only a missing database. Matching local file is preserved. Divergent state requires owner-reviewed recovery; never delete either copy.
- Tests cover shared quota, concurrent load, failure release, cooldown, streamed byte limits and divergent local snapshot protection.

## Outstanding
Latest CI and actual cloud quota verification; durable cross-restart budget if required; independent live snapshot byte integrity, version retention and multi-writer prevention. Existing gateway uses single-object upsert, not version history. No production deployment or new paid dependency. Vercel free preview quota may block preview independently of Render build-path tests.
