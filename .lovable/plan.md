
# Installera V6 för A/B-test

Skriv över befintliga filer med de nya versionerna från Claude. Toggeln i controller-dialogen (V5 | Claude) finns redan och används för att köra V5 och V6 parallellt på olika tankar.

## Steg

1. **`supabase/functions/_shared/learning-utils.ts`** — ersätt med uppladdad version.
   Nytt: `blendObservation` helper (pure), `updateLearnedParam` och `LearnBatch.update` tar två nya opt-in-parametrar (`alphaOverride`, `maxStepFraction`). Alla befintliga anrop är byte-identiska — de nya parametrarna är `undefined` som default.

2. **`supabase/functions/_shared/pid-compensation-claude.ts`** — ersätt med uppladdad `pid-compensation.ts`.
   Detta är filen som toggeln redan router:ar till när controllern är satt till "Claude". V5-koden i `pid-compensation.ts` (huvudfilen) rörs inte.

3. **Rekommenderad A/B-uppdelning** (görs manuellt i UI:et efter deploy, ingen kod):
   - Mjöd → V5 (control, känd baseline)
   - Skogens Sus → V6 (nytt)
   
   Kör 3–5 dagar, jämför duty-ripple, overshoot och total PWM-aktivitet.

## Vad som INTE ändras

- `pid-compensation.ts` (V5) — oförändrad
- `controller-adjustments.ts` router — oförändrad, dispatch:ar redan på `fc.pid_version`
- `RaptControllerDialog.tsx` toggle — oförändrad
- `rapt_temp_controllers.pid_version`-kolumnen — finns redan från förra migrationen
- Databasschema — inga migrationer behövs

## Tekniska detaljer

**Bakåtkompatibilitet i learning-utils:**
Signaturen `updateLearnedParam(supabase, controllerId, paramName, newObservation, clampMin, clampMax, alphaOverride?, maxStepFraction?)` — två nya optional-parametrar i slutet. Alla existerande callers (fermentation-learnings.ts, controller-adjustments.ts, sg-temp-correction.ts, m.fl.) fortsätter fungera oförändrat.

**Nya fermentation_learnings-rader V6 skriver:**
- `feedforward_duty:cooling` / `feedforward_duty:heating` (redan används av V5, delas)
- `process_gain:cooling` / `process_gain:heating` (ny)

Delade parametrar mellan V5 och V6 är OK — V5 använder `feedforward_duty:*` som duty-golv, V6 använder det som primärbias. Läser samma värden, båda kompatibla.

**controller_learned_compensation-rader V6 skriver:**
`step_type='v6'` — separat från V5:s `step_type='hold'/'ramp'/etc`, så state-tabellerna delas inte mellan versionerna. Byter man tillbaka en tank från V6 till V5 finns V5:s inlärda state kvar orört.

## Efter installation

Ingen automatisk rebuild-krav — edge functions plockar upp filändringarna på nästa körning. Öppna Skogens Sus-dialogen, växla PID-motor till "Claude", spara. Övervaka `auto_cooling_decision_logs` och `controller_learned_compensation` de närmaste timmarna för att bekräfta att V6 skriver med `step_type='v6'` och constraints ser rimliga ut.
