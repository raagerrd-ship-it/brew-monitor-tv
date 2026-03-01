

## Slutgiltig robusthetsgranskning

Efter noggrann genomgång av alla synkfunktioner hittar jag **5 kvarvarande problem**:

---

### Problem 1: `sync-brew-data` är helt redundant och ooptimerad

`sync-brew-data` gör exakt samma sak som Brewfather-delen av `sync-rapt-data-quick` — men sämre:
- Anropar `brewfather-readings` via edge function (N HTTP-hopp) istället för inlinad fetch
- Gör N individuella DB-queries för existing brews istället för batch `.in()`
- Gör sekventiella snapshot-queries per brew (rad 184-191) istället för parallella

Denna funktion triggas av cron via `trigger_brew_sync()`. Men `sync-rapt-data-quick` gör redan samma jobb varje cykel.

**Fix**: Ta bort `sync-brew-data` helt och låt `trigger_brew_sync` peka på `sync-rapt-data-quick` istället (eller ta bort cron-jobbet om quick-sync redan körs oftare).

---

### Problem 2: `record-temp-history` är helt redundant

`record-temp-history` gör exakt samma sak som `tempHistoryTask` i `sync-rapt-data-quick` (rad 390-431) — identisk logik för att insertera `temp_controller_history` och `temp_delta_history`. Den gör dessutom 2 extra DB-queries som quick-sync undviker (hämtar `selected_rapt_temp_controllers` och `rapt_temp_controllers` separat).

**Fix**: Verifiera att ingen cron triggar `record-temp-history` separat. Om inte — ta bort funktionen. Om ja — peka om cronbbet till att vara en no-op eller ta bort det.

---

### Problem 3: `full-sync-brew-data` gör dubbel RAPT-auth

Step 2 anropar `sync-rapt-data` som gör `getRaptToken()` (rad 69-75). Step 3 anropar `sync-rapt-data-quick` som gör sin egen `getRaptToken()` (rad 111-112). Det blir 2 separata RAPT-autentiseringar per full sync.

**Fix**: Hämta RAPT-token en gång i `full-sync-brew-data` och skicka den som `access_token` i body till både `sync-rapt-data` och `sync-rapt-data-quick`. Båda funktionerna har redan stöd för att ta emot token via body (quick-sync gör det redan för `run-automation`).

---

### Problem 4: `sync-rapt-data` saknar stöd för passad token

`sync-rapt-data` (auto-discovery) anropar alltid `getRaptToken()` internt (rad 69). Den läser aldrig body för en passad token, till skillnad från `sync-custom-brew-pills` som har fallback-logik.

**Fix**: Lägg till body-parsing i `sync-rapt-data` för att acceptera `access_token` och bara falla tillbaka till `getRaptToken()` om ingen token skickades.

---

### Problem 5: `brewfather-batches` status-filter exkluderar Archived

Rad 70: `url.searchParams.set('status', 'Planning,Brewing,Fermenting,Conditioning,Completed')` — Archived filtreras bort. Men `full-sync-brew-data` auto-hide-logiken (rad 108, 119) hanterar Archived-status. Om en batch ändras till Archived i Brewfather kommer den aldrig att synas i synken, och auto-hide kan aldrig triggas.

**Fix**: Inkludera `Archived` i status-filtret. Auto-hide-logiken hanterar redan att dölja dem korrekt.

---

### Sammanfattning

| Problem | Typ | Effekt |
|---------|-----|--------|
| 1. sync-brew-data redundant | Kodkomplexitet + latens | Eliminerar en hel edge function |
| 2. record-temp-history redundant | Kodkomplexitet | Eliminerar en hel edge function |
| 3. Dubbel RAPT-auth i full-sync | Latens | ~1-2s besparing per full sync |
| 4. sync-rapt-data saknar token-passning | Latens | Eliminerar 1 RAPT-auth per full sync |
| 5. Archived-batches filtreras bort | Datakvalitet | Auto-hide kan triggas korrekt |

### Berörda filer
- `supabase/functions/sync-brew-data/index.ts` (problem 1: ta bort eller flagga som deprecated)
- `supabase/functions/record-temp-history/index.ts` (problem 2: ta bort eller flagga som deprecated)
- `supabase/functions/full-sync-brew-data/index.ts` (problem 3: hämta token och skicka vidare)
- `supabase/functions/sync-rapt-data/index.ts` (problem 4: acceptera passad token)
- `supabase/functions/brewfather-batches/index.ts` (problem 5: inkludera Archived)

