
## Lägg till polling-fallback för timern (som Sonos)

### Bakgrund
Sonos-widgeten fungerar pålitligt på TV:n tack vare sin 5-sekunders polling via `useSonosClientPolling`. Timern saknar denna mekanism -- den hämtar data en gång vid mount och förlitar sig sedan enbart på Realtime-events, som ofta tappas på TV-hårdvara.

### Lösning
Lägg till en 60-sekunders polling i `useExternalTimer` som kontrollerar `cached_external_timer`-tabellen. Samma mönster som Sonos: en `setInterval` i `useEffect` som körs oavsett Realtime-status.

### Teknisk ändring

**Fil: `src/hooks/use-external-timer.ts`**

Uppdatera `useEffect`-blocket (rad 320-332) som hanterar initial fetch:

```text
// Innan:
useEffect(() => {
  fetchFromCache();

  if (onCachedTimerChangeRef) {
    onCachedTimerChangeRef.current = () => fetchFromCache();
  }
  return () => {
    if (onCachedTimerChangeRef) onCachedTimerChangeRef.current = null;
  };
}, [fetchFromCache, onCachedTimerChangeRef]);

// Efter:
useEffect(() => {
  fetchFromCache();

  if (onCachedTimerChangeRef) {
    onCachedTimerChangeRef.current = () => fetchFromCache();
  }

  // Polling fallback (60s) — same pattern as Sonos client polling
  // Ensures TV picks up new timers even if Realtime connection is lost
  const pollInterval = setInterval(() => {
    fetchFromCache();
  }, 60_000);

  return () => {
    clearInterval(pollInterval);
    if (onCachedTimerChangeRef) onCachedTimerChangeRef.current = null;
  };
}, [fetchFromCache, onCachedTimerChangeRef]);
```

### Resultat
- TV:n kontrollerar var 60:e sekund om en ny timer har startats i databasen
- Max 60 sekunders fördröjning innan timern visas (jämfört med att aldrig visas utan sidladdning)
- Realtime fungerar fortfarande som snabbare kanal när den är tillgänglig
- Samma polling-frekvens som Sonos cron: minimal påverkan på TV-hårdvara
- Ingen ändring behövs i edge-funktionen eller databasen
