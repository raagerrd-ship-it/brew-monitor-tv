

## Varför AI:n tror det är cold crash

**Problemet:** AI-auditen ser dessa data för "Temp Controller Gul":
- `fermentation_phase: stationary` (SG rör sig inte)
- `ready_to_crash: true`
- Pill: 8.97°C, Probe: 6.97°C → delta ≈ 2.0°C
- Target: 8°C

Prompten säger: "Stort delta + låg jäsningsaktivitet = kylningen driver för hårt (cold crash)". AI:n tolkar detta som en aktiv cold crash — men 8°C är bara normal lagertemperatur.

**Grundorsak:** AI:n har ingen information om vilken typ av steg som körs (hold vs crash) eller vad som är "normalt" för denna bryggning. Den ser bara fas + delta + target och gissar.

## Plan: Ge AI:n bättre kontext

1. **Lägg till step-typ och profil-kontext i AI-prompten** — Inkludera data om aktiv fermentationssession (om det finns en), vilken stegtyp som körs (hold/ramp/crash/wait_for_sg), och profilens namn. Om ingen session körs, flagga det explicit.

2. **Definiera "cold crash" tydligt i prompten** — Lägg till en regel: "Cold crash innebär att måltemperaturen **aktivt sänks mot ≤4°C**. En stabil hold vid 6-10°C är INTE cold crash — det är normal lagerjäsning. Bedöm inte enbart baserat på delta."

3. **Skicka med `profile_target_temp` och ev. step-mål i controller-data** — Så AI:n kan se om temperaturen är stabil (hold) eller sjunkande (ramp/crash).

### Tekniska ändringar

**Fil: `supabase/functions/ai-automation-audit/index.ts`**

- Hämta `fermentation_sessions` med `current_step_index` och `step_started_at` och joina med `fermentation_profiles` (name) för running sessions
- Hämta `fermentation_profile_steps` för running sessions för att veta aktuellt steg-typ
- Lägg till i controller-objektet: `active_step_type` (hold/ramp/crash/wait_for_sg/null), `profile_name`
- Uppdatera systemprompten med tydlig definition av cold crash vs normal hold

