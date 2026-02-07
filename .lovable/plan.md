
# Server-side bakgrundsbild via Lovable AI

## Oversikt

Flytta blur+brightness-bearbetningen fran CSS-filter pa klienten till server-side bildgenerering i cron-jobbet (`sync-sonos-now-playing`). Lovable AI (Gemini Flash Image) tar emot album art + instruktioner och returnerar en fardig blurrad/dimmed bakgrundsbild som sparas i Storage. Klienten visar den direkt utan nagra CSS-filter.

```text
  CRON (sync-sonos-now-playing)
  +----------------------------------------+
  | 1. Hamta metadata + album art fran     |
  |    Sonos/Spotify (som idag)            |
  | 2. Lasa bg_blur + bg_brightness fran   |
  |    sonos_settings                       |
  | 3. Anropa Lovable AI med album art +   |
  |    "Apply Gaussian blur Xpx and        |
  |    brightness Y to this image"         |
  | 4. Spara genererad bild i Storage      |
  |    (sonos-backgrounds bucket)          |
  | 5. Spara URL i sonos_now_playing       |
  |    (ny kolumn: bg_image_url)           |
  | 6. Gor samma for nasta lats art        |
  |    (ny kolumn: next_bg_image_url)      |
  +----------------------------------------+
           |
           v
    Klienten visar bg_image_url direkt
    INGA CSS-filter behövs
```

## Del 1: Databasandringar

**Ny kolumn pa `sonos_now_playing`:**
- `bg_image_url` (text, nullable) - URL till fardig bakgrundsbild
- `next_bg_image_url` (text, nullable) - URL till nasta lats bakgrundsbild (forladdning)

**Ny Storage bucket:**
- `sonos-backgrounds` (public) - for att lagra genererade bakgrundsbilder

## Del 2: Uppdatera `sync-sonos-now-playing` edge function

Andringar i cron-jobbet:

1. Hamta `bg_blur` och `bg_brightness` fran `sonos_settings` (redan i parallel-fetch, bara lagg till kolumnerna)
2. Efter att album art URL:er ar resolved, anropa en ny hjalpfunktion `generateBackground()`:
   - Hamta original-bilden som base64
   - Anropa Lovable AI (`google/gemini-2.5-flash-image`) med instruktion: "Apply a Gaussian blur of {blur}px and reduce brightness to {brightness*100}%. Scale to 1280x720. Output as JPEG."
   - Ta emot base64-resultat
   - Ladda upp till `sonos-backgrounds` bucket med filnamn baserat pa track-hash
   - Returnera public URL
3. Generera bakgrund for BADE nuvarande och nasta lat (parallellt)
4. Spara `bg_image_url` och `next_bg_image_url` i DB-upserten
5. **Optimering**: Hoppa over generering om samma track + samma blur/brightness-installningar redan finns (kolla filnamn i bucket)

## Del 3: Uppdatera `BrewingDashboard.tsx`

Andringar:
- Ta bort CSS `filter: blur() brightness()` fran bakgrunds-diven
- Istallet for `albumArtUrl` som bakgrund, anvand en ny `bgImageUrl` state som hamtas fran `sonos_now_playing.bg_image_url` via realtime
- Bakgrunds-diven anvander `bgImageUrl` direkt med `backgroundImage: url(...)` utan nagra filter
- Behall `transform: scale(1.15)` for att tacka kanter

## Del 4: Uppdatera `SonosWidget.tsx`

Andringar:
- Lagg till `bg_image_url` och `next_bg_image_url` i `NowPlaying`-interfacet
- Nar `onAlbumArtChange` anropas, skicka med `bg_image_url` istallet for `album_art_url`
- Forladda `next_bg_image_url` i en dold `<img>` (precis som `next_album_art_url`)

## Del 5: Hantera installningsandringar

Nar anvandaren andrar blur/brightness i installningarna:
- Installningarna sparas till `sonos_settings` (som idag)
- Nasta gang cron kor (inom 60s) genereras nya bakgrundsbilder med de nya vardena
- Alternativt: trigga en omedelbar regenerering genom att anropa `sync-sonos-now-playing` direkt fran installningssidan efter andring

## Tekniska detaljer

### Lovable AI-anrop i edge function:
```text
POST https://ai.gateway.lovable.dev/v1/chat/completions
Authorization: Bearer LOVABLE_API_KEY
{
  model: "google/gemini-2.5-flash-image",
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "Apply Gaussian blur of 15px and brightness 40%. Scale to 1280x720. Output JPEG." },
      { type: "image_url", image_url: { url: albumArtUrl } }
    ]
  }],
  modalities: ["image", "text"]
}
```

### Storage bucket-struktur:
```text
sonos-backgrounds/
  {track-hash}-{blur}-{brightness}.jpg   (nuvarande lat)
  {next-track-hash}-{blur}-{brightness}.jpg (nasta lat)
```

### Cache-logik:
- Filnamnet inkluderar track-hash + blur + brightness
- Innan generering: kolla om filen redan finns i bucket
- Om den finns: anvand befintlig URL direkt (ingen AI-generering behövs)
- Rensa gamla filer som inte langre behövs (behall max 5-10 filer)

### Sammanfattning av filandringar

| Fil | Andring |
|-----|---------|
| Migration SQL | Lagg till `bg_image_url` och `next_bg_image_url` pa `sonos_now_playing`, skapa `sonos-backgrounds` bucket |
| `supabase/functions/sync-sonos-now-playing/index.ts` | Hamta bg-installningar, generera bakgrundsbilder via Lovable AI, ladda upp till Storage, spara URL:er i DB |
| `src/components/BrewingDashboard.tsx` | Byt fran CSS-filter till fardig `bg_image_url`, ta bort `filter: blur() brightness()` |
| `src/components/sonos/SonosWidget.tsx` | Skicka `bg_image_url` via `onAlbumArtChange`, forladda `next_bg_image_url` |

### Resultat
- Noll GPU-belastning pa TV/Chromecast for bakgrunden (ingen CSS blur/brightness)
- Bakgrundsbyte blir lika snabbt som att ladda en vanlig bild
- Nasta lats bakgrund ar redan genererad och forladdad
- Anvandarens blur/brightness-installningar appliceras server-side
