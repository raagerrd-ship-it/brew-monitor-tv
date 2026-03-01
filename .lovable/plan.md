

## Architecture: Controller vs Cooler Separation (DONE)

### Structure
`auto-adjust-cooling/index.ts` is a thin **orchestrator** (~350 lines) that:
1. Loads shared data (controllers, settings, profiles)
2. Calls `runControllerAdjustments(ctx)` — PID pill compensation + stall detection (tank-level)
3. Syncs in-memory targets
4. Calls `runCoolerCooling(ctx)` — shared cooling unit management

### Files
- `_shared/controller-adjustments.ts` — PID pill compensation + stall detection orchestration
- `_shared/glycol-cooling.ts` — Cooler management (renamed exports: `CoolerContext`, `runCoolerCooling`)
- `_shared/pid-compensation.ts` — PID calculation engine (unchanged)
- `_shared/stall-detection.ts` — Stall detection logic (unchanged)

### Principle
Tank controllers and the shared cooler are **completely separate concerns**. Controller adjustments never touch the cooler. The cooler only follows the lowest effective target from all followed controllers.
