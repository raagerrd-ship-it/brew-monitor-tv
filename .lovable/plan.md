

## Problem

The current desktop scaling uses `Math.min(width/1280, height/720)` which picks the most restrictive dimension. In the Lovable preview pane (which is tall and narrow), this scales based on width, leaving large black bars top and bottom. The 1280x720 content is correctly proportioned at 16:9 — if it simply filled the available width, the height would naturally follow.

## Plan

**File: `src/components/AspectRatioContainer.tsx`** (line 71-74)

Change the desktop scale calculation from `Math.min` (fit-inside) to width-only scaling:

```typescript
const scale = window.innerWidth / REFERENCE_WIDTH;
```

This makes the 1280x720 reference layout always fill the viewport width. Since 1280x720 is exactly 16:9, the resulting scaled height (720 × scale) will produce a correct 16:9 output. If the viewport is shorter than the scaled height, vertical overflow is hidden (already set via `overflow-hidden`).

This is a single-line change.

