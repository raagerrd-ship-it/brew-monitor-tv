import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { round1, TempController, setControllerTargetTemp, loadPillCompSettings, calculateCompensatedTarget, RaptUpdateBatch } from './temp-utils.ts'
import { logAdjustment, AdjustmentResult } from './adjustment-logger.ts'
import { evaluateBoostOutcomes, detectAndHandleStalls, StallSettings, StallContext } from './stall-detection.ts'

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
  const { supabase, followedControllersFullData, log } = ctx

  for (const fc of followedControllersFullData) {
    if ((fc as any).profile_target_temp != null) continue
    if (!fc.heating_enabled && !fc.cooling_enabled) continue

    const targetTemp = parseFloat(String(fc.target_temp ?? '20'))
    log('BOOTSTRAP', 'info', `${fc.name}: Setting profile_target_temp = ${targetTemp}°C from target_temp`)
    
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
    runPillCompensation,
    // Future: runThermalModelProcessor,
    // Future: runExternalSensorProcessor,
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

    // Skip controllers that are owned by PID pill-compensation.
    // When PID skips a cycle (same-data guard), pass-through must NOT
    // overwrite the PID-compensated target_temp back to profile_target_temp.
    // PID is the sole owner of target_temp for these controllers.
    if (pillCompSettings.enabled && fc.pill_temp != null) continue

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

// ─── PID Pill Compensation (Processor) ───────────────────────

async function runPillCompensation(ctx: ControllerAdjustmentContext): Promise<AdjustmentResult[]> {
  const {
    supabase, supabaseUrl, serviceRoleKey,
    followedControllersFullData, profileOwnedControllerIds,
    cooloffControllerIds, profileStatusMap, lastAdjTimestampMap,
    pillCompSettings, log,
  } = ctx
  const adjustments: AdjustmentResult[] = []

  if (!pillCompSettings.enabled) {
    log('PILL_COMP', 'info', 'Pill compensation disabled')
    return adjustments
  }

  log('PILL_COMP', 'info', 'PID pill compensation check')

  for (const fc of followedControllersFullData) {
    const isProfileOwned = profileOwnedControllerIds.has(fc.controller_id)

    if (cooloffControllerIds.has(fc.controller_id)) {
      log('PILL_COMP_SKIP', 'info', `${fc.name}: 30min cooloff active, skipping pill-comp`)
      continue
    }
    if (!fc.heating_enabled && !fc.cooling_enabled) continue
    if (fc.pill_temp === null || fc.pill_temp === undefined) continue

    const targetTemp = parseFloat(String(fc.target_temp ?? '20'))

    // PID always runs every cycle — no same-data guard.
    // Even if RAPT telemetry hasn't changed, the PID integral and learned
    // baselines evolve, so skipping would allow drift.

    // Base target from SSOT (already bootstrapped)
    const baseTarget = parseFloat(String((fc as any).profile_target_temp))

    const actualTemp = fc.pill_temp ?? fc.current_temp ?? targetTemp
    const pidMode: 'heating' | 'cooling' = actualTemp < baseTarget ? 'heating' : 'cooling'
    const profileStatus = profileStatusMap.get(fc.controller_id)
    const stepType = isProfileOwned ? (profileStatus?.currentStepType ?? (profileStatus ? 'profile' : 'unknown')) : 'standalone'

    const compensation = await calculateCompensatedTarget(
      supabase, fc.controller_id, baseTarget, targetTemp,
      fc.name || fc.controller_id, pillCompSettings, pidMode, stepType
    )

    // Safety bounds — respect hardware min/max strictly
    const maxTemp = parseFloat(String(fc.max_target_temp ?? '25'))
    const hwMinTemp = parseFloat(String(fc.min_target_temp ?? '-5'))
    const unclamped = compensation.compensatedTarget
    let newTarget = Math.max(hwMinTemp, Math.min(maxTemp, unclamped))

    // Track if hardware min/max clamped the target
    if (unclamped < hwMinTemp) {
      compensation.constraints = compensation.constraints ?? []
      compensation.constraints.push(`hw-min=${hwMinTemp}`)
    }
    if (unclamped > maxTemp) {
      compensation.constraints = compensation.constraints ?? []
      compensation.constraints.push(`hw-max=${maxTemp}`)
    }

    // Always log PID status for visibility in decision log
    const pillTemp = round1(fc.pill_temp ?? 0)
    const probeTemp = round1(fc.current_temp ?? 0)
    const avgTemp = round1(((fc.pill_temp ?? 0) + (fc.current_temp ?? 0)) / 2)
    const constraintLabels = compensation.constraints && compensation.constraints.length > 0 ? compensation.constraints : []

    log('PILL_COMP_STATUS', 'info', `Controller: ${fc.name}`, {
      pill_temp: pillTemp,
      probe_temp: probeTemp,
      avg_temp: avgTemp,
      base_target: round1(baseTarget),
      compensated_target: round1(newTarget),
      current_target: round1(targetTemp),
      delta: round1(compensation.avgDelta),
      compensation: round1(compensation.compensation),
      damping: round1(compensation.dampingFactor),
      pill_rate: compensation.pillRate != null ? round1(compensation.pillRate) : null,
      mode: pidMode,
      step_type: stepType,
      ...(constraintLabels.length > 0 ? { limits: constraintLabels } : {}),
    })

    if (Math.abs(newTarget - targetTemp) < 0.1) {
      continue
    }

    const learnedInfo = compensation.learnedBaseline > 0 ? `, learned=${compensation.learnedBaseline.toFixed(2)}[${compensation.deltaBucket}]n=${compensation.convergenceCount}` : ''
    const piTermInfo = compensation.errorCorrection !== 0 ? `, PI=${compensation.errorCorrection >= 0 ? '+' : ''}${compensation.errorCorrection.toFixed(2)}°C(P=${compensation.pCorrection?.toFixed(2) ?? '0'},I=${compensation.iCorrection?.toFixed(2) ?? '0'}${learnedInfo})` : ''
    const probeRateInfo = compensation.probeRate != null ? `, probeRate=${compensation.probeRate.toFixed(2)}°/h` : ''
    const dTermInfo = compensation.dampingFactor < 1.0
      ? `, D-term: rate=${compensation.pillRate?.toFixed(2) ?? '?'}°/h${probeRateInfo}, ETA=${compensation.etaMinutes ?? '?'}min, damp=${compensation.dampingFactor.toFixed(2)}${piTermInfo}`
      : `, D-term: rate=${compensation.pillRate?.toFixed(2) ?? '?'}°/h${probeRateInfo}, damp=1.0${piTermInfo}`
    const constraintInfo = compensation.constraints && compensation.constraints.length > 0 ? `, limits=[${compensation.constraints.join(',')}]` : ''

    log('PILL_COMP_ACTION', 'action', `${fc.name}: PID ${baseTarget.toFixed(1)}°C → ${newTarget.toFixed(1)}°C (delta=${compensation.avgDelta.toFixed(2)}, komp=${compensation.compensation.toFixed(2)}°C${dTermInfo}${constraintInfo})`)

    // Queue update in batch (or send immediately if no batch)
    let success: boolean
    if (ctx.updateBatch) {
      ctx.updateBatch.add(fc.controller_id, newTarget, targetTemp)
      success = true // Optimistic for in-memory + logging; DB write deferred to batch flush
    } else {
      success = await setControllerTargetTemp(supabaseUrl, serviceRoleKey, fc.controller_id, newTarget)
    }

    if (success) {
      log('PILL_COMP_ACTION', 'pass', `Set ${fc.name} to ${newTarget}°C${ctx.updateBatch ? ' (batched)' : ''}`)
      adjustments.push({ cooler: fc.name, oldTarget: targetTemp, newTarget })

      // Only write to DB immediately when NOT batching.
      // When batching, the batch flush handler persists to DB only after
      // RAPT hardware confirms the update — preventing optimistic writes
      // that get overwritten by stale hardware values on the next sync.
      if (!ctx.updateBatch) {
        await supabase.from('rapt_temp_controllers')
          .update({ target_temp: newTarget, updated_at: new Date().toISOString() })
          .eq('controller_id', fc.controller_id)
      }

      await logAdjustment(supabase, {
        cooler_controller_id: fc.controller_id,
        cooler_controller_name: fc.name,
        old_target_temp: targetTemp,
        new_target_temp: newTarget,
        original_target_temp: baseTarget,
        lowest_followed_temp: baseTarget,
        followed_controller_id: fc.controller_id,
        followed_controller_name: fc.name,
        followed_current_temp: parseFloat(String(fc.pill_temp ?? fc.current_temp ?? '0')),
        followed_target_temp: parseFloat(String(fc.current_temp ?? '0')),
        followed_hysteresis: compensation.avgDelta,
        reason: `🎯 Pill-kompensation: ${baseTarget.toFixed(1)}°C → ${newTarget.toFixed(1)}°C (delta=${compensation.avgDelta.toFixed(2)}, komp=${compensation.compensation.toFixed(2)}°C${dTermInfo}${constraintInfo})`,
        adjusted_against_timestamp: fc.last_update,
      })
    } else {
      log('PILL_COMP_ACTION', 'fail', `Failed to update ${fc.name}`)
    }
  }

  return adjustments
}

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
