---
name: Hold-lock dither settle-time
description: I dither-zonen (prevDuty 1-9%) låses duty i 15 min när |avgError|<0.15°C så aktuatorn hinner leverera minst en burst innan PID re-evaluerar. Bryts vid |err|>0.25°C eller mode-switch.
type: feature
---
PWM-hårdvaran levererar 1% upplösning via 10-slot × 5-min = 50-min dither-fönster. PID re-evaluerar var 5:e min — dvs. 10 beslut per fullt fönster. Utan lock beslutar PID på burst-brus och inte på faktisk termisk respons, vilket skapar låg-amplitud oscillation (~±0.15°C, ~2h period).

**Logik (i `pid-compensation.ts`, efter slew-cap):**
- Enter: `isHold && prevDutyFrac ∈ (0, 10%) && |avgError| < 0.15°C && !modeJustSwitched` → sätt `holdLockUntil = now + 15 min`, `holdLockDuty = lastDutyFrac`. Constraint `hold-lock-enter(15m@X%)`.
- Active: medan låst → `duty = holdLockDuty`, `nextI` capad till `persistedIntegral` (anti-windup). Constraint `hold-lock(remaining_min@X%)`.
- Break: `modeJustSwitched || |avgError| > 0.25°C` → nolla lock. Constraint `hold-lock-break` (bara om aktiv).

**State (V5PidState):** `holdLockUntil?: string`, `holdLockDuty?: number`. Persisteras i `sensor_anchor` JSONB.

**Interaktion med andra guards:**
- Kör EFTER slew-cap — hold-lock är en output-override, inte en gain-modifierare.
- Kör FÖRE peak-detection så `dutyPct` speglar det låsta värdet.
- I-termen fryses under lock (som i min-off/util-sat) så pressure inte byggs mot en respons vi inte lyssnar på.
- 3 PID-cykler (15 min) räcker för ~1 dither-fönster faktisk termisk respons på probe/pill.

**Ändras inte:** slew-cap (5%), deadband (±0.10°C), min-off (5 min), `d-suppress-dither`, `stall-freeze-dither`. Hold-lock ligger ovanpå dessa.