---
name: Feedforward duty-floor learning
description: PID lär sig ambient_gain/cool_response från 6h historik → seedar duty-golv. Broadened convergence-gate (±0.20°, proximity-weighted α).
type: feature
---
# Feedforward duty + broadened convergence

## Convergence-gate (persistPidState)
- `|avgError| ≤ 0.20°` (var 0.10°)
- α = `0.10 * max(0, 1 - |err|/0.20)` — proximity-weighted, samples nära err=0 dominerar EMA
- Övriga guards oförändrade (`dutyCycle > 2%`, `|duty-iCorrection| < 5%`, hold only)

## Feedforward-lärning (`learnFeedforwardDuty`)
Från senaste 6h `temp_controller_history` per controller/mode:
- `ambient_gain` = median(rate) där `duty ≤ 0.5%` och rate driftar bort från mål
- `cool_response` = median(|rate|/duty%) där `duty ≥ 2%` och rate driftar mot mål
- `required_duty = ambient_gain / (cool_response * 100)`, cappat till 0..0.30
- Persisteras i `fermentation_learnings` som `feedforward_duty:{mode}`
- 2h cache via `last_updated_at`

## Användning
`effectiveBaseline = max(learnedBaseline, feedforwardDuty)` skickas till `computeDutyV5` → seed-golv för I-termen. Ger PID en riktig termisk modell istället för att vänta på konvergens.

## Varför
Gamla gaten (`|err|≤0.10°`) sampladade bara noll-passager → baseline fastnade nära 1% trots att verkligt steady-state kräver mer. Feedforward mäter direkt vad som behövs för balans.