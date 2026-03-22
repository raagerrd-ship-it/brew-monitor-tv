

## Dubbla loggar — Analys och Lösning

### Orsak

Varje 5-minuters-cykel genererar **två** separata loggrader i `auto_cooling_decision_logs`:

```text
05:45:08.561  │  auto-adjust-cooling  │  21 beslut  │  "No adjustment needed"
05:45:08.959  │  sync-rapt-data-quick │   9 beslut  │  "Synkfrekvens: 5 min"
```

Flödet: `sync-rapt-data-quick` (cron) → anropar `run-automation` → anropar `auto-adjust-cooling`.
Både `auto-adjust-cooling` och `sync-rapt-data-quick` skriver var sin rad till **samma tabell**.

### Lösning

Slå ihop loggarna till **en enda rad per cykel** genom att låta `sync-rapt-data-quick` inkludera automationsresultaten i sin egen logg istället för att båda skriver separat.

#### Ändringar

1. **`supabase/functions/auto-adjust-cooling/index.ts`** — Returnera besluten i HTTP-svaret istället för att skriva direkt till `auto_cooling_decision_logs`. Lägg till besluten i response-body under `decisions` och `final_result`.

2. **`supabase/functions/sync-rapt-data-quick/index.ts`** — Ta emot automationens beslut från `run-automation`-svaret och **merga** dem med synkbesluten (`syncDecisions`) innan den enda loggraden skrivs. Ordning: automationsbeslut först, sedan synk-/frekvensdata.

3. **`supabase/functions/run-automation/index.ts`** — Propagera `auto-adjust-cooling`s beslut uppåt i sitt eget svar så `sync-rapt-data-quick` kan nå dem.

### Resultat

- En logg per cykel istället för två
- All information (SYNC_DATA, PID, kylautomatik, frekvens) samlad i en rad
- Inga förlorade data — bara konsolidering

### Teknisk detalj

I `auto-adjust-cooling` finns redan en `flush()`-funktion (rad ~52) som skriver till DB. Denna ersätts med att returnera `{ decisions, final_result, adjustment_made, duration_ms }` i HTTP-responsen. `sync-rapt-data-quick` mergar sedan detta med sina `syncDecisions` innan sin enda insert.

