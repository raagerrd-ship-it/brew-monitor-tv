

# Temperaturinterpolering mellan RAPT-synkningar

## Problem
RAPT-sensorn synkar var 15:e minut, men PID:n kör var 5:e minut. 2 av 3 PID-cykler använder gammal temperaturdata, vilket gör att PID:n reagerar sent — speciellt problematiskt vid aktiv kylning/värmning där temperaturen förändras snabbt.

## Lösning
Interpolera (estimera) `actualTemp` mellan synkningar med hjälp av:
1. **Senast kända temperatur** (från RAPT-synk)
2. **Tid sedan senaste synk** (från `fc.last_update`)
3. **Inlärd termisk hastighet** (`thermal_rate_heating` / `thermal_rate_cooling` i °C/h)
4. **Aktuellt PID-läge och duty** (om vi kör 30% kylning estimerar vi sänkning)

## Hur det fungerar

```text
RAPT synk        PID cykel 2      PID cykel 3      Nästa RAPT synk
  │──── 5 min ─────│──── 5 min ─────│──── 5 min ─────│
  20.0°C           19.7° (est)      19.4° (est)      19.1° (verifierad)
                   ↑                ↑                 ↑
                   interpolerad     interpolerad      ny sensor-data ersätter
```

### Interpoleringslogik (i `controller-adjustments.ts`, vid rad ~191)

```typescript
// After reading actualTemp from fc.actual_temp:
const lastUpdateMs = new Date(fc.last_update).getTime()
const staleMinutes = (Date.now() - lastUpdateMs) / 60000

if (staleMinutes > 3 && pidMode != null) {
  // Hämta inlärd termisk hastighet för aktuellt läge
  const rateParam = await getLearnedParam(supabase, fc.controller_id, 
    `thermal_rate_${pidMode}`, 0)
  
  if (rateParam.value > 0 && rateParam.sampleCount >= 3) {
    const ratePerMin = rateParam.value / 60  // °C/h → °C/min
    const lastDuty = pressureMap.get('pid_last_duty') ?? 0
    const dutyFraction = lastDuty / 100
    
    // Estimerad temperaturförändring = hastighet × tid × duty-fraktion
    const deltaEst = ratePerMin * staleMinutes * dutyFraction
    const sign = pidMode === 'cooling' ? -1 : 1
    
    estimatedTemp = actualTemp + sign * deltaEst
    // Clampa: aldrig förbi target (den logiska gränsen)
    if (pidMode === 'cooling') estimatedTemp = Math.max(estimatedTemp, actualTarget)
    if (pidMode === 'heating') estimatedTemp = Math.min(estimatedTemp, actualTarget)
    
    log('TEMP_INTERPOLATED', 'info', 
      `${fc.name}: sensor ${actualTemp}° (${staleMinutes.toFixed(0)}min gammal) → est ${estimatedTemp}°`)
  }
}
```

### Säkerhetsregler
- **Minst 3 minuter** sedan senaste synk innan interpolering aktiveras (undvik brus)
- **Minst 3 samples** av inlärd hastighet krävs (inte gissa med dålig data)
- **Clampa** mot target: aldrig estimera att vi passerat måltemperaturen
- **Duty-skalning**: vid 30% duty estimeras bara 30% av full hastighet
- **Auto-korrigering**: vid varje ny RAPT-synk ersätts estimatet med verifierad sensordata
- **Vid 0% duty**: ingen interpolering (temp borde vara stabil)
- **Logga** estimatet så det syns i beslutslogs för felsökning

### Fil som ändras
- `supabase/functions/_shared/controller-adjustments.ts` — lägg till interpoleringslogik efter `actualTemp`-beräkningen (rad ~191) men **före** PID-beräkningen

### Beroenden (redan tillgängliga)
- `getLearnedParam` — för att läsa `thermal_rate_heating`/`thermal_rate_cooling`
- `fc.last_update` — finns i `rapt_temp_controllers`-tabellen
- `pressureMap` → `pid_last_duty` — redan läses in

