import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { updateLearnedParam, getLearnedParam, getTempBucket } from './learning-utils.ts'

// ============================================================
// SensorAnchor — observer reference point persisted between cycles
// ============================================================
export interface SensorAnchor {
  probeTemp: number
  pillTemp: number
  anchoredAt: string // ISO8601
  mode: 'heating' | 'cooling'
  // Optional smoothing state for IIR filter on controlTemp.
  // Stored on the same JSONB blob to avoid a schema change.
  lastControlTemp?: number
  lastControlTempAt?: string
}

/** Persist PID state to controller_learned_compensation */
async function persistPidState(
  supabase: any,
  controllerId: string, deltaBucket: string, mode: string, stepType: string,
  pCorrection: number, iCorrection: number, avgError: number,
  dutyCycle: number,
  extra?: { learned_pi_correction?: number; convergence_count?: number; last_converged_at?: string; sensor_anchor?: SensorAnchor | null },
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
// PID Control & Thermal Learning (V3: observer + mode-k + asymmetric gains)
//
// SSOT Naming Convention:
//   actualTarget  = user's desired temperature (profile_target_temp)
//   actualTemp    = bottom probe reading (SSOT)
//   pillTempNow   = current floating pill reading (top, fast updates)
//   ctrlTarget    = current hardware target (target_temp before PID)
//   ctrlTargetPid = actualTarget (reference, PID output is duty cycle)
//
// V3 model (computeDutyV3): observer fuses bottom probe (slow, 15-min)
// with floating pill (fast, 1-min) to a bulk-temp estimate every minute.
// Mode-dependent gradient k accounts for cooling-coil-from-below geometry
// (k_cooling > 1, k_heating < 1). Asymmetric gains: aggressive heating
// (no brake), gentle cooling with predictive pill-brake. Stratification
// guards on the leading sensor.
// ============================================================

// ── Observer: extrapolate stale bottom probe using pill movement ──
export function estimateBottomTemp(
  probeTemp: number,
  probeIsFresh: boolean,
  pillTempNow: number | null,
  anchor: SensorAnchor | null,
  k: number,
  mode: 'heating' | 'cooling',
  pillProbeOffset: number | null = null,
): { estimate: number; anchor: SensorAnchor | null; pillDelta: number; offsetBlend?: number } {
  const now = new Date().toISOString()
  // Fresh probe (or no pill / no anchor): re-anchor and use probe directly
  if (probeIsFresh || anchor == null || pillTempNow == null || anchor.mode !== mode) {
    const newAnchor = pillTempNow != null
      ? { probeTemp, pillTemp: pillTempNow, anchoredAt: now, mode }
      : null
    return { estimate: probeTemp, anchor: newAnchor, pillDelta: 0 }
  }
  const pillDelta = pillTempNow - anchor.pillTemp
  const minutesSince = (Date.now() - new Date(anchor.anchoredAt).getTime()) / 60000
  // Cap pill-driven correction: a broken/runaway pill cannot drag us off
  const maxCorr = Math.min(0.10 * Math.max(0, minutesSince), 2.0)
  const bounded = Math.max(-maxCorr, Math.min(maxCorr, k * pillDelta))
  const extrapolated = anchor.probeTemp + bounded

  // ── Offset-anchored fallback: when probe is stale and we have a learned
  //    static pill−probe offset, blend in (pill − offset) as an absolute
  //    estimate. Extrapolation drifts with k×pillDelta from an old anchor;
  //    (pill − offset) is anchored to the *current* pill reading and
  //    cancels known stratification. Weight grows with staleness so fresh-ish
  //    anchors stay dominant and the absolute term takes over as the
  //    extrapolation becomes less trustworthy.
  if (pillProbeOffset == null) {
    return { estimate: extrapolated, anchor, pillDelta }
  }
  const absolute = pillTempNow - pillProbeOffset
  // 0 at 0 min stale → 0.5 at 30+ min stale
  const w = Math.max(0, Math.min(0.5, minutesSince / 60))
  const estimate = (1 - w) * extrapolated + w * absolute
  return { estimate, anchor, pillDelta, offsetBlend: w }
}

/**
 * Calculate PID duty cycle for temperature control.
 * V3: observer-fused bulk temp + asymmetric PI(D) + stratification guards.
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
  pillTempNow?: number | null,
  probeTempRaw?: number | null,
  pillProbeOffset?: number | null,
): Promise<{ ctrlTargetPid: number; dutyCycle?: number; pillRate?: number | null; pCorrection?: number; iCorrection?: number; learnedBaseline?: number; deltaBucket?: string; convergenceCount?: number; constraints?: string[]; persistPromise?: Promise<void> }> {
  const constraints: string[] = []
  const deltaBucket = 'low'
  void ctrlTarget; void isInterpolated // legacy params kept for caller compat

  // ── Parallel fetch: PID state + ssFloor + gradient_k ──
  const ssBucket = getTempBucket(floorLookupTarget ?? actualTarget)
  const phaseSuffix = phaseBucket ? `:${phaseBucket}` : ''
  const phaseKeyedName = `steady_state_duty:${mode}:${ssBucket}${phaseSuffix}`
  const modeKeyedName = `steady_state_duty:${mode}:${ssBucket}`
  const kDefault = mode === 'cooling' ? 1.3 : 0.7
  const [{ data: learnedRow }, phaseParam, modeParam, kParam] = await Promise.all([
    supabase
      .from('controller_learned_compensation')
      .select('learned_pi_correction, convergence_count, accumulated_integral, latest_avg_error, style_key, updated_at, sensor_anchor')
      .eq('controller_id', controllerId)
      .eq('delta_bucket', deltaBucket)
      .eq('mode', mode)
      .eq('step_type', stepType)
      .maybeSingle(),
    phaseBucket
      ? getLearnedParam(supabase, controllerId, phaseKeyedName, 0)
      : Promise.resolve({ value: 0, sampleCount: 0 } as { value: number; sampleCount: number }),
    getLearnedParam(supabase, controllerId, modeKeyedName, 0),
    getLearnedParam(supabase, controllerId, `gradient_k:${mode}`, kDefault),
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
  const prevAnchor: SensorAnchor | null = (() => {
    const raw = learnedRow?.sensor_anchor
    if (!raw || typeof raw !== 'object') return null
    const a = raw as any
    if (typeof a.probeTemp !== 'number' || typeof a.pillTemp !== 'number' || typeof a.anchoredAt !== 'string') return null
    return {
      probeTemp: a.probeTemp,
      pillTemp: a.pillTemp,
      anchoredAt: a.anchoredAt,
      mode: a.mode === 'heating' ? 'heating' : 'cooling',
      lastControlTemp: typeof a.lastControlTemp === 'number' ? a.lastControlTemp : undefined,
      lastControlTempAt: typeof a.lastControlTempAt === 'string' ? a.lastControlTempAt : undefined,
    }
  })()
  const kLearned = kParam.value

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

  // ── V3 observer + asymmetric PI(D) ──
  const v3 = computeDutyV3({
    mode, stepType,
    actualTarget, actualTemp,
    probeTempRaw: probeTempRaw ?? null,
    probeIsFresh: !isStaleData,
    pillTempNow: pillTempNow ?? null,
    pillRate: pillRate ?? null,
    anchor: prevAnchor,
    k: kLearned,
    ssFloor, ssFloorSamples,
    persistedIntegral, prevAvgError,
    modeJustSwitched: !!modeJustSwitched,
    coolingUtilization: coolingUtilization ?? null,
    pillProbeOffset: pillProbeOffset ?? null,
  })
  let dutyCycle = v3.duty
  const integral = v3.integral
  const pCorrection = v3.p
  const nextAnchor = v3.anchor
  for (const c of v3.constraints) constraints.push(c)

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
  console.log(`🎯 ${mode} ${controllerName} [${floorSource}] k=${kLearned.toFixed(2)} bulk=${v3.controlTemp.toFixed(2)}°: err=${avgError.toFixed(2)}°, need=${need.toFixed(2)}°, P=${pCorrection.toFixed(2)}, I=${integral.toFixed(3)}, floor=${ssFloor.toFixed(3)}${deadbandGainScale !== 1.0 ? ` (raw=${ssFloorRaw.toFixed(3)}×${deadbandGainScale.toFixed(2)})` : ''}, duty=${(dutyCycle * 100).toFixed(0)}% [${constraints.join(',')}]`)

  // ── Gradient-k learning: when probe is fresh AND we had an anchor from
  //    the SAME mode, compute realized k from RAW probe/pill deltas (gradient
  //    physics — never from the SSOT, which may be an avg of probe+pill).
  const probeForLearn = probeTempRaw ?? null
  if (!isStaleData && prevAnchor != null && prevAnchor.mode === mode && pillTempNow != null && probeForLearn != null) {
    const probeDelta = probeForLearn - prevAnchor.probeTemp
    const pillDelta = pillTempNow - prevAnchor.pillTemp
    if (Math.abs(pillDelta) >= 0.05) {
      const realized = probeDelta / pillDelta
      if (Number.isFinite(realized) && realized >= 0.2 && realized <= 4.0) {
        // Fire-and-forget; nothing downstream depends on this update.
        updateLearnedParam(supabase, controllerId, `gradient_k:${mode}`, realized, 0.2, 4.0)
          .catch((e) => console.warn(`gradient_k learn failed: ${e}`))
        constraints.push(`gradient-k=${realized.toFixed(2)}`)
      }
    }
  }

  const persistPromise = persistPidState(
    supabase, controllerId, deltaBucket, mode, stepType,
    pCorrection, integral, avgError, dutyCycle,
    { sensor_anchor: nextAnchor },
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
// V3: Observer + asymmetric PI(D) — pure function, no DB access
// ============================================================
export function computeDutyV3(input: {
  mode: 'heating' | 'cooling'
  stepType: string
  actualTarget: number
  actualTemp: number          // SSOT (avg/probe/pill per controller config) — PID error source
  probeTempRaw: number | null // RAW bottom probe — observer + bottom-guard + k-learning
  probeIsFresh: boolean
  pillTempNow: number | null  // floating pill (top), null if not linked
  pillRate: number | null
  anchor: SensorAnchor | null
  k: number                   // mode-keyed gradient (cooling>1, heating<1)
  ssFloor: number
  ssFloorSamples: number
  persistedIntegral: number
  prevAvgError: number
  modeJustSwitched: boolean
  coolingUtilization: number | null
  pillProbeOffset?: number | null
}): { duty: number; integral: number; p: number; anchor: SensorAnchor | null; controlTemp: number; constraints: string[] } {
  const constraints: string[] = []
  const isCooling = input.mode === 'cooling'
  const isHold = input.stepType === 'hold'

  // ── Observer: fresh bulk estimate every cycle ──
  // Always uses RAW probe (bottom) — observer models physical stratification,
  // not user-facing SSOT. If no raw probe is available, fall back to actualTemp.
  const probeForObs = input.probeTempRaw ?? input.actualTemp
  const obs = estimateBottomTemp(
    probeForObs, input.probeIsFresh, input.pillTempNow,
    input.anchor, input.k, input.mode, input.pillProbeOffset ?? null,
  )
  const bottomEst = obs.estimate
  if (obs.offsetBlend != null && obs.offsetBlend > 0) {
    constraints.push(`offset-blend=${obs.offsetBlend.toFixed(2)}`)
  }
  // Regulate against the fresh bulk average: observer-corrected probe + live
  // pill, same definition as UI but at 1-minute resolution. When the probe is
  // fresh bottomEst equals probe, so UI and regulator coincide at samples.
  const controlTempRaw = input.pillTempNow != null
    ? 0.5 * bottomEst + 0.5 * input.pillTempNow
    : bottomEst

  // ── 3-min IIR on controlTemp: dampens sub-cycle pill noise (BLE jitter,
  //    wave motion) without adding visible lag. Bypassed on mode-flip so
  //    fresh response isn't held back, and on stale state (>5 min gap).
  const SMOOTH_ALPHA = 0.4
  const prevCT = input.anchor?.lastControlTemp
  const prevCTAt = input.anchor?.lastControlTempAt
  const prevCTAgeMin = prevCTAt
    ? (Date.now() - new Date(prevCTAt).getTime()) / 60000
    : Infinity
  const canSmooth = !input.modeJustSwitched
    && prevCT != null
    && Number.isFinite(prevCT)
    && prevCTAgeMin < 5
  const controlTemp = canSmooth
    ? (1 - SMOOTH_ALPHA) * (prevCT as number) + SMOOTH_ALPHA * controlTempRaw
    : controlTempRaw
  if (canSmooth) constraints.push('iir-smooth')
  const avgError = input.actualTarget - controlTemp
  const need = isCooling ? -avgError : avgError

  // approachRate > 0 = pill rör sig mot target i mode-riktning
  const approachRate = input.pillRate == null ? 0 : (isCooling ? -input.pillRate : input.pillRate)

  // ── Asymmetric gains: cooling = gentle+braked, heating ≈ bang-bang ──
  const Kp = isCooling
    ? (isHold ? 0.30 : 0.55)
    : (isHold ? 0.45 : 0.80)
  const KiPerHour = isCooling
    ? (isHold ? 0.9 : 3.6)
    : (isHold ? 1.2 : 4.5)
  const Kd = isCooling ? (isHold ? 0.25 : 0.35) : 0   // heating: ingen broms
  const Imax = isCooling
    ? (isHold ? 0.35 : 0.65)
    : (isHold ? 0.40 : 0.70)

  // ── Integral state: mode-flip soft-decay or hard reset ──
  let integral = input.persistedIntegral
  if (!Number.isFinite(integral) || Math.abs(integral) > 1.0) integral = 0
  if (input.modeJustSwitched) {
    if (Math.abs(need) > 0.5) {
      integral = 0
      constraints.push('mass-coast')
    } else {
      integral *= 0.5
      constraints.push('mode-soft-decay')
    }
  }
  integral = Math.max(0, Math.min(Imax, integral))

  // ── P-term: observer ger färsk data varje cykel, ingen stale-dämpning ──
  const uP = Kp * need

  // ── D-term: predictive brake — cooling only (heating för svag att överskjuta) ──
  let uD = 0
  if (isCooling && approachRate > 0 && need > 0) {
    // tauLag ≈ 6 min transport-tid från spiral till probe (60L mass)
    const tauLagHours = 0.10
    const overshoot = approachRate * tauLagHours - need
    if (overshoot > 0) {
      uD = -Math.min(0.5, Kd * overshoot)
      constraints.push('predictive-brake')
    }
  }

  // ── Integration: every minute, dt = 1/60 h, with windup zone guard ──
  let nextI = integral
  const IZONE = isCooling ? 0.4 : 0.6
  if (Math.abs(need) <= IZONE && !input.modeJustSwitched) {
    nextI += KiPerHour * need / 60
    constraints.push('i-zone')
  }
  // Mark steady-state for ssFloor learning gate (near-target hold)
  if (Math.abs(need) <= 0.30 && !input.modeJustSwitched) constraints.push('steady-state')
  // Snabb urladdning vid överskott (skydd mot 60L undershoot)
  if (need < -0.01) {
    nextI *= 0.85
    constraints.push('overshoot-bleed')
  }
  nextI = Math.max(0, Math.min(Imax, nextI))

  // ── Sammanställ duty ──
  const uFf = (input.ssFloor > 0 && input.ssFloorSamples >= 5) ? input.ssFloor : 0
  const raw = uFf + uP + nextI + uD
  let duty = Math.max(0, Math.min(1, raw))

  // ── Stratifierings-guard: ledande sensor får inte rusa förbi target ──
  // Kyla: botten leder (kall vätska sjunker). Om bottenEst redan ligger under
  // target har spiralen redan levererat kyla som ännu inte hunnit blandas in i
  // bulken — att skicka mer duty bara fördjupar det kalla skiktet. Vi släpper
  // därför I-termen och låter endast P + ssFloor jobba; integralen bleed:as
  // hårt så ackumulerad drift inte överlever undershoot-perioden. Djupare
  // undershoot (≥0.5°) → full stop.
  if (isCooling && bottomEst < input.actualTarget - 0.3) {
    const cap = Math.max(0, uP + uFf)
    duty = Math.min(duty, cap)
    nextI = Math.max(0, nextI * 0.5)
    constraints.push('bottom-undershoot-guard')
  }
  if (isCooling && bottomEst < input.actualTarget - 0.5) {
    duty = 0
    nextI = Math.max(0, nextI * 0.5)
    constraints.push('bottom-undershoot-stop')
  }
  if (!isCooling && input.pillTempNow != null && input.pillTempNow > input.actualTarget + 0.3) {
    duty = Math.min(duty, 0.2)
    constraints.push('top-overshoot-guard')
  }

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

  // ── Hold-deadband: när tanken faktiskt är på mål (|error| < 0.10°C) och
  //    pillen inte rör sig (|rate| < 0.05°/h) → klampa duty till 0 och frys
  //    integralen. Eliminerar onödiga mikropulser (0/1/3/5/7%) runt setpoint.
  const HOLD_DEADBAND = 0.10
  const HOLD_RATE_LIMIT = 0.05
  if (
    isHold
    && !input.modeJustSwitched
    && Math.abs(avgError) < HOLD_DEADBAND
    && Math.abs(input.pillRate ?? 0) < HOLD_RATE_LIMIT
  ) {
    duty = 0
    nextI = integral // freeze, no accumulation this cycle
    constraints.push('hold-deadband')
  }

  // ── Persistera smoothing-state på anchor (JSONB, ingen schema-ändring) ──
  const nextAnchor = obs.anchor
    ? { ...obs.anchor, lastControlTemp: controlTemp, lastControlTempAt: new Date().toISOString() }
    : obs.anchor

  return { duty, integral: nextI, p: uP, anchor: nextAnchor, controlTemp, constraints }
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
