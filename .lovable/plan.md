

## Fix: Stoppa skrivning vid oförändrad PAUSED-status

### Problemet
Cron-jobbet kör varje minut och skriver `PLAYBACK_STATE_PAUSED` till `sonos_now_playing`. Varje skrivning triggar `update_updated_at_column()`-triggern som sätter `updated_at = now()`. Därför blir `updated_at` aldrig äldre än ~1 minut, och den 5-minuters stale-checken slår aldrig in.

### Lösning
I `supabase/functions/sync-sonos-now-playing/index.ts`:

**Om Sonos rapporterar PAUSED och databasen redan har PAUSED** -- skippa skrivningen helt. Då behålls det ursprungliga `updated_at`-värdet (tidpunkten då PAUSED-status *först* skrevs). Efter 5 minuter utan ändring fångar stale-checken det och skriver IDLE.

### Teknisk ändring

**Fil: `supabase/functions/sync-sonos-now-playing/index.ts`**

Utöka den befintliga stale-pause-logiken (rad ~133-155):

```text
Nuvarande flöde:
  1. Om PAUSED + DB har PAUSED + updated_at > 5 min → skriv IDLE (redan implementerat)
  2. Annars → fortsätt och skriv PAUSED till DB (detta nollställer updated_at!)

Nytt flöde:
  1. Om PAUSED + DB har PAUSED + updated_at > 5 min → skriv IDLE, returnera
  2. Om PAUSED + DB har PAUSED + updated_at < 5 min → skippa skrivning helt, returnera
  3. Om PAUSED + DB har annat state → skriv PAUSED (första gången, sätter updated_at)
  4. Om PLAYING → kör befintlig logik
```

Steg 2 är den nya raden -- en early return som förhindrar att `updated_at` nollställs. Detta gör att `updated_at` bevaras vid det ögonblick PAUSED-status först skrevs, och efter 5 cron-körningar (5 minuter) triggas steg 1 automatiskt.

Ingen klient-ändring behövs.
