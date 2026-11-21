# HUKM v1.4 — Personal WhatsApp / Screen / Calendar / ChatGPT acceptance

This document distinguishes **implemented staged commands** from **actual-application verified functionality**.
The user's selected channel is **Personal WhatsApp Desktop installed on their Windows laptop**, NOT the Business Cloud API.

## Security model
- Controller connects outbound to HUKM relay as previously paired device.
- Every new UI, WhatsApp message, attachment, Calendar or ChatGPT action requires owner approval on HUKM.
- Sending private WhatsApp text to HUKM is disclosed before `whatsapp.read_selected` and the result goes into owner's command history.
- The Gemini conversational/planning API does NOT automatically receive the WhatsApp chat text.
- Screen screenshots are sent only after screen-capture approval. A separate "Analyze screenshot with AI" consent action sends that screenshot to Google Gemini; it never invokes mouse/keyboard actions.
- WhatsApp reply and attachment actions are **draft/preview only**; never auto-send.
- Calendar links prefill an editor. **No event or invite was saved** until verified by the user.
- ChatGPT Project UI automation is best effort using Chrome UIA; it requires a logged-in dedicated profile. It is not a ChatGPT API integration.

## User's one-time test instructions

1. Update Controller only after the GitHub Actions v1.4 ZIP release passes. Keep a backup of old HUKM folder and paired configuration.
2. Run `VERIFY_HUKM.cmd`, then `START_HUKM.cmd` and confirm ONLINE.
3. In HUKM chat type `HUKM diagnostics`, approve, check `whatsappDesktopWindow`, `uiautomationInstalled`, `monitorCount`, Chrome profile directories. This never reads chats.
4. With WhatsApp Desktop open: approve `whatsapp.unread_senders`. Expect actual names or explicit `UNVERIFIABLE` (never false zero).
5. Open a selected chat and invoke `whatsapp.read_selected`. Review the explicit disclosure that visible message text is uploaded to private HUKM history.
6. For `whatsapp.draft_reply` check the exact recipient, empty composer, and resulting typed draft **without sending**. Confirm other chats and preexisting drafts are protected.
7. For `whatsapp.attach_preview` choose a supported allowed file and exact selected contact. Check the preview and refuse send. Confirm wrong file/outside allowed folder are rejected.
8. Create a HUKM Project with actual `Default` or `Profile N` Chrome directory and exact ChatGPT Project URL. Run open and verify the expected Chrome account/project manually.
9. In that Project, approve `chatgpt.prompt_draft`, then `chatgpt.submit_prompt` separately, check correct project and response. Approve `chatgpt.download_visible` only after visible result exists. Confirm a **new verified** file appears under Downloads.
10. Use `calendar.event_draft` with correct UTC start/end, IANA timezone, Google/Outlook provider. Verify prefilled title/time and **manually click Save**. HUKM must not report an event ID or sent invitation without an actual provider integration.
11. Approve one `screen.capture` then choose "Analyze screenshot with AI" (second consent). Confirm image is shared to Google only after a separate on-screen consent.
12. Test network loss, Controller process restart, foreground app switch, minimized WhatsApp/Chrome, rejected approval, two-monitor scaling, project isolation, and rollback of Controller executable.

## What was added (CI simulation-level only)
- Windows UIA foreground-control listing and exact-label activation, no private text fields.
- On-demand, separately consented Gemini screenshot analysis, with no automatic computer actions.
- Personal WhatsApp visible selected chat, recipient-verified drafts, local file attach-preview.
- Calendar draft URLs with UTC bounds and configured Chrome profile.
- ChatGPT browser Project match, prompt draft, submission and download detection.
- Privacy redaction of Controller command args.
- Safe on-device diagnostic test command.
- Python and TypeScript regression tests and Windows packaged EXE smoke tests.

## Explicitly incomplete until future verified integration
- Full observe→plan→act→verify autonomous screen AI, including multi-monitor and UI drift recovery.
- Reliable all-version Personal WhatsApp unread extraction, automatic sent confirmation, chat media sending.
- Google Calendar and Outlook OAuth / Microsoft Graph authorized create/update, attendee invitations, conflict checks.
- ChatGPT image generation, actual downloaded file association with exact generated prompt, and fully automatic completion.
- Real Windows laptop acceptance of all above tests.

Do not delete old HUKM folders, database, local configuration or Chrome profiles until backups and real-PC verification are complete.
