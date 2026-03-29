

# track_seq — skyddar både metadata OCH bakgrund

## Bekräftelse

Bakgrundsbilden (`bg_image_url`) och widget-art (`widget_art_url`) levereras i samma `NowPlaying`-objekt som låtnamn och artist. Seq-checken i `useSonosRealtime` avvisar hela payloaden vid `incoming.track_seq < prev.track_seq`, vilket betyder att **alla fält** skyddas — inklusive bakgrundsbild.

## Planen (oförändrad från tidigare)

### 1. Databasmigration
Lägg till `track_seq integer NOT NULL DEFAULT 0` i `sonos_now_playing`.

### 2. Server: `sync-sonos-now-playing`
Inkrementera `track_seq` vid ny låt, behåll vid samma.

### 3. Server: `sonos-playback-status`
Returnera `track_seq` i svaret.

### 4. Klient: `NowPlaying`-typ
Lägg till `track_seq?: number`.

### 5. Klient: `useSonosRealtime`
Avvisa payload om `incoming.track_seq < prev.track_seq`.

### 6. Klient: `useSonosClientPolling`
Vid track change — trigga server-sync istället för direkt swap. Låt RT leverera med korrekt seq.

## Vad skyddas

| Fält | Skyddat |
|------|---------|
| `track_name`, `artist_name` | Ja |
| `bg_image_url` (bakgrund) | Ja |
| `widget_art_url` | Ja |
| `next_*`-fält | Ja |
| `position_ms`, `duration_ms` | Ja |

Allt avvisas som en enhet — ingen risk att bakgrunden byter tillbaka utan att låtnamnet gör det.

