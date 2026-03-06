

# Code Review: Profile Target Protection Audit

## Critical Issue Found

### 1. `setControllerTargetTemp()` — Missing `source` parameter (HIGH RISK)

**File**: `supabase/functions/_shared/temp-utils.ts`, lines 126-137

The non-batch fallback function `setControllerTargetTemp()` calls `rapt-update-controller` **without** a `source` parameter. This means if any code path uses this function (instead of the batch path), the update will be treated as a **manual user change** by `rapt-update-controller`, which will **overwrite `profile_target_temp`**.

Currently affected code paths:
- `controller-adjustments.ts` line 496: PWM ON fallback (`addHardwareOnly` not available → direct call)
- `controller-adjustments.ts` line 585: PID update fallback (when no `updateBatch`)
- `controller-adjustments.ts` line 221 (pass-through fallback, though currently unreachable due to line 190 guard)
- Stall detection in `stall-detection.ts` if it uses the non-batch path

**The batch path (`RaptUpdateBatch.flush()`) bypasses `rapt-update-controller` entirely** — it calls the RAPT API directly and only writes `target_temp` to DB. So the batch path is safe. But any fallback to `setControllerTargetTemp()` is dangerous.

**Fix**: Add `source: 'automation'` to all `setControllerTargetTemp()` calls in the JSON body.

### 2. `rapt-update-controller` — Retry calls in `run-automation` also lacks `source` for non-PWM retries

**File**: `supabase/functions/run-automation/index.ts`

The PWM OFF retry (line ~106) correctly sends `source: 'pwm'` now. But `pending_rapt_retries` processing elsewhere could potentially call `rapt-update-controller` without source — need to verify all callers.

### 3. Cooler management — No `profile_target_temp` risk

The cooler (`cooler-management.ts`) only writes `target_temp` for the glycol cooler controller, which doesn't have a `profile_target_temp` concept. Safe.

### 4. Stall detection — Indirect risk via `setControllerTargetTemp`

If stall detection uses the non-batch path, boost adjustments would flow through `setControllerTargetTemp()` → `rapt-update-controller` without `source`, corrupting `profile_target_temp`.

## Plan

1. **Add `source: 'automation'` to `setControllerTargetTemp()`** in `temp-utils.ts` — the JSON body should always include `source: 'automation'` since this function is only called by backend automation, never by users directly.

2. **Verify `pending_rapt_retries` processing** in `auto-adjust-cooling/index.ts` — ensure retry calls also pass `source`.

3. **No changes needed** for `RaptUpdateBatch.flush()` — it bypasses `rapt-update-controller` and writes only `target_temp` to DB (safe).

This is a single-line fix in `temp-utils.ts` that protects all current and future automation callers from accidentally overwriting `profile_target_temp`.

