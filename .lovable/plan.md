

# Bridge-driven Sonos-synk för snabbare bakgrundsbyten

## Problemet idag

Nuvarande flöde: **Klient pollar → Edge function → Sonos Cloud API → DB → Realtime → UI**

Latensen på ~10 sekunder beror på:
1. Client poll var 5:e sekund
2. Edge function anropar Sonos Cloud API (2-5s latens)
3. Bildprocessning (resolveBackgroundAndWidget) tar 2-5s
4. Sedan skrivs till DB → Realtime → klient

## Lösning: Bridge pushar metadata direkt

Din Cast Away Web-bridge har redan UPnP-eventprenumeration på Sonos med ~250ms latens. Den vet om låtbyten *omedelbart*. 

```text
┌─────────────┐  UPnP event   ┌──────────────┐  POST /push   ┌──────────────┐
│   Sonos     │──────────────▶│  Bridge      │──────────────▶│  Edge Func   │
│   Speaker   │   ~50ms       │  (lokal)     │   ~100ms      │  sonos-push  │
└─────────────┘               └──────────────┘               └──────┬───────┘
                                                                     │
                                                              Skriver DB
                                                              (sonos_now_playing)
                                                                     │
                                                              Realtime ──▶ UI
                                                              ~200ms total
```

**Total latens: ~300-500ms** från låtbyte till text-uppdatering i UI (vs ~10s idag).

## Implementationsplan

### Steg 1: Ny edge function `sonos-bridge-push`
Tar emot metadata-payload från bridge:n och skriver direkt till `sonos_now_playing`. Autentiseras med en delad hemlig nyckel (secret).

Payload från bridge:
```json
{
  "trackName": "...",
  "artistName": "...",
  "albumName": "...",
  "albumArtUri": "http://192.168.x.x/...",
  "nextTrackName": "...",
  "nextArtistName": "...",
  "playbackState": "PLAYBACK_STATE_PLAYING",
  "positionMillis": 12345,
  "durationMillis": 234567
}
```

Edge function:
- Validerar secret header
- Skriver metadata till `sonos_now_playing` (Phase 1 — text direkt)
- Triggar bildprocessning asynkront (resolveAlbumArt + resolveBackgroundAndWidget) → Phase 2 skrivning
- Hanterar track_seq monotoniskt som idag

### Steg 2: Bridge-tillägg (i Cast Away Web)
Lägg till en POST-request i `handleSonosUPnPEvent()` som skickar metadata till edge function vid låtbyten.

```javascript
// I bridge/index.js — efter broadcastSSE(eventData)
if (eventData.trackName !== lastPushedTrack) {
  lastPushedTrack = eventData.trackName;
  fetch(`${SUPABASE_URL}/functions/v1/sonos-bridge-push`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ANON_KEY}`,
      'X-Bridge-Secret': BRIDGE_SECRET,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(eventData)
  }).catch(() => {});
}
```

### Steg 3: Klient-anpassningar (brew-monitor)
- `useSonosClientPolling`: Öka poll-intervall från 5s → 15s (bridge driver nu track changes)
- `sync-sonos-now-playing` cron: Behåll som fallback men kan köras glesare
- Ingen ändring i Realtime-koden — den tar redan emot DB-ändringar

### Steg 4: Secret-hantering
- Lägg till `SONOS_BRIDGE_SECRET` som edge function-secret
- Bridge:n läser samma secret från sin `.env`

## Vad detta ger

| Aspekt | Idag | Med bridge-push |
|--------|------|-----------------|
| Låtbyte → text i UI | ~10s | ~300-500ms |
| Låtbyte → bakgrundsbild | ~10-15s | ~3-5s (bildprocessning) |
| Cloud API-anrop | Var 5:e sek | Fallback var 30-60s |
| Sonos API-kvot | Hög belastning | Minimal |

## Filer att ändra

1. **Nytt:** `supabase/functions/sonos-bridge-push/index.ts` — tar emot push från bridge
2. **Ändra:** Cast Away Web `bridge/index.js` — skicka POST vid låtbyte
3. **Ändra:** `src/components/sonos/hooks/types.ts` — öka PLAYBACK_POLL_INTERVAL
4. **Secret:** `SONOS_BRIDGE_SECRET` via add_secret

