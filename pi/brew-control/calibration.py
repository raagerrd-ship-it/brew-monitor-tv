"""Two-point PT100 calibration, owned entirely by the Pi.

corrected = raw * gain + offset
gain   = (ref_high - ref_low) / (raw_high - raw_low)
offset = ref_low - raw_low * gain

With only one point stored, gain = 1 (pure offset correction).
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, Optional

SENSOR_KEYS = ("glycol", "tank1", "tank2", "tank3")

GAIN_MIN = 0.9
GAIN_MAX = 1.1
OFFSET_ABS_MAX = 5.0
MIN_POINT_SPREAD = 5.0  # °C between low and high raw readings


class CalibrationError(ValueError):
    """Raised when a capture or manual value fails the sanity check."""


@dataclass
class Point:
    raw: float
    ref: float
    captured_at: float


@dataclass
class SensorCalibration:
    low: Optional[Point] = None
    high: Optional[Point] = None
    gain: float = 1.0
    offset: float = 0.0

    def apply(self, raw: Optional[float]) -> Optional[float]:
        if raw is None:
            return None
        return raw * self.gain + self.offset

    def deviation(self) -> Dict[str, Optional[float]]:
        """Residual in each stored point after correction."""
        return {
            "low": None if self.low is None else self.apply(self.low.raw) - self.low.ref,
            "high": None if self.high is None else self.apply(self.high.raw) - self.high.ref,
        }


def solve(low: Optional[Point], high: Optional[Point]) -> tuple[float, float]:
    """Derive (gain, offset) from the stored points."""
    if low is not None and high is not None:
        spread = high.raw - low.raw
        if abs(spread) < MIN_POINT_SPREAD:
            raise CalibrationError(
                f"För liten skillnad mellan punkterna ({spread:.2f}°). "
                f"Minst {MIN_POINT_SPREAD:.0f}° krävs."
            )
        gain = (high.ref - low.ref) / spread
        offset = low.ref - low.raw * gain
    elif low is not None:
        gain, offset = 1.0, low.ref - low.raw
    elif high is not None:
        gain, offset = 1.0, high.ref - high.raw
    else:
        gain, offset = 1.0, 0.0
    check_sane(gain, offset)
    return gain, offset


def check_sane(gain: float, offset: float) -> None:
    if not (GAIN_MIN <= gain <= GAIN_MAX):
        raise CalibrationError(
            f"Orimlig förstärkning {gain:.4f} (tillåtet {GAIN_MIN}–{GAIN_MAX}). "
            "Kontrollera referensvärdet."
        )
    if abs(offset) > OFFSET_ABS_MAX:
        raise CalibrationError(
            f"Orimlig offset {offset:+.2f}° (tillåtet ±{OFFSET_ABS_MAX:.0f}°). "
            "Kontrollera referensvärdet."
        )


class CalibrationStore:
    """Holds calibration for every sensor and persists it atomically."""

    def __init__(self, path: os.PathLike | str):
        self.path = Path(path)
        self._mtime: Optional[float] = None
        self.sensors: Dict[str, SensorCalibration] = {
            key: SensorCalibration() for key in SENSOR_KEYS
        }
        self.load()

    # -- persistence -------------------------------------------------

    def load(self) -> None:
        if not self.path.exists():
            self._mtime = None
            return
        try:
            data = json.loads(self.path.read_text())
        except (json.JSONDecodeError, OSError):
            return
        for key in SENSOR_KEYS:
            raw = data.get(key) or {}
            self.sensors[key] = SensorCalibration(
                low=_point(raw.get("low")),
                high=_point(raw.get("high")),
                gain=float(raw.get("gain", 1.0)),
                offset=float(raw.get("offset", 0.0)),
            )
        self._mtime = self.path.stat().st_mtime

    def reload_if_changed(self) -> bool:
        try:
            mtime = self.path.stat().st_mtime
        except OSError:
            return False
        if mtime != self._mtime:
            self.load()
            return True
        return False

    def save(self) -> None:
        payload = {
            key: {
                "low": None if cal.low is None else asdict(cal.low),
                "high": None if cal.high is None else asdict(cal.high),
                "gain": cal.gain,
                "offset": cal.offset,
            }
            for key, cal in self.sensors.items()
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(self.path.parent), suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as fh:
                json.dump(payload, fh, indent=2)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, self.path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        self._mtime = self.path.stat().st_mtime

    # -- operations --------------------------------------------------

    def get(self, sensor_key: str) -> SensorCalibration:
        if sensor_key not in self.sensors:
            raise CalibrationError(f"Okänd givare: {sensor_key}")
        return self.sensors[sensor_key]

    def apply(self, sensor_key: str, raw: Optional[float]) -> Optional[float]:
        return self.get(sensor_key).apply(raw)

    def capture(self, sensor_key: str, which: str, raw: float, ref: float) -> SensorCalibration:
        """Store a low/high point and re-solve. Rejected if the result is unreasonable."""
        if which not in ("low", "high"):
            raise CalibrationError("Punkten måste vara 'low' eller 'high'")
        cal = self.get(sensor_key)
        point = Point(raw=float(raw), ref=float(ref), captured_at=time.time())
        low = point if which == "low" else cal.low
        high = point if which == "high" else cal.high
        gain, offset = solve(low, high)
        cal.low, cal.high, cal.gain, cal.offset = low, high, gain, offset
        self.save()
        return cal

    def set_manual(self, sensor_key: str, gain: float, offset: float) -> SensorCalibration:
        check_sane(float(gain), float(offset))
        cal = self.get(sensor_key)
        cal.low = cal.high = None
        cal.gain, cal.offset = float(gain), float(offset)
        self.save()
        return cal

    def reset(self, sensor_key: str) -> SensorCalibration:
        self.sensors[sensor_key] = SensorCalibration()
        self.save()
        return self.sensors[sensor_key]


def _point(raw: Optional[dict]) -> Optional[Point]:
    if not raw:
        return None
    return Point(
        raw=float(raw["raw"]),
        ref=float(raw["ref"]),
        captured_at=float(raw.get("captured_at", 0.0)),
    )