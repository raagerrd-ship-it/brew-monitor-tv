
# Granskning av autonom automation -- problem och fixar

## Identifierade problem

### 1. `run-automation` och `ai-automation-audit` saknas i `config.toml`
Dessa edge functions har `verify_jwt = true` som standard, vilket innebär att anrop med anon key (fran cron-jobb) eller utan giltig JWT kan misslyckas. `ai-automation-audit` anropas av ett cron-jobb med anon key -- utan `verify_jwt = false` i config.toml sa blockeras anropet.

`run-automation` anropas via `supabase.functions.invoke()` fran `sync-rapt-data-quick` som gor att den skickar med service role key, sa det *fungerar* -- men bor listas for konsistens.

**Fix**: Lagg till bada i `supabase/config.toml`:
```toml
[functions.run-automation]
verify_jwt = false

[functions.ai-automation-audit]
verify_jwt = false
```

### 2. `run-automation` kontrollerar inte om controllers ar aktiva
Orkestratorn kollar bara om `pill_compensation_enabled` och `enabled` (glycol cooling) ar pa, samt om det finns running sessions. Men den kontrollerar inte om nagra controllers faktiskt har kyla/varme aktiverat. Om alla features ar PÅ men inga controllers ar aktiva, kor den anda sub-funktionerna i onodan.

**Fix**: Lagg till en snabb kontroll i `run-automation` som kollar `rapt_temp_controllers` for aktiva controllers (cooling_enabled OR heating_enabled), och skippa om inga finns.

### 3. AI-audit `serve()` vs `Deno.serve()`
`ai-automation-audit` anvander den aldre `serve()` fran `deno.land/std`, medan ovriga funktioner anvander `Deno.serve()`. Det fungerar men ar inkonsekvent. Ingen kritisk bugg, men bor uppdateras for konsekvens.

### 4. Stall-detektion: `currentSg` och `currentAvgDelta` refereras utan att definieras tydligt i scope
Pa rad 988-990 i `auto-adjust-cooling/index.ts` refereras `currentSg` och `currentAvgDelta` i `fermentation_step_log`-inserten. Dessa variabler definieras langre upp i stall-loopen men kan vara osynliga for lasaren -- de ar dock i scope. Ingen bugg, men ror koden.

### 5. Glykolkylare: outcome evaluation soker pa "struggling to cool" i reason-texten
Pa rad 1015 filtreras adjustment-historiken med `.like('reason', '%struggling to cool%')`. Men reason-texten pa rad 1349 ar exakt `"${name} struggling to cool"`. Om controllern heter ngt med specialtecken kan det bli problem, men det ar en minor risk.

### 6. Recovery-logik kollar alla `%Cooling recovery%` istallet for per-controller
Pa rad 1396 soker systemet efter den senaste cooling recovery globalt -- inte per controller. Om du har *tva* kylare (ovanligt men mojligt), kan en controllers recovery blocka den andras.

**Fix**: Lagg till `.eq('cooler_controller_id', coolerController.controller_id)` i recovery interval-queryn.

---

## Sammanfattning av fixar

| # | Problem | Allvarlighet | Fix |
|---|---------|-------------|-----|
| 1 | `config.toml` saknar `run-automation` och `ai-automation-audit` | **Hog** -- AI-audit cron-jobbet fungerar troligen inte | Lagg till verify_jwt = false |
| 2 | `run-automation` kor sub-funktioner aven utan aktiva controllers | Lag | Lagg till controller-check |
| 3 | `serve()` vs `Deno.serve()` i AI-audit | Lag | Uppdatera till `Deno.serve()` |
| 4 | `currentSg`/`currentAvgDelta` scope i stall-log | Kosmetisk | Ingen andring behövs |
| 5 | Reason-text sokning med LIKE | Lag risk | Ingen andring behövs |
| 6 | Recovery interval globalt istallet for per-controller | Medium | Lagg till controller-filter |

## Teknisk implementering

### Fil 1: `supabase/config.toml`
Lagg till:
```toml
[functions.run-automation]
verify_jwt = false

[functions.ai-automation-audit]
verify_jwt = false
```

### Fil 2: `supabase/functions/run-automation/index.ts`
Lagg till kontroll av aktiva controllers fore stegen kors:
```typescript
// Before steps: check if any controllers are actually active
const { data: activeControllers } = await supabase
  .from("rapt_temp_controllers")
  .select("controller_id")
  .or("cooling_enabled.eq.true,heating_enabled.eq.true")
  .not("is_glycol_cooler", "eq", true)
  .limit(1);

const hasActiveControllers = activeControllers && activeControllers.length > 0;
```
Anvand `hasActiveControllers` som extra villkor for att kora stegen.

### Fil 3: `supabase/functions/ai-automation-audit/index.ts`
- Byt `import { serve }` till `Deno.serve()`
- Konsekvent med ovriga edge functions

### Fil 4: `supabase/functions/auto-adjust-cooling/index.ts`
- Rad ~1396: Lagg till `.eq('cooler_controller_id', coolerController.controller_id)` i recovery-intervall-queryn sa den ar per-kylare.
