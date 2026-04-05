

# Spara lokal Pi-arkitekturplan i projektminnet

## Vad som sparas

Hela planen för lokal-first Brew Monitor på Pi #2 sparas som en minnesfil så den finns tillgänglig nästa gång du säger "nu har jag Raspberry:n".

## Fil som skapas

**`.lovable/memories/local-pi-architecture.md`** — innehåller:

### Arkitektur
- **En Pi** (Pi #2) bredvid jäskärlen kör hela stacken
- Node.js/Express backend + SQLite (better-sqlite3)
- Nginx serverar React-frontend
- Pi #1 hanterar bara Sonos/Cast Away via LAN

### BLE Pill Scanner
- Python-tjänst med `bleak` — passiv BLE-scan av RAPT Pill(s)
- Gravity, temp, batteri var ~60:e sekund direkt till SQLite
- Ingen RAPT Cloud behövs, ingen pairing

### Edge Functions → Express-routes (prioritetsordning)
1. `auto-adjust-cooling` → `POST /api/auto-cooling`
2. `process-fermentation-profiles` → `POST /api/profiles`
3. `execute-pwm-off` → `POST /api/pwm-off`
4. `record-temp-history` → `POST /api/temp-history`
5. `run-automation` → node-cron orkestrering
6. Resterande ~6 funktioner

### Cloud-synk
- Lovable Cloud som backup, delta-synk 1x/timme
- Brew timer hämtas från Cloud om internet finns
- Album art cachas lokalt

### AI-funktioner
- Manuell knapp i UI, anropar Cloud om internet finns
- Disabled med tooltip "Kräver internet" annars

### Offline-kapabilitet
- Pill BLE, PID-loop, fermenteringsprofiler, dashboard, Sonos: **helt offline**
- AI, push-notiser, uppdateringar: **kräver internet**

### Deploy
- `systemd-timer`: `git pull && npm run build && pm2 restart`
- Körs när internet finns, annars senaste build

### Uppskattad arbetsinsats
- ~3-4 veckor, portering av shared logic är störst

