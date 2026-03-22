

## 3-fas-arkitektur med minimala API-anrop

### Nuvarande externa API-anrop per cykel

| # | Anrop | Typ | Var |
|---|-------|-----|-----|
| 1 | `id.rapt.io/connect/token` | Auth | Fas 1a (cachat, sällan) |
| 2 | `GetHydrometers` | RAPT Read | Fas 1b |
| 3 | `GetTempControllers` | RAPT Read | Fas 1b |
| 4 | `GetTelemetry` × N | RAPT Read | Fas 2a (redan eliminerat via quick-append) |
| 5 | Auth igen i `flush()` | Auth | auto-adjust-cooling |
| 6 | `SetTargetTemperature` × N | RAPT Write | auto-adjust-cooling |
| 7–10 | 4 interna HTTP-hopp | Edge Functions | run-automation → process-fermentation-profiles, compute-fermentation-metrics, auto-adjust-cooling, system-health-check |

### Mål: 1 Fetch + 1 Send

```text
Fas 1: HÄMTA
  - Auth (cached) + GetHydrometers + GetTempControllers  → 1 RAPT-interaktion
  - DB-reads (sync_settings, auto_cooling_settings, etc.)

Fas 2: ANALYSERA (inga externa anrop)
  - Upsert RAPT-data till DB
  - Quick-append bryggdata
  - Automation: fermentation profiles + metrics + PID/glykol (allt inlinat, dryRun)

Fas 3: EXEKVERA
  - RaptUpdateBatch.flush() med pre-auth token  → 1 RAPT-interaktion
  - Temp history, snapshots, outage, logg
```

### Ändringar

**1. `auto-adjust-cooling/index.ts` — dryRun-stöd (~15 rader)**
- Läs `dryRun` från request body (default `false`)
- Om `dryRun: true`: hoppa över `updateBatch.flush()` och allt efter (rad 522–640). Returnera istället `{ pendingUpdates, hwOnlyIds, decisionLog, adjustments }` utan att skicka till RAPT
- Om `dryRun: false`: befintligt beteende — standalone-kompatibelt

**2. `_shared/temp-utils.ts` — exponera batch-data (~10 rader)**
- `getPendingUpdates()` → returnerar `{ controllerId, targetTemp, oldTarget }[]`
- `getHwOnlyIds()` → returnerar `string[]`
- Alternativt: auto-adjust-cooling returnerar dessa direkt i response (enklare)

**3. `sync-rapt-data-quick/index.ts` — 3-fas-omstrukturering (~80 rader)**

**Fas 1: HÄMTA** (befintlig 1a+1b + flytta DB-reads hit)
- Ingen ändring förutom att samla alla DB-reads (sync_settings, auto_cooling_settings, fermentation_sessions) redan här
- Eliminerar de redundanta DB-reads före Phase 2b (rad 819–838)

**Fas 2: ANALYSERA** (befintlig 1c-upsert + 2a-brew + 2b-automation utan flush)
- Flytta upsert hit (redan i 1c, bara byt fas-etikett)
- Quick-append (redan implementerat)
- Inlina `run-automation`-logiken direkt:
  - Anropa `process-fermentation-profiles` + `compute-fermentation-metrics` parallellt (behåll som edge function-anrop, dessa är interna utan RAPT)
  - Anropa `auto-adjust-cooling` med `dryRun: true` + `rapt_access_token` + `brew_sg_data`
  - Ta emot `pendingUpdates` + `hwOnlyIds` i response
  - Anropa `system-health-check` parallellt (intern, ingen RAPT)

**Fas 3: EXEKVERA** (ny fas)
- Skapa `RaptUpdateBatch` med `access_token` från Fas 1
- Populera med `pendingUpdates` från dryRun-response
- Markera `hwOnlyIds` som hardware-only
- `await batch.flush()` — **den enda RAPT-send per cykel**
- Hantera retry-logik (pending_rapt_retries) — flytta från auto-adjust-cooling
- Persist target_temp till DB (flytta från auto-adjust-cooling)
- Temp history + delta history
- Brew snapshots
- Outage detection
- Dynamic sync frequency
- Decision log (merged sync + automation)

**4. `run-automation/index.ts` — vidarebefordra dryRun (~3 rader)**
- Skicka `dryRun` vidare till auto-adjust-cooling-anropet
- Behåll som standalone fallback

**5. Uppdatera PHASE_TIMINGS i logg-entry**
```text
1_fetch_ms:    auth + RAPT API + DB reads
2_process_ms:  upsert + brew sync + automation (dry-run)
3_execute_ms:  RAPT flush + history + snapshots + outage + freq + logg
```

**6. `AutoCoolingDecisionLogs.tsx` — uppdatera fas-rubriker (~5 rader)**

### Resultat

```text
Externa RAPT-anrop:  10+ → 2 (1 fetch + 1 send)
Interna HTTP-hopp:   4 → 3 (process-fermentation-profiles + compute-fermentation-metrics + auto-adjust-cooling)
                     (system-health-check kan köras parallellt)
Redundanta DB-reads: ~6 → 0
```

### Risker
- `auto-adjust-cooling` flush-logik (retry, cleanup, DB-persist) måste dupliceras i sync-rapt-data-quick Fas 3 — alternativt returnera tillräcklig data från dryRun för att köra det i sync
- Befintliga standalone-anrop till `auto-adjust-cooling` (via dashboard-knapp) fungerar som innan (dryRun defaults false)

### Filer

| Fil | Ändring |
|-----|---------|
| `supabase/functions/auto-adjust-cooling/index.ts` | dryRun-stöd, returnera pendingUpdates |
| `supabase/functions/_shared/temp-utils.ts` | getPendingUpdates(), getHwOnlyIds() |
| `supabase/functions/sync-rapt-data-quick/index.ts` | 3-fas-omstrukturering, inlina run-automation, flush i Fas 3 |
| `supabase/functions/run-automation/index.ts` | Vidarebefordra dryRun |
| `src/components/AutoCoolingDecisionLogs.tsx` | Fas-rubriker |

