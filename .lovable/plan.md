

# Iframe-optimering for Chromecast-casting

## Nuvarande situation
Appen har redan TV-mode (`?tv=true`) som inaktiverar GPU-tunga effekter. Men det finns ytterligare optimeringar nar sidan laddas i en iframe pa Chromecast.

## Vad din casting-app bor gora

### 1. Iframe URL
Ladda sidan med ratt parametrar:
```text
https://brew-monitor-tv.lovable.app/?tv=true
```
TV-mode aktiveras automatiskt om Chromecast-user-agent (`crkey`) detekteras, men `?tv=true` ar en saker fallback.

### 2. Iframe-storlek
Satt iframe till **exakt 1280x720** (eller hela skarmens storlek). Appen ar designad for 720p nativt i TV-mode -- ingen skalning gors. Om iframen ar storre (t.ex. 1920x1080) sa fyller layouten hela utrymmet, men fontstorlekar och element ar optimerade for 720p.

**Rekommendation**: Satt iframen till `width: 100%; height: 100%` av Chromecast-skarmens viewport. Appen anpassar sig automatiskt.

### 3. Iframe-attribut for prestanda
```text
<iframe
  src="https://brew-monitor-tv.lovable.app/?tv=true"
  width="100%"
  height="100%"
  frameborder="0"
  scrolling="no"
  allow="autoplay"
  loading="eager"
  style="overflow: hidden; border: none;"
/>
```
- `scrolling="no"`: Forhindrar scroll-events som tar CPU
- `loading="eager"`: Ladda direkt, ingen lazy-loading
- `overflow: hidden`: Inga scrollbars

## Andringar i appen (kod)

### Steg 1: Lagg till `overflow: hidden` pa body i TV-mode
Forhindra att Chromecast-browsern visar scrollbars eller tillatir scrollning.

**Fil:** `src/components/BrewingDashboard.tsx`
- Lagg till en `useEffect` som satter `document.body.style.overflow = 'hidden'` och `document.documentElement.style.overflow = 'hidden'` nar `isTvMode` ar aktivt.

### Steg 2: Inaktivera PWA service worker i TV-mode / iframe
Service workern (VitePWA) gor cache-hantering och bakgrundsarbete som ar onodigt pa Chromecast. Den tar CPU och minne.

**Fil:** `src/main.tsx`
- Avregistrera eventuella service workers nar sidan laddas i en iframe eller TV-mode.
- Lagg till check: `if (window.self !== window.top || new URLSearchParams(window.location.search).get('tv') === 'true')` -- avregistrera SW.

### Steg 3: Inaktivera Toaster/Sonner i TV-mode
Toast-notifikationer ar onodiga pa TV:n och tar DOM-resurser.

**Fil:** `src/App.tsx`
- Villkora `<Toaster />` och `<Sonner />` -- rendera dem inte nar `isTvMode` ar aktivt.

### Steg 4: Inaktivera TooltipProvider i TV-mode
Tooltips anvands aldrig pa TV (ingen muspekare). TooltipProvider lyssnar pa hover-events i onodan.

**Fil:** `src/App.tsx`
- I TV-mode, rendera bara children utan `<TooltipProvider>`.

### Steg 5: Lagg till meta-tag for att forhindra zoom/scroll
Redan delvis pa plats i `index.html`, men kan forstarkas med:

**Fil:** `index.html`
- Lagg till `<style>` i head som satter `html, body { overflow: hidden; }` -- detta ar en fallback om JS inte hinner ladda.

## Teknisk sammanfattning

| Optimering | Var | Effekt |
|-----------|-----|--------|
| `?tv=true` i URL | Casting-app | Aktiverar alla TV-optimeringar |
| Iframe 100% storlek | Casting-app | Undvik skalning |
| `scrolling="no"` | Casting-app | Ingen scroll-overhead |
| Body overflow hidden | BrewingDashboard | Forhindra scrollbars |
| Avregistrera SW | main.tsx | Sparar minne och CPU |
| Inaktivera Toaster | App.tsx | Sparar DOM-noder |
| Inaktivera Tooltips | App.tsx | Sparar event-lyssnare |

## Resultat
Chromecast far en renare, lattare sida utan onodiga bakgrundsprocesser, event-lyssnare och DOM-element.

