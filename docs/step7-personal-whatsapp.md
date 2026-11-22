# Step 7 — Personal WhatsApp Desktop intelligence candidate

Existing native Personal Desktop default, unread OCR fallback, approved visible sender list, named chat selection/read, draft/send, and attachment preview/send remain. No Web fallback, unofficial WhatsApp protocol, background contact harvesting, account credentials or actual messages used in tests.

Changes:
- Conflicting unread indicators yield unknown rather than an invented total; repeated identical indicators remain valid. Existing OCR sender scanner remains local and visible-only, not a complete inbox count.
- Guard typing by current native window identity, focused enabled non-password editor and cancellation; verify exact draft and selected recipient again after input. Named reads check PID/HWND and cancellation before returning content.
- Attachment preview fingerprints file before native picker, verifies picker ownership/field, and verifies unchanged local file bytes after selection. Final send consumes its authorization once and checks exact chat header again; if WhatsApp preview hides the header, fail closed and require manual confirmation. Disconnect/pause/chat selection invalidate pending attachment authorization.
- Final Send remains owner-reviewed; input delivery is not server delivery proof. No automatic retries. Visible private content returned by explicit read is retained by existing account history policy. Actual Personal WhatsApp app/account test remains required; unsupported UIA controls may fail safely rather than silently send.
- Tests use synthetic contacts/bytes. No additional runtime dependency, paid API, production release or laptop access.
