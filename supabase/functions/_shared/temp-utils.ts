import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================================================
// Shared interfaces
// ============================================================

export interface ProfileStep {
  id: string
  profile_id: string
  step_order: number
  step_type: 'ramp' | 'hold' | 'wait_for_gravity_stable' | 'wait_for_sg' | 'wait_for_temp' | 'wait_for_acknowledgement' | 'diacetyl_rest' | 'gradual_ramp'
  target_temp: number | null
  duration_hours: number | null
  ramp_type: 'linear' | 'immediate' | null
  gravity_stable_days: number | null
  gravity_threshold: number | null
  target_sg: number | null
  sg_comparison: 'at_or_below' | 'at_or_above' | null
  notes: string | null
  attenuation_trigger: number | null
  activity_trigger: number | null
  temp_increase: number | null
  min_ramp_hours: number | null
  ramp_curve: string | null
  stability_window_minutes: number | null
  stability_max_deviation: number | null
}

export interface TempController {
  controller_id: string
  name: string
  current_temp: number | null
  pill_temp: number | null
  actual_temp: number | null
  target_temp: number | null
  cooling_enabled: boolean | null
  heating_enabled: boolean | null
  cooling_hysteresis: number | null
  heating_hysteresis: number | null
  min_target_temp: number | null
  max_target_temp: number | null
  last_update: string | null
  profile_target_temp: number | null
  cooling_run_time: number | null
  cooling_starts: number | null
}

// ============================================================
// Shared utility functions
// ============================================================

/** Round to 1 decimal place, null-safe */
export function round1(v: number | null | undefined): number | null {
  if (v == null) return null
  return Math.round(Number(v) * 10) / 10
}

// ============================================================
// Stale Sensor Guard (Safety)
// Prevents acting on sensor data older than a threshold.
// ============================================================

const STALE_SENSOR_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes (RAPT-only fallback)
const STALE_SENSOR_THRESHOLD_BLE_MS = 8 * 60 * 1000 // 8 minutes (BLE-linked: 1-min cadence)

/** Pick the right freshness threshold per controller. BLE-linked = 8 min, RAPT-only = 30 min. */
function thresholdForController(c: TempController): number {
  return (c as any).linked_pill_id ? STALE_SENSOR_THRESHOLD_BLE_MS : STALE_SENSOR_THRESHOLD_MS
}

/**
 * Check if a controller's sensor data is stale (older than threshold).
 * Returns { stale: true, ageMinutes } if data is too old.
 */
export function isSensorDataStale(
  lastUpdate: string | null | undefined,
  thresholdMs: number = STALE_SENSOR_THRESHOLD_MS
): { stale: boolean; ageMinutes: number | null } {
  if (!lastUpdate) return { stale: true, ageMinutes: null }
  const ageMs = Date.now() - new Date(lastUpdate).getTime()
  const ageMinutes = Math.round(ageMs / 60000)
  return { stale: ageMs > thresholdMs, ageMinutes }
}

/**
 * Filter controllers with stale data, logging warnings.
 * Returns only controllers with fresh data.
 */
export function filterStaleControllers(
  controllers: TempController[],
  log?: (step: string, result: 'pass' | 'fail' | 'info' | 'action', message: string, details?: Record<string, unknown>) => void,
  thresholdMs: number = STALE_SENSOR_THRESHOLD_MS
): { fresh: TempController[]; stale: TempController[] } {
  const fresh: TempController[] = []
  const stale: TempController[] = []
  for (const c of controllers) {
    // Per-controller threshold: BLE-linked controllers get 8 min, RAPT-only 30 min.
    // Caller can still override globally by passing thresholdMs explicitly.
    const effectiveThreshold = thresholdMs === STALE_SENSOR_THRESHOLD_MS
      ? thresholdForController(c)
      : thresholdMs
    const check = isSensorDataStale(c.last_update, effectiveThreshold)
    if (check.stale) {
      stale.push(c)
      if (log) {
        const limitMin = Math.round(effectiveThreshold / 60000)
        log('STALE_SENSOR', 'fail', `${c.name}: Sensor data is ${check.ageMinutes !== null ? `${check.ageMinutes}min old` : 'missing'} (limit ${limitMin}min, ${(c as any).linked_pill_id ? 'BLE' : 'RAPT'}) — SKIPPING for safety`)
      }
    } else {
      fresh.push(c)
    }
  }
  return { fresh, stale }
}

/** Find the effective target temp by looking back through previous steps */
export function getEffectiveTargetTemp(steps: ProfileStep[], currentStepIndex: number): number | null {
  for (let i = currentStepIndex; i >= 0; i--) {
    if (steps[i].target_temp !== null) {
      return steps[i].target_temp
    }
  }
  return null
}
