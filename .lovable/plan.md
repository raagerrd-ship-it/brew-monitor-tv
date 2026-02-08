

# Sonos Widget Optimization

## Overview
Refactor the 717-line SonosWidget into a maintainable, performant architecture with three key improvements.

## 1. Progress Bar via DOM Ref (No Re-renders)

Currently, `setLocalProgress(next)` is called every second, causing the entire widget to re-render. Instead:

- Replace `localProgress` state with a **DOM ref** (`progressBarRef`) that directly updates `style.width`
- Keep `localProgressRef` for internal calculations (predictive polling, prefetch timing)
- The `setLocalProgressWithRef` helper becomes unnecessary -- only the ref is needed
- Debug time-remaining also updates via DOM ref instead of state

This eliminates ~60 re-renders per minute during playback.

## 2. Extract Hooks from God Component

Split the widget into focused hooks:

```text
SonosWidget.tsx (~200 lines, rendering only)
  |
  +-- hooks/useSonosPlaybackTicker.ts
  |     1s interval: progress updates (DOM ref), prefetch trigger,
  |     early swap, predictive polling
  |
  +-- hooks/useSonosClientPolling.ts
  |     5s polling of sonos-playback-status, bg sync safeguard
  |
  +-- hooks/useSonosVisibility.ts
  |     Connected check, grace period, hide/show logic
  |
  +-- hooks/useSonosRealtime.ts
  |     Realtime callback wiring, cooldown logic
  |
  +-- hooks/useSonosTrackTransition.ts (existing, kept as-is)
  |     Initial data fetch, track update handler
  |
  +-- hooks/useSonosInit.ts
        Settings + now playing parallel fetch on mount
```

Each hook receives only the refs/state it needs and returns minimal outputs.

## 3. Consolidate Track-Change Logic

Currently, track changes are handled in three places with duplicated code:
- Predictive poll callback (line ~124)
- 5s client poll (line ~291)
- Realtime callback (line ~422)

Create a single `handleTrackChange` function that:
- Sets `trackChangedAtRef` timestamp
- Updates text metadata (track, artist, album)
- Decides whether to use prefetched `next_` URLs (sequential) or discard them (random skip)
- Triggers server sync when needed
- Updates progress

Each caller passes the source data and a flag indicating if early-swap was active.

## 4. Keep 5s Polling During Pause

The current 5s polling runs regardless of playback state (it only stops for IDLE). This stays as-is per your request -- it ensures the widget detects resume quickly.

## Files Changed

| File | Action |
|------|--------|
| `src/components/sonos/hooks/useSonosPlaybackTicker.ts` | New -- 1s ticker logic |
| `src/components/sonos/hooks/useSonosClientPolling.ts` | New -- 5s polling logic |
| `src/components/sonos/hooks/useSonosVisibility.ts` | New -- visibility/grace logic |
| `src/components/sonos/hooks/useSonosRealtime.ts` | New -- realtime callback |
| `src/components/sonos/hooks/useSonosInit.ts` | New -- mount init |
| `src/components/sonos/hooks/useSonosTrackChange.ts` | New -- consolidated track-change handler |
| `src/components/sonos/hooks/index.ts` | Updated -- export new hooks |
| `src/components/sonos/SonosWidget.tsx` | Rewritten -- ~200 lines, rendering + hook composition |

## Key Technical Detail: DOM Progress Update

```typescript
// In useSonosPlaybackTicker.ts (inside 1s interval)
const next = isPlaying ? Math.min(prev + 1000, duration) : prev;
localProgressRef.current = next;

// Direct DOM update -- zero React re-renders
const pct = Math.min((next / duration) * 100, 100);
if (progressBarRef.current) {
  progressBarRef.current.style.width = `${pct}%`;
}
if (debugTimeRef.current) {
  debugTimeRef.current.textContent = `${Math.max(0, Math.round((duration - next) / 1000))}s`;
}
```

