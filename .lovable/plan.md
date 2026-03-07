

## Analys: Dubbla synkar och felaktiga varningstrianglar

### Problem 1: Dubbla synkar vid 17:25

Databasloggen visar två poster:
- **17:25:02** — 4351ms
- **17:25:20** — 2276ms

Cron-jobbet (`*/15 * * * *`) avfyrades vid 17:25:00. Den andra posten (18 sekunder senare) var sannolikt en **manuell synk** (knappen i Settings) som råkade sammanfalla med cron. Det finns ingen bugg — bara en tillfällig överlappning.

**Åtgärd:** Lägg till en **concurrency guard** i `sync-rapt-data-quick` som kontrollerar om en annan synk pågår (t.ex. via en `sync_lock`-rad i databasen med timestamp). Om en synk körts inom de senaste 30 sekunderna, skippa den nya. Detta förhindrar dubbletter oavsett om de utlöses av cron + manuell eller cron + cron.

### Problem 2: Varningstrianglar trots nyliga timestamps

**Rotorsak:** Staleness-checken i `AutoCoolingDecisionLogs.tsx` jämför pillens `last_update_raw` mot `Date.now()`:

```typescript
Date.now() - new Date(pillLu).getTime() > 30 * 60 * 1000
```

Men `last_update_raw` är pillens timestamp **vid synktillfället**. När du tittar på loggen 38 minuter senare (18:03 vs 17:25) har det passerat >30 minuter → alla pills ser "stale" ut, trots att de var färska vid synktillfället.

**Åtgärd:** Jämför pillens timestamp mot **loggens `created_at`** istället för `Date.now()`. Loggens `created_at` finns redan tillgänglig i renderingsloopen. Staleness-checken blir:

```typescript
// Pill var stale vid synktillfället om den inte rapporterat 
// på 30+ min RELATIVT TILL loggens tidpunkt
logCreatedAt - pillDate > 30 * 60 * 1000
```

Samma fix behövs på **två ställen**:
1. Pill-kolumnen i controller-raden (rad ~1057)
2. Pill-subraden med SG-data (rad ~1195-1201)

### Implementationsplan

1. **Concurrency guard i `sync-rapt-data-quick`** — Kolla senaste loggens `created_at` i `auto_cooling_decision_logs`. Om <30s sedan, returnera tidigt med `{ skipped: 'concurrent' }`.

2. **Fixa staleness-jämförelse i `AutoCoolingDecisionLogs.tsx`** — Skicka loggens `created_at` till staleness-beräkningen och jämför mot den istället för `Date.now()`. Gäller båda pill-raderna i SYNK-DATA-tabellen.

