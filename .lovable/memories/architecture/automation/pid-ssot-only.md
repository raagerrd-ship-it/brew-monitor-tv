---
name: PID SSOT-only sensor rule
description: PID controller reads exclusively actual_temp — no probe/pill/current_temp usage anywhere in PID logic or stability gates.
type: constraint
---
# PID: actual_temp är enda sensorkällan

Alla PID- och regleringsbeslut (gain, integral, mode-switch, stability-gates, ramp-slut, stale-freshness) läser **enbart `actual_temp` (SSOT)**.

## Förbjudet
- Läs `current_temp` (probe) eller `pill_temp` in i PID-beräkning, integral-bleed, deadband, D-brake, mode-switch eller slew-cap.
- Låt probe-ålder (`current_temp_updated_at`) styra PI-gain eller stale-cap. Använd `controllers.last_update` som SSOT-färskhet.
- Kräv probe-adherence i step-advancement (`checkStabilityWindow`). Endast `actual_temp` mot ±0.1°C.

## Tillåtet
- `controller-adjustments.ts` **fallback** när `actual_temp` är NULL: bygg SSOT från raw sensorer enligt dual/pill/probe-config. Detta är SSOT-konstruktion, inte PID-input.
- RAPT-hardware-kommandon (revert/suppress) får läsa `current_temp` för att sätta hw-target relativt intern probe. Detta rör aldrig PID-loopen.

## Varför
Multi-sensor-heuristik i PID (pill-top-cap, bottom-stop, probe-stale-cap) orsakade stratifierings-windup, mode-deadlock och bias. V5 kör single-input PI på SSOT — resten är osäkerhet PID inte ska agera på.
