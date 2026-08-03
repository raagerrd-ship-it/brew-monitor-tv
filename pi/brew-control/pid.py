"""V6 PID controller — ported from pid-compensation-claude.ts.

Pure function: no DB access, no I/O. The regulator calls compute_duty()
once per PWM window (180 s) and persists state via the regulator's
SQLite store.

Learning (feedforward, process_gain, dead_time) stays in the cloud.
The Pi reads the results via cloud_sync and passes them in here.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

# ── Tuning constants (mirrors pid-compensation-claude.ts) ──────────────

COOL = {"Kp": 0.22, "Kd": 5.0 / 60, "Ki": 0.06}
HEAT = {"Kp": 0.35, "Kd": 3.5 / 60, "Ki": 0.10}

DEAD_TIME_DEFAULT_HOURS = 0.25
DEAD_TIME_MIN = 0.15
DEAD_TIME_MAX = 1.25
TRIM_MAX = 0.10
D_MAX = 0.35
SLEW_PER_CYCLE = 0.05
NEAR_TARGET_BAND = 0.30
SLEW_NEAR_TARGET = 0.02
NOISE_BAND = 0.10
SLEW_NOISE_BAND = 0.01
STALE_FREEZE_MIN = 8
MIN_OFF_MIN = 5
HOLD_FLOOR_BAND = 0.50
TAU_MIN = 12.0
RATE_WINDOW_MIN = 35
RATE_WINDOW_LOW = 25
RATE_WINDOW_HIGH = 45
HISTORY_KEEP_MIN = 60
RATE_FALLBACK_MIN_AGE = 8
TRIM_LEAK_PER_HOUR = 0.05
DELTA_T_REF = 10.0
DELTA_T_MIN = 3.0


def compute_delta_t(target: float, glycol_temp: Optional[float]) -> Optional[float]:
    if glycol_temp is None or not math.isfinite(glycol_temp):
        return None
    if not math.isfinite(target):
        return None
    return max(DELTA_T_MIN, target - glycol_temp)


def derive_gains(
    process_gain_per_pct: float,
    defaults: dict,
    dead_time_hours: float,
) -> dict:
    lag_scale = DEAD_TIME_DEFAULT_HOURS / dead_time_hours
    if not (process_gain_per_pct > 0):
        return {
            "Kp": defaults["Kp"] * lag_scale,
            "Kd": defaults["Kp"] * lag_scale * dead_time_hours,
            "source": "default",
        }
    tau_c = dead_time_hours
    kp = 1.0 / (process_gain_per_pct * 100 * tau_c)
    kp = max(defaults["Kp"] * lag_scale * 0.3, min(defaults["Kp"] * lag_scale * 3, kp))
    kd = kp * dead_time_hours
    return {"Kp": kp, "Kd": kd, "source": "measured"}


@dataclass
class HistoryPoint:
    t: float        # epoch seconds
    v: float        # EMA-smoothed SSOT
    r: Optional[float] = None  # raw SSOT


@dataclass
class V6PidState:
    last_ssot: Optional[float] = None
    last_ssot_at: Optional[float] = None      # epoch seconds
    ssot_smoothed: Optional[float] = None
    ssot_history: List[HistoryPoint] = field(default_factory=list)
    trim_i: float = 0.0
    last_duty_pct: int = 0
    last_zero_duty_at: Optional[float] = None  # epoch seconds
    last_mode: Optional[str] = None            # 'heating' | 'cooling'
    hold_window: Optional[dict] = None
    windowed_rate_hourly: Optional[float] = None

    def to_dict(self) -> dict:
        return {
            "last_ssot": self.last_ssot,
            "last_ssot_at": self.last_ssot_at,
            "ssot_smoothed": self.ssot_smoothed,
            "ssot_history": [
                {"t": p.t, "v": p.v, "r": p.r} for p in self.ssot_history
            ],
            "trim_i": self.trim_i,
            "last_duty_pct": self.last_duty_pct,
            "last_zero_duty_at": self.last_zero_duty_at,
            "last_mode": self.last_mode,
            "hold_window": self.hold_window,
            "windowed_rate_hourly": self.windowed_rate_hourly,
        }

    @classmethod
    def from_dict(cls, raw: Optional[dict]) -> "V6PidState":
        if not raw:
            return cls()
        hist = []
        for e in raw.get("ssot_history") or []:
            if isinstance(e, dict) and "t" in e and "v" in e:
                hist.append(HistoryPoint(t=float(e["t"]), v=float(e["v"]),
                                         r=e.get("r")))
        return cls(
            last_ssot=_num(raw.get("last_ssot")),
            last_ssot_at=_num(raw.get("last_ssot_at")),
            ssot_smoothed=_num(raw.get("ssot_smoothed")),
            ssot_history=hist,
            trim_i=_num(raw.get("trim_i"), 0.0),
            last_duty_pct=int(raw.get("last_duty_pct") or 0),
            last_zero_duty_at=_num(raw.get("last_zero_duty_at")),
            last_mode=raw.get("last_mode") if raw.get("last_mode") in ("heating", "cooling") else None,
            hold_window=raw.get("hold_window") if isinstance(raw.get("hold_window"), dict) else None,
            windowed_rate_hourly=_num(raw.get("windowed_rate_hourly")),
        )


def _num(v, default=None):
    if v is None:
        return default
    try:
        f = float(v)
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default


def compute_duty(
    *,
    mode: str,                     # 'heating' | 'cooling'
    actual_target: float,           # desired temperature (profile or manual)
    actual_temp: float,            # SSOT — PT100 corrected
    feedforward_duty: float,       # learned steady-state duty (0..1)
    persisted_trim_i: float,
    mode_just_switched: bool,
    prev_state: V6PidState,
    actual_temp_age_min: Optional[float] = None,
    gains: dict,                   # {Kp, Kd, source}
    dt_min: float = 5.0,           # time since last PID cycle (minutes)
) -> dict:
    """Pure PID computation. Returns {duty, trim_i, p, d, ff, constraints, next_state}.

    Faithful port of computeDutyV5 from pid-compensation-claude.ts.
    """
    constraints: List[str] = []
    is_cooling = mode == "cooling"
    now = time.time()
    now_ms = now * 1000

    # ── EMA smoothing (τ=12 min) ──
    alpha = 1 - math.exp(-dt_min / TAU_MIN)
    prev_smoothed = prev_state.ssot_smoothed
    ssot_filtered = (
        prev_smoothed + alpha * (actual_temp - prev_smoothed)
        if prev_smoothed is not None
        else actual_temp
    )

    avg_error = actual_target - ssot_filtered
    need = -avg_error if is_cooling else avg_error

    # ── Conservative need: min of filtered and raw ──
    raw_avg_error = actual_target - actual_temp
    raw_need = -raw_avg_error if is_cooling else raw_avg_error
    need_ctl = min(need, raw_need)
    if need_ctl < need - 0.05:
        constraints.append(f"raw-need-override({need_ctl:.2f})")

    ki = (COOL if is_cooling else HEAT)["Ki"]
    kp = gains["Kp"]
    kd = gains["Kd"]
    if gains["source"] == "measured":
        constraints.append(f"gains-measured(Kp={kp:.2f},Kd={kd:.2f})")

    is_stale_ssot = actual_temp_age_min is not None and actual_temp_age_min > STALE_FREEZE_MIN
    if is_stale_ssot:
        constraints.append(f"ssot-stale-freeze({actual_temp_age_min:.0f}m)")

    # ── Windowed rate for D-term ──
    history = prev_state.ssot_history
    windowed_rate_per_min: Optional[float] = None
    raw_windowed_rate_per_min: Optional[float] = None

    aged = [
        {"age_min": (now_ms - p.t * 1000) / 60000, "v": p.v, "r": p.r}
        for p in history
    ]
    in_window = [
        e for e in aged
        if RATE_WINDOW_LOW <= e["age_min"] <= RATE_WINDOW_HIGH
    ]
    in_window.sort(key=lambda e: abs(e["age_min"] - RATE_WINDOW_MIN))

    anchor = in_window[0] if in_window else None
    if not anchor:
        fallback_aged = [e for e in aged if e["age_min"] >= RATE_FALLBACK_MIN_AGE]
        fallback_aged.sort(key=lambda e: -e["age_min"])
        anchor = fallback_aged[0] if fallback_aged else None
        if anchor:
            constraints.append(f"rate-fallback({anchor['age_min']:.0f}m)")

    if anchor:
        windowed_rate_per_min = (ssot_filtered - anchor["v"]) / anchor["age_min"]
        if anchor["r"] is not None:
            raw_windowed_rate_per_min = (actual_temp - anchor["r"]) / anchor["age_min"]

    cycle_rate_per_min = (ssot_filtered - prev_smoothed) / dt_min if prev_smoothed is not None else 0
    rate_per_min = windowed_rate_per_min if windowed_rate_per_min is not None else cycle_rate_per_min

    d_need_dt = -rate_per_min if is_cooling else rate_per_min
    approach_rate_per_min = -d_need_dt if need >= 0 else d_need_dt

    raw_approach_per_min = None
    if raw_windowed_rate_per_min is not None:
        d_raw = -raw_windowed_rate_per_min if is_cooling else raw_windowed_rate_per_min
        raw_approach_per_min = -d_raw if need >= 0 else d_raw

    eff_approach_per_min = (
        max(approach_rate_per_min, raw_approach_per_min)
        if raw_approach_per_min is not None
        else approach_rate_per_min
    )
    if raw_approach_per_min is not None and raw_approach_per_min > approach_rate_per_min + 0.001:
        constraints.append("raw-rate-brake")

    # Past target and moving away → brake on absolute value
    if need < 0 and eff_approach_per_min < 0:
        approach_rate_per_hour = abs(eff_approach_per_min) * 60
    else:
        approach_rate_per_hour = eff_approach_per_min * 60

    # ── D-brake ──
    d_brake = 0.0
    if not is_stale_ssot and approach_rate_per_hour > 0:
        d_brake = min(D_MAX, kd * approach_rate_per_hour)
        constraints.append(f"d-brake({d_brake*100:.1f}%,rate={approach_rate_per_hour:.2f}/h)")

    # ── P-term ──
    p_term = kp * need_ctl

    # ── Feedforward ──
    ff = max(0, feedforward_duty)

    # ── trimI ──
    trim_i = persisted_trim_i
    if not math.isfinite(trim_i) or abs(trim_i) > TRIM_MAX:
        trim_i = 0

    mode_flipped = mode_just_switched or (
        prev_state.last_mode is not None and prev_state.last_mode != mode
    )
    if mode_flipped:
        trim_i = 0
        constraints.append("mode-reset")
    elif not is_stale_ssot:
        if abs(need_ctl) <= NOISE_BAND:
            constraints.append("trim-freeze-noise")
        else:
            trim_i = max(-TRIM_MAX, min(TRIM_MAX, trim_i + ki * need_ctl * dt_min / 60))

        if approach_rate_per_hour > 0 and trim_i != 0:
            leak = TRIM_LEAK_PER_HOUR * (dt_min / 60)
            if trim_i > 0:
                decayed = max(0, trim_i - leak)
            else:
                decayed = min(0, trim_i + leak)
            if decayed != trim_i:
                constraints.append(f"trim-leak({(decayed - trim_i)*100:.2f}%)")
            trim_i = decayed

    # ── Combine ──
    raw_duty = ff + trim_i + p_term - d_brake
    duty = max(0, min(1, raw_duty))

    # ── Anti-windup (back-calculation) ──
    sat_correction = duty - raw_duty
    persisted_base = persisted_trim_i
    if sat_correction != 0 and not is_stale_ssot:
        trim_i = max(-TRIM_MAX, min(TRIM_MAX, trim_i + sat_correction))
        persisted_base = max(-TRIM_MAX, min(TRIM_MAX, persisted_base + sat_correction))
        constraints.append(f"trim-desat({sat_correction*100:.1f}%)")

    # ── Min-off protection (cooling) ──
    duty_pct_pre_slew = round(duty * 100)
    last_zero_duty_at = (
        now if duty_pct_pre_slew == 0 and not (prev_state.last_duty_pct == 0 and prev_state.last_zero_duty_at)
        else (prev_state.last_zero_duty_at if duty_pct_pre_slew == 0 else prev_state.last_zero_duty_at)
    )
    min_off_blocked = False
    if is_cooling and duty > 0 and prev_state.last_zero_duty_at:
        minutes_since_off = (now - prev_state.last_zero_duty_at) / 60
        if minutes_since_off < MIN_OFF_MIN:
            duty = 0
            min_off_blocked = True
            constraints.append(f"min-off({minutes_since_off:.1f}m)")

    # ── Slew cap (up-ramp only) ──
    last_duty_frac = 0 if mode_just_switched else (prev_state.last_duty_pct or 0) / 100
    abs_need = abs(need_ctl)
    if abs_need <= NOISE_BAND:
        base_slew = SLEW_NOISE_BAND
    elif abs_need <= NEAR_TARGET_BAND:
        base_slew = SLEW_NEAR_TARGET
    else:
        base_slew = SLEW_PER_CYCLE
    slew_limit = base_slew * (dt_min / 5)
    slew_limited = False
    delta = duty - last_duty_frac
    if delta > slew_limit:
        duty = max(0, min(1, last_duty_frac + slew_limit))
        slew_limited = True
        constraints.append(f"slew-cap({delta*100:.1f}%->+{slew_limit*100:.1f}%/{dt_min:.1f}m)")

    # ── Monotonic guard past target ──
    if need_ctl < 0 and duty > last_duty_frac:
        duty = last_duty_frac
        constraints.append("past-target-monotonic")

    # ── Hold floor ──
    if ff > 0 and not min_off_blocked and abs_need <= HOLD_FLOOR_BAND and duty < ff:
        duty = ff
        constraints.append(f"hold-floor({ff*100:.1f}%)")

    # ── Anti-windup: freeze trimI if slew/min-off limited ──
    if slew_limited or min_off_blocked:
        if persisted_base > 0:
            trim_i = min(persisted_base, max(trim_i, 0))
        elif persisted_base < 0:
            trim_i = max(persisted_base, min(trim_i, 0))
        else:
            trim_i = persisted_base
        constraints.append("trim-freeze-clamped")

    # ── Next state ──
    kept_history = [
        p for p in history
        if (now - p.t) / 60 <= HISTORY_KEEP_MIN
    ]
    kept_history.append(HistoryPoint(t=now, v=ssot_filtered, r=actual_temp))

    next_state = V6PidState(
        last_ssot=actual_temp,
        last_ssot_at=now,
        ssot_smoothed=ssot_filtered,
        ssot_history=kept_history,
        trim_i=trim_i,
        last_duty_pct=round(duty * 100),
        last_zero_duty_at=last_zero_duty_at,
        last_mode=mode,
        windowed_rate_hourly=windowed_rate_per_min * 60 if windowed_rate_per_min is not None else None,
    )

    return {
        "duty": duty,
        "trim_i": trim_i,
        "p": p_term,
        "d": d_brake,
        "ff": ff,
        "constraints": constraints,
        "next_state": next_state,
        "ssot_filtered": ssot_filtered,
    }
