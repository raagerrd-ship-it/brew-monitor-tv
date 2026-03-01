

## Robusthetsgranskning: Kvarvarande problem

Efter genomgång av alla synkfunktioner hittar jag **4 kvarvarande problem**:

---

### Problem 1: `sync-custom-brew-pills` — controller-fallback gör alltid DB-query (rad 218-234)
Trots att `allControllers` passas in från quick-sync, gör fallback-koden (rad 218-234) **alltid** en DB-query mot `rapt_temp_controllers` — även när `ctrlFromMemory` redan finns. Båda if/else-grenarna gör exakt samma query. Den passade datan har dock bara `controller_id`, `linked_pill_id`, `pill_temp` — inte `current_temp`, `target_temp`, `profile_target_temp` som behövs för snapshots.

**Fix**: Passa med fler fält från quick-sync (`current_temp`, `target_temp`, `profile_target_temp`) i `controllerDataForCustomBrews`, och använd dem direkt i fallbacken utan DB-query.

---

### Problem 2: `sync-rapt-data` (full) duplicerar data-upserts som quick-sync redan gör
`full-sync-brew-data` anropar `sync-rapt-data` (Step 2) som gör full pill+controller upsert, och sedan `sync-rapt-data-quick` (Step 3) som gör exakt samma upsert igen. Alla pills och controllers skrivs till DB **två gånger**.

**Fix**: `sync-rapt-data` bör **enbart** göra auto-discovery (hitta nya pills/controllers och lägga till dem i `selected_rapt_pills`/`selected_rapt_temp_controllers`). Ta bort pill/controller upsert-logiken (rad 111-192) — den är redundant med quick-sync.

---

### Problem 3: `full-sync-brew-data` gör onödig `selected_brews` query (rad 139-140)
Rad 139 hämtar alla synliga brews igen, trots att auto-manage-blocket (rad 83-136) redan vet exakt vilka brews som ska vara synliga. Resultatet kan byggas från `batchesData` + `toShow`/`toInsert`-listorna.

**Fix**: Bygg `selectedBrews`-listan direkt från det befintliga statet istället för en ny DB-query.

---

### Problem 4: `brewfather-batches` ignorerar `complete: true` parameter (rad 68)
`full-sync-brew-data` skickar `{ complete: true }` (rad 70) men `brewfather-batches` har hårdkodat `complete: false` (rad 68). Resultatet är att `measuredOg`, `measuredFg` och andra detaljfält saknas — batch-detaljerna är ofullständiga.

**Fix**: Respektera den inskickade `complete`-parametern i `brewfather-batches` istället för att hårdkoda `false`.

---

### Sammanfattning

| Problem | Typ | Besparing |
|---------|-----|-----------|
| 1. Controller-fallback DB-query | Latens | 1 DB-query per offline-pill brew |
| 2. Dubbel pill/controller upsert | Latens + DB-belastning | N upserts eliminerade |
| 3. Onödig selected_brews query | Latens | 1 DB-query eliminerad |
| 4. complete-param ignoreras | Datakvalitet | Korrekta OG/FG-värden |

### Berörda filer
- `supabase/functions/sync-rapt-data-quick/index.ts` (problem 1: utöka passad data)
- `supabase/functions/sync-custom-brew-pills/index.ts` (problem 1: eliminera DB-query)
- `supabase/functions/sync-rapt-data/index.ts` (problem 2: strip till enbart discovery)
- `supabase/functions/full-sync-brew-data/index.ts` (problem 3: eliminera extra query)
- `supabase/functions/brewfather-batches/index.ts` (problem 4: respektera complete-param)

