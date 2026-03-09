

# Smart Relay & Adaptiv Hysteresis — Per Tank Controller

## Klarifiering

Denna feature gäller **individuella tank-controllers** (ej glykolkylaren). Varje tank-controller har egna heating/cooling-reläer med hysteres. Logiken ska automatiskt:

1. **Stänga av onödiga reläer** baserat på riktning (target vs actual)
2. **Minska hysteres** om controllern inte når mål inom en viss tid

## Relay-val per controller

```text
Target < Actual (ska sjunka)  → cooling ON, heating OFF
Target > Actual (ska stiga)   → heating ON, cooling OFF
Hold-zon (inom 0.5°C)         → temperaturband:
  target < 15°C → cooling only (jäsning genererar värme)
  target > 20°C → heating only (temp sjunker naturligt)
  annars        → båda ON
```

## Adaptiv Hysteresis

Om controllern inte når mål (±0.5°C) inom t.ex. 30 min, minska det aktiva reläets hysteres stegvis (0.2°C/cykel) ned till min 0.3°C. Återställ vid uppnått mål.

## Teknisk plan

### 1. Nya RAPT API-actions i `rapt-update-controller/index.ts`

Lägg till tre actions i `ALLOWED_ACTIONS`:
- `setHeatingHysteresis` → `SetHeatingHysteresis` endpoint
- `setHeatingEnabled` → `SetHeatingEnabled` endpoint
- `setCoolingEnabled` → `SetCoolingEnabled` endpoint

### 2. Wrapper-funktioner i `temp-utils.ts`

Skapa `setHeatingHysteresis()`, `setHeatingEnabled()`, `setCoolingEnabled()` — samma mönster som `setCoolerHysteresis()`.

### 3. Databasändringar

**`auto_cooling_settings`** — nya kolumner:
- `smart_relay_enabled` boolean default false
- `smart_relay_cooling_only_below` numeric default 15
- `smart_relay_heating_only_above` numeric default 20
- `smart_relay_min_hysteresis` numeric default 0.3
- `smart_relay_tighten_after_minutes` integer default 30

**`rapt_temp_controllers`** — nya kolumner:
- `smart_relay_active` boolean default false
- `pre_smart_heating_enabled` boolean nullable
- `pre_smart_cooling_enabled` boolean nullable
- `pre_smart_heating_hysteresis` numeric nullable
- `pre_smart_cooling_hysteresis` numeric nullable
- `smart_relay_off_target_since` timestamptz nullable

### 4. Ny processor: `runSmartRelay` i `controller-adjustments.ts`

Placeras **före** PID i pipeline:

```text
Pipeline:
  1. Bootstrap
  2. Smart Relay (NEW)  ← toggle reläer + adaptiv hysteres per tank
  3. PID Control
  4. Pass-through
  5. Stall Detection
```

Per controller (alla steg-typer):
1. Läs `profile_target_temp` och `actual_temp`
2. Bestäm riktning → toggle reläer via RAPT API
3. Kolla `smart_relay_off_target_since` — om > N min, minska hysteres
4. Om on-target: återställ hysteres till original
5. Spara originalvärden i `pre_smart_*` vid första ändring

Återställning sker vid: session avslutad, feature avstängd, manuell ändring.

### 5. UI i Settings (automation-tab)

Nytt avsnitt "Smart Relay" med:
- Enable/disable toggle
- Temperaturband-inputs (kylning-under, värme-över)
- Min hysteres
- Minuter innan tightening

### 6. Beslutsloggning

- `SMART_RELAY`: "Ramp ned → disabled heating (target 12°C < actual 14°C)"
- `SMART_RELAY_TIGHTEN`: "Minskade cooling hysteres 2.0 → 1.8°C (35min off-target)"
- `SMART_RELAY_RESTORE`: "Återställde heating hysteres 2.0°C"

### Filer som ändras

- `supabase/functions/rapt-update-controller/index.ts` — 3 nya actions
- `supabase/functions/_shared/temp-utils.ts` — 3 nya wrappers
- `supabase/functions/_shared/controller-adjustments.ts` — ny `runSmartRelay` processor
- `src/pages/Settings.tsx` (eller automation-settings komponent) — UI
- DB-migration för nya kolumner

---

## ✅ Genomförd fix: Kick-flagga timing (2026-03-03)

**Problem:** `hysteresis_kick_active` sattes i DB direkt efter att kicken köades i batch, men FÖRE flush. Om flush misslyckades hade DB en felaktig flagga.

**Fix:** 
- `cooler-management.ts`: Sätter `ctx.pendingKickControllerId` istället för att skriva direkt till DB
- `auto-adjust-cooling/index.ts`: Kontrollerar `batchResults` efter flush och sätter flaggan BARA om RAPT API-anropet lyckades
- Nytt fält `pendingKickControllerId` på `CoolerContext` interface

---

## ✅ Web Push-notifieringar (2026-03-03)

**Implementerat:**
- `push_subscriptions` tabell med RLS (anyone can CRUD)
- `generate-vapid-keys` edge function — genererar/hämtar VAPID-nycklar
- `send-push-notification` edge function — skickar push till alla prenumeranter via `@negrel/webpush`
- `public/push-sw.js` — service worker för push-event + notificationclick
- `src/lib/web-push-registration.ts` — auto-registrering, subscription-hantering
- `_shared/notifications.ts` — varje `insertNotification()` triggar nu push via fetch
- VAPID-nycklar sparade som secrets (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`)
- Auto-register körs vid app-load i `App.tsx` om permission redan beviljad

---

## ✅ Förbättrad passiv inlärning — Termisk profil (2026-03-04)

**Implementerat:**
- `cooler-management.ts`: `learnFromCurrentState()` utökad med:
  - `cooling_rate:{bucket}:{load}` — kylhastighet per temperaturzon och antal aktiva tankar
  - `warming_rate:{bucket}` — passiv uppvärmningshastighet (lärs när ingen tank kyler)
  - `hold_margin:{bucket}:{load}` — optimal marginal under hold-steg
  - `ramp_margin:{bucket}:{load}` — optimal marginal under ramp-steg
  - `cooling_capacity:{load}` — max kylkapacitet vid ~100% utilization
- Ny `learnWarmingRate()` funktion för passiv inlärning vid 0% kylaktivitet
- Ny `LearnedThermalProfile.tsx` UI-komponent i Settings > Kylare-inlärning
- Ingen databasändring — alla parametrar ryms i befintlig `fermentation_learnings` tabell

---

## ✅ Steady-state duty cycle (2026-03-05)

// ... keep existing code

---

## ✅ PWM burst-per-cycle modell (2026-03-05)

**Problem:** Gamla PWM-modellen delade upp en timme i 12 segment (5 min/segment), hela segmentet antingen "på" eller "av". Grov granularitet — antingen 5 min kylning eller 0.

**Fix:**
- `controller-adjustments.ts`: Ny `PwmBurst` interface. PWM-logik returnerar nu burst-metadata (on_target, off_target, duty_seconds) istället för att direkt styra target_temp. Duty beräknas som `max(30, min(240, duty_pct × 300))` sekunder per 5-minuterscykel.
- `auto-adjust-cooling/index.ts`: `pwmBursts` array propageras i context och returneras i JSON-response.
- `run-automation/index.ts`: Nytt steg 3b efter PID: för varje burst skickas on-target via RAPT API → sleep(duty_seconds) → off-target via RAPT API. Körs sekventiellt efter PID-steget.
- Stabilitetskrav (4 cykler ±0.3°C) behålls.

---

## ✅ PWM burst OFF-timing fix (2026-03-06)

**Problem:** PWM ON skickade 0°C direkt men OFF lagrades i `pending_rapt_retries` och kördes först nästa cykel (5 min senare). Vid 20% duty (60s) kyldes tanken i 300s istället för 60s.

**Fix:**
- `controller-adjustments.ts`: Populerar `pwmBursts` arrayen med burst-metadata OCH behåller `pending_rapt_retries` som fallback-säkerhet.
- `auto-adjust-cooling/index.ts`: Returnerar `pwmBursts` i JSON-response.
- `run-automation/index.ts`: Steg 3b efter PID — `sleep(dutySeconds)` → skickar OFF via `rapt-update-controller` → tar bort pending vid success. Om sleep/OFF misslyckas behålls pending och körs nästa cykel.

---

## ✅ Fix kylarmarginalen ratchet-effekt (2026-03-05)

**Problem:** `min_effective_margin` fungerade som ett hårt golv (`baseMargin = max(learnedMargin, minEffective)`) och hade en uppåtgående ratchet vid 100% utilization (+10–15%), vilket drev marginalen till 7.21°C utan möjlighet att sjunka tillbaka.

**Fix:**
- `cooler-management.ts`: `baseMargin` använder nu `learnedMargin.value` direkt — `min_effective` loggas bara som referens
- `learnMinEffectiveMargin()`: Borttagen boost-logik vid util ≥ 99%, nu ren EMA-observation
- `learning-utils.ts`: `updateLearnedParam()` accepterar nu `alphaOverride` parameter
- Vid låg utilization (<50%) används snabbare alpha (0.3) för nedåt-konvergens
- DB: Återställt `min_effective_margin:cold` 7.21→3.0°C och `min_effective_margin:cool` 5.4→3.0°C

---

## ✅ Fix: Profilmål användes som hårdvarumål (2026-03-05)

**Princip:** `profile_target_temp` är ALLTID virtuellt — det enda riktiga målet som skickas till hårdvara eller används som golv/referens är `ctrlTarget` eller `ctrlTargetPid`.

**Problem:** `actualTarget` (= profilmålet 8°C) användes som golv i heater guard och som restore-mål vid stall un-boost, vilket aktiverade värmaren och skapade oscillationer.

**Fix:**
- `controller-adjustments.ts`: Heater guard-golv ändrat från `actualTarget` → `ctrlTarget`
- `stall-detection.ts`: Un-boost restore använder `boostOldTarget` (pre-boost hårdvarumål) istället för `effectiveProfileTarget`
- `stall-detection.ts`: Loggning av `new_target_temp` vid un-boost använder `boostOldTarget` istf profilmålet

---

## ✅ Dual Sensor Fusion — Isolerad modul (2026-03-06)

**Problem:** Sensorkompensering (pill-probe delta) var djupt sammanflätad med PID-regleringen i `pid-compensation.ts`. Termer som "delta", "compensation", "avgDelta", "rawCompensation", "approachScale" gjorde logiken svår att förstå.

**Arkitektur (ny):**
```text
profileTarget ──→ dualSensorTarget() ──→ baseTarget ──→ PID(baseTarget) ──→ ctrlTargetPid
                  (ren formel)                          (PI + D-term + guards)
```

**Ny fil:** `supabase/functions/_shared/dual-sensor.ts`
- Ren funktion utan sidoeffekter: `baseTarget = profileTarget - (pill - probe) / 2`
- `actualTemp = (pill + probe) / 2` (eller probe ?? pill om ej dual)
- Exporterar `DualSensorResult` interface

**Refaktorering `pid-compensation.ts`:**
- Tar emot `sensorDelta` parameter (från dual-sensor)
- `compensation = sensorDelta` (ren, ingen approach zone eller D-term-skalning)
- Borttaget: approach zone (`approachScale`, `APPROACH_ZONE_SIZE`, `distanceToTarget`)
- Borttaget: `rawCompensation`, `deadbandCompensation`
- D-term damping kvarstår enbart på `errorCorrection` (PI-loop)
- Formel i logg: `Profil − Δ(sensor) + PI = Mål`

**Refaktorering `controller-adjustments.ts`:**
- Anropar `computeDualSensorTarget()` före PID
- Skickar `sensorDelta` till PID
- `effectiveDelta` = ren `sensorDelta` (ingen bakåtberäkning)
- Loggfält: `sensor_delta` ersätter `raw_delta`/`raw_compensation`

**Filer:**
- **NY** `supabase/functions/_shared/dual-sensor.ts`
- **ÄNDRAD** `supabase/functions/_shared/pid-compensation.ts`
- **ÄNDRAD** `supabase/functions/_shared/controller-adjustments.ts`
- **ÄNDRAD** `supabase/functions/_shared/temp-utils.ts` (re-exports)
