

## Fix: Prefetch Indicator Never Green + Background Not Updating

### Problem 1: Prefetch dot stuck on orange
The prefetch status goes from "fetching" (red) to "ready" (orange) when the server sync completes. The transition to "loaded" (green) relies on hidden `<img>` elements for `next_widget_art_url` / `next_bg_image_url` firing their `onLoad` callback. But when Sonos doesn't provide next-track info (shuffle, radio, end of queue), these URLs are `null`, the `<img>` elements never render, and `onLoad` never fires.

**Fix:** After the sync completes and status is set to "ready", add logic that transitions to "loaded" when there are no next-track URLs to preload. This can be done with a `useEffect` that watches `prefetchStatus` and the `next_*` URLs -- if status is "ready" and no prefetch images exist, immediately set to "loaded".

### Problem 2: Background image not updating at track change
The log `"Skipped bg update -- bgSent still in buffer"` reveals the issue. In `handleNewImageLoaded`, the condition checks if `bgSentRef.current` is still in `validBgBufferRef`. Since the old background URL is still in the 6-entry buffer, the code assumes no update is needed and skips sending the new background to the dashboard.

**Fix:** Change the logic in `handleNewImageLoaded` so that it always sends the new background URL when it differs from the currently sent one, regardless of buffer membership. The buffer should only be used for the safeguard polling fallback, not to gate the primary track-change update path.

### Technical Details

#### File: `src/components/sonos/SonosWidget.tsx`

1. **Add useEffect for prefetch completion when no next URLs exist:**
```typescript
useEffect(() => {
  if (prefetchStatus === 'ready') {
    const hasNextArt = nowPlaying?.next_widget_art_url || nowPlaying?.next_album_art_url;
    const hasNextBg = nowPlaying?.next_bg_image_url;
    if (!hasNextArt && !hasNextBg) {
      setPrefetchStatusTracked('loaded');
    }
  }
}, [prefetchStatus, nowPlaying?.next_widget_art_url, nowPlaying?.next_album_art_url, nowPlaying?.next_bg_image_url]);
```

2. **Fix `handleNewImageLoaded` background logic:**
Replace the buffer-gating condition with a simple comparison: always send the new bg if it differs from what was last sent.
```typescript
// Always send bg to dashboard when it changes
const newBgStripped = bgUrl ? stripQuery(bgUrl) : null;
const sentStripped = bgSentRef.current ? stripQuery(bgSentRef.current) : null;
if (bgUrl && newBgStripped !== sentStripped) {
  pushToBgBuffer(validBgBufferRef.current, bgUrl);
  onAlbumArtChangeRef.current?.(bgUrl);
  bgSentRef.current = bgUrl;
} else if (bgUrl && !bgSentRef.current) {
  pushToBgBuffer(validBgBufferRef.current, bgUrl);
  onAlbumArtChangeRef.current?.(bgUrl);
  bgSentRef.current = bgUrl;
}
```

### Expected Result
- Prefetch dot: RED -> ORANGE -> GREEN (within a few seconds, even without next-track data)
- Background: updates immediately when the new widget image loads after a track change, instead of being stuck on the old background for ~60 seconds

