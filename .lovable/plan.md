

## Smart Diacetylvila: `gradual_ramp` stegtyp

### Koncept

Ersätt det nuvarande "hopp"-beteendet i diacetylvilan med en gradvis temperaturhöjning styrd av **activity score** istället för tid. När jäsningen saktar ner höjs temperaturen proportionellt, och steget avslutas först när aktiviteten är nära noll och SG är stabil.

```text
Temp                Activity
 ▲                    ▲
 │    ┌─── target    │ ████
 │   /               │ ██████
 │  /                │ ████████
 │ / gradual_ramp    │ ██████████
 │/                  │ ████████████
 └──────────► tid    └──────────► tid
   activity ↓ = temp ↑    activity sjunker
```

### Beteende

1. **Väntar på trigger**: Utjäsning når `attenuation_trigger` (t.ex. 75%) OCH fas = declining/stationary (samma som nuvarande diacetyl_rest)
2. **Gradvis ramp**: `temp_increase` fördelas omvänt proportionellt mot activity score:
   - Activity 100 → 0% av höjningen
   - Activity 50 → 50% av höjningen  
   - Activity 0 → 100% av höjningen
   - Formel: `rampedTarget = baseTemp + tempIncrease × (1 - activityScore/100)`
3. **Avslutning**: SG stabil i `gravity_stable_days` OCH activity < 15

### Tekniska ändringar

**1. Databasschema** — Inga ändringar krävs. Befintliga kolumner `attenuation_trigger`, `temp_increase`, `gravity_stable_days`, `gravity_threshold` på `fermentation_profile_steps` räcker.

**2. `src/types/fermentation.ts`** — Lägg till `'gradual_ramp'` i `StepType` union och `STEP_TYPE_LABELS`.

**3. `supabase/functions/process-fermentation-profiles/index.ts`** — Nytt `case 'gradual_ramp'` i switch:
- Fas 1 (waiting): Samma trigger-logik som `diacetyl_rest` (utjäsning + fas)
- Fas 2 (ramping): Beräkna `rampedTarget = baseTemp + tempIncrease × (1 - clamp(activityScore, 0, 100) / 100)`, sätt som profileTarget
- Fas 3 (complete): SG stabil + activity < 15 → stepCompleted

**4. `src/components/fermentation/FermentationStepEditor.tsx`** — Nytt case `'gradual_ramp'` i `renderStepTypeFields` och `handleSave`. Samma fält som diacetyl_rest (utjäsning%, temp-höjning, stabila dagar, SG-tröskel) plus förklarande text.

**5. `src/components/fermentation/FermentationStepDisplay.tsx`** — Hantera `gradual_ramp` i `getStepIcon`, `getStepDescription`, `getNextStepCondition`.

**6. `src/lib/fermentation-target.ts`** — Inga ändringar, profileTarget sätts av edge function.

**7. `src/components/fermentation/hooks/useFermentationProgress.ts`** — Inga ändringar krävs, progressen styrs av backend.

**8. Deploy** `process-fermentation-profiles` edge function.

