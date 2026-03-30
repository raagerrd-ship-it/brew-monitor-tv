

## Plan: Nollställ all data under Kylare-inlärning

All learned cooler data has been based on incorrect cooling logic and needs to be wiped clean.

### Data to reset

**1. `fermentation_learnings` — all cooler-related parameters**
Delete all rows where `parameter_name` matches:
- `cooling_rate:%`
- `warming_rate:%`
- `hold_margin:%`
- `ramp_margin:%`
- `cooler_margin:%`
- `cooling_capacity:%`
- `glycol_rate:%`
- `steady_state_duty:%`

This covers LearnedThermalProfile, LearnedPidCoolingRates, and LearnedCoolerMarginValues.

**2. `cooler_margin_history` — all rows**
Delete all historical margin tracking data (LearnedMarginHistory).

**3. `controller_learned_compensation` — all rows**
Delete all PID baselines for all controllers (these are also tainted).

### Implementation

Single database migration with three DELETE statements. No code changes needed — the UI components will simply show "Inga inlärda värden ännu" after reset.

### Technical detail

```sql
DELETE FROM fermentation_learnings
WHERE parameter_name LIKE 'cooling_rate:%'
   OR parameter_name LIKE 'warming_rate:%'
   OR parameter_name LIKE 'hold_margin:%'
   OR parameter_name LIKE 'ramp_margin:%'
   OR parameter_name LIKE 'cooler_margin:%'
   OR parameter_name LIKE 'cooling_capacity:%'
   OR parameter_name LIKE 'glycol_rate:%'
   OR parameter_name LIKE 'steady_state_duty:%';

DELETE FROM cooler_margin_history;

DELETE FROM controller_learned_compensation;
```

