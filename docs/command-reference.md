# Command reference (deterministic engine)

The engine accepts Urdu script, Roman Urdu, English and mixtures. Politeness words (please, zara, mera, kar do…) are ignored. If a sentence doesn't match, HUKM says so and suggests examples — it never guesses an unsafe action.

| Intent | Examples | Action |
|---|---|---|
| Open app | Chrome kholo · Chrome open karo · Open Google Chrome · کروم کھولو · Notepad kholo · Excel kholo · Calculator chalao · Settings kholo | `app.open` (chrome, edge, notepad, calculator, explorer, vscode, word, excel, powerpoint, paint, settings, taskmgr) |
| Open folder | Downloads folder kholo · Please mera downloads folder open kar do · ڈاؤن لوڈز فولڈر کھولو · Desktop kholo | `folder.open` |
| List folder | Downloads mein kya hai · Documents dikhao | `folder.list` |
| Search files | Meri invoice wali file search karo · Invoice PDF search karo · Desktop par latest Excel file dhoondo · invoice file kahan hai | `file.search` (name, type, folder, latest) |
| Open file | Desktop par jo PDF hai woh kholo · Trading plan pdf kholo · latest invoice pdf kholo | `file.open` (opens if one match or “latest”; otherwise shows choices) |
| Web search | Browser mein Forex news search karo · latest gold news search karo · google gold price | `web.search` |
| Open website | TradingView kholo · Forex Factory kholo · open forexfactory.com/calendar · Gmail kholo | `web.open` |
| YouTube | YouTube par Gold analysis play karo · YouTube par forex news search karo · YouTube kholo | `youtube.play` / `youtube.search` / `web.open` |
| Screen | Mujhe laptop ki screen dikhao · screenshot lo | `screen.capture` (approval) |
| Open apps | Computer par kaunsi applications open hain? · which apps are open | `apps.list` |
| Active window | active window batao · page title batao | `window.active` |
| Status | laptop ka status batao · battery batao | `device.status` |
| Lock | laptop lock karo | `system.lock` (always approval) |
| WhatsApp | WhatsApp check karo · WhatsApp par unread messages batao · Ali ke naye messages batao · WhatsApp khol do | `whatsapp.check` / `whatsapp.open` |
| WhatsApp draft | Ali ko message likho ke main 10 minute mein call karunga · Ali ko reply karo ke … · Send a message to Sara saying I'll be late · علی کو میسج لکھو کہ … | `whatsapp.compose` (saved contacts only, always approval, never auto-sent) |
| Cancel | Current command cancel karo · roko · کمانڈ منسوخ کرو | `command.cancel` |
| Help | salam · help · kya kar sakte ho | reply |

Not supported on purpose: closing apps (“Chrome band karo” → explained), deleting/editing files, installs, shutdown, payments, arbitrary scripts.

“Ye file kahan save hai?” without a name → HUKM asks which file.

Extending: add phrases in `packages/command-protocol/src/normalize.ts` / `parser.ts`, add a test in `packages/command-protocol/test/parser.test.ts`, run `npm test`.
