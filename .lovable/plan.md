## Vad som händer idag

I `ingest-pill-ble` skrivs `actual_temp = smoothedPill` rakt av varje minut när en controller är länkad till en pill — probevärdet (`current_temp` från RAPT, uppdateras var 15:e min) ignoreras totalt för SSOT-syften. Det enda probe används till är `pill_probe_offset`-EMA för drift-larm.

Det gör att PID styr på 100% pill, även när vi har två oberoende sensorer som kan medelvärdesbildas.

## Vad du vill

När probe finns: `actual_temp` = medelvärde av pill och probe. Probe-värdet är "fryst" i ~15 min mellan RAPT-syncar, så varje ny minutpill ger en ny vägd uppdatering. Vid stor delta (t.ex. 4°C) blir resultatet att pill dras 2°C mot probe tills nästa probe-läsning kommer.

## Fix — minimalt

Ändring **endast** i `supabase/functions/ingest-pill-ble/index.ts`, i blocket som promotar pill-temp till controller (runt rad 199–212).

### Ny logik

```ts
// Hämta nuvarande probe-värde + freshness
const { data: ctrl } = await supabase
  .from('rapt_temp_controllers')
  .select('current_temp, last_update')
  .eq('controller_id', controllerId)
  .maybeSingle();

const probeTemp = ctrl?.current_temp != null ? Number(ctrl.current_temp) : null;
const probeAgeMs = ctrl?.last_update ? Date.now() - new Date(ctrl.last_update).getTime() : Infinity;
const PROBE_FRESH_MS = 30 * 60 * 1000; // 30 min — RAPT skickar var 15:e, ge marginal

let actualTemp = smoothedTemp;
if (probeTemp != null && probeAgeMs < PROBE_FRESH_MS) {
  actualTemp = (smoothedTemp + probeTemp) / 2;
}

await supabase.from('rapt_temp_controllers').update({
  actual_temp: Number(actualTemp.toFixed(3)),
  pill_temp: Number(smoothedTemp.toFixed(3)),  // rå pill kvar i pill_temp för UI/drift
  last_update: r.recorded_at,
  updated_at: new Date().toISOString(),
}).eq('controller_id', controllerId);
```

### Konsekvenser
- `pill_temp` fortsätter visa enbart pill (för UI och drift-detektion).
- `actual_temp` blir blandvärde — PID styr på mittpunkten.
- Vid 4°C delta → `actual_temp` ligger 2°C från pill, exakt som du beskrev.
- Probe-äldre-än-30min → falla tillbaka till ren pill (samma som idag).
- Snapshot-skrivningen längre ned i samma funktion hämtar redan controllerns `actual_temp` när `linked_controller_id` finns — den blir automatiskt det blandade värdet. Ingen extra ändring där.

### Vad jag INTE rör
- `pill_probe_offset`-lärningen i `sync-rapt-data-quick` (drift-larm fungerar oförändrat).
- `preferred_sensor`-fältet (alltid blandning när probe finns — du nämnde inget om att göra det konfigurerbart).
- PID-, ramp-, eller smoothing-konstanter.

## Verifiering
1. Vänta på nästa BLE-ingest (≤1 min efter Pi-upload) och nästa RAPT-sync (≤15 min för probe).
2. SQL-check: `SELECT controller_id, pill_temp, current_temp, actual_temp FROM rapt_temp_controllers WHERE linked_pill_id IS NOT NULL;` — `actual_temp` ska ligga ≈ (pill_temp + current_temp)/2.
3. Edge-svar `pills_known`/`processed` oförändrade.

## Frågor
1. **30 min freshness-tröskel** för probe ok? RAPT skickar var 15:e min så 30 min ger 1 missad cykel innan vi släpper probe.
2. Vill du ha ett dödband — t.ex. om delta < 0.2°C, hoppa över blandning för att undvika brus? Min default är **nej**, blanda alltid när båda finns.