

# Analys: Oanvända inlärda parametrar

## Sammanfattning

Jag har gått igenom all automation och identifierat inlärda parametrar (`fermentation_learnings`) som antingen skrivs men aldrig läses, eller läses men aldrig skrivs av automationen.

## Fynd

### 1. `avg_convergence_error` — SKRIVS men LÄSES ALDRIG
- **Var den skrivs:** `fermentation-learnings.ts` (vid profil-avslut)
- **Var den läses:** Ingenstans
- **Slutsats:** Helt oanvänd. Kan tas bort.

### 2. `cooling_capacity:{load}` — SKRIVS men ANVÄNDS INTE i beslut
- **Var den skrivs:** `cooler-management.ts` (vid ≥95% utilization)
- **Var den läses:** Enbart av UI-komponenten `LearnedThermalProfile.tsx` för visning
- **Slutsats:** Ingen automationslogik använder detta värde. Enbart kosmetiskt. Kan behållas om du vill se det i UI, men det påverkar inget.

### 3. `steady_state_duty:{bucket}` — LÄSES men SKRIVS ALDRIG av automation
- **Var den läses:**
  - `pid-compensation.ts` — som seed för integral vid migration
  - `cooler-management.ts` — prediktiv kylarberedskap
  - `auto-adjust-cooling/index.ts` — visa `duty_pct` i loggar
- **Var den skrivs:** Ingenstans automatiskt. Enbart AI audit kan skriva den (via whitelist `duty_cycle:`, men det är ett annat parameternamn!)
- **Slutsats:** Denna parameter finns aldrig i databasen om inte AI audit har skapat den. Alla 3 läsningarna faller tillbaka till default (-1 eller 0), så de fungerar men gör ingenting. **Bör antingen börja skrivas automatiskt (t.ex. från PID-integralens steady-state) eller tas bort.**

### 4. `duty_cycle:{bucket}` i AI audit whitelist — NAMNKONFLIKT
- AI audit har `duty_cycle:` som prefix i sin whitelist
- Men automationen läser `steady_state_duty:` — de matchar inte!
- **Slutsats:** Även om AI:n skriver `duty_cycle:warm` så läser ingen det. Det bör vara `steady_state_duty:` i whitelisten, eller så bör läsningarna ändras.

## Rekommenderad plan

1. **Ta bort `avg_convergence_error`** — radera skrivningen i `fermentation-learnings.ts`
2. **Fixa `steady_state_duty` — välj ETT av:**
   - **Alt A:** Börja skriva `steady_state_duty:{bucket}` automatiskt från PID-regulatorn (t.ex. spara integralen som duty vid stabil drift)
   - **Alt B:** Ta bort alla läsningar av `steady_state_duty:` (de gör ändå inget nu)
3. **Fixa AI audit namnkonflikt** — ändra `duty_cycle:` till `steady_state_duty:` i whitelisten (om Alt A väljs)
4. **Valfritt:** Behåll eller ta bort `cooling_capacity` (enbart kosmetisk)

## Teknisk omfattning

- `supabase/functions/_shared/fermentation-learnings.ts` — ta bort `avg_convergence_error`-skrivning
- `supabase/functions/_shared/controller-adjustments.ts` — eventuellt lägga till `steady_state_duty`-skrivning
- `supabase/functions/ai-automation-audit/index.ts` — fixa whitelist `duty_cycle:` → `steady_state_duty:`
- `supabase/functions/_shared/pid-compensation.ts` — beroende på val
- `supabase/functions/_shared/cooler-management.ts` — beroende på val

