## Mål

1. Säkerställa att Pi-data faktiskt landar i `rapt_pills` (just nu står data still sedan 19:42 trots POST 200).
2. Lägga till delta-fallback för `actual_temp` när probe blir stale: behåll midpoint baserat på senast inlärt offset.

## Nuvarande tillstånd

- `ingest-pill-ble` koden i repo **gör** redan blandning `(pill + probe) / 2` när probe < 30 min gammal (rad 204-235). Min tidigare summering var fel.
- `pill_probe_offset` (= `pill − probe` EMA) lärs av `sync-rapt-data-quick` och finns på controllern.
- **Problem:** `rapt_pills.updated_at = 19:42:35`, `last_update = 19:41:21`. Nu är klockan ~21:48. Pi POSTar (200) men inget skrivs. Pi rapporterar `unknown_macs = våra 3 MAC:s, processed: 0`.

## Plan

### Steg 1 — Verifiera Pi/MAC-matchning på riktigt

a) Lägg till tydlig `console.log` i `ingest-pill-ble` precis efter `macToPill`-bygget och i loopen — logga `pills_in_db_macs`, `incoming_macs`, `matched`, `unknown`. Idag finns ingen log → vi flyger blint.

b) Forcera ny deploy av `ingest-pill-ble` (kan vara stale deployment).

c) Verifiera efter nästa Pi-cykel (~3 min) via logs + SQL `SELECT pill_id, name, temperature, last_update, updated_at FROM rapt_pills`.

→ verify: `updated_at` har rört sig till nuvarande tid, `processed > 0` i logs.

### Steg 2 — Delta-fallback för actual_temp

I `ingest-pill-ble` rad 219-222, ersätt enkla fallbacken:

```text
Idag:
  probe fresh  → actual = (pill + probe) / 2
  probe stale  → actual = pill   ← hopp på 1-2°C när probe tappas

Ny logik (använd inlärt offset):
  probe fresh  → actual = (pill + probe) / 2        (behåll)
  probe stale & pill_probe_offset finns
               → actual = pill − (pill_probe_offset / 2)
  probe stale & inget offset finns
               → actual = pill                       (samma som idag)
```

Konkret: läs `pill_probe_offset` från controller (redan i `select`-listan i steg 1-läsningen — utöka från `select('current_temp, last_update')` till `select('current_temp, last_update, pill_probe_offset')`). Använd offset / 2 så midpoint bibehålls (probe är "den andra halvan").

Ditt exempel: pill=16, probe=14 → offset≈+2, midpoint=15. Probe tappas, pill stiger till 17 → actual = 17 − 1 = 16. Pill faller till 15 → actual = 15 − 1 = 14. Midpoint följer pill-rörelsen, vilket är vad vi vill.

→ verify: efter deploy, simulera/vänta tills probe blir >30 min stale (eller logga `usedDeltaFallback: true`). Kolla att `actual_temp ≈ pill_temp − offset/2`.

### Steg 3 — Säkerhetsbälte

- Klampa `offset` till `[−5, +5]` innan användning (skydd mot trasiga värden).
- Om `Math.abs(offset) > 5` → fallback till ren pill + skriv `console.warn`.

## Vad jag INTE rör

- PID-loopen, ramp, hysteresis, cooler-margin — oförändrat.
- `sync-rapt-data-quick` (offset-lärningen är redan korrekt).
- Probe-fresh 30 min-tröskeln.
- Aktivitets-viktad fusion (`computeDualSensorTarget`) — vi valde enkel 50/50 + delta-fallback.

## Risker

- **Steg 1**: Om MAC-mismatch beror på något oväntat (t.ex. case, prefix) syns det i nya loggarna direkt. Worst case behöver vi normalisera bluetooth_mac vid skrivning också.
- **Steg 2**: Offset-EMA kan ha drift om probe historiskt varit fel. Klampningen i steg 3 mitigerar.
- Inget rör hårdvara — bara SSOT-beräkning. Säkert att rulla ut.

## Efter implementation

Stabil temperatur kräver att **alla tre** stämmer:
1. ✅ Pi-data landar (löses i steg 1)
2. ✅ Blandvärde när båda finns (redan på plats)
3. ✅ Smart fallback när probe tappas (steg 2)

Då kan jag säga ja på din fråga.
