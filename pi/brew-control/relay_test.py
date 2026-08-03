"""Relay tester for the Pi 5 relay board.

Pulses each relay for a few seconds so you can verify the wiring with a
multimeter (continuity on COM-NO) BEFORE any 230V load is connected.

All relays start and end OFF. The hardware interlock (no simultaneous
heat/cool per tank) is enforced even here as a safety net.

Run:
    GPIOZERO_PIN_FACTORY=lgpio python3 relay_test.py
"""

from __future__ import annotations

import time

try:
    from gpiozero import OutputDevice
except Exception:
    print("gpiozero saknas — kör: pip install gpiozero")
    print("Och sätt: GPIOZERO_PIN_FACTORY=lgpio")
    raise SystemExit(1)

# BCM pins (see pi-gpio-pinout memory)
RELAYS = {
    "tank1_heat": 26,
    "tank1_cool": 25,
    "tank2_heat": 24,
    "tank2_cool": 23,
    "tank3_heat": 22,
    "tank3_cool": 27,
    "kompressor": 12,
    "co2": 17,
    "relief": 16,
}

PULSE_S = 3.0   # how long each relay stays ON
GAP_S = 1.0     # pause between relays

# active_high=False: GPIO LOW = relay ON (active-LOW board)
devices = {name: OutputDevice(pin, active_high=False, initial_value=False)
           for name, pin in RELAYS.items()}


def all_off() -> None:
    for dev in devices.values():
        dev.off()


def check_interlock(name: str) -> str | None:
    """Return the conflicting relay name if it's ON, else None."""
    pairs = {
        "tank1_heat": "tank1_cool", "tank1_cool": "tank1_heat",
        "tank2_heat": "tank2_cool", "tank2_cool": "tank2_heat",
        "tank3_heat": "tank3_cool", "tank3_cool": "tank3_heat",
    }
    conflict = pairs.get(name)
    if conflict and devices[conflict].value:
        return conflict
    return None


def pulse(name: str, duration: float = PULSE_S) -> None:
    conflict = check_interlock(name)
    if conflict:
        print(f"  !! HOPPAR ÖVER {name} — {conflict} är redan PÅ (interlock)")
        return
    print(f"  PÅ  {name} (BCM {RELAYS[name]}) i {duration:.0f}s ...")
    devices[name].on()
    time.sleep(duration)
    devices[name].off()
    print(f"  AV  {name}")


def pulse_single(name: str) -> None:
    """Pulse one named relay (used by interactive mode)."""
    if name not in devices:
        print(f"  Okänt relä: {name}")
        print(f"  Tillgängliga: {', '.join(RELAYS)}")
        return
    all_off()
    pulse(name)


def run_all() -> None:
    print("\n=== Relay test — alla relä pulseras i ordning ===")
    print(f"Alltid {PULSE_S:.0f}s PÅ, {GAP_S:.0f}s paus. Allt börjar/Slutar AV.\n")
    all_off()
    time.sleep(GAP_S)
    for name in RELAYS:
        pulse(name)
        time.sleep(GAP_S)
    all_off()
    print("\nKlart — alla relä är AV.")


def interactive() -> None:
    print("\n=== Interaktivt läge ===")
    print("Skriv ett relänamn för att pulsa det, 'alla' för att köra alla, 'q' för att avsluta.")
    print(f"Tillgängliga: {', '.join(RELAYS)}\n")
    while True:
        cmd = input("relä> ").strip().lower()
        if cmd in ("q", "quit", "exit", ""):
            break
        if cmd == "alla":
            run_all()
            continue
        pulse_single(cmd)
    all_off()
    print("Avslutar — alla relä är av.")


if __name__ == "__main__":
    print("Relä-testare — Pi 5")
    print("VIKTIGT: Säkerställ att inga 230V-laster är inkopplade!\n")
    all_off()
    try:
        interactive()
    except KeyboardInterrupt:
        pass
    finally:
        all_off()
        print("\nSäker avstängning — alla relä är av.")
