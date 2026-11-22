# HUKM WhatsApp full unread list and supervised reply — v1.9.4

## Owner-reported evidence
- HUKM Windows v1.9.3 successfully opened/minimized Personal WhatsApp Desktop, clicked the Unread chip and returned 2 verified visible names.
- The user reported a 10-chat badge and requested ALL names, in one completed answer.
- The existing routine captured just the first 520x920 sidebar viewport and never scrolled the native Unread chat list. A green Completed result was possible with only 2/10 names.
- Contact selection, selected-chat reads and draft typing were UIA-only on a WhatsApp Desktop build where previous UIA probing exposed no Unread controls.

## v1.9.4 source changes
- After the approved Unread filter is positively verified, scan bounded subsequent left-sidebar pages via a mouse WHEEL event only inside a verified WhatsApp window/left chat list. Revalidate foreground and window geometry each page. No chats open, no message bodies read or transmitted.
- Every reported sender must be backed by an on-device OCR title and row timestamp. De-duplicate, cap at 100 names and 12 pages/65 seconds. Do not claim full coverage unless number of uniquely verified titles matches the observed Unread chat badge.
- The chat card and Roman Urdu answer differentiate full 10/10 from partial 2/10; never infer remaining names or show a fake zero.
- For exact-contact selection / named visible read / draft only: if UIA is inaccessible BEFORE any input, use tightly bounded on-device OCR of the currently foreground Personal WhatsApp Desktop. Verify the exact recipient in the right chat header after selection; verify the empty composer placeholder and re-read the typed draft. No repeat typing after partial input. Do not submit a message via this OCR fallback.
- Support an explicit user command such as "Adnan Agent Visa Bina Forever ko reply likho: Kal milte hain" as an exact recipient + draft plan, followed by a separate explicit final Send request/approval. The existing UIA-only Send guard stays unchanged. If WhatsApp doesn't expose a uniquely verified Send control, the owner must review the draft and Send manually, rather than a guessed click.
- Never auto-send any real WhatsApp message in CI. No screenshot retention/upload, no WhatsApp Web/undocumented protocol, no pairing/data deletion.

## Release gate
The Windows installer, repeat-install/rollback checks, Web/Relay tests, synthetic OCR and boundary/approval tests must pass before release. The owner's signed-in WhatsApp still needs a real-device v1.9.4 acceptance scan confirming whether all 10 names were found. A pass in CI is not proof of the actual private chat UI.
