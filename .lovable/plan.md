

## Audit: `current_temp` → `actual_temp` SSOT cleanup

### Problem
`current_temp` (raw probe reading) leaks into UI and logic where `actual_temp` (the fused SSOT value) should be used. This causes incorrect temperatures to display and incorrect decisions in places like cooling detection.

### Scope
The DB column `current_temp` on `rapt_temp_controllers` stays — it stores the raw probe value from RAPT hardware. The rename to `probe_temp` is a separate future task. This plan ensures **no consumer reads `current_temp` directly** except as a diagnostic/raw detail.

### Files to change

**1. `src/types/brew.ts` — TempController interface**
- Add `actual_temp: number | null` field
- Keep `current_temp` but document it as raw probe (internal only)

**2. `src/components/RaptControllerDialog.tsx` — local TempController interface**
- Add `actual_temp: number | null`
- Remove `(currentController as any).actual_temp` cast on line 59 — use typed field directly

**3. `src/hooks/use-controller-dialog.ts` (lines 248-256)**
- Change `ctrl.current_temp` → `ctrl.actual_temp ?? ctrl.current_temp` for `isActivelyCooling` / `isActivelyHeating` detection

**4. `src/components/DashboardHeader.tsx` (line 308)**
- Remove `(controller as any).actual_temp` cast — use typed `controller.actual_temp` directly

**5. `src/components/fermentation/StartFermentationSessionDialog.tsx` (lines 97, 330)**
- Add `actual_temp` to the select query
- Display `actual_temp` instead of `current_temp` in controller dropdown

**6. `src/components/AutomationFeatureStatus.tsx` (lines 118-120)**
- Use `actual_temp` instead of `current_temp` for cooler status display

**7. `src/hooks/use-settings-data.ts`**
- Already fetches `actual_temp` — just ensure the mapped interface uses it for display logic

**8. `src/hooks/use-brew-data.ts` (lines 250, 382, 556-558)**
- `controller_current_temp` mapping: use `actual_temp` as primary
- `currentTemp` from `brew_readings.current_temp`: this is brew pill temp, different context — leave as-is (this is the RAPT pill reading stored on the brew, not the controller probe)

**9. `src/hooks/use-brew-page.ts` (line 106)**
- Use `actual_temp` instead of `current_temp` for `controller_current_temp`

**10. `src/types/fermentation.ts` — FermentationSessionData**
- Rename `controller_current_temp` → keep it but populate from `actual_temp`

**11. `src/hooks/use-controllers-management.ts`**
- Add `actual_temp` to interface and select query

### Not changed (correct usage)
- `brew_readings.current_temp` — this is the pill/brew temperature, not the controller probe. Different domain.
- `temp_controller_history.current_temp` — historical data, stays as-is
- `brew_data_snapshots.controller_temp` — historical, stays
- Backend `sync-rapt-data-quick` writing `current_temp` from RAPT API — this is step 1 (raw intake), correct
- Backend `controller-adjustments.ts` — already uses `actual_temp` with fallback, correct

### Result
- All UI components display `actual_temp` (fused SSOT)
- Raw `current_temp` only shown as diagnostic detail (e.g. "Probe: X°" subtitle)
- No more `(x as any).actual_temp` casts — properly typed throughout

