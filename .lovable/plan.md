

## Problem

The last fix incorrectly changed `followed_current_temp` to use sensor data (`current_temp`/`pill_temp`). Per the architecture, the **interpolated profile target** is the Single Source of Truth for tank temperature outside of PID/decision logs. Sensor temps should only appear in the PID bar and decision logs.

## Fix

In `supabase/functions/_shared/glycol-cooling.ts` (lines 863-877):

- Remove the `realController` lookup
- Set `followed_current_temp` back to `worstNeed.currentTarget` (the interpolated ramp position)
- Set `followed_target_temp` to `worstNeed.upcomingTarget` (the 1-hour look-ahead interpolated target)

These values already contain the correct interpolated temperatures from the ramp calculation earlier in the function. This is consistent with the SSOT principle: profile_target_temp is the authoritative tank temperature everywhere except PID internals.

### Concrete change

```typescript
// REMOVE lines 863-866 (realController lookup)

// REVERT to:
followed_current_temp: worstNeed.currentTarget,   // interpolated current ramp position
followed_target_temp: worstNeed.upcomingTarget,    // interpolated 1h look-ahead
```

