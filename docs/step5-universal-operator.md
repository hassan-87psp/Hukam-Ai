# Step 5 — Universal Computer Operator candidate

- Existing native mouse/keyboard foreground guards, allowlisted applications, WhatsApp-specific OCR and dedicated workflows remain. No arbitrary shell or model-generated coordinate guesses.
- Explicit single physical monitor capture (1–16), detected count and original virtual-desktop bounds in result. Negative coordinates supported in metadata. Never capture MSS index zero (all displays). Bounded capture and cancellation. Simulated captures are synthetic.
- Screenshots always require approval, including legacy settings. Gemini vision retains separate consent.
- Parser/protocol and Python test coverage. Real mixed-DPI/multiple-monitor acceptance, general OCR and broader app-specific workflows are outstanding. Monitor numbers reflect MSS enumeration, not guaranteed identical to Windows Settings. No production deployment.
