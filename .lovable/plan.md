

# Server-side bildbearbetning for Chromecast-bakgrund

## Ide
Istallet for att Chromecast kor CSS blur/opacity-filter pa albumbilden, gor vi det pa servern. En edge function laddar ner Spotify-bilden, applicerar blur + morker, sparar resultatet i Storage, och returnerar en fardig URL. Chromecast visar bara en statisk bild -- noll GPU-arbete.

## Arkitektur

Ny edge function: `prepare-album-background`

**Flode:**
1. Klienten far ny lat fran `sonos-now-playing` (inkl. `album_art_url`)
2. Klienten anropar `prepare-album-background` med den URL:en
3. Edge function:
   - Hashar URL:en till ett filnamn (t.ex. `bg_a1b2c3.jpg`)
   - Kollar om filen redan finns i Storage (cache) -- returnerar direkt om ja
   - Laddar ner originalbilden fran Spotify
   - Anvander `magick-wasm` for att: resize till 400x400, applicera Gaussian blur (radius 30), morka till ~20% ljusstyrka
   - Laddar upp resultatet till `album-backgrounds` Storage bucket
   - Returnerar public URL
4. Klienten anvander den fardiga URL:en som bakgrund -- ingen CSS-filter behovs

**Cachning:** Samma bild processas bara en gang. Manga album ateranvands sa cachen vaxter sakta.

## "15 sekunder fore"-logiken

Vi kan inte veta nasta lat i forvag fran Sonos API. Men vi kan optimera sa:
- Nar en NY lat borjar: anropa `prepare-album-background` direkt
- Medan bilden processas (~1-2s): visa bakgrunden utan bild (eller behall forra)
- Nar processed URL kommer tillbaka: visa den direkt (ingen fade pa Chromecast)

Om man vill kan vi aven "fore-cacha" genom att kolla Sonos-kon (queue), men det lagger till komplexitet. Enklast ar att processa direkt vid latbyte -- cachen gor att andra gangen ar instant.

## Detaljerade andringar

### Steg 1: Skapa Storage bucket `album-backgrounds`
- Public bucket for att Chromecast ska kunna ladda bilden direkt utan auth-headers
- Enkla RLS-policies (public read)

### Steg 2: Ny edge function `prepare-album-background`
**Fil:** `supabase/functions/prepare-album-background/index.ts`
- Input: `{ imageUrl: string }`
- Hashar URL till filnamn
- Kollar Storage cache (HEAD request)
- Om miss: ladda ner, magick-wasm blur+darken, upload till Storage
- Output: `{ backgroundUrl: string }` (public storage URL)

### Steg 3: Uppdatera SonosWidget / BrewingDashboard
**Fil:** `src/components/sonos/SonosWidget.tsx`
- Nar ny lat detekteras och `album_art_url` finns: anropa `prepare-album-background`
- Skicka tillbaka `backgroundUrl` via `onAlbumArtChange` callback

**Fil:** `src/components/BrewingDashboard.tsx`
- Anvand `backgroundUrl` direkt som `backgroundImage` -- ta bort `opacity: 0.2` (morkret ar redan inbakat i bilden)
- Ingen CSS-filter behovs overhuvudtaget

### Steg 4: Uppdatera config.toml
- Lagg till `[functions.prepare-album-background]` med `verify_jwt = false`

## Teknisk sammanfattning

| Komponent | Fore | Efter |
|-----------|-------|-------|
| Bakgrundsbild | Spotify 300px + CSS opacity 0.2 | Forbearbetad 400px blurrad+morkad fran Storage |
| GPU-arbete | opacity-lager pa varje frame | Ingen (statisk bild) |
| Latens vid latbyte | Omedelbar (men med GPU-filter) | ~1-2s forsta gangen, instant fran cache |
| Bandbredd | ~15KB per bild | ~10KB (komprimerad, lagre kvalitet) |

## Risk
- `magick-wasm` i edge functions kan ha langre kall-start (~500ms extra). Men det ar engangskostnad per unik bild.
- Om Storage-bucketen vaxter kan man lagga till en cleanup-cron som tar bort bilder aldre an 30 dagar.

