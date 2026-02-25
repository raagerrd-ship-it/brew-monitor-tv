

## Problem

The snapshot system (`createBrewSnapshots`) uses complex timeline reconstruction (`getProfileTargetTimeline`) to calculate `profile_target_temp` retroactively. This reconstruction is fragile -- it depends on step logs having exact timestamps, and often produces slightly wrong values (e.g. 16.0 instead of 16.3 during a ramp). Meanwhile, `temp_controller_history` already stores the correct `profile_target_temp` at each recording interval (calculated live by `record-temp-history` with proper ramp interpolation).

## Solution

Simplify `brew-snapshots.ts` to only use values already stored in `temp_controller_history`:

### Changes to `supabase/functions/_shared/brew-snapshots.ts`

1. **Remove** the entire `getProfileTargetTimeline` function (lines 17-106) and `getProfileTargetAt` helper (lines 108-119) -- no more retroactive reconstruction.

2. **Remove** the backfill logic (lines 263-304) -- no longer needed since we don't reconstruct.

3. **Simplify snapshot creation** (line 236-238): Instead of `getProfileTargetAt(profileTimeline, pointMs) ?? closest?.profile_target_temp`, just use `closest?.profile_target_temp ?? null` directly. This takes the value that was already saved live by `record-temp-history` at that point in time.

4. **Remove** the `profileTimeline` variable and the promise that fetches it (lines 158, 195-199).

The result: each snapshot captures exactly the static values that existed in the database at sync time -- SG and Pill from the RAPT pill, Controller temp / Mål / PID from the nearest `temp_controller_history` row. No post-hoc calculation.

### No frontend changes needed

The chart (`useBrewChartData`) already reads `profile_target_temp` from `brew_data_snapshots` -- it will continue to work, now with more accurate values.

