

## Robusthetsgranskning: Kvarvarande problem

Efter genomgång av hela synkkedjan identifieras **6 kvarvarande robusthets- och effektivitetsproblem**.

---

### Problem 1: Saknade timeouts på RAPT API-anrop (quick-sync)
`fetchRaptPills` och `fetchRaptControllers` i `sync-rapt-data-quick` saknar `AbortSignal.timeout`. Om RAPT Cloud hänger sig blockeras hela synkcykeln på obestämd tid.

**Fix**: Lägg till `signal: AbortSignal.timeout(15000)` på båda fetch-anropen (rad 42-46, 51-55).

---

### Problem 2: `sync-rapt-data` (full) är ooptimerad
Denna funktion (anropas av `full-sync-brew-data` Step 2) gör:
- 3 sekventiella edge-function-anrop (`rapt-auth`, `rapt-pills`, `rapt-temp-controllers`) istället för inlinade fetcher
- Sekventiella per-controller DB-uppdateringar (select + update/insert loop) istället för batch-upsert
- Sekventiella queries för `fermentation_sessions` och `auto_cooling_settings`

**Fix**: Refaktorera till samma mönster som quick-sync: inlinade API-anrop, `Promise.all` för DB-queries, batch-upsert.

---

### Problem 3: `full-sync-brew-data` anropar Brewfather via edge functions (N extra HTTP-hopp)
Rad 138-143: Varje brew anropar `brewfather-readings` som en separat edge-function-invokation. Quick-sync löste detta genom att inlina fetchen. Full-sync bör göra samma sak.

**Fix**: Inlina Brewfather-readings-fetchen direkt i `full-sync-brew-data` istället för att gå via edge function.

---

### Problem 4: `full-sync-brew-data` hämtar batches två gånger
- Rad 52: Hämtar alla batches (för auto-manage)
- Rad 132-134: Hämtar samma batches igen med `batchIds` (för detaljer)

**Fix**: Återanvänd data från första anropet. Om `complete: true` behövs för detaljer, gör bara ett enda anrop med `complete: true` och använd det för båda syftena.

---

### Problem 5: `sync-custom-brew-pills` — sekventiell controller-fallback per brew
Rad 213-255: När en pill är offline görs en individuell DB-query per brew för controller-data, trots att all controller-data redan finns i `allControllers`. Dessutom görs enskilda DB-inserts för varje snapshot.

**Fix**: Slå upp controller-data från den redan hämtade `allControllers`-arrayen istället för att querien DB:n. Batcha snapshot-inserts.

---

### Problem 6: `sync-rapt-data` (full) är delvis redundant med quick-sync
`full-sync-brew-data` anropar först `sync-rapt-data` (Step 2) och sedan `sync-rapt-data-quick` (Step 3). Båda hämtar RAPT-data från API:et och uppdaterar samma tabeller. Den enda unika funktionen i full-sync är auto-discovery av nya controllers/pills.

**Fix**: Extrahera enbart auto-discovery-logiken (auto-add till `selected_rapt_pills`/`selected_rapt_temp_controllers`) och kör den inline i `full-sync-brew-data`. Ta bort det separata `sync-rapt-data`-anropet, eftersom quick-sync redan hanterar all data-uppdatering.

---

### Sammanfattning av effekt

| Problem | Typ | Besparing |
|---------|-----|-----------|
| 1. Saknade timeouts | Stabilitet | Förhindrar oändlig blockering |
| 2. sync-rapt-data ooptimerad | Latens | ~3-5 sekventiella HTTP-hopp eliminerade |
| 3. Brewfather via edge fn | Latens + stabilitet | N extra HTTP-hopp per brew |
| 4. Dubbla batch-hämtningar | Latens | 1 extern API-anrop eliminerat |
| 5. Sekventiell fallback | Latens | N DB-queries eliminerade |
| 6. Redundant full RAPT sync | Latens + stabilitet | 1 komplett RAPT-cykel eliminerad |

### Teknisk detalj

Alla ändringar berör enbart edge functions:
- `supabase/functions/sync-rapt-data-quick/index.ts` (problem 1)
- `supabase/functions/sync-rapt-data/index.ts` (problem 2, 6)
- `supabase/functions/full-sync-brew-data/index.ts` (problem 3, 4, 6)
- `supabase/functions/sync-custom-brew-pills/index.ts` (problem 5)

