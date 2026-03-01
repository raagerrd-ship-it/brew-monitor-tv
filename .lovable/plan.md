

## Förenklad synkarkitektur: 2 cron-jobb istället för 4+

### Nuläge

Idag finns det **4 separata synk-flöden** med individuella intervall:

1. **Brewfather snabb-synk** (`sync-brew-data`) — cron `brew-data-sync`, intervall `sync_interval`
2. **Brewfather full synk** (`full-sync-brew-data`) — cron via `trigger_full_brew_sync`, intervall `full_sync_interval`
3. **RAPT snabb-synk** (`sync-rapt-data-quick`) — cron `rapt-quick-sync`, intervall `rapt_sync_interval`
4. **RAPT full synk** (`sync-rapt-data`) — intervall `rapt_full_sync_interval`

Plus AI-audit som triggas inuti `run-automation` med en 4h cooldown.

### Ny arkitektur

**2 synk-jobb:**

```text
┌─────────────────────────────────────────────────┐
│  SNABB-SYNK (var 5:e min)                       │
│  ┌──────────────────────────────────────────┐   │
│  │ 1. RAPT pills + controllers (quick)      │   │
│  │ 2. Brewfather readings (quick)            │   │
│  │ 3. Custom brew pills                     │   │
│  │ 4. Temp history                           │   │
│  │ 5. Automation (PID, profiler, kylning)   │   │
│  └──────────────────────────────────────────┘   │
│  = Dagens sync-rapt-data-quick + sync-brew-data │
│    i ett enda anrop                              │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  FULL SYNK (var 6:e timme)                      │
│  ┌──────────────────────────────────────────┐   │
│  │ 1. Brewfather alla batchar + auto-manage │   │
│  │ 2. RAPT full (alla enheter + nya)        │   │
│  │ 3. AI-audit (om enabled)                 │   │
│  │ 4. Snabb-synk (som ovan)                 │   │
│  └──────────────────────────────────────────┘   │
│  = Dagens full-sync-brew-data + sync-rapt-data  │
│    + ai-automation-audit i ett enda anrop        │
└─────────────────────────────────────────────────┘
```

### Ändringar

#### 1. Edge function: `sync-rapt-data-quick` — Lägg till Brewfather readings
- Importera Brewfather readings-logiken (från `sync-brew-data`)
- Kör RAPT + Brewfather readings + automation parallellt
- `sync-brew-data` blir onödig men behålls för manuell trigger

#### 2. Edge function: `full-sync-brew-data` — Lägg till RAPT full + AI audit
- Anropa `sync-rapt-data` (full) istället för `sync-rapt-data-quick`
- Anropa `ai-automation-audit` explicit
- Redan idag orkestratorn — utökas

#### 3. Databas: Förenkla `sync_settings`
- Behåll bara **2 intervall-kolumner**: `quick_sync_interval` (default 300) och `full_sync_interval` (default 21600)
- Markera gamla kolumner (`sync_interval`, `rapt_sync_interval`, `rapt_full_sync_interval`) som deprecated
- Uppdatera trigger-funktionerna: `update_rapt_sync_cron_schedule` → en ny `update_sync_cron_schedules` som hanterar båda

#### 4. Cron-jobb
- **Ta bort** `brew-data-sync` cron
- **Byt namn** `rapt-quick-sync` → `quick-sync` (konceptuellt, samma jobb)
- **Lägg till/uppdatera** full-sync cron (var 6h)

#### 5. Settings UI: Förenkla frekvens-sektionen
- Ersätt 4 rader (Brewfather snabb/full + RAPT snabb/full) med **2 rader**:
  - "Snabb-synk" (RAPT + Brewfather readings) — dropdown + manuell knapp
  - "Full synk" (allt + AI) — dropdown + manuell knapp
- Behåll manuella synk-knappar
- Uppdatera `use-settings-data.ts`: ta bort separata handlers, förenkla state

#### 6. `use-settings-data.ts`
- Ta bort: `syncInterval`, `raptSyncInterval`, `raptFullSyncInterval`, `quickSyncing`, `raptQuickSyncing`, `raptSyncing`
- Lägg till: `quickSyncInterval` (ersätter båda), förenklade handlers
- `handleQuickSync` → anropar `sync-rapt-data-quick` (som nu gör allt)
- `handleFullSync` → anropar `full-sync-brew-data` (som nu gör allt)

### Filer som ändras
- `supabase/functions/sync-rapt-data-quick/index.ts` — lägg till Brewfather readings
- `supabase/functions/full-sync-brew-data/index.ts` — lägg till RAPT full + AI audit
- `src/hooks/use-settings-data.ts` — förenkla state + handlers
- `src/pages/Settings.tsx` — förenkla frekvens-UI
- Ny databasmigration — nya kolumner, nya triggers, cron-uppdatering

