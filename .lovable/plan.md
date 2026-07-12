## Problem

Green pendlar mellan cool→heat idag. Rot-orsak:
- `feedforward_duty:heating` = 11% (senast uppdaterad 2026-07-08, 4 dagar gammal)
- `feedforward_duty:cooling` = 1.6% (senast uppdaterad 2026-07-09)

Befintlig `learnFeedforwardDuty` räknar physics-baserat (ambient-drift ÷ per-pct-respons) från senaste 6h historik. Kräver `n_amb ≥ 4` OCH `n_resp ≥ 4` distinkta perioder — dvs både renodlade duty=0-perioder OCH renodlade duty>2%-perioder med tydlig temperaturderivata. Under pendel-läge blandas dessa: temp oscillerar runt målet, duty hoppar mellan 0 och 30%, ingendera fasen håller sig länge nog med tydlig derivata. Learner faller ner i `fallback(existing)` och stale-värdet lever kvar. Med fel bias-duty kompenserar trimI + P för mycket → överskjutning → mode-flip.

## Lösning

Lägg till en **direkt hold-observation** som körs varje PID-cykel parallellt med den fysik-baserade learner:n. När wort är stabilt vid target är det ju precis då den utkommenderade duty ÄR den sanna ssFloor — det behövs ingen derivataberäkning.

Kriterier för giltig hold-observation:
1. Controller tillhör en brygga med `status = 'jäser'` (aktiv tank)
2. `|actualTarget - actualTemp| ≤ 0.15°C` i minst 3 påföljande PID-cykler (~15 min)
3. Samma `mode` genom hela fönstret (ingen flip)
4. Ingen PWM-burst eller manuell override under fönstret

När kriterierna är uppfyllda: EMA-blend medianduty från fönstret in i `feedforward_duty:{mode}` med alpha=0.05 och maxStepFraction=0.05 (försiktigare än physics-learner så en enskild slump-observation inte kan flytta värdet mer än 5% av spannet).

Detta ger `learnFeedforwardDuty` en andra datakälla som fungerar när fysikmätningarna inte konvergerar, och gäller specifikt för aktiva tankar (jäser-status) — inaktiva/lagrade tankar rör inte biasen.

## Teknisk implementation

**Ny tabell:** ingen. Fönstret hålls i `sensor_anchor` JSONB (samma rad som PID-state redan lagras i `controller_learned_compensation`).

**Filer:**

1. `supabase/functions/_shared/pid-compensation-claude.ts`
   - Utöka `V5PidState`-typen med `holdWindow: { count: number, dutySum: number, mode: string, startedAt: string } | null`.
   - Ny funktion `observeHoldSsFloor(supabase, controllerId, mode, actualTarget, actualTemp, dutyCycle, prevState, activeBrewStatus) → { nextHoldWindow, didUpdate }`:
     - Om `|err| > 0.15` eller mode-flip eller inte "jäser" → nollställ fönster, return.
     - Annars öka `count`, addera duty. Vid `count >= 3` → beräkna median (använd running mean-approx: `sum/count`), anropa `updateLearnedParam` med `alpha=0.05, maxStepFraction=0.05`, nollställ fönstret, logga.
   - Anropa i `calculateCompensatedTargetV5` efter `computeDutyV5` men innan `persistPidState`. Pass through `activeBrewStatus` som ny parameter.

2. `supabase/functions/_shared/controller-adjustments.ts` (call site)
   - Hämta redan-läst brew-status för denna controller (finns i orchestrator-payload). Skicka in som ny parameter till `calculateCompensatedTargetV5`.

**Beteende:**
- Aktiv tank i hold vid target → ssFloor konvergerar löpande mot faktisk hold-duty.
- Aktiv tank i ramp/pendel → hold-observationen står stilla, physics-learner kör som förr.
- Inaktiv tank (omtappad/lagras) → observationen skippas, biasen fryses.

**Loggning:**
`🔒 hold-ssFloor Green [heating]: 3 cykler @ err=0.08° medduty=18.7% → ff 11.0%→11.4%`

## Verifiering

1. Enhetscheck: `observeHoldSsFloor` med syntetisk fönster-input returnerar korrekt medelvärde och nollställer efter uppdatering.
2. Efter deploy: kolla att `fermentation_learnings.last_updated_at` för `feedforward_duty:heating` på Green uppdateras inom en hold-period (senast nästa gång Green sitter still vid target 15 min i sträck).
3. Följ auto_cooling_decision_logs över kommande 12h — förvänta färre mode-flips och mindre trimI-amplitud när ff närmar sig faktiskt hold-behov.

## Icke-mål

- Ingen ändring av physics-learner (`learnFeedforwardDuty`) — den fortsätter köra i parallell.
- Ingen ändring av mode-switch-logik eller trimI-taken.
- Ingen ändring för Skogens Sus (V5-PID) — patchen gäller Claude-loopen.
- Ingen migration behövs; `sensor_anchor.holdWindow` är bara ett nytt fält i befintlig JSONB.
