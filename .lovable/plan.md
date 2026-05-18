## Mål

Ersätt nuvarande `max(activityTarget, timeTarget)` i `processGradualRampStep` med en **SG-driven ramp + tidsgolv**. Aktivitetspoängen används inte längre för att räkna ut måltemp under själva rampen — bara tidigare för att *trigga* rampen (vid `activity_trigger`).

## Hur det blir

```text
  temp
   ^
   |        ____ tempMax (base + increase)
   |       /
   |      /  ← följer SG-progress (mjuk, speglar utjäsning)
   |     /
   |   _/    ← tidsgolv glider upp underifrån (skyddsnät)
   | _/
   +--------------> tid
   base
```

`calculatedTarget = max(sgBasedTarget, timeBasedTarget)`, clampad till `[baseTemp, baseTemp + tempIncrease]`.

## Förändringar

### 1. Databas — ny kolumn för att låsa SG vid ramp-start
Migration: lägg till `ramp_start_sg numeric` på `fermentation_sessions`. Sparas tillsammans med `ramp_triggered_at` och `step_start_temp` första gången rampen triggas (engångs-snapshot av aktuell SG).

### 2. `step-handlers.ts` → `processGradualRampStep` (rad ~499–528)

Ersätt aktivitets-kurvan och blandnings-/golv-logiken med:

```ts
// SG-progress: 0 = vid trigger, 1 = vid förväntat FG
const rampStartSg = session.ramp_start_sg ?? getLatestSg(brewData.sg_data) ?? null
const currentSg   = getLatestSg(brewData.sg_data)
const expectedFg  = brewData.final_gravity || null

let sgBasedTarget = baseTemp
let sgProgress: number | null = null
if (rampStartSg && currentSg && expectedFg && rampStartSg > expectedFg) {
  sgProgress = (rampStartSg - currentSg) / (rampStartSg - expectedFg)
  sgProgress = Math.min(1, Math.max(0, sgProgress))
  sgBasedTarget = baseTemp + tempIncrease * sgProgress
}

// Tidsgolv (säkerhetsnät — kickar in om SG fastnar)
let timeBasedTarget = baseTemp
let timeProgress: number | null = null
if (minRampHours && minRampHours > 0) {
  const elapsed = (Date.now() - rampTriggeredAt.getTime()) / 3_600_000
  timeProgress = Math.min(1, Math.max(0, elapsed / minRampHours))
  timeBasedTarget = baseTemp + tempIncrease * timeProgress
}

// Skottsäker kombination: SG styr, tid är golv underifrån
const floored = Math.max(sgBasedTarget, timeBasedTarget)
const calculatedTarget = Math.round(
  Math.min(baseTemp + tempIncrease, Math.max(baseTemp, floored)) * 10
) / 10

const driver = sgBasedTarget >= timeBasedTarget ? 'sg' : 'time-floor'
console.log(
  `⏱️ Ramp (${driver}): sg=${sgBasedTarget.toFixed(2)}°C `
  + `(progress=${sgProgress?.toFixed(2) ?? 'n/a'}), `
  + `time=${timeBasedTarget.toFixed(2)}°C `
  + `(${timeProgress?.toFixed(2) ?? 'n/a'}) → ${calculatedTarget}°C`,
)
```

Vid första triggern: spara även `ramp_start_sg = getLatestSg(brewData.sg_data)` på sessionen.

### 3. Fallback-strategi (viktigt)
SG-data är inte alltid komplett. Logiken hanterar tre nivåer:

| Tillgängligt | Beteende |
|---|---|
| `rampStartSg + currentSg + final_gravity` finns | Full SG-driven ramp |
| Saknas (ingen pill, eller `final_gravity = 0`) | `sgBasedTarget = baseTemp` → tidsgolvet tar över helt (= dagens beteende när activity=0) |
| `minRampHours = null` | Endast SG styr; om även SG saknas → håller `baseTemp` tills SG kommer in |

### 4. Activity-rollen
- `activity_score` används **endast** för att avgöra om rampen ska triggas (`activityScore <= activityTrigger`).
- Den tas bort från ramp-progressberäkningen helt — inga fler aktivitetspikar som chockar målet uppåt.

### 5. Typer
- Lägg till `ramp_start_sg: number | null` i `FermentationSession`-typen (`types.ts`).
- `src/integrations/supabase/types.ts` regenereras automatiskt av migrationen.

## Deploy
Efter ändring: deploya `process-fermentation-profiles` och `run-automation`.

## Vad som *inte* ändras
- Trigger-logik (35% activity), `ACTIVITY_COMPLETE`-koncept tas bort men existerande sessioner med `ramp_triggered_at` redan satt fortsätter — `ramp_start_sg` blir `null` och faller då tillbaka på rent tidsgolv (vilket är säkrast retroaktivt).
- Slutvillkor för Smart Diacetylvila (`sgStable && activityLow`) — fortsatt activity-baserat.
- Ramp-rate limiter (4°C/h cool, 3°C/h heat) och PID — orörda.
