

# Marginaljusterad PID — duty-cykel skalad efter kylargradient

## Dataanalys (senaste 10h)

Kylartempen svänger 0.35–3.59°C, vilket ger Blå en actual margin mellan 2.8–6.1°C. PID:n kompenserar inte för detta — den ger ~35% duty oavsett, trots att kyleffekten per duty-% varierar med faktor 2x.

**Inlärd referensmarginal**: 4.94°C (cold bucket, 90 prover)

## Lösning

Införa `gainScale = learnedMargin / actualMargin` (clamped 0.5–2.0) som skalfaktor på P-termen och I-ackumuleringen i cooling mode.

## Implementation (3 filer)

### 1. `pid-compensation.ts` — Ny parameter + skalningslogik (~15 rader)

Lägg till optional parameter `coolerMarginContext?: { coolerTemp: number; learnedMargin: number }`.

I "NEEDS ACTION"-blocket (rad ~190–275), applicera gainScale på P och I:

```
actualMargin = actualTemp - coolerTemp
gainScale = clamp(learnedMargin / actualMargin, 0.5, 2.0)
pCorrection = need * DUTY_P * gainScale
integral += need * DUTY_I * gainScale
```

Logga `margin-scale=X.XX` i constraints-arrayen.

### 2. `controller-adjustments.ts` — Propagera kylardata (~10 rader)

Hämta aktuell kylartemp och inlärd marginal från kontexten som redan finns tillgänglig. Skicka `coolerMarginContext` till `calculateCompensatedTarget()`.

### 3. `auto-adjust-cooling/index.ts` — Passthrough (~5 rader)

Skicka kylarens `current_temp` och `cooler_margin:cold` learning till controller-adjustments-kontexten.

## Skyddsåtgärder

- Clamp 0.5–2.0 förhindrar extrema skalningar
- Cooling-only — heating påverkas inte
- Fallback: gainScale = 1.0 vid saknad kylartemp
- Deadband, braking, ssFloor: oförändrade (marginalen är redan stabil där)

