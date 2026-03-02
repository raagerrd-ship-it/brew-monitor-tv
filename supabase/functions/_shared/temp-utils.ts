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
 * For batched updates, use RaptUpdateBatch instead.
 * Optionally accepts a pre-fetched access_token to avoid redundant RAPT auth.
 */
export async function setControllerTargetTemp(
  supabaseUrl: string,
  serviceRoleKey: string,
  controllerId: string,
  targetTemp: number,
  timeoutMs: number = 10000,
  accessToken?: string | null
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
        ...(accessToken ? { access_token: accessToken } : {}),
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
            ...(accessToken ? { access_token: accessToken } : {}),
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

// ============================================================
// Batched RAPT Updates
//
// Collects target temperature changes and flushes them in parallel
// with a single shared auth token. Saves ~2-4s per automation cycle
// by eliminating per-call auth overhead and sequential execution.
// ============================================================

interface PendingRaptUpdate {
  controllerId: string
  targetTemp: number
}

/**
 * Collects RAPT controller target temperature updates and sends them
 * in parallel with a single shared auth token.
 *
 * Usage:
 *   const batch = new RaptUpdateBatch()
 *   batch.add('controller-1', 18.5)
 *   batch.add('controller-2', 20.0)
 *   const results = await batch.flush()
 */
export class RaptUpdateBatch {
  private pending: PendingRaptUpdate[] = []
  private applied: Map<string, number> = new Map()
  private preAuthToken: string | null = null

  /**
   * Optionally provide a pre-fetched RAPT access token to avoid
   * a redundant auth call during flush().
   */
  constructor(accessToken?: string) {
    if (accessToken) this.preAuthToken = accessToken
  }

  /** Queue a target temp update. If same controller is added twice, last value wins. */
  add(controllerId: string, targetTemp: number): void {
    const existing = this.pending.find(p => p.controllerId === controllerId)
    if (existing) {
      existing.targetTemp = targetTemp
    } else {
      this.pending.push({ controllerId, targetTemp })
    }
  }

  get size(): number {
    return this.pending.length
  }

  /** Look up the target temp that was queued (and applied) for a controller */
  getAppliedTarget(controllerId: string): number | undefined {
    return this.applied.get(controllerId)
  }

  /**
   * Send all queued updates in parallel using a single RAPT auth token.
   * Returns a map of controllerId → success boolean.
   */
  async flush(timeoutMs: number = 10000): Promise<Map<string, boolean>> {
    const resultMap = new Map<string, boolean>()
    if (this.pending.length === 0) return resultMap

    console.log(`🔄 Flushing ${this.pending.length} RAPT update(s) in parallel...`)

    let accessToken = this.preAuthToken

    // Only fetch a new token if none was provided
    if (!accessToken) {
      const RAPT_USERNAME = Deno.env.get('RAPT_USERNAME')
      const RAPT_API_SECRET = Deno.env.get('RAPT_API_SECRET')
      if (!RAPT_USERNAME || !RAPT_API_SECRET) {
        console.error('RAPT credentials not configured for batch update')
        for (const p of this.pending) resultMap.set(p.controllerId, false)
        return resultMap
      }

      try {
        const formData = new URLSearchParams()
        formData.append('client_id', 'rapt-user')
        formData.append('grant_type', 'password')
        formData.append('username', RAPT_USERNAME)
        formData.append('password', RAPT_API_SECRET)

        const authBaseUrl = Deno.env.get('RAPT_AUTH_BASE_URL') || 'https://id.rapt.io'
        const authRes = await fetch(`${authBaseUrl}/connect/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData.toString(),
          signal: AbortSignal.timeout(15000),
        })

        if (!authRes.ok) {
          const errText = await authRes.text()
          console.error(`RAPT batch auth failed: ${authRes.status} ${errText}`)
          for (const p of this.pending) resultMap.set(p.controllerId, false)
          return resultMap
        }

        const authData = await authRes.json()
        accessToken = authData.access_token
      } catch (authErr) {
        console.error('RAPT batch auth error:', authErr)
        for (const p of this.pending) resultMap.set(p.controllerId, false)
        return resultMap
      }
    } else {
      console.log('🔑 Using pre-authenticated RAPT token for batch flush')
    }

    // Fire all updates in parallel
    const apiBaseUrl = Deno.env.get('RAPT_API_BASE_URL') || 'https://api.rapt.io'
    const results = await Promise.allSettled(
      this.pending.map(async ({ controllerId, targetTemp }) => {
        const url = `${apiBaseUrl}/api/TemperatureControllers/SetTargetTemperature?temperatureControllerId=${encodeURIComponent(controllerId)}&target=${targetTemp}`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        })

        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`RAPT API ${res.status}: ${errText}`)
        }

        // RAPT API returns true for actual change, false for no-op (already at target)
        // Both are successful — the hardware is at the desired temperature
        await res.json()
        return { controllerId, success: true }
      })
    )

    // Process results
    for (let i = 0; i < this.pending.length; i++) {
      const p = this.pending[i]
      const r = results[i]
      if (r.status === 'fulfilled' && r.value.success) {
        resultMap.set(p.controllerId, true)
        this.applied.set(p.controllerId, p.targetTemp)
        console.log(`✅ ${p.controllerId} → ${p.targetTemp}°C`)
      } else {
        resultMap.set(p.controllerId, false)
        const errMsg = r.status === 'rejected' ? String(r.reason) : 'API returned false'
        console.error(`❌ ${p.controllerId}: ${errMsg}`)
      }
    }

    console.log(`🔄 Batch complete: ${[...resultMap.values()].filter(v => v).length}/${this.pending.length} succeeded`)
    this.pending = []
    return resultMap
  }
}

// Re-export PID compensation types and functions for backward compatibility
export type { PillCompensationSettings } from './pid-compensation.ts'
export { calculateCompensatedTarget, learnThermalRate, learnGlycolCoolerRate, getGlycolRatesSummary, loadPillCompSettings } from './pid-compensation.ts'
