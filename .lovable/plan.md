

## Analysis: Temperature SSOT Gaps

I've reviewed all the files in the chain. The SSOT architecture is **almost** there but has several remaining inconsistencies that break the "single path" principle.

### Problems Found

**1. `clearProfileTarget` breaks manual mode after session ends**
`session-lifecycle.ts` line 31 calls `clearProfileTarget()` which sets `profile_target_temp = null` when a fermentation profile completes. In the new model where `profile_target_temp` is SSOT for ALL modes, this leaves the controller without a desired target. The PID loop then bootstraps from `target_temp` (which is the PID-adjusted value — e.g. 4.3° instead of 7°).

**Fix:** Instead of nulling, copy `target_temp` into `profile_target_temp` on session completion so the user seamlessly transitions back to manual mode with the current hardware target as the new SSOT.

**2. PID same-data guard ignores manual target changes**
`controller-adjustments.ts` lines 95-96: for non-profile controllers, `profileTargetNow` is set to `null` (because `isProfileOwned` is false), which makes `profileMatchesCurrent` always `true`. This means if the user changes their manual target between cycles, the same-data guard still skips PID because the RAPT timestamp hasn't changed.

**Fix:** Remove the `isProfileOwned` gate — always read `profile_target_temp` from the controller for the same-data check.

**3. `originalTargetMap` is dead code**
`auto-adjust-cooling/index.ts` lines 303-323 build an `originalTargetMap` by querying `auto_cooling_adjustments` for non-profile controllers. This map is never passed to the PID context — it's only used for logging (line 334-336). It's a remnant of the old system and confusing.

**Fix:** Remove. Use `profile_target_temp` from controller data for logging too.

**4. TempStat only reads profile target from active session**
`TempStat.tsx` line 54: `brew.fermentationSession?.controller_profile_target_temp` — when no session exists (manual mode), this is `null`, so it falls back to `targetTemp` which is PID-adjusted. The brew card therefore shows the PID-adjusted target instead of the user's intent.

**Fix:** Read `profile_target_temp` from the controller row directly (via `devices.controller`), regardless of session status.

**5. `profileOwnedControllerIds` branching still present**
The `isProfileOwned` variable in `controller-adjustments.ts` is still used for step type labeling (line 123). This is fine for learning buckets but should not affect the core PID path. Currently it doesn't (baseTarget is unified), but the same-data guard (problem 2) still branches on it.

### Changes

| File | Change |
|---|---|
| `supabase/functions/_shared/session-lifecycle.ts` | On session complete: copy `target_temp` → `profile_target_temp` instead of clearing to `null` |
| `supabase/functions/_shared/types.ts` | Replace `clearProfileTarget` with `preserveProfileTarget` that copies current target |
| `supabase/functions/_shared/controller-adjustments.ts` | Remove `isProfileOwned` gate from same-data guard — always check `profile_target_temp` |
| `supabase/functions/auto-adjust-cooling/index.ts` | Remove `originalTargetMap` block (lines 303-323), use `profile_target_temp` for logging |
| `src/components/brew-card/TempStat.tsx` | Read `profile_target_temp` from `devices.controller` as fallback when no session |

### Result

After these changes, the flow is truly unified:

```text
User intent (slider OR profile step)
        │
        ▼
  profile_target_temp  ← always populated, never null
        │
        ▼
  Pill-comp ON?
  ├─ Yes → PID calculates → target_temp (hardware)
  └─ No  → target_temp = profile_target_temp
```

No branching on `isProfileOwned` in the core path. No fallback to `auto_cooling_adjustments`. No `clearProfileTarget` nulling the SSOT.

