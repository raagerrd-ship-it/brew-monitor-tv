

# Analys: Är aktiv kalibrering rätt approach?

## Problemet med den föreslagna kalibreringen

Den aktiva kalibreringen (24h, dedicerad controller, steging genom temperaturer) har flera grundläggande svagheter:

1. **Tom tank ≠ jäsande tank**: En tom tank (eller vattenfylld) har helt annan termisk massa och noll exoterm värme från jäsning. Kalibreringsdatan överför sig inte till verkliga förhållanden.

2. **Omgivningstemperatur varierar**: Marginalen vid 22°C omgivning skiljer sig drastiskt från 5°C omgivning. En engångskalibrering fångar bara ett tillfälle.

3. **Antalet tankar påverkar**: En glykolkylare som kyler 1 tank vs 3 tankar har helt olika kapacitet per tank. Kalibrering med 1 controller säger lite om multi-tank-scenarion.

4. **Controller ur drift i 18h+**: Opraktiskt.

## Vad systemet egentligen behöver lära sig

Det du beskriver --- marginal för hold, kylhastighet vid marginal, uppvärmningshastighet --- är *driftsparametrar* som varierar med:
- Omgivningstemperatur
- Antal aktiva tankar (last)
- Jäsningsaktivitet (exoterm värme)
- Tankinnehåll (volym, typ)

## Bättre approach: Förbättrad passiv inlärning

Istället för aktiv kalibrering, utöka den befintliga passiva inlärningen med fler parametrar:

### Nya inlärda parametrar (via `fermentation_learnings`)

| Parameter | Vad den fångar | När den lärs |
|-----------|---------------|--------------|
| `cooling_rate:{bucket}:{load}` | °C/h kylhastighet vid given marginal och last | Under aktiv kylning |
| `warming_rate:{bucket}` | °C/h passiv uppvärmning (kylare av) | När cooler util = 0% och temp stiger |
| `hold_margin:{bucket}:{load}` | Optimal marginal för att hålla stabil temp | Under hold-steg med stabil temp |
| `ramp_margin:{bucket}:{load}` | Optimal marginal under aktiv ramp | Under ramp-steg |
| `cooling_capacity:{load}` | Max kylkapacitet vid given last | Vid 100% utilization |

`load` = antal aktiva tankar (0, 1, 2plus) --- detta finns redan delvis i bucket-systemet.

### Förändringar i befintlig kod

**`cooler-management.ts`**:
- `learnFromCurrentState()` utökas med:
  - Logga `cooling_rate:{bucket}:{load}` varje cykel med aktiv kylning
  - Logga `warming_rate:{bucket}` när kylare util=0% och temp stiger
  - Separera `hold_margin` vs `ramp_margin` baserat på om steg är hold/ramp
- `measureCoolingRate()` redan finns --- återanvänd för warming rate (negativ = uppvärmning)

**`controller-adjustments.ts`**:
- PID kan använda inlärd `cooling_rate` för att bättre prediktera hur mycket kompensation som behövs
- Vid ramp: använd `ramp_margin` istället för generell `cooler_margin`

### Ny UI-komponent: `LearnedThermalProfile.tsx`

Visar en sammanfattning av alla inlärda termiska parametrar:
- Kylhastighet per zon och last
- Uppvärmningshastighet per zon  
- Hold-marginal vs ramp-marginal
- "Confidence" baserat på sample_count

### Databas

Inga schemaändringar behövs --- allt ryms i befintliga `fermentation_learnings` med nya `parameter_name`-nycklar.

### Filer som ändras

1. `supabase/functions/_shared/cooler-management.ts` --- utöka `learnFromCurrentState()` med cooling rate, warming rate, hold/ramp-separering
2. `src/components/LearnedCoolerMarginValues.tsx` --- utöka med nya parametrar (eller ny komponent)
3. Eventuellt `supabase/functions/_shared/controller-adjustments.ts` --- PID använder inlärda rates

### Sammanfattning

Aktiv kalibrering med dedikerad tank är inte värt komplexiteten. Förbättrad passiv inlärning med fler parametrar (kylhastighet, uppvärmningshastighet, hold vs ramp) ger bättre data eftersom den lär sig under verkliga förhållanden. Systemet konvergerar inom 2-3 dagar istället för att ge en opålitlig engångsmätning.

