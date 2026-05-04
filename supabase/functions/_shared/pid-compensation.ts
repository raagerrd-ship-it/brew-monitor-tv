import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { updateLearnedParam, getLearnedParam, getTempBucket } from './learning-utils.ts'

/** Persist PID state to controller_learned_compensation */
async function persistPidState(
  supabase: any,
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
  supabase: any,
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
  isInterpolated?: boolean,
  coolerMarginContext?: { coolerTemp: number; learnedMargin: number } | null,
  modeJustSwitched?: boolean,
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
    getLearnedParam(supabase, controllerId, `steady_state_duty:${mode}:${ssBucket}`, 0),
  ])

  // Migration fallback: if no mode-specific floor exists, check legacy mode-agnostic key
  let ssParamResolved = ssParam
  if (ssParam.sampleCount === 0) {
    const legacyParam = await getLearnedParam(supabase, controllerId, `steady_state_duty:${ssBucket}`, 0)
    if (legacyParam.sampleCount >= 5 && mode === 'cooling') {
      // Only inherit legacy floor for cooling (it was always cooling before)
      ssParamResolved = legacyParam
      console.log(`🔄 ssFloor migration ${controllerName}: using legacy steady_state_duty:${ssBucket} = ${legacyParam.value.toFixed(3)} (${legacyParam.sampleCount} samples)`)
    }
  }

  const learnedBaseline = learnedRow ? parseFloat(String(learnedRow.learned_pi_correction)) : 0
  const convergenceCount = learnedRow?.convergence_count ?? 0
  const persistedIntegral = learnedRow ? parseFloat(String(learnedRow.accumulated_integral)) : 0
  const prevAvgError = learnedRow ? parseFloat(String(learnedRow.latest_avg_error ?? '0')) : 0

  if (isStaleData) {
    console.log(`⏸️ Stale data ${controllerName} [${mode}]: hoppar över I-ackumulering`)
    constraints.push('stale')
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

  // ── Soft-start after mode switch when near target ──
  // When the system just flipped mode (e.g. heating → cooling) and we're
  // already close to the setpoint, don't blast full P+I from the inherited
  // floor. Instead reset the integral and cap actuation so the new mode's
  // effect can be observed before more energy is committed. If we're far
  // from target the regular path runs (need to actually act).
  const SOFT_START_NEAR_TARGET = 0.5
  const softStartActive = !!modeJustSwitched && Math.abs(avgError) < SOFT_START_NEAR_TARGET
  if (softStartActive) {
    integral = 0
    constraints.push('mode-switch-softstart')
    console.log(`🌱 ${controllerName}: mode-switch soft-start (err=${avgError.toFixed(2)}°) — I→0, capping duty for observation`)
  }

  // ── Steady-state duty floor ──────────────────────────────
  const ssFloorRaw = ssParamResolved.sampleCount >= 5 ? ssParamResolved.value : 0
  const ssFloorSamples = ssParamResolved.sampleCount

  // ── Margin-aware floor scaling (cooling only) ──
  // Scale the ssFloor target based on current cooler margin vs learned reference.
  // Higher margin = more cooling power per duty-% → need less duty → scale floor down.
  // Lower margin = less cooling power → need more duty → scale floor up.
  let deadbandGainScale = 1.0
  if (isCooling && coolerMarginContext && coolerMarginContext.learnedMargin > 0) {
    const actualMargin = actualTemp - coolerMarginContext.coolerTemp
    if (actualMargin > 0.5) {
      // Only scale UP (tighter margin = less cooling power per duty-%).
      // Never scale DOWN — ssFloor is already learned at real conditions,
      // so reducing it when the cooler is colder would double-count.
      deadbandGainScale = Math.max(1.0, Math.min(2.0, coolerMarginContext.learnedMargin / actualMargin))
    }
  }
  const ssFloor = ssFloorRaw > 0 ? ssFloorRaw * deadbandGainScale : 0

  if (Math.abs(avgError) <= 0.10) {
    // DEADBAND — single-sided behaviour:
    //   • If we're on the "past-target" side (need < 0), COAST (duty 0)
    //     and let thermal inertia recover naturally instead of holding a
    //     counter-floor that fights the overshoot.
    //   • If we're still on the "needs-action" side (need >= 0), converge
    //     toward ssFloor as before so the mode keeps holding without slip.
    if (need < -0.02) {
      // Coast: bleed integral down quickly, output 0%
      integral *= 0.70
      dutyCycle = 0
      constraints.push('deadband-coast')
      console.log(`🌬️ ${modeLabel} deadband-coast ${controllerName}: err=${avgError.toFixed(2)}° (past target), I→${integral.toFixed(3)}, duty=0% (single-sided hold)`)
    } else if (ssFloor > 0) {
      if (integral > ssFloor) {
        // Above floor: blend down at 10% per cycle
        integral = integral * 0.90 + ssFloor * 0.10
      } else {
        // Below floor (e.g. recovering from overshoot): recover gently by default,
        // but catch up faster if temp is drifting warmer inside deadband.
        const warmingTowardTarget = isCooling && avgError < prevAvgError - 0.01
        const nearWarmEdge = isCooling && avgError <= 0.03
        let recoveryAlpha = 0.05

        if (warmingTowardTarget) {
          recoveryAlpha = nearWarmEdge ? 1.0 : 0.25
          constraints.push(nearWarmEdge ? 'deadband-floor-catchup' : 'deadband-warm-recovery')
        }

        integral = integral * (1 - recoveryAlpha) + ssFloor * recoveryAlpha
        constraints.push('deadband-recovery')
      }
      dutyCycle = Math.max(0, integral)
      if (deadbandGainScale !== 1.0) constraints.push(`margin-scale=${deadbandGainScale.toFixed(2)}`)
      constraints.push('deadband')
      console.log(`✅ ${modeLabel} deadband ${controllerName}: err=${avgError.toFixed(2)}°, I=${integral.toFixed(3)}, floor=${ssFloor.toFixed(3)}${deadbandGainScale !== 1.0 ? ` (raw=${ssFloorRaw.toFixed(3)}×${deadbandGainScale.toFixed(2)})` : ''}, duty=${(dutyCycle * 100).toFixed(0)}%`)
    } else {
      // No ssFloor known — gentle decay to preserve integral while system
      // learns the correct floor. 5% decay/cycle allows floor learning to
      // capture the right value before integral is killed.
      integral *= 0.95
      constraints.push('deadband-no-floor')
      dutyCycle = Math.max(0, integral)
      console.log(`✅ ${modeLabel} deadband-no-floor ${controllerName}: err=${avgError.toFixed(2)}°, I=${integral.toFixed(3)}, duty=${(dutyCycle * 100).toFixed(0)}%`)
    }
  } else if (need < -0.10 && need >= -0.25) {
    // SINGLE-SIDED COAST — past setpoint in mode direction.
    // Stop actuating completely and let thermal inertia + ambient bring
    // temperature back toward target naturally. Active counter-floor here
    // just fights the overshoot and creates oscillation.
    integral *= 0.80
    dutyCycle = 0
    constraints.push('coast-overshoot')
    console.log(`🌬️ ${modeLabel} coast ${controllerName}: err=${avgError.toFixed(2)}°, need=${need.toFixed(2)}°, I→${integral.toFixed(3)}, duty=0% (single-sided hold, passive recovery)`)
  } else if (need < -0.25) {
    // OVER-ACTUATED — aggressive erosion + coast (no actuation)
    const overshoot = Math.abs(need)

    if (ssFloorRaw > 0) {
      const erosionAlpha = Math.min(0.6, 0.3 + overshoot)
      const reducedFloor = Math.max(0, integral * erosionAlpha + ssFloorRaw * (1 - erosionAlpha))
      const quantizedFloor = Math.floor(reducedFloor * 10) / 10
      if (quantizedFloor < ssFloorRaw) {
        await updateLearnedParam(supabase, controllerId, `steady_state_duty:${mode}:${ssBucket}`, quantizedFloor, 0, 1.0, 1.0)
        console.log(`📉 ${modeLabel} floor erosion ${controllerName}: ${ssFloorRaw.toFixed(2)} → ${quantizedFloor.toFixed(2)} (overshoot=${overshoot.toFixed(2)}°)`)
      }
    }

    const decayRate = Math.min(0.85, 0.75 - overshoot * 0.1)
    integral = Math.max(0, integral * decayRate)
    // Force coast — never actuate when significantly past target in mode direction.
    dutyCycle = 0
    constraints.push(isCooling ? 'overcooled' : 'overheated')
    constraints.push('coast-overshoot')
    console.log(`${isCooling ? '❄️' : '🔥'} ${modeLabel} ${isCooling ? 'overcooled' : 'overheated'} (coast) ${controllerName}: err=${avgError.toFixed(2)}°, overshoot=${overshoot.toFixed(2)}°, I→${integral.toFixed(3)}, floor=${ssFloor.toFixed(3)}, duty=0% (passive recovery)`)
  } else if (need > 0.10 && need <= 0.25 && ssFloor > 0) {
    // TARGET HOLD (warm side) — temp drifting away from setpoint but still close.
    // Boost duty above ssFloor to gently pull back without full P+I.
    // Mature floors (≥5 samples) use a softer 110% boost to avoid constant
    // bursting when the learned floor is already close to correct — this prevents
    // 10–20% bursts every cycle when only fine bias correction is needed.
    // Seeding floors (<5 samples) keep the original 130% to converge quickly.
    const matureFloor = ssFloorSamples >= 5
    const holdMultiplier = matureFloor ? 1.10 : 1.30
    const holdTarget = ssFloor * holdMultiplier
    const holdAlpha = isCooling ? 0.15 : 0.30
    integral = integral * (1 - holdAlpha) + holdTarget * holdAlpha
    dutyCycle = Math.min(1.0, Math.max(0, integral))
    if (deadbandGainScale !== 1.0) constraints.push(`margin-scale=${deadbandGainScale.toFixed(2)}`)
    constraints.push('target-hold-warm')
    if (matureFloor) constraints.push('warm-soft')
    console.log(`🔶 ${modeLabel} target-hold-warm ${controllerName}: err=${avgError.toFixed(2)}°, need=${need.toFixed(2)}°, I=${integral.toFixed(3)}, holdTarget=${holdTarget.toFixed(3)} (×${holdMultiplier}), floor=${ssFloor.toFixed(3)}, duty=${(dutyCycle * 100).toFixed(0)}%`)
  } else {
    // NEEDS ACTION — proportional + integral (no margin scaling here — only matters in deadband)

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
      // Heating has more thermal inertia (heater → fluid → fermenter → probe)
      // so we start braking earlier (1.0°C) to allow more deceleration cycles.
      const BRAKE_ZONE = isCooling ? 0.50 : 1.00
      const prevNeed = isCooling ? -prevAvgError : prevAvgError // previous "need" in same sign convention
      const errorDecreasing = need < prevNeed - 0.03 // only brake when error is clearly shrinking
      // CRITICAL: Never brake on interpolated data — only on confirmed sensor readings.
      // Interpolation predicts cooling effect, which creates false "error decreasing"
      // signals that prematurely reduce duty cycle before the hardware has actually
      // moved the temperature.
      if (need < BRAKE_ZONE && errorDecreasing && !isInterpolated) {
        const proximity = Math.max(0, (need - 0.10) / (BRAKE_ZONE - 0.10))
        let blendedI: number
        if (ssFloor > 0) {
          // Blend toward known steady-state floor
          blendedI = integral * proximity + ssFloor * (1 - proximity)
        } else {
          // No ssFloor: apply progressive decay (not blend-to-0 which is too aggressive).
          // At proximity=0 (near deadband): keep 50% of integral
          // At proximity=1 (far from target): keep 100% (no braking yet)
          blendedI = integral * (0.50 + 0.50 * proximity)
        }
        if (blendedI < integral) {
          constraints.push(`brake=${(proximity * 100).toFixed(0)}%`)
          console.log(`🛑 ${modeLabel} braking ${controllerName}: need=${need.toFixed(2)}°, proximity=${proximity.toFixed(2)}, I ${integral.toFixed(3)} → ${blendedI.toFixed(3)} (floor=${ssFloor.toFixed(3)})`)
          integral = blendedI
        }
      } else if (need < BRAKE_ZONE && !errorDecreasing && !isInterpolated) {
        constraints.push('brake-skip')
        console.log(`⏩ ${modeLabel} brake skipped ${controllerName}: error growing (prev=${Math.abs(prevAvgError).toFixed(2)}° → now=${need.toFixed(2)}°), letting I build`)
      } else if (need < BRAKE_ZONE && isInterpolated) {
        constraints.push('brake-interp-skip')
        console.log(`⏩ ${modeLabel} brake skipped (interpolated) ${controllerName}: need=${need.toFixed(2)}° — väntar på bekräftad sensordata`)
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

  // Soft-start cap applies AFTER all branches so deadband/coast still output 0.
  if (softStartActive && dutyCycle > 0.20) {
    const capped = 0.20
    console.log(`🌱 ${modeLabel} soft-start cap ${controllerName}: duty ${(dutyCycle * 100).toFixed(0)}% → ${(capped * 100).toFixed(0)}% (mjukstart efter mode-byte)`)
    dutyCycle = capped
    iCorrection = Math.min(iCorrection, capped)
    integral = Math.min(integral, capped)
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
  supabase: any,
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
  supabase: any,
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
  supabase: any,
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
  supabase: any,
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
