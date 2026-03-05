import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { round1, TempController, setControllerTargetTemp, loadPillCompSettings, calculateCompensatedTarget, RaptUpdateBatch } from './temp-utils.ts'
import { logAdjustment, AdjustmentResult } from './adjustment-logger.ts'
import { evaluateBoostOutcomes, detectAndHandleStalls, StallSettings, StallContext } from './stall-detection.ts'
import { calculateSingleUtilization } from './cooler-management.ts'
import { getTempBucket, getLearnedParam } from './learning-utils.ts'

// ============================================================
// Controller Adjustments — Pipeline Architecture
//
// SSOT: profile_target_temp is the user's desired temperature.
//       target_temp is what gets sent to the hardware.
//
// Pipeline:
//   1. Bootstrap — ensure profile_target_temp is set for all controllers
//   2. Processors — each can modify the desired target (pill-comp, future...)
//   3. Pass-through — sync target_temp = profile_target_temp for untouched controllers
//   4. Stall detection — separate concern, acts on resolved targets
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
}

/**
 * Run all controller-level adjustments via the pipeline.
 * Returns adjustment results and mutates followedControllersFullData in-memory
 * so downstream consumers (cooler) see updated targets.
 */
export async function runControllerAdjustments(ctx: ControllerAdjustmentContext): Promise<AdjustmentResult[]> {
  const adjustments: AdjustmentResult[] = []

  // ── Step 1: Bootstrap profile_target_temp ──────────────────
  // Ensure every controller has a valid SSOT target, regardless of
  // which processors are enabled. This runs ONCE per controller.
  await bootstrapProfileTargets(ctx)

  // ── Step 2: Run processors (each is independently toggleable) ─
  const processorAdjs = await runProcessors(ctx)
  adjustments.push(...processorAdjs)

  // Track which controllers were modified by any processor
  const adjustedControllerNames = new Set(processorAdjs.map(a => a.cooler))

  // Sync in-memory data so downstream sees current targets
  for (const adj of processorAdjs) {
    const fc = ctx.followedControllersFullData.find(c => c.name === adj.cooler)
    if (fc) {
      (fc as any).target_temp = adj.newTarget
    }
  }

  // ── Step 3: Pass-through sync ─────────────────────────────
  // For any controller NOT touched by a processor, ensure
  // target_temp matches profile_target_temp. This is what makes
  // the system work with zero processors enabled.
  const passThroughAdjs = await runPassThroughSync(ctx, adjustedControllerNames, ctx.pillCompSettings)
  adjustments.push(...passThroughAdjs)

  // Sync in-memory for pass-through too
  for (const adj of passThroughAdjs) {
    const fc = ctx.followedControllersFullData.find(c => c.name === adj.cooler)
    if (fc) {
      (fc as any).target_temp = adj.newTarget
    }
  }

  // ── Step 4: Stall Detection (separate concern) ────────────
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

// ─── Pass-through Sync ───────────────────────────────────────

async function runPassThroughSync(
  ctx: ControllerAdjustmentContext,
  adjustedControllerNames: Set<string>,
  pillCompSettings: { enabled: boolean },
): Promise<AdjustmentResult[]> {
  const { supabase, followedControllersFullData, log } = ctx
  const adjustments: AdjustmentResult[] = []

  for (const fc of followedControllersFullData) {
    // Skip controllers already handled by a processor
    if (adjustedControllerNames.has(fc.name)) continue
    if (!fc.heating_enabled && !fc.cooling_enabled) continue

    // Skip controllers that are owned by PID control.
    // When PID skips a cycle (same-data guard), pass-through must NOT
    // overwrite the PID-compensated target_temp back to profile_target_temp.
    // PID is the sole owner of target_temp for controllers with active temp control.
    if (fc.heating_enabled || fc.cooling_enabled) continue

    const profileTarget = (fc as any).profile_target_temp
    if (profileTarget == null) continue

    const currentTarget = parseFloat(String(fc.target_temp ?? '20'))
    const desiredTarget = parseFloat(String(profileTarget))

    // Already in sync
    if (Math.abs(desiredTarget - currentTarget) < 0.1) continue

    // Same-data guard for pass-through: skip if RAPT data hasn't changed
    const lastAdjTs = ctx.lastAdjTimestampMap.get(fc.controller_id)
    if (lastAdjTs && fc.last_update && lastAdjTs === fc.last_update) {
      // But still sync if profile target diverged (e.g. profile step change)
      if (Math.abs(desiredTarget - currentTarget) < 0.5) continue
    }

    // Respect hardware bounds
    const maxTemp = parseFloat(String(fc.max_target_temp ?? '25'))
    const hwMinTemp = parseFloat(String(fc.min_target_temp ?? '-5'))
    const newTarget = Math.max(hwMinTemp, Math.min(maxTemp, desiredTarget))

    log('PASS_THROUGH', 'action', `${fc.name}: Syncing target_temp ${currentTarget.toFixed(1)}°C → ${newTarget.toFixed(1)}°C (profile_target_temp = ${desiredTarget.toFixed(1)}°C)`)

    // Queue update in batch (or send immediately)
    let success: boolean
    if (ctx.updateBatch) {
      ctx.updateBatch.add(fc.controller_id, newTarget, currentTarget)
      success = true // Optimistic for in-memory + logging; DB write deferred to batch flush
    } else {
      success = await setControllerTargetTemp(ctx.supabaseUrl, ctx.serviceRoleKey, fc.controller_id, newTarget)
    }

    if (success) {
      adjustments.push({ cooler: fc.name, oldTarget: currentTarget, newTarget })

      // Only write to DB immediately when NOT batching (see PID comment above)
      if (!ctx.updateBatch) {
        await supabase.from('rapt_temp_controllers')
          .update({ target_temp: newTarget, updated_at: new Date().toISOString() })
          .eq('controller_id', fc.controller_id)
      }

      await logAdjustment(supabase, {
        cooler_controller_id: fc.controller_id,
        cooler_controller_name: fc.name,
        old_target_temp: currentTarget,
        new_target_temp: newTarget,
        original_target_temp: desiredTarget,
        lowest_followed_temp: desiredTarget,
        followed_controller_id: fc.controller_id,
        followed_controller_name: fc.name,
        followed_current_temp: parseFloat(String(fc.current_temp ?? '0')),
        followed_target_temp: parseFloat(String(fc.current_temp ?? '0')),
        followed_hysteresis: 0,
        reason: `🔄 Pass-through: profile_target_temp ${desiredTarget.toFixed(1)}°C → target_temp ${newTarget.toFixed(1)}°C`,
        adjusted_against_timestamp: fc.last_update,
      })
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

  for (const fc of followedControllersFullData) {
    const isProfileOwned = profileOwnedControllerIds.has(fc.controller_id)

    if (cooloffControllerIds.has(fc.controller_id)) {
      log('PID_SKIP', 'info', `${fc.name}: 30min cooloff active, skipping PID`)
      continue
    }
    if (!fc.heating_enabled && !fc.cooling_enabled) continue

    const ctrlTarget = parseFloat(String(fc.target_temp ?? '20'))

    // PID always runs every cycle — no same-data guard.
    // Even if RAPT telemetry hasn't changed, the PID integral and learned
    // baselines evolve, so skipping would allow drift.

    // Actual target from SSOT (already bootstrapped)
    const actualTarget = parseFloat(String((fc as any).profile_target_temp))

    // Pre-calculate actual_temp: dual sensors ON + pill available → average, otherwise probe
    const hasDualSensors = pillCompSettings.enabled && fc.pill_temp != null
    const probeTemp = fc.current_temp ?? fc.pill_temp ?? ctrlTarget
    const actualTemp = hasDualSensors
      ? ((fc.pill_temp! + (fc.current_temp ?? fc.pill_temp!)) / 2)
      : probeTemp

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

        if (dutyParam.sampleCount >= 5 && dutyParam.value > 0.05 && dutyParam.value < 0.60) {
            isPwmMode = true
            isPwmActiveSegment = true // burst model: always "active" — run-automation handles timing
            pwmDutyPct = Math.round(dutyParam.value * 100)
            // Burst duration: duty% of 300s cycle, min 30s, max 240s
            pwmDutySeconds = Math.max(30, Math.min(240, Math.round(dutyParam.value * 300)))
        }
      }
    } else if (prevStableCount > 0) {
      // Temperature drifted — reset counter
      await supabase.from('rapt_temp_controllers')
        .update({ pwm_stable_count: 0 })
        .eq('controller_id', fc.controller_id)
    }

    const pidResult = await calculateCompensatedTarget(
      supabase, fc.controller_id, actualTarget, ctrlTarget,
      fc.name || fc.controller_id, pillCompSettings, pidMode, stepType,
      actualTemp, probeTemp, coolingUtil, rampContext, isPwmActiveSegment
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
      const avgError = actualTarget - actualTemp
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

    // Effective delta: what actually gets subtracted from profile to reach ctrl_target_pid
    // This ensures Profil - Δ + PI = Nytt mål always balances in the UI
    const effectiveDelta = round1(actualTarget - ctrlTargetPid + round1(pidResult.errorCorrection ?? 0))

    log('PILL_COMP_STATUS', 'info', `Controller: ${fc.name}`, {
      pill_temp: pillTempLog,
      probe_temp: probeTempLog,
      actual_temp: avgTemp,
      dual_sensors: hasDualSensors,
      actual_target: round1(actualTarget),
      ctrl_target: round1(ctrlTarget),
      ctrl_target_pid: round1(ctrlTargetPid),
      delta: effectiveDelta,
      raw_delta: round1(pidResult.avgDelta),
      raw_compensation: round1(pidResult.avgDelta),
      compensation: round1(pidResult.compensation),
      error_correction: round1(pidResult.errorCorrection ?? 0),
      p_correction: round1(pidResult.pCorrection ?? 0),
      i_correction: round1(pidResult.iCorrection ?? 0),
      learned_baseline: round1(pidResult.learnedBaseline ?? 0),
      damping: round1(pidResult.dampingFactor),
      raw_ctrl_target_pid: round1(actualTarget - pidResult.compensation + (pidResult.errorCorrection ?? 0)),
      pill_rate: pidResult.pillRate != null ? round1(pidResult.pillRate) : null,
      mode: pidMode,
      step_type: stepType,
      cooling_util: coolingUtil != null ? Math.round(coolingUtil * 100) : null,
      recent_util: recentUtil != null ? Math.round(recentUtil * 100) : null,
      ...(constraintLabels.length > 0 ? { limits: constraintLabels } : {}),
    })

    const pidDiff = Math.round(Math.abs(ctrlTargetPid - ctrlTarget) * 10) / 10

    // ── Duty-cycle PWM burst (cycle-aligned model) ──
    // ON is sent immediately via updateBatch. OFF is stored as a pending revert
    // in pending_rapt_retries and handled by auto-adjust-cooling next cycle.
    // This eliminates the need for sleeping inside edge functions (timeout-safe).
    if (isPwmMode) {
      const offTarget = round1(ctrlTarget)
      const onTarget = 0

      const dutySeconds = Math.max(30, Math.min(240, Math.round(pwmDutyPct / 100 * 300)))

      log('DUTY_PWM_BURST', 'action', `${fc.name}: duty ${pwmDutyPct}% → ${dutySeconds}s burst av 300s (on=${onTarget}°C, revert=${offTarget}°C nästa cykel)`, {
        duty_pct: pwmDutyPct,
        duty_seconds: dutySeconds,
        on_target: onTarget,
        off_target: offTarget,
        pid_diff: pidDiff,
      })

      // 1. Send ON immediately via batch (batch handles DB sync on flush)
      if (ctx.updateBatch) {
        ctx.updateBatch.add(fc.controller_id, onTarget, ctrlTarget)
      } else {
        const sent = await setControllerTargetTemp(ctx.supabaseUrl, ctx.serviceRoleKey, fc.controller_id, onTarget)
        if (sent) {
          await supabase.from('rapt_temp_controllers')
            .update({ target_temp: onTarget, updated_at: new Date().toISOString() })
            .eq('controller_id', fc.controller_id)
        }
      }

      // Log the ON adjustment
      await logAdjustment(supabase, {
        cooler_controller_id: fc.controller_id,
        cooler_controller_name: fc.name,
        old_target_temp: ctrlTarget,
        new_target_temp: onTarget,
        lowest_followed_temp: onTarget,
        reason: `⚡ PWM ${pwmDutyPct}% ON: ${ctrlTarget}° → ${onTarget}°`,
        original_target_temp: actualTarget,
      })

      // 2. Store revert as pending retry — next cycle will restore off_target
      // Delete any existing PWM reverts for this controller first to avoid stacking
      await supabase.from('pending_rapt_retries')
        .delete()
        .eq('controller_id', fc.controller_id)
        .like('reason', '%PWM OFF%')
      await supabase.from('pending_rapt_retries').insert({
        controller_id: fc.controller_id,
        target_temp: offTarget,
        reason: `⚡ PWM OFF: → ${offTarget}°`,
      })

      adjustments.push({ cooler: fc.name, oldTarget: ctrlTarget, newTarget: onTarget })

      // Sync in-memory so cooler sees the ON target
      ;(fc as any).target_temp = onTarget

      continue
    }

    // ── No-op: PID diff too small to justify an update ──────
    if (pidDiff < 0.1) {
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
