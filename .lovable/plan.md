

## Plan: Ersätt duplicerad dual-sensor-logik med `getActualTemp()`

### Två ställen att fixa

**1. `src/components/DashboardHeader.tsx` (rad ~279-287)**
Ersätt inline-beräkningen med:
```typescript
import { getActualTemp } from "@/lib/temp-display";
// ...
const displayTemp = getActualTemp(controller.pill_temp, controller.current_temp, pillCompEnabled);
```

**2. `src/components/brew-card/TempStat.tsx` (rad 30-33)**
Redan importerar `getActualTemp` men använder den inte. Ersätt:
```typescript
// Före:
const displayTemp = (pillTemp != null && probeTemp != null)
  ? (pillTemp + probeTemp) / 2
  : (probeTemp ?? pillTemp ?? brew.currentTemp);

// Efter:
const displayTemp = getActualTemp(pillTemp, probeTemp, pillCompEnabled) ?? brew.currentTemp;
```

### Notering
- `supabase/functions/_shared/dual-sensor.ts` har samma matematik men är backend-funktionen för PID-beräkning — den ska behållas som den är.
- Inga databasändringar behövs.

