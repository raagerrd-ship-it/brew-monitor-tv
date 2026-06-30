---
name: PID V5 Single-input
description: PID tar bara actualTemp + ålder. Pill/probe blandas uppströms. Lägger till D-on-measurement, slew-cap, ssot-stale-freeze.
type: feature
---
PID V5 (juni 2026) — ersätter V4.

## Input
`calculateCompensatedTarget` tar nu bara `actualTemp` (SSOT) + `actualTempAgeMin`.
Borttagna parametrar: `pillTempNow`, `pillRate`, `probeTempRaw`, `pillProbeOffset`, `probeAgeMin`, `rampContext`, `isInterpolated`.

## Borttagna guards (orsakade stratifierings-windup)
- `pill-top-cap` / `pill-bottom-stop` / `top-overshoot-guard` (+ skip-stratified)
- `probe-stale-i` / `probe-stale-cap`
- `ramp-boost` (krävde pillRate)

## Nya stabilitetstrick (sensor-agnostiska)
- **Deadband-freeze** (±0.10°C): fryser I, ingen mikrojustering.
- **D-on-measurement**: `dBrake = Kd * progressRate` när SSOT rör sig mot mål. Kd_cool=8.0, Kd_heat=6.0. Capad till 25%.
- **Slew-rate cap**: max ±5% duty/cykel. Bypass vid |err|>0.5°, mode-switch eller past-target-coast.
- **SSOT-stale-freeze**: fryser I + skippar D om `actualTempAgeMin > 8`.

## State (oförändrad form, döpt om till V5PidState)
`sensor_anchor` JSONB i `controller_learned_compensation` — samma fält som V4.

## Anrop i controller-adjustments.ts
`ssotAgeMin = probeAgeMin ?? staleMinutes` skickas som sista arg.