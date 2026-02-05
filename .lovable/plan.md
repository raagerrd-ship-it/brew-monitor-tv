
# Plan: Förhindra TV-krasch med Albumartbakgrund

## Problemanalys

Utifrån sessionsreplayet och koden har jag identifierat följande potentiella kraschorsaker:

1. **Ohanteradepromise-fel i async-funktioner** - Edge function-anropen i SonosWidget och useSonosTrackTransition saknar fullständig felhantering
2. **Bildladdningsfel utan recovery** - När albumart-bilden ändras snabbt kan det orsaka minnesläckor
3. **CSS filter på stora bilder** - `blur(8px)` på en bakgrundsbild som täcker hela skärmen är CPU-intensivt på Chromecast
4. **Ingen preloading av bakgrundsbild** - Bilden laddas direkt som bakgrund utan att först laddas i minnet

## Åtgärder

### 1. Ta bort blur-filter från bakgrundsbilden
CSS blur-filter på stora bilder är extremt resurskrävande. Vi ersätter det med en mörkare overlay istället.

**Fil:** `src/components/BrewingDashboard.tsx`
```tsx
// Ändra från:
style={{ 
  backgroundImage: `url(${albumArtUrl})`,
  backgroundSize: 'cover',
  backgroundPosition: 'center center',
  filter: 'blur(8px)',  // Ta bort detta
  opacity: 0.3,
}}

// Till:
style={{ 
  backgroundImage: `url(${albumArtUrl})`,
  backgroundSize: 'cover',
  backgroundPosition: 'center center',
  opacity: 0.2,  // Minska opacitet istället för blur
}}
```

### 2. Lägg till robust felhantering i fetchNowPlaying
Wrap alla async-operationer i try-catch för att förhindra ohanteradefel som kan krascha appen.

**Fil:** `src/components/sonos/hooks/useSonosTrackTransition.ts`
```tsx
const fetchNowPlaying = useCallback(async () => {
  try {
    const response = await supabase.functions.invoke('sonos-now-playing');
    if (response.data && !response.error) {
      // ... existing logic
    }
  } catch (error) {
    // Logga men krascha inte
    console.error('[Sonos] Failed to fetch now playing:', error);
  }
}, [/* deps */]);
```

### 3. Preloada bakgrundsbilden innan visning
Skapa en Image-instans för att ladda bilden i minnet innan den används som CSS-bakgrund.

**Fil:** `src/components/BrewingDashboard.tsx`
```tsx
// Ny state för preloaded bild
const [preloadedAlbumArt, setPreloadedAlbumArt] = useState<string | null>(null);

// Preload-logik i handleAlbumArtChange
const handleAlbumArtChange = useCallback((url: string | null) => {
  if (!url) {
    setPreloadedAlbumArt(null);
    return;
  }
  
  // Preloada bilden innan den visas
  const img = new Image();
  img.onload = () => setPreloadedAlbumArt(url);
  img.onerror = () => setPreloadedAlbumArt(null);
  img.src = url;
}, []);
```

### 4. Skydda mot snabba bildbyten (debounce)
Förhindra att flera bildbyten sker samtidigt genom att throttla uppdateringar.

**Fil:** `src/components/BrewingDashboard.tsx`
```tsx
const preloadTimeoutRef = useRef<number | null>(null);

const handleAlbumArtChange = useCallback((url: string | null) => {
  // Rensa tidigare timeout
  if (preloadTimeoutRef.current) {
    clearTimeout(preloadTimeoutRef.current);
  }
  
  if (!url) {
    setPreloadedAlbumArt(null);
    return;
  }
  
  // Debounce för att förhindra snabba byten
  preloadTimeoutRef.current = window.setTimeout(() => {
    const img = new Image();
    img.onload = () => setPreloadedAlbumArt(url);
    img.onerror = () => setPreloadedAlbumArt(null);
    img.src = url;
  }, 100);
}, []);
```

### 5. Förbättra felhantering i SonosWidget
Lägg till ytterligare skydd i komponenten.

**Fil:** `src/components/sonos/SonosWidget.tsx`
```tsx
// Wrap alla async-operationer
const checkConnection = async () => {
  try {
    const { data: settings, error: settingsError } = await (supabase as any)
      .from('sonos_settings')
      .select('show_on_dashboard, selected_group_id')
      .limit(1)
      .maybeSingle();
    // ... rest of logic
  } catch (error) {
    console.error('[Sonos] Failed to check connection:', error);
    setIsConnected(false);
  }
};
```

### 6. Använd contain: strict på bakgrundscontainern
Isolera bakgrundsbilden från övriga renderingar.

**Fil:** `src/components/BrewingDashboard.tsx`
```tsx
{isTvMode && preloadedAlbumArt && (
  <div 
    className="absolute inset-0 pointer-events-none"
    style={{ 
      backgroundImage: `url(${preloadedAlbumArt})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center center',
      opacity: 0.2,
      contain: 'strict',  // Isolera rendering
    }}
  />
)}
```

## Sammanfattning av ändringar

| Fil | Ändring |
|-----|---------|
| `src/components/BrewingDashboard.tsx` | Ta bort blur, lägg till preloading med debounce, använd contain: strict |
| `src/components/sonos/hooks/useSonosTrackTransition.ts` | Förbättrad try-catch i alla async-funktioner |
| `src/components/sonos/SonosWidget.tsx` | Förbättrad felhantering i checkConnection |

## Tekniska detaljer

**Varför blur(8px) är problematiskt på TV:**
- CSS blur kräver att varje pixel bearbetas med en Gaussian kernel
- På 720p/1080p bilder betyder det miljontals operationer per frame
- Chromecast har begränsad GPU-kapacitet för CSS-filter

**Varför preloading hjälper:**
- Förhindrar "torn" rendering där bilden delvis visas
- Ger appen möjlighet att hantera laddningsfel graciöst
- Minskar risken för minnesläckor vid snabba byten

**Varför contain: strict hjälper:**
- Isolerar bakgrundscontainern från övriga DOM-ändringar
- Förhindrar att bakgrundsbyten triggar omrendering av hela appen
- Optimerar GPU-lager hantering
