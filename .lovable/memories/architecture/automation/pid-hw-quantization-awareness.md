---
name: PID HW-quantization awareness
description: PID känner PWM-hårdvarans upplösning (1% över 50 min dither-fönster). Seeds/mode-reset kvantiseras till 1%. D-brake, stall-boost-growth och peak-detection är dither-medvetna. SSOT-EMA använder korrekt diskret form med τ=12 min.
type: feature
---
PWM-hårdvaran levererar `duty` via round-robin dither: 10 slots × 5 min = 50 min fönster. Minsta effektiva steg = 1% duty. Under `duty=10%` sänds bara enstaka 10%-bursts glest utspridda — ingen jämn andel.

I `pid-compensation.ts`:

- `HW_STEP = 0.01`, `DITHER_ZONE_MAX = 0.10`, `quantize(d)` helper.
- Seeds (`seed-from-learned`) och `mode-reset-soft` kvantiseras till närmaste 1% så persistent state matchar det hårdvaran kan leverera.
- **SSOT-EMA**: `alpha = 1 - exp(-dt/TAU_MIN)`, `TAU_MIN = 12` min. TAU MÅSTE överstiga sample-intervallet (≥5 min PWM-cykel) — annars saturerar alpha till 1 och EMA:n blir pass-through. Rör man PWM-cadence måste TAU_MIN tunas om. Tidigare `min(1, dt/tau)` med τ=3 gav noll filtrering i produktion och undergrävde alla dither-guards nedströms.
- **D-brake dither-guard**: när `prevDuty ∈ (0, 10%)` **och** `isHold` **och** `inDeadband` fryses D-brake. Anledning: SSOT-EMA reagerar på 10%-burstens termiska ringing och rapporterar falsk "progress-rate" som D-brake annars skulle sänka duty på → oscillation runt setpoint. Constraint-tagg: `d-suppress-dither`.
- **Stall-boost dither-guard**: samma villkor (`prevDuty ∈ (0, 10%)`) fryser växt av `stallBoostPct` i `shortfall > 0`-grenen. Decay och reset-till-0 påverkas inte — boost får krympa men aldrig växa på ett burst-sample. Constraint-tagg: `stall-freeze-dither` (loggas bara när growth faktiskt skippades).
- **Peak-detection filter**: `peakMinTemp`-arm och tröskelchecks läser `ssotFiltered`, inte raw `input.actualTemp`. Skyddar Ki-autotune från att latcha en burst-dip som "peak" och permanent bias:a Ki nedåt.
- Slew-cap (5%) är oförändrad — 5% >> 1% så kvantisering påverkar den inte.

Ändras inte: I-termen räknas kontinuerligt (kvantisering bara vid seed/reset), P och overshoot-bleed är oberoende av HW-upplösning.