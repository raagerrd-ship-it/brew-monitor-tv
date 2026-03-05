

# Fix: Kylarmarginalen fastnar för högt (ratchet-effekt)

## Analys

Nuvarande data visar problemet tydligt:

```text
cooler_margin:cold       = 6.98°C  (233 prover)
min_effective_margin:cold = 7.21°C  (129 prover)
hold_margin:cold:load_1  = 6.77°C  (32 prover)

Effektiv marginal = max(cooler_margin, min_effective) = 7.21°C
→ Kylare mål = 8°C - 7.2°C ≈ 0.8°C (clamped till -1°C)
```

**Rotorsak:** `min_effective_margin` fungerar som ett golv (rad 237 i `cooler-management.ts`) OCH har en uppåtgående ratchet:

1. Vid 100% utilization: boostar 10–15% uppåt (rad 1086-1103)
2. Vid normal drift: konvergerar via EMA — men EMA rör sig långsamt nedåt
3. Golvet på rad 237 (`baseMargin = max(learnedMargin, minEffective)`) gör att marginalen **aldrig kan sjunka under min_effective**, oavsett hur låg utilization är

Resultatet: `min_effective` har klättrat till 7.21°C under perioder med 100% util och kan inte sjunka tillbaka trots att nuvarande util är 0–74%.

## Lösning

### 1. Ändra min_effective_margin från golv till referens

Sluta använda `min_effective_margin` som hårt golv. Istället:

```text
Nuvarande (rad 237):
  baseMargin = max(learnedMargin, minEffective)  ← hård spärr

Nytt:
  baseMargin = learnedMargin  ← marginalen styr själv
  // min_effective används bara som varningssignal i loggen
```

### 2. Sluta boosta min_effective vid hög utilization

100% util betyder att marginalen behöver öka — men det hanteras redan av `cooler_margin`-inlärningen (rad 951-955, +8%). Att ÄVEN höja golvet skapar dubbel-eskalering.

Ändra `learnMinEffectiveMargin()`:
- Ta bort boost-logiken vid util ≥ 99%
- Lär bara från cykler där kylning faktiskt fungerar (rate > 0) — konvergera mot det observerade deltatat
- Detta gör min_effective till en ren observation: "vid denna marginal producerades kylning"

### 3. Snabbare nedåt-konvergens för cooler_margin

EMA med alpha=0.2 konvergerar långsamt. Vid låg utilization (<50%), använd alpha=0.3 för snabbare justering nedåt. Behåll alpha=0.2 vid hög util (skydd mot för snabb sänkning).

### 4. Återställ nuvarande min_effective

Sätt `min_effective_margin:cold` till ett rimligare värde (t.ex. 3.0°C) så systemet kan börja lära sig rätt från en lägre utgångspunkt.

## Filer som ändras

- `supabase/functions/_shared/cooler-management.ts`:
  - Rad 237: Ta bort `min_effective` som golv, använd `learnedMargin.value` direkt
  - `learnMinEffectiveMargin()`: Ta bort boost vid util ≥ 99%, behåll bara EMA-konvergens
  - `learnFromCurrentState()`: Snabbare alpha vid låg util
- DB: Manuell reset av `min_effective_margin:cold` → 3.0

