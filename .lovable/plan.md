# BLE-sniffer: RAPT Pills via Raspberry Pi 5

## Mål
Ersätt RAPT Cloud-sync för piller helt. Pi 5 skannar BLE-advertisements från RAPT Pills och skickar till Lovable Cloud varje minut. Controllers och deras temp-reglering lämnas helt orörda.

## Infrastruktur (Cloud)

### 1. Edge-funktion: `ingest-pill-ble`
- **Auth**: `x-pi-secret` header (valideras mot `PI_BLE_INGEST_SECRET`)
- **Body**: Batch av MAC → `{mac, temp_c, gravity_sg, battery_pct, rssi, recorded_at}`
- **Logik**:
  1. Validera Zod-schema
  2. För varje MAC: slå upp i `rapt_pills.paired_device_id`
  3. Uppdatera `temperature`, `gravity`, `battery_level`, `last_update` på pill-rad
  4. Om pill har aktiv brew: insert i `brew_data_snapshots`
  5. Svar med `{processed, skipped, errors}` per batch
- **RLS**: Ingen (funktionen använder Service Role Key internt)

### 2. RAPT Cloud-sync justering
- I `sync-rapt-data-quick`: hoppa över all `hydrometer` telemetry
- Pill-data kommer uteslutande via BLE
- Controllers (temp/PID) fortsätter via RAPT API som vanligt

### 3. Secrets
- Lägg till `PI_BLE_INGEST_SECRET` (användaren får fylla i värdet)

## Pi 5-kod (`/opt/brew-ble/`)

### `ble_scanner.py`
- Python 3 + `bleak`
- Passiv BLE-scanning, filtrera på manufacturer data `0x069A` (Kegland)
- Parsa temp, gravity, battery från advertisement payload
- Skriv varje reading till SQLite `pill_readings` (med `synced=1/0` flagga)

### `uploader.py`
- Körs varje minut via systemd timer
- Hämta osynkade rader från SQLite
- Batch-POST till Cloud endpoint med `x-pi-secret`
- Markera som `synced=1` vid 200-svar
- Exponentiell backoff vid fel, max 3 försök
- Hälsopuls: skicka en "heartbeat" var 5:e min även om inga nya readings

### `schema.sql`
```sql
CREATE TABLE pill_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mac TEXT NOT NULL,
  temp_c REAL,
  gravity_sg REAL,
  battery_pct INTEGER,
  rssi INTEGER,
  recorded_at TEXT NOT NULL,
  synced INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_unsynced ON pill_readings(synced, recorded_at);
```

## Optimeringar inför drift

1. **Payload**: Pi skickar alla readings senaste minuten (batch), inte bara senaste. Cloud hanterar deduplicering per MAC+timestamp.
2. **Robusthet**: SQLite-kö med max 1000 osynkade rader. Vid Cloud-fel: retry med exponential backoff, spara lokalt.
3. **Säkerhet**: `x-pi-secret` + validera att MAC finns i `rapt_pills.paired_device_id` (reject unknown MACs).
4. **DB-volym**: `brew_data_snapshots` från BLE skriver med 1-minutupplösning. Överväg throttling (t.ex. max 1 rad/5 min per pill) om snapshot-volym blir för hög.

## Verifiering
- [ ] Pi skriver till SQLite inom 2 min
- [ ] `rapt_pills.last_update` uppdateras varje minut
- [ ] Aktiva brews får nya `brew_data_snapshots`
- [ ] `sync-rapt-data-quick` loggar visar "pill skipped"
- [ ] Edge-funktion 0 fel på 30 min

## Out of scope (separata faser)
- Controller-flöde (PID, auto-cooling, RAPT update) — oförändrat
- Lokalt UI på Pi — inte nu
- PID-loop på Pi — inte nu
- Pi ersätter controllers helt — inte nu