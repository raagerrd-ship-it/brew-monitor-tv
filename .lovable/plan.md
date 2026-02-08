

## Fix: Blocky Background Blur

### Problem
The current blur implementation downscales the 1280x720 image to a very small size (e.g., ~80x45 pixels when blur=40) in a single step, then upscales it back. This creates visible blocky artifacts -- large soft squares instead of a smooth blur.

### Solution: Multi-pass progressive blur
Instead of one extreme downscale/upscale, apply multiple smaller downscale/upscale passes. Each pass reduces detail incrementally, producing a smooth gaussian-like blur without blocky artifacts.

For example, with blur=40:
- Current: 1280x720 -> 80x45 -> 1280x720 (one giant jump = blocky)
- New: 1280x720 -> 640x360 -> 1280x720 -> 640x360 -> 1280x720 ... (multiple gentle passes = smooth)

The number of passes scales with the blur value, and each pass uses a modest downscale factor (e.g., 2-3x) rather than one extreme factor.

### Technical Change

**File: `supabase/functions/_shared/image-processing.ts`**

Replace the `applyBlur` function (lines ~79-87) with a multi-pass version:

```typescript
function applyBlur(pixels: Uint8Array, w: number, h: number, blur: number): Uint8Array {
  if (blur <= 0) return pixels;

  // Number of passes scales with blur amount (e.g., blur=40 -> 4 passes, blur=200 -> 10)
  const passes = Math.max(1, Math.min(12, Math.round(blur / 10)));
  // Each pass uses a gentle downscale factor (2-4x)
  const perPassFactor = Math.max(2, Math.min(4, Math.round(blur / (passes * 3)) + 2));

  let result = pixels;
  for (let i = 0; i < passes; i++) {
    const smallW = Math.max(4, Math.round(w / perPassFactor));
    const smallH = Math.max(4, Math.round(h / perPassFactor));
    const small = resizeBilinear(result, w, h, smallW, smallH);
    result = resizeBilinear(small, smallW, smallH, w, h);
  }
  return result;
}
```

### Impact
- Eliminates blocky artifacts -- produces a smooth, natural-looking blur
- Slightly more processing time due to multiple passes, but each pass is cheaper than one extreme resize
- No database or settings changes needed -- the blur slider value is interpreted the same way
- Requires redeployment of `sync-sonos-now-playing` (automatic)

