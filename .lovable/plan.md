

## Flytta Sonos-polling till server-side cron

### Problem
Sonos-widgeten pollar edge function `sonos-now-playing` var 5:e sekund fran klienten. Det ger ~720 nätverksanrop per timme och belastar CPU:n med fetch-loopar.

### Lösning
Skapa ett cron-job som hämtar Sonos now-playing-data var 5:e sekund och skriver till `sonos_now_playing`-tabellen. Klienten lyssnar redan på realtime-uppdateringar för denna tabell, så det enda som behövs är att ta bort klientens polling-loop.

### Steg

**1. Ny edge function: `sync-sonos-now-playing`**
- Hämtar data från Sonos API (samma logik som nuvarande `sonos-now-playing`)
- Skriver/uppdaterar resultatet till `sonos_now_playing`-tabellen i databasen
- Returnerar OK

**2. Ny databas-funktion + cron-job**
- Skapa en trigger-funktion `trigger_sonos_now_playing_sync()` som anropar edge function
- Schemalägg med pg_cron: kör var 5:e sekund (pg_cron stödjer minst 1 minut, så vi kör var minut och edge-funktionen kollar intern timing)
- Alternativ: kör var minut - acceptera 1 minut fördröjning på låtbyte istället för 5 sekunder

**3. Uppdatera `SonosWidget.tsx`**
- Ta bort `setInterval`-polling (rad 88-120)
- Behåll realtime-subscription (rad 122-142) - den hanterar redan uppdateringar
- Gör initial fetch via en enkel databasläsning från `sonos_now_playing` istället for edge function-anrop
- Behåll lokal progress-ticker (1s interval for progress bar)

**4. Uppdatera `useSonosTrackTransition.ts`**
- Ändra `fetchNowPlaying` till att läsa från databasen istället för att anropa edge function

### Teknisk detalj

pg_cron kan bara köra minst var minut. Två alternativ:

- **Alt A (rekommenderat)**: Cron var minut. Acceptera ~1 minut max fördröjning vid låtbyte. Progress bar fungerar lokalt ändå. Enklast och billigast.
- **Alt B**: Cron var minut men edge function gör 12 iterationer med 5s sleep internt. Mer komplext, mer edge function-tid.

Alt A rekommenderas - 1 minuts fördröjning märks knappt och sparar mest resurser.

### Resultat
- Klientens nätverksanrop minskar med ~720/timme
- CPU-belastning minskar (inga fetch-loopar)
- Sonos-data uppdateras ändå via realtime-subscription

