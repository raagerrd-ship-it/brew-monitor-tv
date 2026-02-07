

# Sonos: Ny arkitektur med cron + klient-polling + somlos bildbyte

## Oversikt

Tre separata ansvarsomraden:

1. **Cron (varje minut)**: Hamtar metadata, album art (nuvarande + nasta lat), skriver till DB -> triggar realtime. Detekterar idle-till-playing och vice versa.
2. **Ny latt edge function** (`sonos-playback-status`): Klienten anropar den var 5:e sekund UNDER PLAYING for att synka `position_ms`. Ingen album art, ingen DB-skrivning - returnerar bara position direkt.
3. **Klienten stoppar polling vid IDLE**: Nar realtime-kanalen levererar en uppdatering med IDLE/PAUSED slutar klienten polla. Nar PLAYING aterupptas borjar den igen.

Dessutom: **Tva-bilds-approach** for somlos overgang vid latbyte + forladda nasta lats album art.

```text
  CRON (60s)                            KLIENT (5s, bara under PLAYING)
  +-------------------------------+     +-----------------------------+
  | sync-sonos-now-playing        |     | sonos-playback-status       |
  | - Metadata + album art       |     | - Bara playback position    |
  | - Spotify art-resolve        |     | - Bara playback state       |
  | - Nasta lats art forladdas   |     | - Ingen DB-skrivning        |
  | - Skriver till DB            |     | - Returnerar direkt ~150ms  |
  | - Triggar realtime           |     +-----------------------------+
  +-------------------------------+           |
         |                                    v
         v                              Klienten uppdaterar
    Realtime -> Widgeten                 localProgress direkt
    (latbyte, status)                    + korrigerar JS-tickern
```

## Del 1: Ny edge function `sonos-playback-status`

**Ny fil:** `supabase/functions/sonos-playback-status/index.ts`

Minimal funktion:
1. Hamta access token fran `sonos_tokens` (refresh om expired)
2. Hamta `selected_group_id` fran `sonos_settings`
3. ETT Sonos API-anrop: `GET /groups/{groupId}/playback`
4. Returnera `{ playbackState, positionMillis }` direkt till klienten
5. Ingen DB-skrivning, ingen Spotify-lookup, ingen metadata-hamtning

Token-refresh-logiken kan ateranvandas fran `sync-sonos-now-playing`.

**Config:** Lagg till i `supabase/config.toml`:
```text
[functions.sonos-playback-status]
verify_jwt = false
```

## Del 2: SonosWidget - klient-polling var 5:e sekund

**Fil:** `src/components/sonos/SonosWidget.tsx`

Andringar:
- Behall JS-tickern (1s) for smidig progress-bar MELLAN 5s-pollarna
- Lagg till ett `useEffect` som startar ett 5s-intervall NAR `playback_state === PLAYING`:
  - Anropa `sonos-playback-status` via fetch
  - Uppdatera `localProgress` med faktisk `positionMillis`
  - Om `playbackState` andrats till IDLE/PAUSED -> uppdatera lokalt state
- Nar `playback_state` andras till IDLE (via realtime ELLER poll-svar) -> **rensa intervallet, sluta polla**
- Nar `playback_state` gar tillbaka till PLAYING (via realtime) -> **starta intervallet igen**
- Anvand `AbortController` med 8s timeout for varje anrop

## Del 3: Tva-bilds-approach for somlos overgang

**Fil:** `src/components/sonos/SonosWidget.tsx`

Andringar:
- Ny state: `displayedArtUrl` - den bild som faktiskt visas
- Nar `nowPlaying.album_art_url` andras (latbyte via realtime):
  - Behall `displayedArtUrl` pa gamla vardet -> gamla bilden syns
  - Rendera en dold `<img>` med nya URL:en
  - Nar dolda bildens `onLoad` triggas -> satt `displayedArtUrl` till nya URL:en
- `onAlbumArtChange` (dashboard-bakgrund) anropas forst nar nya bilden ar laddad
- `hasAlbumArt` baseras pa `displayedArtUrl`

## Del 4: Forladda nasta lats album art

**Fil:** `src/components/sonos/SonosWidget.tsx`

- Nar `nowPlaying.next_album_art_url` finns -> rendera en dold `<img>` som forladdar den
- Nar latbyte sker och nya `album_art_url` matchar den redan forladdade -> overgangen ar omedelbar (bilden finns redan i webbslasarens cache)

## Del 5: useSonosTrackTransition - forenkling

**Fil:** `src/components/sonos/hooks/useSonosTrackTransition.ts`

- Ta bort `imageLoaded`/`imageError`-hantering (flyttas till widgeten via `displayedArtUrl`)
- Behall `fetchNowPlaying` och `handleTrackUpdate`
- Hooken fokuserar bara pa data-flode, inte bild-state

## Sammanfattning

| Fil | Andring |
|-----|---------|
| `supabase/functions/sonos-playback-status/index.ts` | **Ny** - latt position-endpoint |
| `supabase/config.toml` | Lagg till config for ny funktion |
| `src/components/sonos/SonosWidget.tsx` | 5s klient-poll, tva bilder, forladda nasta art, stoppa vid IDLE |
| `src/components/sonos/hooks/useSonosTrackTransition.ts` | Forenkling |

## Flode

1. Cron kor varje minut, skriver metadata + art till DB
2. Realtime triggas -> widgeten far ny data (lat, art, state)
3. Om state ar PLAYING -> klienten startar 5s-poll for position
4. JS-ticker kor varje sekund for smidig progress mellan pollarna
5. Vid latbyte: gamla bilden visas tills nya ar laddad, nasta lats art ar redan forladdad
6. Om state gar till IDLE -> klienten stoppar all polling, widgeten doljs
7. Nar cron nasta gang ser PLAYING -> realtime triggas -> widgeten visas och borjar polla igen

