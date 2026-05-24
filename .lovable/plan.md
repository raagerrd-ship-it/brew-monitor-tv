## Rot-orsak

`rapt_pills.paired_device_id` används för **två olika saker** med inkompatibla format:

1. **`sync-rapt-data-quick`** skriver RAPT-API:ets `pairedDeviceId` dit — vilket är **temp-controllerns UUID** (`6fbbc7db-cc77-49c8-be48-4f07ebb6ff5d` för Mjöd/Green osv).
2. **`ingest-pill-ble`** läser samma fält och förväntar sig **BLE MAC-adress** (`64b7085612ee`, `fce8c0b21db6`, `fce8c0b2141a`).

Diagnostik-querysvar (vad edge faktiskt ser nu):

```
pill                                       db_normalized
2ba750b6...  618b29b0fa024f27a8f1a215f44235b3
0b88d442...  6fbbc7dbcc7749c8be484f07ebb6ff5d  ← Green/Mjöd controller UUID
04cfce6d...  ffa62be4d6f7453383b457ad93c3ac01  ← Blå/Skogens Sus controller UUID
```

Inga MAC:s. Därför `skipped: 3`.

**Varför ~21:10?** Det var inte en kodändring i `ingest-pill-ble` (normMac är oförändrad). Det var en `sync-rapt-data-quick`-körning som skrev över `paired_device_id` med RAPT-controller-UUID:erna. `batches: 3` är bara ett nytt log-fält jag la till i förra ronden — inget funktionellt.

Tidigare körningar (`processed: 3`) fungerade förmodligen för att fältet manuellt eller tillfälligt hade MAC:s; nästa RAPT-sync skrev över.

## Fix

Separera fälten. Ny dedikerad kolumn för BLE MAC, rör inte `paired_device_id`.

### 1. Migration
- `ALTER TABLE rapt_pills ADD COLUMN bluetooth_mac text;` (nullable, unique partial index där not null)
- Engångs-seed för de tre kända pillen:
  - `2ba750b6-3efe-4a46-9c97-2a1ddbdfaf16` → `64b7085612ee`
  - `0b88d442-14fd-481e-ac67-671386a362c5` (Mjöd/Green) → `fce8c0b21db6`  *(verifiera vilken MAC tillhör vilken pill — jag mappar dem efter vilka två som har aktiva brews; bekräfta gärna i chatten innan migration)*
  - `04cfce6d-5199-460b-88e8-ca97f87053e7` (Skogens Sus/Blå) → `fce8c0b2141a`

### 2. `supabase/functions/ingest-pill-ble/index.ts`
- Ändra `select('pill_id, paired_device_id')` → `select('pill_id, bluetooth_mac')`
- Bygg `macToPill` från `bluetooth_mac` istället. `normMac()` och resten oförändrat.

### 3. Inget annat rörs
- `sync-rapt-data-quick` lämnas helt orörd — den fortsätter äga `paired_device_id` för RAPT-länkning.
- Ingen PID-, snapshot- eller smoothing-logik berörs.

## Verifiering efter deploy
1. Kör diagnostik-query mot `bluetooth_mac` → ska visa de tre MAC:s.
2. Trigga en Pi-upload → vänta på edge-svar: `processed: 3, skipped: 0, pills_known: 3, triggered: ≤3`.
3. Kontrollera att nästa `sync-rapt-data-quick`-körning inte rör `bluetooth_mac` (den selectar bara `paired_device_id`).

## Frågor innan jag bygger
- Vilken MAC tillhör vilken pill? Jag har en gissning ovan baserat på Mjöd vs Skogens Sus men vill ha bekräftelse — annars seedar jag tomt och du UPDATE:ar de tre raderna manuellt direkt.