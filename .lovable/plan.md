

# Pill-kompensation med dämpningsfaktor 0.4

## Vad ändras

Istället för att sätta controllern direkt till profilens mål-temperatur (t.ex. 22°C), beräknas en kompenserad target baserat på temperaturskillnaden mellan pill (ytan) och probe (kärnan). Detta gör att pill-temperaturen hamnar närmare profilens mål, utan att kärnan blir för kall.

## Beräkning

```text
profileTarget = 22°C
averageDelta = medelvärde av senaste 3 delta-mätningar (t.ex. 4.68°C)
compensation = averageDelta * 0.4 = 1.87°C
compensatedTarget = 22 - 1.87 = 20.13°C

Begränsningar:
- Max 0.3°C ändring per cykel (5 min) -- förhindrar ryck
- Aldrig mer än 5°C under profileTarget -- säkerhetsgolv
- Kompensation bara vid positivt delta (pill varmare än probe)
```

Med nuvarande delta (4.68°C) och target 22°C:
- Utan kompensation: controller = 22°C, pill = ~26.7°C
- Med kompensation: controller gradvis mot ~20.1°C, pill sjunker mot ~22°C
- Kärnan (proben) hamnar på ~20°C -- 2°C under mål, men pill (ytan) ligger rätt

## Tekniska ändringar

### `process-fermentation-profiles/index.ts`

Ny hjälpfunktion `calculateCompensatedTarget`:
- Hämtar senaste 3 delta-mätningar från `temp_delta_history` för denna controller
- Beräknar medelvärde
- Applicerar dämpningsfaktor 0.4
- Rate-limitar till max 0.3°C ändring från nuvarande target
- Returnerar kompenserad target

Ändras i tre ställen:
1. **Enforce-logik** (rad 264-335): Använd kompenserad target istället för `effectiveTarget` rakt av
2. **Hold-steg** (rad 341-355): Använd kompenserad target istället för `currentStep.target_temp`
3. **original_target_temp**: Sätts alltid till profilens VERKLIGA mål (22°C), inte den kompenserade

### `auto-adjust-cooling/index.ts`

- Ta bort den hårdkodade 3.0°C-tröskeln för profilstyrda controllers
- Återgå till standard-tröskel men beräkna mot `original_target_temp` (som redan görs)
- Overshoot blir säkerhetsnät -- pill-kompensationen hanterar det proaktivt

### Loggning

Kompensationen loggas i `auto_cooling_adjustments` med reason-prefix "🎯 Pill-kompensation" så det syns i UI:
```text
🎯 Pill-kompensation: 22.0°C -> 20.1°C (delta=4.68, komp=1.87°C)
```

## Flöde per cykel

```text
Cykel 1 (start): target=22°C, delta=4.68°C
  kompensation = 4.68 * 0.4 = 1.87°C
  nyTarget = 22 - 1.87 = 20.13°C
  rate-limit: max 0.3°C nedåt -> sätter 21.7°C
  original_target_temp = 22°C

Cykel 2: target=21.7°C, delta=~4.5°C
  kompensation = 4.5 * 0.4 = 1.8°C
  nyTarget = 22 - 1.8 = 20.2°C
  rate-limit: max 0.3 nedåt -> sätter 21.4°C

... (gradvis nedåt tills jämvikt)

Cykel N (jäsning avtar): target=20.2°C, delta=~1.0°C
  kompensation = 1.0 * 0.4 = 0.4°C
  nyTarget = 22 - 0.4 = 21.6°C
  rate-limit: max 0.3 uppåt -> sätter 20.5°C

Cykel N+X (jäsning klar): delta=~0°C
  kompensation = 0
  target kryper tillbaka till 22°C
```

## Deployment

Deploya båda edge functions efter ändringarna.

