## Bakgrund

Processen är dödtidsdominerad (15 min probe-latens, 60L termisk massa, glykol-transportlag). Klassisk PID-litteratur säger entydigt: när dödtid > 2 × tidskonstant, **gör loopen långsam och bred**, annars oscillerar den oundvikligen. Allt vi byggt (observer, k-learning, stratifierings-guard, dithering, SSOT-golv, mode-soft-decay, PWM-burst med slots) är försök att kompensera för att vi tunat snabbare än processen tål.

Pill behålls i alla tre förslagen — men som **säkerhetstak**, inte som del av fusion-matematiken.

---

## Alternativ A — Minimal städning (lägst risk)

Behåll PID-strukturen, men ta bort lagren som motverkar varandra.

**Tar bort:**
- Observer (`estimateBottomTemp`) + k-learning + anchor-tracking
- 70/30 controlTemp-viktning, IIR-smooth
- Stratifierings-guard (cap + I-bleed)
- SSOT-golv (blir överflödigt)
- Mode-soft-decay, mass-coast, overshoot-bleed, util-sat-cap
- Dithering / 10-slot rotation

**Behåller:**
- PI på SSOT (`actualTemp` direkt) med Kp=0.30, Ki=0.5/h, Imax=0.4
- Asymmetri: heating-sidan oförändrad
- PWM-burst-systemet (60s minimum) som det är
- ssFloor som lärd feedforward

**Pill som säkerhet:** om `pill > target + 0.7`, golva duty på 12%. Om `pill < target − 0.7`, kapa duty till 0. Inget mer.

**Förväntat beteende:** ~10-15 min för att svara på störning, ±0.15°C i hold. Mycket förutsägbart att felsöka. ~80% mindre kod i `pid-compensation.ts`.

---

## Alternativ B — BrewPi-stil (rekommendation)

Beprövat i hundratusentals fermentorer. Två tidsskalor:

**Slow loop (1 min cadence):** PI på SSOT-bulk
- Kp = 0.20 (mild)
- Ki = 0.3/h (mycket långsam — bygger 10% baskylning över ~30 min)
- Imax = 0.35
- Dödband ±0.1°C: ingen integration i bandet
- Inget D, ingen observer

**Peak-detection (BrewPi-kärnan):** efter att duty gått från positivt till 0%, vänta tills SSOT slutar falla. Om botten-peak ligger ≥0.2°C under target → minska Ki tillfälligt (vi är för aggressiva). Om peak ligger över target → öka Ki. Detta är självtuning utan extern lärning.

**Min on/off:** kylning får inte slå på inom 5 min efter senaste off (skyddar kompressor + ger glykolen tid att blandas). Heating får på inom 1 min.

**Pill som säkerhet:** samma som A — top-cap vid pill > target+0.7, bottom-stop vid pill < target−0.7.

**Förväntat:** ~15-20 min till svar, ±0.1°C i hold efter ~2 dygns inkörning (peak-detection självtunar). Stabilast långsiktigt.

**Komplexitet:** ungefär samma kodmängd som A, men en ny `peak-detect.ts` (~80 rader) som följer toppar/bottnar i SSOT.

---

## Alternativ C — Bang-bang med dödband (enklast)

Klassisk Inkbird/STC-1000-logik. Ingen PID alls.

**Logik:**
- Om SSOT > target + 0.2 i ≥3 min → kyla med fast 15% duty
- Om SSOT < target − 0.2 i ≥3 min → värma med fast 25% duty
- Annars: coast (0%)
- Min 8 min mellan kyl-cykler, min 4 min mellan värme-cykler

**Pill som säkerhet:** hård gräns. Pill > target+0.7 → tvinga kyla. Pill < target−0.7 → tvinga stop.

**Förväntat:** sågtandsmönster ±0.25°C runt target i hold. Aldrig overshoot mer än ~0.4°C. Garanterat stabilt.

**Komplexitet:** ~150 rader i `pid-compensation.ts` (mot dagens 759). Trivialt att resonera om.

---

## Jämförelse

```
                   A (minimal PID)   B (BrewPi)      C (bang-bang)
Kodrader (est)         ~250            ~330             ~150
Tid till svar         10-15 min       15-20 min        5-12 min
Hold-precision       ±0.15 °C        ±0.10 °C         ±0.25 °C
Overshoot-risk        låg              mycket låg       låg
Tuning krävs          en gång          självtunar       en gång
Pill-roll             säkerhet         säkerhet         säkerhet
Felsökbart            ja               ja               mycket lätt
Risk vid deploy       låg              medel            mycket låg
```

## Gemensamt för alla tre

- `pid-compensation.ts` skrivs om från grunden (säkrare än att plocka bort lager för lager)
- `auto-adjust-cooling/index.ts` rörs minimalt — bara anropet till compensation ändras
- PWM-execution, plug-styrning, marginal-hantering, mode-switching i caller — allt orört
- Värmesidan rörs inte (eller minimalt) i alla tre
- Memory-filer för observer/k-learning/stratifierings-guard markeras som arkiverade

## Förslag

**B (BrewPi-stil)** matchar bäst "hellre långsamt mot målet bara vi håller det". Det är dessutom det enda alternativet som självjusterar — du behöver inte tuna om för olika brygder/tankvolymer.

Vill du att jag skriver en konkret implementations-plan för ett av dem (eller alla tre i sekvens, med A först som säkerhetsnät)?
