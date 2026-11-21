# HUKM 1.6.1 — Personal WhatsApp Desktop acceptance checklist

## Scope and privacy

This patch extends the user's **installed, signed-in Personal WhatsApp Windows application**, not a Chrome WhatsApp Web tab. It adds an explicitly approved `whatsapp.select_chat` action, optional exact-contact pinning on `whatsapp.read_selected`, stronger window focus/label matching, and richer privacy-safe UIA diagnostics.

No WhatsApp message is sent by Select or Read. Never treat a taskbar notification bubble as a verified unread-chat count. The Controller does not use an unofficial WhatsApp protocol, scrape chat databases, access browser cookies, or bypass account sign-in. A selected chat's text is returned to the authenticated owner only after the existing Read approval and is retained in their HUKM command history. If privacy is a concern, use the separate `whatsapp.read_visible` action, which speaks visible text locally instead.

## User-facing acceptance tests on a real Windows PC

1. Install **HUKM-Windows-Controller-v1.6.1.zip** using `INSTALL_OR_UPDATE.cmd`; pairing/config should remain intact. Verify Devices shows controller version 1.6.1. Close old duplicate processes; only one Controller must run.
2. In HUKM say **“WhatsApp kholo”**. The installed Personal WhatsApp Desktop must become foreground; opening a Chrome WhatsApp Web tab is a failure.
3. Run **“HUKM diagnostics”** and approve. Check `whatsappDesktopWindow`, `whatsappForeground`, `uiautomationInstalled`, `whatsappAccessibilityTreeReadable`, `whatsappUnreadBadgeReadable`. The diagnostics must not return any private chat text/contact name or screenshot.
4. Say **“WhatsApp unread kitne hain?”**. When WhatsApp exposes a numeric Unread indicator inside the app, HUKM may report its verified number. If WhatsApp only displays a taskbar badge, HUKM must report **unknown/unverifiable**, not zero or a guessed number.
5. Say **“WhatsApp par kis kis ka unread msg aya?”** and approve the sender scan. It may select the app's Unread filter and list only visible chat titles if exposed by Windows UIA. If Windows does not expose rows, HUKM must report unavailable; never manufacture names.
6. Say **“WhatsApp selected chat parho”**, approve. It must read only the currently visible selected conversation into the authenticated HUKM command result; it should not open another chat or send a reply.
7. Say **“Ali ke WhatsApp messages parho”** (substitute an actual visible contact). HUKM should propose an approved `whatsapp.select_chat` followed by `whatsapp.read_selected` pinned to the same contact. Review and approve separately. It must show visible messages only after exact recipient header verification.
8. Put two similarly named contacts (e.g., Ali / Alina) in the sidebar or search results. HUKM must not choose a partial or ambiguous name, and must never click Send during selection.
9. Switch to another conversation before the approved read runs. The pinned read must fail rather than expose messages from the wrong contact.
10. Minimize WhatsApp, switch to Chrome, lock Windows, disconnect the PC or remove WhatsApp permissions. HUKM must report the specific unsupported/permission state; no fake success or secret logging.
11. For an explicit **Send**, the previously existing separate final owner approval and delivery-unverified warning must remain intact. No automatic retry of an ambiguous Send.

## Automation coverage

CI provides TypeScript typechecking, frontend/relay tests, Python unit tests on a simulated Windows controller, executable build, installer smoke test and artifact publication. The CI environment has no signed-in WhatsApp account; it cannot establish real 2026 WhatsApp UI accessibility behavior, message delivery or a verified unread count on the owner's machine.

## Known limitations

WhatsApp Desktop frequently changes its WinUI/WebView2 accessibility surface. The exact chat title, in-app Search field, Unread filter or message row may be inaccessible. The safe result is an actionable `WHATSAPP_UI_UNAVAILABLE` or `UNVERIFIABLE`, not a guessed result. In-app Search is only used if a unique empty UIA Search field is exposed; it will not overwrite a user's existing query. UI Automation is best effort, and this patch does **not** provide background inbox scraping, universal WhatsApp automation, or guaranteed message receipt.
