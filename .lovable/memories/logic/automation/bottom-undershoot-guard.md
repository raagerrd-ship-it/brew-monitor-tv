---
name: Bottom Undershoot Guard
description: I-term bleed and duty caps when bottom probe is at/under target, with stall-override weak pulse after 20 min above target.
type: feature
---

When `isCooling` and `bottomEst < actualTarget − 0.3°C`:
- Cap duty to `uP + uFf` (no I contribution). If `actualTemp > actualTarget + 0.2°C`, add `+0.05` boost to the cap (tag `bottom-undershoot-guard+boost`).
- Bleed integral: `nextI *= 0.5`
- Constraint tag: `bottom-undershoot-guard`

When `isCooling` and `bottomEst < actualTarget − 0.5°C`:
- Force `duty = 0`, bleed integral hard
- Constraint tag: `bottom-undershoot-stop`

**Stall override (time-based escape):** if guard would fire AND `actualTemp > actualTarget + 0.15°C`, query last 30 min of `temp_controller_history`. If every sample (≥15 rows, oldest ≥20 min old) has `actual_temp > target + 0.10°C`, set `stallOverride = true`. In the stop branch, replace `duty = 0` with `duty = max(duty, 0.08)` (weak 8% pulse) and tag `stall-override-weak-pulse`. This nudges convection instead of waiting indefinitely for natural mixing when the top layer won't sink on its own.

Why: protects bottom from over-cooling while ensuring a stratified tank with cold bottom + warm top eventually gets a gentle stir-up via cooling-driven convection.