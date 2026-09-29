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
// Stale Sensor Guard (Safety)
// Prevents acting on sensor data older than a threshold.
// ============================================================

const STALE_SENSOR_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes (RAPT-only fallback)

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

