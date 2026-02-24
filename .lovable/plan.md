

# Professionella bryggeri-funktioner -- Implementationsplan

## Sammanfattning

Fyra funktioner som identifierades som luckor mot professionella SCADA-system, alla genomforbara med befintlig hardvara (RAPT Pills, RAPT Controllers, Brewfather-data).

---

## 1. Push-notifikationer for kritiska handelser

Webblasar-notifikationer (PWA) for:
- Stall detekterad (temperatur-boost applicerad)
- Ready to cold crash
- Temperaturavvikelse (delta over troskel)
- Fermenteringsprofil klar

### Teknisk implementation

**Steg 1: Aktivera PWA i vite.config.ts**
- Konfigurera `vite-plugin-pwa` (redan installerat men ej aktiverat)
- Generera service worker med push-stod

**Steg 2: Skapa notifikationstabell**
```text
pending_notifications
  id, type, title, body, created_at, read_at, brew_id?, controller_id?
```

**Steg 3: Backend-logik**
- `compute-fermentation-metrics`: skriver notification vid `ready_to_crash`
- `auto-adjust-cooling`: skriver notification vid stall-boost och delta-alert
- `process-fermentation-profiles`: skriver notification vid profil klar

**Steg 4: Frontend**
- Klocka/bell-ikon i DashboardHeader med olaesta notifikationer
- Realtime-prenumeration pa `pending_notifications`
- Browser Notification API (`Notification.requestPermission()`) for push nar appen ar oppen
- Notifikationshistorik i en dropdown/dialog

---

## 2. Predikterad vs faktisk jasningskurva

Overlay i brew-chartet som visar en forventad SG-kurva baserad pa OG, FG och stil/jast-historik.

### Teknisk implementation

**Steg 1: Berakningsmodell**
- Enkel exponentiell avtagande-modell: `SG(t) = FG + (OG - FG) * e^(-k*t)`
- Koefficient `k` baseras initialt pa stil (ale ~0.02/h, lager ~0.01/h)
- Uppdateras adaptivt fran faktiska data nar tillracklig historik finns

**Steg 2: Edge function `compute-fermentation-metrics`**
- Utoka med berakning av predikterad kurva (6-8 punkter)
- Spara i `brew_fermentation_metrics` som ny JSON-kolumn `predicted_sg_curve`
- Jemfor predikterad vs faktisk och flagga avvikelse (>10% fran forvantat)

**Steg 3: Frontend -- BrewChart**
- Ny streckad linje i chartet for predikterad SG
- Markera avvikelsezoner med rott/gult band
- Tooltip visar bade predikterad och faktisk

**Steg 4: SVG-chart (render-brew-chart)**
- Lagg till predikterad kurva som streckad linje i server-renderade charts

---

## 3. Multi-batch-inlarning per jaststam/stil

Utoka inlarningssystemet sa att kompensationsbaslinjer delas mellan batchar med samma stil/jast istallet for att borja om fran noll varje gang.

### Teknisk implementation

**Steg 1: Databasandring**
- Lagg till `style_key` (TEXT) i `controller_learned_compensation`
- Lagg till index pa `style_key`
- Populera fran `brew_readings.style` via `fermentation_sessions.brew_id`

**Steg 2: Backend-logik (`_shared/temp-utils.ts`)**
- Vid ny session: fallback-sokning -- leta forst per `controller_id + delta_bucket + mode + step_type`, sedan per `style_key + delta_bucket + mode + step_type` om ingen per-controller-data finns
- Sparar resultatet per controller som idag men taggar med `style_key`
- Ny session far en "warm start" fran tidigare batchar med samma stil

**Steg 3: AI-audit**
- `ai-automation-audit` far tillgang till stil-aggregerad data
- Kan identifiera stil-specifika monster (t.ex. "Saison ar alltid 2x mer aktiv an IPA")

---

## 4. Automatisk batchrapport (PDF)

Generera en sammanfattande PDF for varje avslutad batch med all relevant data.

### Teknisk implementation

**Steg 1: Edge function `generate-batch-report`**
- Hamtar all data for en batch: brew_readings, brew_data_snapshots, temp_controller_history, fermentation_step_log, auto_cooling_adjustments, stall_boost_outcomes
- Anropar `render-brew-chart` for att fa chart-bild
- Bygger PDF server-side (via Deno-kompatibelt PDF-bibliotek) eller returnerar strukturerad data for klient-rendering

**Steg 2: Frontend -- jsPDF-baserad rapport**
- Anvander redan installerade `jspdf`
- Sida 1: Batch-overblick (namn, stil, OG/FG, ABV, attenuation, start/slut-datum)
- Sida 2: Temperaturkurva + SG-kurva (fran chart-bild)
- Sida 3: Automationslogg (PID-justeringar, boosts, fasoverganger)
- Sida 4: Sammanfattning (peak delta, aktivitetstopp, tid per fas)

**Steg 3: UI -- Ny knapp pa brew-kortet**
- "Ladda ner rapport"-knapp synlig for avslutade batchar
- Genererar PDF direkt i webblasaren med data fran Supabase

---

## Prioriteringsordning

1. **Push-notifikationer** -- storst operativ nytta, varnar direkt vid problem
2. **Multi-batch-inlarning** -- forbattrar PID fran dag 1 for nya batchar
3. **Predikterad SG-kurva** -- ger tidig insikt om jasningen avviker
4. **Batchrapport (PDF)** -- dokumentation, inte kritisk for realtidsdrift

---

## Paverkade filer

| Fil | Andring |
|-----|---------|
| `vite.config.ts` | Aktivera VitePWA |
| `src/components/DashboardHeader.tsx` | Notifikations-ikon + dropdown |
| `src/components/brew-chart/BrewChart.tsx` | Predikterad SG-linje |
| `supabase/functions/compute-fermentation-metrics/index.ts` | Predikterad kurva + notifikationer |
| `supabase/functions/auto-adjust-cooling/index.ts` | Notifikationer vid stall/delta |
| `supabase/functions/_shared/temp-utils.ts` | Multi-batch fallback-logik |
| `supabase/functions/render-brew-chart/index.ts` | Streckad predikterad linje |
| Ny: `src/components/NotificationBell.tsx` | Notifikationskomponent |
| Ny: `src/components/BatchReportButton.tsx` | PDF-generering |
| Ny migration | `pending_notifications` tabell + `predicted_sg_curve` kolumn + `style_key` kolumn |

