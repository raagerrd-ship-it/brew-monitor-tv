

## Analysis

After reviewing the code, network requests, and edge function logs, I've identified several issues introduced during the refactoring:

### Problem 1: `sonos-playback-status` frequently times out
Network logs show ~40% of requests abort before the 8s timeout. The function makes 3 parallel DB queries THEN 2 Sonos API calls sequentially. When the Sonos API is slow, the client gets no data for 10-15 seconds.

### Problem 2: Inconsistent cache-busters on image URLs
The last edit only changed `backgroundExists` to use `fileTs`, but `uploadBackground` still uses `Date.now()`. This means:
- Upload returns `?v=1772273400000` (upload moment)
- Cache check returns `?v=1772273364357` (file metadata timestamp)
- These differ, potentially causing the browser to re-download the same image

### Problem 3: Realtime art URL delivery has an unnecessary gate
`useSonosRealtime` ignores all realtime updates for 15s after a track change, except bg_image_url. But `widget_art_url` (which the widget uses for display) is also blocked during cooldown, meaning the widget can't show new art for 15s after a track change via realtime.

### Problem 4: Client polling runs even when paused (unnecessary load)
`useSonosClientPolling` skips PAUSED state, but `useSonosPlaybackTicker` still ticks during PAUSED (just doesn't increment). Multiple simultaneous requests (regular + predictive polls) compound the edge function load.

---

## Implementation Plan

### Step 1: Fix `uploadBackground` cache-buster consistency
In `supabase/functions/_shared/sonos-storage.ts`, change `uploadBackground` to also use the upload timestamp consistently. After the `upload()` call succeeds, list the file to get its `updated_at` and use that as cache-buster (same as `backgroundExists`). This ensures URLs are identical whether from upload or cache check.

### Step 2: Allow `widget_art_url` through during realtime cooldown
In `src/components/sonos/hooks/useSonosRealtime.ts`, within the 15s cooldown block (line 62), also merge `widget_art_url` alongside `bg_image_url` when the track name matches. Currently only `bg_image_url` passes through, so widget art is delayed by up to 15s.

### Step 3: Optimize `sonos-playback-status` edge function response time
In `supabase/functions/sonos-playback-status/index.ts`:
- Remove the `nowPlayingResult` DB query entirely. The client already gets art URLs from init + realtime. The playback-status endpoint only needs to return Sonos API data (state, position, track metadata). This removes one DB call and reduces response payload.
- This cuts the function from 3 parallel DB queries + 2 API calls down to 2 DB queries + 2 API calls.

### Step 4: Make client resilient to frequent timeouts
In `src/components/sonos/hooks/useSonosClientPolling.ts`:
- Remove the background sync safeguard block at the bottom (lines ~130-145). This logic runs on every successful poll and makes unnecessary comparisons. The init + realtime already handle background sync.
- This simplifies the poll handler and removes a source of unnecessary state updates.

