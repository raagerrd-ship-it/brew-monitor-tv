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
- Break: `modeJustSwitched || |avgError| > 0.25°C || drift > 0.25°C` sedan lock-entry → nolla lock. Constraint `hold-lock-break(reason)` med reason ∈ {drift, err, mode}. Drift- och err-tröskeln matchar symmetriskt så låset håller kvar tills något är påtagligt fel.
- **Trickle-adjust (bidirektionell 1%-step, cooldown-gated)**: Ett steg per 15-min-fönster i endera riktning mot PID:s önskade duty. `trickleOk = (need < -0.05 && dutyDelta < 0) || (need > 0.05 && dutyDelta > 0)` — sänk vid past-target, höj vid under-action. Kräver |dutyDelta| ≥0.5% OCH `minsSinceTrickle >= HOLD_LOCK_MIN` (15 min). **Kritiskt**: `holdLockUntil`-refreshen räcker INTE som gate — lockActive-checken passerar varje PID-cykel (5 min) så utan explicit `holdLockLastTrickleAt`-cooldown skulle trickle fira 6→5→4→3 på tre cykler (15 min totalt) istället för 3×15 min = 45 min. Vid lock-entry sätts `holdLockLastTrickleAt = now` så första trickle sker tidigast efter 15 min. Efter varje steg uppdateras `holdLockLastTrickleAt`, `holdLockDuty`, `holdLockUntil` (+15m), `holdLockBaseline = ssotFiltered`. Constraint `hold-lock-trickle(±1%→X%)`.
- **Rate-aware trickle (preventiv, cooling+heating)**: När position-trickle inte fyras (|need| ≤ 0.05, dvs. i deadband) och `ssotSmoothed` hållbart driftar mot past-target-hållet, fira en 1%-sänkning för att stoppa överskjutning innan drift-break vid 0.25°. Villkor: `progressToPastTarget = (isCooling ? -driftRateCph : driftRateCph) > HOLD_LOCK_RATE_TRICKLE (0.10°C/h)`, `dutyDelta < -0.005` (PID vill lägre), full cooldown (`trickleCooldownOk`), och `minsSinceTrickle > 5` för stabil rate. Rate mäts som `(ssotFiltered - holdLockBaseline) * 60 / minsSinceTrickle` — baseline är stabil anchor (satt vid lock-entry/trickle) så rate blir 15-min-glidande, inte single-cycle EMA-brus. Rate-trickle får INTE använda `approachingBreak`-bypassen (kräver alltid full 15-min cooldown). Constraint `hold-lock-rate-trickle(-1%→X%,rate=Y°/h)`.
- **Sign-notering**: `avgError = actualTarget - actualTemp`. Använd ALLTID `need` (mode-normaliserad) för past-target-villkor — direkta avgError-tecken är inverterade mellan cooling och heating och lätta att slarva med.

**Drift-brytet (`HOLD_LOCK_DRIFT_EXIT = 0.25°C`, symmetriskt med err-break)** är sensor-cadence-agnostiskt: jämför två EMA-filtrerade SSOT-värden istället för momentan rate. Rate-baserad break är opålitlig för break-beslut eftersom probe (15-min-cadence) och pill (1-min-cadence) blandas in i SSOT — 5-min-rate domineras av pill-rörelse medan probe är stale. Drift sedan baseline fångar sustained trend oavsett vilken sensor som ledde. Rate-trickle använder däremot 15-min-baseline-rate (inte single-cycle) → tillräckligt stabilt för preventiv 1%-sänkning innan break behövs.

**State (V5PidState):** `holdLockUntil?: string`, `holdLockDuty?: number`, `holdLockBaseline?: number`, `holdLockLastTrickleAt?: string`. Persisteras i `sensor_anchor` JSONB. Alla fyra nollas vid `hold-lock-break`.

**Interaktion med andra guards:**
- Kör EFTER slew-cap — hold-lock är en output-override, inte en gain-modifierare.
- Kör FÖRE peak-detection så `dutyPct` speglar det låsta värdet.
- **I-termen fryses under lock** — `prevLockActive` (från förra cykelns state) beräknas tidigt och gate:ar db-conv-up/db-conv-dn/deadband-bleed/i-zone/overshoot-bleed/coast-i-bleed. Utan denna gate äter dessa block ur I-termen medan duty är pinnad → `|dutyCycle - iCorrection|` växer och convergence-gaten i `persistPidState` missar just de steady-state-sampels låset ska producera. Constraint `lock-freeze-i` loggas när gaten är aktiv. Den senare `Math.min(nextI, persistedIntegral)`-clampen är belt-and-suspenders (skyddar mot growth), inte primärskydd.
- 3 PID-cykler (15 min) räcker för ~1 dither-fönster faktisk termisk respons på probe/pill.
- **Convergence-gate matchar kontroll-loopen**: `persistPidState` får `filteredAvgError = actualTarget - r.nextState.ssotSmoothed` (fallback till raw om smoothing saknas), inte raw `avgError`. Annars kan en enstaka brusig raw-sample hålla oss utanför 0.10°-fönstret trots att hold-lock håller stabilt → learned baseline missar just de steady-state-perioder låset är byggt för att producera.

**Ändras inte:** slew-cap (5%), deadband (±0.10°C), min-off (5 min), `d-suppress-dither`, `stall-freeze-dither`. Hold-lock ligger ovanpå dessa.