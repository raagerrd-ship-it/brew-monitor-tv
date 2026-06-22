# PID V3: observatör + mode-k + asymmetriska gains (ersätter V2)

## Mål

Ersätt nuvarande V2 med en regulator som:
- Räknar fram en **färsk bulk-temp varje minut** via en observatör som extrapolerar bottenproben med pillens rörelse, skalad med ett **mode-beroende k** (kyla ≠ värme p.g.a. nedsänkt kylspiral + flytande pill).
- Kör **asymmetriska gains**: aggressiv värme (nästan bang-bang, ingen broms), försiktig kyla med kvadratisk pill-broms.
- **Skiktnings-skydd**: kapa duty om den ledande sensorn (botten vid kyla, topp vid värme) sticker iväg förbi target med >0.3°C.
- Integrerar varje minut med `KiPerHour * need / 60` — ingen stale-särbehandling, ingen i-zone-gate på datafärskhet.

## Filer som ändras

```text
supabase/functions/_shared/pid-compensation.ts        — riv V2-grenen, skriv computeDutyV3 + observatör
supabase/functions/_shared/controller-adjustments.ts  — wiring: probeIsFresh, pillTempNow, anchor in/ut
migration                                              — sensor_anchor jsonb på controller_learned_compensation
```

Allt annat (margin-scale, ramp-boost, util-sat-cap, panik >2°C, past-target-coast, mass-coast vid mode-flip, ssFloor-läsning, persistPidState-skelettet) **behålls oförändrat**.

## Migration

`controller_learned_compensation` får en kolumn:

```sql
ALTER TABLE public.controller_learned_compensation
  ADD COLUMN IF NOT EXISTS sensor_anchor jsonb;
-- form: { "probeTemp": number, "pillTemp": number, "anchoredAt": ISO8601 }
```

Ingen RLS-ändring (befintliga policies täcker). Ingen ny tabell.

## computeDutyV3 (skiss)

```text
input: mode, stepType, actualTarget,
       probeTemp, probeIsFresh, pillTempNow, pillRate,
       anchor (prev), k (per mode, inläst),
       ssFloor, ssFloorSamples,
       persistedIntegral, prevAvgError,
       modeJustSwitched, coolingUtilization,
       wBottom=0.5, wPill=0.5

1. obs = estimateBottomTemp(probeTemp, probeIsFresh, pillTempNow, anchor, k)
   → bottomEst (probe + clamp(k * pillDelta, ±0.10*min, ±2.0))
   → nyAnchor (uppdateras när probeIsFresh)
2. control = wBottom * bottomEst + wPill * pillTempNow
   avgError = actualTarget - control
   need = isCooling ? -avgError : avgError
3. Gains (asymmetri):
     Kp  = cooling ? (hold?0.30:0.55) : (hold?0.45:0.80)
     KiPerHour = cooling ? (hold?0.9:3.6) : (hold?1.2:4.5)
     Kd  = cooling ? (hold?0.25:0.35) : 0
     Imax= cooling ? (hold?0.35:0.65) : (hold?0.40:0.70)
4. Integral: alltid var minut, dt=1/60 h
     nextI = clamp(integral + KiPerHour * need / 60, 0, Imax)
     if need < -0.01: nextI *= 0.85   (overshoot-bleed)
5. P: uP = Kp * need
6. D (endast kyla): uD = predictive-brake
     approachRate = -pillRate  (cooling)
     if approachRate>0 && need>0:
       overshoot = approachRate * tauLagHours - need     (tau≈0.10h som start)
       if overshoot>0: uD = -min(0.5, Kd * overshoot)
7. uFf = ssFloor om samples ≥ 5
8. duty = clamp(uFf + uP + nextI + uD, 0, 1)
9. Skiktnings-guard:
     cooling: if bottomEst < target - 0.3 → duty = min(duty, 0.2)
     heating: if pillTempNow > target + 0.3 → duty = min(duty, 0.2)
10. Behåll: util-sat-cap, past-target-coast, panik >2°C, mass-coast
11. return { duty, integral: nextI, p, anchor: nyAnchor, constraints }
```

## Mode-k inlärning

I `calculateCompensatedTarget` (efter PID-beräkningen), när vi får en färsk probe:

```text
if probeIsFresh && anchor != null && !modeJustSwitched-during-window:
  probeDelta = probeTemp - anchor.probeTemp
  pillDelta  = pillTempNow - anchor.pillTemp
  if |pillDelta| >= 0.05:
    realized = probeDelta / pillDelta
    if 0.2 ≤ realized ≤ 4:
      updateLearnedParam(`gradient_k:${mode}`, realized, alpha=0.2, clamp 0.2..4)
```

Defaults vid läsning: `cooling=1.3`, `heating=0.7`.

`modeStable` spåras genom att lagra mode i anchor-jsonen och jämföra mot aktuellt mode.

## Wiring (controller-adjustments.ts)

- Räkna fram `probeIsFresh = !rawStaleData` och `pillTempNow` (senaste pill-temp från `temp_delta_history`/pressureMap som redan finns).
- Läs `sensor_anchor` från samma rad som `accumulated_integral` (samma upsert).
- Skicka in i `calculateCompensatedTarget` tillsammans med befintliga args.
- Returnerat `anchor` skrivs tillbaka i `persistPidState`-upserten (lägg till `sensor_anchor: nyAnchor`).
- **Riv ut** `pill-fused-estimate`-koden, `p-scaled-40pct`, `i-zone`-stale-blocket. Constraint-taggar som försvinner: `pill-fused-estimate`, `p-scaled-40pct`, `stale`, `i-zone`. Nya taggar: `predictive-brake`, `bottom-undershoot-guard`, `top-overshoot-guard`, `mode-soft-decay`, `gradient-k=<n.nn>`.
- Uppdatera ssFloor-learning-gaten i `controller-adjustments.ts` (whitelist av tags) så learning fortfarande är "rena hold-cykler": skippa när någon av `predictive-brake`, `bottom-undershoot-guard`, `top-overshoot-guard`, `overshoot-bleed`, `past-target-coast`, `margin-scale≠1`, `ramp-boost`, `util-sat-cap` är aktiv.

## Mode-flip (behåller V2:s lösning, mjukare)

Bara nolla integralen vid riktigt riktningsbyte:

```text
if modeJustSwitched:
  if |need| > 0.5: integral = 0, anchor = null    (mass-coast)
  else:            integral *= 0.5                 (mode-soft-decay)
```

## SSOT-konsekvens

`actual_temp` i DB fortsätter vara bottenproben (SSOT-regeln från memory). Observatörens `bottomEst` och `control` används **bara internt i PID-beräkningen** — vi skriver inte tillbaka dem till `actual_temp`/`current_temp`. Inga UI-ändringar.

## Verifiering

1. Deploy `auto-adjust-cooling`.
2. Edge logs på Mjöd & Skogens Sus i 2–3 cykler:
   - `gradient-k=` ska dyka upp i constraints.
   - `predictive-brake` aktiveras när pill faller snabbt.
   - Inga `pill-fused-estimate`/`stale`/`p-scaled-40pct` kvar.
3. SQL-spot-check att `sensor_anchor` skrivs och uppdateras varje cykel:
   ```sql
   select controller_id, sensor_anchor, updated_at
   from controller_learned_compensation
   where mode='cooling' order by updated_at desc limit 4;
   ```
4. Efter 24h: kontrollera att `gradient_k:cooling` och `gradient_k:heating` finns i `fermentation_learnings` och konvergerar mot något > 1 respektive < 1.

## Vad som INTE ingår

- Ingen ny tabell, ingen ny edge function.
- Inga gain-tunables i UI (Kp/Ki/Kd/k/wBottom hårdkodas tills observatören är beprövad).
- Ingen ändring av cooler-margin-logiken, ramp-context eller mode-switch-hysteresis i `controller-adjustments.ts`.
- Ingen ny chart/UI för observatörens bottomEst (vi loggar den i edge-log för debug).
