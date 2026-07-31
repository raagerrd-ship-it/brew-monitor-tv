## Problemet, verifierat

Tre separata fel, alla med samma rot: **glykoltemperaturen behandlas som en konstant per cykel.**

1. **Inlärningen normaliserar hela 6h-fönstret med en enda ΔT** (`pid-compensation-claude.ts` rad 971–972: `norm(requiredDuty)` / `perPct * (DELTA_T_REF/deltaT)`). ΔT tas från glykolens värde *just nu*. Historiken innehåller par från timmar då glykolen låg helt annorlunda — senaste 90 min svängde kylaren 6,9 → 8,9° i loggen. Varje sample skalas alltså med fel faktor.
2. **`commitHoldSsFloor` skriver rå duty utan ΔT-normalisering alls** (rad 1050–1055, erkänt i kommentaren). Hold-observationer förorenar den normaliserade EMA:n.
3. **Ingen mid-burst-hänsyn.** Duty beslutas vid cykelstart utifrån ΔT då; faller glykolen 2° mitt i bursten levereras ~30–50 % mer kyla än beräknat. Det är exakt det som hände på Gul kl 13:00–13:15 (glykol 8,9 → 6,9°, probe 12,86 → 11,17°).

Punkt 1 och 2 är rena beräkningsfel. Punkt 3 är ett reglerproblem som normalisering inte kan lösa — den behöver en egen mekanism.

## Vad som byggs

### Steg 1 — Per-sample ΔT vid inlärning (kärnfixen)

`temp_controller_history` innehåller redan glykolkylarens egna rader (controller `7e57bd3c…`), så historisk glykoltemp finns per tidpunkt.

- Hämta kylarens historik för samma 6h-fönster i `learnFeedforwardDuty`.
- Bygg en lookup som ger närmaste glykolvärde (±10 min, annars hoppa över paret).
- Normalisera **varje** sample vid insamling istället för medianen efteråt:
  - `perPctResp.push(normPerPct(-rate/duty, ΔT_sample))`
  - `ambient` är glykol-oberoende och lämnas orört.
- `requiredDuty` blir då `ambientGain / (perPctNormalized × 100)` — redan i ΔT_ref-ramen, ingen efterhandsskalning behövs.
- Vid läsning (`denorm`) används fortsatt nuvarande ΔT — det är rätt, det är där vi ska agera.

Verifiera: loggraden `🔮 Feedforward duty` skriver ut spridningen av ΔT över samplen, så vi ser direkt om fönstret var blandat.

### Steg 2 — Normalisera hold-ssFloor-observationen

`commitHoldSsFloor` tar emot aktuell ΔT och skriver `norm(medDuty)` istället för rådutyn. Hold-observationen är per definition tagen vid den ΔT som råder just då, så den är exakt normaliserbar — till skillnad från physics-learnerns blandade fönster.

### Steg 3 — Mid-burst glykol-vakt (det normalisering inte kan lösa)

I minutsvepet i `auto-adjust-cooling` (samma ställe som overdue-PWM-OFF-sweepen):

- För varje pending PWM OFF-rad: jämför glykoltemp nu mot glykoltemp när bursten startade.
- Har ΔT ökat mer än 1,5° (glykolen blivit kallare) → skala ned återstående burst-tid med `ΔT_start / ΔT_nu` och flytta fram `execute_at` därefter, aldrig kortare än 30 s totalt.
- Logga som eget beslutssteg (`PWM_TRIM_GLYCOL`) så det syns i beslutsloggen.

Kräver att burst-start-ΔT sparas: lägg `glycol_temp_at_start` på `pending_rapt_retries` (nullable numeric, ingen backfill).

## Alternativ som övervägdes och väljs bort

- **Hinkad glykol-dimension i lärnyckeln** — tidigare diskuterat och förkastat: splittrar dataunderlaget och ger diskontinuiteter vid hinkgräns. Kontinuerlig normalisering är strikt bättre.
- **Låta kylaren hålla stabilare glykol istället** (snävare hysteres på kylaren) — botar symptomet på systemnivå men kostar kompressorstarter och löser inte att lärdata redan är blandad. Kan övervägas separat senare.
- **Bara Steg 3, hoppa över 1–2** — då fortsätter ff/process_gain drifta fel varje gång glykolen ändras mellan lärfönster. Steg 1 är den faktiska "målmatchning blir fel"-fixen.

## Teknisk detalj

- Filer: `supabase/functions/_shared/pid-compensation-claude.ts` (Steg 1+2), `supabase/functions/auto-adjust-cooling/index.ts` (Steg 3), migration för `pending_rapt_retries.glycol_temp_at_start` + `execute-pwm-off`/burst-schemaläggning i `controller-adjustments.ts` som sätter fältet.
- V5 (`pid-compensation.ts`) lämnas orörd — den är fryst fallback.
- Inga lärda värden nollställs. Steg 1 ger en jämnare EMA framåt; befintliga värden konvergerar om av sig själva inom ~1–2 dygn.
- Deploy: `auto-adjust-cooling`, `run-automation`, `execute-pwm-off`.
