
# Delad Timer/Alarm — synkad via databas

## Mål
Timer/alarm sätts på mobil eller desktop → visas på TV:n (och alla enheter) i realtid. Splash-alert (som bryggtimern) visas när den når 0.

## 1. DB-migration — ny tabell `shared_timer`

Enkel tabell med en rad (singleton, likt sync_settings):
- `type` — 'timer' | 'alarm' | null
- `ends_at` — timestamp when it fires
- `started_at` — timestamp when started  
- `total_ms` — total duration in ms
- `label` — display label
- `alert_text` — text shown in splash
- `alert_duration_sec` — how long splash shows
- `is_active` — boolean
- `fired` — boolean (set to true when it fires, prevents re-triggering)
- `updated_at` — timestamp

RLS: public read/insert/update (samma mönster som övriga tabeller).
Realtime enabled.

## 2. Uppdatera `AlarmTimerContext`
- Vid `startTimer`/`setAlarm`: skriv till `shared_timer` tabellen (upsert)
- Vid `cancel`: sätt `is_active = false`
- Prenumerera på realtime-ändringar från `shared_timer`
- När `ends_at` passerar: visa DashboardAlert (samma splash som nu)
- När `fired` sätts true från en annan enhet: visa splash lokalt också

## 3. Realtids-prenumeration
- Alla klienter (inkl TV) lyssnar på `shared_timer` via postgres_changes
- När en ändring kommer in: uppdatera lokal state
- Ticker-logiken behålls lokalt (1s interval för countdown)

## 4. TV-visning
- Footer-baren visas automatiskt via befintliga DashboardFooterContext
- Splash-alerten visas via befintliga DashboardAlertContext
- Ingen TV-specifik kod behövs — allt går genom existerande system
