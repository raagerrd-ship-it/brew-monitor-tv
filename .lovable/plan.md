## Bakgrund — nuvarande antaganden vs ny verklighet

Hela PID-stacken är byggd för **RAPT-rapportering var 15:e min** (`telemetry-reporting-latency`-policyn). Nu har vi BLE som skriver `actual_temp` **var 60:e sekund** (smoothad). Men logiken behandlar fortfarande datan som om den vore gles:

| Mekanism | Nuvarande | Skäl (gammalt) | Problem nu |
|---|---|---|---|
| PID-cron | var 5:e min | Cooler kunde inte få fräsch data oftare | Vi har fräsch data var minut, PID svarar 5× långsammare |
| `STALE_SENSOR_THRESHOLD_MS` | **30 min** | RAPT-rapport ±15 min jitter | För slappt — BLE-bortfall märks 30 min för sent |
| `MODE_SWITCH_CYCLES = 3` (≈15 min) | 3 cykler | Skydd mot 1 brus-punkt | Onödigt långsamt vid äkta lägesfel |
| `isFreshReading = true` *(alltid)* | hårdkodat | "interpolerad data ska inte räknas" | Konstanten är död sen BLE — kan tas bort |
| `STALE_P_SCALE = 0.5` | halverar P på gammal data | Skydd mot fantom-P på gamla läsningar | Aktiveras aldrig för BLE-länkade controllers |
| `pillRate`-fönster | 8 rader, kräver >3 min spann | RAPT gav ~1 sample/15min | Med BLE har vi 8 rader på 8 min — kan strama upp till 5-min derivata |
| `predictive brake` `ratePrediction = rate × 0.25h × 2` | 30-min framsynthet | RAPT-jitter krävde safety-faktor 2× | Med 1-min data kan vi sänka till 1.5× → mindre överbroms |
| `activity score` 6h-fönster | 6h | För få SG-samples förr | Kan kompletteras med 1h-fönster för snabbare ramptrigger |

## Vad jag föreslår — 3 faser, ökande risk

### Fas 1 — Riskfri städning (rena vinster)
Kod som blivit död eller motstridig sen BLE blev SSOT.

1. **Strama åt `STALE_SENSOR_THRESHOLD_MS`** från `30 min` → `8 min` för BLE-länkade controllers. Behåll 30 min för rena RAPT-controllers (inget pill). → upptäcker Pi/BLE-bortfall 22 min tidigare.
2. **Triggra `auto-adjust-cooling` event-drivet från `ingest-pill-ble`** efter en lyckad BLE-update *när någon controller är länkad till denna pill*. Throttlas så max 1 körning per controller per 90 s. Cron-jobbet `rapt-quick-sync` (5 min) lämnas kvar som safety-net. → PID svarar på temp-rörelse inom 60-90 s istället för 5 min, utan ny cron.
3. **`MODE_SWITCH_CYCLES`: kontextberoende**. För BLE-länkade controllers: `2` (≈3-4 min med event-trigger). För RAPT-only: behåll `3` (≈15 min). → snabbare reaktion vid äkta lägesfel utan att riskera brus-trigger.
4. **`pillRate`-fönster**: när BLE finns, använd 5-min fönster (5 senaste raderna) istället för att kräva >3 min spann över 8 rader. Mer aktuell derivata → bättre predictive braking.

### Fas 2 — Värdehöjande, måttlig risk
Nyttja färsk data till bättre prediktion.

5. **`ratePrediction` safety-faktor**: sänk från `2.0×` → `1.5×` för BLE-länkade controllers (`pid-compensation.ts` rad 403). RAPT-jitter motiverade 2×; BLE har ingen jitter. → mindre överbromsning, snabbare convergence.
6. **Snabb mode-switch vid stor avvikelse**: `emergencyOverride`-tröskeln (>0.8°C på fel sida) sänks till `>0.5°C` för BLE-länkade controllers. Vi vet att avvikelsen är äkta, inte sensorbrus. → snabbare nödbroms.
7. **`pillCompensation rate_limit`** (`auto_cooling_settings.pill_compensation_rate_limit = 0.3°C/cycle`): kan höjas till `0.5` eftersom vi har 5× fräschare signal — kompensationen får röra sig snabbare utan att bli instabil.

### Fas 3 — Strukturell förbättring (större ingrepp, separat session)
8. **1-min activity-fönster** i `fermentation-metrics-logic.ts` parallellt med befintliga 6h. Triggar ramp-start (35% activity) snabbare när öl tar fart, och ramp-finish (5%) när jäsning verkligen dött. Kräver review av step-handlers.

### Vad jag INTE rör
- `profile_target_temp` (memory-skyddat)
- `actualTemp` SSOT (BLE-smoothad — det vi precis byggde)
- Snapshots (rådata-policy)
- RAPT API-anrops-cadence (target_temp pushas fortfarande bara när PID beslutat)
- `learning_value` precision (6 decimaler)

## Implementationsdetaljer (tekniska)

**Event-trigger (#2)** — i `ingest-pill-ble/index.ts`, efter lyckad `rapt_temp_controllers.update`, kolla tabellen `controller_outage_log` eller använd en in-memory throttle via en ny tabell `controller_last_pid_run` *(eller enklare: läs `last_hw_push_at` + lokal cooldown-kontroll i edge-funktionen)*. Anropa `auto-adjust-cooling` med `fetch` — fire-and-forget, inte await, så ingestens latens inte påverkas.

**Throttling**: Spara `last_event_trigger_at` per controller i ett enkelt `event_trigger_throttle`-jsonb-fält på `auto_cooling_settings` (singleton-rad), eller en ny enkel kv-tabell. Cooldown 90 s.

**Stale-tröskel (#1)** — i `temp-utils.ts` lägg till parameter `bleLinked: boolean` till `getStaleCheck`/`filterStaleControllers`, default 30 min, BLE-linked → 8 min.

**MODE_SWITCH_CYCLES (#3)** — i `controller-adjustments.ts` rad 535, läs från controller-objektet: `const MODE_SWITCH_CYCLES = fc.linked_pill_id ? 2 : 3`.

## Förväntat resultat

- PID reagerar inom **60-90 s** på temperatursvar (vs 5 min nu) → mindre överskjutning vid ramper, snabbare återhämtning vid störningar
- BLE-bortfall detekteras **22 min tidigare**
- Mode-byten kan ske **6-9 min snabbare** vid äkta lägesfel
- Mindre överbroms = snabbare convergence på hold-steg
- Ingen ny cron, ingen ny tabell strikt nödvändig (om vi använder `auto_cooling_settings`-jsonb för throttle)

## Frågor innan jag börjar

1. Vill du köra **Fas 1 + Fas 2** direkt (rekommenderat), eller bara Fas 1 först och verifiera 24h innan Fas 2?
2. Throttle-state för event-trigger: ny mini-tabell `pid_event_throttle (controller_id PK, last_run_at)` eller jsonb-fält i `auto_cooling_settings`? Mini-tabellen är renare men kräver migration.
3. Fas 3 (1-min activity-fönster) — vill du ha det i samma session eller separat när vi sett att Fas 1-2 funkar?