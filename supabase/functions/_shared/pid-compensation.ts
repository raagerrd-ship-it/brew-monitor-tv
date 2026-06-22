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

  // === Adaptive PI-term ===
  const deltaBucket = 'low'

  // ── Parallel pre-fetch: PID state + steady-state duty floor ──
  // For ramps, controller-adjustments.ts passes the ramp end-target so the
  // floor lookup stays anchored to a single bucket throughout the ramp
  // instead of fragmenting across every bucket the live target crosses.
  const ssBucket = getTempBucket(floorLookupTarget ?? actualTarget)
  const phaseSuffix = phaseBucket ? `:${phaseBucket}` : ''
  const phaseKeyedName = `steady_state_duty:${mode}:${ssBucket}${phaseSuffix}`
  const modeKeyedName = `steady_state_duty:${mode}:${ssBucket}`
  const [{ data: learnedRow }, phaseParam, modeParam, warmingParam, coolingRateParam] = await Promise.all([
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
    mode === 'cooling'
      ? getLearnedParam(supabase, controllerId, `warming_rate:${ssBucket}`, 0)
      : Promise.resolve({ value: 0, sampleCount: 0 } as { value: number; sampleCount: number }),
    mode === 'cooling'
      ? getLearnedParam(supabase, controllerId, 'thermal_rate_cooling', 0)
      : Promise.resolve({ value: 0, sampleCount: 0 } as { value: number; sampleCount: number }),
  ])

  // Resolve floor with fallback chain:
  //   1. phase-keyed (mode + bucket + fermentation phase) — preferred when available
  //   2. mode-keyed  (mode + bucket)                       — existing behaviour
  //   3. legacy      (bucket only, cooling-only)           — pre-mode-split data
  let ssParamResolved: { value: number; sampleCount: number }
  let floorSource = 'phase'
  if (phaseBucket && phaseParam.sampleCount >= 3) {
    ssParamResolved = phaseParam
    floorSource = `phase:${phaseBucket}`
  } else if (modeParam.sampleCount > 0) {
    ssParamResolved = modeParam
    floorSource = 'mode'
  } else {
    ssParamResolved = modeParam
    floorSource = 'mode-empty'
  }
  if (ssParamResolved.sampleCount === 0) {
    const legacyParam = await getLearnedParam(supabase, controllerId, `steady_state_duty:${ssBucket}`, 0)
    if (legacyParam.sampleCount >= 5 && mode === 'cooling') {
      ssParamResolved = legacyParam
      floorSource = 'legacy'
      console.log(`🔄 ssFloor migration ${controllerName}: using legacy steady_state_duty:${ssBucket} = ${legacyParam.value.toFixed(3)} (${legacyParam.sampleCount} samples)`)
    }
  }
  // Inherit mode-keyed as seed if we have a phase bucket but no phase data yet —
  // gives the new phase floor a sensible starting point instead of 0.
  if (phaseBucket && phaseParam.sampleCount < 3 && modeParam.sampleCount >= 5) {
    ssParamResolved = modeParam
    floorSource = `mode-seed→${phaseBucket}`
  }

  // Write-key: where erosion/seeding writes go. Phase-keyed when we have phase
  // context, otherwise the existing mode-keyed key (preserves prior behaviour).
  const floorWriteKey = phaseBucket ? phaseKeyedName : modeKeyedName

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
  // Hold-steg med trög termisk massa: dämpa P+I så integralen inte pinnar mot
  // taket och garanterar undershoot. Ramper/wait-steg behåller snabbare gain.
  const isHold = stepType === 'hold'
  const DUTY_P = isHold ? 0.35 : 0.5
  const DUTY_I = isHold ? 0.06 : 0.15
  const DUTY_DECAY = isHold ? 0.95 : 0.98
  const DUTY_IMAX = isHold ? 0.60 : 0.95
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

  // ── Mode-flip integral cap ──────────────────────────────
  // When mode just flipped, the persisted integral comes from the new mode's
  // last run (possibly a ramp with I≈0.64). Inheriting that wholesale slams
  // the new mode with 60%+ duty immediately and causes oscillation. Cap the
  // inherited integral to max(ssFloor, 0.25) so the controller starts firm
  // but not violent; P+I can climb from there.
  if (modeJustSwitched && integral > 0.25) {
    const ssFloorRawEarly = ssParamResolved.sampleCount >= 5 ? ssParamResolved.value : 0
    const cap = Math.max(ssFloorRawEarly, 0.25)
    if (integral > cap) {
      const before = integral
      integral = cap
      constraints.push(`mode-flip-cap=${(cap * 100).toFixed(0)}%`)
      console.log(`🛑 ${controllerName}: mode-flip integral cap I ${before.toFixed(3)} → ${cap.toFixed(3)} (avoid inherited overshoot)`)
    }
  }

  // ── Soft-start after mode switch when near target ──
  // When the system just flipped mode (e.g. heating → cooling) and we're
  // already close to the setpoint, don't blast full P+I from the inherited
  // floor. Instead reset the integral and cap actuation so the new mode's
  // effect can be observed before more energy is committed. If we're far
  // from target the regular path runs (need to actually act).
  //
  // IMPORTANT: only soft-start when we're on the COASTING side of setpoint
  // (need ≤ 0). If we just switched modes BECAUSE we're on the action-needed
  // side (e.g. heating overshot → temp is over target → cooling kicks in and
  // we still need to cool), nuking the integral makes the new mode crawl up
  // from 0% while temp keeps drifting further from target. That was the
  // root cause of multi-hour +0.5–0.75° excursions on Gul.
  const SOFT_START_NEAR_TARGET = 0.5
  const softStartActive = !!modeJustSwitched
    && Math.abs(avgError) < SOFT_START_NEAR_TARGET
    && need <= 0  // only mjukstart when already past setpoint (coasting in)
  if (softStartActive) {
    integral = 0
    constraints.push('mode-switch-softstart')
    console.log(`🌱 ${controllerName}: mode-switch soft-start (err=${avgError.toFixed(2)}°) — I→0, capping duty for observation`)
  }
  const warmSeedActive = !!modeJustSwitched
    && Math.abs(avgError) < SOFT_START_NEAR_TARGET
    && need > 0

  // ── Steady-state duty floor ──────────────────────────────
  const ssFloorRaw = ssParamResolved.sampleCount >= 5 ? ssParamResolved.value : 0
  const ssFloorSamples = ssParamResolved.sampleCount

  // Mode-switch warm-seed: when we just switched modes and we're already on
  // the action-needed side of setpoint, seed integral with a sensible base so
  // we don't crawl from 0%. Floor if mature, else conservative 8% so P+I
  // lands near a reasonable starting duty within 1-2 cycles.
  if (warmSeedActive) {
    const seed = ssFloorSamples >= 5 && ssFloorRaw > 0 ? ssFloorRaw : 0.08
    if (integral < seed) {
      integral = seed
      constraints.push('mode-switch-warmseed')
      console.log(`🌶️ ${controllerName}: mode-switch warm-seed (err=${avgError.toFixed(2)}°, need=${need.toFixed(2)}°) — I→${seed.toFixed(3)} för snabb respons`)
    }
  }

  // ── Margin-aware floor scaling (cooling only) ──
  // Skala ssFloor-utdata bidirektionellt baserat på faktisk glykolmarginal vs lärd referens.
  // Större faktisk marginal (kallare glykol) = mer kyleffekt per duty-% → skala NED.
  // Mindre faktisk marginal (varmare glykol)  = mindre kyleffekt per duty-% → skala UPP.
  // Asymmetriskt fönster (0.6×–1.8×): överkylning är farligare än underkylning, men
  // nedskalning aktiv så att vi inte överkyler när kylvattnet är kallare än lärt.
  // Vi rör inte ssFloorRaw i DB — endast utskickad duty-cykel påverkas, så lärningen
  // av baslinjen är opåverkad.
  let deadbandGainScale = 1.0
  if (isCooling && coolerMarginContext && coolerMarginContext.learnedMargin > 0) {
    const actualMargin = actualTemp - coolerMarginContext.coolerTemp
    if (actualMargin > 0.5) {
      deadbandGainScale = Math.max(0.6, Math.min(1.8, coolerMarginContext.learnedMargin / actualMargin))
    }
  }
  const ssFloor = ssFloorRaw > 0 ? ssFloorRaw * deadbandGainScale : 0

  // ── HOLD-DRIFT MICRO-ACTUATION ───────────────────────────
  // I `hold`-steg: om temperaturen driver mot fel sida med >0.03°/cykel
  // (~15 min) medan vi fortfarande är nära target, kicka upp integral till
  // en liten "mikro-duty" (60% av lärt floor, eller 8% om okänt) innan err
  // hinner gå utanför deadbanden. Förhindrar 0% → hård reaktion-pendel.
  const HOLD_DRIFT_THRESHOLD = 0.03
  const prevNeedHold = isCooling ? -prevAvgError : prevAvgError
  const needDrift = need - prevNeedHold
  if (
    stepType === 'hold'
    && Math.abs(avgError) <= 0.15
    && needDrift > HOLD_DRIFT_THRESHOLD
    && need > -0.10
  ) {
    const baseDuty = ssFloor > 0 ? ssFloor : 0.08
    const microDuty = baseDuty * 0.60
    if (integral < microDuty) {
      integral = microDuty
      constraints.push(`hold-drift-micro=${Math.round(needDrift * 1000)}m°/cyc`)
      console.log(`💧 ${modeLabel} hold-drift micro ${controllerName}: drift=${needDrift.toFixed(3)}°/cyc, err=${avgError.toFixed(2)}°, I→${integral.toFixed(3)} (base=${baseDuty.toFixed(3)})`)
    }
  }

  if (Math.abs(avgError) <= 0.10) {
    const shouldCoastInDeadband = stepType !== 'hold'
    // DEADBAND — single-sided behaviour:
    //   • If we're on the "past-target" side (need < 0), COAST (duty 0)
    //     and let thermal inertia recover naturally instead of holding a
    //     counter-floor that fights the overshoot.
    //   • If we're still on the "needs-action" side (need >= 0), converge
    //     toward ssFloor as before so the mode keeps holding without slip.
    if (need < -0.02 && shouldCoastInDeadband) {
      // Coast: bleed integral down quickly, output 0%
      integral *= 0.70
      dutyCycle = 0
      constraints.push('deadband-coast')

      // COOL-SOFT (mirror of warm-soft) — if ssFloor is mature (≥5 samples)
      // and we keep ending up on the past-target side inside the deadband,
      // the learned floor is biased too high (over-actuating). Gently erode
      // it toward 95% of its current value via EMA so the next deadband
      // cycle holds slightly less duty and centers closer to setpoint.
      // Only apply when clearly past target (need ≤ -0.05) to avoid eroding
      // on borderline noise.
      if (ssFloorRaw > 0 && ssFloorSamples >= 5 && need <= -0.05) {
        const softAlpha = 0.10
        const target = ssFloorRaw * 0.95
        const eroded = ssFloorRaw * (1 - softAlpha) + target * softAlpha
        const quantized = Math.round(eroded * 1000) / 1000
        if (quantized < ssFloorRaw) {
          await updateLearnedParam(supabase, controllerId, floorWriteKey, quantized, 0, 1.0, 1.0)
          constraints.push('cool-soft')
          console.log(`🌊 ${modeLabel} cool-soft erosion ${controllerName} [${floorSource}]: floor ${ssFloorRaw.toFixed(3)} → ${quantized.toFixed(3)} (err=${avgError.toFixed(2)}°, past target)`)
        }
      }

      console.log(`🌬️ ${modeLabel} deadband-coast ${controllerName}: err=${avgError.toFixed(2)}° (past target), I→${integral.toFixed(3)}, duty=0% (single-sided hold)`)
    } else if (ssFloor > 0) {
      // ASYMMETRIC STEADY-STATE TRIM — when temp is persistently on the
      // "wrong" side of setpoint inside the deadband (warm-side for cooling,
      // cool-side for heating), allow integral to build slightly ABOVE
      // ssFloor instead of dragging it back down. This closes the residual
      // 0.1–0.2° offset that ssFloor alone can't resolve (floor = duty that
      // *holds* current temp, not duty that *reaches* setpoint).
      // Cap trim per cycle so we can't overshoot the other way.
      const wrongSide = isCooling ? avgError > 0.02 : avgError < -0.02
      if (wrongSide) {
        // +0.3% to +1.0% duty per cycle, scaled by remaining error.
        const trim = Math.max(0.003, Math.min(0.010, Math.abs(avgError) * 0.05))
        const base = Math.max(integral, ssFloor)
        integral = Math.min(ssFloor + 0.15, base + trim)  // hard cap +15% above floor
        constraints.push('deadband-trim')
      } else if (integral > ssFloor) {
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
      // SATURATION EROSION — if floor is near the duty ceiling (≥85%), the
      // learned floor is biased too high and produces 100/0 on/off pendling
      // instead of a stable mid-duty. Probe down 5%/cycle whenever we're
      // holding inside deadband; if the new floor is still too low, normal
      // ssFloor learning will push it back up.
      if (ssFloorRaw >= 0.85 && ssFloorSamples >= 5) {
        const probeAlpha = 0.05
        const eroded = ssFloorRaw * (1 - probeAlpha)
        const quantized = Math.round(eroded * 1000) / 1000
        if (quantized < ssFloorRaw) {
          await updateLearnedParam(supabase, controllerId, floorWriteKey, quantized, 0, 1.0, 1.0)
          constraints.push('saturation-erosion')
          console.log(`🪫 ${modeLabel} saturation-erosion ${controllerName} [${floorSource}]: floor ${ssFloorRaw.toFixed(3)} → ${quantized.toFixed(3)} (probing down from ceiling)`)
        }
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

      // PROBE-KICK — when no floor exists AND we're on the action-needed side
      // of setpoint inside deadband, seed a small duty so the system actually
      // actuates and ssFloor learning can start collecting samples. Without
      // this we sit at 0% forever (integral=0 → duty=0 → no learning → no duty).
      // Use `need` as the sign source here; it is already normalized so
      // positive always means "this mode needs to act now" for both cooling
      // and heating.
      const actionNeededInDeadband = need > 0.02
      if (stepType === 'hold' && actionNeededInDeadband) {
        const PROBE_DUTY = 0.06 // 6% — small enough to be safe, large enough to learn
        integral = Math.max(integral, PROBE_DUTY)
        constraints.push('deadband-no-floor-probe')
      } else {
        constraints.push('deadband-no-floor')
      }
      dutyCycle = Math.max(0, integral)
      console.log(`✅ ${modeLabel} deadband-no-floor ${controllerName}: err=${avgError.toFixed(2)}°, I=${integral.toFixed(3)}, duty=${(dutyCycle * 100).toFixed(0)}%`)
    }
  } else if (need < -0.10 && need >= -0.25) {
    if (stepType === 'hold' && ssFloor > 0) {
      const holdTarget = ssFloor * 0.70
      const holdAlpha = 0.15
      integral = integral * (1 - holdAlpha) + holdTarget * holdAlpha
      dutyCycle = Math.min(1.0, Math.max(0, integral))
      if (deadbandGainScale !== 1.0) constraints.push(`margin-scale=${deadbandGainScale.toFixed(2)}`)
      constraints.push('target-hold')
      console.log(`🔹 ${modeLabel} target-hold ${controllerName}: err=${avgError.toFixed(2)}°, need=${need.toFixed(2)}°, I=${integral.toFixed(3)}, holdTarget=${holdTarget.toFixed(3)}, floor=${ssFloor.toFixed(3)}, duty=${(dutyCycle * 100).toFixed(0)}%`)
    } else {
      // SINGLE-SIDED COAST — past setpoint in mode direction.
      // For non-hold steps we let thermal inertia recover naturally.
      // For hold steps with a known floor we kiss at 30% of floor to
      // catch the recovery before undershooting (see pre-emptive-catch).
      integral *= 0.80
      dutyCycle = 0
      constraints.push('coast-overshoot')
      console.log(`🌬️ ${modeLabel} coast ${controllerName}: err=${avgError.toFixed(2)}°, need=${need.toFixed(2)}°, I→${integral.toFixed(3)}, duty=0% (single-sided hold, passive recovery)`)
    }
  } else if (need < -0.25) {
    // OVER-ACTUATED — aggressive erosion + coast (no actuation)
    const overshoot = Math.abs(need)

    if (ssFloorRaw > 0) {
      const erosionAlpha = Math.min(0.6, 0.3 + overshoot)
      const reducedFloor = Math.max(0, integral * erosionAlpha + ssFloorRaw * (1 - erosionAlpha))
      const quantizedFloor = Math.floor(reducedFloor * 10) / 10
      if (quantizedFloor < ssFloorRaw) {
        await updateLearnedParam(supabase, controllerId, floorWriteKey, quantizedFloor, 0, 1.0, 1.0)
        console.log(`📉 ${modeLabel} floor erosion ${controllerName} [${floorSource}]: ${ssFloorRaw.toFixed(2)} → ${quantizedFloor.toFixed(2)} (overshoot=${overshoot.toFixed(2)}°)`)
      }
    }

    const decayRate = Math.min(0.85, 0.75 - overshoot * 0.1)
    integral = Math.max(0, integral * decayRate)
    // Pre-emptive catch: during a hold step with an established floor, apply
    // 30% of ssFloor while still overshot so the same-mode actuator gently
    // "catches" the glide back toward target. Prevents the recovery from
    // undershooting and forcing the opposite mode to spin up. Non-hold steps
    // (ramps) still force coast=0 to avoid fighting the ramp trajectory.
    if (stepType === 'hold' && ssFloorRaw > 0) {
      dutyCycle = Math.min(1.0, ssFloorRaw * 0.30)
      constraints.push(isCooling ? 'overcooled' : 'overheated')
      constraints.push('catch-30pct')
      console.log(`🪢 ${modeLabel} catch ${controllerName}: overshoot=${overshoot.toFixed(2)}°, applying 30% of floor (${ssFloorRaw.toFixed(2)}) → duty=${(dutyCycle * 100).toFixed(0)}% (pre-emptive catch)`)
    } else {
      dutyCycle = 0
      constraints.push(isCooling ? 'overcooled' : 'overheated')
      constraints.push('coast-overshoot')
      console.log(`${isCooling ? '❄️' : '🔥'} ${modeLabel} ${isCooling ? 'overcooled' : 'overheated'} (coast) ${controllerName}: err=${avgError.toFixed(2)}°, overshoot=${overshoot.toFixed(2)}°, I→${integral.toFixed(3)}, floor=${ssFloor.toFixed(3)}, duty=0% (passive recovery)`)
    }
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
      // Stale-data: telemetrin är några minuter gammal men inte värdelös.
      // Skala ned P till 50% istället för att nolla den — annars förlorar vi
      // bromskraften precis när vi närmar oss/passerar target. Integralen
      // hålls fortfarande (ingen ackumulering) för att undvika windup.
      const STALE_P_SCALE = 0.5
      pCorrection = need * DUTY_P * STALE_P_SCALE
      constraints.push(`stale-p×${STALE_P_SCALE}`)
      console.log(`⏸️ ${modeLabel} stale ${controllerName}: P=${pCorrection.toFixed(3)} (×${STALE_P_SCALE} of fresh), holding I=${integral.toFixed(3)}`)
    } else {
      pCorrection = need * DUTY_P
      integral = integral * DUTY_DECAY + need * DUTY_I
      integral = Math.max(0, Math.min(DUTY_IMAX, integral))

      // ── Braking zone ──
      // Only brake when error is DECREASING (approaching setpoint).
      // If error is growing, the system needs to ramp up, not slow down.
      // Heating has more thermal inertia (heater → fluid → fermenter → probe)
      // so we start braking earlier (1.0°C) to allow more deceleration cycles.
      const BRAKE_ZONE_STATIC = isCooling ? 0.50 : 1.00
      // Predictive expansion: if temp is moving fast toward setpoint, brake
      // earlier so the next 15-min cycle doesn't blow past target. CYCLE_HOURS=0.25
      // är PID-cykellängd (worst-case mellan körningar). BLE-länkade controllers
      // har 1-min färsk data och event-driven trigger → sänk safety-factor från
      // 2.0× (RAPT-jitter-buffert) till 1.5× för mindre överbroms.
      const CYCLE_HOURS = 0.25
      const bleFresh = !isStaleData && !isInterpolated && pillRate != null
      // SAFETY = how many PID-cycles ahead we predict. BLE-fresh gets longer
      // lead (≈37 min @ 2.5×) because we have a confirmed real-time rate and
      // thermal lag means actions need to start well before crossing target.
      const SAFETY = bleFresh ? 2.5 : 2.0
      const ratePrediction = pillRate != null ? Math.abs(pillRate) * CYCLE_HOURS * SAFETY : 0
      // Predictive handbrake: when fast approach (>1.5°/h toward target) lets
      // the brake zone grow up to 1.5° instead of being capped by the static
      // floor — so brake kicks in 30+ min before overshoot during ramps.
      const FAST_APPROACH = bleFresh && Math.abs(pillRate ?? 0) > 1.5
      const BRAKE_ZONE_MAX = FAST_APPROACH ? 1.5 : Number.POSITIVE_INFINITY
      const BRAKE_ZONE = Math.min(BRAKE_ZONE_MAX, Math.max(BRAKE_ZONE_STATIC, ratePrediction))
      const prevNeed = isCooling ? -prevAvgError : prevAvgError // previous "need" in same sign convention
      const errorDecreasing = need < prevNeed - 0.03 // only brake when error is clearly shrinking
      // Pill-confirmed approach: pillRate is from an independent sensor and is NOT
      // affected by controller-probe staleness. In cooling mode, pillRate<-0.05°C/h
      // means temp is actually falling; in heating mode pillRate>+0.05°C/h means
      // it is actually rising. When that direction matches "approaching setpoint"
      // we trust the pill enough to brake even when the probe value is interpolated.
      const pillConfirmsApproach = pillRate != null && (
        (isCooling && pillRate < -0.05) || (!isCooling && pillRate > 0.05)
      )
      const canBrake = errorDecreasing && (!isInterpolated || pillConfirmsApproach)
      if (need < BRAKE_ZONE && canBrake) {
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
          const brakeTag = FAST_APPROACH ? 'pred-brake' : 'brake'
          constraints.push(`${brakeTag}=${(proximity * 100).toFixed(0)}%${isInterpolated ? '-pill' : ''}`)
          console.log(`🛑 ${modeLabel} braking ${controllerName}: need=${need.toFixed(2)}°, proximity=${proximity.toFixed(2)}, I ${integral.toFixed(3)} → ${blendedI.toFixed(3)} (floor=${ssFloor.toFixed(3)})`)
          integral = blendedI
        }
      } else if (need < BRAKE_ZONE && !errorDecreasing) {
        constraints.push('brake-skip')
        console.log(`⏩ ${modeLabel} brake skipped ${controllerName}: error growing (prev=${Math.abs(prevAvgError).toFixed(2)}° → now=${need.toFixed(2)}°), letting I build`)
      } else if (need < BRAKE_ZONE && isInterpolated && !pillConfirmsApproach) {
        constraints.push('brake-interp-skip')
        console.log(`⏩ ${modeLabel} brake skipped (interpolated, pill ej bekräftar) ${controllerName}: need=${need.toFixed(2)}°, pillRate=${pillRate}`)
      }

      // ── Predictive ramp-end brake ──
      // X min före rampslut: blenda integral mot lärd hold-I för slutbucketen
      // så vi minskar duty proaktivt istället för att förlita oss på reaktiv
      // wind-up-release efter att rampen passerat target.
      const LEAD_MIN = 20
      const learnedHoldI = rampContext?.learnedHoldI
      const etaMin = rampContext?.etaMin
      if (etaMin != null && etaMin <= LEAD_MIN && learnedHoldI != null && learnedHoldI > 0.05 && learnedHoldI < integral) {
        const proximity = 1 - Math.max(0, Math.min(1, etaMin / LEAD_MIN))
        const blendedI = integral * (1 - proximity) + learnedHoldI * proximity
        if (blendedI < integral) {
          constraints.push(`ramp-pred-brake=${Math.round(proximity * 100)}%`)
          console.log(`🛑 ${modeLabel} ramp-pred-brake ${controllerName}: eta=${etaMin.toFixed(1)}min, proximity=${proximity.toFixed(2)}, I ${integral.toFixed(3)} → ${blendedI.toFixed(3)} (holdI=${learnedHoldI.toFixed(3)})`)
          integral = blendedI
        }
      }

      // ── Fallback ramp-end brake (proximity by degrees, no ETA needed) ──
      // When pillRate is too noisy/zero, etaMin is null and the predictive brake
      // above never triggers. Use absolute distance-to-target instead: within
      // 0.30°C of the ramp target on the approach side, blend integral toward
      // learned hold-I proportional to closeness. This prevents 50–70% duty at
      // <0.2°C from target during ramp finish.
      const BRAKE_DEG_ZONE = 0.30
      if (
        rampContext &&
        (etaMin == null) &&
        learnedHoldI != null && learnedHoldI > 0.05 && learnedHoldI < integral &&
        need > -0.10 && need < BRAKE_DEG_ZONE
      ) {
        const proximity = 1 - Math.max(0, need) / BRAKE_DEG_ZONE
        const blendedI = integral * (1 - proximity) + learnedHoldI * proximity
        if (blendedI < integral) {
          constraints.push(`ramp-deg-brake=${Math.round(proximity * 100)}%`)
          console.log(`🛑 ${modeLabel} ramp-deg-brake ${controllerName}: need=${need.toFixed(2)}° (no ETA), proximity=${proximity.toFixed(2)}, I ${integral.toFixed(3)} → ${blendedI.toFixed(3)} (holdI=${learnedHoldI.toFixed(3)})`)
          integral = blendedI
        }
      }

      // ── Settling guard (cooling only) ──
      if (isCooling && integral < 0.15 && need > 0.3) {
        // Scale cap with error magnitude — large overshoots need real action,
        // not a 30% throttle that lets the brew drift for hours.
        // need 0.3°C → 0.30 cap (unchanged)
        // need 0.5°C → 0.50 cap
        // need ≥0.7°C → 0.70 cap (hard ceiling, still respects saturation)
        const maxInitialP = Math.min(0.70, Math.max(0.30, 0.30 + (need - 0.3) * 1.0))
        if (pCorrection > maxInitialP) {
          const uncappedP = pCorrection
          pCorrection = maxInitialP
          constraints.push('settling')
          console.log(`🛡️ Settling guard ${controllerName}: I=${integral.toFixed(3)} < 0.15, need=${need.toFixed(2)}°, capping P ${uncappedP.toFixed(2)} → ${maxInitialP.toFixed(2)} (väntar på feedback)`)
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

    // ── Low-error duty cap (no learned floor) ──
    // When ssFloor is unknown/zero and we are still near setpoint (need ≤ 0.5°C),
    // cap duty at 30% so a single cycle can't blow past target. Prevents the
    // "0% → 58% → undershoot to -0.4°C" oscillation seen on tanks where
    // historical hold-duty has averaged to zero but real bursts are large.
    if (stepType === 'hold' && ssFloorRaw === 0 && !isSaturated && need <= 0.5 && raw > 0.30) {
      const uncapped = raw
      raw = 0.30
      constraints.push('lowerr-cap')
      console.log(`🧯 ${modeLabel} low-error cap ${controllerName}: need=${need.toFixed(2)}°, no ssFloor → duty ${(uncapped*100).toFixed(0)}% → 30%`)
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

  // ── Physics-derived hold floor — DISABLED 2026-06-18 ──────────
  // Drove Gul into undershoot → mode flip to heating (hardware target
  // jumped to max_target_temp). 0.7× factor was still too aggressive;
  // gate (`need >= -0.05`) allowed forcing duty even when already at target.
  // Reverted to integral-only learning; ±0.1°C swing accepted.
  void warmingParam; void coolingRateParam;

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
