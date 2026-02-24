

# Granskning av Automatik-instellningar

## Sammanfattning

Jag har gatt igenom alla justerbara parametrar under Automatik-fliken och utvärderat varje inställning mot principen: *"Ska användaren behöva tänka på detta, eller kan systemet lära sig det själv?"*

## Nuvarande inställningar (per sektion)

### 1. Glykolkylare -- behåll alla

| Inställning | Värde | Bedömning |
|---|---|---|
| Aktivera/avaktivera | on/off | **Behåll** -- grundläggande on/off |
| Välj kylare-controller | dropdown | **Behåll** -- hårdvaru-mapping |
| Följda jästankar | checkboxar | **Behåll** -- hårdvaru-mapping |
| Kontrollintervall | 30-120 min | **Behåll** -- beror på fysisk setup |
| Kylmarginal (under lägsta tank) | 1-10 grader | **Behåll** -- beror på glykolsystem |
| Max differens | 5-15 grader | **Behåll** -- säkerhetsgräns |
| Delta-varning | 1-5 grader | **Behåll** -- personlig preferens |

Alla dessa är hårdvaru- eller setup-beroende. Inget att ändra.

### 2. Pill-kompensation -- minska kraftigt

| Inställning | Värde | Bedömning |
|---|---|---|
| Aktivera/avaktivera | on/off | **Behåll** |
| Max ändring/cykel | 0.3-1.0 grader | **Ta bort** -- systemet har redan rate-limiting inbyggd med asymmetrisk logik |
| Rate-limit min % | 10-50% | **Ta bort** -- finjusteringsparameter som PI(D)-loopen hanterar automatiskt |
| Max kompensation | 3-10 grader | **Behåll** -- säkerhetsgräns, viktigt att ha kvar |
| D-term anticipation-fönster | 30-120 min | **Ta bort** -- teknisk PID-parameter som inte borde exponeras |

Motivering: PI(D)-loopen med inlärning konvergerar automatiskt. De tre parametrarna som tas bort är finjustering som bara skapar förvirring. "Max kompensation" behålls som säkerhetsgräns.

### 3. Stall-detektering -- minska

| Inställning | Värde | Bedömning |
|---|---|---|
| Aktivera/avaktivera | on/off | **Behåll** |
| Temperaturhöjning | 0.5-2.0 grader | **Behåll** -- påverkar hur aggressivt systemet reagerar, bra att kontrollera |
| SG-tröskel/dag | 0.5-2.0 punkter | **Ta bort** -- teknisk parameter, bra default (1.0) räcker |
| Min/max utjäsning | (ej i UI ännu) | **Lägg inte till** -- de nya databaskolumnerna behöver inget UI, defaults (10/90%) fungerar |

## Plan

### Steg 1: Ta bort 4 inställningar från UI

Följande tas bort från Settings.tsx (och tillhörande state/handlers):

1. **Max ändring/cykel** (`pillCompRateLimit`) -- behåll standardvärdet 0.8 i backend
2. **Rate-limit min %** (`pillCompMinScale`) -- behåll standardvärdet 0.15 i backend
3. **D-term anticipation-fönster** (`pillCompDamping`) -- behåll standardvärdet 1.0 i backend
4. **SG-tröskel/dag** (`stallRateThreshold`) -- behåll standardvärdet 0.001 i backend

### Steg 2: Förenkla Pill-kompensation UI

Pill-kompensation-sektionen reduceras till:
- On/off switch
- Max kompensation (säkerhetsgräns)
- Inlärda baselines (redan finns)
- Info-collapsible (uppdateras)

### Steg 3: Förenkla Stall-detektering UI

Stall-detektering-sektionen reduceras till:
- On/off switch
- Temperaturhöjning vid stall
- Info-collapsible (uppdateras)

### Steg 4: Rensa bort oanvänd state och handlers

Ta bort state-variabler och handlers för de 4 borttagna inställningarna från Settings.tsx.

## Tekniska detaljer

Inga databasändringar behövs -- kolumnerna behålls med sina defaults. Bara UI-kod i `src/pages/Settings.tsx` ändras. Beskrivningstexterna uppdateras för att reflektera att systemet lär sig automatiskt.

Resultatet: **Pill-kompensation** går från 5 inställningar till 2. **Stall-detektering** går från 3 inställningar till 2. Totalt 10 inställningar istället för 14 under Automatik.

