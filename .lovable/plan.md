

# PID-kompensationsbar i TempStat + Batteri till header

## Oversikt

Ta bort BatteryStat-kortet fran stats-griden, visa batteriinfo i headern istallet, och gor TempStat till ett dubbelhogt kort (som GravityStat) med plats for bade temp-span-baren och en ny PID-kompensationsbar.

## Andringar

### 1. Ta bort BatteryStat fran griden

**Fil: `src/components/brew-card/BrewCard.tsx`**

- Ta bort `BatteryStat`-importen och komponenten fran stats-griden
- Andra griden fran `grid-cols-3 grid-rows-2` till `grid-cols-3 grid-rows-2` (samma grid, men nu med 5 celler istallet for 6 -- GravityStat tar 2 rader, TempStat tar 2 rader, ABV och Attenuation tar varsin cell i mitten)

Layout blir:

```text
|  Gravity  |   ABV   |   Temp   |
|  (row 2)  |  Atten  |  (row 2) |
```

### 2. Visa batteri i headern

**Fil: `src/components/brew-card/BrewCard.tsx`**

- Berakna batterivardet (samma logik som BatteryStat: `brew.battery ?? pill?.battery_level`)
- Visa som en liten text/ikon bredvid senaste uppdateringen i subtitle-raden
- Format: `🔋 72.3%` med rod farg om under 20%
- Behover `devices` (redan beraknat i BrewCard) for att komma at pill-data

### 3. Gor TempStat dubbelhogt med PID-bar

**Fil: `src/components/brew-card/TempStat.tsx`**

- Lagg till `rowSpan={2}` pa StatCard (precis som GravityStat)
- Lagg till `labelSize` och `valueSize` for storre text (matchar GravityStat)
- Flytta span-baren till nedre delen av kortet
- Lagg till PID-kompensationsbar ovanfor span-baren:

**PID-baren:**
- Berakna: `compensation = targetTemp - profileTarget`
- Skala: -2.0 till +2.0 grader (fast)
- Centerlinje vid 0
- Fylld bar fran mitten till kompensationsvardet
- Bla farg for negativ (kyler mer), orange for positiv (varmer mer)
- Markordot pa aktuellt varde med glow
- Visas BARA nar `showBothTargets` ar sant och `!isInactive`
- Tooltip: "Kompensation: -0.6 grader"
- Skaletiketter: `-2.0`, `0`, `+2.0`

Layout inuti TempStat (dubbelhogt):

```text
| TEMP (18.0°)     |
| 17.7°            |  (stort varde)
|                  |
| [PID-bar -2..+2] |  (ny)
| [span-bar ctrl↔pill] |  (befintlig)
```

### 4. Uppdatera index-exports

**Fil: `src/components/brew-card/index.ts`**

- Ta bort `BatteryStat` fran exports (valfritt, kan behallas for bakatkompat)

## Tekniska detaljer

### PID-bar implementation (TempStat.tsx)

```typescript
// Redan beraknat:
// profileTarget, targetTemp, showBothTargets

const compensation = targetTemp - profileTarget; // positiv = varmer mer
const clampedComp = Math.max(-2, Math.min(2, compensation));
const compensationPct = ((clampedComp + 2) / 4) * 100; // 0-100%
const centerPct = 50;
const isNegative = compensation < 0;
const barLeft = isNegative ? compensationPct : centerPct;
const barWidth = Math.abs(compensationPct - centerPct);
const barColor = isNegative ? 'hsl(var(--temp-blue))' : 'hsl(38 92% 50%)';
```

### Batteri i header (BrewCard.tsx)

```typescript
const batteryValue = brew.battery ?? devices.pill?.battery_level ?? null;
const isLowBattery = batteryValue !== null && batteryValue < 20;
```

Visas i subtitle-raden som: `· 🔋 72.3%`

### Filer som andras

| Fil | Andring |
|-----|---------|
| `src/components/brew-card/BrewCard.tsx` | Ta bort BatteryStat, lagg till batteri i header, ge TempStat devices-prop (redan gjort) |
| `src/components/brew-card/TempStat.tsx` | rowSpan=2, storre text, PID-kompensationsbar |

