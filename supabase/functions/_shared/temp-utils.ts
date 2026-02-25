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
// Mode-specific PID tuning constants
// Heating elements: fast response, risk of overshoot → conservative gains
// Glycol cooling: slow, high inertia → more aggressive gains needed
const MODE_PARAMS = {
  cooling: {
    pGain: 0.6,           // proportional gain
    iGain: 0.15,          // integral gain per cycle
    iDecay: 0.95,         // integral decay per cycle
    iClamp: 2.0,          // max integral magnitude
    maxRatePerCycle: null, // use settings value (overridden below)
    maxComp: null,         // use settings value
    upwardRelease: 0.3,   // max upward change when releasing comp (°C/cycle)
    convergenceAlpha0: 0.5,// EMA alpha for few samples
    convergenceAlphaN: 0.2,// EMA alpha for many samples
    errorCorrectionCap: 2.5,
  },
  heating: {
    pGain: 0.35,          // lower: heating element reacts fast
    iGain: 0.10,          // lower: avoid integral windup from fast response
    iDecay: 0.90,         // faster decay: element cools quickly when off
    iClamp: 1.5,          // tighter clamp
    maxRatePerCycle: null, // overridden below
    maxComp: null,         // overridden below
    upwardRelease: 0.2,   // tighter release for heating (avoid triggering cooler)
    convergenceAlpha0: 0.4,
    convergenceAlphaN: 0.15,
    errorCorrectionCap: 1.8, // lower cap: heating overshoots are harder to reverse
  },
}

export async function calculateCompensatedTarget(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
  profileTarget: number,
  currentControllerTarget: number,
  controllerName: string,
  settings: PillCompensationSettings,
  mode: 'heating' | 'cooling' = 'cooling',
  stepType: string = 'unknown'
): Promise<{ compensatedTarget: number; compensation: number; avgDelta: number } | null> {
  const { rateLimit: maxChangePerCycle, emergencyThreshold, minScale: minScaleFactor, maxCompensation, anticipationWindowHours } = settings
  const mp = MODE_PARAMS[mode]
  // Mode-specific overrides: heating uses tighter limits
  const effectiveMaxRate = mode === 'heating' ? Math.min(maxChangePerCycle, 0.5) : maxChangePerCycle
  const effectiveMaxComp = mode === 'heating' ? Math.min(maxCompensation, 3.0) : maxCompensation

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
  const absDelta = Math.abs(avgDelta)

  // Only compensate when there IS a meaningful delta between pill and probe
  // Positive delta = pill warmer (cooling scenario)
  // Negative delta = probe warmer (heating scenario — probe closer to heating element)
  if (absDelta < 0.1) {
    return null
  }

  // === D-term: calculate pill rate, damping factor, and use learned thermal rate ===
  let dampingFactor = 1.0
  let _pillRate: number | null = null
  let _etaMinutes: number | null = null
  const ANTICIPATION_WINDOW_HOURS = anticipationWindowHours

  // Fetch learned hardware thermal rate for this mode (non-blocking, cached)
  const learnedThermalRate = await learnThermalRate(supabase, controllerId, mode)

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

      // Apply damping when average is moving TOWARD target (bidirectional)
      // Cooling: avg above target and pill dropping
      // Heating: avg below target and pill rising
      const isConverging = (avgDistance > 0 && pillRate < -0.1) || (avgDistance < 0 && pillRate > 0.1)
      if (Math.abs(avgDistance) > 0.1 && isConverging) {
        // Use learned thermal rate for better ETA if available, otherwise fall back to measured pill rate
        const observedAvgRate = Math.abs(pillRate) / 2
        const hwRate = learnedThermalRate ? learnedThermalRate / 2 : null // hardware rate also affects avg
        // Use the more conservative (slower) of observed vs learned rate for ETA
        const avgRate = hwRate ? Math.min(observedAvgRate, hwRate) : observedAvgRate
        const etaHours = avgRate > 0.01 ? Math.abs(avgDistance) / avgRate : 99
        _etaMinutes = Math.round(etaHours * 60)
        dampingFactor = Math.min(1.0, Math.max(0.2, etaHours / ANTICIPATION_WINDOW_HOURS))
        console.log(`🌡️ D-term ${controllerName} [${mode}]: pillRate=${pillRate.toFixed(2)}°C/h, hwRate=${learnedThermalRate?.toFixed(2) ?? '?'}°C/h, avg=${currentAvg.toFixed(1)}°C→${profileTarget}°C, ETA=${_etaMinutes}min, damping=${dampingFactor.toFixed(2)}`)
      } else {
        _etaMinutes = null
        console.log(`🌡️ D-term ${controllerName}: pillRate=${pillRate.toFixed(2)}°C/h, avg=${((pillNow + ctrlNow) / 2).toFixed(1)}°C vs mål=${profileTarget}°C (ej mot mål eller för långsam), damping=1.0`)
      }
    }
  }

  // Target average: compensate by half the delta, scaled by damping factor
  const rawCompensation = avgDelta / 2
  const compensation = rawCompensation * dampingFactor

  // === Adaptive PI-term: Proportional + Integral + Learned baseline ===
  // Categorize current fermentation phase by delta magnitude
  const deltaBucket = absDelta > 3 ? 'high' : absDelta > 1.5 ? 'medium' : 'low'

  // Query learned baseline for this controller + phase + mode + step_type
  // Fallback: if no per-controller data, try style_key-based cross-batch learning
  let learnedRow: any = null;
  {
    const { data } = await supabase
      .from('controller_learned_compensation')
      .select('learned_pi_correction, convergence_count, accumulated_integral, style_key')
      .eq('controller_id', controllerId)
      .eq('delta_bucket', deltaBucket)
      .eq('mode', mode)
      .eq('step_type', stepType)
      .maybeSingle();
    learnedRow = data;
  }

  // Style-key fallback: if no learned data for this controller, look for same style across all controllers
  if (!learnedRow) {
    // Try to find the style from the active fermentation session's brew
    const { data: sessionData } = await supabase
      .from('fermentation_sessions')
      .select('brew_id')
      .eq('controller_id', controllerId)
      .eq('status', 'running')
      .limit(1)
      .maybeSingle();

    if (sessionData?.brew_id) {
      const { data: brewData } = await supabase
        .from('brew_readings')
        .select('style')
        .eq('id', sessionData.brew_id)
        .maybeSingle();

      if (brewData?.style) {
        const { data: styleRow } = await supabase
          .from('controller_learned_compensation')
          .select('learned_pi_correction, convergence_count, accumulated_integral, style_key')
          .eq('style_key', brewData.style)
          .eq('delta_bucket', deltaBucket)
          .eq('mode', mode)
          .eq('step_type', stepType)
          .order('convergence_count', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (styleRow && (styleRow.convergence_count ?? 0) >= 3) {
          learnedRow = styleRow;
          console.log(`🧬 Style fallback: using learned data from style "${brewData.style}" (n=${styleRow.convergence_count})`);
        }
      }
    }
  }

  const learnedBaseline = learnedRow ? parseFloat(String(learnedRow.learned_pi_correction)) : 0
  const convergenceCount = learnedRow?.convergence_count ?? 0
  const persistedIntegral = learnedRow ? parseFloat(String(learnedRow.accumulated_integral)) : 0

  // === Stale-data detection ===
  // RAPT data only refreshes every ~15 min, but PID runs every ~5 min.
  // If the newest delta reading is the same as last PID run, don't accumulate I-term
  // (otherwise I winds up 3x on identical data before seeing any result).
  const newestDataTime = new Date(deltaHistory[0].recorded_at).getTime()
  const lastPidRunTime = learnedRow?.updated_at ? new Date(learnedRow.updated_at).getTime() : 0
  const isStaleData = lastPidRunTime > 0 && newestDataTime <= lastPidRunTime
  if (isStaleData) {
    console.log(`⏸️ Stale data ${controllerName} [${mode}]: senaste mätning ${new Date(newestDataTime).toISOString()} ≤ senaste PID ${new Date(lastPidRunTime).toISOString()} — hoppar över I-ackumulering`)
  }

  const historicalAvgs = deltaHistory.map((d: any) => {
    const p = parseFloat(String(d.pill_temp))
    const c = parseFloat(String(d.controller_temp))
    return (p + c) / 2
  })
  const currentAvgForError = historicalAvgs[0]
  const avgError = profileTarget - currentAvgForError // positive when below target, negative when above

  let pCorrection = 0
  let iCorrection = 0
  let errorCorrection = 0

  // === Saturation detection: is the hardware already at max capacity? ===
  // If pill rate is ≥80% of learned max rate, don't increase compensation further.
  let isSaturated = false
  if (learnedThermalRate && _pillRate !== null) {
    const absRate = Math.abs(_pillRate)
    const saturationRatio = absRate / learnedThermalRate
    if (saturationRatio >= 0.8) {
      isSaturated = true
      console.log(`⚡ Saturation ${controllerName} [${mode}]: rate=${absRate.toFixed(2)}°C/h ≈ ${(saturationRatio * 100).toFixed(0)}% av max ${learnedThermalRate.toFixed(2)}°C/h — begränsar kompensation`)
    }
  }

  if (avgError > 0.5) {
    // === UNDERSHOOT: avg below target — push controller target down less (= warm up) ===
    pCorrection = avgError * mp.pGain

    // Only accumulate I-term when we have FRESH data (not stale from previous cycle)
    if (isStaleData) {
      iCorrection = persistedIntegral // keep existing, don't grow
      console.log(`📊 I-term ${controllerName} [${mode}]: STALE — behåller integral=${persistedIntegral.toFixed(3)} (ingen ny data)`)
    } else {
      const newIntegral = persistedIntegral * mp.iDecay + avgError * mp.iGain
      iCorrection = Math.max(-mp.iClamp, Math.min(mp.iClamp, newIntegral))
      console.log(`📊 I-term ${controllerName} [${mode}]: integral ${persistedIntegral.toFixed(3)} → ${iCorrection.toFixed(3)} (err=${avgError.toFixed(2)}, gain=${mp.iGain}, decay=${mp.iDecay})`)
    }

    const calculatedPI = pCorrection + iCorrection
    errorCorrection = Math.min(Math.max(calculatedPI, learnedBaseline), mp.errorCorrectionCap)
    
    // D-term damping: when temperature is converging toward target, scale down PI
    // This prevents overshoot by reducing the "push" as we approach the goal
    if (dampingFactor < 1.0) {
      const dampedCorrection = errorCorrection * dampingFactor
      // Never go below learned baseline — that's the steady-state we know works
      errorCorrection = Math.max(dampedCorrection, learnedBaseline)
      console.log(`🎛️ PI damped by D-term: ${calculatedPI.toFixed(2)} × ${dampingFactor.toFixed(2)} = ${errorCorrection.toFixed(2)}°C (baseline=${learnedBaseline.toFixed(2)})`)
    }
    
    // Saturation cap: if hardware is at max rate, freeze the error correction at current level
    // (don't push higher — it won't go faster, and will only cause overshoot later)
    if (isSaturated && errorCorrection > learnedBaseline && learnedBaseline > 0) {
      const prevComp = Math.abs(profileTarget - currentControllerTarget)
      if (errorCorrection > prevComp) {
        errorCorrection = prevComp
        console.log(`⚡ Saturation cap: begränsar PI till ${errorCorrection.toFixed(2)}°C (hårdvaran redan vid max)`)
      }
    }
    
    if (learnedBaseline > 0) {
      console.log(`🧠 Learned baseline ${controllerName} [${deltaBucket}/${stepType}/${mode}]: ${learnedBaseline.toFixed(2)}°C (n=${convergenceCount}), calc PI=${calculatedPI.toFixed(2)}°C, använder=${errorCorrection.toFixed(2)}°C`)
    }
    console.log(`📈 PI-term ${controllerName} [${mode}]: medel=${currentAvgForError.toFixed(1)}°C, mål=${profileTarget}°C, fel=${avgError.toFixed(2)}°C, P=+${pCorrection.toFixed(2)}°C, I=+${iCorrection.toFixed(2)}°C, learned=${learnedBaseline.toFixed(2)}°C, total=+${errorCorrection.toFixed(2)}°C${isSaturated ? ' [SATURATED]' : ''}`)
    // Persist latest PID state for UI visibility
    await supabase.from('controller_learned_compensation').upsert({
      controller_id: controllerId, delta_bucket: deltaBucket, mode, step_type: stepType,
      latest_p_correction: pCorrection, latest_i_correction: iCorrection,
      latest_d_damping: dampingFactor, latest_avg_error: avgError,
      accumulated_integral: iCorrection,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'controller_id,delta_bucket,mode,step_type', ignoreDuplicates: false })
  } else if (avgError < -0.3) {
    // === OVERSHOOT: avg above target — push controller target down more ===
    pCorrection = avgError * mp.pGain // negative value

    if (isStaleData) {
      iCorrection = persistedIntegral
      console.log(`📊 I-term overshoot ${controllerName} [${mode}]: STALE — behåller integral=${persistedIntegral.toFixed(3)}`)
    } else {
      const newIntegral = persistedIntegral * mp.iDecay + avgError * mp.iGain
      iCorrection = Math.max(-mp.iClamp, Math.min(mp.iClamp, newIntegral))
      console.log(`📊 I-term overshoot ${controllerName} [${mode}]: integral ${persistedIntegral.toFixed(3)} → ${iCorrection.toFixed(3)} (err=${avgError.toFixed(2)})`)
    }

    errorCorrection = Math.max(pCorrection + iCorrection, -mp.errorCorrectionCap)
    
    // D-term damping for overshoot correction too
    if (dampingFactor < 1.0) {
      const dampedCorrection = errorCorrection * dampingFactor
      errorCorrection = Math.min(dampedCorrection, 0) // keep it negative (correcting down)
      console.log(`🎛️ PI overshoot damped by D-term: ${(pCorrection + iCorrection).toFixed(2)} × ${dampingFactor.toFixed(2)} = ${errorCorrection.toFixed(2)}°C`)
    }
    
    // Saturation cap for overshoot correction too
    if (isSaturated && errorCorrection < 0) {
      const prevComp = profileTarget - currentControllerTarget  // negative when correcting down
      if (errorCorrection < prevComp && prevComp < 0) {
        errorCorrection = prevComp
        console.log(`⚡ Saturation cap (overshoot): begränsar PI till ${errorCorrection.toFixed(2)}°C`)
      }
    }
    
    console.log(`📉 PI-term overshoot ${controllerName} [${mode}]: medel=${currentAvgForError.toFixed(1)}°C, mål=${profileTarget}°C, fel=${avgError.toFixed(2)}°C, P=${pCorrection.toFixed(2)}°C, I=${iCorrection.toFixed(2)}°C, total=${errorCorrection.toFixed(2)}°C${isSaturated ? ' [SATURATED]' : ''}`)
    // Persist latest PID state for UI visibility
    await supabase.from('controller_learned_compensation').upsert({
      controller_id: controllerId, delta_bucket: deltaBucket, mode, step_type: stepType,
      latest_p_correction: pCorrection, latest_i_correction: iCorrection,
      latest_d_damping: dampingFactor, latest_avg_error: avgError,
      accumulated_integral: iCorrection,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'controller_id,delta_bucket,mode,step_type', ignoreDuplicates: false })
  } else if (avgError > -0.5 && avgError <= 0.5) {
    // === CONVERGENCE: avg is within ±0.5° of target — update learned baseline ===
    // Decay integral toward zero at convergence (anti-windup reset)
    const decayedIntegral = persistedIntegral * 0.8
    
    // Use the current total compensation as the "what worked" value
    // For cooling: target is BELOW profile (positive totalComp)
    // For heating: target is ABOVE profile (negative totalComp → use abs)
    const totalCompApplied = Math.abs(profileTarget - currentControllerTarget)
    if (totalCompApplied > 0.1) {
      // Exponential moving average: weight new data more when we have few samples
      const alpha = convergenceCount < 5 ? mp.convergenceAlpha0 : mp.convergenceAlphaN
      const absRawComp = Math.abs(rawCompensation * dampingFactor)
      const newLearned = learnedBaseline > 0
        ? learnedBaseline * (1 - alpha) + (absRawComp > 0 ? totalCompApplied - absRawComp : 0) * alpha
        : Math.max(0, totalCompApplied - absRawComp)
      const clampedLearned = Math.max(0, Math.min(newLearned, mp.errorCorrectionCap))
      
      await supabase.from('controller_learned_compensation').upsert({
        controller_id: controllerId,
        delta_bucket: deltaBucket,
        mode,
        step_type: stepType,
        learned_pi_correction: clampedLearned,
        convergence_count: convergenceCount + 1,
        last_converged_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        latest_p_correction: pCorrection,
        latest_i_correction: decayedIntegral,
        latest_d_damping: dampingFactor,
        latest_avg_error: avgError,
        accumulated_integral: decayedIntegral,
      }, { onConflict: 'controller_id,delta_bucket,mode,step_type' })
      
      console.log(`🎓 Lärde ${controllerName} [${deltaBucket}/${stepType}]: ny baseline=${clampedLearned.toFixed(2)}°C (alpha=${alpha}, n=${convergenceCount + 1}), integral ${persistedIntegral.toFixed(3)} → ${decayedIntegral.toFixed(3)}`)
    }
  }

  let compensatedTarget = profileTarget - compensation + errorCorrection

  // Safety bounds: never more than effectiveMaxComp away from profile target
  compensatedTarget = Math.max(profileTarget - effectiveMaxComp, Math.min(profileTarget + effectiveMaxComp, compensatedTarget))

  // Asymmetric rate limit
  const diff = compensatedTarget - currentControllerTarget
  const distanceFromIdeal = Math.abs(diff)
  const isIncreasing = diff > 0

  {
    const scaleFactor = Math.min(1.0, Math.max(minScaleFactor, distanceFromIdeal / 2.0))
    const latestPill = parseFloat(String(deltaHistory[0].pill_temp))
    const latestCtrl = parseFloat(String(deltaHistory[0].controller_temp))
    const currentAvg = (latestPill + latestCtrl) / 2
    
    // For cooling mode: strict upward limit (avoid triggering heater), unless avg is below target
    // For heating mode: strict downward limit (avoid triggering cooler), unless avg is above target
    let baseLimit: number
    if (mode === 'cooling') {
      const avgBelowTarget = currentAvg < profileTarget - 0.2
      const upwardLimit = avgBelowTarget ? effectiveMaxRate : mp.upwardRelease
      baseLimit = isIncreasing ? Math.min(effectiveMaxRate * scaleFactor, upwardLimit) : effectiveMaxRate * scaleFactor
      if (avgBelowTarget && isIncreasing) {
        console.log(`🔥 Medel (${currentAvg.toFixed(1)}°) under mål (${profileTarget}°) — släpper uppåt-limit till ${upwardLimit}°C/cykel`)
      }
    } else {
      // Heating mode: strict downward (releasing heat compensation), normal upward
      const avgAboveTarget = currentAvg > profileTarget + 0.2
      const downwardLimit = avgAboveTarget ? effectiveMaxRate : mp.upwardRelease
      baseLimit = isIncreasing ? effectiveMaxRate * scaleFactor : Math.min(effectiveMaxRate * scaleFactor, downwardLimit)
      if (avgAboveTarget && !isIncreasing) {
        console.log(`❄️ Medel (${currentAvg.toFixed(1)}°) över mål (${profileTarget}°) — släpper nedåt-limit till ${downwardLimit}°C/cykel`)
      }
    }
    
    if (distanceFromIdeal > baseLimit) {
      compensatedTarget = currentControllerTarget + (isIncreasing ? baseLimit : -baseLimit)
      console.log(`🎯 Rate-limit (${isIncreasing ? '↑' : '↓'}): ${baseLimit.toFixed(2)}°C (scale=${scaleFactor.toFixed(2)}, max=${effectiveMaxRate}, mode=${mode})`)
    }
  }

  // Round to 1 decimal
  compensatedTarget = Math.round(compensatedTarget * 10) / 10

  // Skip if change is negligible (< 0.1°C)
  if (Math.abs(compensatedTarget - currentControllerTarget) < 0.1) {
    console.log(`🎯 Pill-kompensation för ${controllerName}: redan nära mål (${currentControllerTarget}°C ≈ ${compensatedTarget}°C), skippar`)
    return null
  }

  console.log(`🎯 Pill-kompensation för ${controllerName}: profil=${profileTarget}°C, avgDelta=${avgDelta.toFixed(2)}°C [${deltaBucket}], rawKomp=${rawCompensation.toFixed(2)}°C, damping=${dampingFactor.toFixed(2)}, komp=${compensation.toFixed(2)}°C, PI=+${errorCorrection.toFixed(2)}°C (P=${pCorrection.toFixed(2)}, I=${iCorrection.toFixed(2)}, learned=${learnedBaseline.toFixed(2)}), ny target=${compensatedTarget}°C (nuvarande=${currentControllerTarget}°C)`)

  return { compensatedTarget, compensation, avgDelta, dampingFactor, pillRate: _pillRate, etaMinutes: _etaMinutes, errorCorrection, pCorrection, iCorrection, learnedBaseline, deltaBucket, convergenceCount }
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
 * Learn and retrieve the hardware thermal rate (°C/hour) for a controller.
 * Measures how fast the hardware can heat or cool by analyzing periods of
 * active temperature change from temp_controller_history.
 * Persists learned rates in fermentation_learnings for cross-batch use.
 */
export async function learnThermalRate(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
  mode: 'heating' | 'cooling'
): Promise<number | null> {
  const paramName = `thermal_rate_${mode}`

  // Check existing learned value first
  const { data: existing } = await supabase
    .from('fermentation_learnings')
    .select('learned_value, sample_count, last_updated_at')
    .eq('controller_id', controllerId)
    .eq('parameter_name', paramName)
    .maybeSingle()

  // Only re-learn every 2 hours to avoid excessive queries
  if (existing && existing.last_updated_at) {
    const hoursSinceUpdate = (Date.now() - new Date(existing.last_updated_at).getTime()) / (1000 * 60 * 60)
    if (hoursSinceUpdate < 2 && existing.sample_count >= 3) {
      return parseFloat(String(existing.learned_value))
    }
  }

  // Fetch last 6 hours of temp history to find active heating/cooling periods
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const { data: history } = await supabase
    .from('temp_controller_history')
    .select('current_temp, target_temp, cooling_enabled, recorded_at')
    .eq('controller_id', controllerId)
    .gte('recorded_at', sixHoursAgo)
    .order('recorded_at', { ascending: true })
    .limit(200)

  if (!history || history.length < 5) {
    return existing ? parseFloat(String(existing.learned_value)) : null
  }

  // Find segments where temp is actively moving toward target
  const rates: number[] = []
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]
    const curr = history[i]
    const tempDiff = parseFloat(String(curr.current_temp)) - parseFloat(String(prev.current_temp))
    const timeDiffMs = new Date(curr.recorded_at).getTime() - new Date(prev.recorded_at).getTime()
    const timeDiffHours = timeDiffMs / (1000 * 60 * 60)

    if (timeDiffHours < 0.01 || timeDiffHours > 0.5) continue // skip bad intervals

    const ratePerHour = tempDiff / timeDiffHours
    const target = parseFloat(String(curr.target_temp))
    const temp = parseFloat(String(curr.current_temp))

    // Only count when actively moving in the right direction toward target
    if (mode === 'heating' && ratePerHour > 0.3 && temp < target) {
      rates.push(ratePerHour)
    } else if (mode === 'cooling' && ratePerHour < -0.3 && temp > target) {
      rates.push(Math.abs(ratePerHour))
    }
  }

  if (rates.length < 2) {
    return existing ? parseFloat(String(existing.learned_value)) : null
  }

  // Use 80th percentile as "effective max rate" (filters out noise)
  rates.sort((a, b) => a - b)
  const p80Index = Math.floor(rates.length * 0.8)
  const measuredRate = rates[p80Index]

  // EMA update with existing learned value
  const oldValue = existing ? parseFloat(String(existing.learned_value)) : 0
  const oldCount = existing?.sample_count ?? 0
  const alpha = oldCount < 5 ? 0.5 : 0.2
  const newValue = oldValue > 0 ? oldValue * (1 - alpha) + measuredRate * alpha : measuredRate
  const roundedValue = Math.round(newValue * 100) / 100

  await supabase.from('fermentation_learnings').upsert({
    controller_id: controllerId,
    parameter_name: paramName,
    learned_value: roundedValue,
    sample_count: oldCount + rates.length,
    last_updated_at: new Date().toISOString(),
  }, { onConflict: 'controller_id,parameter_name' })

  console.log(`🏎️ Thermal rate ${controllerId} [${mode}]: ${roundedValue.toFixed(2)}°C/h (${rates.length} samples, p80=${measuredRate.toFixed(2)}, prev=${oldValue.toFixed(2)})`)

  return roundedValue
}

/**
 * Learn glycol cooler thermal rate under different load conditions.
 * Load = number of tanks actively requesting cooling at the same time.
 * Stores separate rates for load 0, 1, 2+ to understand capacity.
 * Returns the learned rate for the given load, or null if insufficient data.
 */
export async function learnGlycolCoolerRate(
  supabase: ReturnType<typeof createClient>,
  coolerId: string,
  currentLoad: number
): Promise<{ rate: number; sampleCount: number } | null> {
  const loadBucket = currentLoad >= 2 ? '2plus' : String(currentLoad)
  const paramName = `glycol_rate:load_${loadBucket}`

  // Check existing learned value
  const { data: existing } = await supabase
    .from('fermentation_learnings')
    .select('learned_value, sample_count, last_updated_at')
    .eq('controller_id', coolerId)
    .eq('parameter_name', paramName)
    .maybeSingle()

  // Only re-learn every 2 hours
  if (existing && existing.last_updated_at) {
    const hoursSince = (Date.now() - new Date(existing.last_updated_at).getTime()) / (1000 * 60 * 60)
    if (hoursSince < 2 && existing.sample_count >= 3) {
      return { rate: parseFloat(String(existing.learned_value)), sampleCount: existing.sample_count }
    }
  }

  // Fetch last 6 hours of cooler history
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const { data: history } = await supabase
    .from('temp_controller_history')
    .select('current_temp, target_temp, cooling_enabled, recorded_at')
    .eq('controller_id', coolerId)
    .gte('recorded_at', sixHoursAgo)
    .order('recorded_at', { ascending: true })
    .limit(200)

  if (!history || history.length < 5) {
    return existing ? { rate: parseFloat(String(existing.learned_value)), sampleCount: existing.sample_count } : null
  }

  // Find segments where glycol temp is actively dropping (cooling)
  const rates: number[] = []
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]
    const curr = history[i]
    const tempDiff = parseFloat(String(curr.current_temp)) - parseFloat(String(prev.current_temp))
    const timeDiffMs = new Date(curr.recorded_at).getTime() - new Date(prev.recorded_at).getTime()
    const timeDiffHours = timeDiffMs / (1000 * 60 * 60)

    if (timeDiffHours < 0.01 || timeDiffHours > 0.5) continue

    const ratePerHour = tempDiff / timeDiffHours
    const temp = parseFloat(String(curr.current_temp))
    const target = parseFloat(String(curr.target_temp))

    // Cooling: temp dropping and above target
    if (ratePerHour < -0.3 && temp > target) {
      rates.push(Math.abs(ratePerHour))
    }
  }

  if (rates.length < 2) {
    return existing ? { rate: parseFloat(String(existing.learned_value)), sampleCount: existing.sample_count } : null
  }

  // 80th percentile for effective rate
  rates.sort((a, b) => a - b)
  const p80 = rates[Math.floor(rates.length * 0.8)]

  const oldValue = existing ? parseFloat(String(existing.learned_value)) : 0
  const oldCount = existing?.sample_count ?? 0
  const alpha = oldCount < 5 ? 0.5 : 0.2
  const newValue = oldValue > 0 ? oldValue * (1 - alpha) + p80 * alpha : p80
  const rounded = Math.round(newValue * 100) / 100

  await supabase.from('fermentation_learnings').upsert({
    controller_id: coolerId,
    parameter_name: paramName,
    learned_value: rounded,
    sample_count: oldCount + rates.length,
    last_updated_at: new Date().toISOString(),
  }, { onConflict: 'controller_id,parameter_name' })

  console.log(`🧊 Glycol rate ${coolerId} [load=${loadBucket}]: ${rounded.toFixed(2)}°C/h (${rates.length} samples, p80=${p80.toFixed(2)}, prev=${oldValue.toFixed(2)})`)

  return { rate: rounded, sampleCount: oldCount + rates.length }
}

/**
 * Get all learned glycol rates for a cooler (all load buckets).
 */
export async function getGlycolRatesSummary(
  supabase: ReturnType<typeof createClient>,
  coolerId: string
): Promise<Record<string, { rate: number; sampleCount: number }>> {
  const { data } = await supabase
    .from('fermentation_learnings')
    .select('parameter_name, learned_value, sample_count')
    .eq('controller_id', coolerId)
    .like('parameter_name', 'glycol_rate:%')

  const result: Record<string, { rate: number; sampleCount: number }> = {}
  if (data) {
    for (const row of data) {
      const bucket = row.parameter_name.replace('glycol_rate:', '')
      result[bucket] = { rate: parseFloat(String(row.learned_value)), sampleCount: row.sample_count }
    }
  }
  return result
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
