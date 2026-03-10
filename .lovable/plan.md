

## Plan: Visa AI-justerbara parametervärden under Live-status

### Bakgrund
AI-auditen kan justera 6 globala parametrar (`pill_compensation_damping`, `pill_compensation_rate_limit`, `pill_compensation_max_compensation`, `delta_alert_threshold`, `stall_rate_threshold`, `temp_reduction_degrees`) samt per-controller `stall_boost_degrees` och `cooler_margin`. Idag visas dessa värden ingenstans i UI:t.

### Approach
Skapa en kompakt "AI-justerbara parametrar" panel inuti Live-status sektionen, under `AutomationFeatureStatus`. Hämta värdena direkt från `auto_cooling_settings` samt `fermentation_learnings` (per-controller stall_boost + cooler_margin).

### Ändringar

**1. Ny komponent `src/components/AiTunableParameters.tsx`**
- Hämtar `auto_cooling_settings` (en rad) för globala parametrar
- Hämtar `fermentation_learnings` filtrerat på `stall_boost_degrees` och `cooler_margin:%` för per-controller värden
- Lyssnar på realtime-uppdateringar (samma kanal som redan finns)
- Visar som en kompakt tabell/lista med parameternamn → värde, grupperat:
  - **PID**: damping, rate_limit, max_compensation
  - **Stall**: stall_rate_threshold + per-controller boost_degrees
  - **Kylare**: temp_reduction_degrees, delta_alert_threshold
  - **Per-controller cooler_margin**: per bucket (cold/cool/warm/hot)
- Minimalistisk design: `text-[11px]`, muted colors, matchar befintlig Live-status-stil

**2. Uppdatera `src/pages/Settings.tsx`**
- Importera `AiTunableParameters`
- Lägg till den under `<AutomationFeatureStatus />` i Live-status sektionen, med en `<SettingsDivider />` emellan

### UI-layout (skiss)
```text
Live-status
├── AutomationFeatureStatus (befintlig)
├── ─────────────────────────
└── AI-justerbara parametrar
    PID-kompensation
      damping          0.4
      rate_limit       0.3
      max_komp         5.0°
    Stall-detektering
      tröskel          0.001
      Tank1 boost      2.0°
    Kylare
      reduktion        2.0°
      delta-larm       2.0°
      Tank1 margin     cold: 3.2° warm: 2.1°
```

### Tekniska detaljer
- Direktfråga mot `auto_cooling_settings` (redan cachad i settings-hook, men komponenten hämtar själv för att visa alla fält inklusive damping/rate_limit som inte exponeras idag)
- `fermentation_learnings`-fråga filtreras med `.or('parameter_name.eq.stall_boost_degrees,parameter_name.like.cooler_margin:%')`
- Realtime-prenumeration på `auto_cooling_settings` UPDATE-events för live-uppdatering när AI ändrar värden
- Controller-namn mappas via `rapt_temp_controllers`-data

