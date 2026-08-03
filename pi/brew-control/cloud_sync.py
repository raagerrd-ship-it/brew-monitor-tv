"""Cloud sync module — fetches setpoints/learned params and posts telemetry.

Uses the same x-pi-secret auth pattern as the BLE uploader.
All HTTP calls use httpx with 10s timeout.
"""

from __future__ import annotations

import time
import logging
from typing import Optional

import config

log = logging.getLogger(__name__)

try:
    import httpx
except ImportError:
    httpx = None
    log.warning("httpx not installed — cloud sync disabled")


_HEADERS = None

def _headers():
    global _HEADERS
    if _HEADERS is None:
        _HEADERS = {
            "x-pi-secret": config.PI_SECRET,
            "Content-Type": "application/json",
        }
    return _HEADERS


def fetch_setpoints() -> list:
    """GET /pi-control — returns all setpoints for Pi-controlled tanks."""
    if not httpx or not config.SUPABASE_URL:
        return []
    try:
        r = httpx.get(config.CONTROL_ENDPOINT, headers=_headers(), timeout=10)
        r.raise_for_status()
        data = r.json()
        return data.get("setpoints", [])
    except Exception as e:
        log.error(f"fetch_setpoints failed: {e}")
        return []


def post_telemetry(kind: str, controller_id: str, data: dict,
                   setpoint_version: Optional[int] = None) -> dict:
    """POST /pi-telemetry — sends live state or rollup, returns updated setpoint."""
    if not httpx or not config.SUPABASE_URL:
        return {}
    try:
        payload = {
            "kind": kind,
            "controller_id": controller_id,
            "data": data,
        }
        if setpoint_version is not None:
            payload["setpoint_version"] = setpoint_version

        r = httpx.post(config.TELEMETRY_ENDPOINT, json=payload,
                       headers=_headers(), timeout=10)
        r.raise_for_status()
        resp = r.json()
        return resp.get("setpoint") or {}
    except Exception as e:
        log.error(f"post_telemetry({kind}) failed: {e}")
        return {}


def post_glycol_telemetry(data: dict) -> bool:
    """POST /pi-telemetry kind=glycol — glycol cooler telemetry."""
    if not httpx or not config.SUPABASE_URL:
        return False
    try:
        payload = {"kind": "glycol", "controller_id": "glycol", "data": data}
        r = httpx.post(config.TELEMETRY_ENDPOINT, json=payload,
                       headers=_headers(), timeout=10)
        r.raise_for_status()
        return True
    except Exception as e:
        log.error(f"post_glycol_telemetry failed: {e}")
        return False
