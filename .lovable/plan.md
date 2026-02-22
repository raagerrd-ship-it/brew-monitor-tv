

# PID-liknande temperaturreglering med hastighetsdämpning

## Problemanalys

Just nu fungerar pill-kompensationen som en ren P-regulator (proportionell):
- Formel: `compensatedTarget = profileTarget - delta/2`
- Problemet: controllern kyls snabbt (23° till 13° pa 1.5h), deltat vaxer, och systemet pressar malet annu lagre i en positiv aterkooplings-loop
- Resultat: malet drivs ned till 12.4° nar profilen egentligen vill ha 16°, trots att pill-tempen redan faller stadigt

## Losning: Lagg till D-term (derivata/hastighetsdampning)

Utoka `calculateCompensatedTarget` i `_shared/temp-utils.ts` med en dampningsfaktor baserad pa pill-temperaturens forandringshastighet:

1. **Hamta mer historik** - 8 punkter istallet for 3 (40 min vid 5-min intervall)
2. **Berakna pill-temp-hastighet** (grader/timme) fran historiken
3. **Berakna ETA till mal** - hur lang tid tills pill nar profileTarget vid nuvarande hastighet
4. **Dampningsfaktor** - om pill narmar sig malet snabbt, skala ned kompensationen:
   - ETA < 20 min: dampning = 0.2 (minimal kompensation, vi ar nastan dar)
   - ETA < 40 min: dampning = 0.4
   - ETA < 60 min: dampning = 0.6
   - ETA > 60 min eller pill ror sig at fel hall: dampning = 1.0 (full kompensation)

### Formel

```text
pillRate = (pill_nu - pill_30min_sedan) / tidsdiff_timmar
eta_hours = (pill_nu - profileTarget) / abs(pillRate)  [om pill sjunker]

dampingFactor = clamp(eta_hours / anticipation_window, 0.2, 1.0)
compensatedTarget = profileTarget - (delta/2) * dampingFactor
```

### Exempel med nuvarande data (Falkens Flykt)

- Pill: 21.3° (sjunker ~1°/h)
- Controller: 13.1°
- Mal: 16.0°
- Delta: 8.2°
- ETA: (21.3 - 16.0) / 1.0 = 5.3 timmar → dampingFactor = 1.0 (full komp, pill ar fortfarande langt fran mal)

Men om pill vore 17.0° och sjunker 2°/h:
- ETA: (17.0 - 16.0) / 2.0 = 0.5h (30 min) → dampingFactor = 0.5
- Kompensation: delta/2 * 0.5 istallet for delta/2 → mycket mildare justering

## Tekniska andringar

### 1. `supabase/functions/_shared/temp-utils.ts` - `calculateCompensatedTarget`

- Andra `limit(3)` till `limit(8)` for delta-historik
- Hamta aven `pill_temp` fran `temp_delta_history`
- Berakna pill-temperaturens forandringshastighet (rate, grader/timme)
- Berakna ETA till profileTarget
- Applicera dampningsfaktor pa kompensationen
- Logga rate, ETA och dampning for transparens

### 2. `supabase/functions/process-fermentation-profiles/index.ts`

- Samma logik appliceras pa profil-driven pill-kompensation (den anropar samma `calculateCompensatedTarget`)
- Ingen extra andring kravs — delad funktion

### 3. Ingen databasandring kravs

- All data som behovs finns redan i `temp_delta_history` (pill_temp, recorded_at)

