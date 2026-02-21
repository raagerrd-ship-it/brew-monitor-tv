
# Implementera de 5 identifierade temperaturlogik-fixarna

## 1. Ta bort damping fran PillCompensationSettings

**Fil:** `supabase/functions/_shared/temp-utils.ts`
- Ta bort `damping: number` fran `PillCompensationSettings` (rad 38)
- Ta bort `pill_compensation_damping` fran SELECT-fragan i `loadPillCompSettings` (rad 185)
- Ta bort `damping: parseFloat(...)` raden i return-objektet (rad 191)

## 2. Fixa swappade falt i process-fermentation-profiles

**Fil:** `supabase/functions/process-fermentation-profiles/index.ts`

Pa 3 stallen (rad 248-249, 281-282, 326-327) byta:
- `followed_current_temp: controller.pill_temp` --> `followed_current_temp: controller.current_temp`
- `followed_target_temp: controller.current_temp` --> `followed_target_temp: effectiveTarget` (eller `currentStep.target_temp` i hold-blocket)

## 3. Deduplicera pill-komp-logiken i process-fermentation-profiles

**Fil:** `supabase/functions/process-fermentation-profiles/index.ts`

Skapa en lokal hjalparfunktion:
```text
async function applyPillCompensation(
  supabase, supabaseUrl, supabaseKey,
  session, controller, profileTarget,
  pillCompSettings, pillCompSkipSameData
): Promise<{ actionTaken: string; actionDetails: any }>
```

Funktionen hanterar:
- Berakna kompenserat mal via `calculateCompensatedTarget`
- Overshoot-guard (kolla 15min `auto_cooling_adjustments`)
- Satt temp via `setControllerTargetTemp`
- Logga justering till `auto_cooling_adjustments` med **korrekta** faltnamn (`followed_current_temp = controller.current_temp`, `followed_target_temp = profileTarget`)

Bade no-target-blocket (rad 198-291) och hold-blocket (rad 295-336) anropar denna funktion istallet for duplicerad kod.

## 4. Ersatt supabase.functions.invoke med setControllerTargetTemp i auto-adjust-cooling

**Fil:** `supabase/functions/auto-adjust-cooling/index.ts`

- Importera `setControllerTargetTemp` fran `../_shared/temp-utils.ts` (lagg till i befintlig import pa rad 3)
- Spara `supabaseUrl` och `supabaseKey` i variabler (finns redan pa rad 116-117)
- Ersatt alla 7 `supabase.functions.invoke('rapt-update-controller', ...)` (rad 547, 673, 710, 785, 848, 1025, 1116) med `setControllerTargetTemp(supabaseUrl, supabaseKey, controllerId, value)`
- Anpassa felhanteringen: `setControllerTargetTemp` returnerar `boolean` istallet for `{ error }`, sa byt `if (!updateResponse.error)` till `if (success)`

## 5. Per-controller overshoot-cooldown

**Fil:** `supabase/functions/auto-adjust-cooling/index.ts`

Nuvarande kod (rad 583-605) gor en **global** cooldown-check utanfor for-loopen.

Andring:
- Flytta cooldown-logiken **in i** for-loopen (rad 610+)
- Filtrera pa `cooler_controller_id = fc.controller_id` i fragan
- Ta bort den globala `canRunOvershoot`-variabeln och `if (!canRunOvershoot) break`
- Varje controller far sin egen 10-minuters cooldown

## Teknisk sammanfattning

### Filer som andras:
1. `supabase/functions/_shared/temp-utils.ts` -- ta bort damping (3 rader)
2. `supabase/functions/process-fermentation-profiles/index.ts` -- fixa swappade falt, deduplicera pill-komp
3. `supabase/functions/auto-adjust-cooling/index.ts` -- importera och anvand `setControllerTargetTemp`, per-controller cooldown

### Testning:
- Deploya alla 3 edge functions
- Anropa `run-automation` och verifiera att loggarna visar korrekta faltnamn och att timeout-skydd ar aktivt
