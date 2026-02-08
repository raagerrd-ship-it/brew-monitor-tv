

# Sonos Widget: Stabilitet och Synk-fix

## Identifierade problem

### 1. Widget stängs vid låtbyte (inte nästa)
Rad 498 i SonosWidget: `shouldHide` returnerar `true` om `playback_state !== 'PLAYBACK_STATE_PLAYING'`. När du byter till en godtycklig låt på Sonos skickar API:et kortvarigt en övergångsstatus (t.ex. `PLAYBACK_STATE_BUFFERING` eller `PLAYBACK_STATE_TRANSITIONING`). Widgeten försvinner omedelbart, bakgrunden rensas, och den kanske aldrig kommer tillbaka om den missar nästa poll.

### 2. Fel bild i widget vs bakgrund vid slumpmässigt låtbyte
Vid ett prediktivt/sekventiellt låtbyte används `next_album_art_url` och `next_bg_image_url` som förladdats. Men vid ett slumpmässigt hopp (du väljer en helt annan låt) är dessa `next_`-URL:er fortfarande från den förväntade nästa låten -- inte den du faktiskt valde. Koden på rad 289-291 gör `prev.next_album_art_url || prev.album_art_url` vilket visar fel bild.

### 3. Widget startar inte alltid
Om databasens `playback_state` av någon anledning inte är exakt `PLAYBACK_STATE_PLAYING` vid init (t.ex. `PLAYBACK_STATE_BUFFERING` efter att du precis startat en låt) döljs widgeten direkt av `shouldHide`.

## Lösning

### A. Tolerant `shouldHide` med grace period (SonosWidget.tsx)
- Ändra `shouldHide` till att bara dölja vid `PLAYBACK_STATE_IDLE` och `PLAYBACK_STATE_PAUSED` (inte vid buffering/transitioning/andra mellanstatus)
- Lägg till en 5-sekunders grace period: när state ändras från PLAYING till icke-PLAYING, vänta 5 sekunder innan widgeten faktiskt döljs. Om den återgår till PLAYING inom den tiden behålls widgeten synlig.

### B. Använd inte stale `next_`-URL:er vid slumpmässigt låtbyte (SonosWidget.tsx)
- I track-change-hanterarna (5s-poll rad 287 och prediktiv poll rad 141): kontrollera om `next_album_art_url` verkligen hör till den NYA låten genom att jämföra mot server-data
- Om track-bytet inte matchade den förväntade nästa låten: behåll nuvarande art och bg, uppdatera enbart text-metadata. Låt realtime/server-synk leverera rätt bild.
- Konkret: om `data.trackName` inte matchar det vi förväntar oss (vi har ingen info om nästa låts namn i klienten), ta det säkra steget och behåll befintlig konst tills servern synkar in den korrekta.

### C. Förbättra init-robusthet (SonosWidget.tsx)
- Tillåt att widgeten visas även om `playback_state` inte är exakt PLAYING vid start -- visa den om det finns ett `track_name`

## Tekniska detaljer

### `src/components/sonos/SonosWidget.tsx`

1. **shouldHide** (rad 498): Ändra villkoret:
   ```text
   // Nuvarande (för strikt):
   nowPlaying.playback_state !== 'PLAYBACK_STATE_PLAYING'

   // Nytt (tolerant):
   nowPlaying.playback_state === 'PLAYBACK_STATE_IDLE'
   ```
   Plus en 5s delay-mekanism med `useRef` och `setTimeout` som fördröjer faktisk dölj-handling.

2. **Track change i 5s-poll** (rad 287-307): När `trackChanged` är true, skicka INTE `next_album_art_url`/`next_bg_image_url` om vi inte kan verifiera att de hör till rätt låt. Istället: behåll `prev.album_art_url` och `prev.bg_image_url`, uppdatera bara text. Trigga en `sync-sonos-now-playing`-fetch i bakgrunden så servern synkar rätt data.

3. **Track change i prediktiv poll** (rad 121-162): Samma logik -- om `earlySwapDone` inte är true (dvs det INTE var en förväntad sekventiell övergång), använd inte `next_`-URL:er. 

4. **Init** (rad 356-395): Ta bort kravet att playback_state måste vara PLAYING för att visa widgeten. Kontrollera istället bara att `track_name` finns.

5. **Bakgrundsrensning** (rad 500-506): Rensa inte bakgrunden direkt vid state-byte. Använd grace period.

