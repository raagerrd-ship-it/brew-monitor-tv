

## Plan: Aktivitetsdimension i marginalinlärningen

### Bakgrund
Systemet lär sig idag marginaler med dimensionerna `tempBucket` (cold/cool/warm/hot) och `loadBucket` (load_0/1/2plus). Under peak-jäsning (dag 1-3) producerar jästen kraftig exoterm värme som kräver betydligt mer kylmarginal. I slutfasen är aktiviteten låg och marginalen kan stramas åt. Idag behandlas båda situationerna lika, vilket ger antingen för stor marginal i slutfasen (energislöseri) eller för liten vid peak (tanken hinner inte kyla).

### Design

**Ny dimension**: `activity_high` (activity_score ≥ 40%) vs `activity_low` (< 40%).

Parametrar som får aktivitetsdimension:
- `hold_margin:{bucket}:{load}` → `hold_margin:{bucket}:{load}:{activity}`
- `ramp_margin:{bucket}:{load}` → `ramp_margin:{bucket}:{load}:{activity}`
- `cooling_rate:{bucket}:{load}` → `cooling_rate:{bucket}:{load}:{activity}`

Parametrar som **inte** får det (oberoende av jäsaktivitet):
- `cooler_margin:{bucket}` (generisk fallback)
- `warming_rate`, `duty_cycle`, `min_effective_margin`

**Fallback-kedja**: Om `hold_margin:warm:load_1:activity_high` har < 3 samples → faller tillbaka till `hold_margin:warm:load_1` → faller tillbaka till `cooler_margin:warm`.

### Ändringar

**1. `supabase/functions/_shared/cooler-management.ts`**

- **`getActivityBucket()`** — ny hjälpfunktion. Tar `supabase`, `controllerId`/`brewId` och hämtar `activity_score` från `brew_fermentation_metrics` via `fermentation_sessions` koppling. Returnerar `'activity_high'` eller `'activity_low'`.

- **`learnFromCurrentState()`** — utökas:
  - Hämtar `activityBucket` för den lägsta controllern
  - Appendar `:{activityBucket}` till `marginParam` och `rateParam`
  - Parallell-sparar även utan aktivitetssuffix (för att bygga upp samples i fallback-nyckeln)

- **`runCoolerCooling()` (margin lookup)** — utökas:
  - Hämtar `activityBucket` för `effectiveTarget.controllerId`
  - Bygger `specificMarginKey` med `:{activityBucket}`
  - Fallback-kedja: activity-specifik (≥3 samples) → utan activity (≥3 samples) → generic `cooler_margin`

**2. `supabase/functions/ai-automation-audit/index.ts`**
- Uppdatera `VALID_LEARNING_PREFIXES` för att tillåta AI att justera activity-dimensionerade parametrar

**3. `src/components/AiTunableParameters.tsx`**
- Visa aktivitetsdimension i bucket-labels (t.ex. "Varm · 1 tank · Hög akt.")

**4. `src/components/LearnedCoolerMarginValues.tsx`**
- Visa aktivitetsdimension i bucket-labels

### Tekniska detaljer

```text
Lookup-kedja (margin):
1. hold_margin:warm:load_1:activity_high  (≥3 samples?)
2. hold_margin:warm:load_1                (≥3 samples?)  
3. cooler_margin:warm                     (default 5.0)

getActivityBucket():
  fermentation_sessions (running, controller_id)
    → brew_id
    → brew_fermentation_metrics.activity_score
    → ≥40% = activity_high, <40% = activity_low
    → null (no session) = activity_low
```

**Tröskel 40%** valdes eftersom:
- Peak-fas typiskt 60-100% activity
- Slutfas/conditioning typiskt 0-25%
- 40% ger tydlig separation utan att skapa för många buckets

### Filer som ändras
- `supabase/functions/_shared/cooler-management.ts` — kärnlogik
- `supabase/functions/ai-automation-audit/index.ts` — AI-prefixes
- `src/components/AiTunableParameters.tsx` — UI-labels
- `src/components/LearnedCoolerMarginValues.tsx` — UI-labels

