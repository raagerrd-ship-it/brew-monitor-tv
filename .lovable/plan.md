

## Analys

Du har helt rätt. Problemet uppstår för att `gradual_ramp` och `diacetyl_rest` inte har ett explicit `target_temp` i databasen (det är `null`), och de förlitar sig på `getEffectiveTargetTemp()` varje cykel för att hitta sin bas-temperatur. Detta skapar en sårbarhet — den generiska fallback-logiken kunde skriva över deras dynamiska mål.

**Lösning**: Vid stegövergång (rad 747-775), sätt `profile_target_temp` direkt till det effektiva målet för det nya steget. Då äger varje steg sitt mål från första sekunden.

## Plan

### 1. Sätt `profile_target_temp` vid stegövergång

I `supabase/functions/process-fermentation-profiles/index.ts`, vid rad ~748-755 där nästa steg startas, lägg till logik som beräknar och sätter `profile_target_temp` direkt:

```typescript
// After updating current_step_index...
const nextStep = steps[nextStepIndex];
if (nextStep && nextStep.target_temp === null) {
  const effectiveTarget = getEffectiveTargetTemp(steps as ProfileStep[], nextStepIndex);
  if (effectiveTarget !== null) {
    await setProfileTarget(supabase, session.controller_id, effectiveTarget);
  }
} else if (nextStep?.target_temp !== null) {
  await setProfileTarget(supabase, session.controller_id, nextStep.target_temp);
}
```

Detta gäller **alla** stegtyper utan explicit target — `wait_for_gravity_stable`, `wait_for_sg`, `wait_for_acknowledgement`, `diacetyl_rest`, `gradual_ramp`. Alla får sitt mål satt direkt vid övergång istället för att vänta på nästa 5-minuterscykel.

### 2. Ta bort den generiska fallback-logiken (rad 302-315)

Eftersom alla steg nu får sitt mål satt vid övergång, behövs inte den generiska fallback-logiken längre. Den kan tas bort helt — varje `case` i switchen hanterar redan sitt eget mål.

### Fördelar
- Eliminerar hela klassen av buggar där fallback skriver över dynamiska mål
- Enklare kod — en plats sätter initialt mål, varje case uppdaterar sitt eget
- Inga specialundantag behövs (`!== 'gradual_ramp'` etc.)

