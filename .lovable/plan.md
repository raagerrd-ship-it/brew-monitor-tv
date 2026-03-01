

## Remove Dead "Profil" Category from Decision Logs

The `categorizeAdjustment` function maps `🔧` and `📈` reason prefixes to a `'profil'` category, but no backend code ever writes adjustment records with those prefixes. Profile enforcement was unified into PID compensation — there is no separate "profil" adjustment type anymore.

### Changes (single file: `src/components/AutoCoolingDecisionLogs.tsx`)

1. **Remove `'profil'` from `AdjustmentCategory` type** — change to `'pill-comp' | 'glykol'`
2. **Remove the two categorization lines** matching `🔧` and `📈` (lines ~102-103) — these will fall through to the default `'glykol'` or can be mapped to `'pill-comp'` as safety fallback
3. **Remove the `getCategoryBadge` case for `'profil'`**
4. **Remove the entire `{category === 'profil' && (...)}` rendering block** (~20 lines of dead UI code)

This is a cleanup-only change — no functional or visual impact since no data ever reaches this code path.

