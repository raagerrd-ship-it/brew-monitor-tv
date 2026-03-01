

## Analys av båda pillernas SG-drift

```text
Pill              Start           Cold crash       Drift     Drift/°C
─────────────────────────────────────────────────────────────────────
Falkens Flykt     1.0121 @ 21.8°C  1.0108 @ 10.8°C  -0.0013   0.000118/°C
Pomona Kust       1.0121 @ 22.0°C  1.0094 @  7.8°C  -0.0027   0.000190/°C

Standardformel (polynom):
  Falkens Flykt:  korr ~+0.0006  →  täcker ~46%
  Pomona Kust:    korr ~+0.0008  →  täcker ~30%

Pill-residual (det som återstår efter standardformeln):
  Falkens Flykt:  ~0.000064/°C
  Pomona Kust:    ~0.000134/°C   ← dubbelt så stor!
```

Slutsats: Varje pill har sin egen drift-signatur. Standardformeln räcker inte ensam, och residualen skiljer sig kraftigt mellan pills. Per-pill-inlärning är nödvändigt.

## Implementationsplan

### 1. Ny shared utility: `supabase/functions/_shared/sg-temp-correction.ts`
- `standardSgCorrection(sg, tempC, refTemp=20)` — polynom (ASBC-baserad)
- `applySgCorrection(sg, tempC, residualPerDegree)` — standard + inlärd residual
- `detectAnchorPoint(sgHistory)` — hittar stabil SG + fallande temp

### 2. Ny databastabell: `pill_sg_calibration`
- `pill_id` (text, unique) — pill-identifierare
- `anchor_sg` (numeric) — SG vid stabil jäsningsslutt
- `anchor_temp` (numeric) — temperatur vid ankare
- `anchor_recorded_at` (timestamptz)
- `status` (text: idle/anchored/learning/calibrated)
- `created_at`, `updated_at`
- Residual-värdet sparas i befintlig `fermentation_learnings` med parameter `sg_residual_per_degree:{pill_id}`

### 3. Integrera i `sync-rapt-data-quick`
- Vid SG-konvertering: applicera `standardSgCorrection` + hämta `residual_per_degree` från `fermentation_learnings`
- Ankardetektion: om SG stabil (< 0.001/h, 12h) och temp sjunker > 2°C → skapa ankare
- Under cold crash: beräkna residual, uppdatera via EMA i `fermentation_learnings`
- Clamp residual: [0, 0.0003] per °C

### 4. Frontend-diagnostik (minimal)
- Visa kalibreringsstatus per pill i Settings eller brew-kort (ankare, sample count, residual)

