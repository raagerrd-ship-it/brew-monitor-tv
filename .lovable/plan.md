
# Temperaturlogik -- Forenkling och Optimering

## Status

### ✅ Steg 1: Delad modul (KLART)
Skapade `supabase/functions/_shared/temp-utils.ts` med:
- `calculateCompensatedTarget()` - pill-kompensationslogik
- `getEffectiveTargetTemp()` - target-uppslag genom steg
- `round1()` - avrundningshjälpare
- `setControllerTargetTemp()` - enhetlig RAPT API-wrapper via edge function
- `loadPillCompSettings()` - ladda pill-komp-inställningar
- Gemensamma interfaces: ProfileStep, TempController, PillCompensationSettings

### ✅ Steg 2: Uppdatera process-fermentation-profiles (KLART)
- Importerar från delad modul
- Byter direkta RAPT API-anrop mot `setControllerTargetTemp()` (via rapt-update-controller)
- Timeout 10s på alla RAPT-anrop via AbortSignal
- ~200 rader mindre kod (från 791 till ~590)

### ✅ Steg 3: Uppdatera auto-adjust-cooling (KLART)
- Importerar `round1` och `TempController` från delad modul
- Batchat `lastAdjTimestampMap` - EN fråga istället för N sekventiella
- Batchat `originalTargetMap` - EN fråga istället för N sekventiella
- ~10-15 färre DB-anrop per cykel med 3 controllers

### ✅ Steg 4: Flytta TempStat DB-fråga (KLART)
- Flyttade `auto_cooling_adjustments`-frågan från `TempStat.tsx` till `use-brew-data.ts`
- Batch-hämtar overshoot-data för alla controllers i en enda fråga
- Data skickas via `BrewData.overshootReason` och `BrewData.originalTarget`
- Eliminerar N+1 frontend-problem (N separata DB-anrop → 1)

### 🔲 Steg 5: Testa
- Trigga run-automation och verifiera beslutsloggen
- Kontrollera att TempStat visar korrekt info
