"""LAN web UI for PT100 calibration (part of the Pi's local interface)."""

from __future__ import annotations

import os
from pathlib import Path

from flask import Flask, jsonify, render_template, request

from calibration import SENSOR_KEYS, CalibrationError, CalibrationStore
from sensors import SensorHub
from verify_log import VerifyLog

BASE_DIR = Path(os.environ.get("BREW_CONTROL_DATA", Path(__file__).parent))

store = CalibrationStore(BASE_DIR / "calibration.json")
hub = SensorHub(store)
hub.start()
verify_log = VerifyLog(BASE_DIR / "calibration_checks.jsonl")

LABELS = {"glycol": "Glykol", "tank1": "Tank 1", "tank2": "Tank 2", "tank3": "Tank 3"}

app = Flask(__name__)


def _state(key: str) -> dict:
    cal = store.get(key)
    return {
        "sensor_key": key,
        "label": LABELS[key],
        "raw": hub.raw(key),
        "corrected": hub.corrected(key),
        "stable": hub.is_stable(key),
        "gain": cal.gain,
        "offset": cal.offset,
        "low": None if cal.low is None else vars(cal.low),
        "high": None if cal.high is None else vars(cal.high),
        "deviation": cal.deviation(),
        "checks": verify_log.recent(key, limit=5),
    }


@app.get("/calibration")
def calibration_page():
    return render_template("calibration.html")


@app.get("/api/calibration")
def api_calibration():
    return jsonify({"sensors": [_state(k) for k in SENSOR_KEYS]})


@app.post("/api/calibration/<sensor>/capture")
def api_capture(sensor: str):
    body = request.get_json(silent=True) or {}
    which = body.get("point")
    try:
        reference = float(body["reference"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "Ange ett referensvärde"}), 400

    if sensor not in SENSOR_KEYS:
        return jsonify({"error": "Okänd givare"}), 404
    raw = hub.capture_average(sensor)
    if raw is None:
        return jsonify({"error": "Ingen giltig avläsning från givaren"}), 400
    try:
        store.capture(sensor, which, raw, reference)
    except CalibrationError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(_state(sensor))


@app.post("/api/calibration/<sensor>/manual")
def api_manual(sensor: str):
    body = request.get_json(silent=True) or {}
    try:
        store.set_manual(sensor, float(body["gain"]), float(body["offset"]))
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "Ange både förstärkning och offset"}), 400
    except CalibrationError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(_state(sensor))


@app.post("/api/calibration/<sensor>/verify")
def api_verify(sensor: str):
    body = request.get_json(silent=True) or {}
    try:
        reference = float(body["reference"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "Ange ett referensvärde"}), 400
    if sensor not in SENSOR_KEYS:
        return jsonify({"error": "Okänd givare"}), 404
    verify_log.append(sensor, hub.raw(sensor), hub.corrected(sensor), reference)
    return jsonify(_state(sensor))


@app.post("/api/calibration/<sensor>/reset")
def api_reset(sensor: str):
    try:
        store.reset(sensor)
    except CalibrationError as exc:
        return jsonify({"error": str(exc)}), 404
    return jsonify(_state(sensor))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8321)))