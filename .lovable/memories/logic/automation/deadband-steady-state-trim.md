---
name: Deadband Steady-State Trim
description: Asymmetric integral build inside deadband to close residual offset above ssFloor.
type: feature
---
Inside the deadband (|avgError| ≤ 0.10°C) when temp is on the "wrong" side of setpoint (warm-side for cooling, cool-side for heating, threshold ±0.02°C), the integral is allowed to trim UP above ssFloor instead of being blended back down.

- Trim per cycle: clamped to 0.3%–1.0% duty, scaled by |avgError| × 0.05.
- Hard cap: ssFloor + 15% duty (prevents overshoot to opposite side).
- Reason: ssFloor learns the duty that holds current temp, not the duty that reaches setpoint. Without this trim, the system oscillates around a steady-state offset (e.g. 8.2°C with target 8.0°C).
- Implemented in: supabase/functions/_shared/pid-compensation.ts deadband branch, constraint tag `deadband-trim`.
- Right-side behavior (past target) unchanged — coast/cool-soft still applies.