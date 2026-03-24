

## Code Review: Buggar och Inkonsistenser

### Bug 1: Heating deadband fortfarande decayar integral (KRITISK)

**Fil:** `supabase/functions/_shared/pid-compensation.ts`, rad 405

Cooling-deadbanden fixades nyligen — integralen bevaras utan decay för att behålla den inlärda steady-state duty-cykeln. Men **samma fix gjordes INTE för heating**:

```text
// COOLING (rad 314-318) — FIXAD:
if (Math.abs(avgError) <= 0.1) {
  dutyCycle = Math.max(0, integral)  // ← Ingen decay, korrekt
}

// HEATING (rad 403-408) — BUGG:
if (Math.abs(avgError) <= 0.1) {
  hIntegral *= 0.9                   // ← Decay kvar! Duty sjunker till 0%
  hDutyCycle = Math.max(0, hIntegral)
}
```

**Konsekvens:** När heating-mode når målet (error ≤ 0.1°C) decayar integralen med 10% varje cykel. Efter ~20 cykler har duty sjunkit till nära 0% och temperaturen börjar falla, varpå systemet måste bygga upp integralen igen → oscillation.

**Fix:** Ta bort `hIntegral *= 0.9` i heating-deadbanden, precis som gjordes för cooling.

---

### Bug 2: Cooling DUTY_ZERO revert-guard missar maxTemp-extremen (MINDRE)

**Fil:** `supabase/functions/_shared/controller-adjustments.ts`, rad 443

Cooling-modens `DUTY_ZERO` revert-guard kontrollerar `ctrlTarget < 1` (dvs. hårdvaran står på 0°C från en burst). Men om systemet byter från heating till cooling efter en heating-burst, kan hårdvaran stå kvar vid `maxTemp` (t.ex. 25°C). Det finns ingen guard som revertar detta vid `dutyPct === 0` i cooling-moden.

Detta är dock låg risk — mode-switchen nollställer pressure och vid nästa cykel borde systemet fånga upp det.

---

### Potentiellt problem 3: persistPidState uppdaterar `controller_learned_compensation` per mode

**Fil:** `supabase/functions/_shared/pid-compensation.ts`, rad 11-18

`persistPidState` upserterar med `onConflict: 'controller_id,delta_bucket,mode,step_type'`. Det aktiva mode:t lagras nu i `fermentation_learnings.pid_current_mode` (korrekt), men den gamla `controller_learned_compensation`-tabellen har fortfarande **separata rader per mode**. Om en PWM OFF-revert skriver till denna tabell (execute-pwm-off rad 431-433 i controller-adjustments) uppdateras P-correction till 0 på **alla** mode-rader, inte bara den aktiva. Det kan nollställa den andra modens data i onödan.

Inte en direkt bugg (P-correction nollställs ändå under burst), men värt att notera.

---

## Sammanfattning

| # | Prioritet | Beskrivning | Fil |
|---|-----------|-------------|-----|
| 1 | **Kritisk** | Heating deadband decayar integral → 0% duty | `pid-compensation.ts:405` |
| 2 | Låg | Cooling DUTY_ZERO missar maxTemp-revert | `controller-adjustments.ts:443` |
| 3 | Info | P-correction nollställs över alla modes vid PWM OFF | `controller-adjustments.ts:431` |

### Implementationsplan

1. **Ta bort `hIntegral *= 0.9`** i heating-deadbanden (pid-compensation.ts rad 405)
2. Deploya `auto-adjust-cooling` edge function

En enkel ändring — 1 rad att ta bort.

