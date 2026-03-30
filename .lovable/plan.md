

# Kodgranskning — Optimeringsmöjligheter

## Sammanfattning

PI-regulatorn och PWM-exekveringen är nu rena och välstrukturerade. De största optimeringsmöjligheterna ligger i **cooler-management.ts** (1389 rader) och **onödiga databasanrop** som körs varje 5-minuterscykel.

---

## 1. Utilization-tracking: Massiva DB-anrop per cykel (STOR VINST)

`calculateSingleUtilization` gör **8 DB-anrop** (getLearnedParam × 8) bara för att läsa util-historiken, plus upp till **8 skrivningar** vid varje data-shift. Med 3 controllers = **48 DB-anrop bara för utilization**.

**Problem:** Alla 8 parametrar (util_p4_run_time, util_p4_at, util_anchor_run_time, etc.) lagras som separata rader i `fermentation_learnings`. Varje kräver en egen query.

**Fix:** Slå ihop till EN JSON-kolumn eller EN rad med alla util-fält. Alternativt: batch-läs alla util-parametrar i en enda IN-query istället för 8 separata anrop.

**Estimat:** Sparar ~40 DB-anrop per cykel.

---

## 2. cooler-management.ts — Duplicerade DB-queries

`runCoolerCooling` anropar `calculateSingleUtilization` för kylaren (rad 140), sedan anropas `calculateCoolingUtilizations` (rad 201) som i sin tur anropar `calculateSingleUtilization` igen för varje controller — **inklusive** samma controllers som PID redan beräknade utilization för i `controller-adjustments.ts` (rad 580).

**Fix:** Beräkna utilization EN gång i PID-steget, skicka med via context. Kylaren återanvänder.

**Estimat:** Halverar antalet util-beräkningar (och deras 8 DB-anrop var).

---

## 3. `learnFromCurrentState` — Överdriven inlärningsgranularitet

Systemet lär sig marginaler i **3 dimensioner**: tempBucket × loadBucket × activityBucket, plus generiska varianter av varje. Det innebär att `learnFromCurrentState` gör **6+ `updateLearnedParam`-anrop** per cykel.

**Problem:** Med ett litet bryggeri (2–3 controllers) konvergerar dessa aldrig ordentligt. Du behöver hundratals cykler per bucket-kombination för meningsfull data.

**Fix:** Ta bort activityBucket-dimensionen. Behåll bara `tempBucket` för marginaler. Sparar 2 DB-anrop per cykel + ger snabbare konvergens.

---

## 4. Temperaturinterpolation — Bör ligga i pid-compensation.ts

Interpolationslogiken (rad 318–362 i controller-adjustments.ts) läser 8 parametrar från `fermentation_learnings` via en batch-query (bra!), men den duplicerar mode-detektionslogik som PID redan gör. Den borde vara en del av PID-beräkningen, inte en pre-processing i controllern.

**Fix:** Flytta interpolation in i `calculateCompensatedTarget` — den har redan tillgång till `deltaHistory` och mode. Förenklar controller-adjustments och eliminerar den separata batch-queryn.

---

## 5. `measureCoolingRate` anropas dubbelt

`measureCoolingRate` körs för kylaren (rad 144), sedan igen i `learnFromCurrentState` (rad 1092), och potentiellt en tredje gång i `learnMinEffectiveMargin` (rad 1230). Varje anrop gör en DB-query mot `temp_controller_history`.

**Fix:** Cache resultatet i context.

---

## 6. Mode-switching — Komplex men korrekt

Mode-switching-logiken (rad 408–520 i controller-adjustments.ts) är ~110 rader med många branches. Den är **korrekt** och hanterar edge cases väl (step-change, emergency, ramp override). Kan förenklas till ~60 rader med en state-machine approach, men risken är högre än vinsten.

**Rekommendation:** Lämna — fungerar och är väl loggrundad.

---

## 7. `PillCompensationSettings` — Vestigial interface

`PillCompensationSettings` med fält som `rateLimit`, `emergencyThreshold`, `minScale`, `maxCompensation`, `anticipationWindowHours` används inte längre i `calculateCompensatedTarget`. Hela interfacet och `loadPillCompSettings` gör en onödig DB-query varje cykel.

**Fix:** Ta bort interfacet, queryn, och parametern. PID:n använder sina hårdkodade gains.

---

## Prioriterad plan

| Steg | Vad | Risk | DB-besparing |
|------|-----|------|-------------|
| 1 | Batch-läs util-parametrar i EN query | Låg | ~40 anrop/cykel |
| 2 | Dela util-beräkning mellan PID och cooler via context | Låg | ~24 anrop/cykel |
| 3 | Ta bort activityBucket från marginalinlärning | Låg | ~6 anrop/cykel |
| 4 | Ta bort PillCompensationSettings (vestigial) | Låg | 1 query/cykel |
| 5 | Cache measureCoolingRate per controller | Låg | 2–3 queries/cykel |
| 6 | Flytta interpolation till pid-compensation (refaktorering) | Medel | Bättre struktur |

**Total estimerad besparing: ~70 DB-anrop per 5-minuterscykel**, vilket minskar latens och Supabase-kostnad.

