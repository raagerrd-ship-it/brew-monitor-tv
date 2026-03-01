

## Analysis: Sonos Image Storage Cleanup

### Current Problems

1. **`cleanupOldBackgrounds` is too conservative**: Won't clean until >10 files exist, then keeps 5 minimum — meaning up to 10 orphan files linger permanently.

2. **Next-track images excluded from keep-list**: The `keepFiles` array only includes current track's bg + widget. Next-track bg + widget are never protected, risking deletion of files still referenced in DB.

3. **No cleanup on bg_only regeneration**: When settings change and bg is regenerated with a new settings hash, the old bg file is never removed.

4. **No cleanup on IDLE transition**: When playback stops and state goes IDLE, all images become orphans but nothing is cleaned.

5. **Cleanup only fires during image generation**: If the current track has cached images (cache hit), cleanup never runs at all.

### What's Actually Needed

At any moment, at most **4 files** are actively referenced:
- Current track: 1 bg + 1 widget
- Next track: 1 bg + 1 widget

Everything else is waste.

### Plan

**1. Rewrite `cleanupOldBackgrounds` to be aggressive and reference-based**

Instead of a conservative "keep N files" approach, collect all actively-referenced URLs from the `sonos_now_playing` row (bg_image_url, widget_art_url, next_bg_image_url, next_widget_art_url), extract filenames, and delete everything else. No threshold, no minimum — if it's not referenced, it goes.

**2. Run cleanup after every sync that writes to DB** (not only during image generation)

Move the cleanup call to after the final DB write, using the actual URLs written to the row as the keep-list. This covers:
- New track (images just generated)
- Same track with cache hit (keep existing references)
- bg_only regeneration (new bg replaces old, old gets cleaned)

**3. Clean images on IDLE transition**

When stale-pause triggers IDLE state, also delete all files in the bucket since nothing is displayed.

**4. Include next-track images in keep-list**

Collect filenames from all 4 image URL fields (current bg, current widget, next bg, next widget) before cleanup.

### Files to Edit

- `supabase/functions/_shared/sonos-storage.ts` — Rewrite `cleanupOldBackgrounds` to accept referenced URLs and delete everything else, remove the ≤10 threshold
- `supabase/functions/sync-sonos-now-playing/index.ts` — Move cleanup to after final DB write with all 4 image URLs; add cleanup on IDLE transition

