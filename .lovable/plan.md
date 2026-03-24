

## Unified PID-to-Duty-Cycle Controller (Implemented)

### Arkitektur
```text
Profil → Dual Sensor → PID → duty cycle (0–100%) → PWM burst varje 5-min cykel
                                                     ├─ 0°C i (duty% × 300)s
                                                     └─ baseTarget resten av cykeln
```

### Hur det fungerar
- **Cooling**: PID output = duty cycle (0.0–1.0). Hardware styrs via PWM-bursts.
  - Stor error (> 2°C): duty = 100% (full kylning)
  - Proportionell zon: duty = clamp(|error| × 0.5 + integral, 0, 1.0)
  - Deadband (±0.1°C): duty = integral (inlärd steady-state)
  - Overcooled: duty = 0%, integral dämpas
  - D-term: dämpar P-termen nära mål (integral opåverkad)

- **Heating**: Oförändrad target-baserad PID (RAPT styr värmare via hysteres)

### PID-parametrar (cooling duty)
```
pGain: 0.5        # duty per °C error
iGain: 0.05       # duty per cykel per °C
iDecay: 0.98      # långsam decay → stabil steady-state
iClamp: 0.95      # max 95% duty från integralen
```

### PWM-exekvering
- 10%-upplösning via 2-cykelsmodell (2 × 5-min fönster)
- duty 0% → ingen burst, hw target = baseTarget
- duty 100% → ingen revert, håll 0°C hela cykeln
- duty 10-90% → burst 0°C i N sekunder, revert till baseTarget

### Förenklingar
- `pwm_stable_count` — borttagen (PWM körs alltid)
- Separat `DUTY_LEARN` — borttagen (integralen ÄR steady-state)
- Separat `PWM_FEEDBACK` — borttagen (PID-loopen styr duty direkt)
- Rate-limits, proximity dampening — ej nödvändiga för duty (0–1 range)

### Migration
- Befintlig `steady_state_duty`-data seedar integralen vid första körning
- Integraler > 1.0 (gamla °C-baserade) detekteras och konverteras automatiskt
