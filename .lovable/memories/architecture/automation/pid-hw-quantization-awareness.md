---
name: PID HW-quantization awareness
description: PID känner PWM-hårdvarans upplösning (1% över 50 min dither-fönster). Seeds/mode-reset kvantiseras till 1%, D-brake fryses i dither-zonen.
type: feature
---
PWM-hårdvaran levererar `duty` via round-robin dither: 10 slots × 5 min = 50 min fönster. Minsta effektiva steg = 1% duty. Under `duty=10%` sänds bara enstaka 10%-bursts glest utspridda — ingen jämn andel.

I `pid-compensation.ts`:

- `HW_STEP = 0.01`, `DITHER_ZONE_MAX = 0.10`, `quantize(d)` helper.
- Seeds (`seed-from-learned`) och `mode-reset-soft` kvantiseras till närmaste 1% så persistent state matchar det hårdvaran kan leverera.
- **D-brake dither-guard**: när `prevDuty ∈ (0, 10%)` **och** `isHold` **och** `inDeadband` fryses D-brake. Anledning: SSOT-EMA (τ=3 min) reagerar på 10%-burstens termiska ringing och rapporterar falsk "progress-rate" som D-brake annars skulle sänka duty på → oscillation runt setpoint. Constraint-tagg: `d-suppress-dither`.
- Slew-cap (5%) är oförändrad — 5% >> 1% så kvantisering påverkar den inte.

Ändras inte: I-termen räknas kontinuerligt (kvantisering bara vid seed/reset), P och overshoot-bleed är oberoende av HW-upplösning.