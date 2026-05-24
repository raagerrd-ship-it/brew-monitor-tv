#!/usr/bin/env python3
"""
RAPT Pill BLE scanner.

RAPT Pills broadcast a Tilt-compatible iBeacon manufacturer-data payload
(Apple company id 0x004C, type 0x02 iBeacon). The UUID identifies the pill
color; the major field encodes temperature in Fahrenheit, and the minor
field encodes specific gravity * 1000.

Battery + RSSI come straight from the advertisement metadata when available.
"""

import asyncio
import logging
import os
import sqlite3
import struct
from datetime import datetime, timezone

from bleak import BleakScanner
from dotenv import load_dotenv

load_dotenv("/opt/brew-ble/.env")

DB_PATH = os.environ.get("DB_PATH", "/opt/brew-ble/readings.db")
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")

logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("ble-scanner")

APPLE_COMPANY_ID = 0x004C  # iBeacon manufacturer id used by RAPT Pill

# In-memory throttle: only write 1 reading per MAC per 30s to keep SQLite light
_last_write: dict[str, float] = {}
THROTTLE_SECONDS = 30.0


def f_to_c(f: float) -> float:
    return round((f - 32.0) * 5.0 / 9.0, 3)


def parse_ibeacon(mfg: bytes) -> tuple[float, float] | None:
    """Parse iBeacon payload from manufacturer data. Returns (temp_c, sg)."""
    # iBeacon layout after company id: [0x02, 0x15, UUID(16), major(2), minor(2), tx_power(1)]
    if len(mfg) < 23 or mfg[0] != 0x02 or mfg[1] != 0x15:
        return None
    major = struct.unpack(">H", mfg[18:20])[0]  # temperature, Fahrenheit
    minor = struct.unpack(">H", mfg[20:22])[0]  # gravity * 1000
    if major == 0 or minor == 0:
        return None
    return f_to_c(float(major)), round(minor / 1000.0, 4)


def insert(con: sqlite3.Connection, mac: str, temp_c, sg, rssi):
    con.execute(
        "INSERT INTO pill_readings (mac, temp_c, gravity_sg, battery_pct, rssi, recorded_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (mac, temp_c, sg, None, rssi, datetime.now(timezone.utc).isoformat()),
    )
    con.commit()


async def main():
    con = sqlite3.connect(DB_PATH, isolation_level=None)
    log.info("BLE scanner starting, DB=%s", DB_PATH)

    def detection(device, adv):
        try:
            mfg = adv.manufacturer_data.get(APPLE_COMPANY_ID)
            if not mfg:
                return
            parsed = parse_ibeacon(bytes(mfg))
            if not parsed:
                return
            temp_c, sg = parsed
            mac = device.address.lower().replace(":", "")

            now = asyncio.get_event_loop().time()
            last = _last_write.get(mac, 0.0)
            if now - last < THROTTLE_SECONDS:
                return
            _last_write[mac] = now

            insert(con, mac, temp_c, sg, adv.rssi)
            log.info("pill %s temp=%.2f sg=%.4f rssi=%s", mac, temp_c, sg, adv.rssi)
        except Exception as e:
            log.exception("detection error: %s", e)

    scanner = BleakScanner(detection_callback=detection)
    await scanner.start()
    try:
        while True:
            await asyncio.sleep(3600)
    finally:
        await scanner.stop()
        con.close()


if __name__ == "__main__":
    asyncio.run(main())