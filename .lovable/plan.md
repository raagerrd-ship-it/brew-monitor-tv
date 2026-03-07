

## Analys: Varför tar synken 16 sekunder?

### Problemet

Du har rätt — det borde inte ta 16 sekunder. Jag har identifierat den sannolika flaskhalsen: **intern HTTP-hoppkedja**.

`sync-rapt-data-quick` anropar `run-automation` via `supabase.functions.invoke()` (rad 741), som i sin tur anropar **4 separata edge functions** via HTTP:

```text
sync-rapt-data-quick
  ├─ RAPT auth + fetch (extern API)
  ├─ Brewfather + custom brews
  ├─ supabase.functions.invoke('run-automation')  ← HTTP-hopp #1
  │    ├─ fetch('process-fermentation-profiles')  ← HTTP-hopp #2
  │    ├─ fetch('compute-fermentation-metrics')   ← HTTP-hopp #3
  │    ├─ fetch('auto-adjust-cooling')            ← HTTP-hopp #4 (+ RAPT API)
  │    └─ fetch('system-health-check')            ← HTTP-hopp #5
  └─ Temp history + snapshots + sync freq
```

Varje internt HTTP-hopp har **cold start** (30-50ms boot + overhead). Dessutom gör `auto-adjust-cooling` ytterligare RAPT API-anrop. Det är minst **5 interna HTTP-hopp** + externa API-anrop.

Trots att minnet säger "inlina extern logik" så är `run-automation`-anropet **inte inlinat** — det är fortfarande ett fullständigt edge function-anrop som spawnar ytterligare sub-anrop.

### Dessutom: Synken verkar trasig

Inga loggar hittas för vare sig `sync-rapt-data-quick` eller `run-automation` sedan 15:45. Senaste lyckade synken var **15:45** (20+ minuter sedan). Den tidigare reverten kan ha lämnat funktionen i ett dåligt tillstånd.

### Plan

#### Steg 1: Fixa synken — lägg till tidmätning
Lägga till `Date.now()`-tidstämplar vid varje fas direkt i `sync-rapt-data-quick` (utan att ändra logik):
- `⏱️ Phase 1 (RAPT): Xms`
- `⏱️ Phase 2a (Brewfather+custom): Xms`
- `⏱️ Phase 2b (automation): Xms`
- `⏱️ Phase 2c (history+snapshots): Xms`
- `⏱️ Phase 3 (sync freq): Xms`

Trigga sedan manuellt och avläsa loggarna.

#### Steg 2: Om automation-hoppet är flaskhalsen — inlina det
Om steg 2b (automation) tar majoriteten av tiden, inlina `run-automation`-logiken direkt i `sync-rapt-data-quick` istället för att göra ett HTTP-hopp. `run-automation` gör i princip bara:
1. Kör `process-fermentation-profiles` (om running sessions)
2. Kör `compute-fermentation-metrics`
3. Kör `auto-adjust-cooling` (om aktiv)
4. Kör `system-health-check`

Dessa kan anropas direkt via `fetch()` från `sync-rapt-data-quick` utan mellansteget `run-automation`, vilket sparar 1 hopp + cold start.

### Teknisk detalj
- Inga ändringar i logik eller dataflöde
- Bara tidmätning i steg 1, sedan optimering baserat på resultatet
- Totalt antal filer: 1 (`sync-rapt-data-quick/index.ts`)

