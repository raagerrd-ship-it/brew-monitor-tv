

## Använd originalbilden med CSS-blur istället för server-side processing

Istället för att processa bilden på servern (som aldrig blir lika blurrad som CSS), använder vi originalbilden från Sonos direkt och applicerar CSS `filter: blur()` på bakgrunds-diven. Detta ger exakt samma starka blur som tidigare, utan att belasta varje ölkort med `backdrop-blur`.

### Varför detta fungerar bättre

- `filter: blur()` på EN div är mycket lättare än `backdrop-blur` på VARJE kort
- Bilden renderas en gång, blurras en gång — inte omberäknad per kort
- Ger exakt den starka blur-effekt du vill ha

### Ändringar

**1. `src/components/BrewingDashboard.tsx`**

Ersätt den processade bakgrunden med originalbilden + CSS filter:

```
// Före (rad 295-306): server-processed image
{isTvMode && processedBgUrl && (
  <div style={{ backgroundImage: `url(${processedBgUrl})`, ... }} />
)}

// Efter: original album art med CSS blur + darken
{isTvMode && albumArtUrl && (
  <div 
    className="absolute inset-0 pointer-events-none"
    style={{ 
      backgroundImage: `url(${albumArtUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center center',
      filter: 'blur(40px) brightness(0.4)',
      transform: 'scale(1.15)',  // Döljer blur-kanter
      contain: 'strict',
    }}
  />
)}
```

- Ta bort fallback-diven (rad 307-319) — den behövs inte längre
- Ta bort `processedBgUrl` state och `handleBackgroundUrlChange` callback

**2. `src/components/sonos/SonosWidget.tsx`**

- Ta bort `onBackgroundUrlChange` prop och all logik för att anropa edge-funktionen `prepare-album-background`
- Ta bort predictive preloading av bakgrund (rad 214-258)
- Ta bort refs: `lastBgRequestRef`, `preloadedNextBgRef`, `isPreloadingNextRef`

### Resultat

- Exakt samma starka blur som med `backdrop-blur`, men applicerad på en enda div
- Ingen edge-function-anrop behövs
- Snabbare — ingen väntan på server-processing
- Enklare kod

### Notering

Edge-funktionen `prepare-album-background` kan behållas om den används någon annanstans, men den anropas inte längre från widgeten.

