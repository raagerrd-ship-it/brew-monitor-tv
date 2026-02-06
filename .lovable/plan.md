
# Analys: Varfor sidan hanger sig vid latbyte

## Identifierade orsaker

### 1. AbortController gor ingenting (KRITISKT)
I `useSonosTrackTransition.ts` rad 78-83 skapas en `AbortController` med 8 sekunders timeout, men den skickas aldrig vidare till `supabase.functions.invoke()`. Supabase JS-klienten stodjer inte `signal` via options-objektet pa det sattet. Det betyder att om edge-funktionen hangs (t.ex. Sonos API svarar sakta), vantar browsern i upp till 60+ sekunder utan att avbryta.

### 2. Edge-funktionen gor manga sekventiella anrop
`sonos-now-playing` edge-funktionen gor upp till 4-6 natluftsanrop i serie:
- 2x DB-querys (tokens + settings)
- Eventuell token-refresh mot Sonos OAuth
- 2x Sonos API (metadata + playback) parallellt
- Eventuellt Spotify token + Spotify track API

Om Sonos API ar tragt (vanligt), kan hela anropet ta 5-15 sekunder. Under den tiden blockeras pollingintervallet.

### 3. Ingen skydd mot overlappande anrop
Om `fetchNowPlaying` tar 8 sekunder och polling-intervallet ar 5 sekunder, startas ett nytt anrop innan det forra avslutas. Pa Chromecast med begransad bandbredd och CPU leder detta till att anrop staplas pa varandra.

### 4. State-kaskad vid latbyte (6+ re-renders)
Nar en lat byter triggas foljande state-uppdateringar i snabb foljd:
1. `setNowPlaying(data)` 
2. `setLocalProgress(data.position_ms)`
3. `setImageLoaded(false)`
4. `setImageError(false)`
5. `setAlbumArtUrl(url)` (via onAlbumArtChange callback)
6. `setPreloadedAlbumArt(url)` (efter preload timeout)

Varje uppdatering triggar en re-render av hela BrewingDashboard inklusive alla BrewCards och grafer.

### 5. Version-check gor tung krypto-operation
`useVersionCheck` gor `fetch('/?_=...')` + `crypto.subtle.digest('SHA-256', ...)` var 60:e sekund. Om detta sammanfaller med ett latbyte pa Chromecast-hardvara kan det bidra till frysningen.

## Atgardsplan

### Steg 1: Fixa AbortController sa timeout faktiskt fungerar
Ersatt `supabase.functions.invoke()` med en ratt `fetch()`-anrop som accepterar AbortSignal, eller wrappa invoke i en Promise.race med timeout.

**Fil:** `src/components/sonos/hooks/useSonosTrackTransition.ts`

```typescript
const fetchNowPlaying = useCallback(async () => {
  if (isFetchingRef.current) return; // Guard mot overlapp
  isFetchingRef.current = true;
  
  try {
    const response = await Promise.race([
      supabase.functions.invoke('sonos-now-playing', { body: {} }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 8000)
      )
    ]);
    // ... hantera svar
  } catch (error) {
    // Timeout eller natverksfel - tyst hantering
  } finally {
    isFetchingRef.current = false;
  }
}, [...]);
```

### Steg 2: Lagg till guard mot overlappande anrop
Lagg till en `isFetchingRef` som forhindrar att ett nytt `fetchNowPlaying` startas om det forra inte avslutas.

### Steg 3: Batcha state-uppdateringar vid latbyte
Samla alla state-uppdateringar i en enda uppdatering istallet for 4-6 separata `setState`-anrop. React 18 batchar automatiskt i event handlers, men INTE i async callbacks.

**Fil:** `src/components/sonos/hooks/useSonosTrackTransition.ts`

Anropa `ReactDOM.flushSync` eller batcha manuellt genom att anvanda ett enda state-objekt istallet for separata states.

### Steg 4: Debounca onAlbumArtChange-callbacken
Oka debounce fran 100ms till 500ms for att ge hardvaran tid att stabilisera sig.

### Steg 5: Inaktivera version-check i TV-mode
Version-checken gor onodigt tunga operationer (fetch + SHA-256 hash) som kan sammanfalla med latbyten.

**Fil:** `src/components/BrewingDashboard.tsx`

Minska frekvensen i TV-mode till var 5:e minut istallet for var minut.

## Teknisk sammanfattning

| Problem | Atgard | Fil |
|---------|--------|-----|
| AbortController gor inget | Anvand Promise.race med timeout | useSonosTrackTransition.ts |
| Overlappande anrop | Lagg till isFetchingRef guard | useSonosTrackTransition.ts |
| 6+ re-renders vid latbyte | Batcha state-uppdateringar | useSonosTrackTransition.ts |
| Snabb albumart-debounce | Oka fran 100ms till 500ms | BrewingDashboard.tsx |
| Version-check i TV-mode | Oka intervall till 5 min | BrewingDashboard.tsx |

Dessa andringar fokuserar pa att forhindra att asynkrona operationer overlappar varandra och att minska antalet re-renders vid latbyten - de tva huvudsakliga orsakerna till frysningen.
