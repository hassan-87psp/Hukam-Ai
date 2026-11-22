"""Command-line entry point.

  hukm-controller                 # first run: asks for relay URL + pairing code, then connects
  hukm-controller pair --server https://… --code ABCD-EFGH
  hukm-controller run
  hukm-controller status
  hukm-controller unpair          # forget local credentials (also remove it in the web app)
  hukm-controller config          # show config file location and current settings
  hukm-controller autostart on|off|status  # opt-in, local-only Windows startup
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import logging.handlers
import signal
import sys
from dataclasses import asdict

from . import VERSION
from .communication.client import ControllerClient
from .communication.pairing import PairingError, claim
from .config import IS_WINDOWS, Config, data_dir
from .security import credentials
from .system import autostart, single_instance

BANNER = r"""
  ╦ ╦╦ ╦╦╔═╔╦╗  ╔═╗╦
  ╠═╣║ ║╠╩╗║║║  ╠═╣║   Windows Controller v{v}
  ╩ ╩╚═╝╩ ╩╩ ╩  ╩ ╩╩   Just Speak. It's Done.
"""


def setup_logging(level: str) -> None:
    fmt = logging.Formatter("%(asctime)s  %(levelname)-7s %(message)s", "%H:%M:%S")
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    root.addHandler(sh)
    fh = logging.handlers.RotatingFileHandler(data_dir() / "controller.log", maxBytes=1_000_000, backupCount=2, encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root.addHandler(fh)
    logging.getLogger("websockets").setLevel(logging.WARNING)
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass


def set_title(t: str) -> None:
    if IS_WINDOWS:
        try:
            import ctypes

            ctypes.windll.kernel32.SetConsoleTitleW(t)
        except Exception:
            pass


def do_pair(server: str, code: str) -> int:
    try:
        r = claim(server, code)
    except PairingError as e:
        print(f"✖ Pairing failed: {e}")
        return 1
    try:
        credentials.save_device(server, r["deviceId"], r["deviceToken"], r.get("name", ""))
    except (RuntimeError, OSError):
        print("Pairing could not be stored securely. Existing local credentials were not replaced. "
              "Remove the newly created device in the web app before trying again.")
        return 1
    cfg = Config.load()
    cfg.server_url = server
    cfg.save()
    print(f"✔ Paired as “{r.get('name')}”. Device ID {r['deviceId']}")
    return 0


def do_run() -> int:
    guard = single_instance.acquire()
    if guard is None:
        print("HUKM AI is already running on this Windows session. "
              "Close the existing ONLINE Controller before starting another copy.")
        return 2
    try:
        dev = credentials.load_device()
        cfg = Config.load()
        if not dev:
            print("This laptop is not paired yet. Run:  hukm-controller pair --server <relay URL> --code <code>")
            return 1
        cfg.server_url = dev["server_url"]
        setup_logging(cfg.log_level)
        print(BANNER.format(v=VERSION))
        print(f"  Relay:   {cfg.server_url}")
        print(f"  Device:  {dev.get('name') or dev['device_id']}")
        print(f"  Config:  {Config.path()}")
        print("  Remote control is ACTIVE while this window is open. Close it (or press Ctrl+C) to stop.\n")

        def on_status(s: str) -> None:
            set_title(f"HUKM AI Controller — {s.upper()}")

        client = ControllerClient(cfg, dev["token"], on_status=on_status)

        async def main() -> None:
            loop = asyncio.get_running_loop()
            try:
                loop.add_signal_handler(signal.SIGINT, client.stop)
                loop.add_signal_handler(signal.SIGTERM, client.stop)
            except NotImplementedError:
                pass  # Windows: KeyboardInterrupt handles Ctrl+C
            await client.run_forever()

        try:
            asyncio.run(main())
        except KeyboardInterrupt:
            pass
        print("\nController stopped. Remote control is OFF.")
        return 0

    finally:
        single_instance.release(guard)

def interactive_first_run() -> int:
    print(BANNER.format(v=VERSION))
    print("First-time setup. In the HUKM AI web app open Devices → Pair new device to get a code.\n")
    server = input("Relay URL (e.g. https://hukm.example.com): ").strip()
    code = input("Pairing code: ").strip()
    if do_pair(server, code) != 0:
        input("Press Enter to close…")
        return 1
    return do_run()


def main(argv: list[str] | None = None) -> int:
    # Read-only private child entry point. No pairing, remote connection,
    # filesystem access to user data, or desktop input is initiated here.
    actual_args = sys.argv[1:] if argv is None else argv
    if actual_args == ["--local-ocr-worker"]:
        from .screen.ocr_process import worker_main
        return worker_main()
    if len(actual_args)==2 and actual_args[0]=="--whatsapp-uia-worker":
        from .whatsapp.uia_probe import worker_main
        return worker_main(actual_args[1])
    p = argparse.ArgumentParser(prog="hukm-controller", description="HUKM AI Windows controller")
    p.add_argument("--version", action="version", version=VERSION)
    sub = p.add_subparsers(dest="cmd")
    pp = sub.add_parser("pair", help="pair this laptop with your HUKM AI account")
    pp.add_argument("--server", required=True)
    pp.add_argument("--code", required=True)
    sub.add_parser("run", help="connect and accept commands")
    sub.add_parser("status", help="show pairing status")
    sub.add_parser("unpair", help="forget this laptop's credentials")
    sub.add_parser("config", help="show configuration")
    ap = sub.add_parser("autostart", help="opt in/out of starting the controller at Windows sign-in")
    ap.add_argument("state", choices=["on", "off", "status"])
    a = p.parse_args(argv)

    if a.cmd == "pair":
        return do_pair(a.server, a.code)
    if a.cmd == "run":
        return do_run()
    if a.cmd == "status":
        d = credentials.load_device()
        print(json.dumps({"paired": bool(d), "server": d and d["server_url"], "deviceId": d and d["device_id"], "name": d and d.get("name")}, indent=2))
        return 0
    if a.cmd == "unpair":
        print("Local credentials removed." if credentials.forget_device() else "Not paired.")
        print("Also remove the device in the web app (Devices → Remove) to revoke its token on the relay.")
        return 0
    if a.cmd == "config":
        cfg = Config.load()
        if not Config.path().exists():
            cfg.save()
        print(f"Config file: {Config.path()}\n")
        print(json.dumps(asdict(cfg), indent=2))
        return 0
    if a.cmd == "autostart":
        try:
            if a.state == "on":
                if not credentials.load_device():
                    print("Pair this controller first, before enabling autostart.")
                    return 1
                path = autostart.enable()
                print(f"Autostart ENABLED for your Windows sign-in. Visible minimized controller: {path}")
            elif a.state == "off":
                print("Autostart DISABLED." if autostart.disable() else "Autostart was already disabled.")
            else:
                print("Autostart is " + ("ENABLED" if autostart.is_enabled() else "DISABLED"))
            return 0
        except (OSError, RuntimeError) as e:
            print(f"Autostart failed: {e}")
            return 1
    if credentials.load_device():
        return do_run()
    return interactive_first_run()
