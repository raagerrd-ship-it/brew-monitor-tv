
# Stabilare Sonos-widget: JS progressbar + lazy album art

## Sammanfattning
Tva andringar:
1. **Byt tillbaka till en JS-driven progressbar** som uppdateras med `setInterval` istallet for CSS-animation. Enklare, fungerar och behover inte vara exakt.
2. **Gor album art "lazy"** - visa lat/artist direkt, ladda in bilden i bakgrunden utan att blockera. Om bilden inte hinner laddas gar det bra, den visas nar den ar klar.

## Detaljerade andringar

### 1. JS Progressbar (`SonosWidget.tsx`)
- Ta bort CSS-animationslogiken (`progress-grow`, `--progress-start`, `remainingMs`)
- Lagg till en `useEffect` med `setInterval` (var 1 sekund) som okar `localProgress` med 1000ms
- Aterstartar vid ny data fran polling
- Progressbaren visar bara `width: ${percent}%` med en enkel CSS transition (300ms)

### 2. Album art som icke-blockerande (`SonosWidget.tsx` + `useSonosTrackTransition.ts`)
- Vid latbyte: uppdatera lat/artist DIREKT, men lat `imageLoaded` vara `false` tills bilden faktiskt laddats
- Ta bort crossfade-logiken (`previousAlbumArt`, `showPreviousArt`) - den lagger till komplexitet och extra state-uppdateringar som belastar hardvaran
- Bilden visas mjukt nar den laddats (befintlig `opacity` transition), men widgeten visar gradient-bakgrund under tiden
- I `BrewingDashboard.tsx`: Simplify `handleAlbumArtChange` - ta bort den separata Image-preloaden som skapar dubbel bildladdning

### Tekniska detaljer

**SonosWidget.tsx:**
- Ta bort state: `previousAlbumArt`, `showPreviousArt`
- Lagg till `useEffect` for JS progress-ticker (1s intervall)
- Forenkla renderingen: ta bort crossfade `<img>`, ta bort CSS animation-props

**useSonosTrackTransition.ts:**
- Ta bort `setPreviousAlbumArt` och `setShowPreviousArt` fran alla callbacks
- Ta bort crossfade-logiken i `applyPreloadedData` och `handleImageLoad`
- Farre state-uppdateringar = farre re-renders = stabilare pa Chromecast

**BrewingDashboard.tsx:**
- Forenkla `handleAlbumArtChange` - satt `preloadedAlbumArt` direkt utan extra Image-objekt (bilden ar redan laddad i widgeten)

### Resultat
- Farre state-variabler (2 borttagna)
- Farre re-renders vid latbyte (2-3 farre setState-anrop)
- Progressbaren fungerar tillforlitligt med enkel JS
- Album art visas nar den hinner, utan att blockera nagon annan uppdatering
