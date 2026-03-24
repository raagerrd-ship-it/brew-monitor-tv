


## Unified PID-to-Duty-Cycle Controller (Implemented)

### Arkitektur
```text
Profil → Dual Sensor → actual_temp → PID (actual_target - actual_temp) → duty cycle (0–100%) → PWM burst varje 5-min cykel
                                                                           ├─ 0°C i (duty% × 300)s (cooling)
                                                                           ├─ maxTemp i (duty% × 300)s (heating)
                                                                           └─ actualTarget resten av cykeln
```

### Hur det fungerar
- **PID error** = `actualTarget - actualTemp` (samma domän som användaren ser)
- **actualTemp** = avg(pill, probe) om dual-sensor är aktivt, annars probe/pill ensam
- **actualTarget** = profile_target_temp (användarens mål)
- Ingen baseTarget/sensorDelta-translation behövs — PID arbetar direkt i user-facing domänen

- **Cooling**: PID output = duty cycle (0.0–1.0). Hardware styrs via PWM-bursts.
  - Stor error (> 2°C): duty = 100% (full kylning)
  - Proportionell zon: duty = clamp(|error| × 0.5 + integral, 0, 1.0)
  - Deadband (±0.1°C): duty = integral (inlärd steady-state)
  - Overcooled: duty = 0%, integral dämpas
  - D-term: dämpar P-termen nära mål (integral opåverkad)

- **Heating**: Speglad PWM-logik med maxTemp som ON-target

### PID-parametrar (cooling/heating duty)
```
pGain: 0.5        # duty per °C error
iGain: 0.05       # duty per cykel per °C
iDecay: 0.98      # långsam decay → stabil steady-state
iClamp: 0.95      # max 95% duty från integralen
```

### PWM-exekvering
- 10%-upplösning via 2-cykelsmodell (2 × 5-min fönster)
- duty 0% → ingen burst, hw target = actualTarget
- duty 100% → ingen revert, håll 0°C/maxTemp hela cykeln
- duty 10-90% → burst i N sekunder, revert till actualTarget

### Förenklingar (senaste)
- `baseTarget` / `sensorDelta` — borttagna (PID arbetar direkt mot actual_temp/actual_target)
- `probe-domain translation` — borttagen (onödig med duty-cycle output)
- `pwm_stable_count` — borttagen (PWM körs alltid)
- Separat `DUTY_LEARN` — borttagen (integralen ÄR steady-state)

### Migration
- Befintlig `steady_state_duty`-data seedar integralen vid första körning
- Integraler > 1.0 (gamla °C-baserade) detekteras och konverteras automatiskt
