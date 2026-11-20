HUKM AI Windows Controller v1.2.0 — Local Install & Safety
======================================================

This is a Windows controller that lets your own authorised HUKM AI account
run a fixed set of safe laptop commands. Pairing credentials live under
%APPDATA%\HUKM AI and are reused after installing a new version.

INSTALL / UPDATE (user action required):
1. On your own laptop, close the old HUKM Controller black window.
2. Extract this ZIP. Double-click hukm-controller.exe. If prompted by
   Windows SmartScreen, verify you trust the file from your own HUKM project.
3. Keep the visible Controller window open to allow remote control.
4. In HUKM AI > Devices, confirm the controller version is 1.1.0.
5. If not paired, go to Devices > Pair and follow on-screen instructions.
   NEVER share your device token or Windows login password.

AUTOSTART (opt-in, only on your laptop):
- With the source installer, run enable-autostart.bat (after pairing).
- With the packaged executable, open Command Prompt in this ZIP folder and run:
  hukm-controller.exe autostart on
- To disable: hukm-controller.exe autostart off
- The Startup entry is per Windows user; no administrator privileges or
  hidden system service is installed.

BROWSER OPERATOR (EXPERIMENTAL - APPROVAL REQUIRED EVERY TIME):
- The owner may issue commands on the website chat: "browser click 450 300", "type: Hello", "scroll down 2", "press tab", or "press ctrl+l".
- Only the foreground Chrome, Edge or Firefox window accepts this bounded input. Windows desktop, terminal and other apps are not directly controlled through this action.
- HUKM shows exactly what will be typed/clicked and waits for explicit approval. Screenshot approval remains separate.
- Successful delivery is not proof a website task finished. The user verifies results, and third-party services may restrict automation.
- On a laptop, close the old Controller process before opening v1.2.0; existing encrypted device pairing is preserved.
- Don't type passwords or recovery codes in remote HUKM chat.
- This is groundwork, not yet an autonomous visual agent or calendar/WhatsApp end-to-end workflow.

WHATSAPP (EXPERIMENTAL):
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
