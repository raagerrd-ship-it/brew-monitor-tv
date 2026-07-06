## Översyn av trickle-lösningen

### Svar först: ja, konceptet är bra

Trickle-adjust matchar exakt det du beskrev — 1%-steg per 15-min-fönster, väntar hela fönstret innan nästa utvärdering, ratchetar bara i "säker" riktning så vi inte studsar upp på burst-brus. Tillsammans med drift-break (0.15°C) och err-break (0.25°C) släpper låset direkt om systemet svänger på riktigt. Det är rätt design.

**MEN** — det finns en sign-bugg som gör att trickle-grenen aldrig fyras av just nu.

### Bugg: fel tecken på past-target-checken

`avgError` definieras som `actualTarget - actualTemp`:
- Cooling past-target (för kall, actual < target) → `avgError > 0`
- Heating past-target (för varm, actual > target) → `avgError < 0`

Nuvarande kod (rad 591–592):
```
(input.mode === 'cooling' && avgError < -0.05 && dutyDelta < 0) ||
(input.mode === 'heating' && avgError > 0.05 && dutyDelta > 0)
```

Båda tecknen är inverterade. Resultat: trickle-grenen träffar aldrig, fall-through till `duty = holdLockDuty!` → 6% ligger fast, precis som du observerade.

Det förklarar också varför den tidigare "ratchet"-versionen (innan trickle) inte heller sänkte — samma sign-bugg.

### Fix

Byt villkoret till en enda modell-agnostisk kontroll som speglar `past-target-soft` (rad 413, som använder `need <= 0`):

```
const pastTargetDown = need < -0.05 && dutyDelta < 0
```

`need = isCooling ? -avgError : avgError`, så `need < -0.05` = "vi är kallare/varmare än vi vill vara med >0.05°C marginal" i BÅDA lägen. Och `dutyDelta < 0` = "PID vill ha lägre duty" i båda lägen (mindre kyl eller mindre värme).

### Ingen annan krock

Genomgick alla PID-block som körs före hold-lock (rad 262–551):

- **db-follow-i** (rad 505): sätter `duty = nextI` i hold+deadband. Trickle jämför sedan mot `holdLockDuty` — går ner mot lärd steady-state. OK.
- **past-target-soft** (rad 413): sänker duty mot `nextI` när `need <= 0`. Konsekvent med trickle-riktning.
- **slew-cap** (rad 540): ±5%/cykel körs FÖRE hold-lock. Trickle strängar sedan ytterligare till ±1%. OK.
- **min-off** (rad 522): kan sätta duty=0 vid re-start. Om lock aktivt och inte past-target → hold-lock skulle skriva över tillbaka till holdLockDuty. Men min-off triggas bara när `duty > 0` inom min-off-fönstret, vilket kräver att vi nyss varit på 0 — under aktivt lås händer inte det, så ingen praktisk krock.
- **util-sat-cap** (rad 513), **stall-boost/cool-boost** (rad 449/499), **full-action** (rad 444): alla kräver `need > 0` (mer aktion behövs) — motsatsen till past-target. Kan inte krocka.
- **peak-detection** (rad 621): armas när duty går från >0 till 0. Trickle 6→5→4→…→0 triggar peak-arm precis som förr. OK.
- **I-term freeze** (`nextI = Math.min(nextI, persistedIntegral)` rad 603): anti-windup medan låst — förhindrar pressure-buildup mot en respons vi inte lyssnar på. Rätt.

### Sanity: vad händer om trenden vänder mitt i trickle?

Säg vi trickle 6→5→4, sedan börjar temp stiga tillbaka mot target:
- `dutyDelta` blir positivt (PID vill upp) → trickle firar inte → duty=4% ligger fast.
- Om temp fortsätter mot target och överskrider den (`avgError < -0.15` motsatt håll) → `driftSinceLock > 0.15°C` sedan trickle-refresh → **hold-lock-break(drift)** → PID fritt igen (slew-cap 5%/cykel).
- Om avvikelsen växer till `|avgError| > 0.25` → **hold-lock-break(err)** → samma.

Så låset släpper snyggt om vi trickle-at för långt.

### Ändring

En 1-ordersfix i `supabase/functions/_shared/pid-compensation.ts`:

Ersätt rad 590–592:
```
const pastTargetDown =
  (input.mode === 'cooling' && avgError < -0.05 && dutyDelta < 0) ||
  (input.mode === 'heating' && avgError > 0.05 && dutyDelta > 0)
```
med:
```
const pastTargetDown = need < -0.05 && dutyDelta < 0
```

Uppdatera minnesfilen `hold-lock-dither-settle.md` med rätt villkor (`need < -0.05` istället för mode-specifika avgError-tecken).

Inga andra PID-block behöver röras.
