

## Plan: Extract Dual Sensor Logic into Isolated Module

### Problem
The current dual-sensor compensation is deeply intertwined with PID control in `pid-compensation.ts` (~826 lines). Terms like "delta", "compensation", "avgDelta", "rawCompensation", "approachScale" make the logic hard to reason about. The backend conflates two separate concerns:

1. **Dual sensor fusion** — a simple geometric correction
2. **PID error correction** — an adaptive control loop

### Architecture

```text
Current flow (tangled):
  profileTarget ──→ calculateCompensatedTarget() ──→ ctrlTargetPid
                    (delta + PI + D-term + approach + guards all mixed)

Proposed flow (layered):
  profileTarget ──→ dualSensorTarget() ──→ baseTempCtrl ──→ PID(baseTempCtrl) ──→ ctrlTargetPid
                    (simple formula)                        (PI + D-term + guards)
```

### New File: `supabase/functions/_shared/dual-sensor.ts`

Clean, isolated module with one pure function:

```typescript
interface DualSensorResult {
  enabled: boolean
  baseTarget: number       // The target for the controller (input to PID)
  sensorDelta: number      // (pill - probe) for logging
  actualTemp: number       // Fused reading for PID error calc
}

function computeDualSensorTarget(
  profileTarget: number,
  ctrlTemp: number | null,   // probe
  pillTemp: number | null,
  enabled: boolean,
): DualSensorResult
```

- **Enabled**: `baseTarget = profileTarget - (pillTemp - ctrlTemp) / 2`, `actualTemp = (pill + probe) / 2`
- **Disabled**: `baseTarget = profileTarget`, `actualTemp = probe ?? pill`
- No DB calls, no side effects, no learned parameters — pure function

### Refactor: `pid-compensation.ts`

- Remove all delta/compensation/avgDelta/approachScale logic from `calculateCompensatedTarget`
- PID receives `baseTarget` (from dual-sensor) as its `actualTarget` instead of `profileTarget`
- PID error = `baseTarget - actualTemp` (unchanged concept, cleaner input)
- PID output = `baseTarget + errorCorrection` (no more `- compensation` term)
- The formula in logs becomes: `Profil → DualSensor → PID → Mål` instead of `Profil - Δ + PI = Mål`

### Refactor: `controller-adjustments.ts`

- Call `computeDualSensorTarget()` before `calculateCompensatedTarget()`
- Pass `baseTarget` to PID instead of `actualTarget` + separate pill/probe
- Log the dual-sensor result as a separate decision step (clear in UI)
- Remove the `hasDualSensors` / `actualTemp` pre-calculation block (lines 308-312) — moved to dual-sensor module

### Refactor: `src/lib/temp-display.ts`

- `getActualTemp()` already implements the same logic for the UI — align naming with the new module for consistency

### Decision Log UI Impact

The decision log columns would map cleanly:
- **Profil**: profileTarget (unchanged)
- **Δ (sensor)**: `(pill - probe) / 2` from dual-sensor (simpler, always this formula)
- **PI**: errorCorrection from PID (unchanged)
- **Mål**: final ctrlTargetPid

### What Does NOT Change
- PID PI-loop, D-term damping, saturation, ramp-boost — all stay in pid-compensation.ts
- PWM burst logic — stays in controller-adjustments.ts
- Cooler management — stays separate
- Stall detection — stays separate
- All learned parameters (thermal rates, baselines, duty cycles) — unchanged

### Files Modified
1. **NEW** `supabase/functions/_shared/dual-sensor.ts` — pure function, ~40 lines
2. **EDIT** `supabase/functions/_shared/pid-compensation.ts` — remove delta compensation, simplify `calculateCompensatedTarget` signature
3. **EDIT** `supabase/functions/_shared/controller-adjustments.ts` — call dual-sensor first, pass result to PID
4. **EDIT** `supabase/functions/_shared/temp-utils.ts` — update re-exports

