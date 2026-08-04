---
name: Cloud PID and RAPT control removed
description: All temperature regulation runs locally on the Raspberry Pi; cloud-side PID, auto-cooling and the RAPT control API are permanently deleted.
type: constraint
---
Reglering sker enbart lokalt på Raspberry Pi (V6 PID). Alla fyra enheter — Gul, Blå, Grön och glykolkylaren — har `actuation='pi'`.

Permanent borttaget (återinför aldrig):
- Edge functions: `run-automation`, `auto-adjust-cooling`, `execute-pwm-off`, `pid-hold-verification`, `rapt-update-controller`, `ai-automation-audit`
- Delade moduler: `pid-compensation.ts`, `pid-compensation-claude.ts`, `controller-adjustments.ts`, `cooler-management.ts`, `rapt-circuit-breaker.ts`, `adjustment-logger.ts`, `fermentation-learnings.ts`
- Tabeller: `auto_cooling_settings`, `auto_cooling_adjustments`, `auto_cooling_decision_logs`, `auto_cooling_followed_controllers`, `pending_rapt_retries`, `pid_event_throttle`, `rapt_token_cache`
- Cron: PWM-off (30 s), pid-hold-verification (15 min), AI-audit (6 h), decision-log-rensning

**Kvar:** `rapt_temp_controllers` och `rapt_pills` är fortfarande UI:ts datakälla — Pi:n skriver till dem. Glykolkylaren identifieras via `rapt_temp_controllers.is_glycol_cooler` (inte längre via auto_cooling_settings). `sync-rapt-data-quick` finns kvar men rör inte RAPT-API:t: den gör custom brew-synk, snapshots, historik, jäsprofiler, metrics och systemhälsa från databasen.

**Why:** Pi:n är SSOT för reglering; dubbel styrning från molnet gav konflikter.
