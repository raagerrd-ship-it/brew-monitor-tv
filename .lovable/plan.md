

## ✅ 3-fas-arkitektur — Implementerad

### Fas 1: HÄMTA (1 RAPT-interaktion)
- Auth (cached) + GetHydrometers + GetTempControllers
- DB upsert av pills + controllers

### Fas 2: ANALYSERA (inga externa anrop)
- Brewfather + custom brew sync (quick-append)
- Automation med `dryRun: true` → returnerar `pendingUpdates`

### Fas 3: EXEKVERA (1 RAPT-interaktion)
- `RaptUpdateBatch.flush()` med pre-auth token
- Retry-hantering + DB-persist
- Temp history + delta history + snapshots
- Outage detection + sync frequency + decision log

### Ändrade filer
- `auto-adjust-cooling/index.ts` — dryRun-stöd
- `run-automation/index.ts` — vidarebefordrar dryRun + pendingUpdates
- `_shared/temp-utils.ts` — getPendingUpdates(), getHwOnlyIds()
- `sync-rapt-data-quick/index.ts` — 3-fas-omstrukturering
- `AutoCoolingDecisionLogs.tsx` — uppdaterade fas-etiketter
