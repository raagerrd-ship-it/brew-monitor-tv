## Mål

Pill (BLE, varje minut) blir den enda sanningen för `actual_temp`. Probe (RAPT API, var 15:e min — snart varje minut) används enbart för att (a) lära in en löpande pill↔probe-offset så vi vet om pillen driver, och (b) den befintliga hardware-suppressionen i RAPT. All gissningslogik (interpolation, sensor-fusion, fallback-kedjor, `preferred_sensor`) tas bort. Analys körs varje minut, hardware-kommandon throttlas till 10-min intervall.

## Ny sensormodell

```text
BLE-pill (1 min)  ─────────► rapt_pills.temperature
                                    │
                                    ▼
                       actual_temp = pill_temp   (alltid, så länge pill < 5 min gammal)
                                    │
RAPT probe (15 min) ──► current_temp
       │                            │
       └─► offset = pill − probe ──► EMA (alpha 0.2) ──► controller_pill_probe_offset
                                                                │
                                                                ▼
                                            Driftlarm om |offset_delta_24h| > 1.0 °C
```

Kärnregler:
- `actual_temp` skrivs av BLE-ingest, inte av RAPT-sync.
- RAPT-sync slutar räkna fusion. Den uppdaterar bara `current_temp` (probe) och lär in offset.
- Inga `current_temp`-fallbacks någonstans. Om pillen är >5 min gammal: `actual_temp = null` → controller hoppas över (samma som dagens `STALE_SENSOR_THRESHOLD_MS`-mönster, men 5 min istället för 30).

## Förändringar

### 1. BLE ingest = SSOT-skrivaren
`supabase/functions/ingest-pill-ble/index.ts`:
- För varje linkad pill→controller, skriv direkt `rapt_temp_controllers.actual_temp = temp_c` och `last_update = recorded_at`.
- Skriv även `pill_temp = temp_c` (samma värde, för UI-bakåtkompat).
- Lämna `current_temp` orört (det är probens domän).

### 2. RAPT-sync slutar äga `actual_temp`
`supabase/functions/sync-rapt-data-quick/index.ts` runt rad 384–421:
- Ta bort hela `dual_sensor_enabled` / `preferred_sensor` / `probeWeight`-blocket.
- Skriv bara `current_temp` (probe), `cooling_enabled`, hysterer, utilisation, m.m.
- När nytt probe-värde kommer: räkna `offset = pill_temp − current_temp`, EMA-blanda mot `pill_probe_offset` (ny kolumn), uppdatera `pill_probe_offset_updated_at`.
- Larma till `pending_notifications` om `|offset − offset_baseline_24h| > 1.0 °C` (pill flyter, batteridrift eller dåligt fäste).

### 3. Riv ut all gissningslogik
- `supabase/functions/_shared/dual-sensor.ts` → delete file.
- `temp-utils.ts` rad 416-418 (re-export) → bort.
- `supabase/functions/_shared/controller-adjustments.ts` rad ~460-625 hela `interpolatedTemp`-blocket → bort, ersätt med `const pidInputTemp = actualTemp`.
- `pid-compensation.ts` rad 411/438 interpolation-kommentarer och brake-skip-logiken → bort (vi har alltid färsk pill).
- Memory: ta bort/markera obsolete `architecture/automation/temperature-interpolation`.

### 4. Cadence
- **Analys (PID/run-automation)**: cron till `* * * * *` (varje minut). Loopen är billig — den läser DB, räknar, beslutar.
- **Hardware push (RAPT SetTargetTemperature)**: behåll guard i `RaptUpdateBatch` — skicka bara om |Δtarget| ≥ 0.1 °C OCH minst 10 min sedan förra push:en till samma controller. Lägg till `rapt_temp_controllers.last_hw_push_at`.
- **RAPT-sync (probe + utilisation)**: behåll nuvarande schema (var 15:e min) tills probe-varje-minut är på plats. När det är klart sänks bara cron-intervallet.

### 5. Offset-larm (probe som sanity-check)
Ny tabell-kolumn på `rapt_temp_controllers`:
- `pill_probe_offset NUMERIC` (EMA av pill − probe)
- `pill_probe_offset_baseline NUMERIC` (24h-snitt, uppdateras dagligen)
- `pill_probe_offset_updated_at TIMESTAMPTZ`
- `last_hw_push_at TIMESTAMPTZ`

Larm via befintlig `pending_notifications` (`type: 'sensor_drift'`) — inga UI-ändringar krävs, NotificationBell plockar upp den.

## Det här bygger vi *inte* nu

- Ingen event-driven trigger från ingest-pill-ble → run-automation (cron räcker).
- Ingen viktad fusion. Pill är pill, probe är probe.
- Ingen ändring av probe-cadence — den biten gör du själv när "botten Temp varje minut" är på plats.
- Inga UI-ändringar utöver att gamla `dual_sensor`-togglen blir död kod (kan rensas i en senare städning).

## Stegordning

1. Migration: lägg till 4 nya kolumner på `rapt_temp_controllers`.
2. Uppdatera `ingest-pill-ble`: skriv `actual_temp` + `pill_temp` + `last_update` på controller.
3. Strippa fusion ur `sync-rapt-data-quick`, lägg in offset-EMA + drift-larm.
4. Riv `interpolatedTemp`-blocket i `controller-adjustments.ts`; ersätt med `pidInputTemp = actualTemp`.
5. Delete `dual-sensor.ts`, ta bort re-export i `temp-utils.ts`.
6. Throttle hardware push i `RaptUpdateBatch.add()` mot `last_hw_push_at`.
7. Cron: byt `run-automation`-schema till varje minut.
8. Uppdatera memory: ta bort temperature-interpolation, uppdatera SSOT-noten till "BLE = SSOT, probe = drift-check".

## Verifikation

- Logga in på preview, kolla att Mjöd + Skogens Sus får `actual_temp` med `last_update` < 2 min.
- Kör `select controller_id, pill_temp, current_temp, actual_temp, pill_probe_offset, last_update from rapt_temp_controllers` efter 30 min — offset ska vara små tal nära 0.
- Edge-logs `run-automation`: ska köra varje minut, RAPT-flushes ska vara glesa (cirka var 10:e min per controller).
- Manuellt: dra ur pillens batteri → efter ~5 min ska controller hoppas över i loopen och `sensor_drift`/stale-larm trigga.
