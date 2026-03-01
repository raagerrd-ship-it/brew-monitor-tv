

## Problem

When pill-comp is active, "Mål" everywhere shows `controller.target_temp` (the PID-adjusted probe target, e.g. 4.3°). The user expects to see the **intended snitt-mål** (e.g. 7.0°) as the primary target, with the probe target shown as secondary context.

Current state:
- **RaptControllerDialog**: "Mål (snitt)" shows probe target (wrong)
- **RaptControllersManagement**: "Mål (snitt)" shows probe target (wrong)  
- **TempStat (brew card)**: Already uses `getDisplayTarget()` which prioritizes `originalTarget` — closer to correct but depends on adjustment data existing

## SSOT Definition (confirmed)

| Mode | Är-temp | Mål-temp |
|------|---------|----------|
| Pill-comp aktiv | Snitt (pill+probe)/2 | Användarmål (snitt). PID justerar ctrl-mål mot detta. |
| Pill-comp inaktiv | Ctrl (probe) | Ctrl-mål (direkt) |

## Plan

### 1. Fetch original target in controller dialog hook
**File**: `src/hooks/use-controller-dialog.ts`

- Add state `originalTarget: number | null`
- When dialog opens, query `auto_cooling_adjustments` for latest `🎯` record matching the controller to get `original_target_temp`
- Also check `fermentation_sessions` for `controller_profile_target_temp` (profile takes priority)
- Expose `originalTarget` from the hook
- When user sets a new target via slider and pill-comp is active, that value IS the snitt-mål. The edge function `rapt-update-controller` should handle PID compensation. Need to verify this.

### 2. Update RaptControllerDialog target display
**File**: `src/components/RaptControllerDialog.tsx`

- When `isPillCompActive`:
  - Primary "Mål (snitt)" value: show `originalTarget ?? currentController.target_temp` 
  - Sub-label: show `Ctrl-mål (PID): {currentController.target_temp}°`
- When pill-comp inactive:
  - "Mål (ctrl)" value: show `currentController.target_temp` (unchanged)

### 3. Update RaptControllersManagement target display  
**File**: `src/components/RaptControllersManagement.tsx`

- Need to fetch `original_target_temp` per controller from `auto_cooling_adjustments`
- When `pillCompEnabled`: show original target as primary, probe target as sub-text
- When not: show `controller.target_temp` directly

### 4. Verify TempStat brew card
**File**: `src/components/brew-card/TempStat.tsx`

- Already uses `getDisplayTarget(profileTarget ?? originalTarget, targetTemp)` — this is correct
- The label in parentheses shows `profileGoal` which is the SSOT target — correct
- No changes needed here

### Technical Detail

The `original_target_temp` in `auto_cooling_adjustments` represents the user's intended target before PID compensation. When pill-comp is active, PID adjusts the controller's actual `target_temp` to compensate for the difference between pill and probe. The `original_target_temp` IS the snitt-mål.

