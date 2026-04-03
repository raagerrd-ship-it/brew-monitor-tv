import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { updateLearnedParam, getLearnedParam, getTempBucket } from './learning-utils.ts'

/** Persist PID state to controller_learned_compensation */
async function persistPidState(
  supabase: ReturnType<typeof createClient>,
  controllerId: string, deltaBucket: string, mode: string, stepType: string,
  pCorrection: number, iCorrection: number, avgError: number,
  dutyCycle: number,
  extra?: { learned_pi_correction?: number; convergence_count?: number; last_converged_at?: string },
): Promise<void> {
  await supabase.from('controller_learned_compensation').upsert({
    controller_id: controllerId, delta_bucket: deltaBucket, mode, step_type: stepType,
    latest_p_correction: pCorrection, latest_i_correction: iCorrection,
    latest_d_damping: dutyCycle, // Repurposed: stores total duty cycle (P+I clamped)
    latest_avg_error: avgError,
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

// ============================================================
// PID Control & Thermal Learning
//
// SSOT Naming Convention:
//   actualTarget  = user's desired temperature (profile_target_temp)
//   actualTemp    = fused sensor reading (avg or probe-only)
//   ctrlTarget    = current hardware target (target_temp before PID)
//   ctrlTargetPid = actualTarget (reference, PID output is duty cycle)
//
// PID error = actualTarget - actualTemp (same domain user sees)
//
// Pure PI regulator — no D-term. Slow thermal systems don't benefit
// from derivative action, and sensor noise gets amplified.
// ============================================================

/**
 * Calculate PID duty cycle for temperature control.
 *
 * PID error = actualTarget - actualTemp (same domain user sees).
 * Output is a duty cycle (0–1), not a temperature offset.
 *
 * @param actualTarget   User's desired temperature (profile_target_temp)
 * @param ctrlTarget     The current hardware target (target_temp before PID)
 * @param actualTemp     Pre-computed fused sensor reading (avg or probe-only)
 * @param isStaleData    Whether sensor data is stale (no new readings since last PID run)
 */
export async function calculateCompensatedTarget(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
  actualTarget: number,
  ctrlTarget: number,
  controllerName: string,
  mode: 'heating' | 'cooling' = 'cooling',
  stepType: string = 'unknown',
  actualTemp: number,
  isStaleData: boolean,
  coolingUtilization?: number | null,
  rampContext?: { requiredRatePerHour: number; tempBucket: string; loadBucket: string } | null,
  pillRate?: number | null,
): Promise<{ ctrlTargetPid: number; dutyCycle?: number; pillRate?: number | null; pCorrection?: number; iCorrection?: number; learnedBaseline?: number; deltaBucket?: string; convergenceCount?: number; constraints?: string[]; persistPromise?: Promise<void> }> {
  const constraints: string[] = []

  // === Adaptive PI-term ===
  const deltaBucket = 'low'

  // ── Parallel pre-fetch: PID state + steady-state duty floor ──
  const ssBucket = getTempBucket(actualTarget)
  const [{ data: learnedRow }, ssParam] = await Promise.all([
    supabase
      .from('controller_learned_compensation')
      .select('learned_pi_correction, convergence_count, accumulated_integral, latest_avg_error, style_key, updated_at')
      .eq('controller_id', controllerId)
      .eq('delta_bucket', deltaBucket)
      .eq('mode', mode)
      .eq('step_type', stepType)
      .maybeSingle(),
    getLearnedParam(supabase, controllerId, `steady_state_duty:${ssBucket}`, 0),
  ])

  const learnedBaseline = learnedRow ? parseFloat(String(learnedRow.learned_pi_correction)) : 0
  const convergenceCount = learnedRow?.convergence_count ?? 0
  const persistedIntegral = learnedRow ? parseFloat(String(learnedRow.accumulated_integral)) : 0
  const prevAvgError = learnedRow ? parseFloat(String(learnedRow.latest_avg_error ?? '0')) : 0

  if (isStaleData) {
    console.log(`⏸️ Stale data ${controllerName} [${mode}]: hoppar över I-ackumulering`)
  }

  // Error: actualTarget - actualTemp (same domain as user sees)
  const avgError = actualTarget - actualTemp

  let pCorrection = 0
  let iCorrection = 0

  // === Utilization-based saturation ===
  let isSaturated = false
  if (coolingUtilization != null && coolingUtilization >= 0.90 && mode === 'cooling') {
    isSaturated = true
    console.log(`⚡ Util saturation ${controllerName}: cooling util ${Math.round(coolingUtilization * 100)}% ≥ 90% — hardware maxed`)
    constraints.push(`util-sat=${Math.round(coolingUtilization * 100)}%`)
  }

  // ═══════════════════════════════════════════════════════
  // UNIFIED DUTY CYCLE MODEL (cooling & heating)
  // ═══════════════════════════════════════════════════════
  const isCooling = mode === 'cooling'
  const need = isCooling ? -avgError : avgError // positive when action is needed
  const DUTY_P = 0.5
  const DUTY_I = 0.15
  const DUTY_DECAY = 0.98
  const DUTY_IMAX = 0.95
  const modeLabel = isCooling ? 'Duty' : 'Heating duty'

  // Migration: old integral was in °C (typically 0–2). New model uses duty (0–1).
  let integral = persistedIntegral
  if (isCooling && integral > 1.0) {
    const seed = ssParam // Already fetched above
    integral = seed.sampleCount >= 3 ? seed.value : 0
    console.log(`🔄 Duty migration ${controllerName}: integral ${persistedIntegral.toFixed(2)}°C → ${integral.toFixed(2)} duty`)
  } else if (!isCooling && Math.abs(integral) > 1.0) {
    integral = 0
    console.log(`🔄 Heating duty migration ${controllerName}: integral ${persistedIntegral.toFixed(2)}°C → 0 duty`)
  }

  let dutyCycle = 0

  // ── Steady-state duty floor ──────────────────────────────
  const ssFloor = ssParam.sampleCount >= 5 ? ssParam.value : 0

  if (Math.abs(avgError) <= 0.10) {
    // DEADBAND
    if (ssFloor > 0 && integral > ssFloor) {
      integral = integral * 0.90 + ssFloor * 0.10
    } else if (ssFloor > 0) {
      integral = ssFloor
    } else {
      integral *= 0.90
    }
    dutyCycle = Math.max(0, integral)
    constraints.push('deadband')
    console.log(`✅ ${modeLabel} deadband ${controllerName}: err=${avgError.toFixed(2)}°, I=${integral.toFixed(3)}, floor=${ssFloor.toFixed(3)}, duty=${(dutyCycle * 100).toFixed(0)}%`)
  } else if (need < -0.10 && need >= -0.25) {
    // MILD OVERSHOOT — gentle decay, preserve integral
    integral *= 0.95
    dutyCycle = Math.max(0, integral)
    constraints.push('mild-overshoot')
    console.log(`🔸 ${modeLabel} mild overshoot ${controllerName}: err=${avgError.toFixed(2)}°, need=${need.toFixed(2)}°, I→${integral.toFixed(3)}, floor=${ssFloor.toFixed(3)}, duty=${(dutyCycle * 100).toFixed(0)}%`)
  } else if (need < -0.25) {
    // OVER-ACTUATED — aggressive erosion
    const overshoot = Math.abs(need)

    if (ssFloor > 0) {
      const erosionAlpha = Math.min(0.6, 0.3 + overshoot)
      const reducedFloor = Math.max(0, integral * erosionAlpha + ssFloor * (1 - erosionAlpha))
      const quantizedFloor = Math.floor(reducedFloor * 10) / 10
      if (quantizedFloor < ssFloor) {
        await updateLearnedParam(supabase, controllerId, `steady_state_duty:${ssBucket}`, quantizedFloor, 0, 1.0, 1.0)
        console.log(`📉 ${modeLabel} floor erosion ${controllerName}: ${ssFloor.toFixed(2)} → ${quantizedFloor.toFixed(2)} (overshoot=${overshoot.toFixed(2)}°)`)
      }
    }

    const decayRate = Math.min(0.85, 0.75 - overshoot * 0.1)
    integral = Math.max(0, integral * decayRate)
    dutyCycle = Math.max(0, integral)
    constraints.push(isCooling ? 'overcooled' : 'overheated')
    console.log(`${isCooling ? '❄️' : '🔥'} ${modeLabel} ${isCooling ? 'overcooled' : 'overheated'} ${controllerName}: err=${avgError.toFixed(2)}°, overshoot=${overshoot.toFixed(2)}°, I→${integral.toFixed(3)}, floor=${ssFloor.toFixed(3)}, duty=${(dutyCycle * 100).toFixed(0)}%`)
  } else {
    // NEEDS ACTION — proportional + integral
    if (isStaleData) {
      pCorrection = 0
      console.log(`⏸️ ${modeLabel} stale ${controllerName}: P=0 (no new data), holding I=${integral.toFixed(3)}`)
    } else {
      pCorrection = need * DUTY_P
      integral = integral * DUTY_DECAY + need * DUTY_I
      integral = Math.max(0, Math.min(DUTY_IMAX, integral))

      // ── Braking zone ──
      // Only brake when error is DECREASING (approaching setpoint).
      // If error is growing, the system needs to ramp up, not slow down.
      const BRAKE_ZONE = 0.50
      const prevNeed = isCooling ? -prevAvgError : prevAvgError // previous "need" in same sign convention
      const errorDecreasing = need <= prevNeed + 0.02 // small tolerance for sensor noise
      if (need < BRAKE_ZONE && ssFloor > 0 && errorDecreasing) {
        const proximity = Math.max(0, (need - 0.10) / (BRAKE_ZONE - 0.10))
        const blendedI = integral * proximity + ssFloor * (1 - proximity)
        if (blendedI < integral) {
          constraints.push(`brake=${(proximity * 100).toFixed(0)}%`)
          console.log(`🛑 ${modeLabel} braking ${controllerName}: need=${need.toFixed(2)}°, proximity=${proximity.toFixed(2)}, I ${integral.toFixed(3)} → ${blendedI.toFixed(3)} (floor=${ssFloor.toFixed(3)})`)
          integral = blendedI
        }
      } else if (need < BRAKE_ZONE && ssFloor > 0 && !errorDecreasing) {
        constraints.push('brake-skip')
        console.log(`⏩ ${modeLabel} brake skipped ${controllerName}: error growing (prev=${Math.abs(prevAvgError).toFixed(2)}° → now=${need.toFixed(2)}°), letting I build`)
      }

      // ── Settling guard (cooling only) ──
      if (isCooling && integral < 0.15 && need > 0.3) {
        const maxInitialP = 0.30
        if (pCorrection > maxInitialP) {
          const uncappedP = pCorrection
          pCorrection = maxInitialP
          constraints.push('settling')
          console.log(`🛡️ Settling guard ${controllerName}: I=${integral.toFixed(3)} < 0.15, capping P ${uncappedP.toFixed(2)} → ${maxInitialP} (väntar på feedback)`)
        }
      }
    }
    iCorrection = integral

    let raw = pCorrection + integral

    // Saturation guard
    if (isSaturated && raw > integral + 0.1) {
      raw = integral + 0.1
      constraints.push('duty-sat')
    }

    // Full action at large error (> 2°C)
    if (need > 2.0) {
      raw = Math.max(raw, 1.0)
      constraints.push(isCooling ? 'full-cooling' : 'full-heating')
    }

    // Ramp rate boost
    if (isCooling && rampContext && !isSaturated && pillRate !== null && pillRate !== undefined) {
      const observedRate = Math.abs(pillRate)
      const rateDeficit = rampContext.requiredRatePerHour - observedRate
      if (rateDeficit > 0.1) {
        const rampBoost = Math.min(rateDeficit * 0.2, 0.3)
        raw = Math.min(1.0, raw + rampBoost)
        constraints.push(`ramp-boost=${rampBoost.toFixed(2)}`)
        console.log(`🚀 Duty ramp boost ${controllerName}: required=${rampContext.requiredRatePerHour.toFixed(2)}°/h, actual=${observedRate.toFixed(2)}°/h → +${(rampBoost * 100).toFixed(0)}%`)
      }
    }

    dutyCycle = Math.max(0, Math.min(1.0, raw))
    console.log(`🎯 ${modeLabel} ${controllerName}: need=${need.toFixed(2)}°, P=${pCorrection.toFixed(2)}, I=${integral.toFixed(3)}, floor=${ssFloor.toFixed(3)}, duty=${(dutyCycle * 100).toFixed(0)}%${isSaturated ? ' [SAT]' : ''}`)
  }

  // Defer persist — caller can batch this with other DB writes
  const persistPromise = persistPidState(supabase, controllerId, deltaBucket, mode, stepType,
    pCorrection, integral, avgError, dutyCycle)

  return {
    ctrlTargetPid: Math.round(actualTarget * 10) / 10, dutyCycle,
    pillRate: pillRate ?? null, pCorrection, iCorrection: integral,
    learnedBaseline, deltaBucket, convergenceCount, constraints,
    persistPromise,
  }
}

// ============================================================
// Thermal Rate Learning
// ============================================================

interface RateFilter {
  accept: (ratePerHour: number, temp: number, target: number) => boolean
  normalise?: (rate: number) => number
}

interface LearnRateResult {
  rate: number
  sampleCount: number
}

/**
 * Shared core: learn a thermal rate from temp_controller_history using
 * pluggable filter logic.
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
    .select('current_temp, actual_temp, target_temp, cooling_enabled, recorded_at')
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
    const currTemp = parseFloat(String((curr as any).actual_temp))
    const prevTemp = parseFloat(String((prev as any).actual_temp))
    const tempDiff = currTemp - prevTemp
    const timeDiffHours = (new Date(curr.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) / (1000 * 60 * 60)

    if (timeDiffHours < 0.01 || timeDiffHours > 0.5) continue

    const ratePerHour = tempDiff / timeDiffHours
    const temp = currTemp
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

function getThermalRateParamName(mode: 'heating' | 'cooling', tempBucket?: string): string {
  return tempBucket ? `thermal_rate_${mode}:${tempBucket}` : `thermal_rate_${mode}`
}

/**
 * Learn and retrieve the hardware thermal rate (°C/hour) for a controller.
 */
export async function learnThermalRate(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
  mode: 'heating' | 'cooling',
  skipLearning?: boolean,
  tempBucket?: string,
): Promise<number | null> {
  const filter = mode === 'heating' ? HEATING_FILTER : COOLING_FILTER
  const globalParamName = getThermalRateParamName(mode)
  const globalLogPrefix = `🏎️ Thermal rate ${controllerId} [${mode}]:`

  if (!tempBucket) {
    const result = await learnRateCore(
      supabase, controllerId, globalParamName, filter,
      !!skipLearning, globalLogPrefix,
    )
    return result ? result.rate : null
  }

  const bucketFilter: RateFilter = {
    accept: (r, temp, target) => getTempBucket(temp) === tempBucket && filter.accept(r, temp, target),
    normalise: filter.normalise,
  }

  const [bucketResult, globalResult] = await Promise.all([
    learnRateCore(
      supabase,
      controllerId,
      getThermalRateParamName(mode, tempBucket),
      bucketFilter,
      !!skipLearning,
      `🏎️ Thermal rate ${controllerId} [${mode}:${tempBucket}]:`,
    ),
    learnRateCore(
      supabase,
      controllerId,
      globalParamName,
      filter,
      !!skipLearning,
      globalLogPrefix,
    ),
  ])

  if (bucketResult && bucketResult.sampleCount >= 3) return bucketResult.rate
  return globalResult?.rate ?? bucketResult?.rate ?? null
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
