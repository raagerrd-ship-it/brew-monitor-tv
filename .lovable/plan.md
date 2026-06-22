# Refaktor: pid-compensation.ts → enklare PI-kärna

## Bakgrund

`pid-compensation.ts` (886 rader, ~500 rader i `calculateCompensatedTarget`) har vuxit till **15+ specialfallsgrenar** som alla löser samma underliggande problem: "ge rätt duty givet aktuell error och rate". Varje incident har lagt till en ny gren istället för att justera kärnan:

```text
deadband-coast / deadband-trim / deadband-recovery / deadband-no-floor / deadband-no-floor-probe
target-hold / target-hold-warm
overcooled+coast / overcooled+catch-30pct
braking-zone (static) / pred-brake (fast-approach) / ramp-pred-brake (ETA) / ramp-deg-brake (just nu)
hold-drift-micro
mode-flip-cap / mode-switch-softstart / mode-switch-warmseed / soft-start-cap
settling-guard / low-error-cap / saturation-guard / ramp-boost
margin-aware-floor-scaling
```

Resultat: svårt att resonera om beteendet, varje fix riskerar att bryta något annat, och vi har flera mekanismer som löser samma sak (t.ex. tre olika ramp-bromsar).

## Hypotes

En **äkta PI-regulator runt ssFloor** med korrekt anti-windup + en **rate-feedforward (D-on-measurement från pillRate)** kan ersätta de flesta grenarna utan att tappa kontrollen. De symptom som drev fram patcharna (windup, ramp-overshoot, dödbands-pendling, hold-drift) följer alla av att kärnan inte hade integral-clamp eller rate-term från början.

## Föreslagen kärna

```text
u_ff   = ssFloor                       # feedforward (lärt steady-state)
u_p    = Kp * need                     # proportionell
u_i    = clamp(Σ Ki * need · dt, 0, Imax)   # integral med anti-windup-clamp
u_d    = -Kd * pillRate_signed         # rate-feedforward (broms vid snabb approach)
duty   = clamp(u_ff + u_p + u_i + u_d, 0, 1)
```

Anti-windup: när `duty` mättas (0 eller 1) eller när `need < 0` (vi är förbi target i mode-riktningen), **frys** Σ och låt den decay:a snabbt (alpha 0.3) istället för dagens 5+ olika decay-koefficienter.

Hold-step: skala Kp/Ki ner ~50%, behåll Kd. Ramp-step: full Kp/Ki, Kd brett aktivt.

## Vad försvinner

| Befintlig gren | Ersätts av | Motivering |
|---|---|---|
| deadband-coast / -trim / -recovery / -no-floor / -no-floor-probe | PI runt ssFloor med anti-windup | Hela dödbandslogiken är bara "lugn PI nära target" |
| target-hold / target-hold-warm | Samma | Just PI-output |
| coast-overshoot / catch-30pct / overcooled-coast | Anti-windup + `u_ff` blir kvar | Floor är redan "duty som håller temp", `u_p+u_i→0` när vi är förbi |
| braking-zone (static + FAST_APPROACH + ratePrediction + SAFETY) | `u_d = -Kd * pillRate` | En koefficient istället för 5 |
| ramp-pred-brake (ETA-baserad) | `u_d` | Samma sak — bromsar på rate, inte ETA-gissning |
| ramp-deg-brake (just tillagd) | `u_d` | Samma |
| hold-drift-micro | Proper Ki under hold | Driften driver integral naturligt |
| mode-flip-cap + soft-start + warm-seed + soft-start-cap | En `onModeFlip()`: `Σ = ssFloor` | Tre nuvarande grenar gör samma sak med olika villkor |
| settling-guard + low-error-cap | Sane Kp + `Imax` | Båda finns för att skydda mot för stor P |
| ramp-boost (kylning) | Behålls — riktig FF för rampkrav | Inte symptomatisk patch |
| saturation-guard (util ≥ 90%) | Behålls | Hårdvarurelaterad, hör hemma |
| margin-aware floor scaling | Behålls | Fysikaliskt korrekt och oberoende |
| floor-erosion (cool-soft / saturation-erosion / overshoot-erosion) | Behålls | Det är lärningen, inte regulatorn |

Netto: ~500 → ~150 rader i regulatorn.

## Vad behålls (oförändrat)

- `ssFloor`-lärning med fas/mode/legacy-fallback (rad 88–146)
- `persistPidState` (rad 5–21)
- Cooler-margin-skalning av floor (rad 267–274)
- Ramp-boost för aktiva ramper (rad 627–636)
- Util-saturation (rad 166–170)
- `learnThermalRate`, `learnGlycolCoolerRate`, `getGlycolRatesSummary` (rad 700–886, helt orörda)
- API-signaturen `calculateCompensatedTarget(...)` — inga callers ändras

## Genomförande

1. **Skriv ny `calculateCompensatedTarget` parallellt** under nytt namn `calculateCompensatedTarget_v2` i samma fil.
2. **Shadow-run i en cykel**: i `controller-adjustments.ts` anropa v2 efter v1, logga `duty_v1 vs duty_v2 / constraints` i decision-logs (ingen hårdvaruåtgärd från v2). Kör en kväll.
3. **Verifiera** mot Skogens Sus + Gyllene Harmoni: jämför att v2 ger samma 0% i `deadband-coast`-läget och liknande broms i ramp-slut. Acceptanskriterium: `|duty_v2 - duty_v1| ≤ 15%` i ≥80% av cyklerna, och inga mode-flip-utbrott.
4. **Switcha**: byt anropet till v2, ta bort v1, byt tillbaka namnet.
5. **Memory-städning**: ersätt `hold-drift-micro-actuation`, `ramp-end-degree-brake`, `pid-braking-direction-awareness`, `deadband-recovery-and-catchup`, `pid-settling-guard`, `mode-switching-logic`, `pid-baseline-unification` med **en** memory: `pi-core-with-rate-feedforward` som beskriver den nya kärnan + de tre kvarvarande modifierarna.

## Risker

- **Kd-tuning**: pillRate-D är ny kraft i loopen. Start `Kd = 0.10` (mild), öka bara om broms-respons är svag. Begränsa `u_d` till `[-0.40, 0]` så D aldrig adderar duty, bara bromsar.
- **Floor-erosion vid coast**: nuvarande "cool-soft erosion" triggas i deadband-coast-grenen. Måste flyttas till en separat "post-cycle erosion"-check baserad på `avgError ≤ -0.05 && duty == 0` så vi inte tappar den när grenen försvinner.
- **Migration av integraler**: existerande `accumulated_integral` i DB kan ha värden som passar gamla decay/clamp. Lägg en engångs-clamp `integral = min(integral, Imax)` första cykeln.

## Tekniska detaljer

Föreslagna koefficienter (utgångspunkt — finjusteras efter shadow-run):

```text
                Hold        Ramp/Wait
Kp              0.25        0.50
Ki              0.04        0.12
Imax            0.50        0.85
Kd              0.10        0.15
decay (frys)    0.85        0.95
```

Anti-windup-regel (en enda):

```ts
if (duty >= 1 || duty <= 0 || need < -0.05) {
  // freeze + decay
  integral *= decay
} else {
  integral = clamp(integral + Ki * need, 0, Imax)
}
```

Mode-flip-hantering (ersätter tre grenar):

```ts
if (modeJustSwitched) {
  integral = ssFloor > 0 ? ssFloor : 0
  // ingen separat soft-start-cap — Imax + Kp gör jobbet
}
```

Constraints-loggning behålls i samma format så `AutoCoolingDecisionLogs.tsx` UI fungerar utan ändring; bara taggsetet krymper.

## Out of scope

- Ändringar i `controller-adjustments.ts` utöver anropsbytet.
- Ändringar i `process-profiles-logic.ts`, `cooler-management.ts`, learning-tabeller.
- UI-ändringar.
