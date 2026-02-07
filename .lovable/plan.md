

## Synk-justering: Visa nasta lat tidigare an beraknat

### Vad anvandaren vill
Slidern "Synk-justering vid latbyte" ska styra nar **text och bild** byter till nasta lat visuellt -- X sekunder **innan** laten faktiskt beraknas ta slut. Detta kompenserar for eventuell fordrojning i Sonos-systemet sa att det ser ut som att bytet sker exakt nar musiken byter.

### Hur det fungerar idag
- Widgeten beraknar `timeRemaining = duration - localProgress`
- Nar `timeRemaining <= 10s`: en prediktiv poll schemalaggas vid latslut + 500ms
- Bildbyte sker forst nar den prediktiva pollen bekraftar att laten faktiskt bytt

### Ny logik

Ladda in `track_change_offset_seconds` fran databasen i `SonosWidget` (hamtas i samma `checkConnection`-fraga som redan gor `select` mot `sonos_settings`).

I den konsoliderade 1s-tickern, lagg till en ny kontroll:

**Nar `timeRemaining <= offsetMs` OCH `next_album_art_url` finns (prefetchen ar klar):**
- Byt `album_art_url` till `next_album_art_url` och `bg_image_url` till `next_bg_image_url` i `nowPlaying`-state
- Uppdatera dashboard-bakgrunden via `onAlbumArtChangeRef`
- Markera att bytet redan skett (ny ref `earlySwapDoneRef`) sa det bara gors en gang per lat

Texten (artist/latnamn) kan inte bytas forran den prediktiva pollen returnerar den nya latens metadata -- men bilden kan bytas tidigt, vilket gor att overgangen kanns snabbare.

Om offset ar 0 (standard) sker inget tidigt byte -- allt fungerar som forut.

### Tekniska detaljer

**`src/components/sonos/SonosWidget.tsx`**

1. Utoka `checkConnection`-queryn fran `select('show_on_dashboard, selected_group_id')` till att ocksa inkludera `track_change_offset_seconds`
2. Spara vardet i en ny `useRef` (t.ex. `trackChangeOffsetRef`) -- ref for att undvika omrenderingar
3. I tickern (runt rad 145), efter `timeRemaining`-berakningen, lagg till:

```text
if (offsetMs > 0 
    && timeRemaining <= offsetMs 
    && timeRemaining > 0
    && !earlySwapDoneRef.current
    && nowPlaying har next_album_art_url) {
  
  earlySwapDoneRef.current = true;
  
  // Byt bild och bakgrund tidigt
  setNowPlaying(prev => ({
    ...prev,
    album_art_url: prev.next_album_art_url || prev.album_art_url,
    bg_image_url: prev.next_bg_image_url || prev.bg_image_url,
    next_album_art_url: null,
    next_bg_image_url: null,
  }));
  
  // Uppdatera dashboard-bakgrund
  onAlbumArtChangeRef.current?.(next_bg || next_art);
}
```

4. Aterstall `earlySwapDoneRef.current = false` i tickerns cleanup (nar `track_name` andras)

5. I `pollForNewTrack` (trackChanged-branchen): kontrollera om bilden redan bytts via `earlySwapDoneRef` -- om ja, anvand bara text-metadata fran pollen utan att skriva over bilderna igen

**`src/components/sonos/SonosSettings.tsx`**

Uppdatera beskrivningstexten under slidern fran "Sekunder innan beraknat latslut som prediktiv polling triggas" till "Sekunder innan beraknat latslut som bild och bakgrund byter till nasta lat"

### Kant-fall
- Om `prefetch_seconds < track_change_offset_seconds`: bilden kanske inte ar redo annu. Darfor kravet att `next_album_art_url` maste finnas innan bytet sker -- annars vantar den tills den prediktiva pollen gor bytet som vanligt.
- Korta latar (< offset): `timeRemaining`-kontrollen handar att det inte triggas for tidigt since vi kravet `timeRemaining > 0`.

