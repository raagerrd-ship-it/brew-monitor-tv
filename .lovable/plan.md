

## Analys: Överlappning mellan Glykolkylare och PID-kompensation

### Problemet
Under **Glykolkylare** visas redan `profilmål → börvärde (+kompensation)` per controller — t.ex. `21.0° → 21.2° (+0.2°)`. Detta är exakt samma sak som PID-kompensationen visar: skillnaden mellan det interpolerade profilmålet och det faktiska börvärdet som skickats till controllern.

Resultatet är att samma information visas på två ställen, vilket skapar förvirring.

### Vad som faktiskt händer
1. **Profilmotorn** interpolerar måltemperaturen (t.ex. under en ramp: 21.0°C just nu)
2. **PID/Pill-kompensationen** justerar börvärdet baserat på pill-probe-delta (t.ex. +0.2° → börvärde 21.2°C)
3. Glykolkylare-blocket visar redan båda: `profilmål → börvärde (diff)`

### Förslag till förtydligande

**Alternativ A — Separera informationen tydligare:**
- **Glykolkylare**: Visa bara profilmål och kylstatus (inte börvärde/kompensation)
- **PID-kompensation**: Visa `profilmål → börvärde` med pill/probe-detaljer

**Alternativ B — Slå ihop till ett block:**
- Visa allt under en sektion, t.ex. "Temperaturreglering", med profilmål, kompensation och kylstatus samlat

**Alternativ C — Behåll strukturen men ändra vad som visas:**
- **Glykolkylare**: Visa bara kylarens status och kylbehov (inte tank-controllers)
- **PID-kompensation**: Visa per tank-controller: profilmål → börvärde med kompensationsdetalj (pill/probe temps)

### Rekommendation: Alternativ C
Det är mest logiskt att:
- **Glykolkylare** fokuserar på själva kylaggregatet: dess temp, mål, om den kyler aktivt, och kylbehovet
- **PID-kompensation** äger all per-tank info: profilmål, kompensation, pill vs probe

### Implementationsplan

1. **Glykolkylare-blocket** — ta bort tank-controller-raderna, behåll bara kylarens egen rad + ramp-indikatorer + synk-nedräkning
2. **PID-kompensation-blocket** — flytta hit `profilmål → börvärde (komp)` visningen som idag ligger under Glykolkylare, plus befintlig PID-action/skip-info
3. Justera labels/texter för tydlighet

