

# Optimera ramp-logiken: ett enda setTemp-anrop per cykel

## Problem

I den linjara ramp-logiken (rad 487-516) skickas **tva** API-anrop per cykel:
1. `setTemp(newTarget)` - satter mellanmalet
2. `applyPillCompensation(newTarget)` som internt anropar `setTemp` igen med det kompenserade vardet

Detta ger dubbla anrop till RAPT API och rate-limitern i `calculateCompensatedTarget` jamfor mot en **stale** `controller.target_temp` (den fran cykelns borjan, inte den just uppdaterade).

## Losning

Berakna pill-kompensation **lokalt** innan API-anropet och skicka bara **ett** `setTemp` med det slutgiltiga vardet.

### Ny logik (pseudokod)

```text
newTarget = calculateRampTemp(...)

// Berakna pill-komp mot mellanmalet INNAN nagot API-anrop
finalTarget = newTarget
if (pillCompEnabled && !pillCompSkipSameData):
    compensation = calculateCompensatedTarget(
        profileTarget = newTarget,
        currentControllerTarget = controller.target_temp  // korrekt referens
    )
    if (compensation):
        finalTarget = compensation.compensatedTarget

// ETT enda API-anrop
if (abs(controller.target_temp - finalTarget) > 0.1):
    setTemp(finalTarget)
    updateDB(finalTarget)
    logAdjustment(...)
```

### Vad som andras

Fil: `supabase/functions/process-fermentation-profiles/index.ts`

**Ramp else-blocket (rad 487-516)** omstruktureras:

1. Berakna `newTarget` via `calculateRampTemp` (oforandrat)
2. Om pill-komp ar aktivt: anropa `calculateCompensatedTarget` direkt (inte via `applyPillCompensation`) med `newTarget` som `profileTarget`
3. Bestam `finalTarget` = kompenserat varde eller `newTarget` om ingen kompensation behovs
4. Skicka **ett** `setTemp(finalTarget)` och uppdatera databasen
5. Logga ramp + eventuell kompensation i ett enda `auto_cooling_adjustments`-inlagg

**tempReached-blocket (rad 455-486)** behalles som det ar - dar ar `applyPillCompensation` korrekt eftersom rampen ar klar och vi bara vill underhalla malet.

### Vad som INTE andras

- `applyPillCompensation`-funktionen behalles intakt for hold-steg, wait-steg och tempReached-fallet
- `calculateCompensatedTarget` i temp-utils.ts - ingen andring
- Omedelbar ramp - oforandrad
- Ovriga stegtyper - oforandrade
