# Setup guide

You need two things running:
1. **The relay** (serves the web app and passes commands). Anywhere with Node.js 22.13+.
2. **The controller** on the Windows laptop you want to control.

The cheapest setup — no hosting bill — is to run **both on the laptop** and give the relay a free HTTPS address with Cloudflare Tunnel so your phone can reach it.

---

## A. Relay on the Windows laptop (recommended for V1)

1. Install **Node.js 22 LTS** (22.13 or newer) from nodejs.org.
2. Unzip the project, e.g. to `C:\HUKM\hukm-ai`.
3. Double-click `scripts\start-relay.bat` (first run installs packages and builds; takes a few minutes).
4. The console shows a box like `HUKM AI first-run setup code: ABCD-EFGH`. Keep the window open.
5. Open http://localhost:8787 → enter the setup code → create your owner account (password ≥ 10 characters).

### Make it reachable from your phone (HTTPS)
Browsers only allow the microphone on HTTPS pages, and you shouldn't expose a plain HTTP port anyway.

**Quick tunnel (no account, URL changes each run):**
```
winget install --id Cloudflare.cloudflared
scripts\start-tunnel.bat
```
It prints `https://something.trycloudflare.com` — open that on your phone.

**Fixed URL (free Cloudflare account + your domain):**
```
cloudflared tunnel login
cloudflared tunnel create hukm
cloudflared tunnel route dns hukm hukm.yourdomain.com
cloudflared tunnel run --url http://localhost:8787 hukm
```
Create `.env` in the project root with `TRUST_PROXY=1` so the relay marks cookies `Secure` and logs real client IPs.

> If the relay runs on the laptop, it is only reachable while the laptop is on — which is also when the controller can act, so that's fine for personal use.

## B. Relay on a VPS (always-on alternative)
Any small Linux VM works (1 vCPU / 512 MB is plenty).
```bash
git clone … && cd hukm-ai
npm ci && npm run build
cp .env.example .env    # set TRUST_PROXY=1
npm start               # note the setup code in the log
```
Put it behind HTTPS (Caddy: `hukm.example.com { reverse_proxy localhost:8787 }`) and run it as a service (systemd/pm2). Back up `data/` (SQLite DB + screenshots).

## C. The Windows controller

**Option 1 — portable exe (recommended):** build once (see controller-guide.md) or use a build you made, copy `hukm-controller.exe` anywhere, double-click.

**Option 2 — from source:** install Python 3.10+ from python.org (tick “Add to PATH”), then double-click `apps\windows-controller\run-controller.bat`.

First run asks for:
* **Relay URL** – `http://localhost:8787` if the relay is on the same laptop, otherwise your `https://…` address.
* **Pairing code** – web app → **Devices → Pair new device → Generate pairing code** (valid 10 minutes, single use).

You'll see `connected as d_…` and the web app shows the laptop **Online**. Leave the window open; closing it turns remote control off. To start it with Windows, put a shortcut to `hukm-controller.exe run` in `shell:startup`.

## D. First commands
Try in the web app (type or tap the mic):
* `Downloads folder kholo`
* `Chrome kholo`
* `Meri invoice wali file search karo`
* `YouTube par Gold analysis play karo`
* `Mujhe laptop ki screen dikhao` (asks for approval)

## E. Voice on your phone
* Use **Chrome on Android** or **Safari on iPhone** over the HTTPS URL.
* Voice → *Recognition language*: start with **Urdu (Pakistan) ur-PK**. If your phone doesn't support it or mishears Roman-Urdu commands, try **English (Pakistan)** or **Hindi** — both work with the Roman Urdu command engine.
* Spoken replies use the voices installed on the device. Android: Settings → Text-to-speech → install Urdu in Google Speech Services. Desktop Edge has natural `ur-PK` voices.

## Troubleshooting
| Symptom | Fix |
|---|---|
| “Setup code is wrong” | Use the code from the relay console of *this* run; restart the relay to print it again (only while no account exists). |
| Laptop shows Offline | Is the controller window open? Is the relay URL right (https vs http)? See `%APPDATA%\HUKM AI\controller.log`. |
| “relay rejected this device (401/403)” | The device was removed in the web app or the token is stale. Run `hukm-controller pair …` again. |
| Mic button says it needs a secure address | Open the app through the HTTPS tunnel URL, not `http://192.168…`. |
| Commands time out | The laptop went to sleep or lost Wi-Fi. Commands queue for 5 minutes, then expire. |
