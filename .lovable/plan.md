## Beslut: observera först

Inga kodändringar nu. Vi låter den nya rate-baserade regulatorn köra så vi ser hur den beter sig i verklig drift innan vi justerar fler parametrar.

### Vad vi tittar på under observationsperioden

**Primära signaler (från `pre-cool(...)`-constraints i loggarna):**
- Hur ofta porten öppnas och stängs (helst få, långa episoder — inte flimmer)
- Duty-nivån som väljs jämfört med faktisk rate — verkar 0.40°/h × K ≈ 12% räcka, eller ligger vi konsekvent för lågt/högt?
- `r20m=` vs `rcyc=` — hur ofta faller vi tillbaka på cykel-raten (bör vara sällan efter första 25 min)

**Sekundärt (från `pre-cool-tune(...)`-episoder):**
- Riktning på K-justeringarna. Om >2 `overshoot`-tunes i rad → KP_POS är för svag. Om >2 `reversed`/`soft-land` → K eller KP_POS är för stark.
- Slutlig peak-overshoot per episod (målet: 0.02–0.15°C)

**Tredje (från dashboard/history-chart):**
- Amplitud på SSOT-svängningar runt setpoint jämfört med förra veckan
- Om duty-kurvan blir jämnare eller mer taggig

### När vi återkommer

Kom tillbaka med observationer efter 2–3 dagar så bestämmer vi utifrån verklig data om vi ska:
- Göra `KP_POS` adaptiv,
- Krympa den till 0.20,
- Lägga till slew-limit inom porten,
- Eller lämna som är.
