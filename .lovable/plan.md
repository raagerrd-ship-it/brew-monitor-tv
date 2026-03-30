

# Systemkonfiguration & designbeslut

## RAPT Hysteres
Alla RAPT-controllers är konfigurerade med **5°C hysteres** (både kylning och värmning). Detta påverkar PWM-logiken:
- **Suppressionsmarginal**: `probe ± 2°C` ger 3°C buffert inom 5°C-hysteresen
- **PWM OFF revert**: Måste ta hänsyn till att RAPT triggar kylning/värmning vid `target ± 5°C`
- **DUTY_ZERO_SUPPRESS**: Sätter hw-mål under/över proben för att förhindra att RAPT:s interna termostat agerar

## Implementerade fixar

### PWM OFF revert-mål (2026-03-30)
- **Heating**: revert till `probeTemp - 2°C` (clampad mot min_target_temp)
- **Cooling**: revert baserat på probens position relativt target:
  - Probe > target + 0.3°: `probe + 2°C` (stoppa kylning)
  - Probe < target - 0.3°: `probe - 2°C` (stoppa värmning)
  - Probe ≈ target: `actualTarget`

### Deadband integral decay (2026-03-30)
- Decay-faktor 0.90 inom dödbandet (±0.05°C) för att eliminera residuala PWM-bursts

### Suppressionslogik: explicit probe-sensor (2026-03-30)
- Suppressions- och revert-mål baseras **alltid** på `fc.current_temp` (RAPT:s fysiska probe)
- Aldrig fallback till `actualTemp` (pill/fusion) — om probe saknas → neutral target + loggvarning
- Variabelnamn `raptProbeTemp` dokumenterar avsikten i koden
