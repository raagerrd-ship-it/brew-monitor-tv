"""Relay control with software PWM and hardware interlock.

Uses gpiozero OutputDevice with active_low=True (GPIO LOW = relay ON).
PWM is implemented as a duty-cycle window within PWM_PERIOD_S.

The interlock ensures heat and cool relays for the same tank are never
energised simultaneously — even if the PID demands it.
"""

from __future__ import annotations

import time
import threading
from dataclasses import dataclass
from typing import Dict, Optional

import config


def _make_device(pin: int):
    """Create a gpiozero OutputDevice, or None if hardware absent."""
    try:
        from gpiozero import OutputDevice
        return OutputDevice(pin, active_high=False, initial_value=False)
    except Exception:
        return None


@dataclass
class RelayState:
    pin: int
    device: object
    is_on: bool = False
    on_since: Optional[float] = None
    off_since: Optional[float] = None


class TankRelays:
    """Heat + cool relay pair for one tank, with interlock."""

    def __init__(self, name: str, heat_pin: int, cool_pin: int):
        self.name = name
        self.heat = RelayState(heat_pin, _make_device(heat_pin))
        self.cool = RelayState(cool_pin, _make_device(cool_pin))
        self._lock = threading.Lock()

    def all_off(self):
        for r in (self.heat, self.cool):
            if r.device:
                r.device.off()
            r.is_on = False
            r.off_since = time.time()

    def set_relay(self, which: str, on: bool, *, min_on_s: float, min_off_s: float):
        """Energise or de-energise a relay, respecting interlock and min on/off."""
        target = self.heat if which == "heat" else self.cool
        other = self.cool if which == "heat" else self.heat
        now = time.time()

        with self._lock:
            # Interlock: never both on
            if on and other.is_on:
                other.device.off() if other.device else None
                other.is_on = False
                other.off_since = now

            # Min-on: keep on if commanded off too soon
            if not on and target.is_on and target.on_since is not None:
                if (now - target.on_since) < min_on_s:
                    return  # stay on

            # Min-off: keep off if commanded on too soon
            if on and not target.is_on and target.off_since is not None:
                if (now - target.off_since) < min_off_s:
                    return  # stay off

            if on and not target.is_on:
                if target.device:
                    target.device.on()
                target.is_on = True
                target.on_since = now
                target.off_since = None
            elif not on and target.is_on:
                if target.device:
                    target.device.off()
                target.is_on = False
                target.off_since = now
                target.on_since = None

    def status(self) -> dict:
        return {
            "heat_on": self.heat.is_on,
            "cool_on": self.cool.is_on,
        }


class CompressorController:
    """Glycol compressor relay with start-rate limiting and min on/off."""

    def __init__(self, pin: int):
        self.relay = RelayState(pin, _make_device(pin))
        self._start_times: list = []
        self._lock = threading.Lock()

    def set(self, on: bool, *, min_on_s: float, min_off_s: float,
            max_starts_per_h: int, startup_delay_passed: bool):
        now = time.time()
        with self._lock:
            if not startup_delay_passed:
                if self.relay.is_on:
                    if self.relay.device:
                        self.relay.device.off()
                    self.relay.is_on = False
                    self.relay.off_since = now
                return

            # Prune start times older than 1h
            self._start_times = [t for t in self._start_times if now - t < 3600]

            if on and not self.relay.is_on:
                if len(self._start_times) >= max_starts_per_h:
                    return  # rate limited
                if self.relay.off_since and (now - self.relay.off_since) < min_off_s:
                    return
                if self.relay.device:
                    self.relay.device.on()
                self.relay.is_on = True
                self.relay.on_since = now
                self.relay.off_since = None
                self._start_times.append(now)
            elif not on and self.relay.is_on:
                if self.relay.on_since and (now - self.relay.on_since) < min_on_s:
                    return  # min-on
                if self.relay.device:
                    self.relay.device.off()
                self.relay.is_on = False
                self.relay.off_since = now
                self.relay.on_since = None

    @property
    def is_on(self) -> bool:
        return self.relay.is_on


class RelayHub:
    """Central relay manager for all tanks + compressor."""

    def __init__(self):
        self.tanks: Dict[str, TankRelays] = {}
        for t in config.TANKS:
            if t.controller_id:  # only init tanks with a controller
                self.tanks[t.controller_id] = TankRelays(t.name, t.heat_pin, t.cool_pin)
        self.compressor = CompressorController(config.COMPRESSOR_PIN)
        self._pwm_threads: Dict[str, threading.Thread] = {}
        self._pwm_stop = threading.Event()

    def all_off(self):
        """Emergency stop — everything off."""
        self._pwm_stop.set()
        for tank in self.tanks.values():
            tank.all_off()
        self.compressor.set(False, min_on_s=0, min_off_s=0,
                           max_starts_per_h=999, startup_delay_passed=True)

    def get_tank(self, controller_id: str) -> Optional[TankRelays]:
        return self.tanks.get(controller_id)

    def execute_pwm(self, controller_id: str, mode: str, duty: float,
                    period_s: float, min_on_s: float, min_off_s: float):
        """Execute one PWM window for a tank.

        duty=0.30 → relay on for 30% of period_s, then off for the rest.
        Blocks for the entire PWM period (called in a per-tank thread).
        """
        tank = self.tanks.get(controller_id)
        if not tank:
            return

        which = "heat" if mode == "heating" else "cool"
        on_time = duty * period_s

        if on_time >= min_on_s:
            tank.set_relay(which, True, min_on_s=min_on_s, min_off_s=min_off_s)
            # Sleep in small chunks so we can abort
            elapsed = 0
            while elapsed < on_time and not self._pwm_stop.is_set():
                time.sleep(min(1, on_time - elapsed))
                elapsed += 1

        # Off phase
        off_time = period_s - on_time
        if off_time >= min_off_s:
            tank.set_relay(which, False, min_on_s=min_on_s, min_off_s=min_off_s)
            elapsed = 0
            while elapsed < off_time and not self._pwm_stop.is_set():
                time.sleep(min(1, off_time - elapsed))
                elapsed += 1
        elif tank.heat.is_on or tank.cool.is_on:
            # Period too short for proper off — turn off anyway after min_on
            tank.set_relay(which, False, min_on_s=min_on_s, min_off_s=0)
