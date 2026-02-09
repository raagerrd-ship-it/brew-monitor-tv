
# Ta bort bakgrundsbild nar Sonos-widgeten stangs av

## Problem

Nar widgeten doljs (IDLE/TV Audio/etc) anropas `onAlbumArtChange(null)` fran `useSonosVisibility.clearAll()`. Men i `BrewingDashboard.tsx` ignoreras `null`-varden pa rad 55:

```
if (!url) return; // Never clear - keep last image visible
```

Darfor ligger den sista bakgrundsbilden kvar aven efter att widgeten forsvunnit.

## Losning

### `src/components/BrewingDashboard.tsx`

Andra `handleAlbumArtChange` sa att `null` rensar bakgrunden istallet for att ignoreras:

```typescript
const handleAlbumArtChange = useCallback((url: string | null) => {
  if (!url) {
    setVisibleBgUrl(null);
    visibleBgBaseRef.current = null;
    preloadingUrlRef.current = null;
    return;
  }
  // ... resten oforandrad
}, []);
```

Det ar allt - en andring i en fil. `clearAll()` i visibility-hooken skickar redan `null`, sa det enda som behovs ar att dashboarden faktiskt agerar pa det.
