import { getLearnedParam, getTempBucket, updateLearnedParam } from './learning-utils.ts'

// ============================================================
// PID Control & Thermal Learning (V4: BrewPi-stil)
//
// Designprinciper (dödtidsdominerad process: ~15 min probe-latens, 60L massa):
//   • Långsam PI på SSOT (actualTemp). Inget D. Ingen observer.
//   • Brett dödband (±0.10°C) → ingen mikrojustering runt setpoint.
//   • Peak-detection självtuner cooling-Ki: undershoot sänker, overshoot höjer.
//   • Pill bara som säkerhetstak (top-cap / bottom-stop), inte i PID-felet.
//   • Min-off (kylning 5 min) skyddar glykol-mixing och kompressor.
//   • Värmesidan oförändrad i karaktär (snabb, hög Kp/Ki).
//
// SSOT Naming Convention:
//   actualTarget  = användarens önskemål (profile_target_temp)
//   actualTemp    = bulk-temp (probe eller probe+pill-snitt — kallaren styr)
//   pillTempNow   = flytande pill (top), null om ej parad
//   ctrlTarget    = nuvarande HW-mål (legacy)
//   ctrlTargetPid = actualTarget (PID-output är duty)
//
// Persistent state lever i controller_learned_compensation:
//   accumulated_integral → I-termen
//   sensor_anchor (JSONB) → V4PidState (peak-detect + min-off-bokföring)
// ============================================================

/** Persistent PID-tillstånd mellan cykler (lagras i sensor_anchor JSONB). */
interface V4PidState {
  // Senaste SSOT-bokföring för peak-detection
  lastSsot?: number
  lastSsotAt?: string
  // Senaste duty + tidpunkt då vi gick till 0 (för min-off)
  lastDutyPct?: number
  lastZeroDutyAt?: string
  // Peak-detection (cooling, hold): armas när duty 0 → spårar peak/undershoot
  peakArmed?: boolean
  peakArmedTarget?: number
  peakArmedAt?: string
  peakMinTemp?: number
  // Självtunings-multiplikator på cooling-Ki (clampas 0.4..2.5)
  kiAdjCooling?: number
  // Mode-vid-senaste-cykel (för soft-reset vid mode-flip)
  lastMode?: 'heating' | 'cooling'
}

// ── Tuning constants ─────────────────────────────────────────────────────
const COOL = {
  Kp: 0.20,
  KiPerHour: 0.30, // mycket långsam — bygger ~5%/16 min
  Imax: 0.35,
  Deadband: 0.10,
  IZone: 0.4,
  MinOffMin: 5,    // min minuter sedan duty=0 innan kylning får återstarta
}
const HEAT = {
  KpHold: 0.45, KpRamp: 0.80,
  KiHold: 1.2,  KiRamp: 4.5,
  Imax: 0.40,
  IZone: 0.6,
}
const PILL_TOP_CAP = 0.7   // pill > target + denna → tvinga minst 12% duty
const PILL_BOTTOM_STOP = 0.7 // pill < target − denna → stoppa kylning

/** Persist PID state to controller_learned_compensation */
async function persistPidState(
  supabase: any,
  controllerId: string, deltaBucket: string, mode: string, stepType: string,
  pCorrection: number, iCorrection: number, avgError: number,
  dutyCycle: number, nextState: V4PidState,
): Promise<void> {
  await supabase.from('controller_learned_compensation').upsert({
    controller_id: controllerId, delta_bucket: deltaBucket, mode, step_type: stepType,
    latest_p_correction: pCorrection, latest_i_correction: iCorrection,
    latest_d_damping: dutyCycle, // legacy fält — total duty
    latest_avg_error: avgError,
    accumulated_integral: iCorrection,
    sensor_anchor: nextState,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'controller_id,delta_bucket,mode,step_type', ignoreDuplicates: false })
}

/**
 * Calculate PID duty cycle for temperature control.
 * V4: långsam PI på SSOT + peak-detection (cooling) + pill-safety.
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
  coolingPwmWindowMin: number = 8,
  probeAgeMin?: number | null,
): Promise<{ ctrlTargetPid: number; dutyCycle?: number; pillRate?: number | null; pCorrection?: number; iCorrection?: number; learnedBaseline?: number; deltaBucket?: string; convergenceCount?: number; constraints?: string[]; persistPromise?: Promise<void>; coolingPwmWindowMin?: number }> {
  const constraints: string[] = []
  const deltaBucket = 'low'
  void ctrlTarget; void isInterpolated; void probeTempRaw; void pillProbeOffset
  void controllerName

  // ── Parallel fetch: PID state + ssFloor ──
  const ssBucket = getTempBucket(floorLookupTarget ?? actualTarget)
  const phaseSuffix = phaseBucket ? `:${phaseBucket}` : ''
  const phaseKeyedName = `steady_state_duty:${mode}:${ssBucket}${phaseSuffix}`
  const modeKeyedName = `steady_state_duty:${mode}:${ssBucket}`
  const [{ data: learnedRow }, phaseParam, modeParam] = await Promise.all([
    supabase
      .from('controller_learned_compensation')
      .select('learned_pi_correction, convergence_count, accumulated_integral, latest_avg_error, sensor_anchor')
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

  const SS_FLOOR_HARD_CAP = 0.30 // Capa inlärt kylgolv: undvik 60-70% första-burst vid små överskridanden.
  const ssFloorRawUncapped = ssParamResolved.sampleCount >= 5 ? ssParamResolved.value : 0
  const ssFloorRaw = Math.min(ssFloorRawUncapped, SS_FLOOR_HARD_CAP)
  if (ssFloorRawUncapped > SS_FLOOR_HARD_CAP) {
    constraints.push(`ss-floor-cap(${(ssFloorRawUncapped * 100).toFixed(0)}→${(SS_FLOOR_HARD_CAP * 100).toFixed(0)}%)`)
  }
  const learnedBaseline = learnedRow ? parseFloat(String(learnedRow.learned_pi_correction)) : 0
  const convergenceCount = learnedRow?.convergence_count ?? 0
  let persistedIntegral = learnedRow ? parseFloat(String(learnedRow.accumulated_integral)) : 0
  // One-time clamp: legacy °C-domain integrals (>1.0) reset to 0
  if (!Number.isFinite(persistedIntegral) || Math.abs(persistedIntegral) > 1.0) persistedIntegral = 0
  // Hämta V4-state ur sensor_anchor JSONB (gamla anchor-fält ignoreras tyst).
  const prevState: V4PidState = (() => {
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
  // ssFloor är avaktiverat som duty-källa (ren PI + margin-scaling räcker).
  // Skrivlogiken i controller-adjustments behålls för diagnostik.
  const uFf = 0
  void ssFloorRaw; void deadbandGainScale

  // ── Core PI ──
  void isStaleData // SSOT är källan; staleness påverkar inte PI direkt
  const r = computeDutyV4({
    mode, stepType,
    actualTarget, actualTemp,
    pillTempNow: pillTempNow ?? null,
    pillRate: pillRate ?? null,
    uFf,
    persistedIntegral,
    modeJustSwitched: !!modeJustSwitched,
    coolingUtilization: coolingUtilization ?? null,
    prevState,
    probeAgeMin: probeAgeMin ?? null,
  })
  let dutyCycle = r.duty
  const integral = r.integral
  const pCorrection = r.p
  for (const c of r.constraints) constraints.push(c)

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
  console.log(`🎯 ${mode} ${controllerName} [${floorSource}]: err=${avgError.toFixed(2)}°, need=${need.toFixed(2)}°, P=${pCorrection.toFixed(2)}, I=${integral.toFixed(3)}, uFf=${uFf.toFixed(3)}, kiAdj=${(r.nextState.kiAdjCooling ?? 1).toFixed(2)}, duty=${(dutyCycle * 100).toFixed(0)}% [${constraints.join(',')}]`)

  const persistPromise = persistPidState(
    supabase, controllerId, deltaBucket, mode, stepType,
    pCorrection, integral, avgError, dutyCycle, r.nextState,
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
    coolingPwmWindowMin,
  }
}

// ============================================================
// V4: BrewPi-stil — pure function, no DB access
// ============================================================
function computeDutyV4(input: {
  mode: 'heating' | 'cooling'
  stepType: string
  actualTarget: number
  actualTemp: number             // SSOT (bulk) — PID error source
  pillTempNow: number | null     // pill (top) — endast säkerhetstak
  pillRate: number | null
  uFf: number                    // feedforward från ssFloor (0 om olärd)
  persistedIntegral: number
  modeJustSwitched: boolean
  coolingUtilization: number | null
  prevState: V4PidState
  probeAgeMin?: number | null
}): { duty: number; integral: number; p: number; constraints: string[]; nextState: V4PidState } {
  const constraints: string[] = []
  const isCooling = input.mode === 'cooling'
  const isHold = input.stepType === 'hold'
  const now = new Date().toISOString()
  const nowMs = Date.now()

  const avgError = input.actualTarget - input.actualTemp
  const need = isCooling ? -avgError : avgError

  // ── Self-tuning Ki-justering (cooling) ──
  // peak-detect armas när duty går till 0 vid hold; nästa peak/dal jämförs
  // mot target och justerar kiAdjCooling 0.4..2.5.
  let kiAdj = isCooling && input.prevState.kiAdjCooling != null
    ? Math.max(0.4, Math.min(2.5, input.prevState.kiAdjCooling))
    : 1.0

  // ── Gains ──
  let Kp: number, KiPerHour: number, Imax: number, IZone: number
  if (isCooling) {
    Kp = COOL.Kp
    KiPerHour = COOL.KiPerHour * kiAdj
    Imax = COOL.Imax
    IZone = COOL.IZone
  } else {
    Kp = isHold ? HEAT.KpHold : HEAT.KpRamp
    KiPerHour = isHold ? HEAT.KiHold : HEAT.KiRamp
    Imax = HEAT.Imax
    IZone = HEAT.IZone
  }

  // ── Integral state ──
  let integral = input.persistedIntegral
  if (!Number.isFinite(integral) || Math.abs(integral) > 1.0) integral = 0
  // Mode-flip: hård reset (cooling-I och heating-I delar inte semantik)
  if (input.modeJustSwitched || (input.prevState.lastMode && input.prevState.lastMode !== input.mode)) {
    integral = 0
    constraints.push('mode-reset-hard')
  }
  integral = Math.max(0, Math.min(Imax, integral))

  // ── P-term ──
  const uP = Math.max(0, Kp * need)

  // ── Integration (verklig dt från lastSsotAt; clampad 0.25–5 min) ──
  let dtMin = 1.0
  if (input.prevState.lastSsotAt) {
    const raw = (nowMs - new Date(input.prevState.lastSsotAt).getTime()) / 60000
    if (Number.isFinite(raw)) dtMin = Math.max(0.25, Math.min(5.0, raw))
  }
  let nextI = integral
  // Brett dödband: i ±0.10°C händer inget med I.
  const inDeadband = Math.abs(avgError) <= COOL.Deadband
  // Probe-staleness scale: probe-värdet uppdateras bara var ~15 min via RAPT API.
  // Vid liten error och stale probe — dämpa I-ackumulationen så vi inte bygger windup
  // på pill-drift (top) innan vi sett vad kylspiralen i botten faktiskt gjort.
  let staleScale = 1.0
  if (isCooling && input.probeAgeMin != null && input.probeAgeMin > 8 && Math.abs(need) < 0.30) {
    staleScale = Math.max(0.2, 1 - (input.probeAgeMin - 8) / 12)
    constraints.push(`probe-stale-i(${input.probeAgeMin.toFixed(0)}m→${staleScale.toFixed(2)}x)`)
  }
  if (!inDeadband && Math.abs(need) <= IZone && !input.modeJustSwitched) {
    nextI += KiPerHour * need * dtMin / 60 * staleScale
    constraints.push(`i-zone(dt=${dtMin.toFixed(1)}m)`)
  }
  // Steady-state-flagga för ssFloor-lärning (caller läser denna).
  if (Math.abs(need) <= 0.30 && !input.modeJustSwitched) constraints.push('steady-state')
  // Bleed I när vi passerat mål — skyddar mot windup vid undershoot.
  if (need < -0.01) {
    nextI *= 0.85
    constraints.push('overshoot-bleed')
  }
  nextI = Math.max(0, Math.min(Imax, nextI))

  // ── Sammanställ duty ──
  const raw = input.uFf + uP + nextI
  let duty = Math.max(0, Math.min(1, raw))

  // (uff-micro-gate borttagen — uFf är nu alltid 0, ingen gating behövs)

  // Probe-stale duty cap: vid små overshoot + stale probe, capa totalduty mot uFf+0.08.
  // Hindrar 30%+ burst på 0.1° overshoot innan probe hunnit rapportera.
  if (isCooling && input.probeAgeMin != null && input.probeAgeMin > 8 && need < 0 && Math.abs(need) < 0.25) {
    const cap = (input.uFf > 0 ? input.uFf : 0) + 0.08
    if (duty > cap) {
      duty = cap
      constraints.push(`probe-stale-cap(${(cap*100).toFixed(0)}%)`)
    }
  }

  // ── Past-target coast ──
  if (need <= 0) {
    duty = (isHold && input.uFf > 0) ? input.uFf * 0.15 : 0
    constraints.push('past-target-coast')
    // Mild I-bleed: förhindrar windup när vi tvingas till 0 men felet är litet/negativt.
    // Drar nextI mot 0 med halva Ki-takten per minut.
    const bleed = (KiPerHour * dtMin / 60) * 0.5
    nextI = Math.max(0, nextI - bleed)
    constraints.push(`coast-i-bleed(${bleed.toFixed(3)})`)
  }

  // ── Panik: > 2°C error → full action ──
  if (need > 2.0) {
    duty = 1.0
    constraints.push('full-action')
  }

  // ── Hold-deadband: på mål och inget driver → 0, frys I ──
  if (
    isHold && !input.modeJustSwitched && inDeadband
    && Math.abs(input.pillRate ?? 0) < 0.05
  ) {
    duty = 0
    nextI = integral
    constraints.push('hold-deadband')
  }

  // ── Pill-säkerhet (cooling): progressiv top-cap, hård bottom-stop ──
  if (isCooling && input.pillTempNow != null) {
    const excess = input.pillTempNow - input.actualTarget
    // SSOT-first: top-cap får BARA tvinga kyla om snittet (actualTemp) också ligger över mål.
    // Annars (stratifierat: varm topp / kall botten) skulle kylning förvärra stratifieringen
    // eftersom kylspiralen sitter i botten. Då litar vi på SSOT istället.
    const ssotAboveTarget = input.actualTemp > input.actualTarget + 0.05
    if (excess > PILL_TOP_CAP && ssotAboveTarget) {
      const floor = Math.max(0.12, Math.min(0.40, 0.12 + (excess - PILL_TOP_CAP) * 0.25))
      duty = Math.max(duty, floor)
      constraints.push(`pill-top-cap(${excess.toFixed(2)}→${Math.round(floor * 100)}%)`)
    } else if (excess > PILL_TOP_CAP) {
      // Stratifiering upptäckt — logga men forcera inte cooling.
      constraints.push(`pill-top-cap-skip-stratified(pill+${excess.toFixed(2)},ssot=${input.actualTemp.toFixed(2)})`)
    } else if (input.pillTempNow < input.actualTarget - PILL_BOTTOM_STOP) {
      duty = 0
      nextI = 0
      constraints.push(`pill-bottom-stop(${(input.actualTarget - input.pillTempNow).toFixed(2)})`)
    }
  }

  // ── Heating-säkerhet: top-overshoot-guard ──
  if (!isCooling && input.pillTempNow != null && input.pillTempNow > input.actualTarget + 0.3) {
    duty = Math.min(duty, 0.2)
    constraints.push('top-overshoot-guard')
  }

  // ── Util saturation ──
  if (isCooling && input.coolingUtilization != null && input.coolingUtilization >= 0.90) {
    duty = Math.min(duty, nextI + 0.1)
    constraints.push('util-sat-cap')
  }

  // ── Min-off (cooling): efter duty=0 måste 5 min passera innan vi får på igen ──
  if (isCooling && duty > 0 && input.prevState.lastZeroDutyAt) {
    const minutesSinceOff = (nowMs - new Date(input.prevState.lastZeroDutyAt).getTime()) / 60000
    if (minutesSinceOff < COOL.MinOffMin) {
      duty = 0
      constraints.push(`min-off(${minutesSinceOff.toFixed(1)}m)`)
    }
  }

  // ── Peak-detection (cooling, hold): självtunar Ki ──
  // Arm: när duty just gick till 0 vid hold och vi var nära mål → börja
  // söka efter peak (lägsta SSOT efter off).
  // Detect: när SSOT börjar stiga igen (delta ≥ +0.02 över förra cykeln).
  // Justering:
  //   peak < target − 0.20  → undershoot, vi var för aggressiva: kiAdj *= 0.85
  //   peak > target + 0.10  → vi nådde aldrig mål: kiAdj *= 1.15
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
      // Spåra nya lägsta värdet
      if (input.actualTemp < peakMinTemp) {
        peakMinTemp = input.actualTemp
      } else if (input.actualTemp >= peakMinTemp + 0.02) {
        // Vändning hittad
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
      // Timeout: 60 min utan vändning → släpp arm (inkonklusiv)
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

  // ── Bygg nextState ──
  const lastZeroDutyAt = dutyPct === 0
    ? (input.prevState.lastDutyPct === 0 && input.prevState.lastZeroDutyAt ? input.prevState.lastZeroDutyAt : now)
    : input.prevState.lastZeroDutyAt

  const nextState: V4PidState = {
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
