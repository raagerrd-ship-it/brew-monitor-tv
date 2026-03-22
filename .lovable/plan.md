

## Optimera Phase 2b: Eliminera HTTP-hopp

### Problem
Phase 2b tar ~6.5s. Tidsfördelningen:

```text
sync-rapt-data-quick
  └─ HTTP → run-automation (~1.5s overhead)
       ├─ 4× DB queries (redan hämtade i sync)  ~200ms
       ├─ HTTP → process-fermentation-profiles   ~2s (inkl ~500ms boot)
       ├─ HTTP → compute-fermentation-metrics     ~2s (inkl ~500ms boot)
       ├─ HTTP → auto-adjust-cooling              ~1.6s (inkl ~500ms boot)
       └─ HTTP → system-health-check              ~1s (inkl ~500ms boot)
       Totalt: ~5.3s intern + ~1.2s hop = ~6.5s
```

~3s av 6.5s är ren HTTP/boot-overhead (5 edge function boots à ~500ms).

### Lösning: Direkt-anropa från sync-rapt-data-quick

Skippa `run-automation` som mellanhand. Anropa de 4 sub-funktionerna direkt från `sync-rapt-data-quick` — sparar 1 HTTP-hopp + 1 boot.

Dessutom: skicka med data som redan finns i minnet via request body, så sub-funktionerna slipper redundanta DB-queries.

```text
Phase 2b (nuvarande):  sync → run-automation → 4 sub-funktioner = 5 HTTP-hopp
Phase 2b (ny):          sync → 4 sub-funktioner direkt = 4 HTTP-hopp (−1 hopp, −1s)
```

### Steg 1: Eliminera run-automation som mellanhand

Flytta logiken från `run-automation` (check what to run, parallel grouping, health notification) direkt in i `sync-rapt-data-quick` Phase 2b.

Anropa sub-funktionerna med `fetch()` direkt (istället för via `supabase.functions.invoke('run-automation')`).

### Steg 2: Skicka med redan hämtad data

Sub-funktionerna gör idag egna DB-queries för data som sync redan har i minnet:
- **process-fermentation-profiles**: hämtar `fermentation_sessions`, `rapt_temp_controllers`, `brew_readings` — sync har allt
- **compute-fermentation-metrics**: hämtar `brew_readings` — sync har det
- **auto-adjust-cooling**: hämtar controllers, settings — sync har det
- **system-health-check**: hämtar controllers, sessions — sync har det

Skicka med denna data i request body så sub-funktionerna kan skippa sina DB-reads.

### Steg 3: Parallellisera alla 4 samtidigt

`run-automation` kör idag 2+2 sekventiellt (profiles+metrics, sedan PID+health). Men profiles och PID kan köras parallellt om profiles inte behöver vara klar före PID.

**Beroenden**: `auto-adjust-cooling` behöver profile_target_temp som kan ändras av `process-fermentation-profiles`. Så profiler MÅSTE köras före PID.

Dock kan **alla 3 icke-PID** köras parallellt:
```text
Round 1 (parallellt): profiles + metrics + health-check  (~2s)
Round 2 (sekventiellt): auto-adjust-cooling               (~1.5s)
Total: ~3.5s (ner från 6.5s)
```

### Steg 4: Eliminera redundanta DB-queries i Phase 2b

De 2 queries i sync (rad 823-826) som kollar `fermentation_sessions` och `auto_cooling_settings` är redundanta — samma data hämtades redan i Phase 1 eller kan hämtas där.

Flytta dessa reads till Phase 1d (DB reads) och återanvänd i Phase 2b.

### Uppskattad förbättring

```text
Nuvarande:  ~6.5s  (5 HTTP-hopp, ~3s overhead, redundanta DB-queries)
Optimerat:  ~3.5s  (4 HTTP-hopp, ~2s overhead, inga redundanta queries)
Besparing:  ~3s per cykel (−46%)
```

### Filer

| Fil | Ändring |
|-----|---------|
| `sync-rapt-data-quick/index.ts` | Ersätt `run-automation`-anrop med direkta HTTP-anrop till 4 sub-funktioner. Flytta skip-logik + health-notification hit. Skicka med in-memory data. |
| `run-automation/index.ts` | Ingen ändring (behålls för standalone/dashboard) |

### Framtida optimering (nästa iteration)
Inlina `process-fermentation-profiles` och `system-health-check` som rena funktionsanrop (import) istället för HTTP — eliminerar 2 ytterligare boots (~1s till).

