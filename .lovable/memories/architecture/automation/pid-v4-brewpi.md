---
name: PID V4 (BrewPi-stil)
description: Långsam PI på SSOT + brett dödband + peak-detection självtuning av cooling-Ki + pill som säkerhetstak. Ersätter V3 (observer/k-learning/stratifierings-guard/SSOT-golv).
type: feature
---

# PID V4 — BrewPi-stil

Designprinciper för dödtidsdominerad process (~15 min probe-latens, 60L massa):
- Långsam PI på SSOT (`actualTemp`) direkt. **Inget D**, **ingen observer**, **inget k-learning**.
- Brett dödband ±0.10°C i hold (`hold-deadband`).
- Pill används enbart som säkerhetstak: `pill-top-cap` (+0.7°C) och `pill-bottom-stop` (−0.7°C).
- Peak-detection självtuner cooling-Ki: undershoot >0.20°C sänker `kiAdj×0.85`, overshoot >0.10°C höjer `kiAdj×1.15`. Clamp 0.4–2.5.
- Min-off 5 min på kylning innan duty får återstarta (`min-off(...)`).
- Värmesidan oförändrad i karaktär (snabb, hög Kp/Ki).

## Tuning

**Cooling:** Kp=0.20, KiPerHour=0.30×kiAdj, Imax=0.35, Deadband=0.10, IZone=0.4, MinOff=5min.
**Heating:** Kp=0.45/0.80 (hold/ramp), KiPerHour=1.2/4.5, Imax=0.40/0.70, IZone=0.6.

## Persistent state

Lagras i `controller_learned_compensation`:
- `accumulated_integral` → I-termen
- `sensor_anchor` (JSONB) → `V4PidState`: `lastSsot`, `lastDutyPct`, `lastZeroDutyAt`, `peakArmed`, `peakArmedTarget`, `peakMinTemp`, `kiAdjCooling`, `lastMode`

Gamla anchor-fält (`probeTemp`/`pillTemp`/`lastControlTemp`) ignoreras tyst vid läsning — ingen migration behövs.

## Constraint-taggar

**Aktiva (V4):** `i-zone`, `steady-state`, `overshoot-bleed`, `past-target-coast`, `full-action`, `hold-deadband`, `mode-reset`, `top-overshoot-guard`, `util-sat-cap`, `margin-scale=…`, `ramp-boost=…`, `pill-top-cap(…)`, `pill-bottom-stop(…)`, `min-off(…m)`, `peak-arm`, `peak-tune-down(…)`, `peak-tune-up(…)`, `peak-ok(…)`.

**Borttagna (V3-era):** `iir-smooth`, `offset-blend=…`, `gradient-k=…`, `predictive-brake`, `bottom-undershoot-guard`, `bottom-undershoot-guard+boost`, `bottom-undershoot-stop`, `stratified-guard(…)`, `stratified-guard:stall-pulse(…)`, `ssot-floor(…)`, `mode-soft-decay`, `mass-coast`.

## Varför

V3-stacken (observer + k-learning + stratifierings-guard + SSOT-golv + dithering) byggdes lager för lager för att kompensera tuningar som var för snabba för processens dödtid. Lagren motverkade varandra: probe-fokuserad fusion blockerade cooling samtidigt som SSOT-golv försökte tvinga in den. Med BrewPi-stilens långsamma PI + bred dödband + självtuning får vi förutsägbart beteende: hellre långsamt mot mål, men håller det.

## Förväntat beteende

- Svarstid på störning: 15–20 min
- Hold-precision: ±0.10°C efter ~2 dygns inkörning (peak-detection självjusterar `kiAdj`)
- Inga 0/1/3/5/7%-mikropulser runt setpoint
- Aldrig overshoot >0.4°C