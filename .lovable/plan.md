

## Plan: Per-öl Pill Compensation (på/av)

### Mål
Flytta pill compensation från enbart global toggle till per-öl-inställning. Varje öl i CustomBrewDialog får en Switch: "Pill-kompensation" (på/av). Detta styr om controller-data visas och om dual-sensor-logik appliceras för just den ölen.

### Databasändring
```sql
ALTER TABLE brew_readings
  ADD COLUMN pill_compensation boolean NOT NULL DEFAULT true;
```
Default `true` = befintligt beteende (använd dual om global är på).

### UI: CustomBrewDialog
- Lägg till en `Switch` under pill-väljaren (visas bara när `linkedPillId` finns och pillen har en parad controller)
- Label: "Pill-kompensation"
- Beskrivning: "Slå av för att enbart använda pill-temperatur"
- Default: `true`

### Genomslag
- **`BrewData` type** (`src/types/brew.ts`): lägg till `pill_compensation?: boolean`
- **`CustomBrewData` interface**: lägg till `pill_compensation: boolean`
- **`device-matching.ts`**: om `brew.pill_compensation === false` → returnera `controller: null`
- **`use-brew-data.ts`**: mappa `pill_compensation` från DB till `BrewData`
- **Befintliga komponenter** (BrewChart, TempStat, BrewCard): behöver inga ändringar — de reagerar redan på `devices.controller === null`

### Backend
Backend-PID (`controller-adjustments.ts`, `dual-sensor.ts`) fortsätter använda den globala `pill_compensation_enabled` från `auto_cooling_settings`. Per-öl-inställningen påverkar bara frontend-visning och device-matching.

### Filer som ändras
1. Migration — ny kolumn `pill_compensation` på `brew_readings`
2. `src/components/CustomBrewDialog.tsx` — Switch + state + spara
3. `src/types/brew.ts` — `pill_compensation` field
4. `src/lib/device-matching.ts` — respektera `pill_compensation`
5. `src/hooks/use-brew-data.ts` — mappa fältet

