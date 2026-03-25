

## Byt PID-kompensationsbaren till PWM Duty Cycle-bar

### Vad ändras

Den nuvarande "PID-kompensationsbaren" i TempStat visar hur mycket controllerns måltemperatur har justerats (±2°C). Eftersom systemet nu alltid kör PWM är det mer relevant att visa **duty cycle** (0–100%) med mode-indikation (❄️/🔥).

### Dataflöde

1. **Källa:** `auto_cooling_adjustments`-tabellen har redan `duty_pct` och `pid_mode` i PID-loggarna (🎯-poster).
2. **Befintlig hämtning:** `use-brew-data.ts` hämtar redan dessa poster (`pidMatch`) men extraherar bara `reason`-strängen.
3. **Nytt:** Extrahera `duty_pct` och `pid_mode` direkt från `pidMatch`-posten och lägg till på `BrewData`.

### Plan

**1. Utöka BrewData-typen** (`src/types/brew.ts`)
- Lägg till `dutyPct: number | null` och `dutyMode: 'cooling' | 'heating' | null`

**2. Hämta duty-data** (`src/hooks/use-brew-data.ts`)
- I befintlig overshoot/PID-fetch: parsa `duty_pct` och `pid_mode` ur `pidMatch.reason` (formatet `🎯 PID: ... duty=XX%...mode=cooling/heating`)
- Alternativt: utöka `select()` att inkludera `details`-kolumnen om den finns, eller parsa från reason-strängen som redan görs i controller-dialogen
- Mappa till `dutyPct` och `dutyMode` på brew-objektet

**3. Ersätt PID-baren med PWM-bar** (`src/components/brew-card/TempStat.tsx`)
- Byt ut `pidBar` (rad 214–300):
  - Skala: 0–100% (vänster till höger)
  - Fylld bar från 0% till aktuell duty
  - Färg: blå (❄️ cooling) eller amber (🔥 heating)
  - Mode-ikon i skalans etikett
  - Tooltip: visar duty %, mode, P/I-komponenter (parsade från `pidReason` som idag)
- Skall-etiketter: `0%` vänster, `PWM XX% ❄️/🔥` center, `100%` höger

**4. Samma vy i use-brew-page.ts**
- Sätt `dutyPct: null` och `dutyMode: null` som defaults (för bryggsidor utan automation)

### Visuellt resultat

```text
Nuvarande PID-bar:        Ny PWM-bar:
-2.0  PID +0.3°  +2.0     0%   PWM 20% ❄️   100%
[====|==●===|====]         [████●·············]
```

Baren fylls från vänster proportionellt mot duty cycle, med en markör-dot vid aktuellt värde. Samma glaseffekt och stil som spanBar.

