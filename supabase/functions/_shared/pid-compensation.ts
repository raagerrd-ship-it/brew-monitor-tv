import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { updateLearnedParam, getLearnedParam, getTempBucket } from './learning-utils.ts'

/** Persist PID state to controller_learned_compensation */
async function persistPidState(
  supabase: ReturnType<typeof createClient>,
  controllerId: string, deltaBucket: string, mode: string, stepType: string,
  pCorrection: number, iCorrection: number, avgError: number,
  extra?: { learned_pi_correction?: number; convergence_count?: number; last_converged_at?: string },
): Promise<void> {
  await supabase.from('controller_learned_compensation').upsert({
    controller_id: controllerId, delta_bucket: deltaBucket, mode, step_type: stepType,
    latest_p_correction: pCorrection, latest_i_correction: iCorrection,
    latest_d_damping: 1.0, // D-term removed — always 1.0
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

/** @deprecated PillCompensationSettings is vestigial — PI regulator uses hardcoded gains.
 *  Kept as empty type alias for backward compatibility. */
export interface PillCompensationSettings {
  enabled: boolean
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
 * Calculate PID duty cycle for temperature control.
 *
 * PID error = actualTarget - actualTemp (same domain user sees).
 * Output is a duty cycle (0–1), not a temperature offset.
 *
 * @param actualTarget   User's desired temperature (profile_target_temp)
 * @param _unused        Kept for signature compat (was profileTarget)
 * @param ctrlTarget     The current hardware target (target_temp before PID)
 * @param actualTemp     Pre-computed fused sensor reading (avg or probe-only)
 */
export async function calculateCompensatedTarget(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
  actualTarget: number,
  _unused: number,
  ctrlTarget: number,
  controllerName: string,
  settings: PillCompensationSettings,
  mode: 'heating' | 'cooling' = 'cooling',
  stepType: string = 'unknown',
  actualTemp?: number,
  _probeTemp?: number,
  coolingUtilization?: number | null,
  rampContext?: { requiredRatePerHour: number; tempBucket: string; loadBucket: string } | null,
  skipRateLimit?: boolean,
  skipLearning?: boolean,
): Promise<{ ctrlTargetPid: number; dutyCycle?: number; compensation: number; avgDelta: number; dampingFactor?: number; pillRate?: number | null; probeRate?: number | null; etaMinutes?: number | null; errorCorrection?: number; pCorrection?: number; iCorrection?: number; learnedBaseline?: number; deltaBucket?: string; convergenceCount?: number; constraints?: string[] }> {
  const constraints: string[] = []
  const avgDelta = 0
  const compensation = 0

  // Fetch recent delta history for stale-data detection and pill rate
  const { data: deltaHistory } = await supabase
    .from('temp_delta_history')
    .select('delta, pill_temp, controller_temp, recorded_at')
    .eq('controller_id', controllerId)
    .order('recorded_at', { ascending: false })
    .limit(8)

  if (!deltaHistory || deltaHistory.length === 0) {
    if (actualTemp == null) {
      console.log(`⚠️ PID ${controllerName}: ingen deltahistorik och inga sensorvärden — returnerar actualTarget`)
      return { ctrlTargetPid: actualTarget, compensation: 0, avgDelta: 0 }
    }
  }

  // === Pill rate (used for ramp boost) ===
  let _pillRate: number | null = null
  let _probeRate: number | null = null

  if (deltaHistory && deltaHistory.length >= 3) {
    const newest = deltaHistory[0]
    const oldest = deltaHistory[deltaHistory.length - 1]
    const timeDiffMs = new Date(newest.recorded_at).getTime() - new Date(oldest.recorded_at).getTime()
    const timeDiffHours = timeDiffMs / (1000 * 60 * 60)

    if (timeDiffHours > 0.05) {
      _pillRate = (parseFloat(String(newest.pill_temp)) - parseFloat(String(oldest.pill_temp))) / timeDiffHours
      _probeRate = (parseFloat(String(newest.controller_temp)) - parseFloat(String(oldest.controller_temp))) / timeDiffHours
    }
  }

  // Learn thermal rate (side-effect: updates fermentation_learnings for interpolation)
  await learnThermalRate(supabase, controllerId, mode, skipLearning)

  // === Adaptive PI-term ===
  const deltaBucket = 'low'

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

  // Style-key fallback removed — integral converges in 2-3 cycles

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

  // Error: actualTarget - actualTemp (same domain as user sees)
  const currentTempForError = actualTemp ?? (deltaHistory?.[0]
    ? parseFloat(String(deltaHistory[0].controller_temp))
    : actualTarget)
  const avgError = actualTarget - currentTempForError

  let pCorrection = 0
  let iCorrection = 0

  // === Utilization-based saturation ===
  // If cooling circuit is running >90% of the time, the hardware is maxed out.
  // No point pushing the target further — it would only accumulate integral error.
  let isSaturated = false
  if (coolingUtilization != null && coolingUtilization >= 0.90 && mode === 'cooling') {
    isSaturated = true
    console.log(`⚡ Util saturation ${controllerName}: cooling util ${Math.round(coolingUtilization * 100)}% ≥ 90% — hardware maxed`)
    constraints.push(`util-sat=${Math.round(coolingUtilization * 100)}%`)
  }

  // ═══════════════════════════════════════════════════════
  // UNIFIED DUTY CYCLE MODEL (cooling & heating)
  // PID output = duty cycle (0.0–1.0).
  // Hardware is controlled via PWM bursts:
  //   Cooling: -5°C = relay ON, suppress = probe+2°C
  //   Heating: 40°C = relay ON, suppress = probe-2°C
  // Burst length = duty × 300s (5-min cycle).
  // The integral accumulates the steady-state duty needed at equilibrium.
  // ═══════════════════════════════════════════════════════
  const isCooling = mode === 'cooling'
  const need = isCooling ? -avgError : avgError // positive when action is needed
  const DUTY_P = 0.5
  const DUTY_I = 0.10
  const DUTY_DECAY = 0.98
  const DUTY_IMAX = 0.95
  const modeLabel = isCooling ? 'Duty' : 'Heating duty'

  // Migration: old integral was in °C (typically 0–2). New model uses duty (0–1).
  let integral = persistedIntegral
  if (isCooling && integral > 1.0) {
    const cBucket = getTempBucket(actualTarget)
    const seed = await getLearnedParam(supabase, controllerId, `steady_state_duty:${cBucket}`, 0)
    integral = seed.sampleCount >= 3 ? seed.value : 0
    console.log(`🔄 Duty migration ${controllerName}: integral ${persistedIntegral.toFixed(2)}°C → ${integral.toFixed(2)} duty`)
  } else if (!isCooling && Math.abs(integral) > 1.0) {
    integral = 0
    console.log(`🔄 Heating duty migration ${controllerName}: integral ${persistedIntegral.toFixed(2)}°C → 0 duty`)
  }

  let dutyCycle = 0

  if (Math.abs(avgError) <= 0.05) {
    // DEADBAND: gentle decay (0.90/cycle) to prevent residual PWM bursts
    integral *= 0.90
    dutyCycle = Math.max(0, integral)
    constraints.push('deadband')
    console.log(`✅ ${modeLabel} deadband ${controllerName}: err=${avgError.toFixed(2)}°, I=${integral.toFixed(3)}, duty=${(dutyCycle * 100).toFixed(0)}%`)
  } else if (need < -0.05) {
    // OVER-ACTUATED: stop, fast-decay integral
    integral *= 0.85
    dutyCycle = 0
    constraints.push(isCooling ? 'overcooled' : 'overheated')
    console.log(`${isCooling ? '❄️' : '🔥'} ${modeLabel} ${isCooling ? 'overcooled' : 'overheated'} ${controllerName}: err=${avgError.toFixed(2)}°, I→${integral.toFixed(3)}, duty=0%`)
  } else {
    // NEEDS ACTION — proportional + integral
    //
    // CRITICAL: RAPT telemetry arrives ~every 15 minutes, but PID runs every 5 min.
    // Without stale-data awareness, P-term fires 3× on the same reading, stacking
    // PWM bursts and causing oscillation.
    // Fix: When data is stale, zero the P-term and let only the integral (learned
    // steady-state duty) drive the output. P reacts only to NEW measurements.
    if (isStaleData) {
      pCorrection = 0
      console.log(`⏸️ ${modeLabel} stale ${controllerName}: P=0 (no new data), holding I=${integral.toFixed(3)}`)
    } else {
      pCorrection = need * DUTY_P
      integral = integral * DUTY_DECAY + need * DUTY_I
      integral = Math.max(0, Math.min(DUTY_IMAX, integral))

      // ── Settling guard (cooling only) ──────────────────────────
      // When integral is near-zero AND there's meaningful need,
      // cap the P-term to prevent aggressive first bursts.
      // RAPT telemetry arrives every 15 min — without this cap, the first
      // burst overshoots because there's no feedback yet on cooling effect.
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

    // Saturation guard: don't push duty past integral + 10% when hardware is maxed
    if (isSaturated && raw > integral + 0.1) {
      raw = integral + 0.1
      constraints.push('duty-sat')
    }

    // Full action at large error (> 2°C)
    if (need > 2.0) {
      raw = Math.max(raw, 1.0)
      constraints.push(isCooling ? 'full-cooling' : 'full-heating')
    }

    // Ramp rate boost: if cooling too slowly for the required ramp
    if (isCooling && rampContext && !isSaturated && _pillRate !== null) {
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
    console.log(`🎯 ${modeLabel} ${controllerName}: need=${need.toFixed(2)}°, P=${pCorrection.toFixed(2)}, I=${integral.toFixed(3)}, duty=${(dutyCycle * 100).toFixed(0)}%${isSaturated ? ' [SAT]' : ''}`)
  }

  await persistPidState(supabase, controllerId, deltaBucket, mode, stepType,
    pCorrection, integral, avgError)

  return {
    ctrlTargetPid: Math.round(actualTarget * 10) / 10, dutyCycle,
    compensation, avgDelta, dampingFactor: 1.0,
    pillRate: _pillRate, probeRate: _probeRate, etaMinutes: null,
    errorCorrection: 0, pCorrection, iCorrection: integral,
    learnedBaseline, deltaBucket, convergenceCount, constraints,
  }
}

// ============================================================
// Thermal Rate Learning
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
    .select('pill_compensation_rate_limit, pill_compensation_emergency_threshold, pill_compensation_min_scale, pill_compensation_max_compensation, pill_compensation_damping')
    .limit(1)
    .maybeSingle()

  return {
    enabled: true, // Now per-controller (dual_sensor_enabled), kept true for backward compat
    rateLimit: parseFloat(String((acSettings as any)?.pill_compensation_rate_limit ?? 0.8)),
    emergencyThreshold: parseFloat(String((acSettings as any)?.pill_compensation_emergency_threshold ?? 3.0)),
    minScale: parseFloat(String((acSettings as any)?.pill_compensation_min_scale ?? 0.15)),
    maxCompensation: parseFloat(String((acSettings as any)?.pill_compensation_max_compensation ?? 5.0)),
    anticipationWindowHours: parseFloat(String((acSettings as any)?.pill_compensation_damping ?? 1.0)),
  }
}
