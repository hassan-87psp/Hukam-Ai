# HUKM v1.6.4 — Phase 3 Personal WhatsApp Desktop Safety & Reliability

## Scope
HUKM operates the owner's **installed, already-logged-in Personal WhatsApp Desktop**. It must not silently open WhatsApp Web or a different browser profile. Every sensitive action requires the owner’s separate approval. Results from OS/UI automation do **not** prove WhatsApp server delivery.

## Changes in 1.6.4 (code-level / simulated tests)
1. Single foreground OS worker: no parallel WhatsApp chat selection, message reading, draft, attach or Send requests can interleave with other HUKM app/window input.
2. Atomic command ID claim: duplicate WebSocket delivery can no longer race through separate seen/mark_started checks and perform the same action twice.
3. Queued cancelled actions: after an OS UI action times out or is cancelled while waiting, Executor refuses it before interacting with the laptop.
4. Named contact read verifies native WhatsApp window AND exact selected recipient both before and after reading visible text; if switched, private text is discarded.
5. Unread sender scan fails if WhatsApp loses foreground during inspection; the tree is refreshed after selecting the Unread filter and duplicate/ambiguous filter matches are rejected.
6. Existing safeguards retained: exact-contact selection; no browser fallback; recipient/draft comparison before reviewed Send; attachment filename/bytes pinning; no automatic retry after uncertain Send; offline-only read-aloud option; bounded visible content.
7. Added regression tests for parallel commands, duplicate IDs, cancellation, contact/window switching and unread focus loss.

## 11-point acceptance matrix

| # | Requirement | Static/simulated implementation | Real Windows acceptance |
|---|---|---|---|
| 1 | Single controller instance | Existing | Pending |
| 2 | Installed Personal WhatsApp Desktop only | Existing | Pending |
| 3 | No wrong Chrome profile/Web fallback | Existing | Pending |
| 4 | Recognize actual native WhatsApp window | Existing | Pending |
| 5 | Open/focus correct app | Existing | Pending |
| 6 | Unread count is honest (UNKNOWN is not zero) | Existing | Pending |
| 7 | Unread sender filter/title check | Hardened | Pending |
| 8 | Exact recipient selection | Existing | Pending |
| 9 | Named chat read with no cross-contact transfer | Hardened | Pending |
| 10 | Draft/attachment/Send with separate approvals | Existing + serial execution | Pending |
| 11 | Reconnect, cancellation, dedupe and error recovery | Hardened | Pending |

## Acceptance rules before claiming fully operational
- On a real Windows desktop, test selected contact, read, draft, attachment preview and reviewed send **only with designated test contacts**.
- Before an external Send, display exact recipient, message or filename in the approval card.
- If UIA cannot verify a name, draft, active window or preview, fail closed and ask for manual assistance. Never guess.
- If a Send click was attempted but app/delivery state is unknown, report **unverified** and never retry automatically.
- Test one- and two-monitor configurations, WhatsApp UI updates, minimized and maximized windows, reconnects, queued and expired commands.
- Do not upload personal chats or screenshots to Gemini by default.
- Automated CI validates code/simulation only; it does not prove operation with a real WhatsApp account.
- User requested real laptop acceptance later; do not install or send messages now.
