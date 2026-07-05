#!/usr/bin/env python3
"""RAPT Pill BLE scanner (Kegland 0x4152 / "PT" V2 format).

RAPT Pill broadcasts manufacturer-specific data with Kegland's company id
0x4152 ("RA"). Payload starts with "PT" magic, byte 2 = version (V2 used by
current firmware). Big-endian fields:
  [0:2]  "PT"
  [2]    version (0x02)
  [3]    mac-present flag
  [4]    gravity-velocity-valid flag
  [5:9]  gravity_velocity (float32 BE, points/day if valid)
  [9:11] temperature_raw (uint16 BE, Kelvin*128)
  [11:15] gravity_raw (float32 BE, SG*1000)
  [15:17] accel_x (int16 BE)
  [17:19] accel_y (int16 BE)
  [19:21] accel_z (int16 BE)
  [21:23] battery_raw (uint16 BE, percent*256)

Writes to SQLite (table pill_readings) for uploader.py to drain.
"""

import asyncio
import logging
import os
import sqlite3
import struct
import time
from datetime import datetime, timezone

from bleak import BleakScanner
from dotenv import load_dotenv

load_dotenv("/opt/brew-ble/.env")

DB_PATH = os.environ.get("DB_PATH", "/opt/brew-ble/readings.db")
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")
THROTTLE_SECONDS = float(os.environ.get("THROTTLE_SECONDS", "30"))
# Silent-stall watchdog: if no reading is written for this long, BlueZ has
# likely stalled (process alive but delivering no advertisements) — exit so
# systemd (Restart=always) gives us a fresh BLE session.
STALL_RESTART_SEC = float(os.environ.get("STALL_RESTART_SEC", "1200"))

logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("ble-scanner")

KEGLAND_COMPANY_ID = 0x4152  # "RA" - RAPT Pill / Kegland

_last_hex: dict[str, tuple[str, float]] = {}
_last_reading_ts = 0.0  # monotonic time of the last successful insert


def looks_like_rapt(mfg_data: dict[int, bytes]) -> bytes | None:
    for cid, data in mfg_data.items():
        if cid == KEGLAND_COMPANY_ID:
            return data
        if len(data) >= 2 and data[:2] in (b"PT", b"PV"):
            return data
    return None


def decode_rapt_pt(data: bytes) -> tuple[float, float, int] | None:
    """Return (temp_c, gravity_sg, battery_pct_int) or None."""
    if len(data) < 23 or data[:2] != b"PT":
        return None
    try:
        temp_raw = struct.unpack_from(">H", data, 9)[0]
        temp_c = temp_raw / 128.0 - 273.15
        gravity = struct.unpack_from(">f", data, 11)[0] / 1000.0
        battery = struct.unpack_from(">H", data, 21)[0] / 256.0
    except struct.error:
        return None
    if not (-20 < temp_c < 60) or not (0.9 < gravity < 1.3):
        return None
    return round(temp_c, 3), round(gravity, 4), int(round(battery))


def insert(con: sqlite3.Connection, mac: str, temp_c: float,
           sg: float, batt: int, rssi: int):
    con.execute(
        "INSERT INTO pill_readings (mac, temp_c, gravity_sg, battery_pct, rssi, recorded_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (mac, temp_c, sg, batt, rssi,
         datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
    )
    con.commit()


async def watchdog_loop():
    """Exit non-zero if BLE goes silent past STALL_RESTART_SEC, so systemd
    restarts us. Catches BlueZ stalls that leave the process alive but
    delivering no advertisements (Restart=always never fires on its own)."""
    while True:
        await asyncio.sleep(60)
        silence = time.monotonic() - _last_reading_ts
        if silence > STALL_RESTART_SEC:
            log.error(
                "no BLE readings for %.0fs (> %ds) — BlueZ likely stalled, "
                "exiting for systemd restart", silence, STALL_RESTART_SEC,
            )
            os._exit(1)


async def main():
    global _last_reading_ts
    con = sqlite3.connect(DB_PATH, isolation_level=None)
    _last_reading_ts = time.monotonic()  # grace window from startup
    log.info("RAPT BLE scanner starting, DB=%s throttle=%ss stall_restart=%ss",
             DB_PATH, THROTTLE_SECONDS, STALL_RESTART_SEC)

    def detection(device, adv):
        global _last_reading_ts
        try:
            data = looks_like_rapt(adv.manufacturer_data)
            if data is None:
                return
            parsed = decode_rapt_pt(bytes(data))
            if parsed is None:
                return
            temp_c, sg, batt = parsed
            mac = device.address.lower().replace(":", "")
            hex_str = data.hex()

            prev_hex, prev_ts = _last_hex.get(mac, ("", 0.0))
            now = time.monotonic()
            if hex_str == prev_hex and (now - prev_ts) < THROTTLE_SECONDS:
                return
            _last_hex[mac] = (hex_str, now)

            insert(con, mac, temp_c, sg, batt, adv.rssi)
            _last_reading_ts = now
            log.info("pill %s temp=%.2fC sg=%.4f batt=%d%% rssi=%s",
                     mac, temp_c, sg, batt, adv.rssi)
        except Exception as e:
            log.exception("detection error: %s", e)

    scanner = BleakScanner(detection_callback=detection)
    await scanner.start()
    try:
        await watchdog_loop()
    finally:
        await scanner.stop()
        con.close()


if __name__ == "__main__":
    asyncio.run(main())
