

## ✅ Sonos Cloud API eliminerad — 100% UPnP via Cast Away

### Genomfört
- `sonos-playback-status`: omskriven till ren DB-read (~50ms istf ~800ms)
- `sync-sonos-now-playing`: omskriven, tar bort all Sonos Cloud API-logik, behåller image-processing
- `sonos-auth`: förenklad till bara `disconnect` + `status` (inga OAuth-flöden)
- `sonos-groups/index.ts`: borttagen (ingen konsument)
- `_shared/sonos-token.ts`: borttagen
- `_shared/sonos-group-recovery.ts`: borttagen
- `SonosCallback.tsx`: borttagen + route borttagen från App.tsx

### Resultat
- 0 anrop till Sonos Cloud API
- Inga OAuth-tokens att refresha
- Inga Sonos rate limits
- Cast Away (UPnP bridge) är SSOT
