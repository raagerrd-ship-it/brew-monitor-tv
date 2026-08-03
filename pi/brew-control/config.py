"""Configuration for the Pi brew controller.

Tank-to-relay mapping, cloud endpoints, and PID defaults.
Copy env.example to .env and fill in the values.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass


@dataclass
class TankConfig:
    """One fermentation tank with its sensor and relay pair."""
    sensor_key: str          # calibration key: 'tank1', 'tank2', 'tank3'
    controller_id: str       # matches rapt_temp_controllers.controller_id
    name: str
    heat_pin: int            # BCM GPIO for heating relay
    cool_pin: int            # BCM GPIO for cooling relay (glycol pump)


# ── Relay mapping (BCM, active-low) ────────────────────────────────────
# Verified against physical wiring (cables are reversed vs. the natural order):
# IN1=12 komp, IN2=26, IN3=25, IN4=24, IN5=23, IN6=22, IN7=27, IN8=17 CO2.
TANKS = [
    TankConfig("tank1", "6fbbc7db", "Grön (Mjöd)", 26, 25),
    TankConfig("tank2", "ffa62be4", "Blå (Skogens Sus)", 24, 23),
    TankConfig("tank3", "618b29b0", "Gul", 22, 27),
]

GLYCOL_SENSOR_KEY = "glycol"
COMPRESSOR_PIN = 12          # BCM GPIO for glycol compressor relay (IN1)
CO2_PIN = 17                 # reserve (IN8)
RELIEF_PIN = 16              # reserve

# ── PWM / timing ───────────────────────────────────────────────────────
PWM_PERIOD_S = 180           # 3 min — PID decision once per window
MIN_ON_S = 5                 # shortest relay on-pulse
MIN_OFF_S = 5                # shortest relay off-gap
SENSOR_FRESH_S = 60          # no heating/cooling without fresh PT100 within 60 s

# ── Compressor protection ──────────────────────────────────────────────
COMPRESSOR_MIN_ON_S = 300    # 5 min minimum run
COMPRESSOR_MIN_OFF_S = 300   # 5 min minimum off
COMPRESSOR_MAX_STARTS_PER_H = 6
COMPRESSOR_STARTUP_DELAY_S = 180  # wait after Pi boot before compressor
GLYCOL_HYSTERESIS = 1.5      # ±° around setpoint
GLYCOL_FREEZE_LIMIT = -5.0   # hard lower limit
GLYCOL_IDLE_TEMP = 15.0      # idle setpoint when no tank needs cooling

# ── Mode selection (two-stage hysteresis) ─────────────────────────────
NEUTRAL_BAND = 0.25          # |Δ| < this → neutral (no mode change)
FLIP_BAND = 0.60             # 0.25–0.60 → flip after 30 min
FLIP_FAST = 0.80             # > 0.80 → immediate flip
FLIP_DELAY_S = 1800          # 30 min for medium error
FLIP_FAST_DELAY_S = 600      # 10 min for large error
WRONG_SIDE_BAND = 0.15       # latch threshold
WRONG_SIDE_LATCH_S = 3600    # 1 hour on wrong side → force flip

# ── Hard safety limits ────────────────────────────────────────────────
TEMP_MIN = -2.0              # absolute min tank temp (hard cutoff)
TEMP_MAX = 40.0              # absolute max tank temp (hard cutoff)

# ── Cloud sync ────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
PI_SECRET = os.environ.get("PI_BLE_INGEST_SECRET", "")
CONTROL_ENDPOINT = f"{SUPABASE_URL}/functions/v1/pi-control"
TELEMETRY_ENDPOINT = f"{SUPABASE_URL}/functions/v1/pi-telemetry"
SYNC_INTERVAL_S = 30         # snabbsynk
ROLLUP_INTERVAL_S = 300      # full synk (5 min)

# ── Data paths ────────────────────────────────────────────────────────
DATA_DIR = Path(os.environ.get("BREW_CONTROL_DATA", Path(__file__).parent))
STATE_DB = DATA_DIR / "regulator_state.db"
JOURNAL_PATH = DATA_DIR / "regulator_journal.jsonl"

# ── PID defaults (overridden by cloud-learned values) ─────────────────
DEFAULT_PARAMS = {
    "cooling": {
        "feedforward_duty": 0.05,
        "process_gain": 0.0,
        "Kp": 0.22,
        "Kd": 5.0 / 60,
        "Ki": 0.06,
    },
    "heating": {
        "feedforward_duty": 0.05,
        "process_gain": 0.0,
        "Kp": 0.35,
        "Kd": 3.5 / 60,
        "Ki": 0.10,
    },
    "dead_time_hours": 0.25,
}
