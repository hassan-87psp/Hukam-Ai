@echo off
REM Gives the relay a free HTTPS address so your phone can reach it (and use the microphone).
REM Requires cloudflared: winget install --id Cloudflare.cloudflared
REM Quick tunnels get a random https://*.trycloudflare.com URL each run. For a fixed URL use a named tunnel (see docs/setup-guide.md).
cloudflared tunnel --url http://localhost:8787
