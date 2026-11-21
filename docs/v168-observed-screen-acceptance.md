# HUKM AI v1.6.8 — Observed Windows controls and safe click handoff

## What is implemented
HUKM can inspect the **current visible foreground application** using native Windows UI Automation (UIA), without OCR, guessed mouse coordinates or automatically sharing a screenshot with Gemini.

After the owner separately approves `ui.inspect`, the HUKM Chat result displays the application's visible interactive labels. For buttons marked `canActivate`, a user can select **Select & request approval**. The new `ui.activate_observed` action:
1. Is always subject to a **second, explicit owner approval**;
2. Is pinned to the **same paired Windows device** as the original inspection, not the browser's current active-device selection;
3. Requires a lowercase 64-character SHA-256 fingerprint of the inspected window HWND, PID, process, title and visible control roles/labels; this is checked again immediately before the action;
4. Requires the exact original control role and label, with exactly one visible match;
5. Refuses to click if the active window changes, the inspected control set changes, a button is hidden/ambiguous, or the snapshot expires;
6. Expires a snapshot after **90 seconds** and consumes it once before the first click; retries require a new inspection;
7. Does not allow generic clicks in Personal WhatsApp Desktop, Windows system windows or WebView containers; dedicated recipient-reviewed workflows remain mandatory;
8. Rejects obviously consequential labels (Send, Delete, Submit, Pay, Purchase, Checkout, Share, Post, Transfer, Upload, Save, Sign in/out, etc.), including labels with prefixed icons, punctuation and filler words.

The old label-only `ui.activate` action now fails closed. Gemini cannot propose the observed-click action or fabricate a valid snapshot: the owner selects an actually observed control in the HUKM UI.

## Verification semantics
- `ui.inspect` verifies the controls listed were visible during inspection (not that later actions succeeded).
- `ui.activate_observed` returns `inputDelivered: true, verified: false` only if the native click was attempted; HUKM must never state that the website completed the task.
- If a control fails, HUKM reports the error (expired inspection, changed window, ambiguous label) without clicking something else.
- There is **no generic automatic visual planner** and no auto-execution of model-invented coordinates. More complex multi-step UI navigation still requires supervised stages and actual Windows acceptance tests.
- A clickable label alone cannot prove what a website will do after navigation. Strict rule-based label blocking reduces risk but cannot guarantee safety for every third-party app, every language or UI update. Dedicated high-impact actions remain separate.

## Automated regression coverage
- Process/PID/HWND/title/control-set fingerprint changes;
- Emoji and prefix bypass attempts on dangerous labels;
- Correct allowlisted role and fingerprint; invalid role/uppercase or truncated fingerprint;
- Cancelled actions and disabled input capability;
- Expired, superseded and reused snapshots rejected;
- Model-generated UI click plans rejected;
- Windows simulated execution, Windows installer and web/relay build.

## Deferred live acceptance
No real PC operation is claimed. With the owner's permission, verify Windows 11 multi-monitor/DPI scaling, focus changes, Chrome/Explorer/Notepad controls, sensitive buttons, browsing, Windows accessibility variations, controller reconnect and parallel client sessions. Test with non-sensitive mock forms first.

## Still not 100% complete
- Real laptop and account testing;
- Fully autonomous end-to-end visual interaction and **independent outcome verification**;
- Official OAuth mailbox reading/sending and Calendar event confirmation;
- Reliable personal WhatsApp Desktop actions across UI changes;
- Voice accuracy and live microphone testing;
- Backend deployment/restore verification on confirmed Render workspace;
- Native file asset indexing and verified generated media downloads.

Do not describe these as finished merely because CI is green.
