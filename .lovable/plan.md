## Problem

`controller_learned_compensation` har kolumnerna `convergence_count` och `learned_pi_correction`, men `persistPidState()` skriver **aldrig** till dem. Endast `accumulated_integral` (transient I-term) persistas.

Följdverkan för Grön:
- Konvergensräknare fast på 0 sedan 63 dagar.
- Ingen lärd "duty-floor" — varje ny session/mode-switch börjar reaktivt från 0.
- Mode-reset (`mode-reset-hard`, rad 233) nollar accumulated_integral. Med PWM-cyklingen som pinglar cooling↔heating hinner I-termen sällan bygga upp verklig steady-state.
- Nattens observerade sågtand (12.7 ↔ 13.24) = symptom.

## Åtgärd (isolerad till pid-compensation.ts)

**1. Detektera konvergens i `persistPidState`**

Skriv `convergence_count` och `learned_pi_correction` när ALLT gäller:
- `stepType === 'hold'`
- `Math.abs(avgError) ≤ 0.10` (i deadband)
- `dutyCycle > 0.02` (aktiv reglering, inte coast)
- `Math.abs(dutyCycle - iCorrection) < 0.05` (duty drivs av I-term, dvs. steady state)
- Ej `mode-reset-hard`-cykel

När villkoret uppfylls:
- `convergence_count += 1`
- `learned_pi_correction = EMA(prev, iCorrection, α=0.10)` — långsam glidning så en enstaka outlier inte förstör baseline.

**2. Använda `learned_pi_correction` som seed i `computeDutyV5`**

När `persistedIntegral === 0` (fresh session / efter mode-reset) och `learnedBaseline > 0.05`:
- Seed `integral = learnedBaseline * 0.7` (70% — konservativt, PID trimmar upp resten via db-conv-up)
- Ny constraint-tagg: `seed-from-learned(X%)` för spårbarhet.

**3. Mjukare mode-reset**

Ändra rad 233–236: istället för hård `integral = 0`, blend mot lärd baseline:
- `integral = learnedBaseline * 0.5` om `learnedBaseline > 0`, annars 0.
- Constraint: `mode-reset-soft` när baseline finns.

## Filer som ändras

- `supabase/functions/_shared/pid-compensation.ts` — enda filen. Ingen migration behövs (kolumnerna finns redan).

## Verifiering

Efter deploy, om 24h:
- Kolla `SELECT convergence_count, learned_pi_correction FROM controller_learned_compensation WHERE controller_id LIKE '6fbbc7db%' AND step_type='hold'` — count > 0, correction ≠ 0.
- Kolla nattens `temp_controller_history` — förvänta minskad spridning kring 13.0°C (mål: ±0.15° istället för ±0.24°).

## Ej i scope

- Långsiktig persistering över säsonger (ambient sommar/vinter) — kräver ambient-bucket, större refactor.
- Bucket-baserad kompensation (`delta_bucket` är hårdkodat till 'low' idag) — behåll tills stability visat värde.
- UI för att visa lärt värde — separat pass.
