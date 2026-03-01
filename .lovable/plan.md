

## Review: Temperature SSOT Logic

After tracing the full chain across all files, the architecture is almost correct. There is **one bug** remaining, plus a minor redundancy.

### Bug: `preserveProfileTarget` overwrites SSOT with PID-adjusted value

In `session-lifecycle.ts` line 31, `completeProfile` calls `preserveProfileTarget()` which reads `target_temp` (the PID-compensated hardware value, e.g. 4.3°) and writes it into `profile_target_temp`, **overwriting** the user's actual desired target (e.g. 7°).

This means after a profile completes:
- `profile_target_temp` becomes 4.3° (wrong — should be 7°)
- Next PID cycle uses 4.3° as base, compensates further → drift

**The fix is simple**: Don't touch `profile_target_temp` at all on completion. It already holds the correct value (the last profile step's target). Just leave it. The user seamlessly transitions to manual mode with the same desired target.

This means `preserveProfileTarget` in `types.ts` is no longer needed, and `completeProfile` should simply skip that call.

### Minor: Redundant in-memory sync in auto-adjust-cooling

Lines 362-368 in `auto-adjust-cooling/index.ts` re-sync in-memory targets after `runControllerAdjustments`, but the function already does this internally (lines 62-67, 77-82). Harmless but unnecessary — can be removed for clarity.

### Everything else is correct

| Scenario | Flow | Status |
|---|---|---|
| Manual slider | `rapt-update-controller` → writes both fields | OK |
| Profile step | `setProfileTarget()` → `profile_target_temp` | OK |
| PID (pill-comp on) | reads `profile_target_temp`, writes `target_temp` | OK |
| PID (pill-comp off) | pass-through syncs `target_temp = profile_target_temp` | OK |
| Profile completes | `profile_target_temp` stays as-is (after fix) | Fix needed |
| Bootstrap (null) | copies `target_temp` → `profile_target_temp` once | OK |
| Manual target change mid-cycle | same-data guard detects `profile_target_temp` divergence | OK |
| TempStat display | reads `controller.profile_target_temp` as SSOT | OK |

### Changes

| File | Change |
|---|---|
| `supabase/functions/_shared/session-lifecycle.ts` | Remove `preserveProfileTarget` call from `completeProfile` — leave `profile_target_temp` as-is |
| `supabase/functions/_shared/types.ts` | Remove `preserveProfileTarget` function (dead code after above) |
| `supabase/functions/auto-adjust-cooling/index.ts` | Remove redundant in-memory sync (lines 362-368) |

