

# Förenkling av temperatursystemet + Dual-sensor på controllernivå

## Sammanfattning

Två sammankopplade förändringar:
1. **Dual-sensor-inställningen** flyttas från globalt (`auto_cooling_settings.pill_compensation_enabled`) och per-brew (`brew_readings.pill_compensation`) till per-controller (`rapt_temp_controllers.dual_sensor_enabled`). Togglen visas enbart i controller-popupen.
2. **`actual_temp`** beräknas en gång i synkmotorn och sparas i controllerns DB-rad. Alla konsumenter läser den direkt — ingen fusion-logik i frontend eller automation.

## Databasändringar (1 migration)

Lägg till i `rapt_temp_controllers`:
- `dual_sensor_enabled BOOLEAN DEFAULT false`
- `actual_temp NUMERIC`

Migrera befintliga: sätt `dual_sensor_enabled = true` för controllers som har `linked_pill_id IS NOT NULL` och globalt `pill_compensation_enabled = true`.

## Backend-ändringar

### `sync-rapt-data-quick` (synkmotorn)
- Ta bort läsning av `pill_compensation_enabled` från `auto_cooling_settings`-queryn
- Ta bort `isPillCompEnabled`-variabeln
- Lägg till `dual_sensor_enabled` i `existingMap`-queryn (`select` utökas)
- Vid controller-upsert: beräkna `actual_temp` via `computeDualSensorTarget(target, probe, pill, dual_sensor_enabled)` och spara i updateData
- Bevara `dual_sensor_enabled` från `existingMap` (ska inte skrivas över av synk)

### `controller-adjustments.ts`
- Ta bort `perBrewDualMap` — hela brew_readings-queryn (rad 172-187, ~15 rader)
- Ändra `dualEnabled` till: `const dualEnabled = (fc as any).dual_sensor_enabled ?? false`
- Alternativt: läs `fc.actual_temp` direkt istället för att köra `computeDualSensorTarget` (en rad: `const actualTemp = (fc as any).actual_temp ?? fc.current_temp`)

### `pid-compensation.ts` → `loadPillCompSettings`
- Ta bort `pill_compensation_enabled` från `auto_cooling_settings`-queryn
- `enabled`-flaggan i return tas bort (den är nu per controller)

### `run-automation` / `auto-adjust-cooling`
- Ta bort `hasPillComp` / `isPillCompEnabled` från `auto_cooling_settings`-check

### `get-public-rapt-data`
- Ta bort `pillCompEnabled` från response
- Returnera `dual_sensor_enabled` och `actual_temp` per controller istället

### `ai-automation-audit`
- Uppdatera prompt: `pill_compensation_enabled` är inte längre globalt, det är per controller

### Snapshot (`brew-snapshots.ts`)
- Läs `actual_temp` från controller-raden vid snapshot-skapande (ingen beräkning)

## Frontend — Controller-popup (ny toggle)

### `use-controller-dialog.ts`
- Ta bort global `auto_cooling_settings.pill_compensation_enabled`-query (~10 rader)
- Ta bort per-brew `brew_readings.pill_compensation` override-query (~8 rader)
- Läs `dual_sensor_enabled` direkt från controller-raden (redan tillgänglig via realtime)
- Lägg till `toggleDualSensor()`: `supabase.from('rapt_temp_controllers').update({ dual_sensor_enabled: !current })`

### `RaptControllerDialog.tsx`
- Lägg till `Switch`-toggle "Dubbla givare" synlig när `controller.pill_temp != null && !isCooler`

## Frontend — Ta bort `pillCompEnabled`-propagering (~14 filer)

| Fil | Ändring |
|-----|---------|
| `brew-card/types.ts` | Ta bort `pillCompEnabled` från `BrewCardProps` |
| `brew-card/BrewCard.tsx` | Ta bort prop |
| `brew-card/TempStat.tsx` | Ta bort `pillCompEnabled` prop, läs `devices.controller?.dual_sensor_enabled` |
| `DashboardHeader.tsx` | Ta bort `pillCompEnabled` prop + `RaptControllerBar` |
| `BrewingDashboard.tsx` | Ta bort `pillCompEnabled` från alla anrop |
| `RaptControllersManagement.tsx` | Ta bort prop, läs per controller |
| `use-brew-data.ts` | Ta bort `pillCompEnabled` state + `auto_cooling_settings` realtime-kanal (rad 113-135) |
| `use-brew-page.ts` | Ta bort `pillCompEnabled` state + return |
| `Brew.tsx` | Ta bort prop |
| `use-settings-data.ts` | Ta bort `pillCompEnabled` state + `handlePillCompEnabledChange` |
| `Settings.tsx` | Ta bort globala "Dubbla temperaturgivare"-togglen |
| `CustomBrewDialog.tsx` | Ta bort `pill_compensation`-fält/toggle |
| `AutomationFeatureStatus.tsx` | Ta bort `pillCompEnabled` prop |

## Frontend — Förenkla `temp-display.ts`

`getActualTemp()` förenklas: om `controller.actual_temp` finns, returnera den. Annars fallback till pill → probe → null. Parametern `pillCompEnabled` tas bort.

## Frontend — Chartet

`useBrewChartData.ts`: Sluta beräkna `avgTemp` inline. Använd `actual_temp` från snapshot (kräver att snapshots har det). Pill och probe visas som separata sekundärlinjer (befintliga `pillTemp`/`controllerTemp`-kolumner).

## Vad som BEHÅLLS (ej ändras)

- `auto_cooling_settings.pill_compensation_enabled` kolumnen i DB (inget schema-break, slutar bara läsas)
- `brew_readings.pill_compensation` kolumnen (legacy, slutar läsas)
- PID tuning-parametrar (damping, rate_limit, max_compensation) — globala tuning-parametrar
- `dual-sensor.ts` — samma logik, anropas bara från synkmotorn

## Omfattning

- 1 migration (2 kolumner)
- ~6 backend-filer (edge functions / shared)
- ~14 frontend-filer (majoriteten prop-borttagningar)

