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

    // Mode detection: cooling controllers ALWAYS use duty-cycle model (even when probe < target).
    // Only use heating mode for controllers that have heating enabled but NOT cooling.
    const pidMode: 'heating' | 'cooling' = fc.cooling_enabled ? 'cooling'
      : fc.heating_enabled ? 'heating'
      : (fc.current_temp ?? 0) < ctrlTarget ? 'heating' : 'cooling'
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

    // === PID Calculation ===
    const pidResult = await calculateCompensatedTarget(
      supabase, fc.controller_id, dualSensor.baseTarget, actualTarget, ctrlTarget,
      fc.name || fc.controller_id, pillCompSettings, pidMode, stepType,
      actualTemp, probeTemp, coolingUtil, rampContext, false, ctx.skipLearning,
    )

    // Log PID status
    const pillTempLog = round1(fc.pill_temp ?? 0)
    const probeTempLog = round1(fc.current_temp ?? 0)
    const avgTemp = round1(actualTemp)
    const constraintLabels = pidResult.constraints && pidResult.constraints.length > 0 ? pidResult.constraints : []
    const effectiveDelta = round1(sensorDelta)

    log('PILL_COMP_STATUS', 'info', `Controller: ${fc.name}`, {
      pill_temp: pillTempLog,
      probe_temp: probeTempLog,
      actual_temp: avgTemp,
      dual_sensors: hasDualSensors,
      actual_target: round1(actualTarget),
      ctrl_target: round1(ctrlTarget),
      ctrl_target_pid: round1(pidResult.ctrlTargetPid),
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
      duty_cycle: pidResult.dutyCycle != null ? Math.round(pidResult.dutyCycle * 100) : undefined,
      cooling_util: coolingUtil != null ? Math.round(coolingUtil * 100) : null,
      recent_util: recentUtil != null ? Math.round(recentUtil * 100) : null,
      ...(constraintLabels.length > 0 ? { limits: constraintLabels } : {}),
    })

    // ═══════════════════════════════════════════════════
    // COOLING: Unified PWM duty cycle execution
    // PID output is a duty cycle (0–100%). Hardware is controlled
    // via PWM bursts: 0°C = cooling ON, baseTarget = cooling OFF.
    // ═══════════════════════════════════════════════════
    if (pidMode === 'cooling' && pidResult.dutyCycle != null) {
      if (!fc.cooling_enabled) {
        log('DUTY_SKIP', 'info', `${fc.name}: cooling not enabled, skipping duty cycle`)
        continue
      }

      const dutyRaw = pidResult.dutyCycle
      // 2-cycle model: 10%-resolution over 10-min (2×5-min) window
      const dutyPct = Math.round(dutyRaw * 10) * 10
      const totalBurstMin = dutyPct / 10
      const phase = Math.floor(Date.now() / 300000) % 2
      const currentBurstMin = phase === 0 ? Math.ceil(totalBurstMin / 2) : Math.floor(totalBurstMin / 2)
      const burstSeconds = currentBurstMin * 60
      const revertTarget = round1(dualSensor.baseTarget)

      if (dutyPct >= 100) {
        // 100%: hold 0°C entire cycle (no revert needed)
        log('DUTY_FULL', 'action', `${fc.name}: duty 100% → 0°C hela cykeln`, { duty_pct: 100 })
        if (ctx.updateBatch) {
          ctx.updateBatch.addHardwareOnly(fc.controller_id, 0, revertTarget)
        } else {
          await setControllerTargetTemp(ctx.supabaseUrl, ctx.serviceRoleKey, fc.controller_id, 0)
        }
        await supabase.from('pending_rapt_retries')
          .delete().eq('controller_id', fc.controller_id).like('reason', '%PWM OFF%')
        await supabase.from('rapt_temp_controllers')
          .update({ target_temp: revertTarget, updated_at: new Date().toISOString() })
          .eq('controller_id', fc.controller_id)
        adjustments.push({ cooler: fc.name, oldTarget: ctrlTarget, newTarget: 0 })
        ctx.pwmBursts.push({ controller_id: fc.controller_id, controller_name: fc.name, on_target: 0, off_target: revertTarget, duty_seconds: 300, duty_pct: 100 })
      } else if (burstSeconds > 0) {
        // 10-90%: burst at 0°C, schedule revert to baseTarget
        log('DUTY_BURST', 'action', `${fc.name}: duty ${dutyPct}% → ${burstSeconds}s burst (revert=${revertTarget}°)`, {
          duty_pct: dutyPct, duty_seconds: burstSeconds, on_target: 0, off_target: revertTarget,
        })
        if (ctx.updateBatch) {
          ctx.updateBatch.addHardwareOnly(fc.controller_id, 0, revertTarget)
        } else {
          await setControllerTargetTemp(ctx.supabaseUrl, ctx.serviceRoleKey, fc.controller_id, 0)
        }
        await supabase.from('rapt_temp_controllers')
          .update({ target_temp: revertTarget, updated_at: new Date().toISOString() })
          .eq('controller_id', fc.controller_id)
        const executeAt = new Date(Date.now() + burstSeconds * 1000).toISOString()
        await supabase.from('pending_rapt_retries')
          .delete().eq('controller_id', fc.controller_id).like('reason', '%PWM OFF%')
        await supabase.from('pending_rapt_retries').insert({
          controller_id: fc.controller_id,
          target_temp: revertTarget,
          reason: `⚡ PWM OFF: hw → ${revertTarget}° (${burstSeconds}s burst, ${dutyPct}% duty)`,
          execute_at: executeAt,
        })
        // Reset P-term during burst (probe drops artificially from 0°C target)
        await supabase.from('controller_learned_compensation')
          .update({ latest_p_correction: 0, updated_at: new Date().toISOString() })
          .eq('controller_id', fc.controller_id)
        adjustments.push({ cooler: fc.name, oldTarget: ctrlTarget, newTarget: 0 })
        ctx.pwmBursts.push({ controller_id: fc.controller_id, controller_name: fc.name, on_target: 0, off_target: revertTarget, duty_seconds: burstSeconds, duty_pct: dutyPct })
      } else {
        // 0% or phase B idle
        if (dutyPct === 0) {
          log('DUTY_ZERO', 'info', `${fc.name}: duty 0% — ingen kylning`)
          // Ensure hardware target is at baseTarget (cooling OFF)
          if (Math.abs(ctrlTarget - revertTarget) >= 0.1) {
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
        } else {
          log('DUTY_PHASE_B', 'info', `${fc.name}: PWM ${dutyPct}% fas B — ingen burst denna cykel`)
        }
      }
      continue
    }

    // ═══════════════════════════════════════════════════
    // HEATING: Target-based PID (unchanged logic)
    // RAPT hardware manages heating relay via its own hysteresis.
    // ═══════════════════════════════════════════════════
    if (pidMode !== 'heating') continue // Edge case: cooling without cooling_enabled

    const maxTemp = parseFloat(String(fc.max_target_temp ?? '25'))
    const hwMinTemp = parseFloat(String(fc.min_target_temp ?? '-5'))
    const unclamped = pidResult.ctrlTargetPid
    let ctrlTargetPid = round1(Math.max(hwMinTemp, Math.min(maxTemp, unclamped)))
    if (unclamped < hwMinTemp) { pidResult.constraints = pidResult.constraints ?? []; pidResult.constraints.push(`hw-min=${hwMinTemp}`) }
    if (unclamped > maxTemp) { pidResult.constraints = pidResult.constraints ?? []; pidResult.constraints.push(`hw-max=${maxTemp}`) }

    // Heater activation guard
    if (fc.heating_enabled && fc.heating_hysteresis != null) {
      const heatingHyst = parseFloat(String(fc.heating_hysteresis))
      const heaterThreshold = probeTemp + heatingHyst - 0.1
      const heatError = dualSensor.baseTarget - actualTemp
      if (Math.abs(heatError) < 1.0 && ctrlTargetPid > heaterThreshold) {
        const before = ctrlTargetPid
        ctrlTargetPid = Math.max(ctrlTarget, heaterThreshold)
        pidResult.constraints = pidResult.constraints ?? []
        pidResult.constraints.push(`heat-guard=${heatingHyst}`)
        console.log(`🔥 Heater guard ${fc.name}: capped ${before.toFixed(1)}→${ctrlTargetPid.toFixed(1)}°C`)
      }
    }

    const pidDiff = Math.round(Math.abs(ctrlTargetPid - ctrlTarget) * 10) / 10
    if (pidDiff < 0.1) continue

    // Duplicate guard
    const { data: lastAdj } = await supabase
      .from('auto_cooling_adjustments')
      .select('new_target_temp')
      .eq('cooler_controller_id', fc.controller_id)
      .like('reason', '%PID%')
      .order('created_at', { ascending: false })
      .limit(1)
    if (lastAdj?.[0] && Math.abs(ctrlTargetPid - lastAdj[0].new_target_temp) < 0.05) {
      log('PID_SKIP', 'info', `${fc.name}: Target already at ${ctrlTargetPid}°C, skipping duplicate`)
      continue
    }

    const piInfo = `PI=${(pidResult.errorCorrection ?? 0) >= 0 ? '+' : ''}${(pidResult.errorCorrection ?? 0).toFixed(2)}°C`
    const heatConstraintInfo = constraintLabels.length > 0 ? `, limits=[${constraintLabels.join(',')}]` : ''
    log('PID_HEATING', 'action', `${fc.name}: PID ${actualTarget.toFixed(1)}°C → ${ctrlTargetPid.toFixed(1)}°C (${piInfo}${heatConstraintInfo})`)

    let success: boolean
    if (ctx.updateBatch) {
      ctx.updateBatch.add(fc.controller_id, ctrlTargetPid, ctrlTarget)
      success = true
    } else {
      success = await setControllerTargetTemp(supabaseUrl, serviceRoleKey, fc.controller_id, ctrlTargetPid)
    }

    if (success) {
      log('PID_HEATING', 'pass', `Set ${fc.name} to ${ctrlTargetPid}°C${ctx.updateBatch ? ' (batched)' : ''}`)
      adjustments.push({ cooler: fc.name, oldTarget: ctrlTarget, newTarget: ctrlTargetPid })
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
        reason: `🎯 PID: ${actualTarget.toFixed(1)}°C → ${ctrlTargetPid.toFixed(1)}°C (heating, ${piInfo}${heatConstraintInfo})`,
        adjusted_against_timestamp: fc.last_update,
      })
    } else {
      log('PID_HEATING', 'fail', `Failed to update ${fc.name}`)
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
