

## Audit: Pill-komp aktiv = "Snitt", Pill-komp inaktiv = "Ctrl"

After reviewing the codebase, here are the inconsistencies found:

### Issues found

**1. `getActualTempLabel()` in `src/lib/temp-display.ts` (line 35-36)**
- Currently returns `"(probe)"` when pill-comp is OFF and probe is available
- Should return `"(ctrl)"` per the naming convention

**2. `RaptControllerDialog.tsx` — "Aktuell temp" label (line 95)**
- When pill-comp is OFF, shows `"Aktuell temp"` — should be `"Aktuell (ctrl)"`
- When pill-comp is ON, shows `"Aktuell (snitt)"` — correct

**3. `RaptControllerDialog.tsx` — "Måltemperatur" label (line 110)**  
- When pill-comp is OFF, shows `"Måltemperatur"` — should be `"Mål (ctrl)"`
- When pill-comp is ON, shows `"Mål (snitt)"` — correct

**4. `RaptControllerDialog.tsx` — sub-label "Inbyggd sensor" (line 100)**
- When pill-comp is OFF, shows `"Inbyggd sensor"` — should be consistent, e.g. `"Controller-sensor"`

**5. `RaptControllerDialog.tsx` — temp adjust labels (lines 136, 163)**
- When pill-comp is OFF, says `"Ändra måltemperatur"` / `"Sätt måltemperatur"` — should be `"Ändra ctrl-mål"` / `"Sätt ctrl-mål"`

**6. `RaptControllersManagement.tsx` — "Aktuell" and "Mål" labels (lines 126, 132)**
- Always shows just `"Aktuell"` and `"Mål"` regardless of pill-comp state
- Should show `"Aktuell (snitt)"` / `"Mål (snitt)"` or `"Aktuell (ctrl)"` / `"Mål (ctrl)"`

**7. `ControllerTempChart.tsx` — Legend labels (lines 79, 84)**
- Always says `"Aktuell"` / `"Aktuell temp"` and `"Mål"` / `"Måltemp"`
- These are fine as-is since the chart always shows probe data from the controller history

**8. `TempStat.tsx` (brew card) — `tempLabel` from `getActualTempLabel` (line 30)**
- Returns `"(probe)"` when pill-comp OFF — should be `"(ctrl)"`

**9. `StepExecutionDisplay.tsx` — labels "Måltemp" and "Aktuell" (lines 78, 85)**
- These are profile-context labels in fermentation view. The `currentTemp` passed here is already the SSOT value (snitt or ctrl depending on pill-comp). No `pillCompEnabled` prop is available to differentiate the label. Should add context.

### No issues (correct already)
- `getActualTemp()` logic — correct (returns average when pill-comp ON, probe when OFF)
- `getDisplayTarget()` — correct (shows profile target as SSOT)
- `AutoCoolingDecisionLogs.tsx` — correct (explicitly says "medel" / "probe" / "pill")
- `FermentationSessionCompact.tsx` — temperature display shows targets from profile, not raw sensor labels

### Plan

1. **Update `getActualTempLabel()`** — change `"(probe)"` to `"(ctrl)"`
2. **Update `RaptControllerDialog.tsx`** — change inactive labels from "Aktuell temp" → "Aktuell (ctrl)", "Måltemperatur" → "Mål (ctrl)", "Inbyggd sensor" → "Ctrl-sensor", "Ändra måltemperatur" → "Ändra ctrl-mål", "Sätt måltemperatur" → "Sätt ctrl-mål"
3. **Update `RaptControllersManagement.tsx`** — pass `pillCompEnabled` to determine "Aktuell (snitt)"/"Aktuell (ctrl)" and "Mål (snitt)"/"Mål (ctrl)" labels. Note: this component already receives `pillCompEnabled` as a prop.
4. **`StepExecutionDisplay.tsx`** — add `pillCompEnabled` prop and update "Måltemp" → "Mål (snitt)"/"Mål (ctrl)" and "Aktuell" → context-aware label. This requires threading `pillCompEnabled` through `ActiveFermentationSession` → `StepExecutionDisplay`.

