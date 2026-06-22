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

// ============================================================
// PID Control & Thermal Learning (V2: PI + rate-feedforward)
//
// SSOT Naming Convention:
//   actualTarget  = user's desired temperature (profile_target_temp)
//   actualTemp    = fused sensor reading (avg or probe-only)
//   ctrlTarget    = current hardware target (target_temp before PID)
//   ctrlTargetPid = actualTarget (reference, PID output is duty cycle)
//
// V2 model (computeDutyV2): single PI loop around ssFloor with a quadratic
// pill-rate brake (D-term) and pill-fused realtime estimate when bottom
// probe is stale. Tuned for 60L thermal mass + 1-min loop + 15-min probe.
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
  rampContext?: { requiredRatePerHour: number; tempBucket: string; loadBucket: string;
                  learnedHoldI?: number; etaMin?: number; endTarget?: number } | null,
  pillRate?: number | null,
  isInterpolated?: boolean,
  coolerMarginContext?: { coolerTemp: number; learnedMargin: number } | null,
  modeJustSwitched?: boolean,
  phaseBucket?: 'active' | 'tail' | 'clean' | null,
  floorLookupTarget?: number | null,
): Promise<{ ctrlTargetPid: number; dutyCycle?: number; pillRate?: number | null; pCorrection?: number; iCorrection?: number; learnedBaseline?: number; deltaBucket?: string; convergenceCount?: number; constraints?: string[]; persistPromise?: Promise<void> }> {
  const constraints: string[] = []
  const deltaBucket = 'low'
  void ctrlTarget; void isInterpolated // legacy params kept for caller compat

  // ── Parallel fetch: PID state + ssFloor (phase / mode / legacy chain) ──
  const ssBucket = getTempBucket(floorLookupTarget ?? actualTarget)
  const phaseSuffix = phaseBucket ? `:${phaseBucket}` : ''
  const phaseKeyedName = `steady_state_duty:${mode}:${ssBucket}${phaseSuffix}`
  const modeKeyedName = `steady_state_duty:${mode}:${ssBucket}`
  const [{ data: learnedRow }, phaseParam, modeParam] = await Promise.all([
    supabase
      .from('controller_learned_compensation')
      .select('learned_pi_correction, convergence_count, accumulated_integral, latest_avg_error, style_key, updated_at')
      .eq('controller_id', controllerId)
      .eq('delta_bucket', deltaBucket)
      .eq('mode', mode)
      .eq('step_type', stepType)
      .maybeSingle(),
    phaseBucket
      ? getLearnedParam(supabase, controllerId, phaseKeyedName, 0)
      : Promise.resolve({ value: 0, sampleCount: 0 } as { value: number; sampleCount: number }),
    getLearnedParam(supabase, controllerId, modeKeyedName, 0),
  ])

  // Floor resolution: phase → mode → legacy (cooling only) → mode-seed
  let ssParamResolved: { value: number; sampleCount: number } = modeParam
  let floorSource = 'mode'
  if (phaseBucket && phaseParam.sampleCount >= 3) {
    ssParamResolved = phaseParam
    floorSource = `phase:${phaseBucket}`
  }
  if (ssParamResolved.sampleCount === 0 && mode === 'cooling') {
    const legacyParam = await getLearnedParam(supabase, controllerId, `steady_state_duty:${ssBucket}`, 0)
    if (legacyParam.sampleCount >= 5) {
      ssParamResolved = legacyParam
      floorSource = 'legacy'
    }
  }
  if (phaseBucket && phaseParam.sampleCount < 3 && modeParam.sampleCount >= 5) {
    ssParamResolved = modeParam
    floorSource = `mode-seed→${phaseBucket}`
  }

  const ssFloorRaw = ssParamResolved.sampleCount >= 5 ? ssParamResolved.value : 0
  const ssFloorSamples = ssParamResolved.sampleCount
  const learnedBaseline = learnedRow ? parseFloat(String(learnedRow.learned_pi_correction)) : 0
  const convergenceCount = learnedRow?.convergence_count ?? 0
  let persistedIntegral = learnedRow ? parseFloat(String(learnedRow.accumulated_integral)) : 0
  const prevAvgError = learnedRow ? parseFloat(String(learnedRow.latest_avg_error ?? '0')) : 0
  // One-time clamp: legacy °C-domain integrals (>1.0) reset to 0
  if (!Number.isFinite(persistedIntegral) || Math.abs(persistedIntegral) > 1.0) persistedIntegral = 0

  // ── Margin-aware floor scaling (cooling only) ──
  // Större faktisk marginal (kallare glykol) → skala NED. Mindre marginal → skala UPP.
  // Asymmetriskt fönster 0.6×–1.8×. Rör inte ssFloorRaw i DB — endast utskickad duty.
  let deadbandGainScale = 1.0
  if (mode === 'cooling' && coolerMarginContext && coolerMarginContext.learnedMargin > 0) {
    const actualMargin = actualTemp - coolerMarginContext.coolerTemp
    if (actualMargin > 0.5) {
      deadbandGainScale = Math.max(0.6, Math.min(1.8, coolerMarginContext.learnedMargin / actualMargin))
    }
  }
  const ssFloor = ssFloorRaw > 0 ? ssFloorRaw * deadbandGainScale : 0
  if (deadbandGainScale !== 1.0) constraints.push(`margin-scale=${deadbandGainScale.toFixed(2)}`)
  if (isStaleData) constraints.push('stale')

  // ── V2 PI-core + rate-feedforward ──
  const v2 = computeDutyV2({
    mode, stepType,
    actualTarget, actualTemp,
    pillRate: pillRate ?? null,
    ssFloor, ssFloorSamples,
    persistedIntegral, prevAvgError,
    modeJustSwitched: !!modeJustSwitched,
    isStaleData,
    coolingUtilization: coolingUtilization ?? null,
  })
  let dutyCycle = v2.duty
  const integral = v2.integral
  const pCorrection = v2.p
  for (const c of v2.constraints) constraints.push(c)

  // ── Ramp boost (cooling): top up duty when observed rate lags required ──
  if (mode === 'cooling' && rampContext && pillRate != null && (coolingUtilization == null || coolingUtilization < 0.90)) {
    const observedRate = Math.abs(pillRate)
    const rateDeficit = rampContext.requiredRatePerHour - observedRate
    if (rateDeficit > 0.1) {
      const rampBoost = Math.min(rateDeficit * 0.2, 0.3)
      dutyCycle = Math.min(1.0, dutyCycle + rampBoost)
      constraints.push(`ramp-boost=${rampBoost.toFixed(2)}`)
      console.log(`🚀 ramp-boost ${controllerName}: req=${rampContext.requiredRatePerHour.toFixed(2)}°/h, obs=${observedRate.toFixed(2)}°/h → +${(rampBoost * 100).toFixed(0)}%`)
    }
  }

  const avgError = actualTarget - actualTemp
  const need = mode === 'cooling' ? -avgError : avgError
  console.log(`🎯 ${mode} ${controllerName} [${floorSource}]: err=${avgError.toFixed(2)}°, need=${need.toFixed(2)}°, P=${pCorrection.toFixed(2)}, I=${integral.toFixed(3)}, floor=${ssFloor.toFixed(3)}${deadbandGainScale !== 1.0 ? ` (raw=${ssFloorRaw.toFixed(3)}×${deadbandGainScale.toFixed(2)})` : ''}, duty=${(dutyCycle * 100).toFixed(0)}% [${constraints.join(',')}]`)

  const persistPromise = persistPidState(
    supabase, controllerId, deltaBucket, mode, stepType,
    pCorrection, integral, avgError, dutyCycle,
  )

  return {
    ctrlTargetPid: Math.round(actualTarget * 10) / 10,
    dutyCycle,
    pillRate: pillRate ?? null,
    pCorrection,
    iCorrection: integral,
    learnedBaseline,
    deltaBucket,
    convergenceCount,
    constraints,
    persistPromise,
  }
}

// ============================================================
// V2: Simplified PI-core + rate-feedforward (SHADOW MODE)
// ============================================================
//
// Replaces the 15+ branches of v1 with: feedforward (ssFloor) + Kp*need
// + clamped integral + Kd*pillRate brake. One anti-windup rule. Three
// modifiers (mode-flip seed, util-sat cap, large-error full-on).
//
// Pure function: no DB reads/writes. Called by v1 with already-resolved
// state so we can compare outputs side-by-side without doubling DB load.
//
export function computeDutyV2(input: {
  mode: 'heating' | 'cooling'
  stepType: string
  actualTarget: number
  actualTemp: number
  pillRate: number | null
  ssFloor: number
  ssFloorSamples: number
  persistedIntegral: number
  prevAvgError: number
  modeJustSwitched: boolean
  isStaleData: boolean
  coolingUtilization: number | null
}): { duty: number; integral: number; p: number; constraints: string[] } {
  const constraints: string[] = []
  const isCooling = input.mode === 'cooling'
  const isHold = input.stepType === 'hold'
  const baseAvgError = input.actualTarget - input.actualTemp
  let need = isCooling ? -baseAvgError : baseAvgError

  // approachRate > 0 = pill rör sig mot target i mode-riktning (1-min upplösning)
  const approachRate = input.pillRate == null ? 0 : (isCooling ? -input.pillRate : input.pillRate)

  // ── Fused sensor: när bottenproben är stale (15-min lucka) använd pill för att
  // virtuellt uppdatera 'need' baserat på rörelsen sedan förra cykeln (~1 min) ──
  if (input.isStaleData && input.pillRate != null) {
    const CYCLE_TIME_HOURS = 1 / 60
    need -= approachRate * CYCLE_TIME_HOURS
    constraints.push('pill-fused-estimate')
  }

  // ── Gains: 60L mass + 1-min loop, Pill ger ren derivata ──
  const Kp   = isHold ? 0.30 : 0.55
  const Ki   = isHold ? 0.015 : 0.06
  const Kd   = isHold ? 0.25 : 0.35
  const Imax = isHold ? 0.35 : 0.65

  // ── Integral init ──
  let integral = input.persistedIntegral
  if (!Number.isFinite(integral) || Math.abs(integral) > 1.0) integral = 0
  // Mode-flip: coast en cykel — 60L tank har restenergi i mantel/probe,
  // hoppa inte direkt till ssFloor (krockar med restvärme/kyla).
  if (input.modeJustSwitched) {
    integral = 0
    constraints.push('mass-coast')
  }
  integral = Math.max(0, Math.min(Imax, integral))

  // ── P-term med stale-dämpning (undvik dubbel-stöt under 15-min tystnad) ──
  const pScale = input.isStaleData ? 0.40 : 1.00
  if (input.isStaleData) constraints.push('p-scaled-40pct')
  const uP = Kp * need * pScale

  // ── D-term: kvadratisk pill-broms (matas av 1-min realtidsdata) ──
  let uD = 0
  if (approachRate > 0 && need > 0) {
    uD = Math.max(-0.40, -Kd * (approachRate * approachRate))
    constraints.push('realtime-brake')
  }

  // ── Integration: bara nära target OCH med färsk data ──
  let nextI = integral
  const INTEGRATION_ZONE = 0.30
  if (!input.isStaleData && Math.abs(need) <= INTEGRATION_ZONE) {
    nextI += Ki * need
    constraints.push('i-zone')
  }
  // Snabb urladdning vid överskott (skydd mot 60L undershoot)
  if (need < -0.01) {
    nextI *= 0.85
    constraints.push('overshoot-bleed')
  }
  nextI = Math.max(0, Math.min(Imax, nextI))

  // ── Sammanställ duty ──
  const uFf = (input.ssFloor > 0 && input.ssFloorSamples >= 3) ? input.ssFloor : 0
  const raw = uFf + uP + nextI + uD
  let duty = Math.max(0, Math.min(1, raw))

  // ── Util saturation: kapa till nextI+0.1 (mer än så är meningslöst när hw är maxad) ──
  const isSaturated = isCooling && input.coolingUtilization != null && input.coolingUtilization >= 0.90
  if (isSaturated) {
    duty = Math.min(duty, nextI + 0.1)
    constraints.push('util-sat-cap')
  }

  // ── Past-target coast: stäng ner när vi passerat (i hold: håll 15% av ssFloor som mjuk catch) ──
  if (need <= 0) {
    duty = (isHold && uFf > 0) ? uFf * 0.15 : 0
    constraints.push('past-target-coast')
  }

  // ── Panik: > 2°C error → full action ──
  if (need > 2.0) {
    duty = 1.0
    constraints.push('full-action')
  }

  return { duty, integral: nextI, p: uP, constraints }
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
