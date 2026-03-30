

## Plan: Rensa AI-auditens parameterlista från döda funktioner

### Bakgrund
AI-auditen (ai-automation-audit) kan idag justera **~25 parametrar**, men många av dem tillhör borttagna eller oanvända funktioner. Att ha dessa kvar slösar AI-tokens, riskerar att modellen gör meningslösa ändringar, och gör prompten onödigt komplex.

### Parametrar som ska TAS BORT (helt döda)

**Stall-detektion (borttagen)**:
- `stall_rate_threshold` — ingen stall-logik finns
- `auto_boost_degrees` — ingen boost-logik finns  
- `stall_min_attenuation` — ingen stall-logik finns
- `stall_max_attenuation` — ingen stall-logik finns
- `stall_boost_degrees` (fermentation_learnings) — ingen stall-logik finns

**Overshoot-prevention (borttagen som toggle)**:
- `overshoot_pill_threshold` — inte refererad i PID/control-koden
- `overshoot_delta_threshold` — inte refererad i PID/control-koden

**Smart Relay (ej implementerat i control-koden)**:
- `smart_relay_min_hysteresis` — finns inte i _shared/
- `smart_relay_cooling_only_below` — finns inte i _shared/
- `smart_relay_heating_only_above` — finns inte i _shared/
- `smart_relay_tighten_after_minutes` — finns inte i _shared/

**Totalt: 11 parametrar bort** → AI-prompten blir kortare och mer fokuserad.

### Parametrar som BEHÅLLS (faktisk påverkan)

**PID-kompensation (5 st)** — används i `pid-compensation.ts`:
- `pill_compensation_damping`, `pill_compensation_rate_limit`, `pill_compensation_max_compensation`, `pill_compensation_min_scale`, `pill_compensation_emergency_threshold`

**Kylare (3 st)** — används i `cooler-management.ts`:
- `delta_alert_threshold`, `temp_reduction_degrees`, `max_diff_from_lowest`

**Inlärda parametrar (fermentation_learnings)** — används i control-logik:
- `cooler_margin:{bucket}`, `hold_margin:*`, `ramp_margin:*`, `steady_state_duty:*`, `cooling_rate:*`, `warming_rate:*`

### Ändringar

**1. `supabase/functions/ai-automation-audit/index.ts`**:
- Ta bort stall-, overshoot- och smart-relay-sektioner från systemprompten (rad 253–273)
- Ta bort dessa parametrar från `dataPayload.settings` (rad 307–321)
- Ta bort dem från `MAX_STEP`, `BOUNDS`, `VALID_SETTINGS_PARAMS`, `VALID_LEARNING_EXACT` 
- Ta bort `stall_boost_degrees` från `VALID_LEARNING_EXACT`
- Ta bort `boost_outcomes` från datainsamling och payload (rad 139–142, 409–416)
- Uppdatera "Stall-detektion"-referens i systemprompten (rad 200)
- Ta bort `auto_boost_enabled` och `smart_relay_enabled` från FÖRBJUDET-listan (rad 277)

