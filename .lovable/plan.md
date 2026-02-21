
# Temperaturlogik -- Forenkling och Optimering

## Sammanfattning

Temperaturlogiken ar funktionell men uppdelad over tva stora edge functions (totalt ~2270 rader) med betydande duplicering. Denna plan forenklar, batchar och gor logiken mer robust.

## Problem som atsardas

### 1. Duplicerad logik
Samma funktioner (pill-kompensation, target-uppslag, RAPT API-anrop) finns i bade `process-fermentation-profiles` och `auto-adjust-cooling`. Risk for divergens vid bugfixar.

### 2. For manga databasanrop
`auto-adjust-cooling` gor 20-30+ sekventiella databasanrop per cykel med 3 controllers. Kan batchas till en handfull.

### 3. Inkonsekvent RAPT API-anvandning
En funktion pratar direkt med RAPT, den andra gar via `rapt-update-controller`. Bor vara enhetligt.

### 4. Frontend N+1-problem
`TempStat.tsx` gor separata databasanrop per brew-kort. Bor centraliseras.

### 5. Saknad robusthet
Inga timeouts pa RAPT-anrop, DB-fel ignoreras tyst.

## Implementationssteg

### Steg 1: Skapa delad modul
Ny fil: `supabase/functions/_shared/temp-utils.ts`
- Flytta `calculateCompensatedTarget()`, `getEffectiveTargetTemp()`, `round1()`
- Gemensamma interfaces

### Steg 2: Uppdatera process-fermentation-profiles
- Importera fran delad modul
- Byt direkta RAPT-anrop mot `rapt-update-controller`
- Lagg till `AbortSignal.timeout(10000)`

### Steg 3: Uppdatera auto-adjust-cooling
- Importera fran delad modul
- Batcha DB-fragor med `.in()` (lastAdjTimestampMap, originalTargetMap, linked brews)
- Ta bort duplicerade definitioner

### Steg 4: Flytta TempStat DB-fraga
- Flytta `auto_cooling_adjustments`-fragan fran `TempStat.tsx` till `use-brew-data.ts`
- Skicka ner som prop

### Steg 5: Testa
- Trigga run-automation och verifiera beslutsloggen
- Kontrollera att TempStat visar korrekt info

## Prioritering

- **Hog**: Delad modul + batchade DB-fragor
- **Medel**: Enhetlig RAPT-wrapper + frontend-optimering
- **Lag**: Timeout och felhantering
