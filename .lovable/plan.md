

## Kvarvarande ineffektivitet i Phase 2b

Koden är **bra** — arkitekturen med inlinad logik + data-injection är sund. Men det finns fortfarande **2 redundanta DB-queries** som slank igenom:

### Problem 1: `brew_readings` querias dubbelt
- **Orchestratorn** hämtar `allFermentingBrews` (rad 871) med alla fält inklusive `id, sg_data, original_gravity, final_gravity`
- **processAllSessions** hämtar SAMMA data igen (rad 145-147): `brew_readings.select('id, sg_data, original_gravity, final_gravity').in('id', brewIds)`
- Lösning: Lägg till `brewReadings?: any[]` i `ProcessSessionsOpts`, injicera `allFermentingBrews`

### Problem 2: `brew_fermentation_metrics` querias dubbelt
- **Orchestratorn** hämtar `sharedBrewMetrics` (rad 894) med `peak_delta, peak_sg_rate_per_hour`
- **computeAllMetrics** hämtar SAMMA tabell igen (rad 128-131) för peak-värden
- Lösning: Lägg till `existingMetrics?: any[]` i `ComputeMetricsOpts`, injicera `sharedBrewMetrics`

### Steg

**1. `_shared/process-profiles-logic.ts`**
- Utöka `ProcessSessionsOpts` med `brewReadings?: any[]`
- Om injicerat: skippa `brew_readings`-query (rad 145-147), bygg `brewDataMap` från injicerad data istället

**2. `_shared/fermentation-metrics-logic.ts`**
- Utöka `ComputeMetricsOpts` med `existingMetrics?: any[]`
- Om injicerat: skippa `brew_fermentation_metrics`-query (rad 128-131), bygg `existingPeakMap` från injicerad data

**3. `sync-rapt-data-quick/index.ts`**
- Skicka `brewReadings: allFermentingBrews` till `processAllSessions`
- Skicka `existingMetrics: sharedBrewMetrics` till `computeAllMetrics`

### Resultat

```text
Redundanta queries i Phase 2b:  2 → 0
Unika queries som kvarstår (korrekta):
  - fermentation_profile_steps (processAllSessions — unik)
  - temp_delta_history (computeAllMetrics — unik)
  - pending_notifications (health — unik)
  - pending_rapt_retries (auto-adjust-cooling — unik)
  - auto_cooling_adjustments (auto-adjust-cooling — unik)
  - fermentation_step_log (auto-adjust-cooling cooloff — unik)
  - fermentation_profile_steps (auto-adjust-cooling — DUBLETT med profiles, men i separat HTTP-process)
```

Den sista dubbletten (`fermentation_profile_steps` i auto-adjust-cooling) kan inte elimineras utan att inlina auto-adjust-cooling helt — inte värt risken.

### Filer

| Fil | Ändring |
|-----|---------|
| `_shared/process-profiles-logic.ts` | Lägg till `brewReadings?` i opts, skippa query |
| `_shared/fermentation-metrics-logic.ts` | Lägg till `existingMetrics?` i opts, skippa query |
| `sync-rapt-data-quick/index.ts` | Injicera `brewReadings` + `existingMetrics` |

