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
}

export interface TempController {
  controller_id: string
  name: string
  current_temp: number | null
  pill_temp: number | null
  target_temp: number | null
  cooling_enabled: boolean | null
  heating_enabled: boolean | null
  cooling_hysteresis: number | null
  min_target_temp: number | null
  max_target_temp: number | null
  last_update: string | null
  profile_target_temp: number | null
}

// ============================================================
// Shared utility functions
// ============================================================

/** Round to 1 decimal place, null-safe */
export function round1(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null
  return parseFloat(parseFloat(String(v)).toFixed(1))
}

// ============================================================
// Stale Sensor Guard (Safety)
// Prevents acting on sensor data older than a threshold.
// ============================================================

const STALE_SENSOR_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes

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
    const check = isSensorDataStale(c.last_update, thresholdMs)
    if (check.stale) {
      stale.push(c)
      if (log) {
        log('STALE_SENSOR', 'fail', `${c.name}: Sensor data is ${check.ageMinutes !== null ? `${check.ageMinutes}min old` : 'missing'} — SKIPPING for safety`)
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

/**
 * Set target temperature via the rapt-update-controller edge function.
 * Unified wrapper used by both process-fermentation-profiles and auto-adjust-cooling.
 */
export async function setControllerTargetTemp(
  supabaseUrl: string,
  serviceRoleKey: string,
  controllerId: string,
  targetTemp: number,
  timeoutMs: number = 10000
): Promise<boolean> {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/rapt-update-controller`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        controllerId,
        action: 'setTargetTemperature',
        value: targetTemp,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Failed to set temperature for ${controllerId}: ${response.status} ${errorText}`)
      return false
    }

    const data = await response.json()
    return data?.success === true
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === 'TimeoutError'
    if (isTimeout) {
      console.warn(`⏱️ Timeout after ${timeoutMs}ms for ${controllerId}, retrying once...`)
      try {
        const retryResponse = await fetch(`${supabaseUrl}/functions/v1/rapt-update-controller`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            controllerId,
            action: 'setTargetTemperature',
            value: targetTemp,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (retryResponse.ok) {
          const data = await retryResponse.json()
          if (data?.success === true) {
            console.log(`✅ Retry succeeded for ${controllerId}`)
            return true
          }
        }
        console.error(`❌ Retry also failed for ${controllerId}`)
        return false
      } catch (retryError) {
        console.error(`❌ Retry failed for ${controllerId}: ${retryError}`)
        return false
      }
    }
    console.error(`Error setting temperature for ${controllerId}: ${String(error)}`)
    return false
  }
}

// Re-export PID compensation types and functions for backward compatibility
export type { PillCompensationSettings } from './pid-compensation.ts'
export { calculateCompensatedTarget, learnThermalRate, learnGlycolCoolerRate, getGlycolRatesSummary, loadPillCompSettings } from './pid-compensation.ts'
