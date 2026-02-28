

## Problem

The debug log shows `Realtime: "undefined" (bg=false, widget=false)` entries while music is playing. This happens because:

1. **Server-side**: The `sync-sonos-now-playing` edge function (called by cron) sometimes gets a response from the Sonos API where `track?.name` is momentarily null (API hiccup or transition). It writes this null value to the DB along with `bg_image_url: null` and `widget_art_url: null`, which triggers a realtime event that overwrites the valid data on the client.

2. **Client-side**: The realtime handler in `useSonosRealtime.ts` doesn't filter out incoming updates where `track_name` is null/undefined when we already have a valid track displayed.

The sequence visible in the log:
- 12:50:01 — Cron writes null track → realtime fires with "undefined"
- 12:50:35 — Cron writes "Every Little Thing" with images → realtime fires correctly
- 12:50:36 — Another write clears it again → "undefined"

## Plan

### 1. Server-side guard in `sync-sonos-now-playing/index.ts`
- Before writing to DB (lines 264-268): if `track_name` is null but an existing row has a valid `track_name` and playback state is PLAYING, **skip the write entirely** (return early with `{ ok: true, skipped: true }`).
- This prevents the cron from overwriting good data with empty data during momentary API gaps.

### 2. Client-side guard in `useSonosRealtime.ts`
- At the top of the `onRealtimeRef.current` callback (after line 39): if `incoming.track_name` is null/undefined **and** we already have a `prev` with a valid `track_name`, ignore the update entirely.
- This is a safety net in case the server-side guard doesn't catch all cases.

### Technical details

**Server** (`supabase/functions/sync-sonos-now-playing/index.ts`):
```typescript
// After line 262, before the upsert block:
if (!nowPlaying.track_name && existingRow?.track_name) {
  const duration = Date.now() - startTime;
  console.log(`[SonosSync] No track from API but DB has "${existingRow.track_name}" → skip write (${duration}ms)`);
  return new Response(JSON.stringify({ ok: true, skipped: true, duration_ms: duration }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
```

**Client** (`src/components/sonos/hooks/useSonosRealtime.ts`):
```typescript
// After line 39, before logging:
if (!incoming.track_name) {
  console.log('[Sonos:RT] ⚠️ Ignored realtime with null track_name');
  return;
}
```

