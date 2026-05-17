## Mål
Behåll den fungerande 5°C-marginalen som *mittvärde* istället för att skifta hela bandet uppåt med full hysteres. Kompressorn ska fortfarande inte cykla oftare.

## Bakgrund
Nuvarande implementation (just deployad):
```
effectiveMargin = max(boostedMargin + hyst, MIN_COOLER_MARGIN + hyst)
                = max(... , 5 + 2) = 7°C
```
→ glycol svänger 9–11°C, marginal 5–7°C (medel 6°C, worst case 5°C).

Det är "säkrare" men du har redan validerat att 5°C som mittvärde fungerar utmärkt — vi behöver inte offra 1°C extra köldreserv.

## Ny formel: halv hysteres-kompensation
```
halfHyst         = coolerHysteresis / 2          // t.ex. 2.0 / 2 = 1.0
effectiveMargin  = max(boostedMargin + halfHyst, MIN_COOLER_MARGIN)
                 = max(boostedMargin + 1.0, 5.0)
```

Resultat vid `controller_target = 16°C`, `boostedMargin = 5.0`, `hyst = 2.0`:
- `cooler_target = 16 − 6 = 10°C`
- Kompressor släpper vid 10°C → glycol driver upp till **12°C** (10 + hyst) → marginal = **4°C** worst case
- Kompressor slår på vid 12°C → glycol åker ner mot 10°C → marginal = **6°C** best case
- **Medel: 5°C** ✅ exakt det som fungerade bra

```text
Före (hyst-okänslig):    glycol 9–11°C → marginal 5–7°C (medel 6)
Nu (full hyst):          glycol 9–11°C → marginal 5–7°C (medel 6)   ← för defensivt
Föreslaget (halv hyst):  glycol 10–12°C → marginal 4–6°C (medel 5)  ← matchar verklighet
```

## Tekniska detaljer

**`supabase/functions/_shared/cooler-management.ts`:**
- Behåll `coolerHysteresis = coolerController.cooling_hysteresis ?? 0.2`
- Ändra:
  ```ts
  const halfHyst = coolerHysteresis / 2;
  const effectiveMargin = Math.max(
    boostedMargin + halfHyst,
    MIN_COOLER_MARGIN          // tillbaka till 5.0, INTE 5.0 + hyst
  );
  ```
- Ta bort `MIN_WORST_CASE_MARGIN`-konstanten (eller låt den vara 5.0 = MIN_COOLER_MARGIN)
- `MARGIN_FLOOR`-loggen triggar när `boostedMargin + halfHyst < MIN_COOLER_MARGIN`
- `MARGIN_CALC`-loggen visar: `commanded`, `half_hyst`, `worst_case (= commanded − halfHyst)`, `best_case (= commanded + halfHyst)`, `avg (= commanded)`

**`cooler_margin_history.margin_value`:**
- Logga `commanded − halfHyst` (worst case) — fortfarande ärlig men inte överdrivet pessimistisk
- Alternativt: logga `commanded` (mittvärde) — enklare att tolka i UI

**`LearnedMarginHistory.tsx` (tooltip):**
- Visa "medel Xc · ±Yc" där Y = halfHyst, så det framgår att fältet svänger symmetriskt runt mittvärdet

**Lärda parametrar (`cooler_margin:*`):**
- Oförändrat — fortsatt rå commanded marginal. Run-time-applicering hanteras av halv-hysteres-formeln.

## Validering
1. Deploya `auto-adjust-cooling`
2. `curl` engång → bekräfta att `cooler_target` blir **10°C** (inte 9°C, inte 11°C) vid `controller_target=16`, `boostedMargin=5`, `hyst=2`
3. Övervaka 30 min → glycol ska pendla 10–12°C, kompressorstart-frekvens oförändrad (hyst-bandet är 2°C som tidigare)
4. Bekräfta att `MARGIN_CALC.avg ≈ 5.0`

## Vilka frågor du bör besvara innan implementation
- **Loggvärde i `cooler_margin_history`**: worst-case (4°C) eller mittvärde (5°C)? Mittvärde matchar din mentala modell bäst men avviker från tidigare semantik.
