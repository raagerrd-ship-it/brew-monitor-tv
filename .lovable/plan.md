

## Plan: Unified PID-to-Duty-Cycle Controller

### Sammanfattning
Slå samman PID och PWM till en enda kontrollmodell där PID:ns output alltid är en **duty cycle (0–100%)** istället för en justerad måltemperatur. Hårdvaran styrs alltid via PWM-bursts: 0°C = kylning PÅ, hög temp = kylning AV. Längden på burst bestäms av duty%.

### Nuvarande arkitektur (problem)
```text
Profil → Dual Sensor → PID → justerad måltemp → RAPT relay bestämmer on/off via hysteres
                                                  ↓ (efter stabilitet)
                                            Separat PWM-läge med inlärd duty
```
Två helt olika kontrollstrategier, komplex övergång, PID-justeringar kämpar mot RAPT:s egna relä-logik.

### Ny arkitektur
```text
Profil → Dual Sensor → PID → duty cycle (0–100%) → PWM burst varje 5-min cykel
                                                     ├─ 0°C i (duty% × 300)s
                                                     └─ maxTemp resten av cykeln
```
PID:n output mappas direkt till kylbehov. Inga mellanhänder.

### Detaljerad design

**1. PID output → duty cycle**
- `error = baseTarget - probeTemp` (negativt = för varmt = behöver kyla)
- Stor error (< -2°C): duty = 100%
- Mellan error: proportionell mapping, t.ex. `duty = clamp(|error| × K, 0, 1.0)` med K ≈ 0.5
- Integral ackumulerar steady-state-behovet (den långsiktiga duty som behövs vid mål)
- Vid mål (deadband ±0.1°C): duty = integralen (inlärd steady-state)
- Över mål (overcooling): duty = 0%, integral dämpas

**2. PWM-exekvering (varje 5-min cykel)**
- Beräkna burst_seconds = duty% × 300s (med befintlig 2-fas A/B-modell för 10%-upplösning)
- duty 0% → ingen burst, sätt hög temp (kylning AV)
- duty 100% → ingen revert, håll 0°C hela cykeln
- duty 1-99% → burst 0°C i N sekunder, schedule revert via `pending_rapt_retries`
- Befintlig `execute-pwm-off` hanterar revert — ingen ändring behövs

**3. Heating mode (undantag)**
- Heating mode behåller nuvarande target-baserade PID (RAPT styr värmare via hysteres)
- Duty-cycle-modellen gäller enbart cooling-kontrollrar
- Tydlig `if (pidMode === 'heating')` fork i koden

**4. Förenklingar (tas bort)**
- `pwm_stable_count` och stabilitets-threshold — PWM körs alltid
- Separat steady-state duty-learning (`DUTY_LEARN`) — integralen ÄR steady-state
- Rate-limits, proximity dampening, toward-target-bypass — ersätts av duty-mappning
- No-op guard för 0.1°C diff — irrelevant när output är duty%
- Heater activation guard behålls (heating mode)

### Filer som ändras

| Fil | Ändring |
|-----|---------|
| `supabase/functions/_shared/pid-compensation.ts` | PID returnerar `dutyCycle` (0.0–1.0) istället för `ctrlTargetPid`. Behåller P, I, D-termer men mappningen ändras. Deadband → duty = integral. |
| `supabase/functions/_shared/controller-adjustments.ts` | `runPidControl` tar PID duty output, beräknar burst-tid, skickar 0°C + schemalägger revert. Tar bort stabilitetskrav, separat PWM-feedback, rate-limits. Kraftigt förenklad. |
| `supabase/functions/_shared/cooler-management.ts` | Behöver uppdateras: kylare-marginalen baseras nu på att tankarna kör PWM, inte justerade targets. Kylaren ska planera mot `baseTarget` (oförändrat). |
| `supabase/functions/execute-pwm-off/index.ts` | Ingen ändring — fungerar redan med det nya flödet. |

### PID-parametrar (ny mappning)

```text
cooling:
  pGain: 0.5        # duty per °C error
  iGain: 0.05       # duty ackumulering per cykel per °C
  iDecay: 0.98       # långsam decay → stabil steady-state
  iClamp: 0.95       # max 95% duty från integralen
  dDamping: behålls  # bromsning nära mål

Duty = clamp(P + I, 0, 1.0)
Burst = duty × 300s (kvantiserad till 30s steg = 10% resolution)
```

### Migreringsplan
- Befintlig `steady_state_duty`-data i `fermentation_learnings` kan användas som initial integral-seed vid första körning
- `pwm_stable_count` kolumnen blir oanvänd (kan rensas senare)
- Inga databas-migreringar behövs initialt

### Risker och mitigering
- **Heating mode**: Behåller befintlig logik, ingen förändring
- **Kylare utan dual-sensor**: `baseTarget` fallback fungerar som idag
- **0% duty fastnar**: Integralen bygger upp igen vid error — self-correcting
- **100% duty vid stor error**: Samma beteende som att sätta 0°C idag

