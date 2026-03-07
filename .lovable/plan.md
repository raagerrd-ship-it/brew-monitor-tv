

## Analys av fas-tider

Från de senaste loggarna:

| Tid | 1a Auth | 1b Fetch | 1c Upsert | Total |
|------|---------|----------|-----------|-------|
| 19:00 | 65ms | 2606ms | 221ms | 3.6s |
| 18:45 | **6558ms** | 1880ms | 141ms | **9.1s** |
| 18:30 | ~100ms | ~1900ms | ~200ms | 2.3s |

**Flaskhals:** 1b Fetch (RAPT API) tar konsekvent ~2s — det är extern latens vi inte kan styra. Men 1a Auth spiker till **6.5s** när token-cachen löper ut (RAPT:s auth-server är långsam).

### Optimeringar

**1. Aggressivare token-cache (störst vinst)**
Nuvarande kod förnyar token när <2 min kvar. RAPT-tokens lever typiskt 3600s. Ändra tröskeln till <10 min, så att förnyelsen sker under en cykel där token fortfarande är giltig — nästa cykel slipper vänta 6s.

**2. Parallellisera auth + DB-queries**
Just nu körs selected-devices-query (rad 244-247) *före* auth-anropet (rad 254). Genom att starta auth parallellt med DB-queries sparar vi ~50-100ms vid cache-hit, och vid cache-miss överlappas 6s auth med snabba DB-anrop.

**3. Skippa extra color-query vid pill-upsert**
Rad 293-296 gör en extra `SELECT pill_id, color` innan upsert för att bevara manuellt satta färger. Denna kan elimineras genom att använda en SQL `ON CONFLICT ... DO UPDATE SET color = CASE WHEN excluded.color != '#000000' THEN excluded.color ELSE rapt_pills.color END` — sparar en roundtrip (~30-50ms).

### Filer som ändras

- `supabase/functions/sync-rapt-data-quick/index.ts`:
  - Token-cache-tröskel 2min → 10min
  - Flytta auth-anrop till `Promise.all` med selected-devices-query
  - Ta bort extra color-query, hantera i upsert-logik

