

# Ytterligare Chromecast-optimeringar + server-side bildoptimering

## Kvarvarande GPU-problem

### 1. `backdrop-blur` finns kvar i BrewCard och StatCard
- `BrewCard.tsx` rad 62: `backdrop-blur-xl` (inaktiveras redan i TV-mode - bra)
- `StatCard.tsx` rad 73: `backdrop-blur-md` -- denna ar INTE inaktiverad i TV-mode. Varje StatCard (4-5 per brew x 2-3 brews = 8-15 element) kor blur-filter kontinuerligt.

### 2. `transition-all duration-500/700` i brew-kort
- `BrewCard.tsx` rad 61: `transition-all duration-500` -- kor alltid, aven i TV-mode
- `StatCard.tsx` rad 73: `transition-all duration-700` -- kor alltid
- `GravityStat.tsx` rad 75: `transition-all duration-700` -- kor alltid
- `BatteryStat.tsx` rad 36: `transition-all duration-500` -- SVG-element
- `TempStat.tsx` rad 43: `transition-all duration-500` -- SVG-element

### 3. `boxShadow` i SonosWidget
- Rad 212-214: TV-mode har tre lager av box-shadow. Pa Chromecast med 1-3 fps ar detta onodigt GPU-arbete. En enkel tunn border racker.

### 4. Bakgrundsbilden laddas i full storlek
- Spotify returnerar ~300x300px bilder (index [1]). Dessa visas i widgeten (240x120px) OCH som fullskarmsbakgrund.
- Chromecast har 1280x720 skarm. Att ladda och rendera en 300px bild som fullskarmsbakgrund ar acceptabelt (upscaling ar billigt).
- Men: varje ny bild kraver att Chromecasten dekomprimerar JPEG:en. Detta ar CPU-arbete.

## Server-side bildoptimering (din idé)

Ja, det gar att optimera bilder via en edge function. Planen:

1. **Ny edge function `optimize-image`**: Tar emot en bild-URL, laddar ner den, konverterar till WebP med lagre kvalitet (60%) och mindre storlek (max 200x200 for widget, 400x400 for bakgrund), och returnerar den optimerade bilden.

2. **Alternativ (enklare och snabbare)**: Spotify redan ger bilder i olika storlekar. Edge-funktionen `sonos-now-playing` kan returnera den minsta bilden (64x64 `images[2]`) for widgeten, och mellanstorleken (300x300 `images[1]`) for bakgrunden. Eller byta till `images[2]` for allt i TV-mode.

**Rekommendation**: Bildoptimering via edge function lagger till latens (varje request maste ladda ner + konvertera + skicka tillbaka). Det enklaste och snabbaste ar att valja ratt Spotify-bildstorlek direkt i `sonos-now-playing` edge-funktionen. For TV-mode behover vi max 300px bred bild (redan vad vi far).

Det verkliga problemet ar inte bildstorleken utan alla GPU-filter (blur, shadows, transitions) som kor pa varje frame.

## Atgardsplan

### Steg 1: Ta bort backdrop-blur fran StatCard i TV-mode
**Fil:** `src/components/brew-card/StatCard.tsx`
- Villkora `backdrop-blur-md` -- ta bort i TV-mode

### Steg 2: Ta bort transitions fran brew-kort i TV-mode
**Filer:**
- `src/components/brew-card/BrewCard.tsx` -- villkora `transition-all duration-500`
- `src/components/brew-card/StatCard.tsx` -- villkora `transition-all duration-700`
- `src/components/brew-card/GravityStat.tsx` -- villkora `transition-all duration-700`
- `src/components/brew-card/BatteryStat.tsx` -- villkora `transition-all duration-500`
- `src/components/brew-card/TempStat.tsx` -- villkora `transition-all duration-500`

### Steg 3: Forenkla SonosWidget box-shadow i TV-mode
**Fil:** `src/components/sonos/SonosWidget.tsx`
- Ersatt tre-lagers box-shadow med en enkel tunn border (`1px solid rgba(255,255,255,0.15)`)

### Steg 4: Anvand mindre Spotify-bild for widgeten
**Fil:** `supabase/functions/sonos-now-playing/index.ts`
- Returnera tva URL:er: `album_art_url` (300px, for bakgrund) och `album_art_url_small` (64px, for widget)
- Widgeten ar bara 240x120px, sa en 64px bild racker
- Mindre bild = snabbare dekomprimering pa Chromecast

### Steg 5 (valfritt): Cache bilder via Supabase Storage
Om man vill ga langre kan edge-funktionen ladda upp bilden till Supabase Storage och returnera den cachade URL:en. Da behover Chromecasten inte hamta fran Spotify varje gang. Men detta lagger till komplexitet och latens vid forsta laddning, sa det rekommenderas bara om bildladdning fortsatter vara ett problem.

## Teknisk sammanfattning

| Vad | Problem | Atgard |
|-----|---------|--------|
| StatCard backdrop-blur | 8-15 blur-filter aktiva | Ta bort i TV-mode |
| BrewCard/StatCard transitions | Onodiga CSS-transitions | Ta bort i TV-mode |
| SonosWidget box-shadow | 3 lager GPU-shadow | Enkel border i TV-mode |
| Spotify-bild for widget | 300px for 240px widget | Returnera 64px-bild fran edge function |

Steg 1-3 ar de viktigaste -- de tar bort GPU-arbete som kor kontinuerligt. Steg 4 minskar CPU-arbete vid latbyten.

