
## Flytta paus-timeout till servern (cron/edge function)

### Varför det är bättre
Idag hanteras 5-minuters-timeouten på klientsidan, vilket innebär att om sidan laddas om efter 5 minuter visar widgeten ändå PAUSED-data från databasen tills klienten själv räknat ut att den är för gammal. Genom att låta edge-funktionen sätta IDLE direkt i databasen blir klienten enklare och widgeten döljs omedelbart vid sidladdning.

### Ändring

**Fil: `supabase/functions/sync-sonos-now-playing/index.ts`**

Efter att Sonos API:ets `playbackState` läses (rad ~121), lägg till logik:

1. Om Sonos rapporterar `PAUSED` (eller `IDLE`), kolla befintlig rad i databasen:
   - Hämta `updated_at` från den befintliga raden (redan hämtad ~rad 132, behöver utöka `select`)
   - Om `updated_at` är äldre än 5 minuter och state är PAUSED, skriv `playback_state: 'PLAYBACK_STATE_IDLE'` till databasen istället
   - Skippa bildgenerering helt (onödig CPU för en gömd widget)
   - Returnera tidigt

2. Om Sonos rapporterar `PLAYING`, kör som vanligt (befintlig logik)

**Fil: `src/components/sonos/hooks/useSonosInit.ts`**

Behåll den klient-sidiga checken som säkerhetsnät (redan implementerad). Den fångar edge cases där cron-jobbet inte hunnit köra.

### Teknisk detalj

```text
Edge function flöde (nytt):
  1. Hämta playbackState från Sonos API
  2. Om PAUSED → kolla DB-radens updated_at
     - Om > 5 min sedan → skriv IDLE, skippa bilder, returnera
     - Om < 5 min sedan → skriv PAUSED som vanligt
  3. Om PLAYING → kör befintlig logik
```

Detta sparar även serverresurser eftersom bildgenerering skippas helt när ingen lyssnar.
