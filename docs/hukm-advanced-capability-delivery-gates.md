# HUKM AI — Advanced Capability Delivery Gates

This document records the owner's requested expansion toward a personal AI operating system. A feature is **not implemented** merely because it appears here. Keep existing Windows controller, web relay, Personal WhatsApp Desktop, and explicit owner approvals intact.

## Gate 0 — Baseline and evidence
- Inventory each requested capability as implemented / partial / missing / real-device-verified.
- Run CI and negative safety tests before merging changes.
- Never claim a successful desktop action from a dispatched command or screenshot alone.
- Preserve per-device pairing and selected monitor; emergency stop must cancel pending input.

## Gate 1 — Reliable visual operator
- Window identity (PID, title, bounds), active monitor, accessibility element + screenshot grounding.
- Observe -> plan -> approve -> act once -> independently verify.
- Stop on stale screenshot, changed window, low confidence, unexpected popup, or disconnect.
- Record minimal redacted action evidence; do not persist screenshots by default.

## Gate 2 — Natural language, memory and skills
- Multi-turn Roman Urdu and English with explicit reference resolution.
- Per-project scoped memory, provenance, timestamps, confidence, corrections, expiry, deletion.
- Demonstration learning only from owner-reviewed, independently verified, safe steps.
- Planner, executor, verifier responsibilities separated; no unbounded retries.

## Gate 3 — Application workflows
- Personal WhatsApp Desktop: full unread pagination, observed-count reconciliation, drafts, reviewed send, delivery evidence.
- Calendar: inspect availability, draft event, approve creation, verify event ID/details.
- ChatGPT browser: use selected signed-in profile, ask/read/follow-up, save approved outputs.
- Files and documents: bounded discovery, read/summarize, reversible edits, approved attachment.
- Cross-app actions require explicit data-source and destination review.

## Gate 4 — Cognitive operations
- Structured screen-state and digital twin, causal diagnostics, adaptive plans, uncertainty thresholds.
- Knowledge graph, temporal memory, conflict resolution, memory versioning and retention.
- Safe task checkpoints, idempotency, dependency graph, offline reconciliation.
- Optional model routing, specialized agents, QA, anomaly alerts and project mission control.

## Gate 5 — Owner acceptance
- Windows installer and checksum verified; controller version matches relay.
- Physical laptop tests on each supported monitor, with fresh screenshots and real UI evidence.
- WhatsApp unread completeness and reviewed send separately tested; no unattended real contact messages.
- Calendar persisted event, ChatGPT response, and file output independently verified.
- Publish a capability matrix with proof links and outstanding limitations.

## Immediate implemented change in this branch
- Starter skills for opening Google Calendar, ChatGPT, Gmail and Google Drive in the browser via existing validated `web.open` action.
- These are **launch-only recipes**, not Calendar event creation, email sending, ChatGPT autonomous conversations, or file operations.
- No production deployment or owner-device actions occur in this branch.
