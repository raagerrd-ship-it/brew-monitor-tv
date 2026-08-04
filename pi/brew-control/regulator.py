"""Main regulator loop — the brain of the Pi brew controller.

Architecture:
  1. SensorHub samples PT100 at 1 Hz (already running via sensors.py).
  2. This loop runs one PID decision per PWM window (180 s) per tank.
  3. Mode selection uses two-stage hysteresis + 1h wrong-side latch.
  4. Safety constraints are evaluated before relay actuation.
  5. Cloud sync: live state every 30 s, rollup every 5 min.
  6. Glycol compressor is demand-controlled: idle at 15°, active when any
     tank needs cooling.

State is persisted to SQLite so the regulator survives reboots.
"""

from __future__ import annotations

import json
import math
import sqlite3
import time
import threading
import logging
from dataclasses import dataclass, field
from typing import Dict, Optional, List
from collections import deque
from statistics import fmean

import config
from pid import V6PidState, compute_duty, derive_gains, COOL, HEAT
import cloud_sync
from constraints import DutyCommand, ConstraintChain, default_chain, ConstraintViolation
from relay import RelayHub

log = logging.getLogger(__name__)

# Pill-värdet kommer via molnet (RAPT-sync). Äldre än detta → strunta i det.
PILL_MAX_AGE_S = 3600


def _parse_ts(ts) -> Optional[float]:
    if not ts:
        return None
    try:
        from datetime import datetime
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).timestamp()
    except Exception:
        return None

# ── State persistence ──────────────────────────────────────────────────

def _init_db(db_path):
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS pid_state (
            controller_id TEXT PRIMARY KEY,
            state_json TEXT NOT NULL,
            mode TEXT,
            wrong_side_since REAL,
            flip_pending_since REAL,
            last_setpoint_version INTEGER,
            updated_at REAL
        )
    """)
    conn.commit()
    return conn


# ── Tank regulator (one per active tank) ───────────────────────────────

@dataclass
class TankRegulator:
    controller_id: str
    name: str
    sensor_key: str
    mode: str = "cooling"          # start in cooling (safe default)
    pid_state: V6PidState = field(default_factory=V6PidState)

    # Cloud-fetched setpoint + params
    target_temp: float = 18.0
    max_duty_pct: float = 100.0
    learned_params: dict = field(default_factory=dict)

    # Pill (från molnet) — används för snittet som vi reglerar mot
    pill_temp: Optional[float] = None
    pill_updated_at: Optional[float] = None
    dual_sensor_enabled: bool = True
    last_pt100: Optional[float] = None
    last_fused: Optional[float] = None

    # Mode-selection state
    wrong_side_since: Optional[float] = None
    flip_pending_since: Optional[float] = None
    last_setpoint_version: Optional[int] = None

    # PWM execution
    current_duty: float = 0.0
    pwm_thread: Optional[threading.Thread] = None

    # Telemetry buffers
    temp_buffer: deque = field(default_factory=lambda: deque(maxlen=300))
    duty_buffer: deque = field(default_factory=lambda: deque(maxlen=300))

    def save_state(self, conn: sqlite3.Connection):
        conn.execute(
            "INSERT OR REPLACE INTO pid_state (controller_id, state_json, mode, "
            "wrong_side_since, flip_pending_since, last_setpoint_version, updated_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (self.controller_id, json.dumps(self.pid_state.to_dict()), self.mode,
             self.wrong_side_since, self.flip_pending_since,
             self.last_setpoint_version, time.time())
        )
        conn.commit()

    def load_state(self, conn: sqlite3.Connection):
        row = conn.execute(
            "SELECT state_json, mode, wrong_side_since, flip_pending_since, "
            "last_setpoint_version FROM pid_state WHERE controller_id = ?",
            (self.controller_id,)
        ).fetchone()
        if row:
            self.pid_state = V6PidState.from_dict(json.loads(row[0]))
            if row[1] in ("heating", "cooling"):
                self.mode = row[1]
            self.wrong_side_since = row[2]
            self.flip_pending_since = row[3]
            self.last_setpoint_version = row[4]


# ── Mode selection ─────────────────────────────────────────────────────

def select_mode(tank: TankRegulator, temp: float, target: float, now: float) -> str:
    """Two-stage hysteresis + 1h wrong-side latch."""
    delta = temp - target
    abs_delta = abs(delta)

    # Reset wrong-side latch when crossing target
    if abs_delta < config.WRONG_SIDE_BAND:
        if tank.wrong_side_since is not None and delta * (1 if tank.mode == "cooling" else -1) <= 0:
            tank.wrong_side_since = None

    current_mode = tank.mode
    desired = "cooling" if delta > 0 else "heating"

    # Already in the right mode?
    if desired == current_mode:
        tank.flip_pending_since = None
        return current_mode

    # Wrong side — track duration
    if tank.wrong_side_since is None:
        tank.wrong_side_since = now

    # Immediate flip for large error
    if abs_delta > config.FLIP_FAST:
        tank.flip_pending_since = None
        return desired

    # Time-based flip
    if tank.flip_pending_since is None:
        tank.flip_pending_since = now

    delay = config.FLIP_FAST_DELAY_S if abs_delta > config.FLIP_BAND else config.FLIP_DELAY_S
    if (now - tank.flip_pending_since) >= delay:
        tank.flip_pending_since = None
        return desired

    # 1h wrong-side latch
    if (tank.wrong_side_since is not None
            and (now - tank.wrong_side_since) >= config.WRONG_SIDE_LATCH_S):
        tank.wrong_side_since = None
        tank.flip_pending_since = None
        return desired

    return current_mode


# ── Main regulator ─────────────────────────────────────────────────────

class Regulator:
    def __init__(self, sensor_hub, relay_hub: RelayHub):
        self.sensors = sensor_hub
        self.relays = relay_hub
        self.conn = _init_db(config.STATE_DB)
        self.chain = default_chain()
        self.tanks: Dict[str, TankRegulator] = {}
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self.boot_time = time.time()

        for t in config.TANKS:
            if t.controller_id:
                reg = TankRegulator(t.controller_id, t.name, t.sensor_key)
                reg.load_state(self.conn)
                self.tanks[t.controller_id] = reg

        self._sync_thread: Optional[threading.Thread] = None
        self._telemetry_thread: Optional[threading.Thread] = None
        self._last_rollup: Dict[str, float] = {}

    def start(self):
        self._sync_thread = threading.Thread(target=self._sync_loop, daemon=True)
        self._sync_thread.start()
        self._telemetry_thread = threading.Thread(target=self._telemetry_loop, daemon=True)
        self._telemetry_thread.start()
        self._control_loop()

    def stop(self):
        self._stop.set()
        self.relays.all_off()
        for tank in self.tanks.values():
            tank.save_state(self.conn)

    # ── Cloud sync loop (separate thread) ──

    def _sync_loop(self):
        while not self._stop.wait(config.SYNC_INTERVAL_S):
            try:
                setpoints = cloud_sync.fetch_setpoints()
                for sp in setpoints:
                    cid = sp.get("controller_id")
                    tank = self.tanks.get(cid)
                    if tank:
                        tank.target_temp = float(sp.get("target_temp", tank.target_temp))
                        tank.max_duty_pct = float(sp.get("max_duty_pct", 100))
                        tank.learned_params = sp.get("learned_params", {})
                        pt = sp.get("pill_temp")
                        tank.pill_temp = float(pt) if pt is not None else None
                        tank.pill_updated_at = _parse_ts(sp.get("pill_updated_at"))
                        tank.dual_sensor_enabled = sp.get("dual_sensor_enabled", True) is not False
                        new_ver = sp.get("params_version")
                        if new_ver != tank.last_setpoint_version:
                            log.info(f"{tank.name}: setpoint updated → {tank.target_temp}°, "
                                     f"params v{new_ver}")
                            tank.last_setpoint_version = new_ver
            except Exception as e:
                log.error(f"sync loop error: {e}")

    # ── Telemetry loop (separate thread) ──
    # Måste vara fristående från kontrollslingan: annars samplas reläläget bara
    # en gång per PWM-fönster (direkt efter påslag) och molnet tror att
    # reläet står på 100 % trots låg duty.

    def _telemetry_loop(self):
        while not self._stop.wait(config.SYNC_INTERVAL_S):
            try:
                glycol_temp = self.sensors.corrected(config.GLYCOL_SENSOR_KEY)
                self._post_live(glycol_temp, time.time())
            except Exception as e:
                log.error(f"telemetry loop error: {e}")

    # ── Main control loop ──

    def _control_loop(self):
        log.info("Regulator started — %d tanks", len(self.tanks))
        while not self._stop.is_set():
            now = time.time()
            glycol_temp = self.sensors.corrected(config.GLYCOL_SENSOR_KEY)

            # ── PID decision for each tank ──
            for tank in self.tanks.values():
                self._tick_tank(tank, glycol_temp, now)

            # ── Glycol compressor management ──
            self._manage_compressor(glycol_temp, now)

            # Wait for next PWM window
            self._stop.wait(config.PWM_PERIOD_S)

    def _tick_tank(self, tank: TankRegulator, glycol_temp: Optional[float], now: float):
        probe = self.sensors.corrected(tank.sensor_key)
        if probe is None or not math.isfinite(probe):
            log.warning(f"{tank.name}: no sensor data — skipping")
            tank_relay = self.relays.get_tank(tank.controller_id)
            if tank_relay:
                tank_relay.all_off()
            tank.current_duty = 0
            return

        # SSOT: reglera mot snittet av PT100 och pill (actual_temp).
        temp = self._fused_temp(tank, probe, now)
        tank.last_pt100 = probe
        tank.last_fused = temp

        # Buffer for rollup
        tank.temp_buffer.append((now, temp))

        recent = self.sensors._recent(tank.sensor_key)
        sensor_age_s = (now - recent[-1][0]) if recent else 999

        # ── Mode selection ──
        new_mode = select_mode(tank, temp, tank.target_temp, now)
        mode_just_switched = new_mode != tank.mode
        if mode_just_switched:
            log.info(f"{tank.name}: mode {tank.mode} → {new_mode} "
                     f"(temp={temp:.2f}°, target={tank.target_temp}°)")
            tank.mode = new_mode
            tank.pid_state.trim_i = 0
            tank.pid_state.last_duty_pct = 0

        # ── Build gains from learned params ──
        lp = tank.learned_params
        defaults = COOL if tank.mode == "cooling" else HEAT
        ff_key = f"feedforward_duty:{tank.mode}"
        pg_key = f"process_gain:{tank.mode}"
        ff = float(lp.get(ff_key, config.DEFAULT_PARAMS[tank.mode]["feedforward_duty"]))
        process_gain = float(lp.get(pg_key, 0.0))
        dead_time = float(lp.get("dead_time_hours", config.DEFAULT_PARAMS["dead_time_hours"]))
        dead_time = max(config.DEFAULT_PARAMS["dead_time_hours"] * 0.6,
                        min(config.DEFAULT_PARAMS["dead_time_hours"] * 5, dead_time))

        gains = derive_gains(process_gain, defaults, dead_time)

        # ── PID compute ──
        dt_min = config.PWM_PERIOD_S / 60
        result = compute_duty(
            mode=tank.mode,
            actual_target=tank.target_temp,
            actual_temp=temp,
            feedforward_duty=ff,
            persisted_trim_i=tank.pid_state.trim_i,
            mode_just_switched=mode_just_switched,
            prev_state=tank.pid_state,
            actual_temp_age_min=sensor_age_s / 60,
            gains=gains,
            dt_min=dt_min,
        )

        tank.pid_state = result["next_state"]
        duty = result["duty"]

        # ── Safety constraints ──
        tank_relay = self.relays.get_tank(tank.controller_id)
        relay_on = tank_relay and (tank_relay.heat.is_on or tank_relay.cool.is_on)
        on_since = (tank_relay.cool.on_since if tank.mode == "cooling"
                    else tank_relay.heat.on_since) if tank_relay else None

        cmd = DutyCommand(
            tank_id=tank.controller_id,
            mode=tank.mode,
            duty=duty,
            temp=temp,
            target=tank.target_temp,
            glycol_temp=glycol_temp,
            sensor_age_s=sensor_age_s,
            relay_on=relay_on,
            on_since=on_since,
        )
        try:
            self.chain.evaluate(cmd)
            duty = min(cmd.duty, tank.max_duty_pct / 100)
        except ConstraintViolation as e:
            log.warning(f"{tank.name}: {e}")
            duty = 0

        tank.current_duty = duty
        tank.duty_buffer.append((now, duty * 100))

        # ── Execute PWM in background thread ──
        if tank.pwm_thread is None or not tank.pwm_thread.is_alive():
            tank.pwm_thread = threading.Thread(
                target=self.relays.execute_pwm,
                args=(tank.controller_id, tank.mode, duty,
                      config.PWM_PERIOD_S, config.MIN_ON_S, config.MIN_OFF_S),
                daemon=True,
            )
            tank.pwm_thread.start()

        log.info(f"{tank.name}: T={temp:.2f}° (pt100={probe:.2f}°"
                 f"{f', pill={tank.pill_temp:.2f}°' if tank.pill_temp is not None else ''})"
                 f" → {tank.target_temp}° | "
                 f"{tank.mode} duty={duty*100:.0f}% | "
                 f"ff={result['ff']*100:.0f}% trim={result['trim_i']*100:.1f}% "
                 f"p={result['p']*100:.1f}% d={result['d']*100:.1f}% | "
                 f"{', '.join(result['constraints'])}")

        # Save state
        tank.save_state(self.conn)

    def _fused_temp(self, tank: TankRegulator, probe: float, now: float) -> float:
        """actual_temp = snitt av PT100 och pill när pillen är färsk."""
        if not tank.dual_sensor_enabled or tank.pill_temp is None:
            return probe
        if tank.pill_updated_at is not None and (now - tank.pill_updated_at) > PILL_MAX_AGE_S:
            return probe
        return (probe + tank.pill_temp) / 2

    def _manage_compressor(self, glycol_temp: Optional[float], now: float):
        """Demand-controlled glycol: run if any tank is cooling and glycol > target."""
        startup_delay_passed = (now - self.boot_time) > config.COMPRESSOR_STARTUP_DELAY_S

        any_cooling = any(
            t.mode == "cooling" and t.current_duty > 0
            for t in self.tanks.values()
        )

        cooling_targets = [
            t.target_temp for t in self.tanks.values()
            if t.mode == "cooling" and t.current_duty > 0
        ]
        desired_glycol = min(cooling_targets) - 3 if cooling_targets else config.GLYCOL_IDLE_TEMP
        desired_glycol = max(config.GLYCOL_FREEZE_LIMIT, desired_glycol)

        should_run = False
        if glycol_temp is not None and startup_delay_passed:
            if any_cooling and glycol_temp > desired_glycol + config.GLYCOL_HYSTERESIS:
                should_run = True
            elif any_cooling and self.relays.compressor.is_on and glycol_temp > desired_glycol - config.GLYCOL_HYSTERESIS:
                should_run = True

        self.relays.compressor.set(
            should_run,
            min_on_s=config.COMPRESSOR_MIN_ON_S,
            min_off_s=config.COMPRESSOR_MIN_OFF_S,
            max_starts_per_h=config.COMPRESSOR_MAX_STARTS_PER_H,
            startup_delay_passed=startup_delay_passed,
        )

    def _post_live(self, glycol_temp: Optional[float], now: float):
        """Post live telemetry for all tanks + glycol."""
        for tank in self.tanks.values():
            probe = self.sensors.corrected(tank.sensor_key)
            temp = self._fused_temp(tank, probe, now) if probe is not None else tank.last_fused
            tank_relay = self.relays.get_tank(tank.controller_id)
            cooling_on = tank_relay and tank_relay.cool.is_on
            heating_on = tank_relay and tank_relay.heat.is_on

            data = {
                "actual_temp": temp,
                "pt100_temp": probe,
                "pill_temp": tank.pill_temp,
                "target_temp": tank.target_temp,
                "mode": tank.mode,
                "duty_pct": round(tank.current_duty * 100),
                "cooling_relay_on": cooling_on,
                "heating_relay_on": heating_on,
                "glycol_temp": glycol_temp,
                "sensor_source": "pt100+pill" if (temp is not None and probe is not None and temp != probe) else "pt100",
            }
            cloud_sync.post_telemetry("live", tank.controller_id, data,
                                       tank.last_setpoint_version)

        # Rollup every 5 min
        for tank in self.tanks.values():
            last = self._last_rollup.get(tank.controller_id, 0)
            if now - last >= config.ROLLUP_INTERVAL_S:
                temps = [v for _, v in tank.temp_buffer]
                duties = [v for _, v in tank.duty_buffer]
                if temps:
                    cloud_sync.post_telemetry("rollup", tank.controller_id, {
                        "temp_mean": fmean(temps),
                        "actual_temp": temps[-1],
                        "target_temp": tank.target_temp,
                        "mode": tank.mode,
                        "duty_mean": fmean(duties) if duties else 0,
                        "glycol_temp": glycol_temp,
                        "recorded_at": now,
                    }, tank.last_setpoint_version)
                    self._last_rollup[tank.controller_id] = now

        if glycol_temp is not None:
            cloud_sync.post_glycol_telemetry({
                "glycol_temp": glycol_temp,
                "compressor_on": self.relays.compressor.is_on,
            })


# ── Entry point ────────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    log = logging.getLogger("regulator")

    from calibration import CalibrationStore
    from sensors import SensorHub
    from config import DATA_DIR
    import web as web_module
    import os

    store = CalibrationStore(DATA_DIR / "calibration.json")
    hub = SensorHub(store)
    hub.start()

    relay_hub = RelayHub()
    reg = Regulator(hub, relay_hub)

    web_module.hub = hub
    web_module.set_regulator(reg)

    flask_thread = threading.Thread(
        target=web_module.app.run,
        kwargs={"host": "0.0.0.0", "port": int(os.environ.get("PORT", 8321))},
        daemon=True,
    )
    flask_thread.start()
    log.info("Web UI started on port 8321")

    try:
        reg.start()
    except KeyboardInterrupt:
        log.info("Shutting down...")
        reg.stop()
        hub.stop()
