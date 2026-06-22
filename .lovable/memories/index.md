# Project Memory

## Core
- `actual_temp` is the Single Source of Truth (SSOT), set per controller via `dual_sensor_enabled` + `preferred_sensor` (avg / probe / pill). Never recompute elsewhere. Temps use 2 decimals, else 1.
- `profile_target_temp` MUST NOT be overwritten by automation. Always send `source: automation` in RAPT API calls.
- RAPT Hardware bounds: Max -10°C lower limit. No `SetHeatingEnabled` via API. Match devices strictly by `paired_device_id`.
- Hardware suppressions: +2°C above probe to suppress cooling, -2°C below probe to suppress heating during PWM off phases.
- Never use hard reloads (`window.location.reload()`) on interactive devices to prevent layout jumps.
- UI rules: Glassmorphism (65-85% opacity), Inter font, desktop scaled to 16:9. Mute the 2nd decimal in temperature displays.
- Active Controllers: **Mjöd** (Green: `6fbbc7db`), **Skogens Sus** (Blå: `ffa62be4`). Both run average-SSOT (`dual_sensor_enabled=true`) so UI/DB `actual_temp` is the probe+pill average, while the V3 PID regulates against the fresh observer-corrected bulk average every minute. Focus automation/AI on these.
- PID is V3 (observer + mode-keyed gradient k + asymmetric gains + cooling-only predictive brake + stratification guards). Per-minute loop, no V2 stale-branch.

## Memories

### Architecture & Data
- [App Stability](mem://architecture/app-stability/reload-restrictions) — No hard reloads; prioritize session retention.
- [Daily Reboot](mem://architecture/app-stability/controller-reboot-strategy) — Shelly Plug S daily reboot at 05:00.
- [SSOT Actual Temp](mem://architecture/data/actual-temp-ssot-enforcement) — Enforce `actual_temp` as SSOT globally.
- [Snapshot Thinning](mem://architecture/data/snapshot-thinning-policy) — Thin snapshots to ~500 rows per brew.
- [Retention Policy](mem://architecture/data/retention-and-cleanup-policy) — 24h decisions, 7d history, 30d audit logs.
- [SG Data](mem://architecture/data/sg-data-migration) — Deprecated `sg_data` for `brew_data_snapshots`.
- [Learning Precision](mem://architecture/data/learning-data-management) — 6 decimal precision for <0.01 parameters.
- [PID Persistency](mem://architecture/automation/pid-state-persistence-policy) — Always persist PID state to prevent runaway logic.
- [Public Access](mem://architecture/api/public-data-access) — `get-public-rapt-data` uses sequence: share_id -> batch_id -> id.
- [Step Logic](mem://architecture/fermentation/isolated-step-logic) — 7-day limits, SG stability requirements.
- [Hardware Mode Guard](mem://logic/automation/hardware-capability-mode-guard) — Force PID mode to match physical capabilities.
- [Local-First Pi](mem://architecture/local-first/pi-migration-plan) — Offline Pi #2 node/SQLite setup and delta syncs.

### RAPT Integration
- [API Resilience](mem://architecture/rapt/api-retry-and-cleanup-logic) — 3-retry loops, delays on 404/502/503.
- [Token Caching](mem://performance/rapt/token-caching-logic) — 60min token cache, 10min refresh threshold, 45s timeouts.
- [Decoupling](mem://architecture/rapt/system-decoupling-controller-vs-cooler) — Separate controller adjustment from cooler logic.
- [Sync Guard](mem://architecture/rapt/sync-concurrency-guard) — 30s lock, full sync reservations block cron.
- [Persistence Rule](mem://architecture/rapt/profile-target-persistence-rule) — Automation never saves target back to DB.
- [Telemetry Latency](mem://architecture/rapt/telemetry-reporting-latency) — 15m intervals, zero Proportional (P) on stale data.
- [Hardware Suppression](mem://architecture/rapt/hardware-suppression-and-hysteresis) — Suppress internal thermostat during PWM OFF.
- [Wide Hysteresis Intentional](mem://architecture/rapt/intentional-wide-hysteresis) — 5°C cooling_hysteresis is deliberate; never suggest lowering.
- [API Scope](mem://architecture/rapt/sync-resilience-and-scope) — Brewfather logic removed, custom_ manual brews only.
- [Config Sync](mem://architecture/rapt/configuration-synchronization) — Read hysteresis daily via API.

### Automation & PID
- [PID V3 Observer](mem://architecture/automation/pid-v3-observer) — V3 core: observer-fused bulk temp, mode-keyed gradient k (cooling 1.3 / heating 0.7), asymmetric gains, cooling-only predictive brake, stratification guards. Replaces V2.
- [Safety Hardening](mem://architecture/automation/safety-and-integrity-hardening) — MODE_GUARD bounds, hardware revert fallback.
- [Manual Override](mem://architecture/automation/manual-override-detection-guards) — Ignore PWM bursts (0°C/max), 0.25°C tolerance.
- [Three-Phase Sync](mem://architecture/automation/three-phase-sync-model) — Metadata, Analyze (inline sub-funcs), Flush/History.
- [PWM Execution](mem://architecture/automation/pwm-execution-and-scheduling) — Fixed hardware targets: -5°C/40°C. 2-cycle A/B model.
- [Control Loop](mem://architecture/automation/control-loop-layering) — PID runs on `actualTarget` and the fresh observer bulk average (`controlTemp`), not raw `actualTemp`.
- [Hardware Guards](mem://architecture/automation/hardware-command-integrity-guards) — 6 layers of protection for commands.
- [Performance](mem://architecture/automation/performance-and-batching) — Batch fermentation fetches, parallel utilisation eval.
- [Temp Interpolation](mem://architecture/automation/temperature-interpolation) — Interpolate temps based on duty ratio and ambient drift.
- [Cooler Margin](mem://logic/automation/marginal-aware-duty-scaling) — Scale duty based on learned vs actual glycol margin.
- [Margin Hard Floor](mem://logic/automation/cooler-margin-hard-floor) — 5.0°C absolute minimum cooler margin.
- [PWM Dithering](mem://logic/automation/pwm-dithering-resolution-bypass) — 10-slot rotation (50m) for 1% PWM resolution.
- [Mode Switching](mem://logic/automation/mode-switching-logic) — Require 3 stable cycles or immediate if override/delta > 1°C.
- [Ramp Limiting](mem://logic/automation/ramp-rate-limiting) — Limit effective target to 4.0°C/h cool, 3.0°C/h heat.
- [Virtual Profile](mem://logic/automation/virtual-profile-target-and-revert-logic) — Hard targets update only when duty is 0%.
- [Phase ssFloor](mem://logic/automation/phase-keyed-ssfloor) — ssFloor keyed per fermentation phase (active/tail/clean) with mode-keyed fallback + seeding; floor learning frozen during ramps.
- [AI Audit Constraints](mem://features/automation/ai-audit-context-and-data-constraints) — Restrict payloads to avoid hallucinations.
- [AI Engine](mem://features/automation/ai-audit-and-optimization-engine) — Whitelisted active PID parameters only.

### UI & UX
- [Dashboard Background](mem://architecture/ui/dashboard-background-component) — Isolated bg component via context.
- [Self Contained Hooks](mem://architecture/ui/self-contained-feature-components) — UI widgets manage own Supabase subscriptions.
- [Dashboard Footer](mem://architecture/ui/dashboard-footer-and-alert-systems) — Generic slot-based footer reservation.
- [Mobile Footer](mem://ui/layout/mobile-footer-compensation) — Dynamic paddingBottom for bottom panels.
- [TV Constraints](mem://architecture/tv-mode/hardware-performance-constraints) — Maintain heavy GPU CSS on Chromecast.
- [TV Charts Engine](mem://ui/tv-mode/chart-engine-strategy) — Recharts by default via tv-use-recharts, SVG fallback.
- [Unified Header](mem://ui/header/unified-layout-and-styling) — 180px desktop, 140px mobile with dark bg overlay.
- [PID UI Source](mem://ui/automation/pid-metric-representation) — Display 'pid_last_duty' direct from DB, no parsing.
- [Learned Metrics](mem://ui/dashboard/learned-metrics-visualization) — Visual seg-bar (Yellow >40%, Red >60%).
- [Chart Grouping](mem://ui/charts/history-visibility-and-grouping) — Combined charts hide controllers by default.
- [Temp Smoothing](mem://features/charts/visual-smoothing-rounding-precision) — 2 decimals Actual_temp, 1 decimal others in Recharts.
- [Setting Sync](mem://features/charts/persistent-settings-sync) — Real-time sync of dashboard configurations.
- [Pi Touch UI](mem://ui/local-first/touch-dashboard-layout) — 1024x600 7-inch kiosk layout via `/local`.
- [BLE Print Overlay](mem://features/printing/ble-debug-overlay) — Phomemo debugger TX/RX overlay via 🐛 icon.

### Features
- [Activity Score](mem://features/fermentation/activity-score-hybrid-logic) — 6h window hybrid SG & temp delta formula.
- [Step Ramp Logic](mem://features/fermentation/profile-and-step-execution-logic) — Start ramp at 35% activity, finish at 5%.
- [SG Comp Logic](mem://features/fermentation/sg-temperature-correction-logic) — Adaptive residual EMA for temp corr.
- [Web Push Setup](mem://features/notifications/web-push-vapid-infrastructure) — Vite injectManifest with DB vapid keys.
- [Shared Timers](mem://features/local-alarm-timer/shared-timer-system) — `shared_timer` singleton table atomic updates.
- [Outage Tracking](mem://features/monitoring/controller-outage-tracking) — 50min stale detection, `sensor_offline` alerts.
- [Manual Edits](mem://features/fermentation/manual-data-management) — CustomBrewDialog truncates snapshot rows permanently.

### Sonos
- [Bridge Sync](mem://architecture/sonos/bridge-integration-and-sync) — Cast Away proxy, UPnP cloud push.
- [Storage Rules](mem://architecture/sonos/storage-configuration) — Anon UPSERTs, bridge-current exempt from cleanup.
- [Visual Caching](mem://features/sonos/visuals-and-caching) — Deterministic LRU backgrounds, marquee 8s +0.05s/px.
- [Widget State](mem://features/sonos/widget-visibility-and-state) — Hide if paused for 30s. Stale detection 2s.
- [Snapping Flow](mem://ui/sonos/visual-sync-behavior) — No CSS transition on progress bar.
- [Performance Tracking](mem://features/sonos/performance-monitoring-and-optimization) — Track bg_generation_ms, 30s dog throttle.