

## Gör desktop-läget visuellt identiskt med TV-läge

### Sammanfattning
Desktop-läget ska se ut exakt som TV-läget gör idag. Enda skillnaden blir att man i desktop kan klicka på saker (kontroller-dialog, inställningar, dela, händelser, enhetslänkning) och att Toasters/Tooltips finns kvar.

### Vad ändras

**1. Ta bort `isTvMode`-villkor som styr visuell stil**
Alla ställen där `isTvMode` används för att välja mellan två visuella varianter (padding, storlek, skuggor, animationer, bakgrunder) ändras till att alltid använda TV-varianten. Interaktiva villkor (`isTvMode ? undefined : onClick`) behålls.

**2. Filer som berörs**

| Fil | Typ av ändring |
|-----|----------------|
| `AspectRatioContainer.tsx` | Desktop-grenen tar bort CSS `transform: scale()` och använder samma fullscreen-layout som TV-grenen (fast viewport, ingen skalning) |
| `BrewingDashboard.tsx` | Sonos-widget visas alltid (inte bara i TV-läge). Bakgrundsbild visas alltid. Ta bort `isTvMode`-villkor för overflow/background |
| `DashboardHeader.tsx` | Ta bort villkorlig transparent bakgrund - alltid transparent vid albumkonst. RAPT-bar alltid halvtransparent. Behåll klickbarhet i desktop |
| `BrewCard.tsx` | Ta bort villkorliga transitions/backdrop-blur - alltid TV-stil. `showInteractiveElements` styrs bara av `isAuthenticated` |
| `StatCard.tsx` | Ta bort villkor: alltid `p-2`, inga bakgrundsikoner, ingen `backdrop-blur`/transitions |
| `LazyBrewChart.tsx` | Alltid använd server-renderade chart-bilder (TvModeChart) istället för Recharts |
| `Logo.tsx` | Alltid visa "BryggövervakareTV" (eller ta bort TV-suffixet helt) |
| `SonosWidget.tsx` | Använd TV-storlekar (280x130) som standard. Ta bort animationsvillkor |
| `GravityStat.tsx` | Alltid TV-storlekar (6px progress, 7px text) |
| `SessionStatusIcon.tsx` | Ta bort villkorlig `animate-pulse` |
| `FermentationSessionCompact.tsx` | Alltid TV-typografi |
| `TimerFooter.tsx` | Ta bort villkorlig `animate-pulse` |

**3. Saker som BEHÅLLS olika**
- Toasters och Sonner: visas i desktop, döljs i TV (behövs för feedback vid klick)
- TooltipProvider: visas i desktop, döljs i TV
- Klickbarhet: kontroller-dialog, inställningsknapp, dela-knapp, händelse-dialog - alla aktiva i desktop
- Service Worker-hantering i `main.tsx`: behålls som den är (TV avregistrerar, desktop behåller)
- Force-refresh polling: bara i TV-läge (desktop har manuell refresh)
- Body overflow-lock: bara i TV-läge (Chromecast-iframe)

**4. Kontext-variabeln `isTvMode` behålls**
Den behövs fortfarande för de få funktionella skillnaderna (service worker, toasters, force-refresh, body overflow). Men alla visuella villkor tas bort.

### Tekniska detaljer

**`AspectRatioContainer.tsx`** - Den största ändringen. Desktop-grenen byter från skalad 1920x1080-preview till fullscreen-layout likt TV-grenen. Behåller viewport-tracking.

**`LazyBrewChart.tsx`** - Alltid rendera `TvModeChart` (server-renderade SVG:er). Recharts lazy-laddas aldrig. Detta sparar ~150KB JavaScript.

**`BrewingDashboard.tsx`** - Sonos-widgeten renderas alltid (inte `{isTvMode && ...}`). Bakgrundsbild visas alltid. `hasAlbumArtBackground` baseras bara på `!!bgImageUrl`.

