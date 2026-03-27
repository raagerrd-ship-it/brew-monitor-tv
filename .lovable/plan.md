

# Tvinga mode att matcha ramp-riktning

## Problem
Under en aktiv profil-ramp (t.ex. uppåt) bestäms `suggestedMode` enbart av temperatur vs mål (rad 257). Om temperaturen tillfälligt överstiger det rörliga rampmålet föreslås `cooling` — trots att rampen pekar uppåt. Systemet försöker byta till cooling, vilket motverkar rampen.

## Lösning
Direkt efter rad 257 (där `suggestedMode` sätts), lägg till en override som tvingar mode att matcha ramp-riktningen:
- Ramp uppåt → `suggestedMode = 'heating'`  
- Ramp nedåt → `suggestedMode = 'cooling'`

## Ändringar

### `supabase/functions/_shared/controller-adjustments.ts`
1. Ändra `const suggestedMode` till `let suggestedMode` (rad 257)
2. Lägg till efter rad 257:
```typescript
// During active profile ramp, force mode to match ramp direction
// Ramp up → only heating allowed, ramp down → only cooling allowed
const profileCtx = ctx.profileStatusMap.get(fc.controller_id)
if (profileCtx?.rampDirection && 
    (profileCtx.currentStepType === 'gradual_ramp' || profileCtx.currentStepType === 'ramp')) {
  const rampMode = profileCtx.rampDirection as 'heating' | 'cooling'
  if (suggestedMode !== rampMode) {
    log('MODE_RAMP_OVERRIDE', 'info', 
      `${fc.name}: ramp ${rampMode} override (temp ${round1(actualTemp)}° vs mål ${round1(actualTarget)}°, would have been ${suggestedMode})`)
    suggestedMode = rampMode
  }
}
```

### Deploy
- `auto-adjust-cooling` och `run-automation`

