

## Plan: Extrahera publik URL från Sonos `getaa`-parametern + Spotify Search-fallback

### Bakgrund
Sonos `getaa`-URL:er (t.ex. `http://192.168.1.x:1400/getaa?s=1&u=https%3A%2F%2Flh3.googleusercontent.com%2F...`) innehåller ofta en `u`-parameter med den **faktiska publika bild-URL:en** (URL-enkodad). Lotus Lantern-projektet löser detta genom att proxya mot lokalt nätverk — men det fungerar inte i molnet.

### Lösning i två steg

**Steg 1: Extrahera `u`-parametern från `getaa`-URL:er**

I `sonos-art.ts`, innan vi ger upp på lokala URL:er, parsa `u`-parametern ur `getaa`-URL:en. Om den dekodade URL:en är publik (https), returnera den direkt.

```text
resolveAlbumArt(imgUrl, objectId, trackName, artistName)
  ├─ Publik URL (https)? → returnera direkt
  ├─ Lokal URL (192.168.x / getaa)?
  │   ├─ Har getaa u-parameter med publik URL? → returnera den ← NY
  │   ├─ Spotify objectId? → oEmbed
  │   ├─ YouTube videoId? → YouTube thumbnail
  │   └─ trackName + artist? → Spotify Search API ← NY
  └─ null
```

**Steg 2: Spotify Search API som sista fallback**

Om `u`-parametern saknas eller är lokal, och oEmbed/YouTube inte matchar, sök via Spotify Search API med `trackName` + `artistName`. Secrets `SPOTIFY_CLIENT_ID` och `SPOTIFY_CLIENT_SECRET` finns redan.

### Filändringar

**`supabase/functions/_shared/sonos-art.ts`**
- Lägg till `extractPublicUrlFromGetaa(imgUrl)` — parsar `u`-parameter, returnerar dekodad URL om den är publik (https)
- Lägg till `getSpotifyClientToken()` — Client Credentials-flöde, cachat i minnet (~1h)
- Lägg till `searchSpotifyForArt(trackName, artistName)` — söker Spotify, returnerar `album.images[0].url`
- Uppdatera `resolveAlbumArt()` — nya parametrar `trackName?` och `artistName?`, ny fallback-kedja

**`supabase/functions/sync-sonos-now-playing/index.ts`**
- Skicka med `track?.name` och `track?.artist?.name` till `resolveAlbumArt()`-anropet (rad 238 och 352)

### Tekniska detaljer
- `u`-parametern i getaa: `http://192.168.1.x:1400/getaa?s=1&u=https%3A%2F%2Flh3.googleusercontent.com%2F...` → `decodeURIComponent('https%3A%2F%2Flh3...')` → publik URL
- Spotify Client Credentials: POST till `https://accounts.spotify.com/api/token`, svar ger `access_token` giltig ~1h, cachas i edge function-minnet
- Spotify Search: `GET /v1/search?type=track&q=track:{name} artist:{artist}&limit=1` → `tracks.items[0].album.images[0].url`

