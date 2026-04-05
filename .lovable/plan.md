

# Uppdaterad plan: Lokalt Touch-UI på Pi #2 + Lovable som TV/remote-dashboard

## Koncept

Två separata frontend-byggen från samma kodbas:

```text
┌─────────────────────────────────────────┐
│ Pi #2 — 7" touchskärm (1024×600)        │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ Header: Cloud ● | RAPT ● | 🕐  │    │
│  ├─────────────────────────────────┤    │
│  │ ┌───────┐ ┌───────┐ ┌───────┐  │    │
│  │ │Tank 1 │ │Tank 2 │ │Tank 3 │  │    │
│  │ │18.2°C │ │20.1°C │ │4.0°C  │  │    │
│  │ │1.048  │ │1.012  │ │1.001  │  │    │
│  │ │🔋 82% │ │🔋 45% │ │🔋 91% │  │    │
│  │ │Cool ● │ │Heat ● │ │Off    │  │    │
│  │ │Profile│ │Hold   │ │Crash  │  │    │
│  │ └───────┘ └───────┘ └───────┘  │    │
│  │ ┌───────────────────────────┐  │    │
│  │ │ Glykolkylare   12.3°C    │  │    │
│  │ │ Target: 10.0°C  Running  │  │    │
│  │ └───────────────────────────┘  │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Express backend + SQLite + BLE         │
└─────────────────────────────────────────┘
         │ var 15:e min
         ▼
┌─────────────────────────────────────────┐
│ Lovable Cloud                           │
│  - Befintligt BrewingDashboard (TV)     │
│  - Brew-sidor (/brew/:id)              │
│  - Inställningar                        │
│  - AI-konsultation                      │
└─────────────────────────────────────────┘
```

## Lokalt Touch-UI — Nytt

### Layout (1024×600, touch-optimerad)
- **Header** (40px): Lovable Cloud-status (grön/röd prick), RAPT API-status, klocka, senaste synk-tid
- **3 tankpaneler** (grid 3-kolumner): Varje panel visar:
  - Pill: temperatur, gravity (SG), batteri
  - Controller: aktuell temp, target temp, kyla/värme-status
  - Läge: Profil-namn eller "Hold XX°C" eller "Av"
  - Touch-knappar: Välj profil, toggle kyla/värme, justera hold-temp (slider)
- **Glykolkylare** (botten): Temp, target, driftstatus, runtime
- Tap på en tank → expanderad vy med fermenteringsprofil-val och temp-slider

### Komponenter att skapa
- `src/pages/LocalDashboard.tsx` — huvudvy för touch-skärmen
- `src/components/local/TankPanel.tsx` — en jästank med pill + controller data
- `src/components/local/CoolerPanel.tsx` — glykolkylare-status
- `src/components/local/LocalHeader.tsx` — anslutningsstatus-header
- `src/components/local/TempAdjustSheet.tsx` — bottom-sheet för temp-justering (touch)

### Touch-anpassning
- Stora touch-targets (minst 48px)
- Inga hover-states, bara tap
- Swipe-gester för snabbjustering av temperatur
- Ingen karusell — alla 3 tankar synliga samtidigt

## Lovable Cloud UI — Befintligt (inga ändringar)

Det nuvarande BrewingDashboard med BrewCards, karusell, Sonos-widget, album art etc. fortsätter serveras från Lovable och visas på TV:n via Chromecast. Brew-sidor (`/brew/:id`) nås från vilken enhet som helst via internet.

## Cloud-synk — Ändrat till var 15:e minut

- Delta-synk var 15:e minut istället för 1x/timme
- Synkar: brew_readings, temp_controller_history, fermentation_sessions, metrics, decision_log
- Header visar "Synkad: 3 min sedan" med grön/gul/röd indikator
- Vid internetavbrott: köar och synkar ikapp

## Ändringar i minnesplanen

Uppdaterar `.lovable/memories/local-pi-architecture.md` med:
1. Nytt avsnitt om lokalt Touch-UI (layout, komponenter)
2. Synkfrekvens ändrad från 1x/timme → var 15:e minut
3. Tydlig separation: Touch-UI lokalt, BrewingDashboard via Lovable/TV
4. Header med anslutningsstatus (Cloud, RAPT, BLE)

