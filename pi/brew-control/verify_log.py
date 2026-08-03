"""Rotating JSONL log of calibration verifications."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import List

MAX_BYTES = 1_000_000


class VerifyLog:
    def __init__(self, path):
        self.path = Path(path)

    def append(self, sensor_key: str, raw, corrected, reference: float) -> dict:
        entry = {
            "sensor_key": sensor_key,
            "raw": raw,
            "corrected": corrected,
            "reference": reference,
            "deviation": None if corrected is None else corrected - reference,
            "created_at": time.time(),
        }
        self._rotate()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a") as fh:
            fh.write(json.dumps(entry) + "\n")
        return entry

    def recent(self, sensor_key: str | None = None, limit: int = 20) -> List[dict]:
        if not self.path.exists():
            return []
        entries = []
        for line in self.path.read_text().splitlines():
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if sensor_key is None or entry.get("sensor_key") == sensor_key:
                entries.append(entry)
        return entries[-limit:][::-1]

    def _rotate(self) -> None:
        if self.path.exists() and self.path.stat().st_size >= MAX_BYTES:
            self.path.replace(self.path.with_suffix(self.path.suffix + ".1"))