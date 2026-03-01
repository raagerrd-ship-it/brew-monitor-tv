

## Plan: Rate-based glycol learning + max cooling floor

### Current state
The margin learning (`learnFromCurrentState`) only checks binary: "at target? overshoot? not reaching?" — it doesn't consider *how fast* the probe is cooling or whether extra glycol margin actually helps.

### Two new learned parameters

1. **`cooling_rate_margin:{bucket}`** — What margin is needed to achieve a specific cooling rate (°C/h)
   - During active ramps: measure actual probe cooling rate from `temp_controller_history` (last 15-30 min)
   - Compare to required rate (e.g., ramp needs 2°C/h drop)
   - If rate is too slow → increase margin. If rate is adequate → tighten margin slightly
   - This replaces the current static "at target / not at target" logic during ramps

2. **`max_effective_margin:{bucket}`** — The floor beyond which more glycol doesn't help
   - Track pairs of (margin, observed cooling rate)
   - If margin was increased but cooling rate didn't improve → we've hit the floor
   - Learn this ceiling so we never set glycol margin beyond it (waste of energy)
   - Stored per cooler controller + temp bucket

### Implementation steps

1. **Extend `learnFromCurrentState`** to fetch recent probe history (last 30 min) and calculate actual cooling rate (°C/h)

2. **Add ramp-aware margin learning**: When a ramp is active, compare actual rate vs required rate, and adjust margin proportionally instead of binary 3%/15% nudges

3. **Add max-effective-margin learning**: After each adjustment, compare previous and current cooling rates. If a bigger margin didn't yield a faster rate, update the `max_effective_margin` floor. Clamp the desired glycol target so it never goes below `effectiveTarget - maxEffectiveMargin`

4. **Update `resolveEffectiveLowestTarget`** to expose the required cooling rate (°C/h) from active ramps so the learning function can use it

5. **Update `LearnedGlycolRates.tsx`** (or create new UI) to display the new learned parameters — max effective margin per zone

### Technical detail

```text
During ramp (probe 20°C → 18°C in 1h):
  requiredRate = 2.0 °C/h
  actualRate   = measured from history (e.g., 1.2 °C/h)
  ratio        = requiredRate / actualRate = 1.67
  → increase margin by ratio (clamped)

Max floor learning:
  Previous cycle: margin=8, rate=1.5°C/h
  Current cycle:  margin=10, rate=1.5°C/h
  → margin went up 2°C but rate unchanged
  → learn max_effective_margin ≈ 8°C for this bucket
```

### Files to modify
- `supabase/functions/_shared/glycol-cooling.ts` — main logic changes
- `src/components/LearnedCoolerMarginValues.tsx` — show max effective margin in UI (if it exists)

