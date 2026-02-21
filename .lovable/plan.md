
# Ta bort PROFILE_STATUS-logg + visa aktivt rampmål i FOLLOWED_DATA

## Problem 1: Redundant PROFILE_STATUS-logg
Blocket på rad 374-388 i `auto-adjust-cooling/index.ts` skriver fortfarande separata PROFILE_STATUS-loggar trots att informationen redan finns i FOLLOWED_DATA.

## Problem 2: Saknar interpolerat rampmål i loggen
Under en ramp-fas visar `profile_target` i loggen bara steg-slutmålet (t.ex. 18.0 grader), inte det aktuella interpolerade målet (t.ex. 14.2 grader efter 3h av en 24h ramp). Det gör det svårt att förstå vad systemet faktiskt styr mot just nu.

## Ändringar

### Fil: `supabase/functions/auto-adjust-cooling/index.ts`

**A. Utöka session-frågan (rad 243)**

Lägg till `step_started_at, step_start_temp` i select:
```
.select('id, controller_id, profile_id, current_step_index, step_started_at, step_start_temp')
```

**B. Utöka profile steps-frågan (rad 276)**

Lägg till `step_type, duration_hours, ramp_type` i select:
```
.select('profile_id, target_temp, step_order, step_type, duration_hours, ramp_type')
```

**C. Beräkna interpolerat rampmål i sessionsloopen (rad 290-313)**

Efter att `effectiveTarget` satts, kolla om aktuellt steg är en linjär ramp med `duration_hours`. Om så, beräkna interpolerat mål med samma logik som `calculateRampTemp` i process-fermentation-profiles:

```
interpolatedTarget = startTemp + (targetTemp - startTemp) * min(elapsed / duration, 1)
```

Spara detta i `profileStatusMap` som en ny property `activeTarget`.

**D. Inkludera `active_target` i FOLLOWED_DATA-loggen (rad 366-370)**

Om `profileInfo.activeTarget` finns och skiljer sig från `profileInfo.profileTarget`, lägg till `details.profile_active_target` med det interpolerade värdet. Detta visas bara under aktiva ramper.

**E. Ta bort PROFILE_STATUS-blocket (rad 374-388)**

Ta bort hela `if (profileStatusMap.size > 0)` blocket.

## Resultat

FOLLOWED_DATA-loggen visar nu t.ex.:
```
profile_target: 18.0      (steg-slutmål)
profile_active_target: 14.2 (interpolerat just nu - bara under ramp)
profile_step: 2
```

Ingen separat PROFILE_STATUS-logg skapas.

## Omfattning

- 1 fil, ~20 rader ändrade
- Deploya `auto-adjust-cooling`
