

## Inlina sub-funktioner i Phase 2b — eliminera 3 HTTP-hopp

### Problem
Phase 2b gör idag 3–4 HTTP-anrop till separata edge functions. Varje anrop kostar ~500ms boot + overhead, och alla gör redundanta DB-queries för data som sync redan har i minnet.

```text
Nuvarande Phase 2b (~3.5s):
  HTTP → process-fermentation-profiles  ~1.5s (boot + 4 DB queries)
  HTTP → compute-fermentation-metrics   ~1.5s (boot + 4 DB queries)
  HTTP → system-health-check            ~0.8s (boot + 3 DB queries)
  HTTP → auto-adjust-cooling            ~1.5s (boot + egna queries)
  ────────────────────────────────────
  ~3.5s varav ~2s är ren boot/overhead
```

### Lösning: Importera logiken direkt

Extrahera core-logiken från 3 av 4 sub-funktioner till `_shared/`-moduler. Importera och anropa dem direkt i `sync-rapt-data-quick` — noll HTTP-hopp, noll extra boot, och vi kan skicka in data vi redan har.

`auto-adjust-cooling` behålls som HTTP-anrop (för komplex + har eget standalone-bruk).

```text
Ny Phase 2b (~1.5s):
  import → processProfiles(supabase, ...)     ~200ms (bara step-logic, data finns)
  import → computeMetrics(supabase, ...)      ~300ms (bara beräkning + upsert)
  import → checkHealth(controllers, sessions) ~50ms  (ren in-memory)
  HTTP → auto-adjust-cooling                  ~1s    (behålls)
  ────────────────────────────────────
  ~1.5s (−2s, −57%)
```

### Steg

**1. `_shared/system-health-logic.ts` (ny, ~100 rader)**
- Extrahera hälsokontroll-logiken från `system-health-check/index.ts`
- Funktion: `computeSystemHealth(controllers, sessions, recentNotifs)` → `SystemHealth`
- Tar in-memory data istället för DB-queries — helt utan supabase-klient
- `system-health-check/index.ts` behålls som tunn wrapper (hämtar data + anropar logiken)

**2. `_shared/fermentation-metrics-logic.ts` (ny, ~200 rader)**
- Extrahera beräkningslogik från `compute-fermentation-metrics/index.ts`
- Funktion: `computeAllMetrics(supabase, brews?)` — accepterar optional pre-fetched brews
- Om brews skickas in: skippar DB-query för `brew_readings`
- `compute-fermentation-metrics/index.ts` behålls som tunn wrapper

**3. `_shared/process-profiles-logic.ts` (ny, ~150 rader)**
- Extrahera session-processing från `process-fermentation-profiles/index.ts`
- Funktion: `processAllSessions(supabase, sessions?, controllers?)` — accepterar optional data
- Om data skickas in: skippar fetch av sessions + controllers
- `process-fermentation-profiles/index.ts` behålls som tunn wrapper

**4. `sync-rapt-data-quick/index.ts` — Phase 2b refaktor (~40 rader ändring)**
- Ersätt 3 `callFn()` HTTP-anrop med direkta imports:
  ```typescript
  import { processAllSessions } from '../_shared/process-profiles-logic.ts'
  import { computeAllMetrics } from '../_shared/fermentation-metrics-logic.ts'
  import { computeSystemHealth } from '../_shared/system-health-logic.ts'
  ```
- Skicka in redan hämtad data (controllers, sessions, brews) direkt
- Behåll `callFn('auto-adjust-cooling', ...)` som enda HTTP-anrop
- Health-check blir synkron in-memory (notifications-query behövs fortfarande)

### Vad som behålls oförändrat
- Alla 4 standalone edge functions behålls som tunna wrappers (dashboard/manuell körning)
- `auto-adjust-cooling` förblir HTTP-anrop (komplex, eget standalone-bruk)
- `run-automation/index.ts` oförändrad (standalone fallback)

### Resultat
```text
HTTP-hopp Phase 2b:  4 → 1 (bara auto-adjust-cooling)
Boot-overhead:       ~2s → ~0.5s
DB-queries:          ~11 → ~4 (bara de som sub-funktionerna behöver utöver redan hämtad data)
Total Phase 2b:      ~3.5s → ~1.5s
```

### Filer

| Fil | Ändring |
|-----|---------|
| `_shared/system-health-logic.ts` | Ny — extraherad hälsologik |
| `_shared/fermentation-metrics-logic.ts` | Ny — extraherad metrik-beräkning |
| `_shared/process-profiles-logic.ts` | Ny — extraherad session-processing |
| `system-health-check/index.ts` | Tunn wrapper som anropar shared-logik |
| `compute-fermentation-metrics/index.ts` | Tunn wrapper som anropar shared-logik |
| `process-fermentation-profiles/index.ts` | Tunn wrapper som anropar shared-logik |
| `sync-rapt-data-quick/index.ts` | Import + direkt-anrop istället för HTTP |

