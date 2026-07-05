#!/usr/bin/env python3
"""Drain unsynced pill readings from SQLite to Lovable Cloud."""

import logging
import os
import sqlite3
import sys
import time

import httpx
from dotenv import load_dotenv

load_dotenv("/opt/brew-ble/.env")

DB_PATH = os.environ.get("DB_PATH", "/opt/brew-ble/readings.db")
INGEST_URL = os.environ["INGEST_URL"]
SECRET = os.environ["PI_BLE_INGEST_SECRET"]
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")
BATCH_SIZE = 200
MAX_RETRIES = 3

logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("uploader")


def fetch_batch(con: sqlite3.Connection):
    cur = con.execute(
        "SELECT id, mac, temp_c, gravity_sg, battery_pct, rssi, recorded_at "
        "FROM pill_readings WHERE synced = 0 ORDER BY recorded_at ASC LIMIT ?",
        (BATCH_SIZE,),
    )
    rows = cur.fetchall()
    return rows


def post(readings, heartbeat=False) -> bool:
    body = {"readings": readings, "heartbeat": heartbeat}
    backoff = 1.0
    for attempt in range(MAX_RETRIES):
        try:
            r = httpx.post(
                INGEST_URL,
                json=body,
                headers={"x-pi-secret": SECRET, "Content-Type": "application/json"},
                timeout=20.0,
            )
            if r.status_code == 200:
                log.info("uploaded %d readings → %s", len(readings), r.json())
                return True
            log.warning("HTTP %s: %s", r.status_code, r.text[:200])
        except Exception as e:
            log.warning("upload attempt %d failed: %s", attempt + 1, e)
        time.sleep(backoff)
        backoff *= 2
    return False


def main():
    con = sqlite3.connect(DB_PATH, isolation_level=None)
    rows = fetch_batch(con)

    if not rows:
        # Heartbeat every run so Cloud can see Pi is alive
        post([], heartbeat=True)
        return 0

    payload = [
        {
            "mac": r[1],
            "temp_c": r[2],
            "gravity_sg": r[3],
            "battery_pct": r[4],
            "rssi": r[5],
            "recorded_at": r[6],
        }
        for r in rows
    ]
    ids = [r[0] for r in rows]

    if post(payload):
        con.executemany("UPDATE pill_readings SET synced = 1 WHERE id = ?", [(i,) for i in ids])
        con.commit()
        # No housekeeping: keep full history locally as archive
        # (~150 MB/year per pill - trivial on Pi 5)
        return 0

    log.error("upload failed after retries — readings remain queued")
    return 1


if __name__ == "__main__":
    sys.exit(main())