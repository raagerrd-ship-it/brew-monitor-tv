"""Composable safety constraint layer for relay actuation.

Every constraint is a callable that can veto or modify a duty command.
Constraints are checked in order; the first violation wins.

This layer sits BETWEEN the PID output and the relay hardware.
It never relaxes safety — it only tightens.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable, List, Optional


@dataclass
class DutyCommand:
    """The actuation intent that flows through the constraint chain."""
    tank_id: str
    mode: str                      # 'heating' | 'cooling'
    duty: float                    # 0.0 .. 1.0
    temp: float                    # current SSOT temp
    target: float                  # target temp
    glycol_temp: Optional[float]   # glycol supply temp (for cooling checks)
    sensor_age_s: float            # seconds since last fresh PT100 reading
    relay_on: bool                 # is relay currently energised?
    on_since: Optional[float]      # epoch seconds when relay turned on


class ConstraintViolation(Exception):
    pass


# ── Individual constraints ─────────────────────────────────────────────

def sensor_freshness(cmd: DutyCommand, *, max_age_s: float = 60) -> None:
    """No actuation without a fresh sensor reading."""
    if cmd.sensor_age_s > max_age_s:
        raise ConstraintViolation(
            f"sensor-stale({cmd.sensor_age_s:.0f}s > {max_age_s}s) — {cmd.tank_id}"
        )


def hard_temp_limits(cmd: DutyCommand, *, t_min: float = -2.0, t_max: float = 40.0) -> None:
    """Absolute temperature cutoffs — never heat above t_max, never cool below t_min."""
    if cmd.mode == "heating" and cmd.temp >= t_max:
        raise ConstraintViolation(f"hard-limit: temp {cmd.temp:.1f}° >= {t_max}° — no heating")
    if cmd.mode == "cooling" and cmd.temp <= t_min:
        raise ConstraintViolation(f"hard-limit: temp {cmd.temp:.1f}° <= {t_min}° — no cooling")


def glycol_freeze_guard(cmd: DutyCommand, *, freeze_limit: float = -5.0) -> None:
    """Don't cool if glycol is below freeze limit."""
    if cmd.mode == "cooling" and cmd.glycol_temp is not None and cmd.glycol_temp <= freeze_limit:
        raise ConstraintViolation(
            f"glycol-freeze: {cmd.glycol_temp:.1f}° <= {freeze_limit}° — cooling blocked"
        )


def min_on_off(cmd: DutyCommand, *, min_on_s: float = 5, min_off_s: float = 5,
               now: Optional[float] = None) -> None:
    """Enforce minimum on and off times for relay longevity."""
    now = now or time.time()
    if cmd.relay_on and cmd.on_since is not None:
        on_duration = now - cmd.on_since
        if cmd.duty == 0 and on_duration < min_on_s:
            raise ConstraintViolation(
                f"min-on: relay on {on_duration:.0f}s < {min_on_s}s — keep on"
            )
    # min_off is enforced by the relay controller (it tracks off-since)


def max_duty_cap(cmd: DutyCommand, *, max_duty: float = 1.0) -> None:
    """Clamp duty to maximum allowed."""
    if cmd.duty > max_duty:
        cmd.duty = max_duty  # mutate — this is a soft constraint


# ── Composed chain ─────────────────────────────────────────────────────

class ConstraintChain:
    """Runs constraints in order. Hard constraints raise; soft constraints mutate."""

    def __init__(self):
        self._hard: List[Callable] = []
        self._soft: List[Callable] = []

    def add_hard(self, fn: Callable) -> "ConstraintChain":
        self._hard.append(fn)
        return self

    def add_soft(self, fn: Callable) -> "ConstraintChain":
        self._soft.append(fn)
        return self

    def evaluate(self, cmd: DutyCommand) -> List[str]:
        """Returns list of constraint notes. Raises on hard violation."""
        notes: List[str] = []
        for fn in self._hard:
            try:
                fn(cmd)
            except ConstraintViolation as e:
                raise
        for fn in self._soft:
            fn(cmd)
        return notes


def default_chain() -> ConstraintChain:
    """The standard safety chain for all tanks."""
    return ConstraintChain() \
        .add_hard(sensor_freshness) \
        .add_hard(hard_temp_limits) \
        .add_hard(glycol_freeze_guard) \
        .add_hard(min_on_off) \
        .add_soft(max_duty_cap)
