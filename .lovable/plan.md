

## Plan: Separate Controller Logic from Cooler Logic

### Current Problem
`auto-adjust-cooling/index.ts` is a 541-line monolith that mixes two fundamentally different concerns:
- **Controller adjustments** (PID pill compensation, stall detection) — adjusts individual tank controllers
- **Cooler adjustments** (glycol cooling) — adjusts the shared cooling unit

They share data loading but are conceptually independent systems with different targets.

### Proposed Structure

**1. Extract controller logic to `_shared/controller-adjustments.ts`**
- Move PID pill compensation logic (lines 354-476) into a `runControllerAdjustments()` function
- Move stall detection orchestration (lines 488-509) into the same module or keep as separate call
- This module receives the same context (controllers, profiles, settings) and returns `AdjustmentResult[]`

**2. Simplify `auto-adjust-cooling/index.ts` to a thin orchestrator**
- Load shared data (controllers, settings, profiles) — stays here
- Call `runControllerAdjustments(ctx)` — Feature 1+2
- Sync in-memory targets after controller adjustments
- Call `runGlycolCooling(ctx)` — Feature 3
- Log summary

**3. Rename for clarity**
- Comments updated: "CONTROLLER ADJUSTMENTS" and "COOLER MANAGEMENT" as the two clear sections
- The glycol file header updated from "Glycol Cooling Management" to "Cooler Management"

### Files to modify
- **New**: `supabase/functions/_shared/controller-adjustments.ts` — PID pill compensation + stall detection
- **Edit**: `supabase/functions/auto-adjust-cooling/index.ts` — slim down to orchestrator
- **Edit**: `supabase/functions/_shared/glycol-cooling.ts` — rename header/exports (glycol → cooler)

### Result
The orchestrator becomes ~150 lines: load data → run controllers → run cooler → log. Each domain lives in its own file with its own context type.

