# Step 13 — Responsive control centre candidate

Existing dark HUKM theme, all original navigation and commands remain. Added responsive dashboard Control Centre with relay sync, ready devices, recent active task counts and approvals; system and controller-process metrics explicitly distinguish unavailable from zero, and offline telemetry is suppressed in the centre. Recent task progress and explicit cancellation use existing authenticated operator routes, paused tab polling, no new dependency. Counts are limited to recent 40 runs, not lifetime totals.

Project/memory, Skills/Teach, device diagnostics and history quick links. Reduced mobile hero height, responsive desktop grid, scrollable mobile menus and mobile header Stop. Stop failures are visibly reported rather than falsely claiming success. Stop is still relay-level and cannot undo actions already delivered.

Selected-device and monitor-specific screenshot history, explicit monitor selection and request approval; no continuous capture or guessed live status. Older controller compatibility and actual display numbering remain acceptance gates. Existing screenshot record is retained, not a live stream.

Tests cover formatting/progress semantics; typecheck/build and responsive visual/real-laptop acceptance remain required. No production deployment or paid library.
