# Lokal Brew Monitor på Pi #2 — Arkitekturplan

> Sparad: 2026-04-05. Implementeras när Raspberry Pi-hårdvaran är på plats.

## Arkitektur

```text
┌─────────────────────────────────────────────────┐
│  Pi #2 (bredvid jäskärlen)                      │
│                                                 │
│  ┌─────────────┐  ┌──────────────────────────┐  │
│  │ Nginx       │  │ Node.js Backend (Express) │  │
│  │ serves      │  │                           │  │
│  │ React /dist │  │ • BLE pill scanner        │  │
│  └─────────────┘  │ • PID-loop (node-cron)    │  │
│                   │ • Fermentation profiles   │  │
│                   │ • Auto-cooling            │  │
│                   │ • PWM off handler         │  │
│                   │ • Record temp history     │  │
│                   │ • Cloud sync (1x/timme)   │  │
│                   │ • WebSocket (realtime)    │  │
│                   │                           │  │
│                   │ SQLite (better-sqlite3)   │  │
│                   └──────────────────────────┘  │
│                                                 │
│  Pi #1 (Sonos, Cast Away) ← LAN                │
└─────────────────────────────────────────────────┘
         │ LAN                    │ Internet (1x/h)
         ▼                        ▼
   RAPT Controller          Lovable Cloud (backup)
   (temp-styrning)          + Brew timer sync
                            + Album art (om ej cachad)
```

- **En Pi** (Pi #2) bredvid jäskärlen kör hela stacken
- Node.js/Express backend + SQLite (better-sqlite3)
- Nginx serverar React-frontend
- Pi #1 hanterar bara Sonos/Cast Away via LAN

## BLE Pill Scanner

- Python-tjänst med `bleak` — passiv BLE-scan av RAPT Pill(s)
- Gravity, temp, batteri var ~60:e sekund direkt till SQLite
- Ingen RAPT Cloud behövs, ingen pairing
- Systemd-service, kör kontinuerligt
- Pill broadcastar via manufacturer-specific advertisement data
- Identifieras via MAC-adress → pill-mapping i settings

## Edge Functions → Express-routes (prioritetsordning)

| Prio | Edge Function | Lokal route | Anteckning |
|------|--------------|-------------|------------|
| 1 | `auto-adjust-cooling` | `POST /api/auto-cooling` | PID + cooler-management |
| 2 | `process-fermentation-profiles` | `POST /api/profiles` | process-profiles-logic.ts |
| 3 | `execute-pwm-off` | `POST /api/pwm-off` | Safety-kritisk |
| 4 | `record-temp-history` | `POST /api/temp-history` | Loggning |
| 5 | `run-automation` | node-cron orkestrering | Blir cron som anropar lokala routes |
| 6 | `compute-fermentation-metrics` | `POST /api/metrics` | |
| 7 | `system-health-check` | `POST /api/health` | |
| 8 | `sync-rapt-data-quick` | Integreras i cron | Tre-fas-modellen körs lokalt |
| 9 | `rapt-update-controller` | `POST /api/rapt-update` | RAPT Cloud API-anrop |
| 10 | `get-api-settings` | `GET /api/settings` | |
| 11 | `sync-custom-brew-pills` | `POST /api/sync-pills` | |

**Inte portade (behövs ej lokalt):**
- `ai-consultation`, `ai-fermentation-advisor`, `ai-automation-audit` → manuell knapp, Cloud om internet finns
- `send-push-notification`, `generate-vapid-keys` → kräver internet
- `sonos-*` → hanteras av Pi #1
- `external-auth` → ej relevant lokalt
- `render-brew-chart` → kan genereras i frontend

## Shared Logic

`_shared/`-filerna (cooler-management, controller-adjustments, pid-compensation, etc.) porteras rakt av — ren TypeScript-logik. Byt `createClient` → lokal SQLite-wrapper med samma query-interface.

## Cloud-synk (backup)

### Uppsynk till Lovable Cloud (1x/timme)
- Node-cron jobb var 60:e minut
- Synkar via `supabase-js`:
  - `brew_readings` (nya rader sedan sist)
  - `temp_controller_history` (samplade)
  - `fermentation_sessions` + steg (status)
  - `brew_fermentation_metrics`
  - `auto_cooling_decision_log` (senaste)
- `last_cloud_sync_at` timestamp för delta-synk
- Vid internetavbrott: köar lokalt, synkar ikapp vid återanslutning

### Nedsynk från Cloud
- Minimal — Cloud är sekundär
- Hämtar: brew timer (`sync-external-timer`), album art (om ej cachad)

## AI-funktioner

- Manuell knapp i UI (t.ex. fermenteringssession-vyn)
- Anropar Lovable Cloud Edge Function direkt (`ai-consultation`)
- Om internet saknas: knappen disabled med tooltip "Kräver internet"
- Ingen automatisk AI-körning lokalt

## Frontend-anpassning

### Ny API-klient
- `src/lib/local-api.ts` ersätter `supabase.from(...)` och `supabase.functions.invoke(...)`
- Pekar mot `http://localhost:3001/api/...` (eller Pi #2:s LAN-IP)
- Samma TypeScript-typer, bara annan transport

### Realtime
- Socket.io server i Express-backend
- Ersätter Supabase Realtime-prenumerationer
- Triggas av node-cron efter varje synkcykel

## Offline-matris

| Funktion | Online | Offline |
|---|---|---|
| Pill gravity/temp (BLE) | ✅ | ✅ |
| Temperaturstyrning (LAN) | ✅ | ✅ |
| Fermenteringsprofiler | ✅ | ✅ |
| PID-loop + auto-cooling | ✅ | ✅ |
| Dashboard | ✅ | ✅ |
| Cloud backup-synk | ✅ 1x/h | ❌ köar |
| Brew timer | ✅ Cloud | ✅ lokal fallback |
| AI-konsultation | ✅ manuell knapp | ❌ disabled |
| Album art | ✅ hämta + cacha | ✅ cachad |
| Push-notiser | ✅ | ❌ |
| Sonos | ✅ Pi #1 LAN | ✅ Pi #1 LAN |
| Uppdateringar | ✅ git pull | ❌ senaste build |

## Deploy-pipeline

### GitHub auto-deploy
```bash
# /etc/systemd/system/brew-monitor-update.timer
# Kör var 30:e minut (när internet finns)
# Script: git pull → npm run build → pm2 restart brew-monitor
```

### Första installation
```bash
git clone <repo>
cd brew-monitor-local
npm install
# SQLite-migrationer
cp .env.example .env  # RAPT-creds, LAN-IPs
pm2 start ecosystem.config.js
sudo systemctl enable brew-ble-scanner
```

## Viktiga noteringar

- **RAPT Controller har inget lokalt API** — bekräftat via undersökning (ESP32 Wi-Fi manager only). Temperaturstyrning måste fortfarande gå via RAPT Cloud API.
- **Pill i BT-läge slutar skicka till RAPT Cloud** — historik sparas bara lokalt.
- **BLE-frekvens ~60s** — bättre än RAPT Cloud (60 min).

## Uppskattad arbetsinsats

- ~3-4 veckor totalt
- Portering av shared logic (fas 1b/1c) är mest tidskrävande
- Rekommenderar att börja med BLE-scanner + kritiska API:er, sedan porta resten iterativt

## Implementeringsordning

1. BLE-scanner (Python/bleak) — separat litet projekt
2. SQLite-schema + Express-skeleton — grundstruktur
3. Porta kritiska Edge Functions (auto-cooling, profiles, PWM off)
4. Frontend API-klient — byt transport-lager
5. Cloud-synk — 1x/h uppsynk
6. AI-knapp — manuell trigger med online-check
7. Deploy-pipeline — systemd + git pull
