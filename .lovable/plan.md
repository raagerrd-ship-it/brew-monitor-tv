

## Optimera låtbytet i TV-läge

### Problem
Vid varje låtbyte sker 3-4 kaskaderande re-renders av hela dashboarden:
1. Bildstatus nollställs -> bakgrund försvinner kort
2. Ny albumbild laddas -> bakgrund kommer tillbaka  
3. Bakgrundsbearbetning startar (upp till 10s) -> ny bakgrund sätts

Detta orsakar "hängningar" på Chromecast-hårdvara.

### Lösning

**1. Behåll gammal bakgrund tills ny är redo**
- Sluta nollställa `albumArtUrl` och `processedBgUrl` till `null` mellan låtar
- Behåll föregående bakgrund synlig tills den nya bilden och bakgrunden är helt redo

**2. Preloada bakgrundsbilden innan swap**  
- När `prepare-album-background` returnerar en URL, ladda bilden i en dold `Image()` först
- Byt `processedBgUrl` i state först när bilden faktiskt har laddats klart i browsern
- Detta förhindrar en "tom ram" medan browsern hämtar den nya bakgrundsbilden

**3. Batcha state-uppdateringar i widgeten**
- I `useSonosTrackTransition`: sluta anropa `setImageLoaded(false)` vid nytt spår om vi är i TV-läge
- Låt den nya bilden ladda "ovanpå" den gamla tyst - byt först vid `onLoad`
- Färre state-ändringar = färre re-renders

**4. Separera albumart-notifiering från widgetens rendering**
- Flytta `onAlbumArtChange`-logiken så den bara triggas när ny bild faktiskt laddats klart (inte vid varje `imageLoaded`-toggle)
- Undvik att skicka `null` till parent mellan låtar

### Teknisk plan

**`useSonosTrackTransition.ts`** - Ändra `fetchNowPlaying` och `handleTrackUpdate`:
- Ta bort `setImageLoaded(false)` vid nytt spår (behåll gammal bild tills ny laddats)
- Lägg till en `pendingTrackRef` som håller reda på om vi väntar på ny bild

**`SonosWidget.tsx`** - Ändra effekten för `onAlbumArtChange` (rad 152-161):
- Bara notifiera parent med ny URL, aldrig med `null` (behåll gammal)
- Ändra `prepare-album-background`-effekten (rad 164-199): preloada bilden med `new Image()` innan `bgCallback` anropas

**`BrewingDashboard.tsx`** - Ingen ändring behövs om widgeten slutar skicka `null`

### Sammanfattning
- Bakgrunden blinkar inte längre vid låtbyte
- Inga onödiga re-renders av hela dashboarden
- Ny bakgrund visas först när den är helt redo (nedladdad till browser-cache)
- Layout och utseende förblir oförändrat

