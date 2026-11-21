# HUKM v1.8.0 — Website-managed updates + Personal WhatsApp Desktop

## What is implemented

* Existing paired Windows Controllers can **receive an approved website action** `controller.update`, but **only when version 1.8.0 or later was installed once**. Older Controller binaries do not understand this action. The initial upgrade is a one-time Windows installer, not an automatically delivered patch.
* The installed Controller itself contacts the fixed GitHub Releases endpoint of `hassan-87psp/Hukam-Ai` over HTTPS. It rejects arbitrary command arguments, URLs, unrecognized release paths and redirects, malformed versions, downgrades, oversize installers and SHA-256 mismatches. No PowerShell, arbitrary process execution or shell commands from Gemini.
* An explicit website command approval is mandatory; after verified download a separate **local Windows Yes/No confirmation** is mandatory. Updates use the ordinary interactive Inno Setup GUI, not silent/hidden installation. Existing device pairing lives separately in AppData and is not deleted. User can opt to start Controller after installation.
* Official versioned EXE/checksum artifacts are published to public GitHub Releases only **after both web+relay and Windows CI test jobs succeed** on main. Releases are not overwritten for an existing tag.
* The Devices page displays **Update from website** only for a paired online v1.8+ Controller that has a backend version mismatch. Installer launch counts as **unverified**, not success, until a new controller hello with the expected version arrives.
* The explicit command `Ali ke WhatsApp messages parho` creates `whatsapp.select_chat` then `whatsapp.read_selected` targeting the exact same Ali contact without asking Gemini. The Windows app must expose the selected chat title, otherwise the action fails closed. Content is read only when explicitly approved.
* After verified named chat reading, a per-user/per-project expiring follow-up question asks for the reply body. `reply likho: ...` drafts in the already verified contact's Desktop chat after a new owner approval. Sending remains a **separate** high-impact reviewed action. The AI is never authorized to send merely because it can read.
* An approved visible unread-sender list can also be followed by a simple contact name (`Ali ka`) without Gemini. No fake unread count if Windows UI Automation cannot expose it.

## Limitations and security

* **Unsigned Windows EXE:** SHA-256 + HTTPS + a public GitHub release is not equivalent to a code-signing certificate or trusted publisher signature. A compromised repository can replace both installer and checksum. Therefore this build deliberately refuses unattended/silent remote installation. Windows SmartScreen may show an unverified publisher warning. Do not bypass warnings if the release URL/checksum are unexpected.
* **No actual desktop acceptance yet:** CI is simulated and cannot access the owner's signed-in WhatsApp. WhatsApp's native UI accessibility may vary by version, locale, and visible state. The correct response to inaccessible UI is `UNVERIFIABLE`, never a fabricated chat count/message or a Web fallback.
* WhatsApp message text is returned to the owner account and stored in the authenticated command history only after a specific read approval. The separate offline read-out-loud action keeps text on the laptop.
* Full unattended automatic updates, robust signed publisher identity and automatic rollback are **not** offered. Owner-approved website updates launch a normal installer on the physical laptop and may require Windows interaction. The existing Inno installer attempts to preserve a previous EXE but does not provide a full managed updater rollback.
* A future move to a **private GitHub repository** would break public GitHub Releases access and require a different authenticated delivery host. Verify a replacement distribution scheme before changing repo visibility.

## Final real-PC acceptance after deploying v1.8.0

1. Check Render health: `https://hukm-ai-relay.onrender.com/api/health` reports v1.8.0, and GitHub Pages frontend is on matching commit.
2. Download the official v1.8.0 One-Time Setup EXE from the versioned GitHub Release; verify its SHA256; run once. Never extract repeated ZIPs.
3. Confirm paired Windows Controller reports 1.8.0 from a real authenticated device hello; check only one instance is running.
4. Give the command **`Ali ke WhatsApp messages parho`** and approve named chat select and read separately. Verify HUKM used the *installed Personal WhatsApp Desktop*, not Chrome.
5. Answer follow-up **`reply likho: Kal 3 baje milte hain`**. HUKM should show the draft in Ali's exact chat; it must not press Send without a separate explicit reviewed Send request.
6. Verify the unread count remains unknown if app accessibility is missing. In this case run **HUKM diagnostics**; do not guess from taskbar badge.
7. When the next higher version is released on main, click Devices → **Update from website**, approve the command and the local Windows prompt. Confirm the exact official release, checked SHA256 and interactive installer; after reconnect the device must report the newer version. Never show green solely because setup EXE launched.
8. Test cancellation before downloading, Save/Cancel interruption, multiple chats, wrong contact header, network outage, old controller version and GitHub release unavailable without fake success.

## Deployment release gate

CI and GitHub Pages success do not prove Render and Windows are synchronized. Check Render latest deploy and public /api/health separately. Source change deployment does not automatically update already installed Windows executables.
