

# Temperaturreglering — Kodgranskning med färska ögon

## Sammanfattning

Systemet är en **PI-regulator** (Proportional + Integral, ingen D-term) som styr duty cycle (0–100%) och exekverar via PWM-bursts mot RAPT-hårdvaran. Kärnidén är korrekt och matchar industrin (BrewPi, CraftBeerPi, Fermentrack använder alla PI). Men runt denna kärna har det ackumulerats **flera lager av workarounds och specialfall** som delvis överlappar varandra.

---

## Vad som är RÄTT och bör behållas

| Funktion | Motivering |
|---|---|
| PI utan D-term | Korrekt för långsamma termiska system. D-term förstärker sensorbrus. |
| Duty cycle → PWM | Rätt approach givet att RAPT bara stöder SetTargetTemperature. |
| Extreme targets (-5°C / 40°C) | Nödvändigt för att forcera reläer förbi 5°C hysteres. |
| Stale-data guard (P=0 vid gammal data) | Förhindrar att P-termen triggar 3× på samma mätning. |
| Deadband (±0.05°C) | Standard. |
| Probe-baserad suppression vid revert | Korrekt — RAPT:s termostat ser bara proben. |
| 2-cykels A/B PWM-modell | Smart lösning för 10%-upplösning. |

---

## Vad som ÖVERLAPPAR eller är ONÖDIGT

### 1. D-term / Damping Factor (~40 rader i pid-compensation.ts)
Beräknar `dampingFactor` från pill rate + ETA, men den bara **skalar ner P-termen** marginellt. En ren PI-regulator behöver inte detta — deadband + integral decay hanterar redan konvergens. Effekten är minimal men koden är komplex.

**Rekommendation:** Ta bort D-term-beräkningen. Behåll PI rent.

### 2. Ramp Rate Limiting (~30 rader i controller-adjustments.ts)
Begränsar hur snabbt `pidEffectiveTarget` kan ändras (4°C/h kyla, 3°C/h värme). Men profilsystemet har redan `gradual_ramp` som hanterar detta. Dubbel rate-limiting kan göra att systemet reagerar långsammare än nödvändigt vid t.ex. cold crash.

**Rekommendation:** Behåll ENBART om man vill skydda mot manuella stegändringar (t.ex. 18°→2°). Annars ta bort — profilen hanterar ramper.

### 3. Heating Session Cap (~60 rader)
Forcerar 30 min vila efter 10 min kontinuerlig värme. Detta borde inte behövas med korrekt PI-tuning — om systemet övervärmer med låg duty beror det på för aggressiva gains, inte på att det behövs en timer. BrewPi/CraftBeerPi har inget liknande.

**Rekommendation:** Ta bort. Justera heating P-gain/I-gain istället om överskjutning sker.

### 4. Style-Key Fallback (~30 rader i pid-compensation.ts)
Söker i databasen efter inlärda PI-värden från samma ölstil. Kräver 3 DB-anrop (session → brew → style lookup). Vinsten är marginell — integralen konvergerar på 2-3 cykler ändå.

**Rekommendation:** Ta bort. Sparar 3 DB-queries per controller per cykel.

### 5. Temperaturinterpolation (~30 rader)
Estimerar temperatur mellan RAPT:s 15-min synkar. Men integralen håller redan steady-state duty — P-termen nollställs vid stale data. Interpoleringen ger en marginellt bättre P-respons men lägger till komplexitet och risk för felaktig estimering.

**Rekommendation:** Kan behållas som optimering, men är inte kritisk. Borttagning förenklar utan märkbar försämring.

### 6. Dubbel saturation detection
Både rate-baserad (pill rate vs learned thermal rate) OCH utilization-baserad (>90%). Dessa mäter i princip samma sak — hårdvaran är maxad.

**Rekommendation:** Behåll enbart utilization-baserad (enklare, mer direkt).

### 7. Cooling vs Heating PWM-block — 95% identiska (~200 rader duplicerade)
Raderna 580–691 (cooling) och 694–886 (heating) är nästan identiska förutom:
- ON-target: -5°C vs 40°C
- Revert-riktning: probe+2 vs probe-2
- Heating session cap (extra logik)

**Rekommendation:** Refaktorera till EN gemensam `executePwmDutyCycle(mode, ...)` funktion. Sparar ~150 rader.

---

## Sammanfattning av förenklingsmöjligheter

```text
Funktion                    Rader   Effekt av borttagning
─────────────────────────────────────────────────────────
D-term / damping            ~40     Ingen märkbar försämring
Ramp rate limiting          ~30     Profilen hanterar redan
Heating session cap         ~60     Bättre löst via PI-tuning
Style-key fallback          ~30     3 färre DB-anrop/cykel
Temp interpolation          ~30     Marginell optimering
Dubbel saturation           ~15     Förenkling
PWM-duplicering             ~150    Ren refaktorering
─────────────────────────────────────────────────────────
Totalt                      ~355    ~40% mindre kod
```

## Vad industrin gör annorlunda

**BrewPi** (referensimplementation):
- Ren PI-regulator, ~200 rader totalt
- Direkt reläkontroll (ingen PWM-workaround behövs)
- Ingen inlärning, ingen interpolation, ingen mode-switching-logik
- Hysteres hanteras av hårdvaran

Ert system är mer komplext pga RAPT-hårdvarans begränsningar (15-min telemetri, ingen reläkontroll, 5°C hysteres). Men **flera av workarounds löser problem som andra workarounds redan löst**.

## Förslag: Stegvis förenkling

1. **Steg 1** (låg risk): Refaktorera cooling/heating PWM till gemensam funktion
2. **Steg 2** (låg risk): Ta bort style-key fallback + dubbel saturation
3. **Steg 3** (medel risk): Ta bort D-term/damping
4. **Steg 4** (medel risk): Ta bort heating session cap, justera gains vid behov
5. **Steg 5** (diskutera): Ramp rate limiting — behåll eller ta bort beroende på om manuella stegändringar ska stödjas

