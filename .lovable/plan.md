

## Analys

Användaren har helt rätt. Nuvarande stegtyper har stor överlappning:

| Stegtyp | Vad den gör | Slutvillkor |
|---------|-------------|-------------|
| `hold` | Håll temp | Tid ELLER SG-värde |
| `wait_for_gravity_stable` | Håll temp (ärvd) | Stabil SG i N dagar |
| `wait_for_sg` | Håll temp (ärvd) | SG når visst värde |
| `wait_for_temp` | Sätt temp | Temperaturen nådd |

Alla fyra håller/sätter en temperatur och skiljer sig bara i slutvillkor. `hold` har redan en dropdown för "Tid" vs "SG-värde". Vi utökar den till att inkludera alla slutvillkor.

## Plan

### 1. Utöka "Håll temperatur" med fler slutvillkor i editorn

**FermentationStepEditor.tsx** — Utöka `holdEndCondition` från `"time" | "sg"` till `"time" | "sg" | "gravity_stable" | "temp_reached"`:

- **Tid** — Befintligt, visar timmar-fält
- **SG-värde** — Befintligt, visar SG + jämförelse
- **Stabil SG** — Visar antal dagar + tröskel (från nuvarande `wait_for_gravity_stable`)
- **Temperatur nådd** — Visar måltemp, steget avslutas när temp nås (från nuvarande `wait_for_temp`)

Vid spara: mappa slutvillkor → korrekt `step_type` i databasen:
- `time` / `sg` → `hold`
- `gravity_stable` → `wait_for_gravity_stable`
- `temp_reached` → `wait_for_temp`

Vid laddning: mappa `step_type` tillbaka till rätt `holdEndCondition`.

### 2. Ta bort separata stegtyper från väljaren

**FermentationStepEditor.tsx** — Ta bort `wait_for_gravity_stable`, `wait_for_sg`, `wait_for_temp` från stegtyps-dropdown. Kvar blir:
- Håll temperatur
- Temperaturrampa
- Torrhumla (kvittering)
- Diacetylvila
- Smart diacetylvila

### 3. Uppdatera labels och visning

**fermentation.ts** — Ta bort/behåll labels för bakåtkompatibilitet (backend använder fortfarande de gamla step_types).

**FermentationStepDisplay.tsx** — Visa "Håll temperatur" som label för alla tre underliggande typer (`hold`, `wait_for_gravity_stable`, `wait_for_sg`, `wait_for_temp`), men med kontextuell beskrivning av slutvillkoret.

### 4. Ingen backend-ändring

Backend-handlers (`step-handlers.ts`) behålls oförändrade. De dispatchar fortfarande på `step_type` i databasen. UI:t mappar bara till rätt typ vid spara/ladda.

### Sammanfattning av flöde

```text
UI Stegtyp-dropdown          Slutvillkors-dropdown        DB step_type
─────────────────           ─────────────────────        ────────────
Håll temperatur      →      Tid                    →     hold
                            SG-värde               →     hold (med target_sg)
                            Stabil SG              →     wait_for_gravity_stable
                            Temperatur nådd        →     wait_for_temp
Temperaturrampa      →      (ramp-inställningar)   →     ramp
Torrhumla            →      (ingen)                →     wait_for_acknowledgement
Diacetylvila         →      (auto)                 →     diacetyl_rest
Smart diacetylvila   →      (auto)                 →     gradual_ramp
```

