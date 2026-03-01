

## Problem

The current temperature logic has **two separate paths** for determining `baseTarget` in the PID loop depending on whether a fermentation profile is active or not:

1. **Profile active** → reads `profile_target_temp` from the controller row (set by `setProfileTarget()`)
2. **Manual (no profile)** → uses `controller.target_temp` directly (which is the PID-adjusted value, not the user's intended target)

This causes a circular problem: when pill-comp is active without a profile, PID adjusts `target_temp` to e.g. 4.3°, and next cycle reads that 4.3° as the "intended" target, drifting further away from the user's actual goal of 7°.

The previous fix (removing `pillCompOriginalTargetMap`) broke the only mechanism that remembered what the user originally wanted.

## Root Cause

There is no SSOT for "what temperature does the user want" in manual mode. `profile_target_temp` is only set by fermentation profiles. Manual users have no equivalent field.

## Solution: Unify the channel

Use `profile_target_temp` as the **single desired-target field** for ALL modes -- both manual and profile. The PID loop always reads `profile_target_temp` as `baseTarget`. The actual `target_temp` on the controller is what PID sends to the hardware.

```text
User intent (manual slider OR profile step)
        │
        ▼
  profile_target_temp  ← SSOT "what temp do I want"
        │
        ▼
  Pill-comp active?
  ├─ Yes → PID calculates compensated target
  │         → writes to target_temp (hardware)
  └─ No  → target_temp = profile_target_temp (pass-through)
```

### Changes

#### 1. Manual target setting writes `profile_target_temp`
**File**: `supabase/functions/rapt-update-controller/index.ts`

When `action === 'setTargetTemperature'` and pill-comp is enabled:
- Write `value` to both `target_temp` AND `profile_target_temp`
- When pill-comp is disabled: write `value` to `target_temp` and set `profile_target_temp = value` too (keep them in sync)

This way `profile_target_temp` always represents "what the user wants", regardless of source.

#### 2. PID loop always uses `profile_target_temp` as base
**File**: `supabase/functions/_shared/controller-adjustments.ts`

Remove the `isProfileOwned` branching for `baseTarget`. Instead:
- If `profile_target_temp` is set → use it as `baseTarget` (works for both profile and manual)
- If `profile_target_temp` is null → use `target_temp` (legacy/first-run fallback, also set `profile_target_temp = target_temp` to bootstrap)

Remove the stale-clearing logic that nulls `profile_target_temp` when no session exists -- it's now always valid.

#### 3. UI: always show `profile_target_temp` as the user's goal
**Files**: `src/hooks/use-controller-dialog.ts`, `src/components/RaptControllerDialog.tsx`, `src/components/RaptControllersManagement.tsx`

Simplify: always read `profile_target_temp` from `rapt_temp_controllers` as the display target. No need to check for active sessions or query `auto_cooling_adjustments`. The field is always populated.

- Dialog: `originalTarget` = `controller.profile_target_temp` (always)
- Management list: same -- just read the column directly, no separate fetch
- When user sets target via slider: call `rapt-update-controller` which writes both fields

#### 4. TempStat brew card
**File**: `src/components/brew-card/TempStat.tsx`

Use `controller.profile_target_temp` directly as the SSOT target. Already partially doing this.

#### 5. Auto-cooling entry point cleanup
**File**: `supabase/functions/auto-adjust-cooling/index.ts`

The `profileOwnedControllerIds` / `profileTargetMap` maps become unnecessary since all controllers use the same field. Simplify: just read `profile_target_temp` from the controller data directly in the PID loop.

### Technical Detail

The key insight is that `profile_target_temp` should not mean "owned by a fermentation profile" but rather "the user's desired average temperature". Both manual slider and profile steps write to the same field via the same `setProfileTarget()` function. The PID loop has exactly one path: read `profile_target_temp`, calculate compensation, write `target_temp`.

### Migration

For controllers that currently have `profile_target_temp = null` (manual mode), the first PID cycle will bootstrap by copying `target_temp` → `profile_target_temp`. No DB migration needed.

