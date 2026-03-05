

## Audit: Profilmål används som faktiskt hårdvarumål

### Problem
`actualTarget` (= `profile_target_temp`, det virtuella profilmålet) används som golv/mål på flera ställen där `ctrlTarget` (det kompenserade hårdvarumålet) borde användas istället. Detta kan tvinga hårdvaran till 8°C istället för det kompenserade ~6.1°C, vilket aktiverar värmaren och skapar oscillationer.

### Identifierade ställen

**1. Heater activation guard (rad 370) — BUG**
```typescript
ctrlTargetPid = Math.max(actualTarget, heaterThreshold)
// actualTarget = 8.0°C → golv hamnar på 8.0°C
// Borde vara: Math.max(ctrlTarget, heaterThreshold)
```
Om PID vill sätta 5.8°C i heating-mode, clampas det till 8.0°C → värmaren aktiveras.

**Fix:** Byt `actualTarget` → `ctrlTarget` som golv. Ctrl target inkluderar redan sensorkompenseringen och är det lägsta målet som är meningsfullt för hårdvaran.

**2. Stall detection un-boost (rad 441, 472) — POTENTIELLT**
```typescript
const restoredTarget = Math.max(effectiveProfileTarget, boostOldTarget)
// och:
new_target_temp: existingComp ? currentTarget : effectiveProfileTarget
```
Vid un-boost efter stall kan målet återställas till profilmålet (8°C) istället för det kompenserade ctrlTarget. Detta är dock mindre kritiskt eftersom PID kommer korrigera i nästa cykel.

**Fix:** Ändra `effectiveProfileTarget` till det senast kända kompenserade målet (`boostOldTarget` är redan korrekt i de flesta fall).

### Filer som ändras
- `supabase/functions/_shared/controller-adjustments.ts` — rad 370: byt golv från `actualTarget` till `ctrlTarget`
- `supabase/functions/_shared/stall-detection.ts` — rad 441, 472: säkerställ att un-boost inte hoppar till profilmålet

### Minnesuppdatering
Uppdatera memory med principen: **profile_target_temp är alltid virtuellt — det enda riktiga målet som skickas till hårdvara eller används som golv/referens är ctrlTarget eller ctrlTargetPid.**

