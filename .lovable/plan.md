

## Box Blur-algoritm som alternativ till downscale/upscale

### Sammanfattning
Ersatt den nuvarande downscale/upscale-blurmetoden med en separabel box blur som ger jämnare, mer kontrollerbara resultat.

### Tillvagangssatt

Implementera en **3-pass separabel box blur** (horisontellt + vertikalt per pass). Tre pass av box blur approximerar en Gaussian blur, vilket ger mjuka, naturliga resultat.

### Tekniska detaljer

**Fil: `supabase/functions/_shared/image-processing.ts`**

1. Lagg till en ny funktion `boxBlurPass(pixels, w, h, radius)` som:
   - Gor en horisontell pass: for varje pixel, berakna medelvarde av alla pixlar inom `radius` at hoger och vanster
   - Gor en vertikal pass: samma sak men uppat/nedat
   - Anvander en lopande summa (sliding window) for O(n) per pass istallet for O(n * r)

2. Uppdatera `applyBlur` funktionen:
   - Skala `blur`-vardet (0-200) till en pixelradie (t.ex. blur/2, sa blur=100 ger radie 50px)
   - Kor 3 pass av `boxBlurPass` for att approximera Gaussian blur
   - Behall samma funktionssignatur sa att resten av koden inte paverkas

3. Hojdpunkter i implementationen:
   - Sliding window-teknik for att varje pass ar O(width * height) oavsett radie
   - Separat behandling av RGB-kanaler (alpha lamnas oforandrad)
   - Kanthantering: clampa index till bildgranserna

### Prestandabedomning
- 1280x720 bild, radie 50px, 3 pass: ~920k pixlar x 3 pass x 2 riktningar = ca 5.5M operationer
- Varje operation ar enkel (addition/subtraktion) — bor klara sig pa 100-300ms pa en edge function
- Betydligt battre bildkvalitet an downscale/upscale-metoden

### Paverkan
- Ingen andring av externa API:er eller databas
- Samma `blur`-slider i installningarna fungerar som tidigare
- Deployment av `sync-sonos-now-playing` kravs efter andringen

