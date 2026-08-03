---
name: Pi Local Regulator V6
description: Pi 5 kör full V6-PID lokalt med PT100-sensorer och reläer. Edge functions pi-control (GET setpoint) och pi-telemetry (POST live+rollup). Tabeller pi_setpoint + pi_live_state. Säkerhetslager i constraints.py. Molnsynk var 30s live, 5min rollup.
type: feature
---
# Pi Local Regulator — Full V6 PID Port

## Arkitektur
- Pi 5 läser PT100 via MAX31865 (1 Hz) och styr 8 reläer (active-low)
- V6 PID porterad till Python (`pid.py`) — pure function, ingen DB-åtkomst i PID-loopen
- Säkerhetslager (`constraints.py`): sensor-freshness, hard temp limits, glycol freeze guard, min on/off, max duty cap
- Relay PWM: 180s period, 5s min on/off, interlock per tank (heat/cool aldrig samtidigt)
- Molnsynk: Hämtar setpoint + learned params från `pi_setpoint` + `fermentation_learnings`, skriver `pi_live_state` + `temp_controller_history`

## Edge Functions
- `pi-control` (GET): Returnerar setpoint + learned params för Pi-styrda tankar
- `pi-telemetry` (POST): Tar emot live-state (30s) och rollups (5min), piggyback:ar uppdaterad setpoint i svaret
- Auth: `x-pi-secret` header mot `PI_BLE_INGEST_SECRET`

## Databas
- `pi_setpoint`: target_temp, mode_allowed, max_duty_pct, pwm_period_s, min_on_s, min_off_s, params_version
- `pi_live_state`: actual_temp, target_temp, mode, duty_pct, cooling/heating_relay_on, glycol_temp, pid_terms
- `rapt_temp_controllers.actuation`: 'rapt' (default) eller 'pi' — markerar vilken som styr

## Glycol Management
- Kompressor relä (BCM 26) är efterfrågestyrd: idle 15°C, aktiv när tank kyler
- Min on 5min, min off 5min, max 6 starter/tim, startup delay 3min efter boot
- Hysteres 1.5°C runt önskad glykoltemp

## Mode Selection
- Två-stegs hysteres: <0.25° neutral, 0.25-0.60° flip efter 30min, >0.60° flip efter 10min, >0.80° immediate
- 1h wrong-side latch: >0.15° på fel sida i >60min → force flip

## Tilstånd
- PID state (EMA, trimI, ssot_history) persistas i SQLite (`regulator_state.db`)
- Överlever reboot — lastar tillstånd vid startup

## Frontend Integration (Ej ännu implementerad)
- Dashboard läser fortfarande från `rapt_temp_controllers` — Pi-styrda tankar behöver frontend-ändring
- `pi-telemetry` uppdaterar inte `rapt_temp_controllers` ännu (kan läggas till)
- `sync-rapt-data-quick` skippar inte `actuation='pi'` ännu — måste fixas när tankar byts

## Filer
- `pi/brew-control/pid.py` — V6 PID pure function
- `pi/brew-control/constraints.py` — säkerhetslager
- `pi/brew-control/relay.py` — reläkontroll + PWM + kompressor
- `pi/brew-control/cloud_sync.py` — httpx-baserad molnsynk
- `pi/brew-control/regulator.py` — huvudloop + entry point
- `pi/brew-control/config.py` — pin-mapping + konstanter
- `pi/brew-control/web.py` — kalibrering + kontrollendpoints
- `supabase/functions/pi-control/index.ts`
- `supabase/functions/pi-telemetry/index.ts`
