

## Analysis of Smart Diacetyl Rest (`gradual_ramp`) Logic

### Current Issues Found

**1. min_ramp_hours constraint is broken**
The time constraint uses `session.step_started_at` as its start reference, but the ramp may not trigger until days after the step starts (waiting for activity to drop below the trigger). By the time activity drops to e.g. 35%, `elapsedSinceStep` could already be 72+ hours, making a 48h min_ramp_hours constraint completely ineffective — the full temperature increase would be allowed immediately.

**2. No tracking of when the ramp actually triggered**
There is no field to record when activity first dropped below the trigger threshold. This is needed for both the min_ramp_hours constraint and for accurate progress reporting.

**3. step_start_temp not utilized for gradual_ramp**
The ramp uses `getEffectiveTargetTemp()` (looking back through steps) as the base temperature, but never saves `step_start_temp`. This means the base temp reference could shift if previous steps are modified, though this is a minor concern.

### Plan

**Step 1: Add `ramp_triggered_at` column to `fermentation_sessions`**
- Nullable timestamp, defaults to null
- Records when a gradual_ramp step's activity trigger first fires
- Reset to null on step transitions (already handled by existing step advance logic which resets `step_start_temp`)

**Step 2: Update `processGradualRampStep` in `step-handlers.ts`**
- On first trigger (activity <= threshold AND `ramp_triggered_at` is null): set `ramp_triggered_at = now()` and `step_start_temp = baseTemp` on the session
- Use `ramp_triggered_at` (not `step_started_at`) for the min_ramp_hours elapsed time calculation
- If `ramp_triggered_at` is not yet set and trigger hasn't fired, skip the time constraint entirely

**Step 3: Update session type and step advance logic**
- Add `ramp_triggered_at` to the Session interface in `process-fermentation-profiles/index.ts`
- Ensure step transitions reset `ramp_triggered_at` to null (add to the existing update query)
- Update `src/types/fermentation.ts` FermentationSession type

### Technical Details

```text
Timeline (current - broken):
  step_started_at ──── 72h waiting ──── trigger fires ──── min_ramp_hours already elapsed!
                                                           constraint is useless

Timeline (fixed):
  step_started_at ──── 72h waiting ──── ramp_triggered_at ──── min_ramp_hours starts here
                                                                constraint works correctly
```

Files to modify:
- `supabase/migrations/` — new migration adding `ramp_triggered_at`
- `supabase/functions/_shared/step-handlers.ts` — fix timing logic in `processGradualRampStep`
- `supabase/functions/process-fermentation-profiles/index.ts` — add field to Session interface, reset on step advance
- `src/types/fermentation.ts` — add field to FermentationSession type
- `src/integrations/supabase/types.ts` — auto-updated

