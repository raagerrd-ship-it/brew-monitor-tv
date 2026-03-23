import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { round1, TempController, setControllerTargetTemp, loadPillCompSettings, calculateCompensatedTarget, RaptUpdateBatch } from './temp-utils.ts'
import { computeDualSensorTarget } from './dual-sensor.ts'
import { logAdjustment, AdjustmentResult } from './adjustment-logger.ts'
import { evaluateBoostOutcomes, detectAndHandleStalls, StallSettings, StallContext } from './stall-detection.ts'
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
}

export interface ControllerAdjustmentContext {
  supabase: ReturnType<typeof createClient>
  supabaseUrl: string
  serviceRoleKey: string
  followedControllersFullData: TempController[]
  profileOwnedControllerIds: Set<string>
  profileTargetMap: Map<string, number>
  sessionBrewIdMap: Map<string, string>
  cooloffControllerIds: Set<string>
  profileStatusMap: Map<string, { profileTarget: number | null; stepIndex: number; hasCooloff: boolean; activeTarget?: number | null; currentStepType?: string }>
  lastAdjTimestampMap: Map<string, string>
  pillCompSettings: Awaited<ReturnType<typeof loadPillCompSettings>>
  stallSettings: StallSettings
  log: (step: string, result: 'pass' | 'fail' | 'info' | 'action', message: string, details?: Record<string, unknown>) => void
  updateBatch?: RaptUpdateBatch
  pwmBursts: PwmBurst[]
  /** Populated by PID: maps controller_id → dual-sensor baseTarget (grundmål).
   *  Used by cooler to plan against a stable target, not the PID-fluctuating target_temp. */
  baseTargetMap: Map<string, number>
  /** When true, skip all learning (EMA updates) — system is in idle mode */
  skipLearning?: boolean
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
  const processorAdjs = await runProcessors(ctx)
  adjustments.push(...processorAdjs)

  // Sync in-memory data so downstream sees current targets
  for (const adj of processorAdjs) {
    const fc = ctx.followedControllersFullData.find(c => c.name === adj.cooler)
    if (fc) {
      (fc as any).target_temp = adj.newTarget
    }
  }

  // ── Step 3: Stall Detection (separate concern) ────────────
  const stallAdjs = await runStallDetection(ctx)
  adjustments.push(...stallAdjs)

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
// Each processor is a function that returns adjustments for controllers
// it modified. Unmodified controllers are handled by pass-through.
// To add a new processor: create a function, add it to the array below.

async function runProcessors(ctx: ControllerAdjustmentContext): Promise<AdjustmentResult[]> {
  const adjustments: AdjustmentResult[] = []

  // Register processors here. Each is independently toggleable.
  // Order matters: later processors see targets set by earlier ones.
  const processors = [
    runPidControl,
  ]

  for (const processor of processors) {
    const adjs = await processor(ctx)
    adjustments.push(...adjs)

    // Sync in-memory between processors so next one sees current targets
    for (const adj of adjs) {
      const fc = ctx.followedControllersFullData.find(c => c.name === adj.cooler)
      if (fc) {
        (fc as any).target_temp = adj.newTarget
      }
    }
  }

  return adjustments
}

// ─── PID Control (Processor) ─────────────────────────────────

async function runPidControl(ctx: ControllerAdjustmentContext): Promise<AdjustmentResult[]> {
  const {
    supabase, supabaseUrl, serviceRoleKey,
    followedControllersFullData, profileOwnedControllerIds,
    cooloffControllerIds, profileStatusMap, lastAdjTimestampMap,
    pillCompSettings, log,
  } = ctx
  const adjustments: AdjustmentResult[] = []

  // PID always runs — the "Dubbla temperaturgivare" toggle only controls
  // whether actual_temp is an average of pill+probe or just probe.
  log('PID_CONTROL', 'info', `PID control check (dual sensors: ${pillCompSettings.enabled ? 'ON' : 'OFF'})`)

  // Pre-load pending PWM reverts to detect controllers in active PWM cycles.
  // During PWM, PID is completely locked — no calculations or adjustments.
  const controllerIds = followedControllersFullData.map(c => c.controller_id)
  const { data: pendingPwmReverts } = await supabase
    .from('pending_rapt_retries')
    .select('controller_id, target_temp')
    .in('controller_id', controllerIds)
    .like('reason', '%PWM OFF%')
  const pwmRevertMap = new Map(
    (pendingPwmReverts ?? []).map(r => [r.controller_id, r.target_temp as number])
  )

  for (const fc of followedControllersFullData) {
    const isProfileOwned = profileOwnedControllerIds.has(fc.controller_id)

    if (cooloffControllerIds.has(fc.controller_id)) {
      log('PID_SKIP', 'info', `${fc.name}: 30min cooloff active, skipping PID`)
      continue
    }
    if (!fc.heating_enabled && !fc.cooling_enabled) continue

    // ── PWM lock: skip PID entirely during active PWM cycles ──
    // Hardware is at 0°C during the burst, so probe temp is artificially dropping.
    // Running PID on this transient state produces a falsely aggressive target.
    // The revert target was set when PWM was initiated and should remain unchanged.
    const hasPendingPwmRevert = pwmRevertMap.has(fc.controller_id)
    if (hasPendingPwmRevert) {
      log('PID_SKIP', 'info', `${fc.name}: PWM burst active — skipping PID (revert=${pwmRevertMap.get(fc.controller_id)}°C)`)
      continue
    }

    const ctrlTarget = parseFloat(String(fc.target_temp ?? '20'))

    // PID always runs every cycle — no same-data guard.
    // Even if RAPT telemetry hasn't changed, the PID integral and learned
    // baselines evolve, so skipping would allow drift.

    // Actual target from SSOT (already bootstrapped)
    const actualTarget = parseFloat(String((fc as any).profile_target_temp))

    // Dual sensor fusion: compute baseTarget and actualTemp
    const dualSensor = computeDualSensorTarget(
      actualTarget,
      fc.current_temp ?? null,
      fc.pill_temp ?? null,
      pillCompSettings.enabled,
    )
    const { sensorDelta, actualTemp, enabled: hasDualSensors } = dualSensor
    const probeTemp = fc.current_temp ?? fc.pill_temp ?? ctrlTarget

    // Store baseTarget for cooler management (stable grundmål without PI fluctuation)
    ctx.baseTargetMap.set(fc.controller_id, dualSensor.baseTarget)

    const pidMode: 'heating' | 'cooling' = (fc.current_temp ?? 0) < ctrlTarget ? 'heating' : 'cooling'
    const profileStatus = profileStatusMap.get(fc.controller_id)
    const stepType = isProfileOwned ? (profileStatus?.currentStepType ?? (profileStatus ? 'profile' : 'unknown')) : 'standalone'

    // Calculate cooling utilization for this controller
    let coolingUtil: number | null = null
    let recentUtil: number | null = null
    if (fc.cooling_enabled) {
      const utilResult = await calculateSingleUtilization(supabase, fc, { skipShift: true })
      coolingUtil = utilResult.rolling
      recentUtil = utilResult.recent
    }

    // Build ramp context for PID rate-aware boost
    let rampContext: { requiredRatePerHour: number; tempBucket: string; loadBucket: string } | null = null
    if (['ramp', 'gradual_ramp'].includes(stepType) && pidMode === 'cooling') {
      // Check if there's a ramp rate from the profile status
      const tempBucket = getTempBucket(ctrlTarget)
      const activeCoolingCount = followedControllersFullData.filter(c => c.cooling_enabled).length
      const loadBucket = activeCoolingCount === 0 ? 'load_0' : activeCoolingCount === 1 ? 'load_1' : 'load_2plus'
      // Estimate required rate from profile target vs current temp
      const distance = actualTemp - actualTarget
      if (distance > 0.5) {
        // Approximate: need to cover this distance — use a reasonable ramp horizon
        // If profile provides a specific rate, use that; otherwise estimate from distance
        const estimatedRate = Math.max(0.5, distance / 4) // assume 4h to close gap minimum
        rampContext = { requiredRatePerHour: estimatedRate, tempBucket, loadBucket }
      }
    }

    // ── Pre-calculate PWM mode (burst-per-cycle model) ──
    let isPwmActiveSegment = false
    let isPwmMode = false
    let pwmDutyPct = 0
    let pwmDutySeconds = 0
    const ctrlTempDiffPre = Math.round(Math.abs((fc.current_temp ?? 0) - ctrlTarget) * 10) / 10

    // ── PWM stability counter: require 4 consecutive stable cycles before activating PWM ──
    const PWM_STABLE_THRESHOLD = 4
    const prevStableCount = parseInt(String((fc as any).pwm_stable_count ?? '0'), 10)

    if ((stepType === 'hold' || stepType === 'standalone') && ctrlTempDiffPre < 0.3) {
      const newStableCount = prevStableCount + 1
      if (newStableCount !== prevStableCount) {
        await supabase.from('rapt_temp_controllers')
          .update({ pwm_stable_count: newStableCount })
          .eq('controller_id', fc.controller_id)
      }

      if (newStableCount >= PWM_STABLE_THRESHOLD) {
        const cBucket = getTempBucket(ctrlTarget)
        const dutyParam = await getLearnedParam(supabase, fc.controller_id, `steady_state_duty:${cBucket}`, -1)

        if (dutyParam.sampleCount >= 5 && dutyParam.value >= 0.1 && dutyParam.value < 0.90) {
            isPwmMode = true
            isPwmActiveSegment = true

            // ── Closed-loop PWM feedback ──────────────────────
            // If temp is drifting below target → duty too high → nudge down.
            // If temp is drifting above target → duty too low → nudge up.
            // Uses a small alpha (0.1) for gentle correction per cycle.
            let feedbackDuty = dutyParam.value
            if (!ctx.skipLearning) {
              const probeNow = fc.current_temp ?? 0
              const tempError = probeNow - ctrlTarget // positive = too warm, negative = overcooling (compare vs hardware target, not profile)
              const PWM_FEEDBACK_DEADBAND = 0.15 // °C — no correction within this band
              if (Math.abs(tempError) > PWM_FEEDBACK_DEADBAND) {
                // Each 0.1°C of error adjusts duty by ~2% (scale factor 0.2)
                const correction = tempError * 0.2 // overcooling (neg error) → negative correction → lower duty
                const correctedDuty = Math.max(0.05, Math.min(0.95, feedbackDuty + correction))
                if (Math.abs(correctedDuty - feedbackDuty) > 0.005) {
                  const fbResult = await updateLearnedParam(
                    supabase, fc.controller_id, `steady_state_duty:${cBucket}`,
                    correctedDuty, 0.01, 1.0, 0.1, // alpha=0.1 for gentle EMA
                  )
                  feedbackDuty = fbResult.newValue
                  log('PWM_FEEDBACK', 'info', `${fc.name}: temp error ${tempError > 0 ? '+' : ''}${tempError.toFixed(2)}°C → duty ${(dutyParam.value * 100).toFixed(0)}→${(fbResult.newValue * 100).toFixed(0)}%`)
                }
              }
            }

            // 2-cycle model: 10%-resolution over 10-min (2×5-min) window.
            // Quantize to nearest 10%: 0, 10, 20, …, 90, 100%
            pwmDutyPct = Math.round(feedbackDuty * 10) * 10
            // Total burst minutes across the 10-min window
            const totalBurstMin = pwmDutyPct / 10 // 0–10
            // Determine phase (A=0, B=1) from epoch: alternates every 5 minutes
            const phase = Math.floor(Date.now() / 300000) % 2
            // Distribute: phase A gets ceil, phase B gets floor
            const currentBurstMin = phase === 0 ? Math.ceil(totalBurstMin / 2) : Math.floor(totalBurstMin / 2)
            pwmDutySeconds = currentBurstMin * 60
        }
      }
    } else if (prevStableCount > 0) {
      // Temperature drifted — reset counter
      await supabase.from('rapt_temp_controllers')
        .update({ pwm_stable_count: 0 })
        .eq('controller_id', fc.controller_id)
    }

    const pidResult = await calculateCompensatedTarget(
      supabase, fc.controller_id, dualSensor.baseTarget, actualTarget, ctrlTarget,
      fc.name || fc.controller_id, pillCompSettings, pidMode, stepType,
      actualTemp, probeTemp, coolingUtil, rampContext, isPwmActiveSegment, ctx.skipLearning,
    )

    // Safety bounds — respect hardware min/max strictly
    const maxTemp = parseFloat(String(fc.max_target_temp ?? '25'))
    const hwMinTemp = parseFloat(String(fc.min_target_temp ?? '-5'))
    const unclamped = pidResult.ctrlTargetPid
    let ctrlTargetPid = round1(Math.max(hwMinTemp, Math.min(maxTemp, unclamped)))

    // Track if hardware min/max clamped the target
    if (unclamped < hwMinTemp) {
      pidResult.constraints = pidResult.constraints ?? []
      pidResult.constraints.push(`hw-min=${hwMinTemp}`)
    }
    if (unclamped > maxTemp) {
      pidResult.constraints = pidResult.constraints ?? []
      pidResult.constraints.push(`hw-max=${maxTemp}`)
    }

    // ── Heater activation guard ──────────────────────────────
    // When PID wants to raise target in heating mode, cap it below
    // the heater activation threshold (probe + heating_hysteresis)
    // so the temperature drifts up naturally without firing the heater.
    // Only applies when error is small (holding stable, not recovering).
    if (pidMode === 'heating' && fc.heating_enabled && fc.heating_hysteresis != null) {
      const heatingHyst = parseFloat(String(fc.heating_hysteresis))
      // Heater activates when probe < target - hysteresis
      // → prevent by keeping target ≤ probe + hysteresis - buffer
      const heaterThreshold = probeTemp + heatingHyst - 0.1
      const avgError = dualSensor.baseTarget - actualTemp
      const isHoldingStable = Math.abs(avgError) < 1.0

      if (isHoldingStable && ctrlTargetPid > heaterThreshold) {
        const before = ctrlTargetPid
        ctrlTargetPid = Math.max(ctrlTarget, heaterThreshold) // never below ctrl target (profile target is virtual)
        pidResult.constraints = pidResult.constraints ?? []
        pidResult.constraints.push(`heat-guard=${heatingHyst}`)
        console.log(`🔥 Heater guard ${fc.name}: capped ${before.toFixed(1)}→${ctrlTargetPid.toFixed(1)}°C (probe=${probeTemp.toFixed(1)}, hyst=${heatingHyst}, threshold=${heaterThreshold.toFixed(1)})`)
      }
    }

    // Always log PID status for visibility in decision log
    const pillTempLog = round1(fc.pill_temp ?? 0)
    const probeTempLog = round1(fc.current_temp ?? 0)
    const avgTemp = round1(actualTemp)
    const constraintLabels = pidResult.constraints && pidResult.constraints.length > 0 ? pidResult.constraints : []

    // Sensor delta: the pure geometric correction from dual-sensor module
    const effectiveDelta = round1(sensorDelta)

    log('PILL_COMP_STATUS', 'info', `Controller: ${fc.name}`, {
      pill_temp: pillTempLog,
      probe_temp: probeTempLog,
      actual_temp: avgTemp,
      dual_sensors: hasDualSensors,
      actual_target: round1(actualTarget),
      ctrl_target: round1(ctrlTarget),
      ctrl_target_pid: round1(ctrlTargetPid),
      delta: effectiveDelta,
      sensor_delta: round1(sensorDelta),
      error_correction: round1(pidResult.errorCorrection ?? 0),
      p_correction: round1(pidResult.pCorrection ?? 0),
      i_correction: round1(pidResult.iCorrection ?? 0),
      learned_baseline: round1(pidResult.learnedBaseline ?? 0),
      damping: round1(pidResult.dampingFactor),
      raw_ctrl_target_pid: round1(dualSensor.baseTarget + (pidResult.errorCorrection ?? 0)),
      pill_rate: pidResult.pillRate != null ? round1(pidResult.pillRate) : null,
      mode: pidMode,
      step_type: stepType,
      cooling_util: coolingUtil != null ? Math.round(coolingUtil * 100) : null,
      recent_util: recentUtil != null ? Math.round(recentUtil * 100) : null,
      ...(constraintLabels.length > 0 ? { limits: constraintLabels } : {}),
    })

    const pidDiff = Math.round(Math.abs(ctrlTargetPid - ctrlTarget) * 10) / 10

    // ── Duty-cycle PWM burst (hardware-only model) ──
    // PWM sends 0°C to RAPT hardware but does NOT update DB target_temp.
    // This keeps the DB state clean — "Mål" always shows the real PID target.
    // PID is completely locked during active PWM cycles (checked at loop start).
    //
    // The PWM OFF revert sends the PID-compensated target back to hardware.
    // Since DB target_temp was never changed, no DB update is needed on revert either.
    if (isPwmMode && pwmDutySeconds > 0) {
      // Use ctrlTargetPid (PID-compensated target) as revert so that the integral's
      // correction actually takes effect after the burst.
      // Without this, the integral builds up but the hardware target never changes,
      // causing permanent ~0.2°C undershoot.
      // Safety: clamp to hardware limits to prevent aggressive values.
      const pidRevert = Math.max(fc.min_target_temp ?? -5, Math.min(fc.max_target_temp ?? 25, round1(ctrlTargetPid)))
      const offTarget = pidRevert
      const onTarget = 0

      const dutySeconds = pwmDutySeconds

      log('DUTY_PWM_BURST', 'action', `${fc.name}: duty ${pwmDutyPct}% → ${dutySeconds}s burst av 300s (hw=${onTarget}°C, db behåller ${ctrlTarget}°, revert=${offTarget}°C nästa cykel)`, {
        duty_pct: pwmDutyPct,
        duty_seconds: dutySeconds,
        on_target: onTarget,
        off_target: offTarget,
        pid_diff: pidDiff,
      })

      // 1. Send ON to hardware ONLY — skip DB sync so target_temp stays at real value
      if (ctx.updateBatch) {
        ctx.updateBatch.addHardwareOnly(fc.controller_id, onTarget, offTarget)
      } else {
        // Fallback: send directly to RAPT without DB update
        await setControllerTargetTemp(ctx.supabaseUrl, ctx.serviceRoleKey, fc.controller_id, onTarget)
      }

      // 1b. Persist PID-corrected target to DB so next cycle sees the updated value.
      // This is the key mechanism: the integral builds up → ctrlTargetPid rises →
      // DB target_temp rises → hardware revert target rises → offset eliminated.
      if (offTarget !== ctrlTarget) {
        await supabase.from('rapt_temp_controllers')
          .update({ target_temp: offTarget, updated_at: new Date().toISOString() })
          .eq('controller_id', fc.controller_id)
        log('PWM_DB_SYNC', 'info', `${fc.name}: DB target_temp ${ctrlTarget}° → ${offTarget}° (PID-korrigerad)`)
      }

      // PWM ON is documented by DUTY_PWM_BURST + RAPT_SEND decisions — no separate adjustment log needed

      // 2. Schedule PWM OFF via pending_rapt_retries with execute_at
      //    pg_cron runs execute-pwm-off every minute which picks up due rows.
      const executeAt = new Date(Date.now() + dutySeconds * 1000).toISOString()
      await supabase.from('pending_rapt_retries')
        .delete()
        .eq('controller_id', fc.controller_id)
        .like('reason', '%PWM OFF%')
      await supabase.from('pending_rapt_retries').insert({
        controller_id: fc.controller_id,
        target_temp: offTarget,
        reason: `⚡ PWM OFF: hw → ${offTarget}° (${dutySeconds}s burst, ${pwmDutyPct}% duty)`,
        execute_at: executeAt,
      })

      // 4. Reset P-term only — it's invalid during PWM burst (probe cooled artificially by 0°C).
      // Keep accumulated_integral: it represents the learned offset needed to
      // compensate for cooling asymmetry (e.g. glycol cools fast, warms slow → systematic undershoot).
      // Zeroing it causes permanent ~0.2°C undershoot because the integral never gets time to build.
      await supabase.from('controller_learned_compensation')
        .update({ latest_p_correction: 0, updated_at: new Date().toISOString() })
        .eq('controller_id', fc.controller_id)
      log('PID_PARTIAL_RESET', 'info', `${fc.name}: P-term nollställd inför PWM (integral bevarad)`)

      adjustments.push({ cooler: fc.name, oldTarget: ctrlTarget, newTarget: onTarget })

      // DO NOT mutate in-memory target_temp — DB and in-memory stay at the real PID value.
      // The cooler will see the real target, not the temporary 0°C.

      continue
    } else if (isPwmMode && pwmDutySeconds === 0) {
      // Phase B of a low duty (e.g. 10%) — no burst this cycle, just log
      log('DUTY_PWM_SKIP', 'info', `${fc.name}: PWM ${pwmDutyPct}% fas B — ingen burst denna cykel`)
      continue
    }

    // ── No-op: PID diff too small to justify an update ──────
    // 0.1° is the minimum displayable change (round1). At exactly 0.1°,
    // the hardware often already has this value from API latency, making the call redundant.
    if (pidDiff <= 0.1) {
      continue
    }

    // ── No-op guard: skip if we already applied this exact target ─────
    // Prevents duplicate "PID 5.8→5.7" log entries when the PID
    // recalculates the same compensation across consecutive cycles
    // but RAPT hardware hasn't confirmed the change yet (API latency).
    const { data: lastAdj } = await supabase
      .from('auto_cooling_adjustments')
      .select('new_target_temp')
      .eq('cooler_controller_id', fc.controller_id)
      .like('reason', '%PID%')
      .order('created_at', { ascending: false })
      .limit(1)
    
    if (lastAdj?.[0] && Math.abs(ctrlTargetPid - lastAdj[0].new_target_temp) < 0.05) {
      log('PID_SKIP', 'info', `${fc.name}: Target already at ${ctrlTargetPid}°C from previous cycle, skipping duplicate`)
      continue
    }

    const learnedInfo = pidResult.learnedBaseline > 0 ? `, learned=${pidResult.learnedBaseline.toFixed(2)}[${pidResult.deltaBucket}]n=${pidResult.convergenceCount}` : ''
    const piTermInfo = pidResult.errorCorrection !== 0 ? `, PI=${pidResult.errorCorrection >= 0 ? '+' : ''}${pidResult.errorCorrection.toFixed(2)}°C(P=${pidResult.pCorrection?.toFixed(2) ?? '0'},I=${pidResult.iCorrection?.toFixed(2) ?? '0'}${learnedInfo})` : ''
    const probeRateInfo = pidResult.probeRate != null ? `, probeRate=${pidResult.probeRate.toFixed(2)}°/h` : ''
    const dTermInfo = pidResult.dampingFactor < 1.0
      ? `, D-term: rate=${pidResult.pillRate?.toFixed(2) ?? '?'}°/h${probeRateInfo}, ETA=${pidResult.etaMinutes ?? '?'}min, damp=${pidResult.dampingFactor.toFixed(2)}${piTermInfo}`
      : `, D-term: rate=${pidResult.pillRate?.toFixed(2) ?? '?'}°/h${probeRateInfo}, damp=1.0${piTermInfo}`
    const constraintInfo = pidResult.constraints && pidResult.constraints.length > 0 ? `, limits=[${pidResult.constraints.join(',')}]` : ''

    log('PILL_COMP_ACTION', 'action', `${fc.name}: PID ${actualTarget.toFixed(1)}°C → ${ctrlTargetPid.toFixed(1)}°C (delta=${pidResult.avgDelta.toFixed(2)}, komp=${pidResult.compensation.toFixed(2)}°C${dTermInfo}${constraintInfo})`)

    // Queue update in batch (or send immediately if no batch)
    let success: boolean
    if (ctx.updateBatch) {
      ctx.updateBatch.add(fc.controller_id, ctrlTargetPid, ctrlTarget)
      success = true // Optimistic for in-memory + logging; DB write deferred to batch flush
    } else {
      success = await setControllerTargetTemp(supabaseUrl, serviceRoleKey, fc.controller_id, ctrlTargetPid)
    }

    if (success) {
      log('PILL_COMP_ACTION', 'pass', `Set ${fc.name} to ${ctrlTargetPid}°C${ctx.updateBatch ? ' (batched)' : ''}`)
      adjustments.push({ cooler: fc.name, oldTarget: ctrlTarget, newTarget: ctrlTargetPid })

      // Only write to DB immediately when NOT batching.
      if (!ctx.updateBatch) {
        await supabase.from('rapt_temp_controllers')
          .update({ target_temp: ctrlTargetPid, updated_at: new Date().toISOString() })
          .eq('controller_id', fc.controller_id)
      }

      await logAdjustment(supabase, {
        cooler_controller_id: fc.controller_id,
        cooler_controller_name: fc.name,
        old_target_temp: ctrlTarget,
        new_target_temp: ctrlTargetPid,
        original_target_temp: actualTarget,
        lowest_followed_temp: actualTarget,
        followed_controller_id: fc.controller_id,
        followed_controller_name: fc.name,
        followed_current_temp: parseFloat(String(fc.pill_temp ?? fc.current_temp ?? '0')),
        followed_target_temp: parseFloat(String(fc.current_temp ?? '0')),
        followed_hysteresis: pidResult.avgDelta,
        reason: `🎯 PID: ${actualTarget.toFixed(1)}°C → ${ctrlTargetPid.toFixed(1)}°C (delta=${pidResult.avgDelta.toFixed(2)}, komp=${pidResult.compensation.toFixed(2)}°C${dTermInfo}${constraintInfo})`,
        adjusted_against_timestamp: fc.last_update,
      })
    } else {
      log('PILL_COMP_ACTION', 'fail', `Failed to update ${fc.name}`)
    }
  }

  return adjustments
}

// Smart Relay was removed — RAPT API does not support relay/hysteresis control for TemperatureControllers.

// ─── Stall Detection ─────────────────────────────────────────

async function runStallDetection(ctx: ControllerAdjustmentContext): Promise<AdjustmentResult[]> {
  const { stallSettings, log } = ctx

  if (!stallSettings.enabled) {
    log('STALL', 'info', 'Stall detection disabled')
    return []
  }

  const stallCtx: StallContext = {
    supabase: ctx.supabase,
    supabaseUrl: ctx.supabaseUrl,
    serviceRoleKey: ctx.serviceRoleKey,
    followedControllersFullData: ctx.followedControllersFullData,
    profileOwnedControllerIds: ctx.profileOwnedControllerIds,
    profileTargetMap: ctx.profileTargetMap,
    sessionBrewIdMap: ctx.sessionBrewIdMap,
    log,
    updateBatch: ctx.updateBatch,
  }

  await evaluateBoostOutcomes(stallCtx, ctx.stallSettings)
  return await detectAndHandleStalls(stallCtx, ctx.stallSettings)
}
