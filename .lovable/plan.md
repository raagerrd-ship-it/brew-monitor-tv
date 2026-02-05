
# Optimera Sonos-widget med smart progress och minimal polling

## Sammanfattning
Ersätter JavaScript-baserad progress-interpolering med CSS-animation och smarta timers för att eliminera alla onödiga intervaller.

## Förändringar

### 1. Progress-bar med CSS-animation
Istället för att uppdatera progress via JavaScript var 2:e sekund, använder vi CSS-animation som körs helt på GPU:n.

- Beräkna `animation-duration` baserat på kvarvarande tid
- Starta animationen från nuvarande position
- Ingen JavaScript-overhead under uppspelning

### 2. Ta bort progress-intervallet
Intervallet i `useSonosTrackTransition` som tickar var 2:e sekund tas bort helt.

### 3. Smart track-end timer
Istället för att polla för att upptäcka låtslut:
- Beräkna när låten slutar baserat på `duration_ms - position_ms`
- Sätt en `setTimeout` som triggar preload ~15s innan slut
- Sätt en till för att hämta nästa låt ~3s innan slut

### 4. Polling endast för manuella byten
Behåll 10s polling som backup för att fånga:
- Användaren byter låt manuellt
- Pause/play
- Volymändringar som påverkar state

## Tekniska detaljer

**SonosWidget.tsx - CSS-animerad progress:**
```tsx
// Beräkna animation baserat på serverdata
const remainingMs = (nowPlaying.duration_ms ?? 0) - (localProgress ?? 0);
const remainingPercent = 100 - progressPercent;

<div 
  className="h-full rounded-full"
  style={{
    width: `${progressPercent}%`,
    background: 'rgba(255, 255, 255, 0.9)',
    animation: nowPlaying.playback_state === 'PLAYBACK_STATE_PLAYING'
      ? `progress-grow ${remainingMs}ms linear forwards`
      : 'none',
  }}
/>
```

**useSonosTrackTransition.ts - Ersätt interval med setTimeout:**
```typescript
// Ta bort setInterval helt
// Använd setTimeout baserat på beräknad sluttid
useEffect(() => {
  const current = nowPlayingRef.current;
  if (!current?.duration_ms) return;
  
  const remaining = current.duration_ms - (current.position_ms ?? 0);
  
  // Preload 15s innan slut
  const preloadTimer = setTimeout(() => {
    preloadNextTrack();
  }, Math.max(0, remaining - 15000));
  
  // Hämta ny data 3s innan slut
  const fetchTimer = setTimeout(() => {
    fetchNowPlaying();
  }, Math.max(0, remaining - 3000));
  
  return () => {
    clearTimeout(preloadTimer);
    clearTimeout(fetchTimer);
  };
}, [nowPlaying?.track_name, nowPlaying?.position_ms]);
```

## Resultat
- **0 JavaScript-intervaller** under normal uppspelning
- **Endast 1 nätverksanrop var 10:e sekund** som backup
- Progress-bar körs helt på GPU via CSS
- Automatisk preload baserat på låtlängd
