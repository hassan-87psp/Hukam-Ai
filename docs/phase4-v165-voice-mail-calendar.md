# HUKM v1.6.5 — Phase 4 Voice, Email and Calendar

This release improves the existing voice subsystem, adds **owner-approved browser drafts** for Gmail and Outlook in the owner's existing Chrome profile, and retains the reviewed Google/Outlook Calendar draft/Save flow.

## Implemented and automated-testable

- **Voice recognition**: Web Speech API results are reassembled from the complete result list, avoiding repeated final segments and duplicate HUKM commands. Late events after abort are ignored; only one final turn may be submitted.
- **Microphone lifecycle**: If the user stops listening before getUserMedia returns, a late level-meter stream is immediately stopped. Unmount aborts recognition and closes any meter stream.
- **Email inbox launch**: `email.inbox_open` opens Gmail or Outlook in exactly the specified existing Chrome profile, after explicit owner approval. It **does not read any messages** or verify the logged-in account.
- **Email compose link**: `email.compose_draft` accepts provider `google|outlook`, real `Default|Profile N` Chrome profile, a **single valid recipient**, subject and body. Validated fields are percent-encoded in the provider's compose URL. It opens a draft UI only; it does not press Send or claim the draft is saved.
- **Calendar**: Existing `calendar.event_draft` requires future UTC start/end, explicit IANA-formatted time zone, provider, exact Chrome profile and title. It opens a pre-filled event editor; **no calendar event is created or verified** until explicit reviewed Save, and even that UI attempt does not independently prove creation/delivery.
- **Safety**: All mail actions require owner approval and are mirrored in TypeScript/Python contracts. Invalid addresses, CR/LF injection, bad Chrome profiles, unsupported providers, empty subject/body and oversized content are rejected. Gemini planner may propose a draft only, never arbitrary mail send. User must review recipients before manual Send.

## Privacy and current limitations

- The provider's compose URL contains the percent-encoded email recipient, subject and body. **Do not put secrets, passwords, personal records or financial data in a URL-based draft.** A URL can be visible in browser history, local process arguments and provider logs. This draft feature is preliminary; a later OAuth-backed draft API would avoid putting body text in the URL.
- Browser speech recognition (Chrome/Edge/Safari) may use the browser vendor's speech service, requires the user's mic permission and is not a fully local or guaranteed-accurate Roman Urdu engine.
- HUKM's optional voice playback may use an online Urdu synthesis service; the account UI discloses this. Do not dictate private mail bodies when using a third-party voice service.
- **Not yet implemented:** OAuth Gmail/Microsoft Graph mailbox reading, verified sending, calendar event IDs and invite delivery confirmation, inbox summarization, email attachments, conflict checking, full duplex offline Roman Urdu speech, or guaranteed selected email account identity.
- If the user requests sending an email, HUKM can prepare an approved draft for manual Send but must not pretend delivery occurred.
- Deep links may change as Gmail and Outlook update their web UI. On failure, HUKM reports unverified instead of fabricating completion.
- No personal laptop, microphone, account, email, or Calendar was exercised during automated tests. Real Windows acceptance is deferred per user instruction.

## Real laptop acceptance (deferred)

1. Verify en-PK speech with Roman Urdu commands, duplicate speech callbacks and mic stop/restart.
2. Select a known saved Chrome profile; verify provider signed-in account before opening inbox.
3. Open Gmail Inbox; confirm **no email text is transferred** to HUKM.
4. Open a Gmail and Outlook draft with a non-sensitive test address, compare visible recipient/subject/body with approved values.
5. Confirm no send occurred; then the owner may manually send a test message if desired.
6. Open a Google/Outlook Calendar draft, verify local timezone, title, start/end, and avoid duplicate invites.
7. Test invalid profile, offline mode, cancelled action, browser not installed, browser login expired.
8. Later implement official delegated OAuth (scopes restricted by provider), explicit read/Send consent, account binding, and provider API verification before claiming production completion.
