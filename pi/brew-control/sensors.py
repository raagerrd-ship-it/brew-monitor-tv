"""PT100 sensor layer. Raw readings never leave this module except to the
calibration page — everything downstream gets the corrected value.
"""

from __future__ import annotations

import statistics
import threading
import time
from collections import deque
from typing import Deque, Dict, Optional, Tuple

from calibration import SENSOR_KEYS, CalibrationStore

# BCM pin assignment (see hardware spec in the Pi plan)
CS_PINS = {"glycol": 5, "tank1": 6, "tank2": 13, "tank3": 19}

SAMPLE_INTERVAL_S = 1.0
CAPTURE_WINDOW_S = 30.0
STABILITY_MAX_SPREAD = 0.10  # °C peak-to-peak over the capture window


def _make_readers() -> Dict[str, object]:
    """MAX31865 readers, or an empty dict when the hardware isn't present."""
    try:
        import board  # type: ignore
        import busio  # type: ignore
        import digitalio  # type: ignore
        import adafruit_max31865  # type: ignore
    except Exception:
        return {}

    spi = busio.SPI(board.SCK, MOSI=board.MOSI, MISO=board.MISO)
    readers = {}
    for key, pin in CS_PINS.items():
        cs = digitalio.DigitalInOut(getattr(board, f"D{pin}"))
        readers[key] = adafruit_max31865.MAX31865(spi, cs, wires=3, rtd_nominal=100.0, ref_resistor=430.0)
    return readers


class SensorHub:
    """Samples every PT100 at 1 Hz and applies calibration immediately."""

    def __init__(self, store: CalibrationStore):
        self.store = store
        self._readers = _make_readers()
        self._raw: Dict[str, Optional[float]] = {k: None for k in SENSOR_KEYS}
        self._window: Dict[str, Deque[Tuple[float, float]]] = {
            k: deque(maxlen=int(CAPTURE_WINDOW_S / SAMPLE_INTERVAL_S)) for k in SENSOR_KEYS
        }
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if self._thread:
            return
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.wait(SAMPLE_INTERVAL_S):
            self.store.reload_if_changed()
            for key in SENSOR_KEYS:
                self._sample(key)

    def _sample(self, key: str) -> None:
        reader = self._readers.get(key)
        if reader is None:
            return
        try:
            raw = float(reader.temperature)
        except Exception:
            raw = None
        with self._lock:
            self._raw[key] = raw
            if raw is not None:
                self._window[key].append((time.time(), raw))

    # -- readings ----------------------------------------------------

    def corrected(self, key: str) -> Optional[float]:
        """The only value the rest of the system is allowed to use."""
        with self._lock:
            raw = self._raw[key]
        return self.store.apply(key, raw)

    def raw(self, key: str) -> Optional[float]:
        """Raw reading — calibration page only."""
        with self._lock:
            return self._raw[key]

    def capture_average(self, key: str) -> Optional[float]:
        """Mean raw reading over the capture window, so a single spike can't ruin a point."""
        samples = self._recent(key)
        if not samples:
            return None
        return statistics.fmean(v for _, v in samples)

    def is_stable(self, key: str) -> bool:
        samples = self._recent(key)
        if len(samples) < CAPTURE_WINDOW_S / SAMPLE_INTERVAL_S * 0.5:
            return False
        values = [v for _, v in samples]
        return (max(values) - min(values)) <= STABILITY_MAX_SPREAD

    def _recent(self, key: str) -> list[Tuple[float, float]]:
        cutoff = time.time() - CAPTURE_WINDOW_S
        with self._lock:
            return [s for s in self._window[key] if s[0] >= cutoff]