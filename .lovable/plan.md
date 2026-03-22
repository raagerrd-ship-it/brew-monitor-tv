

## Analys: Är Phase 2b optimal nu?

### Nuvarande arkitektur (efter refaktor)

```text
Phase 2b (~1.5-2s):
  ┌─ fermentation_sessions query (line 830)         ~30ms
  ├─ brew_readings consolidated query (line 871)     ~50ms
  │
  ├─ [PARALLEL, inlined]
  │   ├─ processAllSessions(supabase, {sessions, controllers})
  │   │     → fermentation_profile_steps             ~30ms (unik, behövs)
  │   │     → brew_readings (by brew_id)             ~30ms ← DUBLETT
  │   │     → brew_fermentation_metrics              ~30ms ← DUBLETT
  │   │
  │   ├─ computeAllMetrics(supabase, {brews})
  │   │     → brew_fermentation_metrics              ~30ms ← DUBLETT (samma som ovan)
  │   │     → temp_delta_history                     ~30ms (unik, behövs)
  │   │     → fermentation_sessions                  ~30ms ← DUBLETT (redan hämtad line 830)
  │   │
  │   └─ computeSystemHealth (in-memory)
  │         → pending_notifications                  ~20ms (unik, behövs)
  │
  └─ [SEQUENTIAL, HTTP hop]
      └─ auto-adjust-cooling (~1-1.5s)
            → auto_cooling_settings                  ← DUBLETT (har i autoCoolingRow)
            → rapt_temp_controllers                  ← DUBLETT (har i controllerUpdatesForHistory)
            → pending_rapt_retries                   ~20ms (unik)
            → auto_cooling_adjustments               ~30ms (unik)
            → fermentation_sessions                  ← DUBLETT (har från line 830)
            → fermentation_step_log                  ~20ms (unik, cooloff)
            → fermentation_profile_steps             ← DUBLETT (redan i profiles)
            → fermentation_sessions (idle check)     ← DUBLETT
            → brew_fermentation_metrics              ← DUBLETT
            ────────────────────────────────────────
            ~500ms boot + ~200ms redundanta queries
```

**Kvarstående problem:**
1. **4 redundanta queries** i profiles+metrics (brew_fermentation_metrics ×2, brew_readings, fermentation_sessions)
2. **~5 redundanta queries** i auto-adjust-cooling (controllers, settings, sessions, profile_steps, metrics)
3. **1 HTTP-hopp** till auto-adjust-cooling (~500ms boot overhead)

### Vad som kan göras bättre

**Nivå 1 — Lågt hängande frukt (−200ms, låg risk):**
- Skicka `brew_fermentation_metrics` och `fermentation_sessions` som opts till processAllSessions + computeAllMetrics
- Query dessa en gång i sync, injicera till båda

**Nivå 2 — Inlina auto-adjust-cooling (−1s, medel risk):**
Core-logiken ligger redan i `_shared/controller-adjustments.ts` (533 rader) och `_shared/cooler-management.ts` (1245 rader). Edge-funktionen (686 rader) är mest kontext-uppbyggnad och loggning.

Extrahera kontext-bygget till `_shared/auto-cooling-logic.ts` → eliminerar sista HTTP-hoppet + ~5 redundanta queries.

**Men**: auto-adjust-cooling har komplex retry-logik, stale-sensor-hantering, och eget standalone-bruk. Att inlina allt ökar risk för regressions.

### Rekommendation: Nivå 1 + partiell Nivå 2

Injicera mer data till auto-adjust-cooling via request body istället för att inlina. Funktionen tar redan emot `brew_sg_data` och `rapt_access_token` — utöka med:
- `controllers` (eliminerar SELECT rapt_temp_controllers)
- `settings` (eliminerar SELECT auto_cooling_settings)  
- `sessions` (eliminerar 2× SELECT fermentation_sessions)

Samtidigt: fixa de 4 redundanta queries i profiles+metrics.

### Steg

**1. Dela brew_fermentation_metrics + sessions mellan profiles/metrics**
Query `brew_fermentation_metrics` en gång i sync, injicera till både `processAllSessions` och `computeAllMetrics` via utökade opts.

**2. Injicera data till auto-adjust-cooling via request body**
Skicka controllers, settings och sessions i request body. auto-adjust-cooling skippar sina egna queries om data finns i body.

### Resultat

```text
Nuvarande:  ~1.5-2s (1 HTTP-hopp, ~9 redundanta queries)
Optimerat:  ~0.8-1.2s (1 HTTP-hopp kvar men −500ms via eliminerade queries)
Kvarvarande HTTP-hopp: auto-adjust-cooling (~500ms boot — kan inlinas i framtida iteration)
```

### Filer

| Fil | Ändring |
|-----|---------|
| `_shared/process-profiles-logic.ts` | Utöka opts med `brewMetrics?` — skippa query |
| `_shared/fermentation-metrics-logic.ts` | Utöka opts med `sessions?` — skippa query |
| `auto-adjust-cooling/index.ts` | Acceptera `controllers`, `settings`, `sessions` i request body — skippa egna queries |
| `sync-rapt-data-quick/index.ts` | Query brew_fermentation_metrics en gång, injicera till alla. Skicka controllers+settings+sessions till auto-adjust-cooling |

