# Jäsprofiler — hur systemet fungerar

Detta dokument beskriver hela kedjan: profil → session → steg → måltemperatur → Pi-reglering.
Det kan användas både som referens och som prompt till en AI-assistent.

---

## 1. Datamodell

| Tabell | Roll |
|---|---|
| `fermentation_profiles` | Mall: namn + beskrivning. |
| `fermentation_profile_steps` | Stegen i mallen, ordnade via `step_order`. |
| `fermentation_sessions` | En körning av en profil på en controller (+ ev. brygd). Håller `current_step_index`, `step_started_at`, `step_start_temp`, `ramp_triggered_at`, `ramp_start_sg`. |
| `fermentation_step_log` | Händelselogg per steg (`started`, `temp_adjusted`, `condition_met`, `completed`…). |
| `brew_fermentation_metrics` | Förberäknade mätvärden: fas, aktivitetspoäng, SG-hastighet, ETA, `ready_to_crash`. |
| `brew_data_snapshots` | SSOT för SG-historik (3-min buckets, synkade med Pi:ns rollup). |
| `rapt_temp_controllers.profile_target_temp` | **Enda utdata** från profilmotorn — måltemperaturen Pi:n reglerar mot. |

Viktigt: profilmotorn skriver **aldrig** hårdvara direkt. Den sätter bara `profile_target_temp`
(via `setProfileTarget()` i `_shared/types.ts`). All reglering (PID V6, PWM, relä) körs lokalt på Pi:n.

---

## 2. Körcykel

`process-fermentation-profiles` (edge function) → `_shared/process-profiles-logic.ts → processAllSessions()`
körs på cron, och gör per varv:

1. Hämtar alla sessioner med `status = 'running'`.
2. Varnar om två sessioner styr samma controller (`controller_conflict`-notis).
3. Batch-hämtar steg, controllers, brygddata och metrics (en query per typ, inte per session).
4. Hämtar SG-serier från `brew_data_snapshots` (`fetchSgDataBatch`).
5. Per session:
   - Stale-guard: controllerdata äldre än 60 min → hoppa över (ingen temp-beroende övergång).
   - Timeout-guard: steg som kört > 7 dygn → notis `step_timeout` (max 1 per 24 h).
   - Kör `processStep(ctx)` (dispatcher i `_shared/step-handlers.ts`).
   - Loggar åtgärden om den inte är `checked`.
   - Om steget är klart: klampa nästa stegs måltemp mot controllerns min/max (annars `safety_blocked`),
     annars `advanceToNextStep()` eller `completeProfile()`.

`elapsedHours` räknas alltid från `step_started_at`.

---

## 3. Temperatur-SSOT

- Steghanterarna läser **endast** `controller.actual_temp` (`getResolvedTemp()`).
  `actual_temp` är Pi:ns fusionerade värde = medel av PT100 och Pill.
- Tolerans "temp nådd" = ±0,3 °C.
- Om ett steg saknar `target_temp` ärvs närmaste tidigare stegs mål via `getEffectiveTargetTemp()`.

---

## 4. Stegtyper

### `ramp` — Temperaturrampa
- `ramp_type = 'immediate'`: sätter måltemp direkt, väntar tills `actual_temp` är inom ±0,3 °C.
- `ramp_type = 'linear'`: interpolerar mellanmål från `step_start_temp` → `target_temp` över `duration_hours`
  och skriver nytt `profile_target_temp` när det ändrats > 0,05 °C.
- Klart när **både** tiden gått ut **och** temperaturen nåtts.
- Valfri stabilitetsgrind: `stability_window_minutes` + `stability_max_deviation`
  (hard-cap 0,1 °C). Kräver ≥3 samples i `temp_controller_history` samt att både drift och
  avvikelse mot målet håller sig inom max-dev.

### `hold` — Håll temperatur
- Sätter måltemp och väntar på `duration_hours` och/eller `target_sg` (`sg_comparison`).
- Har båda satts räcker det att **en** villkoret uppfylls.
- Kräver dessutom att temperaturen ligger inom ±0,3 °C av målet innan steget släpps.
- Saknas både varaktighet och SG-mål loggas varning `no_exit_condition` (steget avslutas aldrig av sig självt).

### `wait_for_temp`
Sätter måltemp, klart när `actual_temp` är inom ±0,3 °C.

### `wait_for_sg`
Håller ärvd måltemp, klart när senaste SG uppfyller `target_sg` med `at_or_below` / `at_or_above`.

### `wait_for_gravity_stable`
- Klart när `isGravityStable()` är sann **och** `activity_score < 25`.
- `isGravityStable(sgData, stableDays, threshold)` kräver:
  - minst `max(8, stableDays*4)` mätpunkter i fönstret,
  - att fönstret verkligen täcker ~90 % av `stableDays`,
  - att spridningen (max−min) ≤ threshold,
  - att medianen av senaste 2 h vs äldsta 2 h skiljer ≤ threshold.

### `diacetyl_rest` — Diacetylvila
- Triggar när attenuering ≥ `attenuation_trigger` (default 75 %) **och** fasen är `declining`/`stationary`.
- Vid trigg sparas `ramp_triggered_at` som statusflagga och måltemp höjs till `bastemp + temp_increase` (default +3 °C).
- Klart när SG är stabil (`gravity_stable_days`, default 2 d) **och** `activity_score < 5`.

### `gradual_ramp` — Smart diacetylvila
Tre faser:
1. **Vänta på trigg**: kräver att de tre senaste tickarna alla har `activity_score ≤ activity_trigger` (default 35 %).
   En enstaka brusdipp triggar alltså inte rampen. Vid trigg sparas `ramp_triggered_at`, `step_start_temp = bastemp`
   och `ramp_start_sg` (30-min median).
2. **Rampa**: mål = `max(SG-driven ramp, tidsgolv)`, alltid klampat till `[bastemp, bastemp + temp_increase]`.
   - SG-driven: `progress = (ramp_start_sg − currentSg) / (ramp_start_sg − FG)`, currentSg = 30-min median.
   - Tidsgolv: `elapsed / min_ramp_hours` — garanterar att temperaturen fortsätter stiga även om SG stannar av.
   - Måltemperaturen är monoton — den sänks aldrig tillbaka.
3. **Klart** när SG är stabil (`gravity_stable_days`) och `activity_score < 5`.

### `wait_for_acknowledgement`
Håller ärvd måltemp och väntar på manuell kvittens i UI:t. Undantaget från 7-dygnsguarden.

---

## 5. Metrics (`compute-fermentation-metrics`)

`_shared/fermentation-metrics-logic.ts` körs på cron för alla brygder med status Fermenting/Jäsning:

- **Fas**: `lag` (< 12 h & låg takt) → `exponential` (> 60 % av peakhastighet) → `declining` → `stationary` (< 0,001 SG/dygn).
- **`sg_rate_per_hour`**: derivata över senaste 6 h (kräver ≥ 1 h span).
- **`activity_score` (0–100)**: hybrid av temp-delta-aktivitet (senaste 90 min, relativt peak) och
  SG-hastighet (relativt peak × absolut faktor). Returnerar 0 när SG-takten är under golvet 0,00004/h.
- **`eta_to_fg_hours`**: (currentSg − FG) / SG-takt, nollställs om > 720 h.
- **`ready_to_crash`**: SG-spridning < 0,001 senaste 48 h **och** attenuering > 70 % **och** aktivitet < 15 **och** fas `stationary`.
  Loggas en gång per session som `ready_to_crash` i steg-loggen.
- **`predicted_sg_curve`**: exponentiellt avtagande modell `FG + (OG−FG)·e^(−k·t)`, där k startar från bryggstil
  (lager 0,010 / ale 0,020 / saison 0,025) och adapteras mot faktisk mittpunkt.

Metrics är read-only för profilmotorn — de används som grind i `wait_for_gravity_stable`,
`diacetyl_rest` och `gradual_ramp`.

---

## 6. Stegövergångar

`_shared/session-lifecycle.ts`:
- `advanceToNextStep()`: uppdaterar `current_step_index`, nollställer `step_started_at` och `ramp_triggered_at`,
  sätter `step_start_temp` till nuvarande `profile_target_temp` om nästa steg är en ramp, och sätter direkt
  nya stegets måltemp. Loggar `started`.
- `completeProfile()`: sätter `status = 'completed'`, loggar `completed`.
  `profile_target_temp` lämnas kvar som den var — sista stegets mål blir baslinje i manuellt läge.

---

## 7. Frontend

- `src/types/fermentation.ts` — typer och svenska etiketter för stegtyper.
- `src/components/fermentation/` — profileditor, sessionsstart, aktiv session, stegvisning, profil-graf.
- `src/components/fermentation/hooks/useFermentationProgress.ts` — beräknar visningsprogress
  (stabilitetstid, SG-progress, ramp-progress, "väntar på temp") från samma data som backend, men enbart för UI.

---

## 8. Invarianter

1. Profilmotorn skriver bara `profile_target_temp` — aldrig relä, duty eller hårdvarumål.
2. All reglering körs lokalt på Pi:n (V6). Moln-PID är permanent borttaget.
3. `actual_temp` är den enda temperatur som styr stegvillkor.
4. Måltemp klampas alltid mot controllerns `min_target_temp` / `max_target_temp`.
5. Stale sensordata (> 60 min) blockerar alla temp-beroende övergångar.
6. En session per controller.
