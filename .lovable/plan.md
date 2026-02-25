

## Arkitekturförbättring: profile_target_temp som lagrad data

### Problem
`record-temp-history` beräknade ramp-interpolering själv, men fick fel resultat (hoppade direkt till slutmålet 19°C istället för det interpolerade mellanvärdet ~16°C).

### Lösning
Eliminerade ALL beräkningslogik från `record-temp-history`. Istället:

1. **Ny kolumn**: `rapt_temp_controllers.profile_target_temp` — lagrar det aktuella profilmålet (före PID-justering)
2. **Skrivare**: `process-fermentation-profiles` skriver `profile_target_temp` till controllern vid varje temperaturändring (hold, ramp, wait_for_temp, diacetyl_rest)
3. **Läsare**: `record-temp-history` läser bara av `profile_target_temp` från controllern — noll beräkningar

### Dataflöde
```
process-fermentation-profiles → rapt_temp_controllers.profile_target_temp
                                        ↓ (läs av)
record-temp-history → temp_controller_history.profile_target_temp
                                        ↓ (läs av)
brew-snapshots → brew_data_snapshots.profile_target_temp
                                        ↓ (läs av)
render-brew-chart → SVG mållinje
```

### Ställen som skriver profile_target_temp
- `applyPillCompensation()` — hold, wait, diacetyl (skriver `profileTarget`)
- Immediate ramp — `currentStep.target_temp`
- Linear ramp (target reached) — `currentStep.target_temp`
- Linear ramp (intermediate) — `Math.round(newTarget * 10) / 10`
- wait_for_temp — `currentStep.target_temp`
- diacetyl_rest (direct set) — `diacetylTarget`
