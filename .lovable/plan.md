

## Add exponential ramp curve to gradual_ramp

### Current behavior
Line 506: `rampProgress = (activityTrigger - activityScore) / activityTrigger` — linear mapping from activity drop to temperature increase.

### Change
Add a `ramp_curve` field (`'linear' | 'exponential'`) to fermentation profile steps. When set to `exponential`, apply a power curve: `rampProgress^2` — this makes the temperature increase slow at first and accelerate as activity drops further.

```text
Linear:       activity 35→0%  →  temp +0→3°C  (constant rate)
Exponential:  activity 35→0%  →  temp +0→3°C  (slow start, fast finish)

Example at 50% progress (activity ~17.5%):
  Linear:      +1.5°C
  Exponential: +0.75°C  (only half as much)
```

### Files to change

1. **Database migration** — Add `ramp_curve text` column to `fermentation_profile_steps` (nullable, default null = linear for backward compat).

2. **`src/types/fermentation.ts`** — Add `ramp_curve` to `FermentationProfileStep` and `FermentationStepData`.

3. **`src/components/fermentation/FermentationStepEditor.tsx`** — Add a Select for ramp curve (Linjär / Exponentiell) in the `gradual_ramp` section.

4. **`src/components/fermentation/FermentationStepDisplay.tsx`** — Show curve type in display text.

5. **`supabase/functions/_shared/step-handlers.ts`** — In `processGradualRampStep`, read `ramp_curve` from step and apply `rampProgress = rampProgress ** 2` when exponential.

6. **Hooks** (`use-fermentation-profiles.ts`, `use-active-fermentation-session.ts`, `use-brew-data.ts`, `use-brew-page.ts`) — Include `ramp_curve` in queries.

