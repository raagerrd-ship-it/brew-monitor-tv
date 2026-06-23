---
name: PID V3 Stability Pack
description: Three additions to V3 PID for tighter regulation — drift watchdog under ramp-override, hold-deadband at setpoint, and 3-min IIR on controlTemp.
type: feature
---

# V3 Stability Pack (Jun 2026)

Three small additions to `computeDutyV3` / ramp-override logic to make regulation tighter without changing the architecture.

## 1. Anti-drift watchdog under ramp-override
File: `supabase/functions/_shared/controller-adjustments.ts` (ramp-override block).

The existing `RAMP_OVERRIDE_OVERSHOOT_LIMIT = 0.3°C` only catches fast overshoots. A slow drift (e.g. +0.16°C/h in heating-ramp tail with duty=0%) flew under it. New trend trigger queries `temp_controller_history` 60 min back; if `actualTemp` has drifted ≥ 0.15°C in the escape direction → log `MODE_RAMP_OVERRIDE_DRIFT_BYPASS` and DO NOT force ramp-mode. Downstream "krypande fel" branch then accumulates `switch_pressure` and flips mode within ~3 cycles.

Constants: `RAMP_OVERRIDE_DRIFT_LIMIT = 0.15°C`, `RAMP_OVERRIDE_DRIFT_MINUTES = 60`.

## 2. Hold-deadband at setpoint
File: `supabase/functions/_shared/pid-compensation.ts` (`computeDutyV3` end).

When `stepType === 'hold'`, `|avgError| < 0.10°C`, `|pillRate| < 0.05°C/h` and no mode-switch → clamp duty=0 and freeze integral. Eliminates the 0/1/3/5/7%-micro-pulses around setpoint. Constraint label: `hold-deadband`.

## 3. 3-min IIR on controlTemp
File: `supabase/functions/_shared/pid-compensation.ts` (`computeDutyV3` after controlTemp calc).

`controlTemp = (1−α)·prevControlTemp + α·controlTempRaw` with `α = 0.4`. State persisted on the `sensor_anchor` JSONB blob as optional fields `lastControlTemp` / `lastControlTempAt`. Bypassed on mode-switch and when state is >5 min stale. Constraint label: `iir-smooth`.

## What this does NOT change
- gradient_k learning — still reads RAW probe/pill deltas (gradient physics), never smoothed/blended values.
- Bottom-undershoot-guard / top-overshoot-guard — unchanged, still protect leading sensor.
- Past-target-coast, full-action, util-sat-cap — unchanged.
- No schema changes — smoothing state piggybacks on existing `sensor_anchor` JSON.

## Verification (24h post-deploy)
Compare `STDDEV(actual_temp)` in `temp_controller_history` against baseline (Jun 22→23 24h window): Blå 0.640, Gul 0.541. Gul must not drift > 0.3°C above target during heating-ramp anymore.