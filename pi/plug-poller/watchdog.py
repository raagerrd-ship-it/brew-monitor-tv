#!/usr/bin/env python3
"""
RAPT watchdog — runs on the Pi.

Every WATCHDOG_INTERVAL_SEC it asks Supabase for the freshest `last_update`
across all `rapt_temp_controllers`. If the newest timestamp is older than
WATCHDOG_STALE_MIN, the RAPT API/cloud has gone dark — queue a `restart`
command for the plug so the controller power-cycles.

A cooldown prevents repeated restarts: after queueing a restart we wait at
least WATCHDOG_COOLDOWN_MIN (looking at the latest 'restart' command of
source='watchdog' in plug_commands) before queueing another.
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
INTERVAL = int(os.environ.get("WATCHDOG_INTERVAL_SEC", "300"))
STALE_MIN = int(os.environ.get("WATCHDOG_STALE_MIN", "31"))
COOLDOWN_MIN = int(os.environ.get("WATCHDOG_COOLDOWN_MIN", "20"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("watchdog")

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def parse_ts(s: str | None) -> datetime | None:
    if not s:
        return None
    # Supabase returns ISO 8601, may end with 'Z' or '+00:00'
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def latest_controller_update() -> datetime | None:
    """Most recent last_update across all RAPT controllers."""
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/rapt_temp_controllers",
        params={
            "select": "last_update",
            "order": "last_update.desc.nullslast",
            "limit": "1",
        },
        headers=HEADERS,
        timeout=15,
    )
    r.raise_for_status()
    rows = r.json()
    if not rows:
        return None
    return parse_ts(rows[0].get("last_update"))


def last_watchdog_restart() -> datetime | None:
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/plug_commands",
        params={
            "select": "created_at",
            "source": "eq.watchdog",
            "command": "eq.restart",
            "order": "created_at.desc",
            "limit": "1",
        },
        headers=HEADERS,
        timeout=15,
    )
    r.raise_for_status()
    rows = r.json()
    if not rows:
        return None
    return parse_ts(rows[0].get("created_at"))


def queue_restart(reason: str) -> None:
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/plug_commands",
        headers={**HEADERS, "Prefer": "return=minimal"},
        json={"command": "restart", "source": "watchdog"},
        timeout=15,
    )
    r.raise_for_status()
    log.warning("watchdog queued RESTART: %s", reason)


def check_once() -> None:
    latest = latest_controller_update()
    if latest is None:
        log.info("no controller data yet — skipping")
        return

    age_min = (now_utc() - latest).total_seconds() / 60
    log.info("latest controller update %.1f min ago", age_min)

    if age_min < STALE_MIN:
        return

    last_restart = last_watchdog_restart()
    if last_restart is not None:
        since_restart_min = (now_utc() - last_restart).total_seconds() / 60
        if since_restart_min < COOLDOWN_MIN:
            log.info(
                "stale %.1f min but watchdog restart only %.1f min ago — cooldown (%d min)",
                age_min, since_restart_min, COOLDOWN_MIN,
            )
            return

    queue_restart(f"RAPT stale {age_min:.1f} min (threshold {STALE_MIN})")


# ── main loop ──────────────────────────────────────────────────────────────
_stop = False


def _on_signal(*_):
    global _stop
    _stop = True


def main() -> int:
    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)
    log.info(
        "watchdog started (interval=%ds, stale=%dmin, cooldown=%dmin)",
        INTERVAL, STALE_MIN, COOLDOWN_MIN,
    )
    while not _stop:
        start = time.time()
        try:
            check_once()
        except requests.HTTPError as e:
            log.error("supabase error: %s — %s", e, getattr(e.response, "text", ""))
        except Exception as e:
            log.exception("check failed: %s", e)
        elapsed = time.time() - start
        time.sleep(max(5, INTERVAL - elapsed))
    return 0


if __name__ == "__main__":
    sys.exit(main())