
# Fixa identifierade temperaturlogik-problem

## 1. Swappade falt i process-fermentation-profiles

I `process-fermentation-profiles/index.ts` ar `followed_current_temp` och `followed_target_temp` omvanda pa tre stallen (raderna 248-249, 281-282, 326-327 i auto_cooling_adjustments-inserts):
- `followed_current_temp` sats till `controller.pill_temp` (borde vara `controller.current_temp`)
- `followed_target_temp` sats till `controller.current_temp` (borde vara profilens mal)

Atgard: Byt sa att `followed_current_temp = controller.current_temp` och `followed_target_temp = effectiveTarget/currentStep.target_temp`.

## 2. Ta bort oanvand damping-parameter

`pill_compensation_damping` laddas i `_shared/temp-utils.ts` (`loadPillCompSettings`) men anvands aldrig i `calculateCompensatedTarget`. 

Atgard: Ta bort `damping` fran `PillCompensationSettings`-interfacet och fran `loadPillCompSettings`. Databasekolumnen behalles (ingen skada), men koden laser inte langre vardet.

## 3. Enhetliga RAPT-anrop via setControllerTargetTemp

`auto-adjust-cooling/index.ts` anvander `supabase.functions.invoke('rapt-update-controller')` pa 5 stallen (stall-boost rad 547, overshoot rad 673, overshoot-recovery rad 710, glycol default rad 785, glycol overcooling rad 848, plus ytterligare i glycol-sektionen). Dessa saknar timeout-skydd och felhantering som den delade wrappern erbjuder.

Atgard: Ersatt alla `supabase.functions.invoke('rapt-update-controller', ...)` med `setControllerTargetTemp(supabaseUrl, serviceRoleKey, controllerId, value)` fran `_shared/temp-utils.ts`. Importera funktionen samt spara `supabaseUrl`/`supabaseKey` i variabler tillgangliga for dessa anrop.

## 4. Per-controller overshoot-cooldown

Nuvarande overshoot-cooldown (10 min, rad 584-601) ar global -- en justering pa en controller blockerar alla andra.

Atgard: Flytta cooldown-kontrollen in i for-loopen och filtrera pa `cooler_controller_id = fc.controller_id`. Sa att varje controller har sin egen 10-minuters cooldown oberoende av andra.

## 5. Deduplicera pill-komp-logiken i process-fermentation-profiles

Raderna 198-291 (steg utan target_temp) och 295-336 (hold-steg med target_temp) innehaller nastan identisk pill-kompensationslogik: berakna kompenserat mal, kontrollera overshoot, satt temp, logga justering.

Atgard: Extrahera en lokal hjalparfunktion `applyPillCompensation(supabase, session, controller, profileTarget, pillCompSettings, pillCompSkipSameData)` som returnerar `{ actionTaken, actionDetails }`. Bade no-target-enforce och hold-steg anropar denna funktion istallet for att ha duplicerad kod.

## Tekniska detaljer

### Fil: `supabase/functions/_shared/temp-utils.ts`
- Ta bort `damping` fran `PillCompensationSettings`
- Ta bort `pill_compensation_damping` fran `loadPillCompSettings`

### Fil: `supabase/functions/process-fermentation-profiles/index.ts`
- Fixa `followed_current_temp`/`followed_target_temp` pa 3 stallen
- Skapa lokal `applyPillCompensation()` som hanterar: berakna kompenserat mal, overshoot-guard, satt temp, logga auto_cooling_adjustments
- Ersatt duplicerad logik i no-target-blocket (rad 198-291) och hold-blocket (rad 295-336)

### Fil: `supabase/functions/auto-adjust-cooling/index.ts`
- Importera `setControllerTargetTemp` fran shared module
- Ersatt 5+ `supabase.functions.invoke('rapt-update-controller')` med `setControllerTargetTemp()`
- Flytta overshoot-cooldown fran global (rad 584-601) till per-controller inne i for-loopen (filtrera `cooler_controller_id = fc.controller_id`)

### Testning
- Deploya bada edge functions
- Trigga run-automation och verifiera att loggen visar korrekta faltnamn och att timeout-skydd ar aktivt
