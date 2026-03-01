import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { round1, TempController, setControllerTargetTemp, loadPillCompSettings, calculateCompensatedTarget, RaptUpdateBatch } from './temp-utils.ts'
import { logAdjustment, AdjustmentResult } from './adjustment-logger.ts'
import { evaluateBoostOutcomes, detectAndHandleStalls, StallSettings, StallContext } from './stall-detection.ts'

// ============================================================
// Controller Adjustments
//
// Adjusts individual tank controllers:
// 1. PID Pill Compensation — targets average of pill + probe
// 2. Stall Detection — adaptive boost when fermentation stalls
//
// These are tank-level adjustments. They never touch the cooler.
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
 * Run all controller-level adjustments (PID + Stall).
 * Returns adjustment results and mutates followedControllersFullData in-memory
 * so downstream consumers (cooler) see updated targets.
 */
export async function runControllerAdjustments(ctx: ControllerAdjustmentContext): Promise<AdjustmentResult[]> {
  const adjustments: AdjustmentResult[] = []

  // ── Feature 1: PID Pill Compensation ─────────────────────────
  const pidAdjs = await runPillCompensation(ctx)
  adjustments.push(...pidAdjs)

  // Sync in-memory data so stall detection sees current targets
  for (const adj of pidAdjs) {
    const fc = ctx.followedControllersFullData.find(c => c.name === adj.cooler)
    if (fc) {
      (fc as any).target_temp = adj.newTarget
    }
  }

  // ── Feature 2: Stall Detection ───────────────────────────────
  const stallAdjs = await runStallDetection(ctx)
  adjustments.push(...stallAdjs)

  return adjustments
}

// ─── PID Pill Compensation ───────────────────────────────────

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

  log('PILL_COMP', 'info', '--- PID pill compensation check ---')

  // Build original target map for non-profile controllers
  const pillCompOriginalTargetMap = new Map<string, number>()
  {
    const nonProfileIds = followedControllersFullData
      .filter(c => !profileOwnedControllerIds.has(c.controller_id))
      .map(c => c.controller_id)
    if (nonProfileIds.length > 0) {
      const { data: pillCompAdj } = await supabase
        .from('auto_cooling_adjustments')
        .select('cooler_controller_id, original_target_temp, created_at')
        .in('cooler_controller_id', nonProfileIds)
        .like('reason', '🎯%')
        .order('created_at', { ascending: true })
      if (pillCompAdj) {
        for (const adj of pillCompAdj) {
          if (!pillCompOriginalTargetMap.has(adj.cooler_controller_id) && adj.original_target_temp != null) {
            pillCompOriginalTargetMap.set(adj.cooler_controller_id, parseFloat(String(adj.original_target_temp)))
          }
        }
      }
    }
  }

  for (const fc of followedControllersFullData) {
    const isProfileOwned = profileOwnedControllerIds.has(fc.controller_id)

    if (cooloffControllerIds.has(fc.controller_id)) {
      log('PILL_COMP_SKIP', 'info', `${fc.name}: 30min cooloff active, skipping pill-comp`)
      continue
    }
    if (!fc.heating_enabled && !fc.cooling_enabled) continue
    if (fc.pill_temp === null || fc.pill_temp === undefined) continue

    const targetTemp = parseFloat(String(fc.target_temp ?? '20'))

    // Same-data guard
    const lastAdjTs = lastAdjTimestampMap.get(fc.controller_id)
    const profileTargetNow = isProfileOwned ? parseFloat(String((fc as any).profile_target_temp ?? '0')) : null
    const profileMatchesCurrent = profileTargetNow === null || Math.abs(profileTargetNow - targetTemp) < 0.15
    if (lastAdjTs && fc.last_update && lastAdjTs === fc.last_update && profileMatchesCurrent) {
      log('PILL_COMP_SKIP', 'info', `${fc.name}: Samma data som senaste justering (${fc.last_update}), hoppar över`)
      continue
    }
    if (lastAdjTs && fc.last_update && lastAdjTs === fc.last_update && !profileMatchesCurrent) {
      log('PILL_COMP', 'info', `${fc.name}: Samma RAPT-data men profilmål ändrat (${profileTargetNow?.toFixed(1)}° vs ctrl ${targetTemp.toFixed(1)}°) — kör PID ändå`)
    }

    // Determine base target
    let baseTarget: number
    if (isProfileOwned) {
      const profileTarget = (fc as any).profile_target_temp
      if (profileTarget === null || profileTarget === undefined) {
        log('PILL_COMP_SKIP', 'info', `${fc.name}: profile-owned but no profile_target_temp set yet`)
        continue
      }
      baseTarget = parseFloat(String(profileTarget))
    } else {
      baseTarget = pillCompOriginalTargetMap.get(fc.controller_id) ?? targetTemp
    }

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

    if (Math.abs(newTarget - targetTemp) < 0.1) {
      // Log active constraints even when change is too small to apply
      if (compensation.constraints && compensation.constraints.length > 0) {
        log('PILL_COMP_ACTION', 'info', `${fc.name}: PID ${baseTarget.toFixed(1)}°C → ${newTarget.toFixed(1)}°C (ingen ändring <0.1°C, delta=${compensation.avgDelta.toFixed(2)}, komp=${compensation.compensation.toFixed(2)}°C, limits=[${compensation.constraints.join(',')}])`)
      }
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
      ctx.updateBatch.add(fc.controller_id, newTarget)
      success = true // Optimistic — will be flushed later
    } else {
      success = await setControllerTargetTemp(supabaseUrl, serviceRoleKey, fc.controller_id, newTarget)
    }

    if (success) {
      log('PILL_COMP_ACTION', 'pass', `Set ${fc.name} to ${newTarget}°C${ctx.updateBatch ? ' (batched)' : ''}`)
      adjustments.push({ cooler: fc.name, oldTarget: targetTemp, newTarget })

      await supabase.from('rapt_temp_controllers')
        .update({ target_temp: newTarget, updated_at: new Date().toISOString() })
        .eq('controller_id', fc.controller_id)

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
