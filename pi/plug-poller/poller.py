#!/usr/bin/env python3
"""
Plug poller — runs on the Pi.

- Polls Supabase `plug_commands` for pending rows.
- Executes on/off/restart on the local Tuya plug via tinytuya.
- Marks the command as 'done' (or 'error') with executed_at.
- Periodically reports actual plug state to `plug_state`.

Never exposed to the internet — all traffic is outbound HTTPS to Supabase
plus local LAN to the plug.
"""
from __future__ import annotations

import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
import tinytuya

# ── env loading ────────────────────────────────────────────────────────────
ENV_PATH = Path(__file__).parent / ".env"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_ANON_KEY"]
TUYA_DEVICE_ID = os.environ["TUYA_DEVICE_ID"]
TUYA_LOCAL_KEY = os.environ["TUYA_LOCAL_KEY"]
TUYA_IP = os.environ["TUYA_IP"]
TUYA_VERSION = float(os.environ.get("TUYA_VERSION", "3.4"))
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL_SEC", "10"))
STATE_INTERVAL = int(os.environ.get("STATE_REPORT_INTERVAL_SEC", "30"))
RESTART_OFF = int(os.environ.get("RESTART_OFF_SECONDS", "8"))
MAX_COMMAND_AGE_SEC = int(os.environ.get("MAX_COMMAND_AGE_SEC", "300"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("plug-poller")

# ── Supabase REST helpers ──────────────────────────────────────────────────
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def fetch_pending() -> list[dict]:
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/plug_commands",
        params={
            "select": "id,command,source,created_at",
            "status": "eq.pending",
            "order": "created_at.asc",
            "limit": "10",
        },
        headers=HEADERS,
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def mark_command(cmd_id: str, status: str) -> None:
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/plug_commands",
        params={"id": f"eq.{cmd_id}"},
        headers={**HEADERS, "Prefer": "return=minimal"},
        json={"status": status, "executed_at": now_iso()},
        timeout=15,
    )
    r.raise_for_status()


def report_state(is_on: bool | None) -> None:
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/plug_state",
        params={"id": "eq.1"},
        headers={**HEADERS, "Prefer": "return=minimal"},
        json={"is_on": is_on, "updated_at": now_iso()},
        timeout=15,
    )
    r.raise_for_status()


# ── Tuya plug ──────────────────────────────────────────────────────────────
def make_plug() -> tinytuya.OutletDevice:
    d = tinytuya.OutletDevice(TUYA_DEVICE_ID, TUYA_IP, TUYA_LOCAL_KEY)
    d.set_version(TUYA_VERSION)
    d.set_socketTimeout(5)
    return d


def plug_status(d: tinytuya.OutletDevice) -> bool | None:
    try:
        s = d.status()
        dps = (s or {}).get("dps") or {}
        # DP "1" is the on/off switch on virtually all Tuya plugs
        if "1" in dps:
            return bool(dps["1"])
        for v in dps.values():
            if isinstance(v, bool):
                return v
        return None
    except Exception as e:
        log.warning("plug status failed: %s", e)
        return None


def plug_set(d: tinytuya.OutletDevice, on: bool) -> bool:
    try:
        d.set_status(on, switch=1)
        return True
    except Exception as e:
        log.error("plug set %s failed: %s", on, e)
        return False


def execute(d: tinytuya.OutletDevice, command: str) -> bool:
    if command == "on":
        return plug_set(d, True)
    if command == "off":
        return plug_set(d, False)
    if command == "restart":
        ok1 = plug_set(d, False)
        time.sleep(RESTART_OFF)
        ok2 = plug_set(d, True)
        return ok1 and ok2
    log.error("unknown command: %s", command)
    return False


# ── main loop ──────────────────────────────────────────────────────────────
_stop = False


def _on_signal(*_):
    global _stop
    _stop = True
    log.info("stopping…")


def main() -> int:
    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    log.info(
        "plug-poller started (poll=%ds, state=%ds, plug=%s)",
        POLL_INTERVAL, STATE_INTERVAL, TUYA_IP,
    )

    plug = make_plug()
    last_state_report = 0.0
    # In-memory guard: never execute the same command id twice in one process
    # lifetime, even if the DB write to mark it done fails.
    handled: set[str] = set()

    while not _stop:
        loop_start = time.time()

        # 1. process pending commands
        try:
            for cmd in fetch_pending():
                cmd_id = cmd["id"]
                command = cmd["command"]
                if cmd_id in handled:
                    log.warning("skipping already-handled id=%s (mark_command must have failed)", cmd_id)
                    continue
                created = cmd.get("created_at")
                if created:
                    try:
                        ts = datetime.fromisoformat(created.replace("Z", "+00:00"))
                        age = (datetime.now(timezone.utc) - ts).total_seconds()
                        if age > MAX_COMMAND_AGE_SEC:
                            log.warning(
                                "skipping stale command id=%s age=%.0fs > %ds",
                                cmd_id, age, MAX_COMMAND_AGE_SEC,
                            )
                            handled.add(cmd_id)
                            try:
                                mark_command(cmd_id, "error")
                            except Exception as e:
                                log.error("failed to mark stale command: %s", e)
                            continue
                    except ValueError:
                        pass
                log.info("executing %s (id=%s, source=%s)", command, cmd_id, cmd.get("source"))
                ok = execute(plug, command)
                handled.add(cmd_id)
                mark_command(cmd_id, "done" if ok else "error")
                # report state immediately after a command
                last_state_report = 0.0
        except requests.HTTPError as e:
            log.error("supabase error: %s — %s", e, getattr(e.response, "text", ""))
        except Exception as e:
            log.exception("command loop error: %s", e)

        # 2. periodic state report
        if time.time() - last_state_report >= STATE_INTERVAL:
            is_on = plug_status(plug)
            try:
                report_state(is_on)
                log.debug("reported state is_on=%s", is_on)
            except Exception as e:
                log.error("report_state failed: %s", e)
            last_state_report = time.time()

        # sleep the remainder of the poll interval
        elapsed = time.time() - loop_start
        time.sleep(max(0.5, POLL_INTERVAL - elapsed))

    return 0


if __name__ == "__main__":
    sys.exit(main())