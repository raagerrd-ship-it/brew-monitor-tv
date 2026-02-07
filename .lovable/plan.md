

## Fix: Widget disappears after track change

### Root Cause
`pollForNewTrack` correctly updates state with new track metadata and swapped images, then immediately calls `fetchNowPlaying()` (line 124). But the database still contains the **previous track's data** because the 60s cron job hasn't synced yet. `fetchNowPlaying` blindly overwrites the entire `nowPlaying` state with this stale data, causing the widget to show the old track momentarily and then hide (since that track is no longer playing).

### Fix

**`src/components/sonos/SonosWidget.tsx`**

Remove the `fetchNowPlaying()` call on line 124 (inside the `trackChanged` branch of `pollForNewTrack`). The predictive poll already provides all needed text metadata (track, artist, album, playback state, position) and the images are swapped from pre-fetched state. The next regular 5s poll or realtime event will naturally fill in any missing data (like `duration_ms` for the new track) without the destructive overwrite.

**`src/components/sonos/hooks/useSonosTrackTransition.ts`**

No changes needed, but worth noting: `fetchNowPlaying` uses `setNowPlaying(data)` (direct set, not functional update), which is why it destroys the carefully-constructed state from the predictive poll.

### What about `duration_ms`?
The playback-status API doesn't return duration. After removing the immediate `fetchNowPlaying`, the widget will use the old track's `duration_ms` until the next realtime update or DB sync. The progress bar may be slightly off for a few seconds, but the widget won't crash. This is a much better tradeoff than the widget disappearing entirely.

