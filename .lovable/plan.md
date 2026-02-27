

## Granskning: Smart diacetylvila (`gradual_ramp`) — ✅ Implementerad

### Genomförda förbättringar

1. ✅ **`ProfileStep`-typen utökad** — `diacetyl_rest`, `gradual_ramp`, `wait_for_acknowledgement` + fälten `attenuation_trigger`, `activity_trigger`, `temp_increase`, `min_ramp_hours`, `ramp_curve`
2. ✅ **Alla `(currentStep as any)` borttagna** — typade fält används direkt
3. ✅ **Notifikation vid ramp-trigger** — "Smart diacetylvila startad"
4. ✅ **Notifikation vid gradual_ramp-slutförande** — "Smart diacetylvila klar"
