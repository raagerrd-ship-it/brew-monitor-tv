

# Förbättringar av jäsningsautomatiken -- inspirerat av professionella bryggerier

## Sammanfattning

Efter att ha jämfört ditt system med vad professionella bryggerier och moderna övervakningsplattformar (PLAATO, BrewOps, Precision Fermentation) använder, har jag identifierat flera förbättringsområden som kan implementeras med din befintliga hårdvara (RAPT Pill + temperaturstyrenheter).

---

## Vad ditt system redan gör bra

Ditt system är redan avancerat jämfört med de flesta hembryggerier:

- PI(D)-reglering med adaptiv inlärning per styrenhet, läge och delta-bucket
- Stall-detektion med automatisk temperatur-boost och inlärning av boost-storlek
- Fermenteringsprofiler med linjära ramper, SG-villkor och stabilitetskontroll
- Glykolkylare-automatik som följer lägsta aktiva fermenteringstemperatur
- AI-audit som övervakar och finjusterar parametrar automatiskt
- Overshoot-prevention baserat på Pill-temperatur som tidig indikator

---

## Föreslagna förbättringar

### 1. Automatisk diacetylvila-detektion (Diacetyl Rest)

**Vad bryggerier gör:** Professionella bryggerier övervakar när primärjäsningen bromsar in (~75-80% apparent attenuation) och höjer automatiskt temperaturen 2-4 grader för en diacetylvila innan cold crash. Detta är särskilt kritiskt för lager.

**Vad som saknas:** Ditt system har stall-detektion men ingen specifik logik för att identifiera "nära slutjäst" och trigga en planerad diacetylvila vs. en nöd-boost.

**Förslag:** Lägg till ett nytt stegtyp `diacetyl_rest` i fermenteringsprofiler som automatiskt aktiveras vid en konfigurerbar attenuationsnivå (t.ex. 70-80%) istället för att vara tidsbaserat. Steget höjer temperaturen 2-4 grader och väntar tills SG är stabilt.

### 2. Jäsningshastighets-trendanalys (Fermentation Velocity)

**Vad bryggerier gör:** Professionella system beräknar SG-drop per timme och visualiserar jäsningskurvan i realtid. De identifierar peak fermentation, avtagande fas och slutjäsning som distinkta faser.

**Vad som saknas:** Ditt system beräknar SG-rate men bara för stall-detektion. Ingen fasidentifiering eller trendvisualisering.

**Förslag:** Beräkna och spara jäsningsfas (lag, exponential, stationary, declining) per bryggning som metadata. Visa detta som en badge på BrewCard och använd fasen för smartare profilbeslut -- t.ex. "vänta med cold crash tills declining-fas bekräftats".

### 3. CO2-aktivitetsindikator via temperatur-delta-trend

**Vad bryggerier gör:** Professionella bryggerier övervakar CO2-produktion med tryckgivare eller flödesräknare som en direkt indikator på jäsningsaktivitet.

**Vad du redan har:** Temperatur-delta (Pill vs. probe) fungerar som en proxy för jäsningsvärme och därmed CO2-produktion. Du loggar detta redan i `temp_delta_history`.

**Förslag:** Beräkna en "jäsningsaktivitets-score" (0-100%) baserat på normaliserat delta relativt peak-delta för den aktuella bryggningen. Spara som metadata och visa i UI. Detta ger en mer intuitiv indikator än rå delta-värden.

### 4. Prediktiv slutpunktsberäkning (ETA to Terminal Gravity)

**Vad bryggerier gör:** Avancerade system (BrewOps, Precision Fermentation) beräknar estimerad tid till slutjäst baserat på nuvarande SG-trend och jästens historiska beteende.

**Vad som saknas:** Ingen prediktionslogik finns.

**Förslag:** Baserat på nuvarande SG-drop-rate och final gravity (FG) från receptet, beräkna en ETA i timmar/dagar. Spara som fält i bryggdata och visa på BrewCard. Uppdatera varje synk-cykel. Formel: `ETA = (current_SG - target_FG) / sg_rate_per_hour`.

### 5. Smart cold crash-timing

**Vad bryggerier gör:** Cold crash startas aldrig bara baserat på tid utan på bekräftad SG-stabilitet PLUS diacetylvila slutförd.

**Vad som redan finns:** Ditt system stödjer `gravity_stable_days` i profilsteg.

**Förslag:** Lägg till en automatisk cold crash-rekommendation i justeringshistoriken när alla villkor är uppfyllda: SG stabil i X dagar + attenuering inom förväntat intervall + delta-trend visar minimal jäsningsaktivitet. Logga detta som en `READY_TO_CRASH`-händelse.

---

## Teknisk plan

### Steg 1: Ny tabell `brew_fermentation_metrics`
Spara beräknade mätvärden per bryggning per synk-cykel:
- `fermentation_phase` (lag/exponential/stationary/declining)
- `activity_score` (0-100)
- `sg_rate_per_hour`
- `eta_to_fg_hours`
- `peak_delta` (max observerad delta under jäsningen)

### Steg 2: Uppdatera `run-automation` / `auto-adjust-cooling`
- Beräkna fermentation_phase och activity_score varje cykel
- Beräkna ETA baserat på SG-trend och FG från recept
- Logga `READY_TO_CRASH` när villkor uppfylls

### Steg 3: Nytt profilsteg `diacetyl_rest`
- Triggas vid konfigurerbar attenuationsnivå
- Höjer temp med konfigurerbara grader
- Väntar på SG-stabilitet innan vidare

### Steg 4: UI-uppdateringar
- Visa jäsningsfas-badge på BrewCard
- Visa aktivitets-score som en mini-indikator
- Visa ETA till slutjäst
- Visa "Redo för cold crash"-notifikation

