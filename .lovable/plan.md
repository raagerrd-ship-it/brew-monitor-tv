

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

