

# Sonos-optimeringar: tre förbättringar

## 1. Preload-label race condition — utöka polling-fönster

**Problem**: `getPreloadLabel` pollar max 6×150ms = 900ms. Om Realtime-uppdateringen med `next_bg_cached` tar längre tid loggas "redo" istället för "[Sparad]" eller "[Genererad X ms]".

**Fix**: Öka till 10 försök á 300ms (3s totalt). Preloaden triggas ~11s innan låtbyte, så 3s fönster är väl inom marginal.

**Fil**: `src/components/sonos/hooks/useSonosPlaybackTicker.ts`
- Ändra `attempts >= 6` → `attempts >= 10`
- Ändra `window.setTimeout(logReady, 150)` → `window.setTimeout(logReady, 300)`

---

## 2. Visibility-hookens dependency array — minska onödiga utvärderingar

**Problem**: Paus-effekten har `nowPlaying` i sin dependency array, vilket orsakar omvärderingar vid varje position/metadata-uppdatering — inte bara vid paus-state-ändringar.

**Fix**: Byt `nowPlaying` mot ett mer specifikt beroende som bara ändras vid relevanta state-ändringar. Använd en `updateCounter`-ref som bara bumps vid paus-state-ändring.

**Fil**: `src/components/sonos/hooks/useSonosVisibility.ts`
- Ersätt `nowPlaying` i dep-arrayen med `nowPlaying?.playback_state` och `nowPlaying?.track_name` — det är dessa som avgör om paus-logiken ska omvärderas.

---

## 3. Watchdog-throttle — minska onödig nätverkstrafik

**Problem**: Watchdogen triggar `triggerServerSync` + `fetchNowPlayingImages` var ~10:e sekund (`next % 10000 < 1000`) när ingen bakgrund finns. Detta kan ge onödig belastning.

**Fix**: Lägg till en `lastWatchdogRef` som trackar senaste watchdog-anropet och kräver minst 30s mellanrum.

**Fil**: `src/components/sonos/hooks/useSonosPlaybackTicker.ts`
- Ny ref `lastWatchdogRef` i interface + parameter
- Kontrollera `Date.now() - lastWatchdogRef.current > 30_000` innan watchdog-fetch
- Uppdatera `lastWatchdogRef.current = Date.now()` efter anrop

Alternativt: hantera ref:en lokalt inuti effekten (enklare, ingen interface-ändring).

