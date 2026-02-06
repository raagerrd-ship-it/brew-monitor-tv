

## Problem

The server-rendered chart images in TV mode don't fill their container. The `<img>` element has `w-full h-full` and `object-fit: fill`, but `h-full` (100% height) only works when the parent has an explicit height. The parent uses `flex-1 min-h-0` which gives it a computed height via flexbox, but the `<img>` inside doesn't inherit that properly.

## Solution

Make the `TvModeChart` wrapper use absolute positioning to fill its parent, ensuring the image stretches to the full available space regardless of flexbox computation.

## Changes

**File: `src/components/brew-chart/LazyBrewChart.tsx`**

Update the `TvModeChart` return to use a relative/absolute positioning pattern that guarantees the image fills the container:

```typescript
// Change the TvModeChart return from:
return (
  <img
    src={chartUrl}
    alt="Brew chart"
    className="w-full h-full rounded-lg"
    style={{ objectFit: 'fill' }}
    loading="lazy"
  />
);

// To:
return (
  <div className="relative w-full h-full">
    <img
      src={chartUrl}
      alt="Brew chart"
      className="absolute inset-0 w-full h-full rounded-lg"
      style={{ objectFit: 'fill' }}
      loading="lazy"
    />
  </div>
);
```

Also update the error/loading skeleton to use the same pattern:

```typescript
// Change from:
<div className="h-full flex items-center justify-center">
  <Skeleton className="w-full h-full rounded-lg" />
</div>

// To:
<div className="relative w-full h-full">
  <Skeleton className="absolute inset-0 rounded-lg" />
</div>
```

This ensures the image and skeleton always fill the entire flex-computed space by using `absolute inset-0` within a `relative` parent that inherits the flexbox dimensions.
