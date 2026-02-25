

## Plan: Använd förberäknad Activity Score i stalldetekteringen

### Bakgrund

Idag beräknar stalldetekteringen i `auto-adjust-cooling/index.ts` (rad 749-807) sin egen SG-hastighet och temperatur-delta-analys, parallellt med att `compute-fermentation-metrics` redan beräknar `activity_score` (0-100%) och `sg_rate_per_hour` och lagrar dessa i `brew_fermentation_metrics`.

Genom att läsa de förberäknade metriken istället elimineras duplicerad logik och säkerställer att stall-beslut baseras på samma data som visas i UI:t.

### Ändringar

**`supabase/functions/auto-adjust-cooling/index.ts`**

Redan i steg 2b (rad 692-807) hämtas brew-data och beräknas SG-hastighet + delta-trend manuellt. Ersätt detta med:

1. **Hämta `brew_fermentation_metrics`** för bryggningen (brew_id) -- `activity_score`, `sg_rate_per_hour`, `fermentation_phase`.

2. **Ersätt stalldetekteringslogiken** (rad 749-807):
   - Bort: Manuell SG-rate-beräkning (12h-fönster, sgDrop, sgRatePerDay)
   - Bort: Manuell delta-trend-analys (temp_delta_history-query, deltaIsDropping, deltaIsLow)
   - Kvar: Attenuationsintervall-check (behöver fortfarande brew OG/FG/current SG)
   - Ny logik: `sgIsStalling = sgRatePerDay < stallSettings.sgRateThreshold` baserat på `metrics.sg_rate_per_hour * 24`
   - Ny logik: `activityIsLow = metrics.activity_score < 20` (ersätter deltaIsDropping/deltaIsLow)
   - Ny stall-condition: `stallDetected = sgIsStalling && activityIsLow`

3. **Behåll SG-data-hämtning** för attenuationsberäkning (OG/FG/current SG behövs fortfarande), men ta bort den manuella 12h-filtreringen och rate-beräkningen.

4. **Ta bort `temp_delta_history`-queryn** (rad 773-778) som nu är onödig -- activity score inkluderar redan denna information.

5. **Uppdatera loggningen** så den visar `activity_score` och `fermentation_phase` från metriken istället för råa delta-värden.

### Vad som bevaras oförändrat

- Steg 2a: Outcome-utvärdering av tidigare boosts (rad 591-690) -- oförändrad
- Un-boost-logik (rad 818+) -- oförändrad, men använder `activity_score > 40` istället för manuell SG-rate-check för att avgöra om jäsning återupptagits
- Boost-applicering och PID-justering -- oförändrad
- Cooldown-period (6h) -- oförändrad
- Inlärningslogik (`stall_boost_degrees`) -- oförändrad

### Teknisk detalj

Metriken hämtas redan batchat i `process-fermentation-profiles` via `.in('brew_id', brewIds)`. Samma mönster används här, men per controller-iteration (enstaka `.eq('brew_id', brewLink.id).maybeSingle()`).

Fallback: Om metriken saknas (brew utan metrics-rad), skippa stall-check för den controllern med logg "Inga förberäknade metrics".

