## Synkarkitektur: 2 cron-jobb (IMPLEMENTERAD)

### Arkitektur

**2 synk-jobb:**

- **Snabb-synk** (`sync-rapt-data-quick`, cron `rapt-quick-sync`, default var 5:e min)
  - RAPT pills + controllers (quick)
  - Brewfather readings (quick)
  - Custom brew pills
  - Temp history
  - Automation (PID, profiler, kylning)

- **Full synk** (`full-sync-brew-data`, cron `full-brew-sync`, default var 6:e timme)
  - Brewfather alla batchar + auto-manage
  - RAPT full (alla enheter + nya)
  - AI-audit (om enabled)
  - Snabb-synk (som ovan)

### Implementerade ändringar

1. `sync-rapt-data-quick` — inkluderar nu Brewfather readings
2. `full-sync-brew-data` — inkluderar nu RAPT full + AI audit + quick sync pass
3. `use-settings-data.ts` — förenklad till `quickSyncInterval` + `fullSyncInterval`
4. `Settings.tsx` — 2 rader istället för 4 i frekvens-sektionen
5. DB-migration — borttagen `brew-data-sync` cron, ny `full-brew-sync` cron, uppdaterad trigger
