---
name: PID V3 Observer Architecture
description: V3 PID core with observer-fused bulk temp, mode-keyed gradient k, asymmetric gains, predictive cooling brake, stratification guards. Replaces V2 in pid-compensation.ts.
type: feature
---

## File
`supabase/functions/_shared/pid-compensation.ts` — exports `calculateCompensatedTarget`, `computeDutyV3`, `estimateBottomTemp`, `SensorAnchor`.

## Core model
`duty = clamp(uFf + uP + nextI + uD, 0, 1)` per minute, then guards.

- `uFf` = `ssFloor` when `ssFloorSamples >= 5`, else 0.
- `uP` = `Kp * need` where `need = ±(target - controlTemp)`.
- `nextI` += `KiPerHour * need / 60` every cycle (no i-zone gate, no stale-block).
- `uD` = predictive pill-brake, **cooling only**.

`controlTemp = wBottom * bottomEst + wPill * pillTempNow` (default 0.5/0.5). Falls back to `bottomEst` when no pill is linked.

## Observer (`estimateBottomTemp`)
Extrapolates the slow probe-domain SSOT between fresh probe samples using floating pill movement.
- Fresh probe (or no pill / no anchor): re-anchor; `bottomEst = probeTemp`.
- Stale probe + valid anchor: `bottomEst = anchor.probeTemp + clamp(k * (pillNow - anchor.pillTemp), ±0.10 * minutesSince, ±2.0)`.
- Anchor persists in `controller_learned_compensation.sensor_anchor` (jsonb: `{ probeTemp, pillTemp, anchoredAt, mode }`).

## Mode-keyed gradient `k`
- `gradient_k:cooling` default **1.3** (kall vätska sjunker, botten leder).
- `gradient_k:heating` default **0.7** (varm vätska stiger, topp leder).
- Learned via `updateLearnedParam` (alpha 0.2, clamp 0.2..4.0) when a fresh probe arrives AND prior anchor was from the same mode AND `|pillDelta| >= 0.05`.
- Stored in `fermentation_learnings` like other PID params.

## Asymmetric gains (cooling vs heating)
| Mode    | Step  | Kp   | KiPerHour | Kd   | Imax |
|---------|-------|------|-----------|------|------|
| cooling | hold  | 0.30 | 0.9       | 0.25 | 0.35 |
| cooling | other | 0.55 | 3.6       | 0.35 | 0.65 |
| heating | hold  | 0.45 | 1.2       | 0    | 0.40 |
| heating | other | 0.80 | 4.5       | 0    | 0.70 |

Heating is near bang-bang (no D, large Kp) because 30W mat ≈ 0.4°C/h max — physically cannot overshoot in 60L.

## Cooling predictive brake
`uD = -min(0.5, Kd * (approachRate * tauLagHours - need))` when overshoot > 0. `tauLagHours = 0.10` (≈6 min transport time from coil through wort to probe). Tag: `predictive-brake`.

## Stratification guards
- Cooling: `bottomEst < target - 0.3` → `duty = min(duty, 0.2)`. Tag: `bottom-undershoot-guard`.
- Heating: `pillTempNow > target + 0.3` → `duty = min(duty, 0.2)`. Tag: `top-overshoot-guard`.

## Mode-flip handling
- `|need| > 0.5`: hard reset `integral = 0`. Tag: `mass-coast`.
- Else: `integral *= 0.5`. Tag: `mode-soft-decay`.

## ssFloor learning gate (controller-adjustments.ts)
Learn ssFloor only when:
- `steady-state` tag present (`|need| <= 0.30` AND not mode-switching), OR
- `overshoot-bleed` tag present, AND
- No conflict tag: `predictive-brake`, `bottom-undershoot-guard`, `top-overshoot-guard`, `past-target-coast`, `full-action`, `mass-coast`, `util-sat-cap`, `margin-scale=*`, `ramp-boost=*`.
- Not a ramp step.

## Preserved from V2
`margin-scale` (cooler-margin-aware floor scaling), `ramp-boost`, `util-sat-cap`, `past-target-coast`, `full-action` (>2°C panic), `overshoot-bleed` (nextI *= 0.85 when need < -0.01), one-time legacy integral clamp.

## SSOT caveat
`actualTemp` passed in is whatever the BLE-ingest wrote (avg/pill/probe per `dual_sensor_enabled` + `preferred_sensor`). Observer's `bottomEst` and `controlTemp` are **internal-only** — never written back to `actual_temp` / `current_temp`. Gradient-k and stratification guards have full physical meaning only when `preferred_sensor === 'probe'`; in pill-only/dual modes they degrade gracefully (observer becomes near-pass-through).

## Removed tags (V2 → V3)
`pill-fused-estimate`, `p-scaled-40pct`, `stale`, `i-zone`, `realtime-brake` — all gone.

## New tags (V3)
`steady-state`, `predictive-brake`, `bottom-undershoot-guard`, `top-overshoot-guard`, `mode-soft-decay`, `gradient-k=<n.nn>` (emitted on a learning hit).