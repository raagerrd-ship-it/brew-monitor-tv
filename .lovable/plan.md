

## Analys

Problemet: Om det prediktiva låtbytet misslyckas (nätverksfel, timeout, etc.) finns ingen retry — widgeten fastnar på gamla låten/bakgrunden.

Nuvarande flöde:
1. Ticker schemalägger swap vid `remaining ≤ 10s`
2. Swap triggar `handleTrackChange` (om next_* finns) eller `pollForNewTrack` (max 15 retries, 2s intervall)
3. `handleTrackChange` triggar server-sync + DB-fetch om inga bilder finns förladdat
4. **Men**: om `handleTrackChange` i sin tur misslyckas med att hämta bilder (server-sync timeout, fetch-fel), finns ingen retry — bakgrunden blir kvar på förra låten

Det finns också ett problem: om `pollForNewTrack` misslyckas helt (catch-blocket sväljer felet), eller om `localProgressRef` passerar `duration` utan att nytt track-namn dyker upp, sker inget mer.

### Plan: Lägg till verifierings-retry efter låtbyte

Enklaste och mest robusta lösningen: efter att `handleTrackChange` körts, verifiera inom några sekunder att bakgrundsbilden faktiskt uppdaterades. Om inte → försök igen.

**Fil: `src/components/sonos/hooks/useSonosTrackChange.ts`**

Lägg till en verifierings-loop i `handleTrackChange`:
- Efter att track-bytet gjorts (och eventuell server-sync + fetch), vänta 3s och kontrollera om `bgSentRef` faktiskt ändrats
- Om bakgrunden fortfarande är samma som innan bytet → kör server-sync + DB-fetch igen
- Max 3 retries med 3s mellanrum
- Logga varje retry via `tvDebug`

Konkret ändring i den asynkrona fallback-blocket (rad ~67-88):
```
// Nuvarande: en enda sync+fetch, inget retry
// Nytt: retry-loop som kontrollerar att bg verkligen uppdaterats
const prevBg = bgSentRef.current;
for (let attempt = 0; attempt < 3; attempt++) {
  if (attempt > 0) await new Promise(r => setTimeout(r, 3000));
  if (bgSentRef.current !== prevBg) break; // bg uppdaterad, klart
  try {
    await triggerServerSync();
    const result = await fetchNowPlayingImages();
    if (result?.bgImageUrl && result.bgImageUrl !== prevBg) {
      // Applicera ny bakgrund
      pushToBgBuffer(...)
      onAlbumArtChangeRef.current?.(result.bgImageUrl, trackName);
      bgSentRef.current = result.bgImageUrl;
      // Uppdatera state
      break;
    }
  } catch { /* fortsätt till nästa attempt */ }
  tvDebug('sonos', `🔄 Bg-retry ${attempt + 1}/3`);
}
```

Dessutom: lägg till samma verifiering i det **preloaded**-fallet (rad ~60). Om `nextBg` var null men `nextWidget` fanns → trigga server-sync för bg.

**Fil: `src/components/sonos/hooks/useSonosPlaybackTicker.ts`**

Lägg till en safety-net i tickern: om progress passerar `duration` (remaining ≤ 0) och inget trackbyte skedde (dvs `trackChangedAtRef` är äldre än 15s), trigga en poll:
```
if (remaining <= 0 && !predictiveScheduledRef.current && msSinceTC > 15000) {
  predictiveScheduledRef.current = true;
  pollForNewTrack(PREDICTIVE_MAX_RETRIES);
}
```

Detta fångar fallet där den prediktiva timern aldrig triggades (t.ex. om effect-cleanup körde mitt i).

### Sammanfattning

Två ändringar:
1. **useSonosTrackChange.ts**: Retry-loop (max 3×3s) i fallback-flödet som verifierar att bakgrunden faktiskt uppdaterades
2. **useSonosPlaybackTicker.ts**: Safety-net poll när remaining ≤ 0 utan att trackbyte skett

