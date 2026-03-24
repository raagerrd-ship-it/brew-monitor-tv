import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { updateLearnedParam, getLearnedParam, getTempBucket } from './learning-utils.ts'

/** Persist PID state to controller_learned_compensation */
async function persistPidState(
  supabase: ReturnType<typeof createClient>,
  controllerId: string, deltaBucket: string, mode: string, stepType: string,
  pCorrection: number, iCorrection: number, dampingFactor: number, avgError: number,
  extra?: { learned_pi_correction?: number; convergence_count?: number; last_converged_at?: string },
): Promise<void> {
  await supabase.from('controller_learned_compensation').upsert({
    controller_id: controllerId, delta_bucket: deltaBucket, mode, step_type: stepType,
    latest_p_correction: pCorrection, latest_i_correction: iCorrection,
    latest_d_damping: dampingFactor, latest_avg_error: avgError,
    accumulated_integral: iCorrection,
    updated_at: new Date().toISOString(),
    ...extra,
  }, { onConflict: 'controller_id,delta_bucket,mode,step_type', ignoreDuplicates: false })
}

/** Compute updated integral: decay + accumulate (or hold if stale) */
function computeIntegral(
  persistedIntegral: number, avgError: number, isStaleData: boolean,
  iDecay: number, iGain: number, iClamp: number,
): number {
  if (isStaleData) return persistedIntegral
  const newIntegral = persistedIntegral * iDecay + avgError * iGain
  return Math.max(-iClamp, Math.min(iClamp, newIntegral))
}

/**
 * Retrieve the learned cooling rate for a specific temp bucket and load.
 * Returns null if insufficient data (< 3 samples).
 */
async function getLearnedCoolingRate(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
  tempBucket: string,
  loadBucket: string,
): Promise<number | null> {
  const param = await getLearnedParam(supabase, controllerId, `cooling_rate:${tempBucket}:${loadBucket}`, -1)
  return param.sampleCount >= 3 ? param.value : null
}

// ============================================================
// PID Control & Thermal Learning
//
// SSOT Naming Convention:
//   baseTarget    = sensor-fused target from dual-sensor module
//                   (= profileTarget - sensorDelta)
//   profileTarget = user's desired temperature (profile_target_temp)
//                   Used ONLY for logging and delta calculation (avgDelta)
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
    iDecay: 0.95,
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
 *
 * The baseTarget is the sensor-fused "grundmål" from the dual-sensor module:
 *   baseTarget = profileTarget - (pill - probe) / 2
 *
 * PID only adds/subtracts error correction on top of baseTarget:
 *   ctrlTargetPid = baseTarget + errorCorrection
 *
 * @param baseTarget     Sensor-fused target from dual-sensor module (grundmål)
 * @param profileTarget  User's desired temperature (for logging and delta calc only)
 * @param ctrlTarget     The current hardware target (target_temp before PID)
 * @param actualTemp     Pre-computed fused sensor reading (avg or probe-only)
 * @param probeTemp      The controller's probe temperature
 */
export async function calculateCompensatedTarget(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
  baseTarget: number,
  profileTarget: number,
  ctrlTarget: number,
  controllerName: string,
  settings: PillCompensationSettings,
  mode: 'heating' | 'cooling' = 'cooling',
  stepType: string = 'unknown',
  actualTemp?: number,
  probeTemp?: number,
  coolingUtilization?: number | null,
  rampContext?: { requiredRatePerHour: number; tempBucket: string; loadBucket: string } | null,
  skipRateLimit?: boolean,
  skipLearning?: boolean,
): Promise<{ ctrlTargetPid: number; dutyCycle?: number; compensation: number; avgDelta: number; dampingFactor?: number; pillRate?: number | null; probeRate?: number | null; etaMinutes?: number | null; errorCorrection?: number; pCorrection?: number; iCorrection?: number; learnedBaseline?: number; deltaBucket?: string; convergenceCount?: number; constraints?: string[] }> {
  const constraints: string[] = [];
  const { rateLimit: maxChangePerCycle, emergencyThreshold, minScale: minScaleFactor, maxCompensation, anticipationWindowHours } = settings
  const mp = MODE_PARAMS[mode]
  const effectiveMaxRate = mode === 'heating' ? Math.min(maxChangePerCycle, 0.5) : maxChangePerCycle
  const effectiveMaxComp = mode === 'heating' ? Math.min(maxCompensation, 3.0) : maxCompensation

  // Sensor delta: derived from baseTarget vs profileTarget
  // baseTarget already has sensorDelta baked in from dual-sensor module
  const avgDelta = Math.round((profileTarget - baseTarget) * 100) / 100
  const absDelta = Math.abs(avgDelta)

  // Fetch delta history — still needed for D-term rate calculations
  const { data: deltaHistory } = await supabase
    .from('temp_delta_history')
    .select('delta, pill_temp, controller_temp, recorded_at')
    .eq('controller_id', controllerId)
    .order('recorded_at', { ascending: false })
    .limit(8)

  if (!deltaHistory || deltaHistory.length === 0) {
    if (actualTemp == null) {
      console.log(`⚠️ PID ${controllerName}: ingen deltahistorik och inga sensorvärden — returnerar baseTarget`)
      return { ctrlTargetPid: baseTarget, compensation: 0, avgDelta: 0 }
    }
  }

  if (absDelta < 0.1) {
    console.log(`✅ PID ${controllerName}: sensorΔ ${avgDelta.toFixed(2)}°C < 0.1 — kör PI utan sensorkorrigering`)
  }

  // === D-term: calculate pill rate, damping factor, and use learned thermal rate ===
  let dampingFactor = 1.0
  let _pillRate: number | null = null
  let _probeRate: number | null = null
  let _etaMinutes: number | null = null
  const ANTICIPATION_WINDOW_HOURS = anticipationWindowHours

  const learnedThermalRate = await learnThermalRate(supabase, controllerId, mode, skipLearning)

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
      const avgDistance = currentAvg - baseTarget

      const isConverging = (avgDistance > 0 && pillRate < -0.1) || (avgDistance < 0 && pillRate > 0.1)
      if (Math.abs(avgDistance) > 0.1 && isConverging) {
        const observedAvgRate = Math.abs(pillRate) / 2
        const hwRate = learnedThermalRate ? learnedThermalRate / 2 : null
        const avgRate = hwRate ? Math.min(observedAvgRate, hwRate) : observedAvgRate
        const etaHours = avgRate > 0.01 ? Math.abs(avgDistance) / avgRate : 99
        _etaMinutes = Math.round(etaHours * 60)
        dampingFactor = Math.min(1.0, Math.max(0.2, etaHours / ANTICIPATION_WINDOW_HOURS))
        console.log(`🌡️ D-term ${controllerName} [${mode}]: pillRate=${pillRate.toFixed(2)}°C/h, hwRate=${learnedThermalRate?.toFixed(2) ?? '?'}°C/h, avg=${currentAvg.toFixed(1)}°C→${baseTarget}°C, ETA=${_etaMinutes}min, damping=${dampingFactor.toFixed(2)}`)
      } else {
        _etaMinutes = null
        console.log(`🌡️ D-term ${controllerName}: pillRate=${pillRate.toFixed(2)}°C/h, avg=${((pillNow + ctrlNow) / 2).toFixed(1)}°C vs mål=${baseTarget}°C (ej mot mål eller för långsam), damping=1.0`)
      }
    }
  }

  // compensation is kept as a return value for logging compatibility.
  // It equals avgDelta (profileTarget - baseTarget), but is NOT applied in the formula —
  // baseTarget already has sensorDelta baked in.
  const compensation = avgDelta
  const latestCtrlForComp = deltaHistory?.[0] ? parseFloat(String(deltaHistory[0].controller_temp)) : (probeTemp ?? baseTarget)

  // === Adaptive PI-term ===
  const deltaBucket = absDelta > 3 ? 'high' : absDelta > 1.5 ? 'medium' : 'low'

  let learnedRow: any = null;
  {
    const { data } = await supabase
      .from('controller_learned_compensation')
      .select('learned_pi_correction, convergence_count, accumulated_integral, style_key, updated_at')
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
  const newestDataTime = deltaHistory?.[0]?.recorded_at ? new Date(deltaHistory[0].recorded_at).getTime() : 0
  const lastPidRunTime = learnedRow?.updated_at ? new Date(learnedRow.updated_at).getTime() : 0
  const isStaleData = lastPidRunTime > 0 && newestDataTime > 0 && newestDataTime <= lastPidRunTime
  if (isStaleData) {
    console.log(`⏸️ Stale data ${controllerName} [${mode}]: senaste mätning ${new Date(newestDataTime).toISOString()} ≤ senaste PID ${new Date(lastPidRunTime).toISOString()} — hoppar över I-ackumulering`)
  }

  // Error: probe vs baseTarget (both in probe domain, no domain mismatch)
  // profileTarget is only for logging — PID works entirely in baseTarget domain.
  const currentProbeForError = probeTemp ?? (deltaHistory?.[0]
    ? parseFloat(String(deltaHistory[0].controller_temp))
    : baseTarget)
  const avgError = baseTarget - currentProbeForError

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

  // === Utilization-based saturation ===
  // If cooling circuit is running >90% of the time, the hardware is maxed out.
  // No point pushing the target further — it would only accumulate integral error.
  if (coolingUtilization != null && coolingUtilization >= 0.90 && mode === 'cooling') {
    if (!isSaturated) {
      isSaturated = true
      console.log(`⚡ Util saturation ${controllerName}: cooling util ${Math.round(coolingUtilization * 100)}% ≥ 90% — hardware maxed, begränsar kompensation`)
    }
    constraints.push(`util-sat=${Math.round(coolingUtilization * 100)}%`)
  }

  // ═══════════════════════════════════════════════════════
  // COOLING DUTY CYCLE MODEL
  // PID output = duty cycle (0.0–1.0) instead of a target offset.
  // The hardware is controlled via PWM bursts: 0°C = cooling ON,
  // baseTarget = cooling OFF. Burst length = duty × 300s.
  // The integral accumulates the steady-state duty needed at equilibrium.
  // ═══════════════════════════════════════════════════════
  if (mode === 'cooling') {
    const coolingNeed = -avgError // positive when probe > baseTarget (needs cooling)
    const DUTY_P = 0.5    // duty per °C error
    const DUTY_I = 0.05   // duty accumulation per cycle per °C
    const DUTY_DECAY = 0.98 // slow decay for stable steady-state
    const DUTY_IMAX = 0.95  // max 95% from integral

    // Migration: old integral was in °C (typically 0–2). New model uses duty (0–1).
    let integral = persistedIntegral
    if (integral > 1.0) {
      const cBucket = getTempBucket(baseTarget)
      const seed = await getLearnedParam(supabase, controllerId, `steady_state_duty:${cBucket}`, 0)
      integral = seed.sampleCount >= 3 ? seed.value : 0
      console.log(`🔄 Duty migration ${controllerName}: integral ${persistedIntegral.toFixed(2)}°C → ${integral.toFixed(2)} duty`)
    }

    let dutyCycle = 0

    if (Math.abs(avgError) <= 0.1) {
      // DEADBAND: hold at integral (learned steady-state duty)
      integral *= 0.9
      dutyCycle = Math.max(0, integral)
      constraints.push('deadband')
      console.log(`✅ Duty deadband ${controllerName}: err=${avgError.toFixed(2)}°, I=${integral.toFixed(3)}, duty=${(dutyCycle * 100).toFixed(0)}%`)
    } else if (coolingNeed < -0.1) {
      // OVERCOOLED: stop cooling, fast-decay integral
      integral *= 0.85
      dutyCycle = 0
      constraints.push('overcooled')
      console.log(`❄️ Duty overcooled ${controllerName}: err=${avgError.toFixed(2)}°, I→${integral.toFixed(3)}, duty=0%`)
    } else {
      // NEEDS COOLING — proportional + integral
      pCorrection = coolingNeed * DUTY_P

      if (isStaleData) {
        console.log(`⏸️ Duty stale ${controllerName}: holding I=${integral.toFixed(3)}`)
      } else {
        integral = integral * DUTY_DECAY + coolingNeed * DUTY_I
        integral = Math.max(0, Math.min(DUTY_IMAX, integral))
      }
      iCorrection = integral

      // D-term: damp P only (integral = steady-state, must persist)
      let raw = pCorrection * dampingFactor + integral

      // Saturation guard: don't push duty past integral + 10% when hardware is maxed
      if (isSaturated && raw > integral + 0.1) {
        raw = integral + 0.1
        constraints.push('duty-sat')
      }

      // Full cooling at large error (> 2°C too warm)
      if (coolingNeed > 2.0) {
        raw = Math.max(raw, 1.0)
        constraints.push('full-cooling')
      }

      // Ramp rate boost: if cooling too slowly for the required ramp
      if (rampContext && !isSaturated && _pillRate !== null) {
        const observedRate = Math.abs(_pillRate)
        const rateDeficit = rampContext.requiredRatePerHour - observedRate
        if (rateDeficit > 0.1) {
          const rampBoost = Math.min(rateDeficit * 0.2, 0.3)
          raw = Math.min(1.0, raw + rampBoost)
          constraints.push(`ramp-boost=${rampBoost.toFixed(2)}`)
          console.log(`🚀 Duty ramp boost ${controllerName}: required=${rampContext.requiredRatePerHour.toFixed(2)}°/h, actual=${observedRate.toFixed(2)}°/h → +${(rampBoost * 100).toFixed(0)}%`)
        }
      }

      dutyCycle = Math.max(0, Math.min(1.0, raw))
      console.log(`🎯 Duty ${controllerName}: need=${coolingNeed.toFixed(2)}°, P=${pCorrection.toFixed(2)}, I=${integral.toFixed(3)}, damp=${dampingFactor.toFixed(2)}, duty=${(dutyCycle * 100).toFixed(0)}%${isSaturated ? ' [SAT]' : ''}`)
    }

    await persistPidState(supabase, controllerId, deltaBucket, mode, stepType,
      pCorrection, integral, dampingFactor, avgError)

    return {
      ctrlTargetPid: Math.round(baseTarget * 10) / 10, dutyCycle,
      compensation, avgDelta, dampingFactor,
      pillRate: _pillRate, probeRate: _probeRate, etaMinutes: _etaMinutes,
      errorCorrection: 0, pCorrection, iCorrection: integral,
      learnedBaseline, deltaBucket, convergenceCount, constraints,
    }
  }
  // ═══════════════════════════════════════════════════════
  // HEATING DUTY CYCLE MODEL
  // Mirror of cooling: PID output = duty cycle (0.0–1.0).
  // Hardware controlled via PWM: maxTemp = heating ON,
  // baseTarget = heating OFF. Burst length = duty × 300s.
  // ═══════════════════════════════════════════════════════
  // mode === 'heating' guaranteed here (cooling returns early above)
  const heatingNeed = avgError // positive when probe < baseTarget (needs heating)
  const HEAT_P = 0.5
  const HEAT_I = 0.05
  const HEAT_DECAY = 0.98
  const HEAT_IMAX = 0.95

  // Migration: old integral was in °C (typically 0–2). New model uses duty (0–1).
  let hIntegral = persistedIntegral
  if (Math.abs(hIntegral) > 1.0) {
    hIntegral = 0
    console.log(`🔄 Heating duty migration ${controllerName}: integral ${persistedIntegral.toFixed(2)}°C → 0 duty`)
  }

  let hDutyCycle = 0

  if (Math.abs(avgError) <= 0.1) {
    // DEADBAND: hold at integral (learned steady-state duty)
    hIntegral *= 0.9
    hDutyCycle = Math.max(0, hIntegral)
    constraints.push('deadband')
    console.log(`✅ Heating deadband ${controllerName}: err=${avgError.toFixed(2)}°, I=${hIntegral.toFixed(3)}, duty=${(hDutyCycle * 100).toFixed(0)}%`)
  } else if (heatingNeed < -0.1) {
    // OVERHEATED: stop heating, fast-decay integral
    hIntegral *= 0.85
    hDutyCycle = 0
    constraints.push('overheated')
    console.log(`🔥 Heating overheated ${controllerName}: err=${avgError.toFixed(2)}°, I→${hIntegral.toFixed(3)}, duty=0%`)
  } else {
    // NEEDS HEATING — proportional + integral
    pCorrection = heatingNeed * HEAT_P

    if (isStaleData) {
      console.log(`⏸️ Heating stale ${controllerName}: holding I=${hIntegral.toFixed(3)}`)
    } else {
      hIntegral = hIntegral * HEAT_DECAY + heatingNeed * HEAT_I
      hIntegral = Math.max(0, Math.min(HEAT_IMAX, hIntegral))
    }
    iCorrection = hIntegral

    // D-term: damp P only (integral = steady-state, must persist)
    let raw = pCorrection * dampingFactor + hIntegral

    // Saturation guard
    if (isSaturated && raw > hIntegral + 0.1) {
      raw = hIntegral + 0.1
      constraints.push('duty-sat')
    }

    // Full heating at large error (> 2°C too cold)
    if (heatingNeed > 2.0) {
      raw = Math.max(raw, 1.0)
      constraints.push('full-heating')
    }

    hDutyCycle = Math.max(0, Math.min(1.0, raw))
    console.log(`🎯 Heating duty ${controllerName}: need=${heatingNeed.toFixed(2)}°, P=${pCorrection.toFixed(2)}, I=${hIntegral.toFixed(3)}, damp=${dampingFactor.toFixed(2)}, duty=${(hDutyCycle * 100).toFixed(0)}%${isSaturated ? ' [SAT]' : ''}`)
  }

  await persistPidState(supabase, controllerId, deltaBucket, mode, stepType,
    pCorrection, hIntegral, dampingFactor, avgError)

  return {
    ctrlTargetPid: Math.round(baseTarget * 10) / 10, dutyCycle: hDutyCycle,
    compensation, avgDelta, dampingFactor,
    pillRate: _pillRate, probeRate: _probeRate, etaMinutes: _etaMinutes,
    errorCorrection: 0, pCorrection, iCorrection: hIntegral,
    learnedBaseline, deltaBucket, convergenceCount, constraints,
  }
}

// ============================================================
// Thermal Rate Learning
// ============================================================
// ============================================================
// Shared thermal-rate learning core
// ============================================================

interface RateFilter {
  /** Only keep samples where ratePerHour passes this predicate */
  accept: (ratePerHour: number, temp: number, target: number) => boolean
  /** Normalise the accepted rate (e.g. Math.abs for cooling) */
  normalise?: (rate: number) => number
}

interface LearnRateResult {
  rate: number
  sampleCount: number
}

/**
 * Shared core: learn a thermal rate from temp_controller_history using
 * pluggable filter logic. Both learnThermalRate and learnGlycolCoolerRate
 * delegate here.
 */
async function learnRateCore(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
  paramName: string,
  filter: RateFilter,
  skipLearning: boolean,
  logPrefix: string,
): Promise<LearnRateResult | null> {
  // 1. Cache check — reuse recent value
  const { data: existing } = await supabase
    .from('fermentation_learnings')
    .select('learned_value, sample_count, last_updated_at')
    .eq('controller_id', controllerId)
    .eq('parameter_name', paramName)
    .maybeSingle()

  if (existing && existing.last_updated_at) {
    const hoursSince = (Date.now() - new Date(existing.last_updated_at).getTime()) / (1000 * 60 * 60)
    if (hoursSince < 2 && existing.sample_count >= 3) {
      return { rate: parseFloat(String(existing.learned_value)), sampleCount: existing.sample_count }
    }
  }

  // 2. Fetch recent history
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const { data: history } = await supabase
    .from('temp_controller_history')
    .select('current_temp, target_temp, cooling_enabled, recorded_at')
    .eq('controller_id', controllerId)
    .gte('recorded_at', sixHoursAgo)
    .order('recorded_at', { ascending: true })
    .limit(200)

  if (!history || history.length < 5) {
    return existing ? { rate: parseFloat(String(existing.learned_value)), sampleCount: existing.sample_count } : null
  }

  // 3. Compute rates with parametric filter
  const norm = filter.normalise ?? ((r) => r)
  const rates: number[] = []
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]
    const curr = history[i]
    const tempDiff = parseFloat(String(curr.current_temp)) - parseFloat(String(prev.current_temp))
    const timeDiffHours = (new Date(curr.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) / (1000 * 60 * 60)

    if (timeDiffHours < 0.01 || timeDiffHours > 0.5) continue

    const ratePerHour = tempDiff / timeDiffHours
    const temp = parseFloat(String(curr.current_temp))
    const target = parseFloat(String(curr.target_temp))

    if (filter.accept(ratePerHour, temp, target)) {
      rates.push(norm(ratePerHour))
    }
  }

  if (rates.length < 2) {
    return existing ? { rate: parseFloat(String(existing.learned_value)), sampleCount: existing.sample_count } : null
  }

  // 4. p80 percentile
  rates.sort((a, b) => a - b)
  const p80 = rates[Math.floor(rates.length * 0.8)]

  // 5. Persist via EMA or return cached
  if (skipLearning) {
    console.log(`${logPrefix} skip learning (idle) — p80=${p80.toFixed(2)}`)
    return existing
      ? { rate: parseFloat(String(existing.learned_value)), sampleCount: existing.sample_count }
      : { rate: Math.round(p80 * 100) / 100, sampleCount: 0 }
  }

  const result = await updateLearnedParam(supabase, controllerId, paramName, p80, 0.1, 20.0)
  const rounded = Math.round(result.newValue * 100) / 100

  console.log(`${logPrefix} ${rounded.toFixed(2)}°C/h (${rates.length} samples, p80=${p80.toFixed(2)}, prev=${result.oldValue.toFixed(2)})`)

  return { rate: rounded, sampleCount: result.sampleCount }
}

// ============================================================
// Public wrappers (preserve existing signatures)
// ============================================================

const HEATING_FILTER: RateFilter = {
  accept: (r, temp, target) => r > 0.3 && temp < target,
}
const COOLING_FILTER: RateFilter = {
  accept: (r, temp, target) => r < -0.3 && temp > target,
  normalise: Math.abs,
}

/**
 * Learn and retrieve the hardware thermal rate (°C/hour) for a controller.
 */
export async function learnThermalRate(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
  mode: 'heating' | 'cooling',
  skipLearning?: boolean,
): Promise<number | null> {
  const filter = mode === 'heating' ? HEATING_FILTER : COOLING_FILTER
  const result = await learnRateCore(
    supabase, controllerId, `thermal_rate_${mode}`, filter,
    !!skipLearning, `🏎️ Thermal rate ${controllerId} [${mode}]:`,
  )
  return result ? result.rate : null
}

/**
 * Learn glycol cooler thermal rate under different load conditions.
 */
export async function learnGlycolCoolerRate(
  supabase: ReturnType<typeof createClient>,
  coolerId: string,
  currentLoad: number,
  skipLearning?: boolean,
): Promise<{ rate: number; sampleCount: number } | null> {
  const loadBucket = currentLoad >= 2 ? '2plus' : String(currentLoad)
  return learnRateCore(
    supabase, coolerId, `glycol_rate:load_${loadBucket}`, COOLING_FILTER,
    !!skipLearning, `🧊 Glycol rate ${coolerId} [load=${loadBucket}]:`,
  )
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
