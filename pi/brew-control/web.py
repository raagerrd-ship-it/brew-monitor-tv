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


# ── Regulator control endpoints (local override + status) ─────────────

_regulator_ref = None  # set by regulator.py when running in-process

def set_regulator(reg):
    global _regulator_ref
    _regulator_ref = reg


@app.get("/api/status")
def api_status():
    if _regulator_ref is None:
        return jsonify({"running": False, "message": "Regulatorn är inte startad"})
    tanks = []
    for cid, t in _regulator_ref.tanks.items():
        temp = hub.corrected(t.sensor_key)
        tanks.append({
            "controller_id": cid,
            "name": t.name,
            "temp": temp,
            "target": t.target_temp,
            "mode": t.mode,
            "duty_pct": round(t.current_duty * 100),
        })
    glycol = hub.corrected("glycol")
    return jsonify({
        "running": True,
        "glycol_temp": glycol,
        "compressor_on": _regulator_ref.relays.compressor.is_on,
        "tanks": tanks,
    })


@app.post("/api/target/<controller_id>")
def api_set_target(controller_id: str):
    if _regulator_ref is None:
        return jsonify({"error": "Regulatorn är inte startad"}), 503
    body = request.get_json(silent=True) or {}
    try:
        target = float(body["target_temp"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "Ange target_temp"}), 400
    if not (-10 <= target <= 40):
        return jsonify({"error": "Måste vara mellan -10 och 40°C"}), 400
    tank = _regulator_ref.tanks.get(controller_id)
    if not tank:
        return jsonify({"error": "Okänd controller"}), 404
    tank.target_temp = target
    log = getattr(_regulator_ref, '_log_override', None)
    if log:
        log.info(f"Local override: {tank.name} → {target}°C")
    return jsonify({"controller_id": controller_id, "target_temp": target})


@app.post("/api/estop")
def api_estop():
    if _regulator_ref is None:
        return jsonify({"error": "Regulatorn är inte startad"}), 503
    _regulator_ref.relays.all_off()
    return jsonify({"estop": True})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8321)))