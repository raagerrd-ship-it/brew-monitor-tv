

## Analys: RAPT API-anrop — nuläge och optimeringsmöjligheter

### Nuvarande RAPT API-anrop per cykel (5 min)

**Läsanrop (GET):**
1. `GetHydrometers` — i `sync-rapt-data-quick` (varje 5-min cykel)
2. `GetTemperatureControllers` — i `sync-rapt-data-quick` (varje 5-min cykel)
3. `GetTelemetry` — per pill med SG-data (i sync-rapt-data-quick, villkorligt)

**Skrivkommandon (POST):**
4. `SetTargetTemperature` — via `RaptUpdateBatch.flush()` (auto-adjust-cooling), batchar alla ändringar i ett enda auth-anrop
5. `SetTargetTemperature` — via `rapt-update-controller` (manuella UI-ändringar + PWM OFF)

**Auth (token):**
- 1× per cykel (cachad i DB, 60 min livslängd, 10 min proaktiv förnyelse)

### Redan implementerade optimeringar ✓
- **Token-cache** — undviker auth varje cykel
- **Token-passning** — full-sync → sync-rapt-data → sync-rapt-data-quick delar samma token
- **Batch-flush** — alla PID/cooler-ändringar körs parallellt med en enda auth
- **Early-exit i rapt-update-controller** — skippar RAPT API om hw target redan matchar (±0.05°C)
- **Concurrency guard** — förhindrar parallella synkar
- **Degraded mode** — skippar RAPT vid timeout, kör automation på cachad data

### Problem: 4 oanvända edge functions

Dessa funktioner anropas **aldrig** från klienten eller andra edge functions:
1. **`rapt-auth`** — standalone auth, ersatt av `getRaptTokenWithMeta()` + DB-cache
2. **`rapt-pills`** — standalone pills-fetch, ersatt av inlined `fetchRaptPills()` i sync
3. **`rapt-temp-controllers`** — standalone controllers-fetch, ersatt av inlined `fetchRaptControllers()`
4. **`rapt-profile-sessions`** — standalone, gör egen auth + `GetTemperatureControllers`

Dessa deployeras och tar upp resurser men genererar inga RAPT API-anrop (ingen anropar dem). De är dock dead code som bör städas bort.

### Problem: `sync-rapt-data` gör dubbla API-anrop

`sync-rapt-data` (auto-discovery, körs var 6:e timme via full-sync) hämtar **både** `GetHydrometers` och `GetTemperatureControllers` — samma data som `sync-rapt-data-quick` hämtar direkt efter. Full-sync kör dem sekventiellt:
1. `sync-rapt-data` → 2× RAPT GET
2. `sync-rapt-data-quick` → 2× RAPT GET (samma endpoints)

= **4 GET-anrop istället för 2** under full-sync.

### Problem: `rapt-update-controller` autentiserar separat

`rapt-update-controller` (manuella ändringar) gör sin egen auth mot `id.rapt.io` utan att använda token-cachen. Dock inträffar detta sällan (bara vid manuella UI-ändringar) så det är låg prioritet.

---

## Plan

### Steg 1: Ta bort 4 oanvända edge functions
Radera dessa filer — de anropas aldrig:
- `supabase/functions/rapt-auth/index.ts`
- `supabase/functions/rapt-pills/index.ts`
- `supabase/functions/rapt-temp-controllers/index.ts`
- `supabase/functions/rapt-profile-sessions/index.ts`

### Steg 2: Eliminera dubbla GET under full-sync
I `full-sync-brew-data/index.ts`: Skicka pill/controller-data från `sync-rapt-data` till `sync-rapt-data-quick` så att quick-sync kan använda den redan hämtade datan istället för att hämta igen.

**Alternativt** (enklare): Slå ihop discovery-logiken från `sync-rapt-data` direkt in i `sync-rapt-data-quick` med en `discover: true`-flagga. Då behöver full-sync bara anropa `sync-rapt-data-quick({ access_token, discover: true })` — 1 funktion, 2 GET istället för 4.

### Steg 3: Låt `rapt-update-controller` använda token-cache
Lägg till DB token-cache lookup i `rapt-update-controller` (när inget `access_token` skickas med) för att undvika onödig auth vid manuella ändringar.

### Resultat
- **Borttagning**: 4 dead edge functions → renare deploy
- **Full-sync**: 4 → 2 GET-anrop (halverat)
- **Manuella ändringar**: 1 → 0 extra auth-anrop (cachad token)
- **Normal 5-min cykel**: Oförändrad (redan optimal: 1 auth-check + 2 GET + N batched SET)

