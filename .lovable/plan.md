

## Analys: Var går tiden i synk-cykeln?

Jag har gått igenom hela kedjan och hittat **3 konkreta optimeringar** som tillsammans kan spara **4-6 sekunder** per cykel utan att röra SSOT-ordningen.

### Problem 1: Onödig HTTP-overhead för enkla API-proxys

`sync-rapt-data-quick` anropar dessa via `functions.invoke` (varje = cold start + HTTP round trip):
- `rapt-auth` — bara en `fetch` till RAPT token endpoint
- `rapt-pills` — bara en `fetch` till RAPT API
- `rapt-temp-controllers` — bara en `fetch` till RAPT API
- `brewfather-readings` (per brew) — bara en `fetch` till Brewfather API
- `record-temp-history` — bara DB-läsning + insert

Varje invoke kostar ~0.5-1.5s i overhead. Genom att **inlina dessa direkta API-anrop och DB-operationer** sparar vi 5 HTTP-hopp = **~3-5s**.

### Problem 2: Duplicerad RAPT-autentisering

`sync-custom-brew-pills` anropar `rapt-auth` **en gång till** för att hämta sin egen access_token — trots att `sync-rapt-data-quick` redan har en giltig token. Genom att skicka med `access_token` i body sparar vi ytterligare **~1s**.

### Problem 3: Sekventiella pill-uppdateringar

Pills uppdateras en-och-en i en `for`-loop med individuella `update`-anrop (rad 86-94). Controllers använder redan batch-upsert. Samma mönster borde gälla pills.

### Plan

#### 1. Inlina RAPT API-anrop direkt i `sync-rapt-data-quick`
Ersätt `functions.invoke('rapt-auth')`, `functions.invoke('rapt-pills')`, `functions.invoke('rapt-temp-controllers')` med direkta `fetch`-anrop till RAPT API:erna. Sparar 3 HTTP-hopp.

#### 2. Inlina Brewfather readings
Ersätt `functions.invoke('brewfather-readings', ...)` per brew med direkt `fetch` till Brewfather API. Sparar 1 HTTP-hopp per brew.

#### 3. Inlina record-temp-history
Flytta DB-logiken (läs controllers + insert history + delta) direkt in i slutet av `sync-rapt-data-quick`. Sparar 1 HTTP-hopp.

#### 4. Skicka access_token till sync-custom-brew-pills
Ändra invoke-anropet: `{ body: { access_token } }`. Uppdatera `sync-custom-brew-pills` att använda medskickad token istället för att anropa `rapt-auth` igen.

#### 5. Batch-upsert för pills
Ersätt `for`-loopen med en enda `upsert`-operation, samma mönster som controllers redan använder.

#### 6. Förenkla timestamp-uppdatering
Ersätt 2-stegs select+update (rad 24-30) med en enda `update`-query utan WHERE på id (det finns bara en rad).

### Filer som ändras
- `supabase/functions/sync-rapt-data-quick/index.ts` — inlina allt ovan
- `supabase/functions/sync-custom-brew-pills/index.ts` — acceptera access_token i body

### Vad som INTE ändras
- Alla separata funktioner (`rapt-auth`, `rapt-pills`, `brewfather-readings`, `record-temp-history`) **behålls** — de används fortfarande från UI och andra flöden
- SSOT-ordningen (data → automation → historik) rörs inte
- `run-automation` behålls som invoke (komplex orkestrering, motiverat som separat)

### Uppskattad tidsbesparing
~4-6 sekunder per cykel (från ~12-15s ner till ~7-9s).

