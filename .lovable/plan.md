## Mål
Minska överskjut när en profilramp landar genom att börja sänka duty `X` minuter före rampslut. Brom-nivån härleds från **lärd integral för hold-bucketen** vid rampens slut-target (samma `(mode, delta_bucket=low, step_type=hold)`-nyckel som används när rampen är klar och vi går in i hold-fasen).

## Hur det fungerar

Under en aktiv ramp (`step_type ∈ {ramp, gradual_ramp}`) räknar vi ut hur nära vi är rampens slut-target och bromsar in integralen mot den lärda hold-integralen redan **innan** rampen är klar — istället för dagens reaktiva nollställning *efter* `rampJustFinished`.

```text
ETA till rampens slut-target (min)
  ├─ > LEAD_MIN           → ingen prediktiv broms (normal PID)
  ├─ LEAD_MIN → 0         → blendar integral mot lärd hold-I (proximity 0→1)
  └─ ≤ 0 (rampen klar)    → befintlig wind-up-release tar över
```

Lead-tiden `LEAD_MIN` = 20 minuter (≈1.3 PID-cykler — säker buffert utan att kapa rampens momentum för tidigt).

Blend-formeln matchar redan befintlig braking-logik (rad 488–505 i pid-compensation.ts):
```
proximity = 1 - clamp(etaMin / LEAD_MIN, 0, 1)
blendedI  = integral * (1 - proximity) + learnedHoldI * proximity
```
— bara om `blendedI < integral` (broms, aldrig boost).

ETA beräknas från `pillRate` (oberoende sensor, redan hämtad för ramper när BLE-länkad). Krav: `pillRate` finns och rör sig mot target med ≥ 0.05°C/h. Ingen pillRate → ingen prediktiv broms (fall tillbaka på dagens reaktiva).

Hold-bucket-uppslag återanvänder befintlig `getLearnedParam(controller, "steady_state_duty:{mode}:{bucket}{:phase}")` när den finns — annars `latest_i_correction` från `controller_learned_compensation` för `(controller, low, mode, "hold")`. Lärd I < 0.05 → skip (för osäkert minne).

## Filändringar

### `supabase/functions/_shared/controller-adjustments.ts`
- I sektionen som bygger `rampContext` (rad ~864–875): utöka till att även köra för `pidMode === 'heating'` när vi är i ramp (idag bara cooling).
- Lägg till hämtning av `learnedHoldI` (latest_i_correction för hold-bucket vid `rampEndTarget`) och `rampEtaMin` (från pillRate + distance till `rampEndTarget`). Skicka båda vidare i `rampContext`.

### `supabase/functions/_shared/pid-compensation.ts`
- Utöka `rampContext`-typen med `learnedHoldI?: number; etaMin?: number; endTarget?: number`.
- I `NEEDS ACTION`-grenen (efter befintlig braking-zon, före raw-clamp): om `rampContext.etaMin != null && etaMin <= LEAD_MIN && learnedHoldI > 0.05`, beräkna `proximity` och `blendedI` enligt ovan. Applicera bara om mindre än nuvarande integral. Lägg till `constraints.push('ramp-pred-brake=XX%')` och en `console.log`-rad i samma stil som befintlig `🛑 brake`-rad.
- Påverkar inte hold/deadband/coast-grenarna och ändrar inte floor-learning (förblir fryst under ramp per gällande regel).

## Verifiering
1. Deploya berörda edge functions (`process-profiles`, `auto-adjust-cooling`).
2. Kolla nästa körning för Gul (Gyllene Harmoni — heating gradual_ramp pågår) i `ai_audit_log` / function-logs: leta `ramp-pred-brake=` i `limits` när `pill_eta_min <= 20`.
3. Bekräfta att `latest_avg_error` i `controller_learned_compensation` för `heating/hold/low` trendar mot mindre overshoot över nästa 2–3 ramper.

## Det jag *inte* gör
- Ingen ny tabell, ingen migration — återanvänder `controller_learned_compensation`.
- Ingen ändring av `rampJustFinished` wind-up-release eller mode-switch-logik.
- Ingen prediktiv boost (broms aldrig boost).
- Ingen ändring av ssFloor-frysning under ramp.
