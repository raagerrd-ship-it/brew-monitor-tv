

## Phase 2b: Eliminera redundanta DB-queries via data-injection

### Nuvarande problem
Trots att vi inlinade 3 funktioner gör de fortfarande **egna DB-queries** för data som redan finns i minnet från Phase 1/2a:

```text
Phase 2b idag (~1.5-2s):
  ┌─ processAllSessions(supabase)
  │    → SELECT fermentation_sessions      (redan hämtad rad 830)
  │    → SELECT rapt_temp_controllers      (redan i controllerUpdatesForHistory)
  │    → SELECT brew_readings              (redan synkad i Phase 2a)
  │    → SELECT brew_fermentation_metrics  (unik — behövs)
  │
  ├─ computeAllMetrics(supabase)
  │    → SELECT brew_readings              (DUBLETT — samma som ovan)
  │    → SELECT brew_fermentation_metrics  (DUBLETT — samma som ovan)
  │    → SELECT temp_delta_history         (unik — behövs)
  │    → SELECT fermentation_sessions      (DUBLETT)
  │
  ├─ computeSystemHealth(...)
  │    → SELECT rapt_temp_controllers      (DUBLETT)
  │    → SELECT fermentation_sessions      (DUBLETT)
  │    → SELECT pending_notifications      (unik — behövs)
  │
  └─ brew_sg_data query (rad 873)
       → SELECT brew_readings              (DUBLETT)

Totalt: ~12 DB-queries varav ~8 är dubbletter
```

### Lösning: Injicera redan hämtad data

Utöka funktionssignaturerna med optionala parametrar för pre-fetched data. När data skickas in — skippa motsvarande DB-query.

### Steg

**1. Konsolidera brew_readings-query till en enda**
Phase 2b gör idag 3 separata queries mot `brew_readings`. Hämta en gång i början av Phase 2b och skicka in till både `processAllSessions` och `computeAllMetrics`.

**2. Utöka `processAllSessions` signatur**
```typescript
export async function processAllSessions(
  supabase, 
  opts?: { 
    sessions?: FermentationSession[];
    controllers?: any[];
  }
)
```
- Om `opts.sessions` finns → skippa `SELECT fermentation_sessions`
- Om `opts.controllers` finns → skippa `SELECT rapt_temp_controllers`
- `brew_readings` och `brew_fermentation_metrics` hämtas fortfarande (behöver specifika fält/joins)

**3. Utöka `computeAllMetrics` signatur**
```typescript
export async function computeAllMetrics(
  supabase, 
  opts?: { 
    brews?: any[];  // pre-fetched fermenting brews
  }
)
```
- Om `opts.brews` finns → skippa `SELECT brew_readings`
- `brew_fermentation_metrics`, `temp_delta_history`, `fermentation_sessions` hämtas fortfarande internt (unika behov)

**4. Eliminera health-check DB-queries**
`computeSystemHealth` är redan ren (ingen DB). Men anropet i sync gör 3 queries (rad 918-931). Ersätt med in-memory data:
- Controllers → `controllerUpdatesForHistory` (mappa till `ControllerRow`-format)
- Sessions → `activeSessCheck` (redan hämtad rad 830)
- Notifications → enda kvarvarande query (behövs)

**5. Eliminera separat `brew_sg_data`-query (rad 873)**
Bygg `brew_sg_data` från samma brew_readings som skickas till metrics. En query istället för två.

### Resultat
```text
DB-queries i Phase 2b:  12 → 4-5
  - brew_fermentation_metrics (unik)
  - temp_delta_history (unik)
  - pending_notifications (unik)
  - fermentation_profile_steps (unik, i profiles)
  - fermentation_sessions for metrics ready_to_crash (liten)
Besparing: ~200-400ms (färre DB roundtrips)
```

### Filer

| Fil | Ändring |
|-----|---------|
| `_shared/process-profiles-logic.ts` | Lägg till optional `opts` param, skippa queries om data injiceras |
| `_shared/fermentation-metrics-logic.ts` | Lägg till optional `opts` param för pre-fetched brews |
| `sync-rapt-data-quick/index.ts` | Konsolidera brew_readings query, skicka in-memory data till alla 3 funktioner, ta bort separat brew_sg_data query |

