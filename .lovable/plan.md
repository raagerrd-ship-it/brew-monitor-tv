

## Analysis: Current Flow & Bottlenecks

```text
Current predictive swap timeline (worst case):
────────────────────────────────────────────────────────
-60s   Cron runs sync-sonos-now-playing (Phase 1+2+3)
       → May or may not populate next_track_* fields
       → Phase 3 (next images) takes 2-8s
       
-15s   Eager sync: client triggers FULL sync-sonos-now-playing
       → Token refresh + Sonos API × 2 + image processing
       → Total: 3-15s (often too slow for the 3.5s deadline!)
       
-10s   Predictive timer scheduled
       
-3.5s  SWAP POINT: needs next_track_name + images ready
       → Often missing because eager sync hasn't finished
       → Falls back to pollForNewTrack (another 2s+ per retry)
```

### Root cause
The 5-second `sonos-playback-status` poll **already fetches `playbackMetadata`** from Sonos (which contains `nextItem`) but **throws it away** — it only returns current track info. This means the client has no idea what the next track is until either cron or eager sync populates the DB.

## Plan: 3 Changes

### 1. Return next track data from `sonos-playback-status` (server)
The metadata response from Sonos already contains `nextItem`. Add `nextTrackName`, `nextArtistName`, `nextAlbumArtUrl` to the response. **Zero extra API calls — data is already there.**

File: `supabase/functions/sonos-playback-status/index.ts`

### 2. Client stores next-track metadata from every 5s poll (client)
When `useSonosClientPolling` receives poll data with `nextTrackName`, merge it into state immediately. This means by the time we're 15s from the end, `next_track_name` is already in state (populated continuously every 5s).

File: `src/components/sonos/hooks/useSonosClientPolling.ts`

### 3. Eager sync becomes image-only trigger (client)
At 15s remaining, instead of checking for `next_track_name` (which is already there from polling), check for `next_bg_image_url`. If images are missing, trigger sync with the existing `triggerServerSync()` — but only for image processing. The metadata is already in place.

File: `src/components/sonos/hooks/useSonosPlaybackTicker.ts`

```text
Improved timeline:
────────────────────────────────────────────────────────
-∞     Every 5s poll: next_track_name populated from Sonos API
       → Client always knows what's coming next
       
-15s   Check: images missing? → trigger sync (image processing only)
       → Realtime delivers next_bg/widget URLs
       → Browser preloads immediately on arrival
       
-3.5s  SWAP POINT: text + images ready → instant transition
       → No polling fallback needed
```

### Technical details

**sonos-playback-status** — add 3 fields to response:
```typescript
const nextTrack = metadata?.nextItem?.track;
return { 
  ...existing,
  nextTrackName: nextTrack?.name || null,
  nextArtistName: nextTrack?.artist?.name || null,
  nextAlbumArtUrl: nextTrack?.imageUrl || null,
};
```

**useSonosClientPolling** — merge next-track data from poll:
```typescript
// In same-track update path:
const nextChanged = data.nextTrackName && data.nextTrackName !== prev.next_track_name;
if (nextChanged) {
  return { ...prev, next_track_name: data.nextTrackName, 
           next_artist_name: data.nextArtistName,
           next_album_art_url: data.nextAlbumArtUrl };
}
```

**useSonosPlaybackTicker** — eager sync checks images, not metadata:
```typescript
// At 15s remaining:
if (!current?.next_bg_image_url && current?.next_track_name) {
  // Have metadata but no images — trigger image processing
  triggerServerSync();
}
```

