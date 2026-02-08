

## Dölj Sonos-widget vid "TV Audio"

När Sonos spelar upp TV-ljud (track_name = "TV Audio") ska widgeten behandlas som inaktiv och döljas, precis som vid IDLE-status.

### Ändring

**`src/components/sonos/hooks/useSonosVisibility.ts`**

Utöka `isInactive`-villkoret till att även inkludera fallet där `track_name` är "TV Audio":

```typescript
const isInactive = !isConnected || !showWidget || !nowPlaying?.track_name || nowPlaying.track_name === 'TV Audio';
```

Detta gör att widgeten döljs omedelbart (utan grace period) när "TV Audio" detekteras, och bakgrundsbilden rensas bort.

