

## Analys

Användaren har helt rätt. Flödet idag:

1. `sync-rapt-data-quick` hämtar all pill-telemetri (SG, temp) från RAPT API och skriver till `brew_readings`
2. `run-automation` → `auto-adjust-cooling` gör sedan en **egen DB-query** mot `brew_readings` + `brew_fermentation_metrics` bara för att logga `BREW_SG_STATUS`

Detta skapar en onödig extra synkkanal — automations-funktionen borde få SG-data skickad till sig från orkestratorn, precis som `rapt_access_token` redan gör.

## Plan

### 1. Skicka brew-data från orkestratorn till automation

**`sync-rapt-data-quick/index.ts`**: Samla ihop en `brew_sg_map` (controller_id → { name, current_sg, og, fg, attenuation, temp, battery, status, last_update }) från den data som redan processats under synken. Skicka med i `run-automation` body.

**`run-automation/index.ts`**: Vidarebefordra `brew_sg_data` till `auto-adjust-cooling`-anropet.

### 2. Konsumera passad data i auto-adjust-cooling

**`auto-adjust-cooling/index.ts`**: Ta emot `brew_sg_data` från request body. Om den finns, använd den direkt istället för att göra egna DB-queries mot `brew_readings`. Behåll fallback-queryn om data saknas (för manuella anrop / debugging).

Fermentation metrics (`brew_fermentation_metrics`) hämtas dock separat eftersom de beräknas av `compute-fermentation-metrics` som körs som en del av automationen — de finns inte tillgängliga i synk-fasen. Alternativet är att flytta metrics-queryn till en fallback eller att inkludera metrics i det som skickas om de redan beräknats vid det laget.

### 3. Behåll metrics-query som DB-lookup

Eftersom `compute-fermentation-metrics` körs i `run-automation` **före** `auto-adjust-cooling`, har metrics redan uppdaterats i DB:n. Det enklaste är att behålla den lilla DB-queryn mot `brew_fermentation_metrics` (den är billig) men eliminera den tunga `brew_readings`-queryn.

### Sammanfattning av dataflöde efter ändringen

```text
RAPT API → sync-rapt-data-quick (hämtar & skriver brew_readings)
                ↓ brew_sg_data (passas via body)
          run-automation
                ↓ brew_sg_data (vidarebefordras)
          auto-adjust-cooling
                ├── brew_sg_data (från body, ingen extra DB-query)
                ├── brew_fermentation_metrics (DB, redan uppdaterad)
                └── BREW_SG_STATUS logg-entry
```

### Filer som ändras

- `supabase/functions/sync-rapt-data-quick/index.ts` — samla och skicka brew-data
- `supabase/functions/run-automation/index.ts` — vidarebefordra brew_sg_data
- `supabase/functions/auto-adjust-cooling/index.ts` — konsumera passad data, fallback till DB

