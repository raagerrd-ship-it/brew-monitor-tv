## Bakgrund

Sedan BLE-pillen skickar data varje minut (via `ingest-pill-ble`) skrivs `actual_temp` på controllern som blend `(pill + probe) / 2` när probe är fresh, annars `pill - offset/2`. Snapshot-historiken är nu omräknad till samma medel. Vid en genomgång av övrig kod hittade jag följande som inte hänger med den nya kadensen.

---

## 1. Probe-staleness är osynlig (allvarligt)

`ingest-pill-ble` läser `rapt_temp_controllers.last_update` för att avgöra om probe är fresh (PROBE_FRESH_MS = 30 min), men skriver **samma kolumn** med BLE-timestampen varje minut.

Resultat: probe ser alltid ut att vara fresh, även när RAPT-probe (current_temp) faktiskt är död. Blend används då för evigt med en fastfryst `current_temp`-värde, istället för att falla tillbaka till `pill_only` eller `delta_fallback`.

**Åtgärd:**
- Lägg till kolumn `current_temp_updated_at TIMESTAMPTZ` på `rapt_temp_controllers`.
- `sync-rapt-data-quick`: sätt `current_temp_updated_at = now()` endast när `current_temp` faktiskt ändras från RAPT-pollen.
- `ingest-pill-ble`: använd `current_temp_updated_at` (inte `last_update`) för PROBE_FRESH-checken.
- Backfilla kolumnen till `last_update` engångsvis.

## 2. Logging i `auto-adjust-cooling` använder gammal källa

`auto-adjust-cooling/index.ts:312-316` använder `current_temp ?? pill_temp` istället för `actual_temp` för loggraden `ctrl_temp` och flaggan `is_actively_cooling`. Strider mot SSOT-regeln och visar fel värde i decision-loggar (PID-besluten själva är korrekta — de använder `actual_temp` i `controller-adjustments.ts`).

**Åtgärd:** Byt till `actual_temp ?? current_temp ?? 0`. Påverkar bara logg/visning.

## 3. Fermentationsmetriker är hårdkodade för 15-min RAPT-data

Filen `_shared/fermentation-metrics-logic.ts`:

- **`determineFermentationPhase`** (rad 33): kräver `hours >= 3` i 6h-fönstret innan fas detekteras. Med 1-min cadence räcker 1h för stabil derivata.
- **`sgStable48h`** (rad 229): tröskel `< 0.002`. Smoothed BLE-SG har brusgolv runt 0.0003 — vi kan snäppa till `< 0.001` för snabbare crash-detektion utan falska positiva.
- **`calculateActivityScore`** (rad 80): tar `deltas.slice(0, 6)`. `temp_delta_history` skrivs nu var minut → "recent" blir 6 min istället för avsedda ~1.5h. Byt till tidsfönster (senaste 90 min) istället för fast antal.

## 4. Snapshot vid sync-rapt skriver `current_temp ?? pill_temp`

`sync-rapt-data-quick/index.ts:1332` använder `c.current_temp ?? c.pill_temp` när den bygger history-poster. Bör vara `c.actual_temp ?? c.current_temp ?? c.pill_temp` så `temp_controller_history.current_temp` matchar dashboarden.

---

## Genomförandeordning

1. Migration: lägg till `current_temp_updated_at` på `rapt_temp_controllers`, backfilla från `last_update`.
2. Patch `sync-rapt-data-quick`: sätt `current_temp_updated_at` när probe ändras + använd `actual_temp` i history-skrivningen.
3. Patch `ingest-pill-ble`: läs `current_temp_updated_at` för probe-freshness.
4. Patch `auto-adjust-cooling`: logga `actual_temp`.
5. Patch `fermentation-metrics-logic`: lös upp 15-min-antaganden (1h fönsterkrav, 0.001 stabilitet, tidsbaserat aktivitetsfönster).
6. Verifiera nästa BLE-cykel: kolla att probe-fallback triggar om RAPT-probe pausar (testbart genom att jämföra `current_temp_updated_at` vs `last_update` i en SQL-fråga efter 30 min).

Ingen UI-ändring behövs — alla läsare hänger redan på `actual_temp` via SSOT-konventionen.

## Punkter jag medvetet INTE rör

- Dithering, PID-tuning, ramp-rate — fungerar på `actual_temp` redan och har egna memory-regler.
- Cooler-management och `pid-compensation` — använder `actual_temp` korrekt.
- `brew-snapshots.ts` — fixad i förra patchen.
- `current_sg`-overwrite från RAPT-attenuation — separat ärende (behandlat tidigare).