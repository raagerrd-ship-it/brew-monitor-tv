## Problem

Just nu: `cooler_target = controller_target − 5°C` (5°C hard floor).
Men kylaren har `cooling_hysteresis = 2°C` → kompressorn släpper inte förrän glykolen är `cooler_target + 2°C`.

Resultat (observerat just nu):
- Controller target: 16°C
- Cooler target: 11°C
- Glykol just nu: 12.5°C (på väg upp mot 13°C innan kompressorn startar)
- **Faktisk worst-case marginal = 16 − 13 = 3°C** — inte 5°C som vi lovar.

Hysteresen ska behållas stor (skyddar kompressorn mot kortcykling), men måste **räknas in** i marginalen.

## Lösning

Höj effektiv marginal med hysteresen så att golvet gäller worst-case (precis innan kompressorn startar).

### Ändring i `supabase/functions/_shared/cooler-management.ts` (rad ~308–322)

```text
Ny formel:
  worstCaseFloor   = MIN_COOLER_MARGIN + coolerHysteresis   // t.ex. 5 + 2 = 7
  effectiveMargin  = max(boostedMargin + coolerHysteresis, worstCaseFloor)
  cooler_target    = controller_target − effectiveMargin
```

Garanterar: när glykolen når relä-tröskeln (`cooler_target + hyst`) är marginalen fortfarande ≥ 5°C.

### Logg-uppdatering

`MARGIN_CALC`-loggen visar både kommanderad och worst-case-marginal:
```
Target 16.0°C − margin 7.0°C (worst-case 5.0°C @ hyst 2.0°C) = kylare 9.0°C
```

`MARGIN_FLOOR` triggar när `boostedMargin + hyst < worstCaseFloor`:
```
Lärd marginal 4.7°C + hyst 2.0°C under worst-case-golv 7.0°C — använder 7.0°C
```

### Marginal-historik

`cooler_margin_history.margin_value` lagrar **worst-case-marginalen** (kommanderad − hyst) så UI:t visar det "verkliga" skyddsutrymmet.

### UI (`LearnedMarginHistory.tsx`)

Tooltip/underrad visar `hyst Xc` så det syns att marginalen är hysteres-justerad. Inga nya tabellkolumner.

### Inlärning rörs inte

Den lärda `cooler_margin:*`-parametern är fortfarande "rå" marginal (kommanderad − target). Hysteres läggs på vid användning, inte vid inlärning. Det betyder att om kylaren byts till en med annan hysteres så stämmer historiken automatiskt.

## Förväntat resultat

Med dagens läge (16°C target, 2°C hyst):
- Cooler target: 11°C → **9°C**
- Glykol pendlar 9–11°C (istället för 11–13°C)
- Worst-case marginal: 5°C garanterat
- Kompressorns start/stopp-frekvens **oförändrad** (hysteres rörs inte)

## Filer som ändras

- `supabase/functions/_shared/cooler-management.ts` — marginalformel + loggar
- `src/components/LearnedMarginHistory.tsx` — visa hyst-info i tooltip
