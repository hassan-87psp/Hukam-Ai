# Step 9 — Advanced AI Brain candidate

- Existing server-side Gemini chat and validated tool planner remain the single model path. Improved natural Pakistani Roman Urdu instructions, short replies, use known context and honest outcome distinctions. Model language quality is not verified by simulated tests.
- Fixed specialist hints for WhatsApp, files, calendar/mail, ChatGPT content and desktop/browser; not multiple independently executing agents. No extra API/model/runtime or token transfer to new providers.
- Bounded deterministic Notepad number-range tasks (up to 100 integers) avoid Gemini. Current allowlist and per-step approvals still apply.
- Preserve latest answer when follow-up grows; explicit task switches use normalized commands. General explanation routes stay chat. Private reviewed WhatsApp dialogue is handled locally, never included in model request; ambiguous reply remains a clarification. Reviewed Send requires explicit send wording, not bare yes. Only final non-simulated WhatsApp results can establish a new reviewed follow-up.
- Tests use synthetic inputs. Actual language-quality and live computer acceptance remain required. No production deployment, new paid dependency or account actions.
