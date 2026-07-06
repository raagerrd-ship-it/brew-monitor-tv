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
  ssotSmoothed?: number       // EMA av SSOT — dämpar sensorjitter före PID
  lastDutyPct?: number
  lastZeroDutyAt?: string
  peakArmed?: boolean
  peakArmedTarget?: number
  peakArmedAt?: string
  peakMinTemp?: number
  kiAdjCooling?: number
  lastMode?: 'heating' | 'cooling'
  stallBoostPct?: number      // 0..30 — långsam duty-boost när ingen progress
  lastProgressAt?: string     // senaste tillfället progressRate > +0.02°C/min
  holdLockUntil?: string      // dither-zon settle-lock — duty låst till holdLockDuty tills detta klockslag
  holdLockDuty?: number       // låst duty-fraktion (0..1) under hold-lock
  holdLockBaseline?: number   // ssotFiltered vid lock-entry — bryts om filtered SSOT driftat >0.15°C
}

// ── Tuning constants ─────────────────────────────────────────────────────
const COOL = {
  Kp: 0.20,
  KiPerHour: 0.30,
  Imax: 0.65,
  Deadband: 0.10,
  IZone: 0.4,
  MinOffMin: 5,
  Kd: 3.0,
}
const HEAT = {
  KpHold: 0.45, KpRamp: 0.80,
  KiHold: 1.2,  KiRamp: 4.5,
  Imax: 0.40,
  IZone: 0.6,
  Kd: 2.5,
}
const SLEW_PER_CYCLE = 0.05    // max ±5 procentenheter duty/cykel
const SLEW_BYPASS_ERR = 0.50   // |err|>0.5°C → fri respons
const STALE_FREEZE_MIN = 8     // SSOT > N min → frys I

// ── PWM-hårdvarans kvantisering (round-robin dither i controller-adjustments) ──
// Cykel = 5 min. Slot = 10%-burst. Dither-fönster = 10 slots = 50 min.
// Effektiv upplösning: 1% duty över 50 min. Under duty=10% levererar HW
// aldrig en jämn andel — bara enskilda 10%-bursts glest utspridda.
const HW_STEP = 0.01              // 1% minsta meningsfulla duty-steg
const DITHER_ZONE_MAX = 0.10      // duty < 10% ⇒ vi är i dither-territorium
/** Kvantisera till närmaste 1%. */
const quantize = (d: number) => Math.round(d / HW_STEP) * HW_STEP

/** Persist PID state to controller_learned_compensation */
async function persistPidState(
  supabase: any,
  controllerId: string, deltaBucket: string, mode: string, stepType: string,
  pCorrection: number, iCorrection: number, avgError: number,
  dutyCycle: number, nextState: V5PidState,
  prevConvergenceCount: number, prevLearnedBaseline: number,
  modeJustSwitched: boolean,
): Promise<void> {
  // ── Long-horizon convergence detection ──
  // Only in hold, inside deadband, when duty is actively driven by the I-term
  // (steady state). EMA the learned baseline slowly so a single cycle can't
  // skew it. This is the persistent duty-floor used to seed future sessions.
  let newConvergenceCount = prevConvergenceCount
  let newLearnedBaseline = prevLearnedBaseline
  const converged =
    stepType === 'hold' &&
    !modeJustSwitched &&
    Math.abs(avgError) <= 0.10 &&
    dutyCycle > 0.02 &&
    Math.abs(dutyCycle - iCorrection) < 0.05
  if (converged) {
    newConvergenceCount = prevConvergenceCount + 1
    const alpha = 0.10
    newLearnedBaseline = prevLearnedBaseline > 0
      ? prevLearnedBaseline + alpha * (iCorrection - prevLearnedBaseline)
      : iCorrection
    // Clamp to sane range
    newLearnedBaseline = Math.max(0, Math.min(0.65, newLearnedBaseline))
  }
  await supabase.from('controller_learned_compensation').upsert({
    controller_id: controllerId, delta_bucket: deltaBucket, mode, step_type: stepType,
    latest_p_correction: pCorrection, latest_i_correction: iCorrection,
    latest_d_damping: dutyCycle,
    latest_avg_error: avgError,
    accumulated_integral: iCorrection,
    sensor_anchor: nextState,
    convergence_count: newConvergenceCount,
    learned_pi_correction: newLearnedBaseline,
    last_converged_at: converged ? new Date().toISOString() : undefined,
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
      ssotSmoothed: typeof a.ssotSmoothed === 'number' ? a.ssotSmoothed : undefined,
      lastDutyPct: typeof a.lastDutyPct === 'number' ? a.lastDutyPct : undefined,
      lastZeroDutyAt: typeof a.lastZeroDutyAt === 'string' ? a.lastZeroDutyAt : undefined,
      peakArmed: typeof a.peakArmed === 'boolean' ? a.peakArmed : undefined,
      peakArmedTarget: typeof a.peakArmedTarget === 'number' ? a.peakArmedTarget : undefined,
      peakArmedAt: typeof a.peakArmedAt === 'string' ? a.peakArmedAt : undefined,
      peakMinTemp: typeof a.peakMinTemp === 'number' ? a.peakMinTemp : undefined,
      kiAdjCooling: typeof a.kiAdjCooling === 'number' ? a.kiAdjCooling : undefined,
      lastMode: a.lastMode === 'heating' || a.lastMode === 'cooling' ? a.lastMode : undefined,
      stallBoostPct: typeof a.stallBoostPct === 'number' ? a.stallBoostPct : undefined,
      lastProgressAt: typeof a.lastProgressAt === 'string' ? a.lastProgressAt : undefined,
      holdLockUntil: typeof a.holdLockUntil === 'string' ? a.holdLockUntil : undefined,
      holdLockDuty: typeof a.holdLockDuty === 'number' ? a.holdLockDuty : undefined,
      holdLockBaseline: typeof a.holdLockBaseline === 'number' ? a.holdLockBaseline : undefined,
    }
  })()

  void isStaleData // SSOT är källan; staleness påverkar inte PI direkt
  const r = computeDutyV5({
    mode, stepType,
    actualTarget, actualTemp,
    persistedIntegral,
    learnedBaseline,
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

  // Convergence-gate ska matcha kontroll-loopens filtrerade signal — annars
  // riskerar en enstaka brusig raw-sample hålla oss utanför 0.10°-fönstret
  // trots att hold-lock håller stabilt. Använd samma ssotFiltered som
  // computeDutyV5 beslutade på (fallback till raw om smoothing saknas).
  const filteredAvgError = r.nextState.ssotSmoothed != null
    ? actualTarget - r.nextState.ssotSmoothed
    : avgError

  const persistPromise = persistPidState(
    supabase, controllerId, deltaBucket, mode, stepType,
    pCorrection, integral, filteredAvgError, dutyCycle, r.nextState,
    convergenceCount, learnedBaseline, !!modeJustSwitched,
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
  learnedBaseline: number
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

  // ── SSOT-smoothing: EMA med tidskonstant ~3 min för att döda sensorjitter.
  // Alpha skalar med dtMin (räknas nedan) — beräkna dtMin först.
  let dtMinEarly = 1.0
  if (input.prevState.lastSsotAt) {
    const raw = (nowMs - new Date(input.prevState.lastSsotAt).getTime()) / 60000
    if (Number.isFinite(raw)) dtMinEarly = Math.max(0.25, Math.min(5.0, raw))
  }
  // TAU_MIN måste överstiga sample-intervallet (≥5 min PWM-cykel) och rymma
  // ~15 min probe-latens — annars saturerar alpha och EMA:n blir en no-op.
  // Formen 1-exp(-dt/tau) är korrekt diskret EMA (tidigare min(1, dt/tau)
  // gav alpha=1 vid dt≥tau, dvs pass-through).
  const TAU_MIN = 12.0
  const alpha = 1 - Math.exp(-dtMinEarly / TAU_MIN)
  const prevSmoothed = input.prevState.ssotSmoothed
  const ssotFiltered = prevSmoothed != null
    ? prevSmoothed + alpha * (input.actualTemp - prevSmoothed)
    : input.actualTemp

  const avgError = input.actualTarget - ssotFiltered
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

  // Seed from long-term learned duty-floor when transient integral is empty.
  // Fresh session, cold start, or last cycle bled to 0 → give PID a head start
  // at 70% of the learned steady-state duty. PID trims the rest via db-conv-up.
  const canSeed = integral === 0 && input.learnedBaseline > 0.05 && !input.modeJustSwitched
  if (canSeed) {
    integral = quantize(input.learnedBaseline * 0.7)
    constraints.push(`seed-from-learned(${(integral * 100).toFixed(0)}%)`)
  }

  if (input.modeJustSwitched || (input.prevState.lastMode && input.prevState.lastMode !== input.mode)) {
    // Mjuk reset: behåll halva lärda baselinen istället för att slänga bort
    // all ackumulerad kunskap vid varje PWM-mode-flip.
    if (input.learnedBaseline > 0.05) {
      integral = quantize(input.learnedBaseline * 0.5)
      constraints.push(`mode-reset-soft(${(integral * 100).toFixed(0)}%)`)
    } else {
      integral = 0
      constraints.push('mode-reset-hard')
    }
  }
  integral = Math.max(0, Math.min(Imax, integral))

  const uP = Math.max(0, Kp * need)

  const dtMin = dtMinEarly
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
    // Symmetrisk long-horizon konvergens i deadband:
    //  – Låt I följa verklig hold-duty över flera hold-cykler utan att
    //    bleeda bort minnet. Ingen persistens – bara att integralen får jobba.
    //  – Fel sida (need>+0.02): trimma upp (som tidigare hold-trim, men här).
    //  – Säker sida (need<-0.02): trimma ner lika sakta som upp.
    //  – Nära noll (|need|<=0.02): frys – vi har hittat steady-state.
    if (isHold && !input.modeJustSwitched) {
      if (need > 0.02) {
        const step = Math.min(0.010, 0.003 + Math.abs(avgError) * 0.05) * (dtMin / 5)
        nextI = Math.min(Imax, nextI + step)
        constraints.push(`db-conv-up(+${(step*100).toFixed(2)}%)`)
      } else if (need < -0.02) {
        const step = Math.min(0.010, 0.003 + Math.abs(avgError) * 0.05) * (dtMin / 5)
        nextI = Math.max(0, nextI - step)
        constraints.push(`db-conv-dn(-${(step*100).toFixed(2)}%)`)
      } else {
        constraints.push('db-conv-freeze')
      }
    } else {
      // Icke-hold: behåll tidigare asymmetriska beteende
      const wrongSideI = need > 0.02
      if (!wrongSideI) {
        const deadbandBleed = (KiPerHour * dtMin / 60) * 0.30
        nextI = Math.max(0, nextI - deadbandBleed)
        constraints.push(`deadband-bleed(${deadbandBleed.toFixed(3)})`)
      } else {
        constraints.push('deadband-hold-i')
      }
    }
  }
  // Overshoot-bleed körs bara utanför deadband. Inne i deadband hanterar
  // deadband-bleed / hold-deadband redan I-termen; en extra bleed här skulle
  // motsäga 'deadband-freeze'-semantiken och göra loggen missvisande.
  //
  // Tuning: bleed:en var 15%/cykel = 85%/h vilket raderade lärd I varje
  // gång temperaturen dippade under mål (t.ex. morgondipp efter nattens
  // ambient-topp). Skala nu bleed:en med felstorlek + dtMin så bara
  // uppenbara översläng (>-0.15°C) tömmer I snabbt.
  if (need < -0.05 && !inDeadband) {
    // 3%/cyk vid −0.05°C, 10%/cyk vid −0.20°C, capad 15%/cyk. Skalas med dtMin/5.
    const overshootMag = Math.min(0.20, Math.abs(avgError))
    const bleedFrac = Math.min(0.15, 0.02 + overshootMag * 0.65) * (dtMin / 5)
    nextI *= (1 - bleedFrac)
    constraints.push(`overshoot-bleed(-${(bleedFrac*100).toFixed(1)}%)`)
  }
  nextI = Math.max(0, Math.min(Imax, nextI))

  // ── Ki auto-recover: peak-arm triggar aldrig när vi ligger permanent över mål,
  // så tune-down blir enkelriktad. Bumpa kiAdj vid off-target (need>0.20) —
  // typisk nattlig excursion ligger 0.20–0.25°C, tidigare tröskel 0.30 nåddes
  // aldrig så kiAdj växte aldrig och I under-integrerade permanent.
  // Rate-limit: +10%/5min istället för +10%/cykel — annars når vi 2.5x på <1h
  // vilket är farligt när dead-time (~15 min) bara innebär att systemet ännu
  // inte hunnit svara på nuvarande duty.
  if (isCooling && nextI >= 0.85 * Imax && need > 0.20 && !isStaleSsot) {
    const recoverGrowth = 0.10 * (dtMin / 5)  // 10% per 5 min
    kiAdj = Math.min(2.5, kiAdj * (1 + recoverGrowth))
    constraints.push(`ki-recover(ki=${kiAdj.toFixed(2)})`)
  }
  // Sakta tune-down kiAdj när vi är stabilt nära mål — annars fastnar den på 2.5
  // efter en tidigare recovery-fas och över-integrerar för alltid.
  if (isCooling && Math.abs(avgError) < 0.15 && kiAdj > 1.0) {
    kiAdj = Math.max(1.0, kiAdj - 0.02 * dtMin)
    constraints.push(`ki-decay(ki=${kiAdj.toFixed(2)})`)
  }

  // ── D-term: D-on-measurement (bromsa när vi närmar oss mål) ──
  // progressRate > 0 = SSOT rör sig åt rätt håll → minska duty proportionellt.
  let dBrake = 0
  if (prevSmoothed != null && input.prevState.lastSsotAt && !isStaleSsot) {
    const ratePerMin = (ssotFiltered - prevSmoothed) / dtMin
    const progressRate = isCooling ? -ratePerMin : ratePerMin
    // Dither-artefakt-guard: när vi ligger i låg-duty-zonen (<10%) och redan
    // är nära mål levererar HW enstaka 10%-bursts glest utspridda. SSOT-EMA
    // (τ=3 min) hinner reagera på bursten och rapporterar en "progress-rate"
    // som egentligen är burst-ringing, inte PID-trajektoria. Att bromsa på
    // det skulle sänka duty ytterligare och skapa oscillation runt setpoint.
    const prevDutyFrac = (input.prevState.lastDutyPct ?? 0) / 100
    const inDitherZone = prevDutyFrac > 0 && prevDutyFrac < DITHER_ZONE_MAX
    const suppressD = inDitherZone && isHold && inDeadband
    if (suppressD) {
      constraints.push('d-suppress-dither')
    } else if (progressRate > 0) {
      dBrake = Math.min(0.25, Kd * progressRate)
      constraints.push(`d-brake(${(dBrake * 100).toFixed(1)}%)`)
    }
  }

  const raw = uP + nextI - dBrake
  let duty = Math.max(0, Math.min(1, raw))

  if (need <= 0) {
    // Soft coast: slamma inte till 0 direkt när vi precis passerat mål.
    // Om vi kylde 50% för att sakta sänka så innebär target-crossing inte
    // att systemet slutat behöva kylning — det finns fortfarande
    // värmeinflöde. Låt duty glida ner mot steady-state (nextI) begränsad av
    // slew, och bara nolla när vi klart överskridit (|err| ≥ 0.15°).
    const prevDutyFrac = (input.prevState.lastDutyPct ?? 0) / 100
    const clearOvershoot = avgError <= -0.15  // för kylning: SSOT ≥ 0.15° under mål
    if (clearOvershoot) {
      // Tydlig overshoot: släpp mot 0, men slew-limita nedstegen (5%/cykel)
      const slewFloor = Math.max(0, prevDutyFrac - SLEW_PER_CYCLE)
      duty = Math.min(duty, slewFloor)
      constraints.push(`past-target-coast(clear,→${(duty*100).toFixed(0)}%)`)
    } else {
      // Nyss passerat / mikro-overshoot: håll steady-state (nextI) som golv
      // och slew-limita nedåt så vi inte sågar 50→0→50.
      const slewFloor = Math.max(0, prevDutyFrac - SLEW_PER_CYCLE)
      const softFloor = Math.max(nextI, slewFloor)
      duty = Math.max(0, Math.min(duty, softFloor))
      constraints.push(`past-target-soft(→${(duty*100).toFixed(0)}%)`)
    }
    // Bleed I bara vid tydlig overshoot; nära mål lämnas I orörd så
    // steady-state-bias bevaras. Bleed-faktor sänkt från 0.5 → 0.2 så en
    // enda coast-cykel inte torkar ut lärd hold-duty.
    if (clearOvershoot) {
      const bleed = (KiPerHour * dtMin / 60) * 0.2
      nextI = Math.max(0, nextI - bleed)
      constraints.push(`coast-i-bleed(${bleed.toFixed(3)})`)
    }
  }

  if (need > 2.0) {
    duty = 1.0
    constraints.push('full-action')
  }

  // ── Cool-boost: snabba upp approach vid mid/large fel (0.5–2.0°C) ──
  // Linjär golv-duty: err=0.5→25%, err=1.0→50%, err=2.0→100%.
  if (isCooling && need >= 0.5 && need <= 2.0) {
    const floor = Math.min(1.0, 0.25 + (need - 0.5) * 0.5)
    if (duty < floor) {
      duty = floor
      constraints.push(`cool-boost(${(floor * 100).toFixed(0)}%)`)
    }
  }

  // ── Stall-boost: lutningsbaserad duty-ökning. Kräver att SSOT rör sig
  // mot mål med minst `requiredRate` °C/min (skalat med felstorlek).
  // Rate ≤ 0 (stillastående/fel håll) → snabb växt. Positiv men otillräcklig
  // rate → proportionell växt. Rate ≥ krav → decay. Capad vid 30%.
  let stallBoost = Math.max(0, Math.min(0.30, input.prevState.stallBoostPct ?? 0))
  let lastProgressAt = input.prevState.lastProgressAt
  if (prevSmoothed != null && input.prevState.lastSsotAt && !isStaleSsot) {
    const ratePerMin = (ssotFiltered - prevSmoothed) / dtMin
    const progressRate = isCooling ? -ratePerMin : ratePerMin
    // Krav: 0.02°C/min vid små fel → 0.10°C/min vid err ≥ 1.6°C
    const requiredRate = Math.max(0.02, Math.min(0.10, need * 0.05))
    const shortfall = requiredRate - progressRate  // >0 = otillräcklig progress
    // Dither-guard: förra cykelns duty i (0, 10%) betyder HW levererade en
    // gles 10%-burst. Rate-mätningen speglar då burst-brus, inte bulk-cooling
    // — låt boost decay/reset:a men aldrig växa på ett burst-sample.
    const stallPrevDutyFrac = (input.prevState.lastDutyPct ?? 0) / 100
    const stallInDitherZone = stallPrevDutyFrac > 0 && stallPrevDutyFrac < DITHER_ZONE_MAX
    if (need <= 0.05 || Math.abs(avgError) < 0.15) {
      // Nära mål: stallboost är irrelevant och skapar burst-övercool om den
      // ligger kvar mättad. Rensa alltid när vi är inom ±0.15° av target.
      stallBoost = 0
      lastProgressAt = now
    } else if (shortfall <= 0) {
      // Uppfyller kravet → decay 2%/min
      stallBoost = Math.max(0, stallBoost - 0.02 * dtMin)
      lastProgressAt = now
    } else if (need > 0.10) {
      if (stallInDitherZone) {
        // Skippa growth — burst-sample opålitligt. Logga bara här så decay/
        // reset-cykler inte spammar constraint.
        constraints.push('stall-freeze-dither')
      } else {
        // Växt proportionell mot shortfall. Extra push om vi går fel håll.
        // shortfall 0.02 → +0.5%/min, 0.05 → +1.25%/min, ≥0.08 → +2%/min
        let growthPerMin = Math.min(0.02, shortfall * 0.25)
        if (progressRate < 0) growthPerMin += 0.01  // fel håll = extra 1%/min
        stallBoost = Math.min(0.30, stallBoost + growthPerMin * dtMin)
      }
    }
  }
  if (stallBoost > 0 && need > 0.05) {
    const before = duty
    duty = Math.min(1, duty + stallBoost)
    if (duty > before) constraints.push(`stall-boost(+${(stallBoost * 100).toFixed(1)}%)`)
  }

  if (isHold && !input.modeJustSwitched && inDeadband) {
    // Long-horizon konvergens: låt duty följa nextI i deadband istället för
    // att slewa mot 0. Det är så vi ser att systemet lär sig verklig hold-duty.
    // nextI uppdateras redan symmetriskt i deadband-blocket ovan.
    duty = Math.max(0, Math.min(1, nextI))
    constraints.push(`db-follow-i(${(duty*100).toFixed(0)}%)`)
  }

  if (isCooling && input.coolingUtilization != null && input.coolingUtilization >= 0.90) {
    duty = Math.min(duty, nextI + 0.1)
    // Anti-windup: kylkretsen är mättad, vi kan inte leverera mer duty.
    // Frys I på tidigare värde så inte pressure byggs upp mot ett tak vi
    // ändå inte kan svara på.
    nextI = Math.min(nextI, input.persistedIntegral)
    constraints.push('util-sat-cap')
  }

  if (isCooling && duty > 0 && input.prevState.lastZeroDutyAt) {
    const minutesSinceOff = (nowMs - new Date(input.prevState.lastZeroDutyAt).getTime()) / 60000
    if (minutesSinceOff < COOL.MinOffMin) {
      duty = 0
      // Anti-windup: min-off tvingar duty=0, låt inte I växa under tiden
      // — annars burst när min-off släpper.
      nextI = Math.min(nextI, input.persistedIntegral)
      constraints.push(`min-off(${minutesSinceOff.toFixed(1)}m)`)
    }
  }

  // ── Slew-rate cap: max ±5% duty/cykel ──
  // Hindrar bursts (t.ex. 0→30% på mikro-overshoot). Bypass vid panik, mode-byte
  // eller past-target-coast (måste få stänga snabbt).
  const lastDutyFrac = (input.prevState.lastDutyPct ?? 0) / 100
  // Slew gäller även när vi precis passerat mål — det är där mest sågtand
  // uppstår. Bara mode-switch eller stort fel bypassar.
  const slewBypass = input.modeJustSwitched || Math.abs(need) > SLEW_BYPASS_ERR
  if (!slewBypass) {
    const delta = duty - lastDutyFrac
    if (Math.abs(delta) > SLEW_PER_CYCLE) {
      duty = Math.max(0, Math.min(1, lastDutyFrac + Math.sign(delta) * SLEW_PER_CYCLE))
      constraints.push(`slew-cap(${(delta * 100).toFixed(1)}%→${Math.sign(delta) * SLEW_PER_CYCLE * 100}%)`)
      // Anti-windup: om vi ville växa duty men slew-cap begränsar, låt
      // inte I fortsätta bygga upp mot en respons vi ännu inte kunnat leverera.
      if (delta > 0) {
        nextI = Math.min(nextI, input.persistedIntegral + SLEW_PER_CYCLE)
      }
    }
  }

  // ── Hold-lock: dither-zon settle-time ──
  // I dither-zonen levererar HW en 10%-burst per 50-min-fönster (10 slot × 5m),
  // medan PID re-evaluerar var 5:e min. Utan lock beslutar PID på burst-brus
  // istället för på faktisk termisk respons. Låt aktuatorn hinna leverera
  // minst en burst (~1 dither-fönster / 3 PID-cykler) innan duty ändras igen.
  const HOLD_LOCK_MIN = 15
  const HOLD_LOCK_ERR_ENTER = 0.15
  const HOLD_LOCK_ERR_EXIT = 0.25
  const HOLD_LOCK_DRIFT_EXIT = 0.15  // filtered-SSOT-drift sedan lock-entry (sensor-cadence-agnostisk)
  let holdLockUntil = input.prevState.holdLockUntil
  let holdLockDuty = input.prevState.holdLockDuty
  let holdLockBaseline = input.prevState.holdLockBaseline
  const prevInDither = lastDutyFrac > 0 && lastDutyFrac < DITHER_ZONE_MAX
  const lockActive = !!holdLockUntil && new Date(holdLockUntil).getTime() > nowMs && holdLockDuty != null
  const driftSinceLock = lockActive && holdLockBaseline != null
    ? Math.abs(ssotFiltered - holdLockBaseline)
    : 0
  const shouldBreakLock =
    input.modeJustSwitched ||
    Math.abs(avgError) > HOLD_LOCK_ERR_EXIT ||
    (lockActive && driftSinceLock > HOLD_LOCK_DRIFT_EXIT)
  if (shouldBreakLock) {
    if (lockActive) {
      const reason = driftSinceLock > HOLD_LOCK_DRIFT_EXIT
        ? `drift(${driftSinceLock.toFixed(2)}°)`
        : Math.abs(avgError) > HOLD_LOCK_ERR_EXIT ? `err(${avgError.toFixed(2)}°)` : 'mode'
      constraints.push(`hold-lock-break(${reason})`)
    }
    holdLockUntil = undefined
    holdLockDuty = undefined
    holdLockBaseline = undefined
  } else if (lockActive) {
    // Trickle-adjust: när vi är på "säker sida" av target får duty ta EN 1%-step
    // per lock-fönster (15 min) i riktning mot PID:s önskade värde. Efter steget
    // refreshas låset så vi väntar hela fönstret innan nästa step. Detta ger
    // mjuk 6→5→4→3-nedgång utan risk för studs tillbaka upp på burst-brus.
    const dutyDelta = duty - holdLockDuty!
    // Trickle i BÅDA riktningar (mode-normaliserat via `need`):
    //  - Down: past-target (need < -0.05°C) och PID vill sänka (dutyDelta < 0)
    //  - Up:   under-action (need > +0.05°C) och PID vill höja (dutyDelta > 0)
    // Ett 1%-steg per 15-min-fönster i endera riktning — förhindrar att låset
    // sitter fast medan en mild drift åt fel håll bygger upp innan err/drift-break.
    const trickleOk =
      (need < -0.05 && dutyDelta < 0) ||
      (need > 0.05 && dutyDelta > 0)
    if (trickleOk && Math.abs(dutyDelta) >= 0.005) {
      const step = Math.sign(dutyDelta) * Math.min(0.01, Math.abs(dutyDelta))
      holdLockDuty = Math.max(0, Math.min(1, holdLockDuty! + step))
      duty = holdLockDuty
      holdLockUntil = new Date(nowMs + HOLD_LOCK_MIN * 60000).toISOString()
      holdLockBaseline = ssotFiltered  // ny drift-anchor efter steg
      constraints.push(`hold-lock-trickle(${step > 0 ? '+' : ''}${(step*100).toFixed(0)}%→${Math.round(duty*100)}%)`)
    } else {
      duty = holdLockDuty!
    }
    nextI = Math.min(nextI, input.persistedIntegral)
    const remain = (new Date(holdLockUntil!).getTime() - nowMs) / 60000
    constraints.push(`hold-lock(${remain.toFixed(1)}m@${Math.round(duty*100)}%,drift=${driftSinceLock.toFixed(2)}°)`)
  } else if (isHold && prevInDither && Math.abs(avgError) < HOLD_LOCK_ERR_ENTER && !input.modeJustSwitched) {
    holdLockUntil = new Date(nowMs + HOLD_LOCK_MIN * 60000).toISOString()
    holdLockDuty = lastDutyFrac
    holdLockBaseline = ssotFiltered
    duty = holdLockDuty
    nextI = Math.min(nextI, input.persistedIntegral)
    constraints.push(`hold-lock-enter(${HOLD_LOCK_MIN}m@${Math.round(duty*100)}%)`)
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
      peakMinTemp = ssotFiltered
      constraints.push('peak-arm')
    } else if (peakArmed && peakMinTemp != null) {
      if (ssotFiltered < peakMinTemp) {
        peakMinTemp = ssotFiltered
      } else if (ssotFiltered >= peakMinTemp + 0.02) {
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
    ssotSmoothed: ssotFiltered,
    lastDutyPct: dutyPct,
    lastZeroDutyAt,
    peakArmed,
    peakArmedTarget,
    peakArmedAt,
    peakMinTemp,
    kiAdjCooling: isCooling ? kiAdj : input.prevState.kiAdjCooling,
    lastMode: input.mode,
    stallBoostPct: stallBoost,
    lastProgressAt,
    holdLockUntil,
    holdLockDuty,
    holdLockBaseline,
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
