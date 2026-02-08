

## Fix: Top Gradient Fade Length

### Change
Update the `applyTopGradient` function so the fade region extends over half the total image height, instead of equaling the solid region height.

### Technical Detail

**File: `supabase/functions/_shared/image-processing.ts`**

In `applyTopGradient`, change:
```typescript
const fadeLength = solidHeight;
```
to:
```typescript
const fadeLength = Math.round(h / 2);
```

This makes the gradient fade smoothly over the bottom half of the image height regardless of the solid region size.

