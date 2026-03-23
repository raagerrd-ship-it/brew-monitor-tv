

## PWM 10%-upplösning med 2-cykelsmodell

### Koncept
Nuvarande: 5-min cykel, 1-min upplösning → **6 steg** (0, 20, 40, 60, 80, 100%).
Nytt: 10-min fönster (2 × 5-min cykler), alternerar burst-längd → **11 steg** (0, 10, 20, …, 90, 100%).

Exempel:
- **30%** = 3 min / 10 min → Cykel A: 2 min burst, Cykel B: 1 min burst
- **10%** = 1 min / 10 min → Cykel A: 1 min burst, Cykel B: 0 min (ingen burst)
- **50%** = 5 min / 10 min → Cykel A: 3 min, Cykel B: 2 min

### Fas-bestämning
Använd tidsstämpel: `Math.floor(Date.now() / 300000) % 2` ger fas 0 eller 1. Ingen extra DB-kolumn behövs.

### Ändringar

**1. `controller-adjustments.ts` — kvantisering + burst-beräkning**
- Kvantisera till 10%-steg: `Math.round(duty * 10) * 10`
- Beräkna total burst för 10 min: `totalBurstMin = dutyPct / 10` (0–10 min)
- Fördela på fas A/B: `fasA = Math.ceil(total/2)`, `fasB = Math.floor(total/2)`
- Välj aktuell fas burst-längd baserat på tidsstämpeln

**2. `execute-pwm-off/index.ts`** — inga ändringar behövs (hanterar redan godtyckliga burst-längder)

**3. `LearnedDutyCycle.tsx` — UI**
- Uppdatera kvantisering till 10%-steg, 10-segmenterad bar istället för 5
- Uppdatera fotnot: "PWM kvantiseras i 10%-steg över 2 × 5-min cykler"

**4. `AutoCoolingDecisionLogs.tsx` + `AutomationFeatureStatus.tsx`**
- Visa nya procentsatser (redan visar `duty%`, bara siffrorna ändras)

### Risker
- Om en cykel missas (timeout) hinner systemet fortfarande korrigera nästa 5-min fönster — degraderar graciöst till ~20%-upplösning för den perioden
- Ingen breaking change — alla befintliga 20%-värden (0, 20, 40, 60, 80) mappas exakt till nya stegen

