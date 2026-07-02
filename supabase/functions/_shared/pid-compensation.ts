import { getTempBucket, updateLearnedParam } from './learning-utils.ts'

// ============================================================
// PID Control & Thermal Learning (V5: SSOT-only)
//
// Designprinciper (dödtidsdominerad process: ~15 min probe-latens, 60L massa):
//   • PID känner BARA actualTemp (SSOT) + dess ålder. Pill/probe blandas
//     uppströms enligt controller-config (dual/pill/probe).
//   • Långsam PI på SSOT. D-on-measurement bromsar vid pågående korrigering.
//   • Brett dödband (±0.10°C) → ingen mikrojustering, fryser I.
//   • Slew-rate-cap (±5%/cykel) hindrar burst-oscillation.
//   • SSOT-stale-freeze: fryser I om data är >8 min gammal.
//   • Peak-detection självtuner cooling-Ki.
//   • Min-off (kylning 5 min) skyddar glykol-mixing och kompressor.
//
// SSOT Naming Convention:
//   actualTarget       = användarens önskemål (profile_target_temp)
//   actualTemp         = bulk-temp (kallaren bestämmer källan)
//   actualTempAgeMin   = minuter sedan SSOT senast uppdaterades
//   ctrlTarget         = nuvarande HW-mål (legacy)
//   ctrlTargetPid      = actualTarget (PID-output är duty)
//
// Persistent state lever i controller_learned_compensation:
//   accumulated_integral → I-termen
//   sensor_anchor (JSONB) → V5PidState (peak-detect + min-off + dT/dt)
// ============================================================

/** Persistent PID-tillstånd mellan cykler (lagras i sensor_anchor JSONB). */
interface V5PidState {
  lastSsot?: number
  lastSsotAt?: string
  lastDutyPct?: number
  lastZeroDutyAt?: string
  peakArmed?: boolean
  peakArmedTarget?: number
  peakArmedAt?: string
  peakMinTemp?: number
  kiAdjCooling?: number
  lastMode?: 'heating' | 'cooling'
}

// ── Tuning constants ─────────────────────────────────────────────────────
const COOL = {
  Kp: 0.20,
  KiPerHour: 0.30,
  Imax: 0.35,
  Deadband: 0.10,
  IZone: 0.4,
  MinOffMin: 5,
  Kd: 8.0,
}
const HEAT = {
  KpHold: 0.45, KpRamp: 0.80,
  KiHold: 1.2,  KiRamp: 4.5,
  Imax: 0.40,
  IZone: 0.6,
  Kd: 6.0,
}
const SLEW_PER_CYCLE = 0.05    // max ±5 procentenheter duty/cykel
const SLEW_BYPASS_ERR = 0.50   // |err|>0.5°C → fri respons
const STALE_FREEZE_MIN = 8     // SSOT > N min → frys I

/** Persist PID state to controller_learned_compensation */
async function persistPidState(
  supabase: any,
  controllerId: string, deltaBucket: string, mode: string, stepType: string,
  pCorrection: number, iCorrection: number, avgError: number,
  dutyCycle: number, nextState: V5PidState,
): Promise<void> {
  await supabase.from('controller_learned_compensation').upsert({
    controller_id: controllerId, delta_bucket: deltaBucket, mode, step_type: stepType,
    latest_p_correction: pCorrection, latest_i_correction: iCorrection,
    latest_d_damping: dutyCycle,
    latest_avg_error: avgError,
    accumulated_integral: iCorrection,
    sensor_anchor: nextState,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'controller_id,delta_bucket,mode,step_type', ignoreDuplicates: false })
}

/**
 * Calculate PID duty cycle for temperature control.
 * V5: PI + D-on-measurement + slew-cap, single-input (SSOT only).
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
  modeJustSwitched?: boolean,
  coolingPwmWindowMin: number = 8,
  actualTempAgeMin?: number | null,
): Promise<{ ctrlTargetPid: number; dutyCycle?: number; pCorrection?: number; iCorrection?: number; learnedBaseline?: number; deltaBucket?: string; convergenceCount?: number; constraints?: string[]; persistPromise?: Promise<void>; coolingPwmWindowMin?: number }> {
  const constraints: string[] = []
  const deltaBucket = 'low'
  void ctrlTarget

  // ── Fetch PID state ──
  const { data: learnedRow } = await supabase
    .from('controller_learned_compensation')
    .select('learned_pi_correction, convergence_count, accumulated_integral, latest_avg_error, sensor_anchor')
    .eq('controller_id', controllerId)
    .eq('delta_bucket', deltaBucket)
    .eq('mode', mode)
    .eq('step_type', stepType)
    .maybeSingle()

  const learnedBaseline = learnedRow ? parseFloat(String(learnedRow.learned_pi_correction)) : 0
  const convergenceCount = learnedRow?.convergence_count ?? 0
  let persistedIntegral = learnedRow ? parseFloat(String(learnedRow.accumulated_integral)) : 0
  if (!Number.isFinite(persistedIntegral) || Math.abs(persistedIntegral) > 1.0) persistedIntegral = 0
  const prevState: V5PidState = (() => {
    const raw = learnedRow?.sensor_anchor
    if (!raw || typeof raw !== 'object') return {}
    const a = raw as any
    return {
      lastSsot: typeof a.lastSsot === 'number' ? a.lastSsot : undefined,
      lastSsotAt: typeof a.lastSsotAt === 'string' ? a.lastSsotAt : undefined,
      lastDutyPct: typeof a.lastDutyPct === 'number' ? a.lastDutyPct : undefined,
      lastZeroDutyAt: typeof a.lastZeroDutyAt === 'string' ? a.lastZeroDutyAt : undefined,
      peakArmed: typeof a.peakArmed === 'boolean' ? a.peakArmed : undefined,
      peakArmedTarget: typeof a.peakArmedTarget === 'number' ? a.peakArmedTarget : undefined,
      peakArmedAt: typeof a.peakArmedAt === 'string' ? a.peakArmedAt : undefined,
      peakMinTemp: typeof a.peakMinTemp === 'number' ? a.peakMinTemp : undefined,
      kiAdjCooling: typeof a.kiAdjCooling === 'number' ? a.kiAdjCooling : undefined,
      lastMode: a.lastMode === 'heating' || a.lastMode === 'cooling' ? a.lastMode : undefined,
    }
  })()

  void isStaleData // SSOT är källan; staleness påverkar inte PI direkt
  const r = computeDutyV5({
    mode, stepType,
    actualTarget, actualTemp,
    persistedIntegral,
    modeJustSwitched: !!modeJustSwitched,
    coolingUtilization: coolingUtilization ?? null,
    prevState,
    actualTempAgeMin: actualTempAgeMin ?? null,
  })
  const dutyCycle = r.duty
  const integral = r.integral
  const pCorrection = r.p
  for (const c of r.constraints) constraints.push(c)

  const avgError = actualTarget - actualTemp
  const need = mode === 'cooling' ? -avgError : avgError
  console.log(`🎯 ${mode} ${controllerName}: err=${avgError.toFixed(2)}°, need=${need.toFixed(2)}°, P=${pCorrection.toFixed(2)}, I=${integral.toFixed(3)}, kiAdj=${(r.nextState.kiAdjCooling ?? 1).toFixed(2)}, duty=${(dutyCycle * 100).toFixed(0)}% [${constraints.join(',')}]`)

  const persistPromise = persistPidState(
    supabase, controllerId, deltaBucket, mode, stepType,
    pCorrection, integral, avgError, dutyCycle, r.nextState,
  )

  return {
    ctrlTargetPid: Math.round(actualTarget * 10) / 10,
    dutyCycle,
    pCorrection,
    iCorrection: integral,
    learnedBaseline,
    deltaBucket,
    convergenceCount,
    constraints,
    persistPromise,
    coolingPwmWindowMin,
  }
}

// ============================================================
// V5: SSOT-only — pure function, no DB access
// ============================================================
function computeDutyV5(input: {
  mode: 'heating' | 'cooling'
  stepType: string
  actualTarget: number
  actualTemp: number             // SSOT — enda temperatursignal
  persistedIntegral: number
  modeJustSwitched: boolean
  coolingUtilization: number | null
  prevState: V5PidState
  actualTempAgeMin?: number | null
}): { duty: number; integral: number; p: number; constraints: string[]; nextState: V5PidState } {
  const constraints: string[] = []
  const isCooling = input.mode === 'cooling'
  const isHold = input.stepType === 'hold'
  const now = new Date().toISOString()
  const nowMs = Date.now()

  const avgError = input.actualTarget - input.actualTemp
  const need = isCooling ? -avgError : avgError

  let kiAdj = isCooling && input.prevState.kiAdjCooling != null
    ? Math.max(0.4, Math.min(2.5, input.prevState.kiAdjCooling))
    : 1.0

  let Kp: number, KiPerHour: number, Imax: number, IZone: number, Kd: number
  if (isCooling) {
    Kp = COOL.Kp; KiPerHour = COOL.KiPerHour * kiAdj
    Imax = COOL.Imax; IZone = COOL.IZone; Kd = COOL.Kd
  } else {
    Kp = isHold ? HEAT.KpHold : HEAT.KpRamp
    KiPerHour = isHold ? HEAT.KiHold : HEAT.KiRamp
    Imax = HEAT.Imax; IZone = HEAT.IZone; Kd = HEAT.Kd
  }

  let integral = input.persistedIntegral
  if (!Number.isFinite(integral) || Math.abs(integral) > 1.0) integral = 0
  if (input.modeJustSwitched || (input.prevState.lastMode && input.prevState.lastMode !== input.mode)) {
    integral = 0
    constraints.push('mode-reset-hard')
  }
  integral = Math.max(0, Math.min(Imax, integral))

  const uP = Math.max(0, Kp * need)

  let dtMin = 1.0
  if (input.prevState.lastSsotAt) {
    const raw = (nowMs - new Date(input.prevState.lastSsotAt).getTime()) / 60000
    if (Number.isFinite(raw)) dtMin = Math.max(0.25, Math.min(5.0, raw))
  }
  let nextI = integral
  const inDeadband = Math.abs(avgError) <= COOL.Deadband

  // SSOT-stale-freeze: när bulkmätaren inte uppdaterats på >8 min är PI:s
  // återkoppling osäker. Frys integralen för att undvika windup mot data
  // som ännu inte speglar verkan av aktuell duty.
  const isStaleSsot = input.actualTempAgeMin != null && input.actualTempAgeMin > STALE_FREEZE_MIN
  if (isStaleSsot) {
    constraints.push(`ssot-stale-freeze(${input.actualTempAgeMin!.toFixed(0)}m)`)
  }

  if (!inDeadband && Math.abs(need) <= IZone && !input.modeJustSwitched && !isStaleSsot) {
    nextI += KiPerHour * need * dtMin / 60
    constraints.push(`i-zone(dt=${dtMin.toFixed(1)}m)`)
  } else if (inDeadband) {
    constraints.push('deadband-freeze')
  }
  if (need < -0.01) {
    nextI *= 0.85
    constraints.push('overshoot-bleed')
  }
  nextI = Math.max(0, Math.min(Imax, nextI))

  // ── D-term: D-on-measurement (bromsa när vi närmar oss mål) ──
  // progressRate > 0 = SSOT rör sig åt rätt håll → minska duty proportionellt.
  let dBrake = 0
  if (input.prevState.lastSsot != null && input.prevState.lastSsotAt && !isStaleSsot) {
    const ratePerMin = (input.actualTemp - input.prevState.lastSsot) / dtMin
    const progressRate = isCooling ? -ratePerMin : ratePerMin
    if (progressRate > 0) {
      dBrake = Math.min(0.25, Kd * progressRate)
      constraints.push(`d-brake(${(dBrake * 100).toFixed(1)}%)`)
    }
  }

  const raw = uP + nextI - dBrake
  let duty = Math.max(0, Math.min(1, raw))

  if (need <= 0) {
    duty = 0
    constraints.push('past-target-coast')
    // Mildare bleed nära mål (|err|<0.20°) så I får etablera steady-state bias
    // som matchar värmeinflödet. Aggressivare bleed vid större överskridanden.
    const nearTarget = Math.abs(avgError) < 0.20
    const bleedFactor = nearTarget ? 0.15 : 0.5
    const bleed = (KiPerHour * dtMin / 60) * bleedFactor
    nextI = Math.max(0, nextI - bleed)
    constraints.push(`coast-i-bleed(${bleed.toFixed(3)}${nearTarget ? ',near' : ''})`)
  }

  if (need > 2.0) {
    duty = 1.0
    constraints.push('full-action')
  }

  // ── Cool-boost: snabba upp approach vid stora fel (1.0–2.0°C) ──
  // Slow-PI (Kp=0.20) ger bara ~40% vid err=2°, vilket gör sista graden onödigt
  // långsam. Sätt en golv-duty: err=1.0→70%, err=2.0→100% (linjär). Slew-cap
  // bypassas redan när |need|>0.5, så inga trappstegs-problem.
  if (isCooling && need >= 1.0 && need <= 2.0) {
    const floor = Math.min(1.0, 0.40 + need * 0.30)
    if (duty < floor) {
      duty = floor
      constraints.push(`cool-boost(${(floor * 100).toFixed(0)}%)`)
    }
  }

  if (isHold && !input.modeJustSwitched && inDeadband) {
    duty = 0
    nextI = integral
    constraints.push('hold-deadband')
  }

  if (isCooling && input.coolingUtilization != null && input.coolingUtilization >= 0.90) {
    duty = Math.min(duty, nextI + 0.1)
    constraints.push('util-sat-cap')
  }

  if (isCooling && duty > 0 && input.prevState.lastZeroDutyAt) {
    const minutesSinceOff = (nowMs - new Date(input.prevState.lastZeroDutyAt).getTime()) / 60000
    if (minutesSinceOff < COOL.MinOffMin) {
      duty = 0
      constraints.push(`min-off(${minutesSinceOff.toFixed(1)}m)`)
    }
  }

  // ── Slew-rate cap: max ±5% duty/cykel ──
  // Hindrar bursts (t.ex. 0→30% på mikro-overshoot). Bypass vid panik, mode-byte
  // eller past-target-coast (måste få stänga snabbt).
  const lastDutyFrac = (input.prevState.lastDutyPct ?? 0) / 100
  const slewBypass = input.modeJustSwitched || Math.abs(need) > SLEW_BYPASS_ERR || need <= 0
  if (!slewBypass) {
    const delta = duty - lastDutyFrac
    if (Math.abs(delta) > SLEW_PER_CYCLE) {
      duty = Math.max(0, Math.min(1, lastDutyFrac + Math.sign(delta) * SLEW_PER_CYCLE))
      constraints.push(`slew-cap(${(delta * 100).toFixed(1)}%→${Math.sign(delta) * SLEW_PER_CYCLE * 100}%)`)
    }
  }

  // ── Peak-detection (cooling, hold): självtunar Ki ──
  const dutyPct = Math.round(duty * 100)
  let peakArmed = input.prevState.peakArmed ?? false
  let peakArmedTarget = input.prevState.peakArmedTarget
  let peakArmedAt = input.prevState.peakArmedAt
  let peakMinTemp = input.prevState.peakMinTemp
  if (isCooling && isHold) {
    const wasPositiveDuty = (input.prevState.lastDutyPct ?? 0) > 0
    if (wasPositiveDuty && dutyPct === 0 && Math.abs(avgError) < 0.5) {
      peakArmed = true
      peakArmedTarget = input.actualTarget
      peakArmedAt = now
      peakMinTemp = input.actualTemp
      constraints.push('peak-arm')
    } else if (peakArmed && peakMinTemp != null) {
      if (input.actualTemp < peakMinTemp) {
        peakMinTemp = input.actualTemp
      } else if (input.actualTemp >= peakMinTemp + 0.02) {
        const tgt = peakArmedTarget ?? input.actualTarget
        const under = tgt - peakMinTemp
        if (under > 0.20) {
          kiAdj = Math.max(0.4, kiAdj * 0.85)
          constraints.push(`peak-tune-down(under=${under.toFixed(2)},ki=${kiAdj.toFixed(2)})`)
        } else if (under < -0.10) {
          kiAdj = Math.min(2.5, kiAdj * 1.15)
          constraints.push(`peak-tune-up(over=${(-under).toFixed(2)},ki=${kiAdj.toFixed(2)})`)
        } else {
          constraints.push(`peak-ok(under=${under.toFixed(2)})`)
        }
        peakArmed = false
        peakArmedTarget = undefined
        peakArmedAt = undefined
        peakMinTemp = undefined
      }
      if (peakArmed && peakArmedAt) {
        const armAgeMin = (nowMs - new Date(peakArmedAt).getTime()) / 60000
        if (armAgeMin > 60) {
          peakArmed = false
          peakArmedTarget = undefined
          peakArmedAt = undefined
          peakMinTemp = undefined
        }
      }
    }
  }

  const lastZeroDutyAt = dutyPct === 0
    ? (input.prevState.lastDutyPct === 0 && input.prevState.lastZeroDutyAt ? input.prevState.lastZeroDutyAt : now)
    : input.prevState.lastZeroDutyAt

  const nextState: V5PidState = {
    lastSsot: input.actualTemp,
    lastSsotAt: now,
    lastDutyPct: dutyPct,
    lastZeroDutyAt,
    peakArmed,
    peakArmedTarget,
    peakArmedAt,
    peakMinTemp,
    kiAdjCooling: isCooling ? kiAdj : input.prevState.kiAdjCooling,
    lastMode: input.mode,
  }

  return { duty, integral: nextI, p: uP, constraints, nextState }
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
    .select('actual_temp, target_temp, cooling_enabled, recorded_at')
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
