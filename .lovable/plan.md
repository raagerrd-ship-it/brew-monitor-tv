

## Kylningshistorik-graf med kylnings-% — Plan

### Nuläge

Kylnings-% (utilization) loggas redan löpande på två ställen:
1. **`cooler_margin_history.utilization`** — sparas varje auto-cooling-cykel (ca var 5:e min) per controller
2. **`temp_controller_history.cooling_enabled`** — boolean per rad, kan räknas om till ratio per tidsbucket via RPC

Alternativ 1 (`cooler_margin_history`) ger direkt access till den redan beräknade utilization-procenten utan RPC-ändring. Alternativ 2 kräver en RPC-uppdatering men ger exaktare data per tidsbucket.

### Rekommendation

Använd **alternativ 2** (uppdatera RPC:n) — det ger jämnare data som passar bättre i en tidsgraf och matchar temperaturhistorikens tidslinje exakt. `cooler_margin_history` loggas bara vid auto-cooling-körningar och kan ha luckor.

### Ändringar

**1. DB-migrering — Utöka `get_temp_history_sampled` med `cooling_ratio`**
```sql
COUNT(*) FILTER (WHERE cooling_enabled)::NUMERIC 
  / NULLIF(COUNT(*), 0) AS cooling_ratio
```
Returnerar 0.0–1.0 per tidsbucket.

**2. `useControllerTempData.ts`**
- Lägg till `coolingPercent: number` i `ChartDataPoint`
- Mappa `record.cooling_ratio * 100` → `coolingPercent`

**3. `ControllerTempChart.tsx`**
- Sekundär Y-axel (höger, 0–100%) för kylning
- Semi-transparent blå `<Area>` med `dataKey="coolingPercent"` mot höger-axeln
- Tooltip: "Kylning: 45%"
- Legend: "Kylning %"

**4. `CombinedControllerChart.tsx`** (ny komponent)
- Toggle-knappar per controller (färgkodade) + glykolkylare (❄️)
- Visa/dölj individuella linjer i en gemensam `ComposedChart`
- Kylnings-% som blå area i bakgrunden (per controller eller summerat)

**5. Integration i `Settings.tsx`**
- Ny `SettingsSection` under Historik → "Kylning" med `Snowflake`-ikon
- Renderar `CombinedControllerChart` med alla följda controllers

### Filer som ändras
- **DB-migrering**: `get_temp_history_sampled` — lägg till `cooling_ratio`
- `src/components/controller-chart/hooks/useControllerTempData.ts` — nytt fält
- `src/components/controller-chart/ControllerTempChart.tsx` — blå area + höger Y-axel
- `src/components/controller-chart/CombinedControllerChart.tsx` — ny
- `src/components/controller-chart/hooks/useMultiControllerTempData.ts` — ny
- `src/components/controller-chart/index.ts` — exports
- `src/pages/Settings.tsx` — ny sektion

