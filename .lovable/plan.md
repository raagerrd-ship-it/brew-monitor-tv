

# PWM Duty Cycle Learning is Permanently Blocked

## Problem

The `steady_state_duty` parameter is stuck at 23 samples because **two separate guards block all learning during PWM cycles**:

1. **PWM guard** (line 887-895 in `cooler-management.ts`): Before any learning happens, the code checks `pending_rapt_retries` for active PWM OFF entries. Since a PWM burst is sent *every* 5-minute cycle, there is always an active pending revert when learning runs → `"Hoppar inlärning — PWM-burst aktiv (temporära mål)"`.

2. **Active cooling guard** (line 900): Even if the PWM guard were removed, during a PWM burst the hardware target is 0°C, making `isActivelyCooling = (probe 6.2° > target 0° + hysteresis 0.2°) = true`. This routes to margin learning (not warming rate learning). Warming rate learning — which is where `steady_state_duty` gets updated — only runs when `!anyActive`.

**Result**: Since PWM runs continuously in steady state, duty cycle learning *never* happens, so the value stays frozen at whatever it was before PWM started.

## Root Cause

The learning logic was designed before PWM existed. It assumes "PWM active = temporary targets = don't learn", but in reality PWM is the *normal* operating mode during steady state and is exactly when duty cycle learning should be happening.

## Fix

### 1. Allow duty cycle learning during PWM (separate from margin learning)

In `learnFromCurrentState()`, the PWM guard should **not** block warming rate and duty cycle learning — only margin learning. The warming rate can be accurately measured from probe temperature history regardless of PWM bursts, because PWM only affects the hardware target, not the actual thermal behavior of the fermenter.

**Changes to `cooler-management.ts`**:

- Move the `learnWarmingRate()` call **before** the PWM guard, so it always runs when `!anyActive` (based on real utilization, not PWM state)
- OR: Add a separate duty cycle learning path that runs inside the `anyActive` block, using the controller's actual measured utilization directly (which is already available) instead of the warming_rate/cooling_rate ratio

### 2. Fix `isActivelyCooling` during PWM bursts

During a PWM burst, the DB `target_temp` is the real PID value (6.4°C), but the hardware is at 0°C. The `isActivelyCooling` check uses `target_temp` from the controller record (which is correct since we use `addHardwareOnly`). So this should actually be fine — let me verify the exact check...

Actually looking at the log again: `probe 6.2° mål 0°` — the "mål" shown is 0°, meaning the utilization check IS seeing the hardware target. This needs investigation.

### Recommended approach

The simplest and most robust fix:

1. **In `learnFromCurrentState`**: Move the `learnWarmingRate(ctx, controllersWithCooling, tempBucket)` call to run **before** the PWM guard check, not after it. This ensures warming rate and duty cycle learning continue even when PWM is active.

2. **Alternative**: Learn duty cycle directly from the controller's measured cooling utilization (already calculated) instead of deriving it from warming_rate/cooling_rate. This would be more direct: `duty = utilization` when in steady state.

### Files to modify

- `supabase/functions/_shared/cooler-management.ts`: Restructure `learnFromCurrentState()` to separate warming/duty learning from margin learning, so the PWM guard only blocks margin learning.

