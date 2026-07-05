
# Fix PID SSOT-filter regression + dither-aware guards

Claudes analys stämmer mot koden i `supabase/functions/_shared/pid-compensation.ts`: EMA:n saturerar till 1 vid 5-min cadence, så `ssotFiltered === actualTemp` i produktion. Dither-guarden och peak-detektionen agerar därför fortfarande på rå burst-brus.

Alla ändringar i **`supabase/functions/_shared/pid-compensation.ts`** — inga andra kodfiler, inga signaturer eller `V5PidState`-fält ändras.

## Ändringar

**1. Riktig diskret EMA (rad ~245–249)**
```ts
// TAU_MIN måste överstiga sample-intervallet (≥5 min PWM-cykel) och rymma ~15 min probe-latens,
// annars saturerar alpha och EMA:n blir en no-op. Formen 1-exp(-dt/tau) är korrekt diskret EMA.
const TAU_MIN = 12.0
const alpha = 1 - Math.exp(-dtMinEarly / TAU_MIN)
const prevSmoothed = input.prevState.ssotSmoothed
const ssotFiltered = prevSmoothed != null
  ? prevSmoothed + alpha * (input.actualTemp - prevSmoothed)
  : input.actualTemp
```
Vid dt=5, tau=12 → alpha≈0.341 (verklig filtrering). Fallback vid `prevSmoothed == null` (fresh controller / state-reset) bibehålls — `alpha` beräknas oberoende av prevSmoothed så inget cirkulärt beroende.

**2. Gate stall-boost-growth på `inDitherZone` (rad ~453–476)**
- Härled `inDitherZone` i stall-boost-blocket **från `prevDutyFrac`** (förra cykelns duty, samma källa som D-brake-guarden) — inte den duty som beräknas denna cykel (som ännu inte är finaliserad här).
- I `shortfall > 0`-grenen: om `inDitherZone` är true, hoppa över `stallBoost += growthPerMin * dtMin` **och** push:a constraint `stall-freeze-dither` (endast här, inte generellt närhelst `inDitherZone` är true — så decay/reset-cykler slipper stökig logg-brus).
- Decay-grenen (`progressRate ≥ requiredRate`) och reset-grenen (`|error| < 0.05`) körs oförändrat — boost får krympa eller nollas, aldrig växa, från en dither-burst-mätning.

**3. Peak-detection läser `ssotFiltered` istället för `input.actualTemp` (rad ~534–572)**
- Byt `peakMinTemp = input.actualTemp` → `ssotFiltered` vid arm.
- Byt `input.actualTemp < peakMinTemp` och `input.actualTemp >= peakMinTemp + 0.02` → använd `ssotFiltered`.
- Skyddar Ki-autotune från att latcha en burst-inducerad dip som "peak".

**4. Kommentar ovan EMA** — inbakad i punkt 1, förklarar varför `TAU_MIN` måste överstiga sample-intervallet så framtida cadence-tuning inte regresserar det.

## Bibehålls

- `V5PidState`-form, alla loggar och `constraints`-strängar (förutom nya `stall-freeze-dither`).
- Existerande D-brake `d-suppress-dither`-guard oförändrad.
- `HW_STEP` / `quantize()` / seed-quantization oförändrat.
- Slew-cap (5%), deadband (±0.10°C), min-off logik oförändrat.

## Verifiering

- `tsgo` typecheck via harness efter build-mode.
- Sanity: `dtMinEarly=5, TAU_MIN=12` → alpha ≈ 0.341 (inte 1.0).
- Snabbläs runtime-loggar för nya `stall-freeze-dither` — förväntas dyka upp endast under låg-duty hold med aktiv shortfall, inte varje cykel i dither-zonen.

## Uppdatera memory

Uppdatera `.lovable/memories/architecture/automation/pid-hw-quantization-awareness.md`:
- Rätt EMA-formel (`1 - exp(-dt/tau)`) och `TAU_MIN=12`, med förklaringen att TAU måste överstiga sample-intervallet.
- Stall-boost-growth fryses i dither-zon (constraint `stall-freeze-dither`), decay/reset opåverkade.
- Peak-detection läser `ssotFiltered` (inte raw) för att skydda Ki-autotune.
