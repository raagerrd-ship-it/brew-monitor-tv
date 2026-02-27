

## Granskning: Smart diacetylvila (`gradual_ramp`)

### Styrkor (redan professionellt)
- **Exponentiell kurva** (`rampProgress ** 2`) — försiktig start, accelererar mot slutet
- **Ratchet-mekanism** (rad 523-528) — temperaturen går aldrig bakåt
- **Min ramp hours** med `ramp_triggered_at` — tidsbegränsning räknas från trigger, inte stegstart
- **Tvåfas-triggning** — väntar tills aktivitet < tröskel ELLER backend redan rampar
- **Kompletteringsvillkor** — kräver både SG-stabilitet OCH aktivitet < 15%
- **Loggning av trigger-event** i `fermentation_step_log`

### Brister att åtgärda

1. **`ProfileStep`-typen i `temp-utils.ts` saknar `gradual_ramp` och `diacetyl_rest`**
   - Rad 11: `step_type` union har bara de gamla typerna
   - Fält som `activity_trigger`, `temp_increase`, `min_ramp_hours`, `ramp_curve` saknas helt
   - Tvingar fram `(currentStep as any)` i step-handlers.ts (rad 443-445)
   - **Fix**: Utöka `ProfileStep` med alla moderna fält och stegtyper

2. **Ingen notifikation vid ramp-trigger**
   - Profilen skickar notis vid slutförande men **inte** när gradual ramp aktiveras
   - Viktigt att veta: "Din diacetylvila har startat automatiskt"
   - **Fix**: Lägg till `insertNotification()` vid första trigger (rad 489-501)

3. **Ingen notifikation vid gradual_ramp-slutförande**
   - `stepCompleted = true` sätts (rad 553) men ingen notis skickas
   - Notisen skickas bara för hela profilen, inte per steg
   - **Fix**: Lägg till notis i completion-blocket

### Ändringar

| Fil | Ändring |
|---|---|
| `supabase/functions/_shared/temp-utils.ts` | Utöka `ProfileStep` med `diacetyl_rest`, `gradual_ramp`, `wait_for_acknowledgement` + fälten `attenuation_trigger`, `activity_trigger`, `temp_increase`, `min_ramp_hours`, `ramp_curve` |
| `supabase/functions/_shared/step-handlers.ts` | Ta bort alla `(currentStep as any)` → använd typade fält. Lägg till `insertNotification()` vid trigger + completion |

