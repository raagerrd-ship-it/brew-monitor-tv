---
name: Hold-lock dither settle-time
description: I dither-zonen (prevDuty 1-9%) låses duty i 15 min när |avgError|<0.15°C så aktuatorn hinner leverera minst en burst innan PID re-evaluerar. Bryts vid |err|>0.25°C eller mode-switch.
type: feature
---
PWM-hårdvaran levererar 1% upplösning via 10-slot × 5-min = 50-min dither-fönster. PID re-evaluerar var 5:e min — dvs. 10 beslut per fullt fönster. Utan lock beslutar PID på burst-brus och inte på faktisk termisk respons, vilket skapar låg-amplitud oscillation (~±0.15°C, ~2h period).

**Logik (i `pid-compensation.ts`, efter slew-cap):**
- Enter: `isHold && prevDutyFrac ∈ (0, 10%) && |avgError| < 0.15°C && !modeJustSwitched` → sätt `holdLockUntil = now + 15 min`, `holdLockDuty = lastDutyFrac`. Constraint `hold-lock-enter(15m@X%)`.
- Enter: sätter dessutom `holdLockBaseline = ssotFiltered` som referens för drift-brytet.
- Active: medan låst → `duty = holdLockDuty`, `nextI` capad till `persistedIntegral` (anti-windup). Constraint `hold-lock(remaining_min@X%,drift=Y°)`.
- Break: `modeJustSwitched || |avgError| > 0.25°C || drift > 0.15°C` sedan lock-entry → nolla lock. Constraint `hold-lock-break(reason)` med reason ∈ {drift, err, mode}.
- **Trickle-adjust (bidirektionell 1%-step)**: Ett steg per 15-min-fönster i endera riktning mot PID:s önskade duty. `trickleOk = (need < -0.05 && dutyDelta < 0) || (need > 0.05 && dutyDelta > 0)` — dvs. sänk vid past-target, höj vid under-action. Kräver |dutyDelta| ≥0.5%. Efter steget: `holdLockDuty = ny nivå`, `holdLockUntil` refreshas 15m, `holdLockBaseline = ssotFiltered`. Ger mjuk 6→5→4→3 eller 6→7→8 (ett steg per 15 min = 3 PID-cykler) utan studs på burst-brus. Constraint `hold-lock-trickle(±1%→X%)`. Bidirektionell så en mild drift åt fel håll under lås kan korrigeras innan err/drift-break krävs.
- **Sign-notering**: `avgError = actualTarget - actualTemp`. Använd ALLTID `need` (mode-normaliserad) för past-target-villkor — direkta avgError-tecken är inverterade mellan cooling och heating och lätta att slarva med.

**Drift-brytet (`HOLD_LOCK_DRIFT_EXIT = 0.15°C`)** är sensor-cadence-agnostiskt: jämför två EMA-filtrerade SSOT-värden istället för momentan rate. Rate-baserad break är opålitlig eftersom probe (15-min-cadence) och pill (1-min-cadence) blandas in i SSOT — 5-min-rate domineras av pill-rörelse medan probe är stale. Drift sedan baseline fångar sustained trend oavsett vilken sensor som ledde.

**State (V5PidState):** `holdLockUntil?: string`, `holdLockDuty?: number`. Persisteras i `sensor_anchor` JSONB.

**Interaktion med andra guards:**
- Kör EFTER slew-cap — hold-lock är en output-override, inte en gain-modifierare.
- Kör FÖRE peak-detection så `dutyPct` speglar det låsta värdet.
- I-termen fryses under lock (som i min-off/util-sat) så pressure inte byggs mot en respons vi inte lyssnar på.
- 3 PID-cykler (15 min) räcker för ~1 dither-fönster faktisk termisk respons på probe/pill.
- **Convergence-gate matchar kontroll-loopen**: `persistPidState` får `filteredAvgError = actualTarget - r.nextState.ssotSmoothed` (fallback till raw om smoothing saknas), inte raw `avgError`. Annars kan en enstaka brusig raw-sample hålla oss utanför 0.10°-fönstret trots att hold-lock håller stabilt → learned baseline missar just de steady-state-perioder låset är byggt för att producera.

**Ändras inte:** slew-cap (5%), deadband (±0.10°C), min-off (5 min), `d-suppress-dither`, `stall-freeze-dither`. Hold-lock ligger ovanpå dessa.