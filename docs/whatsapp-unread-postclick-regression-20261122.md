# HUKM WhatsApp Unread post-click OCR regression — 22 Nov 2026

## Observed on owner Windows laptop
- Connected Windows Controller v1.9.2 successfully opens/restores Personal WhatsApp Desktop.
- Owner-approved command reaches `whatsapp.unread_senders`, local OCR recognizes Unread, the cursor clicks it, and the *second* OCR pass returns without a scan error.
- Actual failure: `Unread filter was clicked but local OCR could not confirm any sender titles alongside their chat timestamps. No names guessed.`
- Second attempt's first OCR missed the header, but 520x920 enlarged crop recovered Chats/Search/All/Unread/Favourites/Groups. The window geometry is therefore no longer the primary blocker.
- Screenshots supplied are Controller logs and HUKM chat, NOT the WhatsApp filtered chat list. Without WhatsApp's real chat-row screenshot or privacy-safe geometry, the exact row layout and whether it is empty remain unverified.

## Source root causes addressed
1. `visible_sender_titles` used fixed x=120..355 text bounds and width-130 clipping, misclassifying a valid multiword title to the right of x355 as absent.
2. Compact fallback required two right-edge-aligned timestamps, rejecting a single visible unread chat.
3. Timestamp formats and single-word split clock tokens were too narrowly handled.
4. Post-click only made one identical raw OCR pass; now a separate local enhanced pass on the SAME screenshot can recover rows even if tiny header text is lost.
5. No privacy-safe row geometry diagnostics existed after the click. Add only counts and rectangles, NEVER raw names/previews/messages.
6. An explicitly empty filtered list can be zero only with selected-filter evidence and explicit app text. An OCR miss alone remains UNKNOWN.

## Security / correctness requirements
- Keep existing physical foreground, window bounds, layout anchors, cursor guard, cancellation and owner approval checks.
- Never return unverified names or infer zero from missing OCR. Never open chats/send replies. Do not upload, retain or log screenshot contents or contact names.
- Simulated CI can verify row parser geometry and installer behavior, but not signed-in native WhatsApp. Release v1.9.3 remains **pending owner-run live acceptance** until the device reconnects, the user invokes approved Unread, and real names or an independently verified empty state result appears.
- If post-click OCR is still ambiguous, inspect only anonymized geometry counters or ask owner for a screenshot with contact names/messages obscured while preserving chat-row and timestamp positions.
