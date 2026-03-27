

## Plan: Sensorval — förenklad via `actual_temp` SSOT

### Insikt
`actual_temp` är redan beräknat av synkmotorn och konsumerat av alla nedströms (PID, automation, UI). Vi behöver INTE sprida `preferred_sensor` överallt — bara ändra synkmotorns beräkning.

### Ändringar

**1. Databas — ny kolumn**
```sql
ALTER TABLE rapt_temp_controllers 
  ADD COLUMN preferred_sensor text NOT NULL DEFAULT 'pill';
```

**2. Synkmotorn (`sync-rapt-data-quick/index.ts`, rad ~380-386)**
Ändra fallback-logiken vid `dualEnabled = false`:
```typescript
// Nuvarande:
updateData.actual_temp = pillTemp ?? currentTemp ?? null;

// Nytt:
const pref = existingCtrl?.preferred_sensor ?? 'pill';
updateData.actual_temp = pref === 'probe' 
  ? (currentTemp ?? pillTemp ?? null)
  : (pillTemp ?? currentTemp ?? null);
```

**3. `dual-sensor.ts` — samma justering för fallback**
Lägg till `preferredSensor` parameter i `computeDualSensorTarget` (används som fallback i `controller-adjustments.ts`).

**4. UI — RadioGroup i controller-dialogen**
I `RaptControllerDialog.tsx`: visa "Pill / Ctrl"-val **när dual sensor är AV** och pill finns tillgänglig.

**5. Hook — `use-controller-dialog.ts`**
Lägg till `preferredSensor` state, ladda från DB, spara direkt vid ändring.

### Filer som ändras
| Fil | Ändring |
|-----|---------|
| Migration (ny) | `ADD COLUMN preferred_sensor` |
| `sync-rapt-data-quick/index.ts` | Respektera `preferred_sensor` i fallback |
| `_shared/dual-sensor.ts` | Ny param för fallback-logik |
| `_shared/controller-adjustments.ts` | Skicka `preferred_sensor` till fusion |
| `src/hooks/use-controller-dialog.ts` | State + DB-update |
| `src/components/RaptControllerDialog.tsx` | RadioGroup |

Inga ändringar i `temp-display.ts`, `TempStat.tsx`, `DashboardHeader.tsx`, etc. — de läser redan `actual_temp`.

