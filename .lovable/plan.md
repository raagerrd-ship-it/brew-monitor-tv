

## Prediktiv forladdning av nasta lats bakgrund

### Oversikt
Nar en lat narmar sig sitt slut (15s kvar) borjar vi forbereda nasta lats bakgrundsbild i forhand. Vid skip/snabbt byte behaller vi den gamla bakgrunden tills den nya ar helt klar -- det ar OK att det tar 10-15s.

### Andringar

**1. Edge function: `sonos-now-playing`**
- Extrahera `metadata.nextItem?.track` fran Sonos API:t (redan tillgangligt i `playbackMetadata`-svaret)
- Hamta Spotify album art for nasta lat om det ar en lokal Sonos-URL (samma logik som for currentItem)
- Lagg till `next_album_art_url` i svaret

**2. Databasschema: `sonos_now_playing`**
- Lagg till kolumnen `next_album_art_url TEXT` (nullable) och `album_art_url_small TEXT` (om den inte redan finns)

**3. `SonosWidget.tsx` -- prediktiv forladdning**
- Lagg till `NowPlaying.next_album_art_url`
- Ny `useEffect` som overvakar `localProgress` och `duration_ms`:
  - Nar `duration_ms - localProgress < 15000` (15s kvar), anropa `prepare-album-background` med `next_album_art_url`
  - Spara resultatet i en `preloadedNextBgRef` (ref, inte state)
  - Preloada bilden med `new Image()` sa den ar i browser-cache
- Andra befintliga `prepare-album-background`-effekten:
  - Nar ny lat detekteras, kolla forst om `preloadedNextBgRef.current` matchar nya latens `album_art_url`
  - Om match: anvand den direkt (noll vantan)
  - Om ingen match (skip, oforutsagbart byte): kor nuvarande reaktiva flodet som fallback -- gammal bakgrund ligger kvar tills ny ar redo

**4. `useSonosTrackTransition.ts`**
- Utoka `NowPlaying`-interfacet med `next_album_art_url` -- ingen annan andring behovs

### Flodesdiagram

```text
Normal latbyte:
  -15s  -> Klient ser next_album_art_url, triggar prepare-album-background
  -10s  -> Edge function processar bilden (eller cache hit)
  -5s   -> Bild klar + preloadad i browser med new Image()
   0s   -> Latbyte -> bakgrund swappas direkt fran ref

Skip/snabbt byte (fallback):
   0s   -> Ny lat detekteras, ingen preloadad bakgrund finns
   0s   -> Gammal bakgrund behalls synlig
   0-10s -> prepare-album-background kors reaktivt
   10s  -> Ny bakgrund klar + preloadad -> swap
```

### Tekniska detaljer

**Edge function andring** (sonos-now-playing):
```javascript
const nextItem = metadata.nextItem;
const nextTrack = nextItem?.track;
let nextAlbumArtUrl = nextTrack?.imageUrl || null;
// Samma Spotify-logik som for currentItem om lokal URL
nowPlaying.next_album_art_url = nextAlbumArtUrl;
```

**Widget prediktiv effekt** (SonosWidget.tsx):
```javascript
const preloadedNextBgRef = useRef<{ artUrl: string; bgUrl: string } | null>(null);
const isPreloadingNextRef = useRef(false);

useEffect(() => {
  if (!nowPlaying?.next_album_art_url || !nowPlaying.duration_ms || localProgress === null) return;
  const timeLeft = nowPlaying.duration_ms - localProgress;
  if (timeLeft > 15000 || timeLeft < 0 || isPreloadingNextRef.current) return;
  // Trigger prepare-album-background for next track...
  // Store result in preloadedNextBgRef
}, [localProgress, nowPlaying?.next_album_art_url, nowPlaying?.duration_ms]);
```

**Fallback i bakgrundseffekten**:
```javascript
// When new track detected, check preloaded ref first
if (preloadedNextBgRef.current?.artUrl === nowPlaying.album_art_url) {
  bgCallback(preloadedNextBgRef.current.bgUrl); // Instant!
  preloadedNextBgRef.current = null;
  return;
}
// Otherwise run reactive flow (takes 10-15s, old bg stays)
```

### Sammanfattning
- Normal latbyte: bakgrund redo direkt (forladdad 15s i forvag)
- Skip/snabbt byte: gammal bakgrund ligger kvar, ny visas nar den ar redo (10-15s)
- Inga null-varden skickas till parent -- aldrig blank skarm
- Inga extra re-renders: all forladdning sker via refs

