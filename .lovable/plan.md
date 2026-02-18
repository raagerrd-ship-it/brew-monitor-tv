

# Pill-kompensation med medelvärdes-targeting (delta/2)

## Vad ändras

Istället för att sätta controllern direkt till profilens mål-temperatur (t.ex. 22°C), beräknas en kompenserad target så att **medelvärdet av pill (yta) och probe (kärna) = profilmålet**. Detta ger en fysikaliskt korrekt kompensation som automatiskt anpassar sig.

## Beräkning

```text
profileTarget = 22°C
averageDelta = medelvärde av senaste 3 delta-mätningar (t.ex. 3.1°C)
compensation = averageDelta / 2 = 1.55°C
compensatedTarget = 22 - 1.55 = 20.45°C

Verifiering: (ctrl 20.45 + pill 23.55) / 2 = 22.0°C ✓

Begränsningar:
- Max 0.3°C ändring per cykel (5 min) -- förhindrar ryck
- Aldrig mer än 5°C under profileTarget -- säkerhetsgolv
- Kompensation bara vid positivt delta (pill varmare än probe)
```

## Flöde per cykel

```text
Cykel 1 (start): target=22°C, delta=3.1°C
  kompensation = 3.1 / 2 = 1.55°C
  nyTarget = 22 - 1.55 = 20.45°C
  rate-limit: max 0.3°C nedåt -> sätter 21.7°C

Cykel 2: target=21.7°C, delta=~3.0°C
  kompensation = 3.0 / 2 = 1.5°C
  nyTarget = 22 - 1.5 = 20.5°C
  rate-limit: max 0.3 nedåt -> sätter 21.4°C

... (gradvis nedåt tills jämvikt)

Cykel N (jäsning avtar): delta=~1.0°C
  kompensation = 1.0 / 2 = 0.5°C
  nyTarget = 22 - 0.5 = 21.5°C

Cykel N+X (jäsning klar): delta=~0°C
  kompensation = 0
  target kryper tillbaka till 22°C
```

## Tekniska ändringar

### `process-fermentation-profiles/index.ts`

Hjälpfunktion `calculateCompensatedTarget`:
- Hämtar senaste 3 delta-mätningar från `temp_delta_history`
- Beräknar medelvärde (avgDelta)
- Kompensation = avgDelta / 2 (medelvärdes-targeting)
- Rate-limitar till max 0.3°C ändring per cykel
- Säkerhetsgolv: max 5°C under profilmål
- Returnerar kompenserad target

Används på tre ställen:
1. **Enforce-logik** (steg utan explicit target_temp)
2. **Hold-steg** (steg med target_temp)
3. **original_target_temp**: Sätts alltid till profilens VERKLIGA mål

### Loggning

Kompensationen loggas i `auto_cooling_adjustments` med reason-prefix "🎯 Pill-kompensation":
```text
🎯 Pill-kompensation: 22.0°C -> 20.5°C (delta=3.10, komp=delta/2=1.55°C)
```

## Inställningar (auto_cooling_settings)

- `pill_compensation_enabled`: På/av-toggle
- `pill_compensation_rate_limit`: Max °C ändring per cykel (default 0.3)
- `pill_compensation_damping`: Ej längre aktivt använd (delta/2 används istället)

## Deployment

Deploya `process-fermentation-profiles` efter ändringar.
