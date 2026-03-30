

# Fix: Heating PWM OFF sätter fel revert-mål

## Problem
Vid heating PWM-burst sätts `revertTarget = actualTarget` (t.ex. 20°C). När `execute-pwm-off` återställer RAPT-målet till 20°C så ser RAPT:s firmware att proben (~16.7°C) fortfarande är under 20°C och fortsätter värma — trots att AI:ns PID-system har stängt av uppvärmningen.

Först vid nästa PID-cykel (DUTY_ZERO) aktiveras suppressionslogiken som sänker hw-målet till t.ex. 14.4°C. Under mellanperioden (~1–4 minuter) värmer RAPT okontrollerat.

```text
Nuvarande flöde (fel):
  BURST ON:  hw → 25°C (maxTemp)    ✅ värmer
  PWM OFF:   hw → 20°C (actualTarget) ❌ probe 16.7° < 20° → RAPT fortsätter värma!
  DUTY_ZERO: hw → 14.4°C             ✅ stoppar uppvärmning (men för sent)

Korrekt flöde:
  BURST ON:  hw → 25°C (maxTemp)    ✅ värmer
  PWM OFF:   hw → 14.4°C (suppress)  ✅ probe 16.7° > 14.4° → RAPT stoppar
  DUTY_ZERO: hw → 14.4°C             ✅ redan korrekt
```

## Lösning
Ändra `revertTarget` för **heating**-bursts så att det sätts till ett suppressionsmål (under proben) istället för `actualTarget` (som ligger ovanför proben).

### Fil: `controller-adjustments.ts`

**Rad ~769**: Beräkna `revertTarget` för heating med suppressionslogik:

```typescript
// For heating, revert to a target BELOW the probe to prevent
// RAPT's internal thermostat from continuing to heat after burst.
// Use same logic as DUTY_ZERO_SUPPRESS.
const probeTemp = fc.current_temp ?? actualTemp
const minTemp = parseFloat(String(fc.min_target_temp ?? '-10'))
const heatingRevertTarget = round1(Math.max(probeTemp - 2, minTemp))
const revertTarget = heatingRevertTarget
```

Detta ger samma beteende som `DUTY_ZERO_SUPPRESS` (rad 834–845) redan gör, men **direkt** vid PWM OFF istället för att vänta på nästa PID-cykel.

### Fil: `execute-pwm-off/index.ts`

Ingen ändring behövs — den läser redan `retry.target_temp` från databasen, så det räcker att lagra rätt värde vid schemaläggningen.

### Säkerhet
- `probeTemp - 2` säkerställer att proben alltid är **ovanför** hw-målet → RAPT:s termostat värmer inte
- Clampad mot `min_target_temp` (-10°C) för att inte gå under RAPT:s gräns
- DUTY_ZERO-logiken fungerar som backup om PWM OFF misslyckas

