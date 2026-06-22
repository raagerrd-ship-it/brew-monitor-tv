# pid-compensation.ts → V2 PI-kärna (AKTIV 2026-06-22)

V1 (650 raders if/elseif-kedja med 15+ grenar) är borttagen. `calculateCompensatedTarget` är nu ~95 rader: parallell fetch av ssFloor + PID-state, margin-scaling, anrop till `computeDutyV2`, ramp-boost post-process, persist.

## V2-kärna (computeDutyV2)

```
u_ff   = ssFloor (när samples ≥ 3)
u_p    = Kp * need * (stale ? 0.40 : 1.00)
u_i    = clamp(Σ Ki·need, 0, Imax)   // bara när |need| ≤ 0.30°C och färsk data
u_d    = -Kd * approachRate²         // bara när närmar oss target i mode-riktning
duty   = clamp(u_ff + u_p + u_i + u_d, 0, 1)
```

Specialfall:
- `mass-coast` vid mode-flip (integral→0, en cykel paus)
- `pill-fused-estimate` när bottenprobe stale (15-min lucka): need-justering m. pillRate
- `overshoot-bleed` vid need < -0.01 (snabb urladdning av I)
- `past-target-coast` vid need ≤ 0 (duty 0, eller 15% av floor i hold)
- `util-sat-cap` när cooling util ≥ 90%
- `full-action` vid need > 2.0°C

Gains (hold / ramp+wait): Kp 0.30/0.55, Ki 0.015/0.06, Kd 0.25/0.35, Imax 0.35/0.65.

## Vad finns kvar utanför v2

- ssFloor fetch + margin-scaling (cooling) — i `calculateCompensatedTarget` före v2-anrop
- ssFloor seeding/EMA — i `controller-adjustments.ts`, nu gated på v2-taggar (`i-zone` / `stale` / `overshoot-bleed`)
- Ramp-boost (cooling, deficit > 0.1°/h) — post-process efter v2
- `learnThermalRate`, `learnGlycolCoolerRate`, `getGlycolRatesSummary` — orörda

## Bortrensat

deadband-coast/trim/recovery/no-floor(-probe), target-hold(-warm), overcooled+catch-30pct, alla brake-zone-varianter (static/FAST_APPROACH/ratePrediction/SAFETY/ramp-pred/ramp-deg), hold-drift-micro, mode-flip-cap, mode-switch-softstart/warmseed, soft-start-cap, settling-guard, low-error-cap, cool-soft, saturation-erosion, floor-erosion, computeIntegral-helpern, V2-shadow-blocket.

## Risker att övervaka

- ssFloor-skrivning sker nu bara via `i-zone`/`stale`/`overshoot-bleed`-tags — verifiera att seeding fortsätter på Mjöd/Skogens Sus
- `accumulated_integral` clampas en gång (>1.0 → 0) vid första körningen efter deploy
- Kd-tuning: kvadratisk pill-broms är ny — bevaka om Blå/Mjöd får för tidig avstängning
