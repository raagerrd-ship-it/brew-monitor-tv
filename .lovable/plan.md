


## Granskning: Smart diacetylvila (`gradual_ramp`) — ✅ Implementerad

### Genomförda förbättringar

1. ✅ **`ProfileStep`-typen utökad** — `diacetyl_rest`, `gradual_ramp`, `wait_for_acknowledgement` + fälten `attenuation_trigger`, `activity_trigger`, `temp_increase`, `min_ramp_hours`, `ramp_curve`
2. ✅ **Alla `(currentStep as any)` borttagna** — typade fält används direkt
3. ✅ **Notifikation vid ramp-trigger** — "Smart diacetylvila startad"
4. ✅ **Notifikation vid gradual_ramp-slutförande** — "Smart diacetylvila klar"

## Arkitektur: Single Source of Truth (SSOT)

### `_shared/types.ts` — Centrala domäntyper
- `SgDataPoint` — enda definition, importeras av 6 filer
- `BrewData` — ersätter anonyma inline-typer
- `FermentationMetrics` — ersätter duplicerade inline-definitioner
- `FermentationSession` — enda session-typ (ersätter 3 separata definitioner)
- `SessionRef` — minimal subset för livscykeloperationer
- `StepContext` / `StepResult` — uses ovanstående typer
- `setProfileTarget()` / `clearProfileTarget()` — **enda plats** som skriver `profile_target_temp`

### `_shared/pid-compensation.ts` — PID-logik
- `calculateCompensatedTarget()` — PI(D) loop med learned compensation
- `learnThermalRate()` — hardware thermal rate learning
- `learnGlycolCoolerRate()` / `getGlycolRatesSummary()` — glycol learning
- `loadPillCompSettings()` — settings loader
- `PillCompensationSettings` interface

### `_shared/temp-utils.ts` — Grundtyper + utilities
- `ProfileStep`, `TempController` — core interfaces
- `round1()`, `getEffectiveTargetTemp()` — rena hjälpfunktioner
- `setControllerTargetTemp()` — RAPT API wrapper
- Re-exporterar PID-funktioner för bakåtkompatibilitet

### `_shared/session-lifecycle.ts` — Sessionslivscykel
- `completeProfile()` — markera klar + rensa + notifiera + learning
- `advanceToNextStep()` — stega framåt + sätt target

### `_shared/step-handlers.ts` — Steglogik
- 8 isolerade handlers + dispatcher
- `defaultResult()` — eliminerar boilerplate
- Importerar `setProfileTarget` från types.ts (SSOT)

### `_shared/learning-utils.ts` — Adaptiv inlärning (SSOT)
- `getLearnedParam()` — hämta inlärt värde med default
- `updateLearnedParam()` — EMA-baserad uppdatering med clamp
- `getTempBucket()` — temperaturzon-klassificering (cold/cool/warm/hot)

### `_shared/adjustment-logger.ts` — Justeringsloggning (SSOT)
- `logAdjustment()` — **enda plats** som insertar i `auto_cooling_adjustments`
- `AdjustmentRecord` / `AdjustmentResult` — typade interfaces

### `_shared/stall-detection.ts` — Stalldetektering
- `evaluateBoostOutcomes()` — lär från historiska boost-utfall
- `detectAndHandleStalls()` — detektion + adaptiv boost/un-boost
- `handleUnBoost()` — reverserar boost när jäsning återupptas

### `_shared/glycol-cooling.ts` — Glykolkylare
- `runGlycolCooling()` — huvudorkestrering
- `evaluateCoolingOutcomes()` — lär marginaler från historik
- `handleActiveCooling()` — sustained cooling + smart performance check
- `handleRecovery()` — recovery mot idealtemperatur
- `handleNoCooling()` / `handleOvercooling()` — specialfall

### `auto-adjust-cooling/index.ts` — Tunn orkestrerare (~370 rader)
- Laddar settings + controllers + profiler
- Anropar Feature 1 (PID) inline, Feature 2 (stall) + Feature 3 (glycol) via imports
- Decision log + summary
