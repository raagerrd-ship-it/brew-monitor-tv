

# Kvarvarande `profileTarget`-läckor i kontrolllogik

## Hittade problem

### 1. `pid-compensation.ts` rad 323 — **ODEFINIERAD VARIABEL**
```typescript
const prevComp = Math.abs(actualTarget - ctrlTarget)
```
`actualTarget` finns inte i denna funktion — parametern heter `profileTarget`. Detta ger `NaN` vid runtime, vilket gör att saturation cap aldrig triggar.

**Fix:** Byt till `baseTarget`:
```typescript
const prevComp = Math.abs(baseTarget - ctrlTarget)
```
Logiken: "hur långt har PID redan dragit hw-målet från grundmålet?" — rent probe-domän.

### 2. `controller-adjustments.ts` rad 424 — Heater guard
```typescript
const avgError = actualTarget - actualTemp
const isHoldingStable = Math.abs(avgError) < 1.0
```
`actualTarget` = profileTarget. Jämförs mot `actualTemp` (fused). Borde jämföra i hw-domän:
```typescript
const avgError = dualSensor.baseTarget - actualTemp
```

### 3. `pid-compensation.ts` rad 358–363 — Kommentarer
Refererar `actualTarget` men den variabeln finns inte. Uppdatera till `pillVirtualTarget`.

### Ej problem
- **Rad 369** (`pillVirtualTarget = profileTarget + (profileTarget - baseTarget)`) — korrekt per din design, profileTarget används som speglingscentrum.
- **Rad 345** (`distance = actualTemp - actualTarget`) — ramp-context bestämmer hur snabbt profilen vill röra sig, OK att använda profilmål.
- **Stall detection** — profileTarget används för cold crash guard (policy, ej hw-styrning) och loggning.

## Filer som ändras
- `supabase/functions/_shared/pid-compensation.ts` — rad 323 + kommentarer
- `supabase/functions/_shared/controller-adjustments.ts` — rad 424

