

## Plan: Skippa AI-audit vid viloläge

### Problem
AI-auditen körs varje full-sync-cykel oavsett om systemet är i viloläge. Det slösar resurser (API-anrop, latens) när inget aktivt behöver optimeras.

### Lösning
I `full-sync-brew-data/index.ts` (Step 4), innan AI-auditen anropas, kontrollera om systemet är i viloläge med samma logik som `sync-rapt-data-quick`:
1. Inga aktiva fermentation sessions (`status = 'running'`)
2. Kylautomation antingen av, eller kylaren redan i viloläge (`target_temp >= max_target_temp`)

Om idle → logga `AI audit skipped: system idle` och skippa anropet. Logga även en `ai_audit_log`-rad med en markering att den skippades pga viloläge, så det syns i UI:t.

### Fil som ändras

**`supabase/functions/full-sync-brew-data/index.ts`** (Step 4, rad ~314-333):
- Lägg till queries för `fermentation_sessions` (status=running) och `rapt_temp_controllers` (cooler) + `auto_cooling_settings` (enabled)
- Beräkna `systemIsIdle` med samma logik som sync-rapt-data-quick
- Om idle: logga till konsol + insert en `ai_audit_log`-rad med `analysis: 'Skipped — system idle'`, `actions_taken: []`, `parameters_changed: []` och `duration_ms: 0`
- Om inte idle: kör AI-auditen som vanligt

### UI-effekt
I AI-justeringshistoriken (skärmdumpen) kommer idle-cykler att visas som poster med "inga ändringar" och analysen "Skipped — system idle", så man ser att systemet medvetet hoppade över auditen.

