

## Förenkling: PID mot actual_temp / actual_target

### Bakgrund
Med den gamla PID-modellen (temperatur-offset) var dual-sensor baseTarget-översättningen nödvändig för att PID:en skulle arbeta i probe-domänen. Men nu när PID:en ger en dimensionslös duty cycle (0–1), behöver vi bara veta "hur långt från mål" — oavsett om det är 1 eller 2 sensorer.

### Nuvarande flöde
```text
profileTarget → dual-sensor → baseTarget (probe-domain) → PID error (baseTarget - probeTemp) → duty
                              ↓
                         revertTarget = baseTarget
```

### Nytt flöde
```text
profileTarget = actualTarget
actual_temp = avg(pill, probe) eller probe/pill ensam
PID error = actualTarget - actualTemp → duty
revertTarget = actualTarget (profiltarget direkt)
```

### Vad ändras

**1. `pid-compensation.ts`**
- Ta bort `baseTarget`-parametern. PID tar istället `actualTarget` och `actualTemp`.
- Error beräknas som `actualTarget - actualTemp` (inte `baseTarget - probeTemp`).
- D-term distans beräknas mot `actualTarget` istället för `baseTarget`.
- Returvärde: `ctrlTargetPid` = `actualTarget` (för loggning/referens).
- `avgDelta`/`compensation` blir 0 (ingen sensorDelta-beräkning behövs).

**2. `controller-adjustments.ts`**
- `computeDualSensorTarget` anropas fortfarande men **bara för att beräkna `actualTemp`** (fusionerad sensoravläsning). `baseTarget` och `sensorDelta` ignoreras.
- PID-anropet: skicka `actualTarget` istället för `dualSensor.baseTarget`.
- Mode detection: `suggestedMode` baseras på `actualTemp > actualTarget` istället för `probeTemp > baseTarget`.
- `distanceToTarget` = `|actualTemp - actualTarget|`.
- `revertTarget` (PWM off-fas) = `actualTarget` istället för `baseTarget`.
- `baseTargetMap` fylls med `actualTarget` istället för `dualSensor.baseTarget` (cooler management).
- Ta bort `probeTemp`-separat-variabeln — allt körs mot `actualTemp`.

**3. `dual-sensor.ts`**
- Behålls men förenklas: ta bort `baseTarget` från returvärdet. Returnerar bara `actualTemp` och `enabled`.
- Alternativt: ersätt med en enkel `getActualTemp()`-funktion (som redan finns i `src/lib/temp-display.ts`).

**4. `cooler-management.ts`**
- `baseTargetMap` innehåller nu `actualTarget` (profilmål) — inga kodändringar behövs i cooler, den läser bara värdet.

**5. Loggning**
- `PILL_COMP_STATUS`-loggen: ta bort `delta`, `sensor_delta`, `raw_ctrl_target_pid`. Lägg till `actual_temp` tydligare.
- `ctrl_target_pid` = `actualTarget` (referens, inte beräknat).

### Vad som INTE ändras
- PWM-burstlogik (0°C/maxTemp för on, revertTarget för off)
- Mode-switching stabiliseringslogik (6 cykler)
- Integral-ackumulering, P/I/D-termer
- Cooler management (använder samma map, bara andra värden)
- Frontend `temp-display.ts` (redan korrekt)

### Risker
- **Revert-target**: Med 2 sensorer och stor skillnad (t.ex. probe=18, pill=22, mål=20) sätts revert till 20°C. Proben kommer då läsa 18°C och RAPT:s egna hysteres aktiverar inte kylning. Nästa PID-cykel ser actual_temp=20°C=mål → duty 0%. Detta är korrekt beteende.
- **Integral migration**: Befintliga integraler är redan i duty-space (0–1), ingen migration behövs.

### Sammanfattning
Tar bort hela "probe-domain translation"-lagret. PID:en mäter error i samma domän som användaren ser (actual_temp vs actual_target). Enklare, färre variabler, samma resultat.

