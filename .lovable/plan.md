

# Adaptiv bakgrundsljusstyrka - Alltid samma upplevda ljusnivå

## Problem
Nuvarande lösning applicerar en fast mörk overlay (t.ex. 40% svart) ovanpå bakgrundsbilden. Men en ljus albumomslag + 40% overlay ser fortfarande mycket ljusare ut än ett mörkt albumomslag + 40% overlay. Resultatet är inkonsekvent ljusstyrka mellan låtar.

## Lösning
Flytta ljusstyrkenormaliseringen tillbaka till serversidan (AI-generering) så att varje bakgrundsbild kommer ut med samma upplevda ljusnivå, oavsett originalet. Klientsidans overlay behålls som en enkel "dimmer" ovanpå det redan normaliserade resultatet.

## Hur det fungerar

1. **AI-prompten uppdateras** i edge-funktionen `sync-sonos-now-playing` för att instruera AI:n att:
   - Analysera bildens genomsnittliga ljusnivå
   - Normalisera den till en konsekvent mål-ljusstyrka (t.ex. 25-30% perceived brightness)
   - Sedan applicera blur
   - Göra den översta kanten mörkare för header-läsbarhet

2. **Cache-invalidering**: Filnamns-suffixet ändras från `-v4.jpg` till `-v5.jpg` så att alla bilder regenereras med den nya logiken.

3. **Klient-overlay bevaras** som en extra dimmer som användaren kan styra via inställningarna — men nu utgår den från en redan normaliserad bas.

## Tekniska detaljer

### Fil: `supabase/functions/sync-sonos-now-playing/index.ts`

**AI-prompt** (rad 110) ändras från:
```
Apply a Gaussian blur of Xpx. Keep the original brightness and colors - do NOT adjust brightness. Scale to 1280x720. Output as JPEG.
```
Till:
```
1. Analyze the average perceived brightness of this image.
2. Adjust the overall brightness so the result has a consistent, low perceived brightness around 25-30% (dark but with visible color detail). If the image is already dark, brighten it slightly. If it is bright, darken it significantly.
3. Apply a Gaussian blur of Xpx.
4. Make the top ~85px edge approximately 40-50% darker than the rest for header readability.
5. Scale to 1280x720. Output as JPEG.
```

**Cache-suffix** (rad i `resolveBackground` / `simpleHash`-anropet) ändras:
```
const fileName = `${hash}-${blur}-v5.jpg`;
```

### Fil: `src/components/BrewingDashboard.tsx`
- Standardvärdet för `bgBrightness` kan justeras till ~0.6-0.7 eftersom bilden nu redan är normaliserad till en låg nivå. Overlay-slidern fungerar sedan som finjustering.

### Fil: `src/components/sonos/SonosSettings.tsx`
- Uppdatera beskrivningstexten för slidern så det framgår att ljusstyrkan nu är normaliserad automatiskt och att slidern är en finjustering.

## Sammanfattning
- 1 edge-funktion uppdateras (ny AI-prompt + cache-bust)
- 2 frontend-filer uppdateras (nytt default-värde + uppdaterad beskrivning)
- Alla befintliga bakgrunder regenereras automatiskt vid nästa synk tack vare nytt filnamns-suffix
