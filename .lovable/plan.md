
# Plan: Fixa aspect-ratio-skalning så layouten ser identisk ut

## Bakgrund

AspectRatioContainer är tänkt att fungera som en "virtuell skärm" på 1920x1080 pixlar som skalas proportionellt till fönstrets storlek. Men layouten ser inte identisk ut i olika fönsterstorlekar på grund av att vissa element inte följer skalningssystemet.

---

## Tekniska problem

### Problem 1: TimerFooter använder `position: fixed`
`fixed` positionering gör att footern placeras relativt till webbläsarfönstret istället för den skalade containern. Det innebär att:
- Footern har alltid samma storlek oavsett skalning
- Den "sticker ut" från det skalade innehållet

### Problem 2: Höjdberäkningar i BrewingDashboard
Dashboard-komponenten räknar ut höjden för brew-kort med hänsyn till `TIMER_FOOTER_HEIGHT`, men eftersom footern inte skalar blir beräkningarna fel.

### Problem 3: Dynamiskt innehåll i BrewCard
Chart-arean använder `flex-1` och `ActiveFermentationSession` kan ta varierande höjd.

---

## Lösning

### Steg 1: Ändra TimerFooter till absolut positionering

Ändra `TimerFooter.tsx`:
- Byt `position: fixed` till `position: absolute`
- Lägg till `bottom: 0`, `left: 0`, `right: 0`
- Ta bort `z-50` och använd lägre z-index inom containern

### Steg 2: Uppdatera AspectRatioContainer

Säkerställ att containern som omsluter `TimerFooter` har `position: relative` så att `absolute`-positioneringen fungerar korrekt.

### Steg 3: Förenkla höjdberäkningar i BrewingDashboard

Eftersom allt nu ligger i en 1920x1080-container:
- Ta bort alla `calc()` och dynamiska höjdberäkningar
- Använd fasta pixelvärden baserade på referensupplösningen:
  - Header: 72px
  - Timer footer: 90px (om aktiv)
  - Innehållsarea: 1080 - 72 - 90 = 918px (eller 1008px utan footer)

### Steg 4: Säkerställ fasta höjder i BrewCard

- Chart-arean ska använda beräknad höjd istället för `flex-1`
- Kontrollera att `ActiveFermentationSession` har en fast max-höjd

---

## Tekniska detaljer

### TimerFooter.tsx ändringar

```tsx
// Före
<div className="fixed bottom-0 left-0 right-0 z-50 border-t" ...>

// Efter
<div className="absolute bottom-0 left-0 right-0 z-20 border-t" ...>
```

Notera: Alert-overlay (triggeredAlert) behöver fortfarande `fixed` för att täcka hela skärmen.

### BrewingDashboard.tsx ändringar

Förenkla höjdberäkningarna:
```tsx
// Referenshöjder (baserat på 1920x1080)
const HEADER_HEIGHT = 72;
const TIMER_FOOTER_HEIGHT = 90;
const TOTAL_HEIGHT = 1080;

const getContentHeight = () => {
  const footerHeight = showTimerFooter ? TIMER_FOOTER_HEIGHT : 0;
  return TOTAL_HEIGHT - HEADER_HEIGHT - footerHeight;
};
```

### AspectRatioContainer.tsx ändringar

Lägg till `position: relative` på den skalade containern:
```tsx
<div
  style={{
    width: REFERENCE_WIDTH,
    height: REFERENCE_HEIGHT,
    transform: `scale(${dimensions.scale})`,
    transformOrigin: 'top left',
    position: 'relative', // Viktigt för absolut positionering av barn
  }}
>
```

---

## Förväntad effekt

Efter dessa ändringar kommer:
1. Hela layouten (inklusive timer footer) att skalas proportionellt
2. Brew-korten att ha exakt samma proportioner oavsett fönsterstorlek
3. Diagrammet att behålla rätt storlek relativt till stats-griden

---

## Filer som påverkas

1. `src/components/TimerFooter.tsx` - Ändra från fixed till absolute positionering
2. `src/components/AspectRatioContainer.tsx` - Säkerställ position: relative
3. `src/components/BrewingDashboard.tsx` - Förenkla höjdberäkningar
