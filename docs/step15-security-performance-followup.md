# Final audit follow-up — bounded recovery and private local journal

Candidate code only. Previous Teach workflow web/backend and npm checks passed; Windows/Python final candidate verification pending.

- Single controller worker, max 16 live commands (existing), bounded original-result retry cache: max 16 entries and 6 MiB serialized payload budget. This is not a measured total process RAM limit. Eviction can lose original local result; relay no-replay protection remains. Dedupe disk journal stores command claims and a small final marker only. Existing valid legacy cached result bodies are logically rewritten on load; not secure erasure of old storage, backups, prior history or filesystem copies. Malformed or oversized journal fails closed. No private OCR/WhatsApp message retained in new journal.
- Backup verifies SQLite integrity and foreign key consistency before install. Size precheck before read; bounded retry backoff, avoid indefinite debounce, authenticated status with last successful upload, dirty and pending indicators. Shutdown closes DB even if final backup fails.
- Full migration-schema synthetic SQLite snapshot rehearsal tests account, project, memory and taught skill persistence. Mock network only, no production snapshot downloaded, restored or changed. Does not establish live retention, multi-writer coordination, independent actual backup recovery or latency limits.
- Final real device idling, workload, actual provider and installer upgrade/rollback verification remain required. No paid API or package introduced. No production release.
