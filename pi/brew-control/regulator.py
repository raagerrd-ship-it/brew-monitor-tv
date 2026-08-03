#!/usr/bin/env python3
"""Entry point: starts the regulator + web UI together.

Usage:
    GPIOZERO_PIN_FACTORY=lgpio python3 regulator.py

The web UI (port 8321) serves calibration + control endpoints.
The regulator loop runs in the main thread; Flask runs in a daemon thread.
"""

from __future__ import annotations

import logging
import threading

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("regulator")

# These imports trigger hardware init — keep after logging setup
from calibration import CalibrationStore
from sensors import SensorHub
from relay import RelayHub
from regulator import Regulator
from config import DATA_DIR

import web as web_module
from pathlib import Path

if __name__ == "__main__":
    store = CalibrationStore(DATA_DIR / "calibration.json")
    hub = SensorHub(store)
    hub.start()

    relay_hub = RelayHub()
    reg = Regulator(hub, relay_hub)

    # Share the sensor hub + regulator with the web module
    web_module.hub = hub
    web_module.set_regulator(reg)

    # Run Flask in a daemon thread
    import os
    flask_thread = threading.Thread(
        target=web_module.app.run,
        kwargs={"host": "0.0.0.0", "port": int(os.environ.get("PORT", 8321))},
        daemon=True,
    )
    flask_thread.start()
    log.info("Web UI started on port 8321")

    # Main regulator loop (blocks)
    try:
        reg.start()
    except KeyboardInterrupt:
        log.info("Shutting down...")
        reg.stop()
        hub.stop()
