import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { updateLearnedParam } from './learning-utils.ts'

// ============================================================
// PID Control & Thermal Learning
//
// SSOT Naming Convention:
//   actualTarget  = user's desired temperature (profile_target_temp)
//   ctrlTarget    = current hardware target (target_temp before PID)
//   ctrlTargetPid = PID-computed target sent to RAPT hardware
//   actualTemp    = fused sensor reading (avg or probe-only)
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
 * Calculate PID-compensated target temperature.
 * Targets the AVERAGE of pill (surface) and probe (core) to equal the actual target.
 * Formula: ctrlTargetPid = actualTarget - avgDelta/2
 *
 * @param actualTarget  The user's desired temperature (SSOT: profile_target_temp)
 * @param ctrlTarget    The current hardware target (target_temp before PID)
 * @param actualTemp    Pre-computed fused sensor reading (avg or probe-only)
 * @param probeTemp     The controller's probe temperature
 */
export async function calculateCompensatedTarget(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
  actualTarget: number,
  ctrlTarget: number,
  controllerName: string,
  settings: PillCompensationSettings,
  mode: 'heating' | 'cooling' = 'cooling',
  stepType: string = 'unknown',
  actualTemp?: number,
  probeTemp?: number
): Promise<{ ctrlTargetPid: number; compensation: number; avgDelta: number; dampingFactor?: number; pillRate?: number | null; probeRate?: number | null; etaMinutes?: number | null; errorCorrection?: number; pCorrection?: number; iCorrection?: number; learnedBaseline?: number; deltaBucket?: string; convergenceCount?: number; constraints?: string[] }> {
  const constraints: string[] = [];
  const { rateLimit: maxChangePerCycle, emergencyThreshold, minScale: minScaleFactor, maxCompensation, anticipationWindowHours } = settings
  const mp = MODE_PARAMS[mode]
  const effectiveMaxRate = mode === 'heating' ? Math.min(maxChangePerCycle, 0.5) : maxChangePerCycle
  const effectiveMaxComp = mode === 'heating' ? Math.min(maxCompensation, 3.0) : maxCompensation

  // Calculate avgDelta from pre-computed actualTemp and probeTemp if provided
  // Otherwise fall back to delta history (backward compat)
  let avgDelta: number
  let absDelta: number

  // Fetch delta history — still needed for D-term rate calculations and EMA
  const { data: deltaHistory } = await supabase
    .from('temp_delta_history')
    .select('delta, pill_temp, controller_temp, recorded_at')
    .eq('controller_id', controllerId)
    .order('recorded_at', { ascending: false })
    .limit(8)

  if (actualTemp != null && probeTemp != null) {
    // Use pre-computed values from sensor fusion
    avgDelta = actualTemp - probeTemp
    absDelta = Math.abs(avgDelta)
  } else if (deltaHistory && deltaHistory.length > 0) {
    // Fallback: compute from history (backward compat)
    const deltas = deltaHistory.map((d: any) => parseFloat(String(d.delta)))
    avgDelta = deltas.reduce((sum: number, d: number) => sum + d, 0) / deltas.length
    absDelta = Math.abs(avgDelta)
  } else {
    console.log(`⚠️ PID ${controllerName}: ingen deltahistorik och inga sensorvärden — returnerar compensation=0`)
    return { ctrlTargetPid: actualTarget, compensation: 0, avgDelta: 0 }
  }

  if (absDelta < 0.1) {
    // Sensors are synced (or single sensor) — no delta compensation needed
    // but still run PI-loop for error correction
    console.log(`✅ PID ${controllerName}: delta ${avgDelta.toFixed(2)}°C < 0.1 — hoppar delta-komp, kör PI`)
  }

  // === D-term: calculate pill rate, damping factor, and use learned thermal rate ===
  let dampingFactor = 1.0
  let _pillRate: number | null = null
  let _probeRate: number | null = null
  let _etaMinutes: number | null = null
  const ANTICIPATION_WINDOW_HOURS = anticipationWindowHours

  const learnedThermalRate = await learnThermalRate(supabase, controllerId, mode)

  if (deltaHistory && deltaHistory.length >= 3) {
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
      const ctrlOld = parseFloat(String(oldest.controller_temp))
      _probeRate = (ctrlNow - ctrlOld) / timeDiffHours

      const currentAvg = (pillNow + ctrlNow) / 2
      const avgDistance = currentAvg - actualTarget

      const isConverging = (avgDistance > 0 && pillRate < -0.1) || (avgDistance < 0 && pillRate > 0.1)
      if (Math.abs(avgDistance) > 0.1 && isConverging) {
        const observedAvgRate = Math.abs(pillRate) / 2
        const hwRate = learnedThermalRate ? learnedThermalRate / 2 : null
        const avgRate = hwRate ? Math.min(observedAvgRate, hwRate) : observedAvgRate
        const etaHours = avgRate > 0.01 ? Math.abs(avgDistance) / avgRate : 99
        _etaMinutes = Math.round(etaHours * 60)
        dampingFactor = Math.min(1.0, Math.max(0.2, etaHours / ANTICIPATION_WINDOW_HOURS))
        console.log(`🌡️ D-term ${controllerName} [${mode}]: pillRate=${pillRate.toFixed(2)}°C/h, hwRate=${learnedThermalRate?.toFixed(2) ?? '?'}°C/h, avg=${currentAvg.toFixed(1)}°C→${actualTarget}°C, ETA=${_etaMinutes}min, damping=${dampingFactor.toFixed(2)}`)
      } else {
        _etaMinutes = null
        console.log(`🌡️ D-term ${controllerName}: pillRate=${pillRate.toFixed(2)}°C/h, avg=${((pillNow + ctrlNow) / 2).toFixed(1)}°C vs mål=${actualTarget}°C (ej mot mål eller för långsam), damping=1.0`)
      }
    }
  }

  // Target average: compensate by half the delta, scaled by damping factor
  // === Approach Zone: anticipate that delta will shrink as we near the target ===
  const latestPillForComp = deltaHistory?.[0] ? parseFloat(String(deltaHistory[0].pill_temp)) : (actualTemp ?? actualTarget)
  const latestCtrlForComp = deltaHistory?.[0] ? parseFloat(String(deltaHistory[0].controller_temp)) : (probeTemp ?? actualTarget)
  const currentAvgForComp = actualTemp ?? (latestPillForComp + latestCtrlForComp) / 2
  const distanceToTarget = Math.abs(currentAvgForComp - actualTarget)
  const APPROACH_ZONE_SIZE = 8.0 // °C — within this range, start scaling down delta compensation
  // When avg is already near target (within ±1°C), the current delta is steady-state:
  // the compensation is what's MAINTAINING the average at target.
  // Don't scale it down — that would cause avg to drift away.
  const isAtTarget = distanceToTarget < 1.0
  const approachScale = isAtTarget ? 1.0 : Math.min(1.0, Math.max(0.3, distanceToTarget / APPROACH_ZONE_SIZE))
  
  const rawCompensation = avgDelta / 2
  let compensation = rawCompensation * dampingFactor * approachScale
  
  if (approachScale < 1.0) {
    constraints.push(`approach=${approachScale.toFixed(2)}`)
    console.log(`🛑 Approach zone ${controllerName}: avstånd=${distanceToTarget.toFixed(1)}°C till mål=${actualTarget}°C, approachScale=${approachScale.toFixed(2)} — anticiperar att delta (${avgDelta.toFixed(1)}°C) kommer minska`)
  }
  
  // Delta-compensation adjusts controller target so avg(pill,probe) = actualTarget.
  // It should always apply when there's a meaningful delta — the D-term damping
  // and approach-zone scaling already handle convergence safely.

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

  // Use pre-computed actualTemp for error calculation when available
  const currentAvgForError = actualTemp ?? (deltaHistory?.[0]
    ? (parseFloat(String(deltaHistory[0].pill_temp)) + parseFloat(String(deltaHistory[0].controller_temp))) / 2
    : actualTarget)
  const avgError = actualTarget - currentAvgForError

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
      const prevComp = Math.abs(actualTarget - ctrlTarget)
      if (errorCorrection > prevComp) {
        errorCorrection = prevComp
        console.log(`⚡ Saturation cap: begränsar PI till ${errorCorrection.toFixed(2)}°C (hårdvaran redan vid max)`)
      }
    }
    
    if (learnedBaseline > 0) {
      console.log(`🧠 Learned baseline ${controllerName} [${deltaBucket}/${stepType}/${mode}]: ${learnedBaseline.toFixed(2)}°C (n=${convergenceCount}), calc PI=${calculatedPI.toFixed(2)}°C, använder=${errorCorrection.toFixed(2)}°C`)
    }
    console.log(`📈 PI-term ${controllerName} [${mode}]: medel=${currentAvgForError.toFixed(1)}°C, mål=${actualTarget}°C, fel=${avgError.toFixed(2)}°C, P=+${pCorrection.toFixed(2)}°C, I=+${iCorrection.toFixed(2)}°C, learned=${learnedBaseline.toFixed(2)}°C, total=+${errorCorrection.toFixed(2)}°C${isSaturated ? ' [SATURATED]' : ''}`)

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
      const prevComp = actualTarget - ctrlTarget
      if (errorCorrection < prevComp && prevComp < 0) {
        errorCorrection = prevComp
        console.log(`⚡ Saturation cap (overshoot): begränsar PI till ${errorCorrection.toFixed(2)}°C`)
      }
    }
    
    console.log(`📉 PI-term overshoot ${controllerName} [${mode}]: medel=${currentAvgForError.toFixed(1)}°C, mål=${actualTarget}°C, fel=${avgError.toFixed(2)}°C, P=${pCorrection.toFixed(2)}°C, I=${iCorrection.toFixed(2)}°C, total=${errorCorrection.toFixed(2)}°C${isSaturated ? ' [SATURATED]' : ''}`)

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
    
    const totalCompApplied = Math.abs(actualTarget - ctrlTarget)
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

  let ctrlTargetPid = actualTarget - compensation + errorCorrection

  // Safety bounds
  ctrlTargetPid = Math.max(actualTarget - effectiveMaxComp, Math.min(actualTarget + effectiveMaxComp, ctrlTargetPid))

  // Directional clamp: during ramp/gradual_ramp steps, never push target past actualTarget
  // in the wrong direction. Hold steps need bidirectional compensation to hit exact average.
  const isRampStep = ['ramp', 'gradual_ramp'].includes(stepType)
  if (isRampStep) {
    if (mode === 'cooling' && ctrlTargetPid > actualTarget) {
      console.log(`🔒 Directional clamp [cooling/${stepType}]: ${ctrlTargetPid.toFixed(1)}°C → ${actualTarget.toFixed(1)}°C (kan inte överskrida profilmål under ramp)`)
      constraints.push('dir-clamp')
      ctrlTargetPid = actualTarget
    } else if (mode === 'heating' && ctrlTargetPid < actualTarget) {
      console.log(`🔒 Directional clamp [heating/${stepType}]: ${ctrlTargetPid.toFixed(1)}°C → ${actualTarget.toFixed(1)}°C (kan inte understiga profilmål under ramp)`)
      constraints.push('dir-clamp')
      ctrlTargetPid = actualTarget
    }
  }

  // Asymmetric rate limit
  const diff = ctrlTargetPid - ctrlTarget
  const distanceFromIdeal = Math.abs(diff)
  const isIncreasing = diff > 0

  {
    const scaleFactor = Math.min(1.0, Math.max(minScaleFactor, distanceFromIdeal / 2.0))
    const latestPill = deltaHistory?.[0] ? parseFloat(String(deltaHistory[0].pill_temp)) : (actualTemp ?? actualTarget)
    const latestCtrl = deltaHistory?.[0] ? parseFloat(String(deltaHistory[0].controller_temp)) : (probeTemp ?? actualTarget)
    const currentAvg = actualTemp ?? (latestPill + latestCtrl) / 2

    // High-delta damping: when pill-probe delta is very large, reduce max rate
    // to prevent aggressive changes that cause oscillation in a thermally stratified system
    const HIGH_DELTA_THRESHOLD = 4.0 // °C — above this, start reducing rate (raised from 3.0)
    const deltaRateScale = absDelta > HIGH_DELTA_THRESHOLD
      ? Math.max(0.5, 1.0 - (absDelta - HIGH_DELTA_THRESHOLD) * 0.1)
      : 1.0
    const deltaScaledMaxRate = effectiveMaxRate * deltaRateScale
    if (deltaRateScale < 1.0) {
      constraints.push(`delta-damp=${deltaRateScale.toFixed(2)}`)
      console.log(`🌊 High-delta damping ${controllerName}: delta=${absDelta.toFixed(1)}°C > ${HIGH_DELTA_THRESHOLD}°C, rate ${effectiveMaxRate}→${deltaScaledMaxRate.toFixed(2)}°C/cykel (×${deltaRateScale.toFixed(2)})`)
    }
    
    let baseLimit: number
    if (mode === 'cooling') {
      const avgBelowTarget = currentAvg < actualTarget - 0.2
      const upwardLimit = avgBelowTarget ? deltaScaledMaxRate : mp.upwardRelease
      baseLimit = isIncreasing ? Math.min(deltaScaledMaxRate * scaleFactor, upwardLimit) : deltaScaledMaxRate * scaleFactor
      if (avgBelowTarget && isIncreasing) {
        console.log(`🔥 Medel (${currentAvg.toFixed(1)}°) under mål (${actualTarget}°) — släpper uppåt-limit till ${upwardLimit}°C/cykel`)
      }
    } else {
      const avgAboveTarget = currentAvg > actualTarget + 0.2
      const downwardLimit = avgAboveTarget ? deltaScaledMaxRate : mp.upwardRelease
      baseLimit = isIncreasing ? deltaScaledMaxRate * scaleFactor : Math.min(deltaScaledMaxRate * scaleFactor, downwardLimit)
      if (avgAboveTarget && !isIncreasing) {
        console.log(`❄️ Medel (${currentAvg.toFixed(1)}°) över mål (${actualTarget}°) — släpper nedåt-limit till ${downwardLimit}°C/cykel`)
      }
    }
    
    const currentDistToProfile = Math.abs(ctrlTarget - actualTarget)
    const newDistToProfile = Math.abs(ctrlTargetPid - actualTarget)
    const isTowardTarget = newDistToProfile < currentDistToProfile
    
    // When in approach zone AND moving toward profile, allow faster release
    // BUT: during ramp steps, don't release AGAINST the ramp direction.
    // Overshoot-release: disable ramp hold when probe is within 1°C of actual target
    const probeDistToTarget = Math.abs(latestCtrlForComp - actualTarget)
    const overshootRelease = probeDistToTarget <= 1.0
    if (overshootRelease) {
      constraints.push('overshoot-release')
    }
    
    const rampDirectionConflict = isRampStep && !overshootRelease && (
      (mode === 'cooling' && isIncreasing) ||  // downward ramp but pushing target up
      (mode === 'heating' && !isIncreasing)     // upward ramp but pushing target down
    )
    const approachRelease = approachScale < 1.0 && isTowardTarget && !rampDirectionConflict
    const bypassLimit = approachRelease ? Math.max(baseLimit, effectiveMaxRate * 0.8) : baseLimit
    
    if (rampDirectionConflict && isTowardTarget && approachScale < 1.0) {
      // During ramp: hold current target, let ramp bring profile down/up naturally
      ctrlTargetPid = ctrlTarget
      constraints.push('ramp-hold')
      console.log(`🛑 Ramp hold ${controllerName}: approach zone aktiv men ramp-riktning=${mode}, håller target=${ctrlTarget.toFixed(1)}°C (låter rampen komma ikapp)`)
    } else if (isTowardTarget && (distanceFromIdeal <= 0.5 || approachRelease)) {
      if (distanceFromIdeal <= bypassLimit) {
        console.log(`✅ Rate-limit bypass: korrigering mot mål (${distanceFromIdeal.toFixed(2)}° → actual_target ${actualTarget}°)${approachRelease ? ' [approach zone]' : ''}`)
      } else {
        const rateLimited = ctrlTarget + (isIncreasing ? bypassLimit : -bypassLimit)
        // If rate-limited result is within 0.2°C of raw, use raw — not worth waiting a cycle for <0.2°C
        if (Math.abs(rateLimited - ctrlTargetPid) < 0.2) {
          console.log(`✅ Rate-limit close-enough: ${rateLimited.toFixed(2)}° ≈ ${ctrlTargetPid.toFixed(2)}° (diff=${Math.abs(rateLimited - ctrlTargetPid).toFixed(2)}°), använder rått värde`)
        } else {
          ctrlTargetPid = rateLimited
          constraints.push('approach-release')
          console.log(`🎯 Approach release (${isIncreasing ? '↑' : '↓'}): ${bypassLimit.toFixed(2)}°C/cykel mot actual_target ${actualTarget}°C (approach zone fast-release)`)
        }
      }
    } else if (distanceFromIdeal > baseLimit) {
      // Ensure minimum step of 0.1° to avoid getting stuck
      const effectiveLimit = Math.max(baseLimit, 0.1)
      const rateLimited = ctrlTarget + (isIncreasing ? effectiveLimit : -effectiveLimit)
      // If rate-limited result is within 0.2°C of raw, use raw
      if (Math.abs(rateLimited - ctrlTargetPid) < 0.2) {
        console.log(`✅ Rate-limit close-enough: ${rateLimited.toFixed(2)}° ≈ ${ctrlTargetPid.toFixed(2)}° (diff=${Math.abs(rateLimited - ctrlTargetPid).toFixed(2)}°), använder rått värde`)
      } else {
        ctrlTargetPid = rateLimited
        constraints.push(`rate-limit=${effectiveLimit.toFixed(2)}`)
        console.log(`🎯 Rate-limit (${isIncreasing ? '↑' : '↓'}): ${effectiveLimit.toFixed(2)}°C (scale=${scaleFactor.toFixed(2)}, max=${effectiveMaxRate}, mode=${mode})`)
      }
    }
    
    // Safety clamp: never set target above probe during cooling (would start heater)
    // or below probe during heating (would start cooler)
    if (overshootRelease) {
      if (mode === 'cooling' && ctrlTargetPid > latestCtrlForComp) {
        ctrlTargetPid = Math.min(ctrlTargetPid, latestCtrlForComp)
        constraints.push('overshoot-clamp')
        console.log(`🔒 Overshoot clamp ${controllerName}: begränsar mål till probe ${latestCtrlForComp.toFixed(1)}°C (förhindrar värmaren)`)
      } else if (mode === 'heating' && ctrlTargetPid < latestCtrlForComp) {
        ctrlTargetPid = Math.max(ctrlTargetPid, latestCtrlForComp)
        constraints.push('overshoot-clamp')
        console.log(`🔒 Overshoot clamp ${controllerName}: begränsar mål till probe ${latestCtrlForComp.toFixed(1)}°C (förhindrar kylaren)`)
      }
    }
  }

  ctrlTargetPid = Math.round(ctrlTargetPid * 10) / 10

  if (Math.abs(ctrlTargetPid - ctrlTarget) < 0.05) {
    console.log(`🎯 PID ${controllerName}: redan nära mål (${ctrlTarget}°C ≈ ${ctrlTargetPid}°C), skippar`)
    return { ctrlTargetPid: ctrlTarget, compensation: 0, avgDelta, dampingFactor, pillRate: _pillRate, probeRate: _probeRate, etaMinutes: _etaMinutes, errorCorrection, pCorrection, iCorrection, learnedBaseline, deltaBucket, convergenceCount, constraints }
  }

  console.log(`🎯 PID ${controllerName}: actual_target=${actualTarget}°C, avgDelta=${avgDelta.toFixed(2)}°C [${deltaBucket}], rawKomp=${rawCompensation.toFixed(2)}°C, damping=${dampingFactor.toFixed(2)}, komp=${compensation.toFixed(2)}°C, PI=+${errorCorrection.toFixed(2)}°C (P=${pCorrection.toFixed(2)}, I=${iCorrection.toFixed(2)}, learned=${learnedBaseline.toFixed(2)}), ctrl_target_pid=${ctrlTargetPid}°C (ctrl_target=${ctrlTarget}°C)`)

  return { ctrlTargetPid, compensation, avgDelta, dampingFactor, pillRate: _pillRate, probeRate: _probeRate, etaMinutes: _etaMinutes, errorCorrection, pCorrection, iCorrection, learnedBaseline, deltaBucket, convergenceCount, constraints }
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
