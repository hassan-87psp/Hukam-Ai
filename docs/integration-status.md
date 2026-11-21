<!-- Historical V1 status, not the current operational checklist. -->
> This file documents the original Version 1 only. **Current code release is v1.6.9**: read [Phase 6 release and deployment audit](phase6-v167-release-audit.md), [the operator audit](audit-20261121.md) and Phase 3–5 updates. Build success is not real laptop or live Render verification.

# Integration status & feature checklist

Legend: ✅ implemented and covered by automated tests · 🟢 implemented, verified in the browser E2E run (Linux, launches simulated) · 🪟 implemented, **needs manual verification on real Windows** · 🟡 partial by design · ⛔ not connected / not built.

Nothing below is marked done unless the code exists. “Tested” means the tests in docs/testing.md were actually run.

## Phase 1 — Frontend
| Item | Status |
|---|---|
| Desktop dashboard (sidebar, top bar, hero orb, composer, timeline, 6 info cards) | 🟢 |
| Mobile app-style layout (header, orb, big mic, quick actions, bottom nav, More sheet, drawer) | 🟢 |
| Animated brain orb with idle/listening/processing/executing/success/error/offline states, reduced-motion | 🟢 (visual) |
| AI Chat with message / proposed / awaiting approval / running / completed / failed states | 🟢 |
| Voice Assistant page (push-to-talk, transcript, permission status, language, voice, rate, volume, mute, stop, replay) | 🟢 UI · voice itself 🪟 on your phone |
| Devices, Automations, File Manager, WhatsApp, Browser, Activity History, Settings — all real pages, no dead links | 🟢 |
| Dark (default) and light theme foundation; Urdu RTL text rendering | 🟢 |
| PWA manifest + service worker (installable over HTTPS; works without installing) | 🟢 build · install 🪟 |

## Phase 2 — Working controller
| Item | Status |
|---|---|
| Owner account, setup code, login, sessions | ✅ |
| Pair laptop with expiring code; device token; online/offline; heartbeat; reconnect; unpair | ✅ |
| Send command → result → history (“Downloads folder kholo”) | ✅ relay↔real controller (simulated launch) · 🟢 via browser · 🪟 Explorer opening on Windows |
| Launch Chrome / allowlisted apps | 🪟 |
| Search YouTube / play top result | 🪟 (top-result extraction unit-tested; network fetch not reachable from the test sandbox, fallback path verified) |
| Open authorised file (inside allowed folders only) | ✅ path rules · 🪟 actual open |
| Capture authorised screenshot | ✅ approval + storage + private serving · 🪟 actual capture (no display in sandbox → honest failure shown) |
| Duplicate protection, timeouts, cancel, emergency stop, capability toggles | ✅ |

## Phase 3 — Voice
| Item | Status |
|---|---|
| Microphone permission handling, secure-context check, errors + retry, text fallback | 🟢 code paths · 🪟 on devices |
| Speech recognition (`ur-PK`, `en-PK`, `en-US`, `en-IN`, `hi-IN`) via browser Web Speech API | 🪟 — depends on browser; Chrome/Edge send audio to the vendor's speech service; accuracy **not benchmarked** |
| Urdu-script output mapped to commands | ✅ (parser tests with Urdu script) |
| Spoken replies in Urdu when an Urdu voice exists; English otherwise (reported in UI) | 🪟 |
| Male/female voice | 🟡 shown only when the voice name reveals it (Web Speech exposes no gender) |
| Natural cloud voice engine | ⛔ future (adapter point: `services/voice.ts → speak`) |

## Phase 4 — Additional capabilities
| Item | Status |
|---|---|
| WhatsApp open | 🪟 |
| WhatsApp unread **count** (from `(N) WhatsApp` window title) | 🟡 🪟 — count only, active tab only |
| WhatsApp draft reply via official click-to-chat link; approval with recipient/text/edit/cancel; user presses Send | 🟡 🪟 |
| WhatsApp read messages / list chats / auto-send | ⛔ needs an authorised integration (e.g. WhatsApp Business Platform); personal-account automation is fragile and risky |
| Browser tab switching, clicking, reading URLs | ⛔ (adapter boundary in Browser page) |
| Active window / page title | 🪟 |
| Rich file search (name, type, folder, latest) | ✅ |
| File previews on the phone | ⛔ |
| Saved automations, manual run, step validation, run history | ✅ |
| Scheduled automations | ⛔ (nothing runs unattended in V1) |
| Mouse/keyboard input | ⛔ (only window focus is implemented) |

## Phase 5 — Optional AI connectivity (research, Nov 2026)

**Current state in V1:** the deterministic engine is the only interpreter. No paid API is used or substituted. `AIProvider` interfaces exist in `packages/command-protocol/src/provider.ts` and `apps/windows-controller/controller/ai/provider.py`; any provider must output the same allowlisted actions, which are validated as usual.

### Findings
1. **A ChatGPT Plus subscription is not a general API key**, and automating chatgpt.com or reusing its cookies is not acceptable (and is not done here).
2. **Sign in with ChatGPT + “ChatGPT plan usage”** (announced at OpenAI DevDay, 29 Sept 2026) is now the official way for a third-party app to spend a Plus/Pro user's plan allowance. Per OpenAI's developer docs, the self-serve path is documented for **open-source and locally hosted apps**; **paid or remotely hosted apps must use an interest form**. The flow is OAuth 2.0 + PKCE with dynamic client registration, the `chatgpt.tokens.use.direct` scope and a `127.0.0.1` loopback redirect; requests go to the Responses API with limitations (no temperature, no hosted tools; custom function tools are allowed).
3. **What this means for HUKM:** the Windows controller runs locally on your laptop, so it is the natural home for a future `ChatGPTPlanProvider` (sign in once on the laptop, interpret free-form requests into HUKM's function tools). Doing it from the hosted relay/web app would fall under “remotely hosted” → interest form. **Not implemented or verified in V1.**
4. **Apps in ChatGPT / developer-mode MCP connectors** (the reverse direction — ChatGPT calling HUKM): OpenAI's help centre currently lists full MCP write actions and developer mode for Business/Enterprise/Edu workspaces. Not pursued for a Plus account.

### How to test eligibility yourself (before anyone builds the adapter)
1. On the laptop, follow OpenAI's “ChatGPT plan usage in your open-source app” quickstart (developers.openai.com/siwc) with a tiny script: sign in, approve “Use your ChatGPT plan”.
2. Call `GET /v1/models` with the issued token; then one Responses API request with `store:false, stream:true`.
3. Outcomes: success → eligible; HTTP 403 `subscription_sharing_user_not_eligible` → account/plan/region not eligible; HTTP 429 `subscription_sharing_usage_limit_exceeded` → plan limit reached.
4. Only after that succeeds is it worth implementing `ChatGPTPlanProvider` (roadmap item).

### Self-hosted model option
Possible later via a small local model on a *different* machine (the target laptop is low-powered, so running an LLM there conflicts with the performance brief). Same `AIProvider` boundary.
