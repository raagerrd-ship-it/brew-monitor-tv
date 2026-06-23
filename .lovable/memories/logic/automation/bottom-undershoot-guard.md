---
name: Stratified Bottom Guard (offset-based)
description: Single offset-based guard. Cap duty + bleed I when bottomEst is colder than its stratified position; stall-override weak pulse after 20 min of bulk above target.
type: feature
---

The legacy `−0.3` / `−0.5` thresholds and the `+0.05` boost have been merged
into a single offset-based rule that uses learned `pillProbeOffset` (= pill −
probe at steady state) as the natural stratification baseline.

During cooling:
- `stratOffset = max(0, pillProbeOffset)` (fallback `0.15°C` if unlearned).
- `stratGap = (actualTarget − stratOffset) − bottomEst`.
- If `stratGap > 0` → cap `duty = min(duty, uP + uFf)` and bleed
  `nextI *= 0.5`. Constraint tag: `stratified-guard(gap=…,off=…)`.
- If `stallOverride` is true (see below), replace the cap with
  `duty = max(duty, 0.08)` weak pulse. Tag: `stratified-guard:stall-pulse(…)`.

**Stall override (time-based escape):** detected in
`calculateCompensatedTarget` (NOT inside `computeDutyV3`, which must stay
synchronous and DB-free). Triggers when `mode==='cooling'` AND
`actualTemp > actualTarget + 0.15°C` AND raw probe `< actualTarget − 0.3°C`.
Queries last 30 min of `temp_controller_history` (best-effort, swallows
errors). If every sample (≥15 rows, oldest ≥20 min old) has
`actual_temp > target + 0.10°C`, `stallOverride = true` is passed into
`computeDutyV3` via the `input` field.

Removed constraint tags: `bottom-undershoot-guard`, `bottom-undershoot-guard+boost`, `bottom-undershoot-stop`.
Added constraint tags: `stratified-guard(...)`, `stratified-guard:stall-pulse(...)`.

Why: a cold bottom during cooling is **expected geometry**, not overshoot.
Anchoring the guard to learned stratification stops the regulator from
strangling itself every time the coil delivers a slug, while still preventing
real over-cooling when the bottom runs colder than its stratified position.