

# Granskning av regleringskoden — Optimeringsmöjligheter

## Sammanfattning

Koden är funktionellt korrekt men har flera ställen med onödiga DB-frågor, död kod, och suboptimal ordning. Här är de viktigaste fynden:

---

## 1. Dubbla DB-frågor för termisk hastighet (ONÖDIGT)

**Problem:** `runPidControl` hämtar redan `thermal_rate_heating`, `thermal_rate_cooling` och bucket-varianter från `fermentation_learnings` (rad 330-348). Men sen anropar `calculateCompensatedTarget` → `learnThermalRate` som gör **egna separata queries** mot samma tabell + `temp_controller_history` (200 rader!).

**Effekt:** 3-4 extra DB-frågor per controller per cykel (~6 onödiga queries per 5-min cykel med 2 controllers).

**Fix:** Skicka de redan hämtade värdena till PID-funktionen istället för att låta den hämta igen. Alternativt flytta `learnThermalRate` till en separat fas som körs sällan (var 30 min istället för var 5 min).

---

## 2. `temp_delta_history`-query i PID är redundant

**Problem:** PID:n hämtar `temp_delta_history` (rad 116-121) för två saker:
- **Stale-detection**: jämför senaste mätning vs senaste PID-körning
- **Pill rate**: beräknar temperaturhastighet för ramp-boost

Men stale-detection görs redan bättre i `controller-adjustments.ts` via `fc.last_update` / `staleMinutes`. Och pill rate hämtas från historiken men `actualTemp` (SSOT) är tillgänglig direkt.

**Fix:** Flytta stale-detection till anroparen (redan finns `staleMinutes`). Skicka `isStaleData` som parameter till PID.

---

## 3. Död kod: `MODE_PARAMS` aldrig använd

**Problem:** `pid-compensation.ts` rad 56-81 definierar `MODE_PARAMS` med `pGain`, `iGain`, `iDecay` etc. Men den faktiska PID-beräkningen använder **hardkodade konstanter** `DUTY_P=0.5`, `DUTY_I=0.15`, `DUTY_DECAY=0.98` (rad 210-213).

**Fix:** Ta bort `MODE_PARAMS` helt — det är vilseledande att ha två uppsättningar tuning-konstanter.

---

## 4. Död parameter: `_unused` och `settings`

**Problem:** `calculateCompensatedTarget` tar emot `_unused` (tidigare `profileTarget`) och `settings: PillCompensationSettings` — ingen av dem används. `loadPillCompSettings` är markerad deprecated men anropas fortfarande.

**Fix:** Ta bort `_unused`, `settings`-parametern och `loadPillCompSettings`.

---

## 5. Dubbel in-memory target-synk

**Problem:** `runProcessors` (rad 131-136) synkar `target_temp` i minnet efter varje processor. Sen gör `runControllerAdjustments` (rad 75-80) exakt samma synk igen.

**Fix:** Ta bort den yttre synken i `runControllerAdjustments` — den inre i `runProcessors` räcker.

---

## 6. `learnRateCore` cache-check gör alltid en DB-fråga

**Problem:** Cache-logiken (rad 416-428) gör en `SELECT` mot `fermentation_learnings` varje cykel bara för att kolla om cachen är < 2 timmar gammal. Sedan, om den INTE är cachad, gör den ytterligare en `SELECT` mot `temp_controller_history` (200 rader).

**Fix:** Flytta thermal rate learning till en separat bakgrundsjobb (t.ex. var 30 min via cron) istället för att köra det varje PID-cykel. PID:n kan bara läsa det sparade värdet.

---

## 7. `calculateSingleUtilization` sekventiell per controller

**Problem:** Rad 571 — utilization beräknas sekventiellt i loopen. Varje anrop gör en DB-fråga. Med 2+ controllers kan dessa köras parallellt.

**Fix:** Flytta utilization-beräkning till en parallell pre-fetch innan controller-loopen.

---

## Prioritering

| # | Påverkan | Komplexitet | Rekommendation |
|---|----------|-------------|----------------|
| 1 | Hög (6+ onödiga queries/cykel) | Medel | Skicka redan hämtade rates till PID |
| 2 | Medel (2 onödiga queries/cykel) | Låg | Flytta stale-detection till anropare |
| 3 | Låg (ren kod) | Låg | Ta bort MODE_PARAMS |
| 4 | Låg (ren kod) | Låg | Ta bort döda parametrar |
| 5 | Låg (ren kod) | Låg | Ta bort dubbel synk |
| 6 | Medel (cache-overhead) | Medel | Separera learning från PID-cykel |
| 7 | Låg-Medel | Medel | Parallellisera utilization |

Vill du att jag implementerar dessa? Jag rekommenderar att börja med punkt 1-4 (störst effekt, lägst risk).

