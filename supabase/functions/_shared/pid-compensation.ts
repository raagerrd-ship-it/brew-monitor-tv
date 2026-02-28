import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { updateLearnedParam } from './learning-utils.ts'

// ============================================================
// PID Pill Compensation & Thermal Learning
// Extracted from temp-utils.ts for maintainability
// ============================================================

export interface PillCompensationSettings {
  enabled: boolean
  rateLimit: number
  emergencyThreshold: number
  minScale: number
  maxCompensation: number
  anticipationWindowHours: number
}

// Mode-specific PID tuning constants
// Heating elements: fast response, risk of overshoot → conservative gains
// Glycol cooling: slow, high inertia → more aggressive gains needed
const MODE_PARAMS = {
  cooling: {
    pGain: 0.6,
    iGain: 0.15,
    iDecay: 0.95,
    iClamp: 2.0,
    maxRatePerCycle: null as number | null,
    maxComp: null as number | null,
    upwardRelease: 0.3,
    convergenceAlpha0: 0.5,
    convergenceAlphaN: 0.2,
    errorCorrectionCap: 2.5,
  },
  heating: {
    pGain: 0.35,
    iGain: 0.10,
    iDecay: 0.90,
    iClamp: 1.5,
    maxRatePerCycle: null as number | null,
    maxComp: null as number | null,
    upwardRelease: 0.2,
    convergenceAlpha0: 0.4,
    convergenceAlphaN: 0.15,
    errorCorrectionCap: 1.8,
  },
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
  settings: PillCompensationSettings,
  mode: 'heating' | 'cooling' = 'cooling',
  stepType: string = 'unknown'
): Promise<{ compensatedTarget: number; compensation: number; avgDelta: number; dampingFactor?: number; pillRate?: number | null; etaMinutes?: number | null; errorCorrection?: number; pCorrection?: number; iCorrection?: number; learnedBaseline?: number; deltaBucket?: string; convergenceCount?: number } | null> {
  const { rateLimit: maxChangePerCycle, emergencyThreshold, minScale: minScaleFactor, maxCompensation, anticipationWindowHours } = settings
  const mp = MODE_PARAMS[mode]
  const effectiveMaxRate = mode === 'heating' ? Math.min(maxChangePerCycle, 0.5) : maxChangePerCycle
  const effectiveMaxComp = mode === 'heating' ? Math.min(maxCompensation, 3.0) : maxCompensation

  // Fetch last 8 delta measurements (≈40 min at 5-min intervals)
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

  if (absDelta < 0.1) {
    // Pill and probe are synced — no compensation needed, but return 0 explicitly
    // so the caller knows PID is active (not missing data)
    console.log(`✅ PID ${controllerName}: pill-probe delta ${avgDelta.toFixed(2)}°C < 0.1 — ingen kompensation behövs`)
    return { compensatedTarget: profileTarget, compensation: 0, avgDelta }
  }

  // === D-term: calculate pill rate, damping factor, and use learned thermal rate ===
  let dampingFactor = 1.0
  let _pillRate: number | null = null
  let _etaMinutes: number | null = null
  const ANTICIPATION_WINDOW_HOURS = anticipationWindowHours

  const learnedThermalRate = await learnThermalRate(supabase, controllerId, mode)

  if (deltaHistory.length >= 3) {
    const newest = deltaHistory[0]
    const oldest = deltaHistory[deltaHistory.length - 1]
    const pillNow = parseFloat(String(newest.pill_temp))
    const pillOld = parseFloat(String(oldest.pill_temp))
    const ctrlNow = parseFloat(String(newest.controller_temp))
    const timeDiffMs = new Date(newest.recorded_at).getTime() - new Date(oldest.recorded_at).getTime()
    const timeDiffHours = timeDiffMs / (1000 * 60 * 60)

    if (timeDiffHours > 0.05) {
      const pillRate = (pillNow - pillOld) / timeDiffHours
      _pillRate = pillRate

      const currentAvg = (pillNow + ctrlNow) / 2
      const avgDistance = currentAvg - profileTarget

      const isConverging = (avgDistance > 0 && pillRate < -0.1) || (avgDistance < 0 && pillRate > 0.1)
      if (Math.abs(avgDistance) > 0.1 && isConverging) {
        const observedAvgRate = Math.abs(pillRate) / 2
        const hwRate = learnedThermalRate ? learnedThermalRate / 2 : null
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
  const latestPillForComp = parseFloat(String(deltaHistory[0].pill_temp))
  const latestCtrlForComp = parseFloat(String(deltaHistory[0].controller_temp))
  const currentAvgForComp = (latestPillForComp + latestCtrlForComp) / 2
  const rawCompensation = avgDelta / 2
  let compensation = rawCompensation * dampingFactor
  
  if (currentAvgForComp > profileTarget + 0.05 && compensation < 0) {
    console.log(`🚫 Delta-komp undertryckt: medel=${currentAvgForComp.toFixed(1)}° redan över mål=${profileTarget}°, komp=${compensation.toFixed(2)}° skulle höja mål ytterligare`)
    compensation = 0
  } else if (currentAvgForComp < profileTarget - 0.05 && compensation > 0) {
    console.log(`🚫 Delta-komp undertryckt: medel=${currentAvgForComp.toFixed(1)}° redan under mål=${profileTarget}°, komp=${compensation.toFixed(2)}° skulle sänka mål ytterligare`)
    compensation = 0
  }

  // === Adaptive PI-term ===
  const deltaBucket = absDelta > 3 ? 'high' : absDelta > 1.5 ? 'medium' : 'low'

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

  // Style-key fallback
  if (!learnedRow) {
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
  const avgError = profileTarget - currentAvgForError

  let pCorrection = 0
  let iCorrection = 0
  let errorCorrection = 0

  // === Saturation detection ===
  let isSaturated = false
  if (learnedThermalRate && _pillRate !== null) {
    const absRate = Math.abs(_pillRate)
    const saturationRatio = absRate / learnedThermalRate
    if (saturationRatio >= 0.8) {
      isSaturated = true
      console.log(`⚡ Saturation ${controllerName} [${mode}]: rate=${absRate.toFixed(2)}°C/h ≈ ${(saturationRatio * 100).toFixed(0)}% av max ${learnedThermalRate.toFixed(2)}°C/h — begränsar kompensation`)
    }
  }

  if (avgError >= 0.35) {
    // === UNDERSHOOT ===
    pCorrection = avgError * mp.pGain

    if (isStaleData) {
      iCorrection = persistedIntegral
      console.log(`📊 I-term ${controllerName} [${mode}]: STALE — behåller integral=${persistedIntegral.toFixed(3)} (ingen ny data)`)
    } else {
      const newIntegral = persistedIntegral * mp.iDecay + avgError * mp.iGain
      iCorrection = Math.max(-mp.iClamp, Math.min(mp.iClamp, newIntegral))
      console.log(`📊 I-term ${controllerName} [${mode}]: integral ${persistedIntegral.toFixed(3)} → ${iCorrection.toFixed(3)} (err=${avgError.toFixed(2)}, gain=${mp.iGain}, decay=${mp.iDecay})`)
    }

    const calculatedPI = pCorrection + iCorrection
    errorCorrection = Math.min(Math.max(calculatedPI, learnedBaseline), mp.errorCorrectionCap)
    
    if (dampingFactor < 1.0) {
      const dampedCorrection = errorCorrection * dampingFactor
      errorCorrection = Math.max(dampedCorrection, learnedBaseline)
      console.log(`🎛️ PI damped by D-term: ${calculatedPI.toFixed(2)} × ${dampingFactor.toFixed(2)} = ${errorCorrection.toFixed(2)}°C (baseline=${learnedBaseline.toFixed(2)})`)
    }
    
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

    await supabase.from('controller_learned_compensation').upsert({
      controller_id: controllerId, delta_bucket: deltaBucket, mode, step_type: stepType,
      latest_p_correction: pCorrection, latest_i_correction: iCorrection,
      latest_d_damping: dampingFactor, latest_avg_error: avgError,
      accumulated_integral: iCorrection,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'controller_id,delta_bucket,mode,step_type', ignoreDuplicates: false })
  } else if (avgError < -0.3) {
    // === OVERSHOOT ===
    pCorrection = avgError * mp.pGain

    if (isStaleData) {
      iCorrection = persistedIntegral
      console.log(`📊 I-term overshoot ${controllerName} [${mode}]: STALE — behåller integral=${persistedIntegral.toFixed(3)}`)
    } else {
      const newIntegral = persistedIntegral * mp.iDecay + avgError * mp.iGain
      iCorrection = Math.max(-mp.iClamp, Math.min(mp.iClamp, newIntegral))
      console.log(`📊 I-term overshoot ${controllerName} [${mode}]: integral ${persistedIntegral.toFixed(3)} → ${iCorrection.toFixed(3)} (err=${avgError.toFixed(2)})`)
    }

    errorCorrection = Math.max(pCorrection + iCorrection, -mp.errorCorrectionCap)
    
    if (dampingFactor < 1.0) {
      const dampedCorrection = errorCorrection * dampingFactor
      errorCorrection = Math.min(dampedCorrection, 0)
      console.log(`🎛️ PI overshoot damped by D-term: ${(pCorrection + iCorrection).toFixed(2)} × ${dampingFactor.toFixed(2)} = ${errorCorrection.toFixed(2)}°C`)
    }
    
    if (isSaturated && errorCorrection < 0) {
      const prevComp = profileTarget - currentControllerTarget
      if (errorCorrection < prevComp && prevComp < 0) {
        errorCorrection = prevComp
        console.log(`⚡ Saturation cap (overshoot): begränsar PI till ${errorCorrection.toFixed(2)}°C`)
      }
    }
    
    console.log(`📉 PI-term overshoot ${controllerName} [${mode}]: medel=${currentAvgForError.toFixed(1)}°C, mål=${profileTarget}°C, fel=${avgError.toFixed(2)}°C, P=${pCorrection.toFixed(2)}°C, I=${iCorrection.toFixed(2)}°C, total=${errorCorrection.toFixed(2)}°C${isSaturated ? ' [SATURATED]' : ''}`)

    await supabase.from('controller_learned_compensation').upsert({
      controller_id: controllerId, delta_bucket: deltaBucket, mode, step_type: stepType,
      latest_p_correction: pCorrection, latest_i_correction: iCorrection,
      latest_d_damping: dampingFactor, latest_avg_error: avgError,
      accumulated_integral: iCorrection,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'controller_id,delta_bucket,mode,step_type', ignoreDuplicates: false })
  } else if (avgError > -0.5 && avgError <= 0.5) {
    // === CONVERGENCE ===
    const decayedIntegral = persistedIntegral * 0.8
    
    const totalCompApplied = Math.abs(profileTarget - currentControllerTarget)
    if (totalCompApplied > 0.1) {
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

  // Safety bounds
  compensatedTarget = Math.max(profileTarget - effectiveMaxComp, Math.min(profileTarget + effectiveMaxComp, compensatedTarget))

  // Directional clamp: during ramp/gradual_ramp steps, never push target past profileTarget
  // in the wrong direction. Hold steps need bidirectional compensation to hit exact average.
  const isRampStep = ['ramp', 'gradual_ramp'].includes(stepType)
  if (isRampStep) {
    if (mode === 'cooling' && compensatedTarget > profileTarget) {
      console.log(`🔒 Directional clamp [cooling/${stepType}]: ${compensatedTarget.toFixed(1)}°C → ${profileTarget.toFixed(1)}°C (kan inte överskrida profilmål under ramp)`)
      compensatedTarget = profileTarget
    } else if (mode === 'heating' && compensatedTarget < profileTarget) {
      console.log(`🔒 Directional clamp [heating/${stepType}]: ${compensatedTarget.toFixed(1)}°C → ${profileTarget.toFixed(1)}°C (kan inte understiga profilmål under ramp)`)
      compensatedTarget = profileTarget
    }
  }

  // Asymmetric rate limit
  const diff = compensatedTarget - currentControllerTarget
  const distanceFromIdeal = Math.abs(diff)
  const isIncreasing = diff > 0

  {
    const scaleFactor = Math.min(1.0, Math.max(minScaleFactor, distanceFromIdeal / 2.0))
    const latestPill = parseFloat(String(deltaHistory[0].pill_temp))
    const latestCtrl = parseFloat(String(deltaHistory[0].controller_temp))
    const currentAvg = (latestPill + latestCtrl) / 2
    
    let baseLimit: number
    if (mode === 'cooling') {
      const avgBelowTarget = currentAvg < profileTarget - 0.2
      const upwardLimit = avgBelowTarget ? effectiveMaxRate : mp.upwardRelease
      baseLimit = isIncreasing ? Math.min(effectiveMaxRate * scaleFactor, upwardLimit) : effectiveMaxRate * scaleFactor
      if (avgBelowTarget && isIncreasing) {
        console.log(`🔥 Medel (${currentAvg.toFixed(1)}°) under mål (${profileTarget}°) — släpper uppåt-limit till ${upwardLimit}°C/cykel`)
      }
    } else {
      const avgAboveTarget = currentAvg > profileTarget + 0.2
      const downwardLimit = avgAboveTarget ? effectiveMaxRate : mp.upwardRelease
      baseLimit = isIncreasing ? effectiveMaxRate * scaleFactor : Math.min(effectiveMaxRate * scaleFactor, downwardLimit)
      if (avgAboveTarget && !isIncreasing) {
        console.log(`❄️ Medel (${currentAvg.toFixed(1)}°) över mål (${profileTarget}°) — släpper nedåt-limit till ${downwardLimit}°C/cykel`)
      }
    }
    
    const currentDistToProfile = Math.abs(currentControllerTarget - profileTarget)
    const newDistToProfile = Math.abs(compensatedTarget - profileTarget)
    const isTowardTarget = newDistToProfile < currentDistToProfile
    if (isTowardTarget && distanceFromIdeal <= 0.5) {
      // Allow faster convergence toward profile target — bypass rate-limit for steps up to 0.5°
      console.log(`✅ Rate-limit bypass: korrigering mot mål (${distanceFromIdeal.toFixed(2)}° → profil ${profileTarget}°)`)
    } else if (distanceFromIdeal > baseLimit) {
      // Ensure minimum step of 0.1° to avoid getting stuck
      const effectiveLimit = Math.max(baseLimit, 0.1)
      compensatedTarget = currentControllerTarget + (isIncreasing ? effectiveLimit : -effectiveLimit)
      console.log(`🎯 Rate-limit (${isIncreasing ? '↑' : '↓'}): ${effectiveLimit.toFixed(2)}°C (scale=${scaleFactor.toFixed(2)}, max=${effectiveMaxRate}, mode=${mode})`)
    }
  }

  compensatedTarget = Math.round(compensatedTarget * 10) / 10

  if (Math.abs(compensatedTarget - currentControllerTarget) < 0.05) {
    console.log(`🎯 Pill-kompensation för ${controllerName}: redan nära mål (${currentControllerTarget}°C ≈ ${compensatedTarget}°C), skippar`)
    return null
  }

  console.log(`🎯 Pill-kompensation för ${controllerName}: profil=${profileTarget}°C, avgDelta=${avgDelta.toFixed(2)}°C [${deltaBucket}], rawKomp=${rawCompensation.toFixed(2)}°C, damping=${dampingFactor.toFixed(2)}, komp=${compensation.toFixed(2)}°C, PI=+${errorCorrection.toFixed(2)}°C (P=${pCorrection.toFixed(2)}, I=${iCorrection.toFixed(2)}, learned=${learnedBaseline.toFixed(2)}), ny target=${compensatedTarget}°C (nuvarande=${currentControllerTarget}°C)`)

  return { compensatedTarget, compensation, avgDelta, dampingFactor, pillRate: _pillRate, etaMinutes: _etaMinutes, errorCorrection, pCorrection, iCorrection, learnedBaseline, deltaBucket, convergenceCount }
}

// ============================================================
// Thermal Rate Learning
// ============================================================

/**
 * Learn and retrieve the hardware thermal rate (°C/hour) for a controller.
 */
export async function learnThermalRate(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
  mode: 'heating' | 'cooling'
): Promise<number | null> {
  const paramName = `thermal_rate_${mode}`

  const { data: existing } = await supabase
    .from('fermentation_learnings')
    .select('learned_value, sample_count, last_updated_at')
    .eq('controller_id', controllerId)
    .eq('parameter_name', paramName)
    .maybeSingle()

  if (existing && existing.last_updated_at) {
    const hoursSinceUpdate = (Date.now() - new Date(existing.last_updated_at).getTime()) / (1000 * 60 * 60)
    if (hoursSinceUpdate < 2 && existing.sample_count >= 3) {
      return parseFloat(String(existing.learned_value))
    }
  }

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

  const rates: number[] = []
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]
    const curr = history[i]
    const tempDiff = parseFloat(String(curr.current_temp)) - parseFloat(String(prev.current_temp))
    const timeDiffMs = new Date(curr.recorded_at).getTime() - new Date(prev.recorded_at).getTime()
    const timeDiffHours = timeDiffMs / (1000 * 60 * 60)

    if (timeDiffHours < 0.01 || timeDiffHours > 0.5) continue

    const ratePerHour = tempDiff / timeDiffHours
    const target = parseFloat(String(curr.target_temp))
    const temp = parseFloat(String(curr.current_temp))

    if (mode === 'heating' && ratePerHour > 0.3 && temp < target) {
      rates.push(ratePerHour)
    } else if (mode === 'cooling' && ratePerHour < -0.3 && temp > target) {
      rates.push(Math.abs(ratePerHour))
    }
  }

  if (rates.length < 2) {
    return existing ? parseFloat(String(existing.learned_value)) : null
  }

  rates.sort((a, b) => a - b)
  const p80Index = Math.floor(rates.length * 0.8)
  const measuredRate = rates[p80Index]

  // Use shared EMA learning (SSOT)
  const result = await updateLearnedParam(supabase, controllerId, paramName, measuredRate, 0.1, 20.0)

  console.log(`🏎️ Thermal rate ${controllerId} [${mode}]: ${result.newValue.toFixed(2)}°C/h (${rates.length} samples, p80=${measuredRate.toFixed(2)}, prev=${result.oldValue.toFixed(2)})`)

  return Math.round(result.newValue * 100) / 100
}

// ============================================================
// Glycol Cooler Learning
// ============================================================

/**
 * Learn glycol cooler thermal rate under different load conditions.
 */
export async function learnGlycolCoolerRate(
  supabase: ReturnType<typeof createClient>,
  coolerId: string,
  currentLoad: number
): Promise<{ rate: number; sampleCount: number } | null> {
  const loadBucket = currentLoad >= 2 ? '2plus' : String(currentLoad)
  const paramName = `glycol_rate:load_${loadBucket}`

  const { data: existing } = await supabase
    .from('fermentation_learnings')
    .select('learned_value, sample_count, last_updated_at')
    .eq('controller_id', coolerId)
    .eq('parameter_name', paramName)
    .maybeSingle()

  if (existing && existing.last_updated_at) {
    const hoursSince = (Date.now() - new Date(existing.last_updated_at).getTime()) / (1000 * 60 * 60)
    if (hoursSince < 2 && existing.sample_count >= 3) {
      return { rate: parseFloat(String(existing.learned_value)), sampleCount: existing.sample_count }
    }
  }

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

    if (ratePerHour < -0.3 && temp > target) {
      rates.push(Math.abs(ratePerHour))
    }
  }

  if (rates.length < 2) {
    return existing ? { rate: parseFloat(String(existing.learned_value)), sampleCount: existing.sample_count } : null
  }

  rates.sort((a, b) => a - b)
  const p80 = rates[Math.floor(rates.length * 0.8)]

  // Use shared EMA learning (SSOT)
  const result = await updateLearnedParam(supabase, coolerId, paramName, p80, 0.1, 20.0)
  const rounded = Math.round(result.newValue * 100) / 100

  console.log(`🧊 Glycol rate ${coolerId} [load=${loadBucket}]: ${rounded.toFixed(2)}°C/h (${rates.length} samples, p80=${p80.toFixed(2)}, prev=${result.oldValue.toFixed(2)})`)

  return { rate: rounded, sampleCount: result.sampleCount }
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
