

# Fix: PWM/PID-flapping vid gränsvärdet 70% utilization

## Problem

PWM-logiken hoppar tillbaka till PID när `coolingUtil > 0.70` (rad 324 i `controller-adjustments.ts`). Med 74% utilization slår denna guard in, men om PWM lyckas sänka util under 70% nästa cykel så aktiveras PWM igen — och så pendlar det.

## Lösning

Inför **hysteresis på PWM-guarden**:
- **Avaktivera PWM** när util > 75% (höjd tröskel)
- **Återaktivera PWM** bara om util sjunker under 65%

Detta kan implementeras enkelt med två trösklar:

```text
Nuvarande:  skipPwm = coolingUtil > 0.70
Nytt:       skipPwm = isPwmMode_previous ? coolingUtil > 0.75 : coolingUtil > 0.65
```

Alternativt, enklare approach — höj bara tröskeln till 80% (PWM-duty under 60% borde klara 74% util utan problem):

```text
skipPwm = coolingUtil > 0.80
```

## Filer som ändras

- `supabase/functions/_shared/controller-adjustments.ts`, rad 324: Höj PWM-skip-tröskeln från 0.70 till 0.80

