HUKM AI Windows Controller v1.6.7 — Local Install & Safety
======================================================

This is a Windows controller that lets your own authorised HUKM AI account
run a fixed set of safe laptop commands. Pairing credentials live under
%APPDATA%\HUKM AI and are reused after installing a new version.

INSTALL / UPDATE (user action required; live laptop tests deferred):
1. In the GitHub Actions artifact, compare SHA256SUMS file
   HUKM-Windows-Controller-v1.6.7.zip.sha256 against PowerShell:
   Get-FileHash .\HUKM-Windows-Controller-v1.6.7.zip -Algorithm SHA256
2. Extract the INNER HUKM-Windows-Controller-v1.6.7.zip completely.
3. Close all old HUKM Controller processes manually, then run
   INSTALL_OR_UPDATE.cmd. This copies the EXE to a stable folder, preserves
   device pairing and backs up the previous EXE for rollback.
4. Run VERIFY_HUKM.cmd to confirm the installed EXE version/status.
5. Only when ready for real laptop tests, run START_HUKM.cmd and check the
   live authenticated Node relay dashboard for the connected Windows device.
6. Only after real acceptance tests should you enable Windows Autostart.

IMPORTANT: GitHub Pages is static hosting; it cannot replace the HUKM
relay's /api endpoints, owner account or WebSocket controller connection.
Do not delete old HUKM data, credentials, local folders or .env during
controller updates.

AUTOSTART (owner opt-in; do not activate before live tests):
- Run ENABLE_AUTOSTART.cmd from the consolidated package when approved.
- Run DISABLE_AUTOSTART.cmd to disable. HUKM never silently autostarts.
- The Windows Startup entry belongs to the current user; no hidden Windows
  service or administrative Windows login credentials are required.

BROWSER OPERATOR (EXPERIMENTAL - APPROVAL REQUIRED EVERY TIME):
- The owner may issue commands on the website chat: "browser click 450 300", "type: Hello", "scroll down 2", "press tab", or "press ctrl+l".
- Browser actions target visible Chrome, Edge or Firefox. Separately approved desktop.control supports bounded mouse/keyboard in allowed foreground Explorer, Notepad, Office and Paint windows; never hidden/system/terminal/WhatsApp Send dialogs.
- HUKM shows exactly what will be typed/clicked and waits for explicit approval. Screenshot approval remains separate.
- Successful delivery is not proof a website task finished. The user verifies results, and third-party services may restrict automation.
- On a laptop, close the old Controller process before opening v1.6.7; existing encrypted device pairing is preserved.
- Don't type passwords or recovery codes in remote HUKM chat.
- This is groundwork, not yet an autonomous visual agent or calendar/WhatsApp end-to-end workflow.

CHROME PROFILE AND TASK INPUT (V1.3.0):
- Saved Project Chrome profile must be the real directory: Default or Profile 1 to Profile 99.
- HUKM checks the profile directory exists under LOCALAPPDATA before launching Chrome with that profile.
- Supported destinations for this action are ChatGPT, Google Calendar and Outlook Calendar. Login/page verification is not yet available.
- Notepad typing requires a visible foreground Notepad.exe and explicit approval. Text is delivered, not independently verified.
- Compound tasks may be planned with Gemini and executed one step at a time only AFTER review; each risky action needs its own approval.
- This does not yet provide autonomous UI interpretation, full calendar event creation, WhatsApp reply sending or ChatGPT image/download workflows.

PERSONAL WHATSAPP + COMPUTER WORKFLOWS v1.4 (STAGED / NEEDS REAL DEVICE TEST):
- Approved foreground UI Automation inspection of visible interactive labels (not text contents).
- Selected WhatsApp Desktop chat can return at most 8 visible message items to private HUKM history only after explicit approval. Message contents are not automatically sent to Gemini.
- Reply drafting requires the exact selected recipient header match; files may be placed into attachment preview from allowed folders only. Neither action presses Send.
- Google/Outlook Calendar event_draft opens a pre-filled event editor in a configured Chrome profile. No saved event or invitations are claimed.
- ChatGPT prompt drafting, reviewed submission and visible Download detection require exact foreground ChatGPT Project URL verification.
- These can fail when WhatsApp/ChatGPT changes accessibility controls. They have NOT yet been accepted on a real laptop.
- Automatic WhatsApp sending, OAuth Calendar event creation and fully autonomous visual computer control are NOT available.
- Controller command logs redact user argument values such as messages/prompts.

WHATSAPP (EXPERIMENTAL):
- "WhatsApp kis kis ka message aaya hai?" triggers an approval-gated Windows UI Automation check of visible unread sender titles.
- Only currently visible unread chat titles may be returned; no message body or chat preview is intended to be transferred.
- Names from this approved command are sent to the user's HUKM account and stored in command history.
- If the Unread filter or chat rows are inaccessible, HUKM reports unknown, never guesses the senders.
- The unread check attempts to read the visible WhatsApp Desktop Unread filter via UI Automation and falls back to a numbered window title.
- Plain WhatsApp window titles do not prove zero unread chats: when UIA is unsupported the result is UNKNOWN.
- The controller never uploads chat text, snippets or screenshots as part of checking the unread badge.
- "WhatsApp kholo" tries the installed WhatsApp Desktop app.
- "WhatsApp Web kholo" opens the browser only when requested.
- "WhatsApp messages parho" first asks for HUKM approval, then attempts to
  read limited text visible in the SELECTED WhatsApp Desktop chat, aloud on
  the laptop using Windows offline voices. Your message content is NOT sent
  to the HUKM relay or Microsoft cloud speech engine.
- Only the current visible chat is attempted, not background chat history,
  deleted messages, or every unread conversation. UI accessibility support
  depends on your WhatsApp version. If this fails, nothing is read.
- The reply composer only prepares an unsent draft. You personally press Send.

SECURITY & TROUBLESHOOTING:
- Close the Controller window (or Devices > Pause) to stop remote control.
- Only pair a laptop you own. Do not forward install files or pairing tokens.
- If apps open minimized, version 1.1 attempts foreground focus. Windows
  can deny this; the result is reported, not falsely marked as focused.
- The HUKM app URL is https://hukm-ai-relay.onrender.com, not the old
  Vercel static hostname.
- Free Render hosting may sleep, making scheduled automations best-effort.
- The portable EXE is not code-signed. It is intended for your testing,
  not a public installer or unreviewed automatic update.
