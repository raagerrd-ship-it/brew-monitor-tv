

## Problem: PID fastnar på 19.1° trots att den borde gå ner till 19.0°

### Rotorsak

Rate-limit-logiken på rad 440 skapar en "dödzon" som förhindrar den sista 0.1°-korrigeringen:

1. `compensatedTarget` beräknas korrekt till 19.0° (delta-komp undertryckt, PI i konvergenszon)
2. Men `distanceFromIdeal = 0.1` (19.1 → 19.0)
3. `scaleFactor = max(minScaleFactor, 0.1 / 2.0) = max(0.15, 0.05) = 0.15`
4. `baseLimit = effectiveMaxRate × 0.15 ≈ 0.045`
5. Eftersom `0.1 > 0.045` appliceras rate-limit: `compensatedTarget = 19.1 + (-0.045) = 19.055`
6. Avrundat till 1 decimal → **19.1°** — ingen förändring
7. Resultatet faller under negligible-tröskeln (< 0.05) och returnerar `null`

PID:en kan alltså aldrig nå 19.0° — rate-limiten blockerar varje cykel.

### Lösning

Lägg till en bypass i rate-limit-logiken: om den beräknade `compensatedTarget` ligger **närmare profileTarget** än nuvarande controllermål, och skillnaden är ≤ 0.2°C, tillåt ändringen utan rate-limit. Detta gäller bara korrigeringar "mot rätt håll" — inte bort från målet.

### Tekniska ändringar

**`supabase/functions/_shared/temp-utils.ts`** (rad ~464-468):

Före rate-limit-blocket, lägg till:

```
// Bypass rate-limit for small corrections toward profile target
const currentDistToProfile = Math.abs(currentControllerTarget - profileTarget)
const newDistToProfile = Math.abs(compensatedTarget - profileTarget)
const isTowardTarget = newDistToProfile < currentDistToProfile
if (isTowardTarget && distanceFromIdeal <= 0.2) {
  // Small correction toward target — skip rate-limit to avoid deadzone
} else if (distanceFromIdeal > baseLimit) {
  compensatedTarget = currentControllerTarget + (isIncreasing ? baseLimit : -baseLimit)
  console.log(...)
}
```

Detta löser dödzonen utan att påverka större justeringar som fortfarande behöver rate-limitering.

