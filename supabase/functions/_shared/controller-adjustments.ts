import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { round1, TempController, setControllerTargetTemp, calculateCompensatedTarget, RaptUpdateBatch } from './temp-utils.ts'
import { computeDualSensorTarget } from './dual-sensor.ts'
import { logAdjustment, AdjustmentResult } from './adjustment-logger.ts'
import { calculateSingleUtilization } from './cooler-management.ts'
import { getTempBucket, getLearnedParam, updateLearnedParam } from './learning-utils.ts'

// ============================================================
// Controller Adjustments — Pipeline Architecture
//
// SSOT: profile_target_temp is the user's desired temperature.
//       target_temp is what gets sent to the hardware.
//
// Pipeline:
//   1. Bootstrap — ensure profile_target_temp is set for all controllers
//   2. Processors — each can modify the desired target (pill-comp, future...)
//   3. Stall detection — separate concern, acts on resolved targets
//
// Removing/disabling any processor is safe:
//   target_temp will always converge to profile_target_temp.
// Adding a new processor:
//   Return adjustments for modified controllers; untouched ones pass through.
// ============================================================

/** PWM burst descriptor — kept for type reference in logs */
export interface PwmBurst {
  controller_id: string
  controller_name: string
  on_target: number
  off_target: number
  duty_seconds: number
  duty_pct: number
  mode?: 'cooling' | 'heating'
}

export interface ControllerAdjustmentContext {
  supabase: any
  supabaseUrl: string
  serviceRoleKey: string
  followedControllersFullData: TempController[]
  profileOwnedControllerIds: Set<string>
  profileTargetMap: Map<string, number>
  sessionBrewIdMap: Map<string, string>
  cooloffControllerIds: Set<string>
  profileStatusMap: Map<string, { profileTarget: number | null; stepIndex: number; hasCooloff: boolean; activeTarget?: number | null; currentStepType?: string; rampDirection?: 'heating' | 'cooling' | null }>
  lastAdjTimestampMap: Map<string, string>
  log: (step: string, result: 'pass' | 'fail' | 'info' | 'action', message: string, details?: Record<string, unknown>) => void
  updateBatch?: RaptUpdateBatch
  pwmBursts: PwmBurst[]
  /** Populated by PID: maps controller_id → actualTarget (profile target).
   *  Used by cooler to plan against a stable target, not the PID-fluctuating target_temp. */
  baseTargetMap: Map<string, number>
  /** When true, skip all learning (EMA updates) — system is in idle mode */
  skipLearning?: boolean
  /** Populated by PID: maps controller_id → pre-calculated UtilizationResult.
   *  Shared with cooler to avoid duplicate DB queries. */
  sharedUtilizations: Map<string, import('./cooler-management.ts').UtilizationResult>
  /** Cooler context for margin-aware PID gain scaling */
  coolerMarginContext?: { coolerTemp: number; learnedMargin: number } | null
}

/**
 * Run all controller-level adjustments via the pipeline.
 * Returns adjustment results and mutates followedControllersFullData in-memory
 * so downstream consumers (cooler) see updated targets.
 */
export async function runControllerAdjustments(ctx: ControllerAdjustmentContext): Promise<AdjustmentResult[]> {
  const adjustments: AdjustmentResult[] = []

  // ── Step 1: Bootstrap profile_target_temp ──────────────────
  await bootstrapProfileTargets(ctx)

  // ── Step 2: Run processors (each is independently toggleable) ─
  // Note: in-memory target sync happens inside runProcessors after each processor
  const processorAdjs = await runProcessors(ctx)
  adjustments.push(...processorAdjs)

  return adjustments
}

// ─── Bootstrap ───────────────────────────────────────────────

async function bootstrapProfileTargets(ctx: ControllerAdjustmentContext): Promise<void> {
  const { supabase, followedControllersFullData, profileOwnedControllerIds, log } = ctx

  for (const fc of followedControllersFullData) {
    if ((fc as any).profile_target_temp != null) continue
    if (!fc.heating_enabled && !fc.cooling_enabled) continue

    // SAFETY: Only bootstrap profile_target_temp for controllers with an active
    // fermentation session. Without a session, there is no authoritative source
    // for the profile target, and using target_temp would capture the PID-adjusted
    // value instead of the user's intended temperature.
    if (!profileOwnedControllerIds.has(fc.controller_id)) {
      log('BOOTSTRAP', 'info', `${fc.name}: profile_target_temp is null but no active session — using target_temp as read-only fallback`)
      ;(fc as any).profile_target_temp = parseFloat(String(fc.target_temp ?? '20'))
      // Do NOT write to DB — let the user or a session set it explicitly
      continue
    }

    const targetTemp = parseFloat(String(fc.target_temp ?? '20'))
    log('BOOTSTRAP', 'info', `${fc.name}: Setting profile_target_temp = ${targetTemp}°C from target_temp (has active session)`)
    
    await supabase
      .from('rapt_temp_controllers')
      .update({ profile_target_temp: targetTemp, updated_at: new Date().toISOString() })
      .eq('controller_id', fc.controller_id)
    
    // Update in-memory so processors see it immediately
    ;(fc as any).profile_target_temp = targetTemp
  }
}

// ─── Processor Pipeline ──────────────────────────────────────

async function runProcessors(ctx: ControllerAdjustmentContext): Promise<AdjustmentResult[]> {
  const adjustments: AdjustmentResult[] = []

  const processors = [
    runPidControl,
  ]

  for (const processor of processors) {
    const adjs = await processor(ctx)
    adjustments.push(...adjs)

    for (const adj of adjs) {
      const fc = ctx.followedControllersFullData.find(c => c.name === adj.cooler)
      if (fc) {
        (fc as any).target_temp = adj.newTarget
      }
    }
  }

  return adjustments
}

// ─── Unified PWM Execution ──────────────────────────────────
// Shared logic for both cooling and heating PWM duty cycle execution.
// Differences are parameterized: ON target, revert direction, suppress logic.

async function executePwmDutyCycle(
  ctx: ControllerAdjustmentContext,
  fc: TempController,
  mode: 'cooling' | 'heating',
  dutyRaw: number,
  pidEffectiveTarget: number,
  actualTemp: number,
  actualTarget: number,
  ctrlTarget: number,
  rampOverrideApplied: boolean,
  adjustments: AdjustmentResult[],
): Promise<void> {
  const { supabase, log } = ctx

  // SAFETY GUARD: Prevent cooling commands on heating-only controllers and vice versa
  const isEnabled = mode === 'cooling' ? fc.cooling_enabled : fc.heating_enabled
  if (!isEnabled) {
    log('DUTY_SKIP', 'info', `${fc.name}: ${mode} not enabled, skipping duty cycle`)
    return
  }
  // Double-check: block extreme targets that contradict the controller's capabilities
  if (mode === 'cooling' && !fc.cooling_enabled) {
    log('MODE_GUARD', 'fail', `🚨 ${fc.name}: attempted cooling burst but cooling_enabled=false — BLOCKED`)
    return
  }
  if (mode === 'heating' && !fc.heating_enabled) {
    log('MODE_GUARD', 'fail', `🚨 ${fc.name}: attempted heating burst but heating_enabled=false — BLOCKED`)
    return
  }

  // 2-cycle model with dithering: achieves sub-10% effective duty over time.
  // E.g. dutyRaw=0.23 → alternates between 20% and 30% (30% used 3/10 cycles).
  const dutyLow = Math.floor(dutyRaw * 10) * 10   // e.g. 20
  const dutyHigh = Math.ceil(dutyRaw * 10) * 10    // e.g. 30
  const fraction = dutyRaw * 100 - dutyLow          // e.g. 3.0 (how many tenths toward high)
  // 10-slot dithering: over 50 min (10×5-min cycles), use high step for 'fraction' slots
  const ditherSlot = Math.floor(Date.now() / 300000) % 10
  const dutyPct = ditherSlot < Math.round(fraction) ? dutyHigh : dutyLow
  const totalBurstMin = dutyPct / 10
  const phase = Math.floor(Date.now() / 300000) % 2
  const currentBurstMin = phase === 0 ? Math.ceil(totalBurstMin / 2) : Math.floor(totalBurstMin / 2)
  let burstSeconds = currentBurstMin * 60

  // LOW-DUTY CONSOLIDATION: at ≤10% duty, the standard 60s-every-10min pattern
  // makes the fermenter feel many micro-pulses without enough thermal effect
  // between them to evaluate. Consolidate to a single longer burst per 20 min
  // (4-cycle window). Average duty unchanged.
  //   10% → 120s every 20min instead of 60s every 10min (-50% burst count)
  if (dutyPct > 0 && dutyPct <= 10) {
    const lowPhase = Math.floor(Date.now() / 300000) % 4
    burstSeconds = lowPhase === 0 ? totalBurstMin * 60 * 2 : 0
  }

  const raptProbeTemp = fc.current_temp
  const minTemp = parseFloat(String(fc.min_target_temp ?? '-10'))
  const maxTemp = parseFloat(String(fc.max_target_temp ?? '25'))

  // ON target: hard-coded extremes to force the relay past hysteresis reliably.
  // Controller min/max bounds vary per fermenter and may not be aggressive enough.
  const onTarget = mode === 'cooling' ? -5 : 40

  // Revert target: suppress opposite action by setting hw target away from probe
  let revertTarget: number
  if (raptProbeTemp == null) {
    revertTarget = round1(pidEffectiveTarget)
    log('REVERT_NO_PROBE', 'fail', `${fc.name}: probe saknas, revert → ${revertTarget}° (neutral)`)
  } else if (mode === 'cooling') {
    // Suppress cooling → set hw target ABOVE probe
    revertTarget = round1(Math.min(raptProbeTemp + 2, maxTemp))
  } else {
    // Suppress heating → set hw target BELOW probe
    revertTarget = round1(Math.max(raptProbeTemp - 2, minTemp))
  }

  if (dutyPct >= 100) {
    // 100%: hold extreme target entire cycle (no revert needed)
    log('DUTY_FULL', 'action', `${fc.name}: ${mode} duty 100% → ${onTarget}°C hela cykeln`, { duty_pct: 100, mode })
    if (ctx.updateBatch) {
      ctx.updateBatch.addHardwareOnly(fc.controller_id, onTarget, revertTarget)
    } else {
      await setControllerTargetTemp(ctx.supabaseUrl, ctx.serviceRoleKey, fc.controller_id, onTarget)
    }
    // CRITICAL: Keep DB target_temp at onTarget (matching actual hardware state).
    await Promise.all([
      supabase.from('pending_rapt_retries')
        .delete().eq('controller_id', fc.controller_id).like('reason', '%PWM OFF%'),
      supabase.from('rapt_temp_controllers')
        .update({ target_temp: onTarget, updated_at: new Date().toISOString() })
        .eq('controller_id', fc.controller_id),
    ])
    adjustments.push({ cooler: fc.name, oldTarget: ctrlTarget, newTarget: onTarget })
    ctx.pwmBursts.push({ controller_id: fc.controller_id, controller_name: fc.name, on_target: onTarget, off_target: revertTarget, duty_seconds: 300, duty_pct: 100, mode })
  } else if (burstSeconds > 0) {
    // 10-90%: burst at extreme, schedule revert to suppress target
    log('DUTY_BURST', 'action', `${fc.name}: ${mode} duty ${dutyPct}% (raw=${Math.round(dutyRaw * 100)}%, dither=${ditherSlot}/${Math.round(fraction)}) → ${burstSeconds}s burst at ${onTarget}° (revert=${revertTarget}°)`, {
      duty_pct: dutyPct, duty_raw: Math.round(dutyRaw * 100), dither_slot: ditherSlot, duty_seconds: burstSeconds, on_target: onTarget, off_target: revertTarget, mode,
    })
    if (ctx.updateBatch) {
      ctx.updateBatch.addHardwareOnly(fc.controller_id, onTarget, revertTarget)
    } else {
      await setControllerTargetTemp(ctx.supabaseUrl, ctx.serviceRoleKey, fc.controller_id, onTarget)
    }
    // CRITICAL: Keep DB target_temp at onTarget (matching actual hardware state).
    // Align to minute boundary so the 1-min cron picks it up precisely
    const minuteFloor = Math.floor(Date.now() / 60000) * 60000
    const executeAt = new Date(minuteFloor + burstSeconds * 1000).toISOString()
    await Promise.all([
      supabase.from('rapt_temp_controllers')
        .update({ target_temp: onTarget, updated_at: new Date().toISOString() })
        .eq('controller_id', fc.controller_id),
      supabase.from('pending_rapt_retries')
        .delete().eq('controller_id', fc.controller_id).like('reason', '%PWM OFF%')
        .then(() => supabase.from('pending_rapt_retries').insert({
          controller_id: fc.controller_id,
          target_temp: revertTarget,
          reason: `⚡ PWM OFF: hw → ${revertTarget}° (${burstSeconds}s burst, ${dutyPct}% duty, ${mode})`,
          execute_at: executeAt,
        })),
      // Reset P-term during burst (probe changes artificially from extreme target)
      supabase.from('controller_learned_compensation')
        .update({ latest_p_correction: 0, updated_at: new Date().toISOString() })
        .eq('controller_id', fc.controller_id)
        .eq('mode', mode),
    ])
    adjustments.push({ cooler: fc.name, oldTarget: ctrlTarget, newTarget: onTarget })
    ctx.pwmBursts.push({ controller_id: fc.controller_id, controller_name: fc.name, on_target: onTarget, off_target: revertTarget, duty_seconds: burstSeconds, duty_pct: dutyPct, mode })
  } else {
    // 0% or phase B idle
    if (dutyPct === 0) {
      log('DUTY_ZERO', 'info', `${fc.name}: ${mode} duty 0% — ingen ${mode === 'cooling' ? 'kylning' : 'uppvärmning'}`)

      // Heating-specific: suppress unwanted heating when actual > target but probe < hw target
      if (mode === 'heating') {
        const suppressThreshold = rampOverrideApplied ? 0.05 : 0.3
        if (raptProbeTemp != null && actualTemp > actualTarget + suppressThreshold && raptProbeTemp < ctrlTarget) {
          const suppressTarget = round1(Math.max(raptProbeTemp - 2, minTemp))
          log('DUTY_ZERO_SUPPRESS', 'action', `${fc.name}: actual ${round1(actualTemp)}° > mål ${round1(actualTarget)}° men probe ${round1(raptProbeTemp)}° < hw ${ctrlTarget}° → sänker hw till ${suppressTarget}° för att stoppa värme`)
          if (ctx.updateBatch) {
            ctx.updateBatch.add(fc.controller_id, suppressTarget, ctrlTarget)
          } else {
            await setControllerTargetTemp(ctx.supabaseUrl, ctx.serviceRoleKey, fc.controller_id, suppressTarget)
          }
          await supabase.from('rapt_temp_controllers')
            .update({ target_temp: suppressTarget, updated_at: new Date().toISOString() })
            .eq('controller_id', fc.controller_id)
          adjustments.push({ cooler: fc.name, oldTarget: ctrlTarget, newTarget: suppressTarget })
          return
        }
      }

      // Revert if hardware is stuck at a PWM extreme
      if (ctrlTarget <= minTemp + 0.1 || ctrlTarget >= maxTemp - 0.1) {
        // SAFETY: Flag if the extreme contradicts the controller's capabilities
        const stuckInCooling = ctrlTarget <= minTemp + 0.1 && !fc.cooling_enabled
        const stuckInHeating = ctrlTarget >= maxTemp - 0.1 && !fc.heating_enabled
        if (stuckInCooling || stuckInHeating) {
          log('MODE_GUARD_REVERT', 'fail', `🚨 ${fc.name}: hw fastnad vid ${ctrlTarget}° (${stuckInCooling ? 'kyla' : 'värme'}-extrem) men ${stuckInCooling ? 'cooling' : 'heating'}_enabled=false — reverterar omedelbart → ${revertTarget}°`)
        } else {
          log('DUTY_ZERO_REVERT', 'action', `${fc.name}: hw vid ${ctrlTarget}° (PWM-rest) → ${revertTarget}°`)
        }
        if (ctx.updateBatch) {
          ctx.updateBatch.add(fc.controller_id, revertTarget, ctrlTarget)
        } else {
          await setControllerTargetTemp(ctx.supabaseUrl, ctx.serviceRoleKey, fc.controller_id, revertTarget)
        }
        await supabase.from('rapt_temp_controllers')
          .update({ target_temp: revertTarget, updated_at: new Date().toISOString() })
          .eq('controller_id', fc.controller_id)
        adjustments.push({ cooler: fc.name, oldTarget: ctrlTarget, newTarget: revertTarget })
      } else {
        // HEARTBEAT REASSERT: every 3rd cycle (~15 min), re-send the intended
        // hw target even if unchanged. Protects against telemetry drift / silent
        // hw-state mismatches where RAPT shows a stale extreme value.
        const heartbeatSlot = Math.floor(Date.now() / 300000) % 3
        if (heartbeatSlot === 0 && Math.abs(ctrlTarget - revertTarget) > 0.05) {
          log('DUTY_ZERO_HEARTBEAT', 'action', `${fc.name}: heartbeat re-assert hw ${ctrlTarget}° → ${revertTarget}° (var 15:e min)`)
          if (ctx.updateBatch) {
            ctx.updateBatch.add(fc.controller_id, revertTarget, ctrlTarget)
          } else {
            await setControllerTargetTemp(ctx.supabaseUrl, ctx.serviceRoleKey, fc.controller_id, revertTarget)
          }
          await supabase.from('rapt_temp_controllers')
            .update({ target_temp: revertTarget, updated_at: new Date().toISOString() })
            .eq('controller_id', fc.controller_id)
          adjustments.push({ cooler: fc.name, oldTarget: ctrlTarget, newTarget: revertTarget })
        }
      }
    } else {
      log('DUTY_PHASE_B', 'info', `${fc.name}: ${mode} PWM ${dutyPct}% fas B — ingen burst denna cykel`, { duty_pct: dutyPct, mode })
    }
  }
}

// ─── PID Control (Processor) ─────────────────────────────────

async function runPidControl(ctx: ControllerAdjustmentContext): Promise<AdjustmentResult[]> {
  const {
    supabase, supabaseUrl, serviceRoleKey,
    followedControllersFullData, profileOwnedControllerIds,
    cooloffControllerIds, profileStatusMap, lastAdjTimestampMap,
    log,
  } = ctx
  const adjustments: AdjustmentResult[] = []

  log('PID_CONTROL', 'info', `PID control check (dual sensors: per-controller)`)

  // ── Pre-filter active controllers ──────────────────────────
  const activeControllers = followedControllersFullData.filter(fc =>
    !cooloffControllerIds.has(fc.controller_id) &&
    (fc.heating_enabled || fc.cooling_enabled)
  )

  if (activeControllers.length === 0) return adjustments

  // ── Parallel pre-fetch: fermentation_learnings + utilization ──
  // Batch-fetch ALL PID state params for all active controllers in ONE query.
  // This replaces N sequential queries (one per controller) with a single query.
  const activeControllerIds = activeControllers.map(fc => fc.controller_id)

  // Collect all possible parameter names (including all temp bucket variants)
  const TEMP_BUCKETS = ['cold', 'cool', 'warm', 'hot']
  const BASE_PARAMS = [
    'mode_switch_pressure', 'mode_last_probe', 'pid_current_mode',
    'pid_last_duty', 'mode_last_step_index', 'pid_effective_target',
    'thermal_rate_heating', 'thermal_rate_cooling',
    'est_prev_actual_temp', 'est_prev_actual_temp_at',
    'est_observed_rate', 'est_observed_duty', 'est_last_prediction',
  ]
  const bucketParams = TEMP_BUCKETS.flatMap(b => [
    `thermal_rate_heating:${b}`, `thermal_rate_cooling:${b}`,
    `steady_state_duty:${b}`,  // legacy (migration fallback)
    `steady_state_duty:cooling:${b}`, `steady_state_duty:heating:${b}`,
  ])
  const allParamNames = [...BASE_PARAMS, ...bucketParams]

  // Fire both queries in parallel
  const [{ data: allLearnings }, utilResults] = await Promise.all([
    // 1. Single batch query for all fermentation_learnings
    supabase.from('fermentation_learnings')
      .select('controller_id, parameter_name, learned_value, sample_count')
      .in('controller_id', activeControllerIds)
      .in('parameter_name', allParamNames),
    // 2. Parallel utilization pre-fetch for all cooling controllers
    Promise.all(
      activeControllers
        .filter(fc => fc.cooling_enabled)
        .map(async fc => {
          const result = await calculateSingleUtilization(supabase, fc, { skipShift: true })
          return { controllerId: fc.controller_id, result }
        })
    ),
  ])

  // Build per-controller lookup maps
  const learningsByController = new Map<string, Map<string, number>>()
  const samplesByController = new Map<string, Map<string, number>>()
  for (const row of (allLearnings ?? [])) {
    if (!learningsByController.has(row.controller_id)) {
      learningsByController.set(row.controller_id, new Map())
      samplesByController.set(row.controller_id, new Map())
    }
    learningsByController.get(row.controller_id)!.set(row.parameter_name, parseFloat(String(row.learned_value)))
    samplesByController.get(row.controller_id)!.set(row.parameter_name, row.sample_count)
  }

  // Pre-populate shared utilizations
  for (const { controllerId, result } of utilResults) {
    ctx.sharedUtilizations.set(controllerId, result)
  }

  for (const fc of activeControllers) {
    const isProfileOwned = profileOwnedControllerIds.has(fc.controller_id)

    const ctrlTarget = parseFloat(String(fc.target_temp ?? '20'))

    // Actual target from SSOT (already bootstrapped)
    const actualTarget = parseFloat(String((fc as any).profile_target_temp))

    // Dual sensor fusion: read pre-computed actual_temp from sync engine,
    // or compute from controller's own dual_sensor_enabled flag
    const dualEnabled = (fc as any).dual_sensor_enabled ?? false
    const preferredSensor: 'pill' | 'probe' = (fc as any).preferred_sensor ?? 'pill'
    const actualTemp = (fc as any).actual_temp != null
      ? parseFloat(String((fc as any).actual_temp))
      : computeDualSensorTarget(actualTarget, fc.current_temp ?? null, fc.pill_temp ?? null, dualEnabled, preferredSensor).actualTemp

    // ── Temperature Interpolation between RAPT syncs ──
    let interpolatedTemp = actualTemp
    let tempInterpolated = false
    const lastUpdateMs = fc.last_update ? new Date(fc.last_update as string).getTime() : Date.now()
    const staleMinutes = (Date.now() - lastUpdateMs) / 60000
    const thermalBucket = getTempBucket(actualTemp)

    // Use pre-fetched learnings (from batch query above)
    const pressureMap = learningsByController.get(fc.controller_id) ?? new Map()
    const sampleCountMap = samplesByController.get(fc.controller_id) ?? new Map()

    // ── Learn observed actual_temp rate between syncs ──
    // Track how actual_temp (the fusion) really changes, not the probe rate
    const prevActualTemp = pressureMap.get('est_prev_actual_temp')
    const prevActualTempAt = pressureMap.get('est_prev_actual_temp_at')
    let observedRate = pressureMap.get('est_observed_rate') ?? 0
    const observedRateSamples = sampleCountMap.get('est_observed_rate') ?? 0
    let observedDuty = pressureMap.get('est_observed_duty') ?? 0
    const prevDutyPct = pressureMap.get('pid_last_duty') ?? 0

    // When we have fresh sensor data (not stale), learn the rate
    if (staleMinutes <= 3 && prevActualTemp != null && prevActualTempAt != null) {
      const prevTs = prevActualTempAt // stored as epoch seconds
      const timeDiffHours = (lastUpdateMs - prevTs * 1000) / (1000 * 60 * 60)
      if (timeDiffHours > 0.03 && timeDiffHours < 1.0) {
        const rawObservedRate = (actualTemp - prevActualTemp) / timeDiffHours
        // Only learn meaningful rates (> 0.1°/h)
        if (Math.abs(rawObservedRate) > 0.1) {
          // EMA with alpha=0.3 for responsiveness
          const alpha = observedRateSamples >= 3 ? 0.3 : 0.5
          observedRate = observedRate !== 0
            ? observedRate * (1 - alpha) + rawObservedRate * alpha
            : rawObservedRate
          // Also track the duty that was active during observation (EMA)
          const dutyAtObservation = prevDutyPct > 0 ? prevDutyPct : 100
          observedDuty = observedDuty > 0
            ? observedDuty * (1 - alpha) + dutyAtObservation * alpha
            : dutyAtObservation
          log('EST_RATE_LEARNED', 'info',
            `${fc.name}: observerad hastighet ${rawObservedRate.toFixed(3)}°/h (EMA ${observedRate.toFixed(3)}°/h, duty@obs ${observedDuty.toFixed(0)}%, ${timeDiffHours.toFixed(1)}h mellan synk)`)
        }
      }

      // Accuracy check: compare last prediction to actual
      const lastPrediction = pressureMap.get('est_last_prediction')
      if (lastPrediction != null) {
        const predictionError = actualTemp - lastPrediction
        log('EST_ACCURACY', 'info',
          `${fc.name}: prediktion var ${Number(lastPrediction).toFixed(2)}°, verkligt ${Number(actualTemp).toFixed(2)}°, fel ${predictionError > 0 ? '+' : ''}${predictionError.toFixed(3)}°`)
      }
    }

    // ── Pre-PID Temperature Interpolation ──────────────────────
    // When sensor data is stale (no new RAPT reading), interpolate
    // using observed rate or previous duty to give PID a fresh estimate.
    // Uses previous cycle's duty (pid_last_duty) for fallback rate.
    if (staleMinutes > 3) {
      const lastModeVal = pressureMap.get('pid_current_mode')
      const lastMode = lastModeVal === 1 ? 'heating' : lastModeVal === 2 ? 'cooling' : null
      if (lastMode) {
        const hasObservedRate = observedRateSamples >= 2 && Math.abs(observedRate) > 0.05
        let effectiveRatePerHour: number
        let rateSource: string

        if (hasObservedRate) {
          // Scale observed rate by duty ratio: if rate was measured at 90% duty
          // but current duty is 50%, effective rate should be ~55% of observed
          const dutyRatio = (observedDuty > 0 && prevDutyPct > 0)
            ? Math.min(prevDutyPct / observedDuty, 1.5)  // cap at 1.5x to avoid overestimation
            : 1.0
          effectiveRatePerHour = Math.abs(observedRate) * dutyRatio
          rateSource = dutyRatio !== 1.0 ? `observed*${dutyRatio.toFixed(2)}` : 'observed'
        } else {
          const globalRateKey = `thermal_rate_${lastMode}`
          const bucketRateKey = `${globalRateKey}:${thermalBucket}`
          const bucketRate = pressureMap.get(bucketRateKey)
          const bucketSamples = sampleCountMap.get(bucketRateKey) ?? 0
          const useBucketRate = bucketRate != null && bucketSamples >= 3
          const thermalRate = useBucketRate ? bucketRate : (pressureMap.get(globalRateKey) ?? 0)
          const rateSamples = useBucketRate ? bucketSamples : (sampleCountMap.get(globalRateKey) ?? 0)
          rateSource = useBucketRate ? `${thermalBucket}(fallback)` : 'global(fallback)'
          const dutyFraction = Math.min(prevDutyPct, 100) / 100
          effectiveRatePerHour = thermalRate * dutyFraction

          if (thermalRate <= 0 || rateSamples < 3 || prevDutyPct <= 0) {
            effectiveRatePerHour = 0
          }
        }

        if (effectiveRatePerHour > 0) {
          const gapToTarget = actualTemp - actualTarget

          const isOnCorrectSide = (lastMode === 'cooling' && gapToTarget > 0) ||
                                   (lastMode === 'heating' && gapToTarget < 0)

          if (!isOnCorrectSide) {
            // Already past target — estimate passive recovery toward target
            // When cooling overshoots (temp < target), ambient heat pulls temp back up
            // When heating overshoots (temp > target), heat loss pulls temp back down
            const overshoot = Math.abs(gapToTarget) // how far past target
            const dutyFraction = Math.min(prevDutyPct, 100) / 100

            // Passive recovery rate: larger overshoot = faster recovery (more thermal gradient)
            // Base passive rate ~0.10°C/h, scaled by overshoot magnitude
            const passiveRate = Math.min(0.10 + overshoot * 0.3, 0.4) // cap at 0.4°C/h

            // If duty is still active, it fights recovery — net rate decreases
            // At 0% duty: full passive recovery. At 100% duty: active force dominates.
            const activeForce = effectiveRatePerHour * dutyFraction
            const netRecoveryRate = Math.max(passiveRate - activeForce * 0.3, 0)

            if (netRecoveryRate > 0) {
              const recoveryPerMin = netRecoveryRate / 60
              const recoveryDelta = Math.min(recoveryPerMin * staleMinutes, overshoot * 0.5) // don't recover more than halfway
              const recoverySign = lastMode === 'cooling' ? 1 : -1 // opposite of active direction

              interpolatedTemp = actualTemp + recoverySign * recoveryDelta
              // Clamp: don't recover past target
              if (lastMode === 'cooling') {
                interpolatedTemp = Math.min(interpolatedTemp, actualTarget)
              } else {
                interpolatedTemp = Math.max(interpolatedTemp, actualTarget)
              }

              interpolatedTemp = Math.round(interpolatedTemp * 100) / 100

              if (Math.abs(interpolatedTemp - actualTemp) >= 0.005) {
                tempInterpolated = true
                log('TEMP_INTERPOLATED', 'info',
                  `${fc.name}: sensor ${Number(actualTemp).toFixed(2)}° (${staleMinutes.toFixed(0)}min gammal) → est ${Number(interpolatedTemp).toFixed(2)}° (recovery ${netRecoveryRate.toFixed(2)}°/h, overshoot ${overshoot.toFixed(2)}°, prevDuty ${prevDutyPct}%)`)
              }
            }
          } else {
            const ratePerMin = effectiveRatePerHour / 60
            const rawDelta = ratePerMin * staleMinutes
            const deltaEst = Math.min(rawDelta, 0.3)
            const sign = lastMode === 'cooling' ? -1 : 1

            interpolatedTemp = actualTemp + sign * deltaEst

            // Clamp: don't interpolate past the target
            if (lastMode === 'cooling') {
              interpolatedTemp = Math.max(interpolatedTemp, actualTarget)
            } else {
              interpolatedTemp = Math.min(interpolatedTemp, actualTarget)
            }

            interpolatedTemp = Math.round(interpolatedTemp * 100) / 100

            if (Math.abs(interpolatedTemp - actualTemp) >= 0.005) {
              tempInterpolated = true
              log('TEMP_INTERPOLATED', 'info',
                `${fc.name}: sensor ${Number(actualTemp).toFixed(2)}° (${staleMinutes.toFixed(0)}min gammal) → est ${Number(interpolatedTemp).toFixed(2)}° (rate ${effectiveRatePerHour.toFixed(2)}°/h, källa ${rateSource}, prevDuty ${prevDutyPct}%)`)
            }
          }
        }
      }
    }

    // When we have a valid interpolation, PID should use the interpolated temp
    // and NOT be blocked by stale-data guard — the interpolation provides a
    // reliable estimate between RAPT sync intervals.
    const pidInputTemp = tempInterpolated ? interpolatedTemp : actualTemp

    // ── Ramp-rate-limiting: prevents abrupt target changes ──────
    // Gradually moves the effective target at a max rate.
    // Protects against step changes (e.g. 18°→2° cold crash).
    const RAMP_RATE_COOLING = 4.0 // °C/hour max target decrease
    const RAMP_RATE_HEATING = 3.0 // °C/hour max target increase
    const CYCLE_HOURS = 5 / 60    // 5-min cycle
    const BIG_JUMP_BYPASS = 5.0   // °C: skip ramp-limit on large step changes (e.g. cold start, new session)

    const lastEffective = pressureMap.get('pid_effective_target')
    let pidEffectiveTarget = actualTarget
    let rampRateLimited = false

    if (lastEffective != null) {
      const delta = actualTarget - lastEffective
      if (Math.abs(delta) >= BIG_JUMP_BYPASS) {
        // Big jump (e.g. user set 25° from 10°): jump straight to target, no ramp.
        pidEffectiveTarget = actualTarget
      } else if (delta < -0.1) {
        const maxDrop = RAMP_RATE_COOLING * CYCLE_HOURS
        pidEffectiveTarget = Math.max(actualTarget, lastEffective - maxDrop)
        rampRateLimited = pidEffectiveTarget > actualTarget + 0.05
      } else if (delta > 0.1) {
        const maxRise = RAMP_RATE_HEATING * CYCLE_HOURS
        pidEffectiveTarget = Math.min(actualTarget, lastEffective + maxRise)
        rampRateLimited = pidEffectiveTarget < actualTarget - 0.05
      }
    }
    pidEffectiveTarget = round1(pidEffectiveTarget)

    if (rampRateLimited) {
      log('RAMP_LIMIT', 'info', `${fc.name}: mål ${round1(actualTarget)}° rate-limited → ${pidEffectiveTarget}° (senaste: ${round1(lastEffective!)})`, {
        final_target: round1(actualTarget),
        effective_target: pidEffectiveTarget,
        last_effective: round1(lastEffective!),
        max_rate_cooling: RAMP_RATE_COOLING,
        max_rate_heating: RAMP_RATE_HEATING,
      })
    }

    // Store pidEffectiveTarget for cooler management (stable, rate-limited target)
    ctx.baseTargetMap.set(fc.controller_id, pidEffectiveTarget)
    let switchPressure = pressureMap.get('mode_switch_pressure') ?? 0
    const lastProbe = pressureMap.get('mode_last_probe') ?? null
    const prevModeValue = pressureMap.get('pid_current_mode')
    const prevMode: 'heating' | 'cooling' | null = prevModeValue === 1 ? 'heating' : prevModeValue === 2 ? 'cooling' : null
    const lastDutyPct = pressureMap.get('pid_last_duty') ?? 0
    const lastStepIndex = pressureMap.get('mode_last_step_index') ?? null

    // Mode detection: overshoot-aware with stabilisation guard.
    const MODE_SWITCH_CYCLES = 3
    const STALL_MIN_PROGRESS = 0.05

    // ── ssFloor check: block mode switch when established floor exists ──
    // If we have a learned steady-state duty floor > 0 for the CURRENT mode,
    // the system KNOWS it needs continuous action in that mode.
    // Switching away would be wrong — just reduce duty instead.
    const ssBucketForMode = getTempBucket(actualTarget)
    // Check mode-specific floor first, fall back to legacy key for cooling
    const coolingFloor = pressureMap.get(`steady_state_duty:cooling:${ssBucketForMode}`) ?? pressureMap.get(`steady_state_duty:${ssBucketForMode}`) ?? 0
    const coolingFloorSamples = sampleCountMap.get(`steady_state_duty:cooling:${ssBucketForMode}`) ?? sampleCountMap.get(`steady_state_duty:${ssBucketForMode}`) ?? 0
    const heatingFloor = pressureMap.get(`steady_state_duty:heating:${ssBucketForMode}`) ?? 0
    const heatingFloorSamples = sampleCountMap.get(`steady_state_duty:heating:${ssBucketForMode}`) ?? 0

    let suggestedMode: 'heating' | 'cooling' = actualTemp > actualTarget + 0.05 ? 'cooling' : 'heating'

    // Block switch to heating if we have a confirmed cooling floor
    if (suggestedMode === 'heating' && prevMode === 'cooling' && coolingFloor > 0 && coolingFloorSamples >= 5) {
      suggestedMode = 'cooling'
      log('MODE_FLOOR_BLOCK', 'info', `${fc.name}: blockerar heating — inlärt kylgolv ${(coolingFloor * 100).toFixed(0)}% (${coolingFloorSamples} prover), stannar i cooling`)
    }
    // Block switch to cooling if we have a confirmed heating floor
    if (suggestedMode === 'cooling' && prevMode === 'heating' && heatingFloor > 0 && heatingFloorSamples >= 5) {
      suggestedMode = 'heating'
      log('MODE_FLOOR_BLOCK', 'info', `${fc.name}: blockerar cooling — inlärt värmegolv ${(heatingFloor * 100).toFixed(0)}% (${heatingFloorSamples} prover), stannar i heating`)
    }

    // During active profile ramp, force mode to match ramp direction
    let rampOverrideApplied = false
    const profileCtx = ctx.profileStatusMap.get(fc.controller_id)
    if (profileCtx?.rampDirection && 
        (profileCtx.currentStepType === 'gradual_ramp' || profileCtx.currentStepType === 'ramp')) {
      const rampMode = profileCtx.rampDirection as 'heating' | 'cooling'
      // Safety escape: if temp is clearly on the wrong side during a ramp,
      // allow the opposite mode before we get a full 1°C runaway.
      // This prevents heating ramps from pinning mode=heating while beer is
      // already drifting warm and cooling should begin.
      const RAMP_OVERRIDE_OVERSHOOT_LIMIT = 0.3
      const overshoot = rampMode === 'heating'
        ? actualTemp - actualTarget   // positive = too hot, need cooling
        : actualTarget - actualTemp   // positive = too cold, need heating
      if (suggestedMode !== rampMode && overshoot > RAMP_OVERRIDE_OVERSHOOT_LIMIT) {
        log('MODE_RAMP_OVERRIDE_BYPASS', 'info',
          `${fc.name}: ramp ${rampMode} override SKIPPED — överskjutning ${overshoot.toFixed(1)}° > ${RAMP_OVERRIDE_OVERSHOOT_LIMIT}°, tillåter ${suggestedMode}`)
      } else if (suggestedMode !== rampMode) {
        log('MODE_RAMP_OVERRIDE', 'info', 
          `${fc.name}: ramp ${rampMode} override (temp ${round1(actualTemp)}° vs target ${round1(actualTarget)}°, would have been ${suggestedMode})`)
        suggestedMode = rampMode
        rampOverrideApplied = true
      }
    }

    const distanceToTarget = Math.abs(actualTemp - actualTarget)
    const canSwitchMode = fc.heating_enabled && fc.cooling_enabled
    if (!canSwitchMode && switchPressure > 0) {
      switchPressure = 0
    }
    const onWrongSide = canSwitchMode && prevMode != null && suggestedMode !== prevMode

    const profileSwitchStatus = ctx.profileStatusMap.get(fc.controller_id)
    const isProfileRamp = profileSwitchStatus?.currentStepType === 'gradual_ramp' || profileSwitchStatus?.currentStepType === 'ramp'
    const rampMatchesSuggested = profileSwitchStatus?.rampDirection === suggestedMode
    const velocity = lastProbe != null ? Math.abs(actualTemp - lastProbe) : 0

    const currentStepIndex = profileSwitchStatus?.stepIndex ?? null
    const stepChanged = currentStepIndex != null && lastStepIndex != null && currentStepIndex !== lastStepIndex

    const isProfileRampBypass = onWrongSide && isProfileRamp && rampMatchesSuggested && distanceToTarget > 0.3

    let pidMode: 'heating' | 'cooling'
    if (canSwitchMode && prevMode != null && suggestedMode !== prevMode && stepChanged) {
      pidMode = suggestedMode
      switchPressure = 0
      log('MODE_STEP_SWITCH', 'action', `${fc.name}: ${prevMode} → ${suggestedMode} (profilsteg ändrat ${lastStepIndex} → ${currentStepIndex}, omedelbar)`, {
        from: prevMode, to: suggestedMode, oldStep: lastStepIndex, newStep: currentStepIndex,
        distance: round1(distanceToTarget), actualTemp: round1(actualTemp), actualTarget: round1(actualTarget),
      })
    } else if (onWrongSide && distanceToTarget > 1.0) {
      pidMode = suggestedMode
      switchPressure = 0
      log('MODE_EMERGENCY', 'action', `${fc.name}: ${prevMode} → ${suggestedMode} (Δ${round1(distanceToTarget)}° > 1°, omedelbar)`, {
        from: prevMode, to: suggestedMode, distance: round1(distanceToTarget),
        actualTemp: round1(actualTemp), actualTarget: round1(actualTarget),
      })
    } else if (onWrongSide && distanceToTarget > 0.6) {
      const isStable = velocity < STALL_MIN_PROGRESS
      const velocitySigned = lastProbe != null ? actualTemp - lastProbe : 0
      const isDivergingCheck = (suggestedMode === 'cooling' && velocitySigned > 0.02) ||
                               (suggestedMode === 'heating' && velocitySigned < -0.02)
      const isStuckOrDiverging = isStable || isDivergingCheck

      const needsDutyZero = !isProfileRampBypass
      const dutyBlocked = needsDutyZero && lastDutyPct > 0

      if (!isStuckOrDiverging) {
        pidMode = prevMode!
        if (isProfileRampBypass) {
          log('MODE_PROFILE_HOLD', 'info', `${fc.name}: profil-ramp ${profileSwitchStatus?.rampDirection} men temp ej stabil (velocity=${round1(velocity)}°, Δ${round1(distanceToTarget)}°)`)
        }
      } else if (dutyBlocked) {
        pidMode = prevMode!
        if (lastDutyPct <= 10) {
          log('MODE_DUTY_HOLD', 'info', `${fc.name}: väntar på duty 0% innan lägesbyträkning startar (duty ${lastDutyPct}%)`, {
            from: prevMode, to: suggestedMode, last_duty: lastDutyPct, pressure: switchPressure,
          })
        }
      } else if (isStable) {
        switchPressure = Math.min(switchPressure + 1, MODE_SWITCH_CYCLES + 1)
        if (switchPressure >= MODE_SWITCH_CYCLES) {
          pidMode = suggestedMode
          switchPressure = 0
          const reason = isProfileRampBypass ? `profil-ramp ${profileSwitchStatus?.rampDirection}` : 'normal'
          log('MODE_SWITCH', 'action', `${fc.name}: ${prevMode} → ${suggestedMode} (${reason}, stabil ${MODE_SWITCH_CYCLES} cykler, Δ${round1(distanceToTarget)}°)`, {
            from: prevMode, to: suggestedMode, cycles: MODE_SWITCH_CYCLES,
            distance: round1(distanceToTarget), actualTemp: round1(actualTemp),
          })
        } else {
          pidMode = prevMode!
          log('MODE_HOLD', 'info', `${fc.name}: stannar i ${prevMode} (stabil fel sida, tryck ${switchPressure}/${MODE_SWITCH_CYCLES}${needsDutyZero ? ', duty=0%' : ', ramp-bypass'})`, {
            suggested: suggestedMode, pressure: switchPressure, threshold: MODE_SWITCH_CYCLES,
            velocity: round1(velocity), distance: round1(distanceToTarget),
          })
        }
      } else {
        switchPressure = Math.min(switchPressure + 1, MODE_SWITCH_CYCLES + 1)
        if (switchPressure >= MODE_SWITCH_CYCLES) {
          pidMode = suggestedMode
          switchPressure = 0
          log('MODE_SWITCH', 'action', `${fc.name}: ${prevMode} → ${suggestedMode} (divergerar, ${MODE_SWITCH_CYCLES} cykler, Δ${round1(distanceToTarget)}°)`, {
            from: prevMode, to: suggestedMode, cycles: MODE_SWITCH_CYCLES,
            distance: round1(distanceToTarget),
          })
        } else {
          pidMode = prevMode!
          log('MODE_HOLD', 'info', `${fc.name}: stannar i ${prevMode} (divergerar fel sida, tryck ${switchPressure}/${MODE_SWITCH_CYCLES})`, {
            suggested: suggestedMode, pressure: switchPressure, threshold: MODE_SWITCH_CYCLES,
            distance: round1(distanceToTarget),
          })
        }
      }
    } else if (onWrongSide) {
      pidMode = prevMode ?? suggestedMode
      if (lastDutyPct === 0 && switchPressure === 0) switchPressure = 1
    } else {
      pidMode = prevMode ?? suggestedMode
      if (switchPressure > 0) switchPressure = Math.max(0, switchPressure - 1)
    }

    // Capability guard: never select a mode the hardware cannot execute.
    if (fc.heating_enabled && !fc.cooling_enabled && pidMode !== 'heating') {
      log('MODE_FORCE', 'info', `${fc.name}: cooling ej tillgängligt, tvingar mode=heating`)
      pidMode = 'heating'
      switchPressure = 0
    } else if (fc.cooling_enabled && !fc.heating_enabled && pidMode !== 'cooling') {
      log('MODE_FORCE', 'info', `${fc.name}: heating ej tillgängligt, tvingar mode=cooling`)
      pidMode = 'cooling'
      switchPressure = 0
    }

    // NOTE: fermentation_learnings upsert deferred until after PID calculation
    // to merge all writes into a single batch (mode, pressure, duty, effective_target)
    const profileStatus = profileStatusMap.get(fc.controller_id)
    const rawStepType = isProfileOwned ? (profileStatus?.currentStepType ?? (profileStatus ? 'profile' : 'unknown')) : 'standalone'
    // Normalize wait-type steps AND standalone to 'hold' for PID baseline sharing —
    // they all behave identically (hold temp). This prevents integral reset when a
    // profile ends and step_type changes from 'hold' to 'standalone'.
    const stepType = ['wait_for_sg', 'wait_for_gravity_stable', 'wait_for_acknowledgement', 'standalone'].includes(rawStepType) ? 'hold' : rawStepType

    // === Stale-data detection ===
    // Data is stale if no new sensor reading AND no valid interpolation.
    // When we have a valid interpolation, PID can act on the estimated temp.
    const rawStaleData = prevActualTempAt != null && prevActualTempAt > 0 &&
      lastUpdateMs <= prevActualTempAt * 1000
    const isStaleData = rawStaleData && !tempInterpolated

    // === Pill rate (for ramp boost — computed from temp_delta_history in caller) ===
    // Uses the already-fetched pressureMap rates when available. Falls back to
    // a quick delta_history query only when actually needed for ramp context.
    let pillRate: number | null = null

    // Use pre-fetched utilization (calculated in parallel before the loop)
    let coolingUtil: number | null = null
    let recentUtil: number | null = null
    if (fc.cooling_enabled) {
      const utilResult = ctx.sharedUtilizations.get(fc.controller_id)
      if (utilResult) {
        coolingUtil = utilResult.rolling
        recentUtil = utilResult.recent
      }
    }

    // Build ramp context for PID rate-aware boost
    let rampContext: { requiredRatePerHour: number; tempBucket: string; loadBucket: string } | null = null
    if (['ramp', 'gradual_ramp'].includes(stepType) && pidMode === 'cooling') {
      const tempBucket = getTempBucket(ctrlTarget)
      const activeCoolingCount = followedControllersFullData.filter(c => c.cooling_enabled).length
      const loadBucket = activeCoolingCount === 0 ? 'load_0' : activeCoolingCount === 1 ? 'load_1' : 'load_2plus'
      const distance = actualTemp - actualTarget
      if (distance > 0.5) {
        const estimatedRate = Math.max(0.5, distance / 4)
        rampContext = { requiredRatePerHour: estimatedRate, tempBucket, loadBucket }
      }
    }

    // Fetch recent pill rate whenever the controller is actively cooling and
    // beer is above target — needed both for ramp boost AND for predictive
    // brake-zone expansion during hold steps (prevents overshoot when the
    // cooling rate exceeds what the static 0.5°C brake window can handle).
    if (pidMode === 'cooling' && actualTemp - actualTarget > 0.3) {
      const { data: deltaHistory } = await supabase
        .from('temp_delta_history')
        .select('pill_temp, recorded_at')
        .eq('controller_id', fc.controller_id)
        .order('recorded_at', { ascending: false })
        .limit(8)
      if (deltaHistory && deltaHistory.length >= 3) {
        const newest = deltaHistory[0]
        const oldest = deltaHistory[deltaHistory.length - 1]
        const timeDiffMs = new Date(newest.recorded_at).getTime() - new Date(oldest.recorded_at).getTime()
        const timeDiffHours = timeDiffMs / (1000 * 60 * 60)
        if (timeDiffHours > 0.05) {
          pillRate = (parseFloat(String(newest.pill_temp)) - parseFloat(String(oldest.pill_temp))) / timeDiffHours
        }
      }
    }

    // === PID Calculation (uses interpolated temp when available) ===
    const modeJustSwitched = prevMode != null && pidMode !== prevMode
    const pidResult = await calculateCompensatedTarget(
      supabase, fc.controller_id, pidEffectiveTarget, ctrlTarget,
      fc.name || fc.controller_id, pidMode, stepType,
      pidInputTemp, isStaleData, coolingUtil, rampContext, pillRate, tempInterpolated,
      pidMode === 'cooling' ? ctx.coolerMarginContext : null,
      modeJustSwitched,
    )

    // Log PID status
    const constraintLabels = pidResult.constraints && pidResult.constraints.length > 0 ? pidResult.constraints : []

    log('PILL_COMP_STATUS', 'info', `Controller: ${fc.name} [${pidMode}]`, {
      pill_temp: round1(fc.pill_temp ?? 0),
      probe_temp: round1(fc.current_temp ?? 0),
      actual_temp: Math.round(actualTemp * 100) / 100,
      interpolated_temp: tempInterpolated ? Math.round(interpolatedTemp * 100) / 100 : undefined,
      dual_sensors: dualEnabled,
      actual_target: round1(actualTarget),
      ctrl_target: round1(ctrlTarget),
      ctrl_target_pid: round1(pidResult.ctrlTargetPid),
      p_correction: round1(pidResult.pCorrection ?? 0),
      i_correction: round1(pidResult.iCorrection ?? 0),
      pill_rate: pidResult.pillRate != null ? round1(pidResult.pillRate) : null,
      mode: pidMode,
      step_type: stepType,
      duty_cycle: pidResult.dutyCycle != null ? Math.round(pidResult.dutyCycle * 100) : undefined,
      cooling_util: coolingUtil != null ? Math.round(coolingUtil * 100) : null,
      recent_util: recentUtil != null ? Math.round(recentUtil * 100) : null,
      ...(constraintLabels.length > 0 ? { limits: constraintLabels } : {}),
      switch_pressure: switchPressure,
      ...(rampRateLimited ? { effective_target: pidEffectiveTarget, ramp_limited: true } : {}),
    })

    // Persist last duty cycle for mode-switch guard
    const computedDutyPct = pidResult.dutyCycle != null ? Math.round(pidResult.dutyCycle * 100) : 0

    // Interpolation already ran pre-PID; no post-PID interpolation needed.

    // Post-PID safety: if PID still has active duty in the current mode,
    // any switch pressure accumulated from stale pid_last_duty data is invalid.
    if (computedDutyPct > 0 && switchPressure > 0) {
      log('MODE_PRESSURE_RESET', 'info', `${fc.name}: duty ${computedDutyPct}% aktiv, nollställer switch pressure ${switchPressure} → 0`)
      switchPressure = 0
    }

    // ── Single merged upsert for all PID state ──
    // PID operational state (duty, mode, interpolation) must ALWAYS be persisted,
    // even during idle (skipLearning). Only ssFloor learning is gated.
    {
      const now = new Date().toISOString()
      const epochSec = Math.floor(Date.now() / 1000)
      const rows: Array<{ controller_id: string; parameter_name: string; learned_value: number; sample_count: number; last_updated_at: string }> = [
        { controller_id: fc.controller_id, parameter_name: 'mode_switch_pressure', learned_value: switchPressure, sample_count: switchPressure, last_updated_at: now },
        { controller_id: fc.controller_id, parameter_name: 'mode_last_probe', learned_value: round1(actualTemp)!, sample_count: 1, last_updated_at: now },
        { controller_id: fc.controller_id, parameter_name: 'pid_current_mode', learned_value: pidMode === 'heating' ? 1 : 2, sample_count: 1, last_updated_at: now },
        { controller_id: fc.controller_id, parameter_name: 'pid_effective_target', learned_value: pidEffectiveTarget, sample_count: 1, last_updated_at: now },
        { controller_id: fc.controller_id, parameter_name: 'pid_last_duty', learned_value: computedDutyPct, sample_count: 1, last_updated_at: now },
        // EST tracking: store current actual_temp and timestamp for rate learning
        { controller_id: fc.controller_id, parameter_name: 'est_prev_actual_temp', learned_value: actualTemp, sample_count: 1, last_updated_at: now },
        { controller_id: fc.controller_id, parameter_name: 'est_prev_actual_temp_at', learned_value: lastUpdateMs / 1000, sample_count: 1, last_updated_at: now },
      ]
      // Store observed rate with sample count for EMA
      if (observedRate !== 0) {
        rows.push(
          { controller_id: fc.controller_id, parameter_name: 'est_observed_rate', learned_value: observedRate, sample_count: observedRateSamples + (staleMinutes <= 3 ? 1 : 0), last_updated_at: now },
          { controller_id: fc.controller_id, parameter_name: 'est_observed_duty', learned_value: observedDuty, sample_count: observedRateSamples + (staleMinutes <= 3 ? 1 : 0), last_updated_at: now },
        )
      }
      // Store prediction for accuracy tracking on next fresh read
      if (tempInterpolated) {
        rows.push({ controller_id: fc.controller_id, parameter_name: 'est_last_prediction', learned_value: interpolatedTemp, sample_count: 1, last_updated_at: now })
      }
      if (currentStepIndex != null) {
        rows.push({ controller_id: fc.controller_id, parameter_name: 'mode_last_step_index', learned_value: currentStepIndex, sample_count: 1, last_updated_at: now })
      }
      // ssFloor learning: only when NOT in idle mode
      // ssFloor represents the duty needed to MAINTAIN the target, so learning
      // should happen during all near-target states, not just "pure" deadband.
      if (!ctx.skipLearning) {
        const isRecovery = pidResult.constraints?.includes('deadband-recovery')
        const isMildOvershoot = pidResult.constraints?.includes('mild-overshoot')
        const isTargetHold = pidResult.constraints?.includes('target-hold')
        const isTargetHoldWarm = pidResult.constraints?.includes('target-hold-warm')
        const isInDeadband = pidResult.constraints?.includes('deadband')
        const isStale = pidResult.constraints?.includes('stale')
        const hasDutyData = pidResult.dutyCycle != null && pidResult.iCorrection != null
        const canLearnSsFloor = hasDutyData && (
          isInDeadband || isTargetHold || isTargetHoldWarm || isMildOvershoot || isStale
        )
        if (canLearnSsFloor) {
          const dutyBucket = getTempBucket(actualTarget)
          const quantizedDuty = Math.round(pidResult.iCorrection! * 10) / 10
          // Read current sample_count from DB to increment it (avoids resetting to 1 every cycle)
          const { data: existingSs } = await supabase
            .from('fermentation_learnings')
            .select('sample_count, learned_value')
            .eq('controller_id', fc.controller_id)
            .eq('parameter_name', `steady_state_duty:${pidMode}:${dutyBucket}`)
            .maybeSingle()
          const currentFloor = existingSs ? parseFloat(String(existingSs.learned_value)) : 0
          const currentSamples = existingSs?.sample_count ?? 0
          const tolerance = isMildOvershoot ? 0.50 : 0.20
          const isSeeding = currentFloor === 0 || currentSamples < 3
          const isStable = isSeeding || Math.abs(quantizedDuty - currentFloor) <= currentFloor * tolerance + 0.05
          if (isStable && (quantizedDuty > 0 || currentFloor > 0)) {
            let learnedValue = quantizedDuty
            if (isSeeding && currentFloor === 0 && quantizedDuty > 0) {
              const alpha = currentSamples === 0 ? 0.5 : 0.3
              learnedValue = Math.round((currentFloor * (1 - alpha) + quantizedDuty * alpha) * 10) / 10
              log('SS_FLOOR_SEED', 'info', `${fc.name}: seeding ${pidMode} floor ${(learnedValue * 100).toFixed(0)}% from integral ${(quantizedDuty * 100).toFixed(0)}%`)
            } else if (isMildOvershoot && currentFloor > 0) {
              const alpha = 0.4
              learnedValue = Math.round((currentFloor * (1 - alpha) + quantizedDuty * alpha) * 10) / 10
            }
            const ssCount = currentSamples + 1
            rows.push({ controller_id: fc.controller_id, parameter_name: `steady_state_duty:${pidMode}:${dutyBucket}`, learned_value: learnedValue, sample_count: ssCount, last_updated_at: now })
          }
        }
      }
      // Parallel: PID state (controller_learned_compensation) + learnings (fermentation_learnings)
      await Promise.all([
        pidResult.persistPromise,
        supabase.from('fermentation_learnings').upsert(rows, { onConflict: 'controller_id,parameter_name' }),
      ].filter(Boolean))
    }

    // ═══════════════════════════════════════════════════
    // PWM duty cycle execution (unified for cooling & heating)
    // ═══════════════════════════════════════════════════
    if (pidResult.dutyCycle != null) {
      await executePwmDutyCycle(
        ctx, fc, pidMode, pidResult.dutyCycle,
        pidEffectiveTarget, actualTemp, actualTarget, ctrlTarget,
        rampOverrideApplied, adjustments,
      )
      continue
    }
  }

  return adjustments
}

// Smart Relay was removed — RAPT API does not support relay/hysteresis control for TemperatureControllers.

// Stall detection removed — gradual_ramp (Smart diacetylvila) handles the same use case
