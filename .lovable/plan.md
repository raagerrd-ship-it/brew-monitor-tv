## ✅ IMPLEMENTED: Unified Temperature SSOT

`profile_target_temp` is now the **single source of truth** for "what temperature does the user want" in ALL modes (manual and profile).

### Flow
```text
User intent (manual slider OR profile step)
        │
        ▼
  profile_target_temp  ← SSOT "desired target"
        │
        ▼
  Pill-comp → PID → target_temp (hardware)
```

### Changes made
1. **rapt-update-controller**: Writes both `target_temp` AND `profile_target_temp` on manual setTargetTemperature
2. **controller-adjustments.ts**: PID always reads `profile_target_temp` as baseTarget (bootstraps from `target_temp` if null)
3. **use-controller-dialog.ts**: Always reads `profile_target_temp` as originalTarget (no session check needed)
4. **RaptControllersManagement.tsx**: Reads `profile_target_temp` directly from controller row (no DB fetch)
5. **use-controllers-management.ts**: Added `profile_target_temp` to ControllerData interface
6. **types.ts (shared)**: `setProfileTarget()` remains the canonical write function for profile steps
