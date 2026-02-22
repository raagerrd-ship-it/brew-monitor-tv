import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================================================
// Shared interfaces
// ============================================================

export interface ProfileStep {
  id: string
  profile_id: string
  step_order: number
  step_type: 'ramp' | 'hold' | 'wait_for_gravity_stable' | 'wait_for_sg' | 'wait_for_temp' | 'wait_for_acknowledgement'
  target_temp: number | null
  duration_hours: number | null
  ramp_type: 'linear' | 'immediate' | null
  gravity_stable_days: number | null
  gravity_threshold: number | null
  target_sg: number | null
  sg_comparison: 'at_or_below' | 'at_or_above' | null
  notes: string | null
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
}

export interface PillCompensationSettings {
  enabled: boolean
  rateLimit: number
  emergencyThreshold: number
  minScale: number
  maxCompensation: number
  anticipationWindowHours: number
}

// ============================================================
// Shared utility functions
// ============================================================

/** Round to 1 decimal place, null-safe */
export function round1(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null
  return parseFloat(parseFloat(String(v)).toFixed(1))
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
 * Calculate pill-compensated target temperature.
 * Targets the AVERAGE of pill (surface) and probe (core) to equal the profile goal.
 * Formula: compensatedTarget = profileTarget - avgDelta/2
 */
export async function calculateCompensatedTarget(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
  profileTarget: number,
  currentControllerTarget: number,
  controllerName: string,
  settings: PillCompensationSettings
): Promise<{ compensatedTarget: number; compensation: number; avgDelta: number } | null> {
  const { rateLimit: maxChangePerCycle, emergencyThreshold, minScale: minScaleFactor, maxCompensation, anticipationWindowHours } = settings

  // Fetch last 8 delta measurements (≈40 min at 5-min intervals) including pill_temp and timestamp
  const { data: deltaHistory } = await supabase
    .from('temp_delta_history')
    .select('delta, pill_temp, controller_temp, recorded_at')
    .eq('controller_id', controllerId)
    .order('recorded_at', { ascending: false })
    .limit(8)

  if (!deltaHistory || deltaHistory.length === 0) {
    return null
  }

  const deltas = deltaHistory.map((d: any) => parseFloat(String(d.delta)))
  const avgDelta = deltas.reduce((sum: number, d: number) => sum + d, 0) / deltas.length

  // Only compensate when pill is warmer than probe (positive delta)
  if (avgDelta <= 0) {
    return null
  }

  // === D-term: calculate pill rate and damping factor ===
  let dampingFactor = 1.0
  let _pillRate: number | null = null
  let _etaMinutes: number | null = null
  const ANTICIPATION_WINDOW_HOURS = anticipationWindowHours // configurable via settings

  if (deltaHistory.length >= 3) {
    const newest = deltaHistory[0]
    const oldest = deltaHistory[deltaHistory.length - 1]
    const pillNow = parseFloat(String(newest.pill_temp))
    const pillOld = parseFloat(String(oldest.pill_temp))
    const ctrlNow = parseFloat(String(newest.controller_temp))
    const timeDiffMs = new Date(newest.recorded_at).getTime() - new Date(oldest.recorded_at).getTime()
    const timeDiffHours = timeDiffMs / (1000 * 60 * 60)

    if (timeDiffHours > 0.05) { // at least ~3 min of data
      const pillRate = (pillNow - pillOld) / timeDiffHours // °C/hour (negative = cooling)
      _pillRate = pillRate

      // The goal is for the AVERAGE of pill and probe to equal profileTarget
      const currentAvg = (pillNow + ctrlNow) / 2
      const avgDistance = currentAvg - profileTarget

      // Only apply damping when average is above target and pill is moving toward it
      if (avgDistance > 0 && pillRate < -0.1) {
        // ETA based on how fast the average is converging
        // When pill drops, probe rises (controller compensates), so average moves at ~pillRate/2
        const avgRate = Math.abs(pillRate) / 2
        const etaHours = avgDistance / avgRate
        _etaMinutes = Math.round(etaHours * 60)
        dampingFactor = Math.min(1.0, Math.max(0.2, etaHours / ANTICIPATION_WINDOW_HOURS))
        console.log(`🌡️ D-term ${controllerName}: pillRate=${pillRate.toFixed(2)}°C/h, avg=${currentAvg.toFixed(1)}°C→${profileTarget}°C (dist=${avgDistance.toFixed(1)}), avgRate=${avgRate.toFixed(2)}°C/h, ETA=${_etaMinutes}min, damping=${dampingFactor.toFixed(2)}`)
      } else {
        _etaMinutes = null
        console.log(`🌡️ D-term ${controllerName}: pillRate=${pillRate.toFixed(2)}°C/h, avg=${((pillNow + ctrlNow) / 2).toFixed(1)}°C vs mål=${profileTarget}°C (ej mot mål eller för långsam), damping=1.0`)
      }
    }
  }

  // Target average: compensate by half the delta, scaled by damping factor
  const rawCompensation = avgDelta / 2
  const compensation = rawCompensation * dampingFactor

  // P-term: if the current average is below the profile target, reduce compensation
  // to push the controller target UP and drive convergence faster
  const latestPillForAvg = parseFloat(String(deltaHistory[0].pill_temp))
  const latestCtrlForAvg = parseFloat(String(deltaHistory[0].controller_temp))
  const currentAvgForError = (latestPillForAvg + latestCtrlForAvg) / 2
  const avgError = profileTarget - currentAvgForError // positive when below target
  let errorCorrection = 0
  if (avgError > 0.2) {
    // Apply proportional correction capped at 1.5°C
    errorCorrection = Math.min(avgError * 0.8, 1.5)
    console.log(`📈 P-term ${controllerName}: medel=${currentAvgForError.toFixed(1)}°C under mål=${profileTarget}°C (fel=${avgError.toFixed(2)}°C), korrigering=+${errorCorrection.toFixed(2)}°C`)
  }

  let compensatedTarget = profileTarget - compensation + errorCorrection

  // Safety floor: never more than maxCompensation below profile target
  compensatedTarget = Math.max(profileTarget - maxCompensation, compensatedTarget)

  // Asymmetric rate limit: strict upward (to avoid triggering heater), normal downward
  const diff = compensatedTarget - currentControllerTarget
  const distanceFromIdeal = Math.abs(diff)
  const isIncreasing = diff > 0 // target going UP = releasing compensation

  {
    const scaleFactor = Math.min(1.0, Math.max(minScaleFactor, distanceFromIdeal / 2.0))
    // Upward changes (releasing compensation) use a tighter limit to avoid triggering heater
    // BUT: if the average temp is BELOW the profile target, we WANT more heating — use normal limit
    const latestPill = parseFloat(String(deltaHistory[0].pill_temp))
    const latestCtrl = parseFloat(String(deltaHistory[0].controller_temp))
    const currentAvg = (latestPill + latestCtrl) / 2
    const avgBelowTarget = currentAvg < profileTarget - 0.2
    const upwardLimit = avgBelowTarget ? maxChangePerCycle : 0.3
    const baseLimit = isIncreasing ? Math.min(maxChangePerCycle * scaleFactor, upwardLimit) : maxChangePerCycle * scaleFactor
    if (avgBelowTarget && isIncreasing) {
      console.log(`🔥 Medel (${currentAvg.toFixed(1)}°) under mål (${profileTarget}°) — släpper uppåt-limit till ${upwardLimit}°C/cykel`)
    }
    if (distanceFromIdeal > baseLimit) {
      compensatedTarget = currentControllerTarget + (isIncreasing ? baseLimit : -baseLimit)
      console.log(`🎯 Rate-limit (${isIncreasing ? '↑ strikt' : '↓ normal'}): ${baseLimit.toFixed(2)}°C (scale=${scaleFactor.toFixed(2)}, max=${maxChangePerCycle})`)
    }
  }

  // Round to 1 decimal
  compensatedTarget = Math.round(compensatedTarget * 10) / 10

  // Skip if change is negligible (< 0.1°C)
  if (Math.abs(compensatedTarget - currentControllerTarget) < 0.1) {
    console.log(`🎯 Pill-kompensation för ${controllerName}: redan nära mål (${currentControllerTarget}°C ≈ ${compensatedTarget}°C), skippar`)
    return null
  }

  console.log(`🎯 Pill-kompensation för ${controllerName}: profil=${profileTarget}°C, avgDelta=${avgDelta.toFixed(2)}°C, rawKomp=${rawCompensation.toFixed(2)}°C, damping=${dampingFactor.toFixed(2)}, komp=${compensation.toFixed(2)}°C, ny target=${compensatedTarget}°C (nuvarande=${currentControllerTarget}°C)`)

  return { compensatedTarget, compensation, avgDelta, dampingFactor, pillRate: _pillRate, etaMinutes: _etaMinutes }
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
    console.error(`Error setting temperature for ${controllerId}: ${isTimeout ? `Timeout after ${timeoutMs}ms` : String(error)}`)
    return false
  }
}

/**
 * Load pill compensation settings from auto_cooling_settings.
 */
export async function loadPillCompSettings(
  supabase: ReturnType<typeof createClient>
): Promise<PillCompensationSettings> {
  const { data: acSettings } = await supabase
    .from('auto_cooling_settings')
    .select('pill_compensation_enabled, pill_compensation_rate_limit, pill_compensation_emergency_threshold, pill_compensation_min_scale, pill_compensation_max_compensation, pill_compensation_damping')
    .limit(1)
    .maybeSingle()

  return {
    enabled: (acSettings as any)?.pill_compensation_enabled ?? true,
    rateLimit: parseFloat(String((acSettings as any)?.pill_compensation_rate_limit ?? 0.8)),
    emergencyThreshold: parseFloat(String((acSettings as any)?.pill_compensation_emergency_threshold ?? 3.0)),
    minScale: parseFloat(String((acSettings as any)?.pill_compensation_min_scale ?? 0.15)),
    maxCompensation: parseFloat(String((acSettings as any)?.pill_compensation_max_compensation ?? 5.0)),
    anticipationWindowHours: parseFloat(String((acSettings as any)?.pill_compensation_damping ?? 1.0)),
  }
}
