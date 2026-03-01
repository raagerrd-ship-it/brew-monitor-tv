import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { round1, TempController, setControllerTargetTemp, RaptUpdateBatch } from './temp-utils.ts'
import { getTempBucket, getLearnedParam, updateLearnedParam } from './learning-utils.ts'
import { logAdjustment, AdjustmentResult } from './adjustment-logger.ts'

// ============================================================
// Cooler Management
// 
// PRINCIPLE: The cooler only cares about ONE thing —
// maintaining a learned margin below the lowest followed
// controller's effective probe target so cooling happens
// at a good/reasonable rate.
//
// Controller adjustments (PID, stall) are handled separately
// in controller-adjustments.ts. When they lower probe targets,
// the cooler naturally follows.
// ============================================================

export interface CoolerContext {
  supabase: ReturnType<typeof createClient>
  supabaseUrl: string
  serviceRoleKey: string
  allControllers: TempController[]
  followedControllersFullData: TempController[]
  followedControllerIds: string[]
  settings: { id: string; last_check_at: string | null }
  log: (step: string, result: 'pass' | 'fail' | 'info' | 'action', message: string, details?: Record<string, unknown>) => void
  updateBatch?: RaptUpdateBatch
}

// Cached profile data shared between functions to avoid duplicate queries
interface ProfileCache {
  sessions: any[]
  stepsMap: Map<string, any[]>
}

export async function runCoolerCooling(ctx: CoolerContext): Promise<AdjustmentResult[]> {
  const { supabase, supabaseUrl, serviceRoleKey, allControllers, followedControllersFullData, log } = ctx
  const adjustments: AdjustmentResult[] = []

  log('COOLING', 'info', '--- Cooler management check ---')

  // ── Find cooler ────────────────────────────────────
  const coolerController = allControllers.find(c => (c as any).is_glycol_cooler) as TempController | undefined
  if (!coolerController) {
    log('COOLER_CONFIG', 'fail', 'No controller marked as cooler')
    return adjustments
  }

  if (!coolerController.cooling_enabled) {
    log('COOLER_STATUS', 'fail', 'Glycol cooler has cooling disabled')
    return adjustments
  }

  // ── Safety: stale sensor check ────────────────────────────
  if (coolerController.last_update) {
    const coolerAgeMs = Date.now() - new Date(coolerController.last_update).getTime()
    if (coolerAgeMs > 30 * 60 * 1000) {
      log('COOLER_STALE', 'fail', `Sensor data is ${Math.round(coolerAgeMs / 60000)}min old — SKIPPING for safety`)
      return adjustments
    }
  } else {
    log('COOLER_STALE', 'fail', 'No sensor data timestamp — SKIPPING for safety')
    return adjustments
  }

  const currentCoolerTarget = parseFloat(String(coolerController.target_temp ?? '18'))
  const coolerMinTemp = parseFloat(String(coolerController.min_target_temp ?? '-5'))
  const coolerMaxTemp = parseFloat(String(coolerController.max_target_temp ?? '25'))

  log('COOLER_STATUS', 'pass', `Cooler: ${coolerController.name}`, {
    target_temp: round1(currentCoolerTarget),
    current_temp: round1(coolerController.current_temp),
  })

  // ── Find followed controllers with cooling enabled ────────
  const controllersWithCooling = followedControllersFullData.filter(c => c.cooling_enabled === true)

  if (controllersWithCooling.length === 0) {
    log('COOLING_CAPABILITY', 'fail', 'No followed controller has cooling enabled')
    const defaultTemp = 18
    if (Math.abs(currentCoolerTarget - defaultTemp) > 0.5 && defaultTemp >= coolerMinTemp && defaultTemp <= coolerMaxTemp) {
      await applyCoolerTarget(ctx, coolerController, currentCoolerTarget, defaultTemp, 0, 'Ingen tank kyler — viloläge', adjustments)
    }
    return adjustments
  }

  // ── Load profile data once (used for ramp detection + blocking) ──
  const profileCache = await loadProfileCache(ctx, controllersWithCooling)

  // ── Determine effective lowest target ─────────────────────
  const effectiveTarget = resolveEffectiveLowestTarget(ctx, controllersWithCooling, profileCache)

  log('EFFECTIVE_TARGET', 'info', `Lowest effective target: ${effectiveTarget.temp.toFixed(1)}°C (${effectiveTarget.source})`, {
    controller: effectiveTarget.controllerName,
  })

  // ── Get learned margin for this temperature zone ──────────
  const tempBucket = getTempBucket(effectiveTarget.temp)
  const learnedMargin = await getLearnedParam(supabase, coolerController.controller_id, `cooler_margin:${tempBucket}`, 5.0)
  const maxEffective = await getLearnedParam(supabase, coolerController.controller_id, `max_effective_margin:${tempBucket}`, 15.0)

  // Clamp margin to max effective (no point going beyond diminishing returns)
  const effectiveMargin = Math.min(learnedMargin.value, maxEffective.value)
  const desiredCoolerTarget = Math.round((effectiveTarget.temp - effectiveMargin) * 10) / 10
  const clampedTarget = Math.max(coolerMinTemp, Math.min(coolerMaxTemp, desiredCoolerTarget))

  log('MARGIN_CALC', 'info', `Target: ${effectiveTarget.temp.toFixed(1)}°C - margin ${effectiveMargin.toFixed(1)}°C = kylare ${clampedTarget.toFixed(1)}°C`, {
    temp_bucket: tempBucket,
    margin_samples: learnedMargin.sampleCount,
    learned_margin: learnedMargin.value,
    max_effective: maxEffective.value,
    current_cooler: currentCoolerTarget,
    required_rate: effectiveTarget.requiredRatePerHour,
  })

  // ── Apply if different enough ─────────────────────────────
  const diff = Math.abs(clampedTarget - currentCoolerTarget)
  if (diff < 0.3) {
    log('COOLER_OK', 'pass', `Kylare vid ${currentCoolerTarget}°C, mål ${clampedTarget}°C — nära nog (${diff.toFixed(1)}°C diff)`)
    await learnFromCurrentState(ctx, coolerController, controllersWithCooling, effectiveTarget, tempBucket)
    return adjustments
  }

  // Rate-limit: 5 min between adjustments
  const { data: lastAdjust } = await supabase
    .from('auto_cooling_adjustments')
    .select('created_at')
    .eq('cooler_controller_id', coolerController.controller_id)
    .order('created_at', { ascending: false }).limit(1)

  const lastAdjustTime = lastAdjust?.[0]?.created_at ? new Date(lastAdjust[0].created_at).getTime() : 0
  const timeSinceLastAdjust = Date.now() - lastAdjustTime

  if (timeSinceLastAdjust < 5 * 60 * 1000) {
    log('RATE_LIMIT', 'info', `Väntar ${Math.ceil((5 * 60 * 1000 - timeSinceLastAdjust) / 60000)}min till nästa justering`)
    return adjustments
  }

  // ── Block raising cooler during active downward ramps ─────
  if (clampedTarget > currentCoolerTarget) {
    if (effectiveTarget.isRampingDown) {
      log('RAMP_BLOCK', 'info', 'Blockerar höjning — aktiv nedåtramp pågår')
      return adjustments
    }
  }

  // ── Apply ─────────────────────────────────────────────────
  const direction = clampedTarget < currentCoolerTarget ? 'Sänker' : 'Höjer'
  await applyCoolerTarget(ctx, coolerController, currentCoolerTarget, clampedTarget, effectiveTarget.temp,
    `${direction} kylare: margin ${learnedMargin.value.toFixed(1)}°C under ${effectiveTarget.temp.toFixed(1)}°C (${effectiveTarget.source})`,
    adjustments, effectiveTarget.controllerId, effectiveTarget.controllerName)

  return adjustments
}

// ─── Load profile data once ──────────────────────────────────

async function loadProfileCache(ctx: CoolerContext, controllersWithCooling: TempController[]): Promise<ProfileCache> {
  const { supabase } = ctx
  const followedIds = controllersWithCooling.map(c => c.controller_id)

  const { data: sessions } = await supabase
    .from('fermentation_sessions')
    .select('id, controller_id, profile_id, current_step_index, step_started_at, step_start_temp')
    .eq('status', 'running')
    .in('controller_id', followedIds)

  if (!sessions || sessions.length === 0) return { sessions: [], stepsMap: new Map() }

  const uniqueProfileIds = [...new Set(sessions.map(s => s.profile_id))]
  const { data: allSteps } = await supabase
    .from('fermentation_profile_steps')
    .select('profile_id, step_order, step_type, target_temp, duration_hours')
    .in('profile_id', uniqueProfileIds)
    .order('step_order', { ascending: true })

  const stepsMap = new Map<string, any[]>()
  if (allSteps) {
    for (const step of allSteps) {
      const list = stepsMap.get(step.profile_id) || []
      list.push(step)
      stepsMap.set(step.profile_id, list)
    }
  }

  return { sessions, stepsMap }
}

// ─── Determine the effective lowest target (pure logic, no DB) ──

interface EffectiveTarget {
  temp: number
  controllerName: string
  controllerId: string
  source: string
  isRampingDown: boolean
  requiredRatePerHour: number | null // °C/h needed for active ramp
}

function resolveEffectiveLowestTarget(ctx: CoolerContext, controllersWithCooling: TempController[], cache: ProfileCache): EffectiveTarget {
  const { log } = ctx

  // Start with the static lowest probe target
  const lowestStatic = controllersWithCooling.reduce((lowest, c) => {
    const t = parseFloat(String(c.target_temp ?? '999'))
    const lt = parseFloat(String(lowest.target_temp ?? '999'))
    return t < lt ? c : lowest
  })

  let result: EffectiveTarget = {
    temp: parseFloat(String(lowestStatic.target_temp ?? '999')),
    controllerName: lowestStatic.name,
    controllerId: lowestStatic.controller_id,
    source: 'probe target',
    isRampingDown: false,
    requiredRatePerHour: null,
  }

  for (const session of cache.sessions) {
    const steps = cache.stepsMap.get(session.profile_id)
    if (!steps) continue

    const controller = controllersWithCooling.find(c => c.controller_id === session.controller_id)
    if (!controller) continue

    const currentStep = steps[session.current_step_index]
    if (!currentStep) continue

    // Active ramp going down?
    if (['ramp', 'gradual_ramp'].includes(currentStep.step_type) && currentStep.target_temp != null && currentStep.duration_hours > 0) {
      const stepTarget = parseFloat(String(currentStep.target_temp))
      const startTemp = session.step_start_temp != null ? parseFloat(String(session.step_start_temp)) : result.temp
      if (stepTarget < startTemp) {
        result.isRampingDown = true // Flag for ramp blocking

        const elapsedHours = (Date.now() - new Date(session.step_started_at).getTime()) / (1000 * 60 * 60)
        const remainingHours = Math.max(0, currentStep.duration_hours - elapsedHours)

        // 1h look-ahead: where will the ramp be?
        const lookAhead = Math.min(1.0, remainingHours)
        const futureProgress = Math.min((elapsedHours + lookAhead) / currentStep.duration_hours, 1)
        const futureTarget = Math.round((startTemp + (stepTarget - startTemp) * futureProgress) * 10) / 10

        // Calculate required cooling rate for this ramp
        const totalDrop = startTemp - stepTarget
        const rampRequiredRate = totalDrop / currentStep.duration_hours // °C/h

        if (futureTarget < result.temp) {
          result = {
            temp: futureTarget,
            controllerName: controller.name,
            controllerId: controller.controller_id,
            source: `ramp look-ahead 1h (→ ${stepTarget}°C)`,
            isRampingDown: true,
            requiredRatePerHour: rampRequiredRate,
          }
        }
      }
    }

    // Next step goes lower? (within 2h horizon)
    const nextStep = steps[session.current_step_index + 1]
    if (nextStep?.target_temp != null) {
      const nextTarget = parseFloat(String(nextStep.target_temp))

      // Find current step's effective target (not the ramp look-ahead)
      let currentEffective: number | null = null
      for (let i = session.current_step_index; i >= 0; i--) {
        if (steps[i].target_temp != null) { currentEffective = parseFloat(String(steps[i].target_temp)); break }
      }
      if (currentEffective === null) continue

      if (nextTarget < currentEffective - 0.5) {
        let hoursUntil = 0
        if (currentStep.duration_hours) {
          const elapsed = (Date.now() - new Date(session.step_started_at).getTime()) / (1000 * 60 * 60)
          hoursUntil = Math.max(0, currentStep.duration_hours - elapsed)
        }

        if (hoursUntil <= 2.0 && nextTarget < result.temp) {
          result = {
            temp: nextTarget,
            controllerName: controller.name,
            controllerId: controller.controller_id,
            source: `upcoming step (om ${hoursUntil.toFixed(1)}h → ${nextTarget}°C)`,
            isRampingDown: result.isRampingDown,
            requiredRatePerHour: result.requiredRatePerHour,
          }
          log('PROACTIVE', 'info', `${controller.name}: nästa steg om ${hoursUntil.toFixed(1)}h → ${nextTarget}°C`)
        }
      }
    }
  }

  return result
}

// ─── Learn from current state ────────────────────────────────

async function learnFromCurrentState(
  ctx: CoolerContext,
  coolerController: TempController,
  controllersWithCooling: TempController[],
  effectiveTarget: EffectiveTarget,
  tempBucket: string,
): Promise<void> {
  const { supabase, log } = ctx
  const currentCoolerTarget = parseFloat(String(coolerController.target_temp ?? '18'))
  const currentMargin = Math.abs(effectiveTarget.temp - currentCoolerTarget)

  const lowestController = controllersWithCooling.reduce((lowest, c) => {
    const t = parseFloat(String(c.target_temp ?? '999'))
    const lt = parseFloat(String(lowest.target_temp ?? '999'))
    return t < lt ? c : lowest
  })

  const probeTemp = parseFloat(String(lowestController.current_temp ?? '999'))
  const targetTemp = parseFloat(String(lowestController.target_temp ?? '999'))
  const hysteresis = parseFloat(String(lowestController.cooling_hysteresis ?? '0.2'))

  // ── Measure actual cooling rate from history (last 30 min) ──
  const actualRate = await measureCoolingRate(supabase, lowestController.controller_id)

  // ── Rate-based learning during active ramps ──
  if (effectiveTarget.requiredRatePerHour != null && effectiveTarget.requiredRatePerHour > 0 && actualRate !== null) {
    const requiredRate = effectiveTarget.requiredRatePerHour
    const ratio = actualRate > 0.05 ? requiredRate / actualRate : 2.0 // avoid div-by-zero

    log('RATE_LEARN', 'info', `Ramp rate: actual ${actualRate.toFixed(2)}°C/h vs required ${requiredRate.toFixed(2)}°C/h (ratio ${ratio.toFixed(2)})`)

    if (ratio > 1.1) {
      // Too slow — increase margin proportionally (clamped)
      const scaledMargin = currentMargin * Math.min(ratio, 1.5) // max 50% increase per cycle
      const result = await updateLearnedParam(supabase, coolerController.controller_id, `cooler_margin:${tempBucket}`, scaledMargin, 2.0, 15.0)
      log('MARGIN_LEARN', 'action', `[${tempBucket}] Rate too slow — increasing: ${result.oldValue.toFixed(1)}→${result.newValue.toFixed(1)}°C`)
    } else if (ratio < 0.85) {
      // Faster than needed — tighten margin
      const tighterMargin = currentMargin * 0.95
      const result = await updateLearnedParam(supabase, coolerController.controller_id, `cooler_margin:${tempBucket}`, tighterMargin, 2.0, 15.0)
      log('MARGIN_LEARN', 'pass', `[${tempBucket}] Rate adequate — tightening: ${result.oldValue.toFixed(1)}→${result.newValue.toFixed(1)}°C`)
    }

    // ── Max-effective-margin learning ──
    await learnMaxEffectiveMargin(supabase, coolerController.controller_id, tempBucket, currentMargin, actualRate, log)
    return
  }

  // ── Fallback: static target-based learning (hold steps) ──
  const atTarget = probeTemp <= targetTemp + hysteresis
  const overshot = probeTemp < targetTemp - 1.0

  if (atTarget && !overshot && currentMargin > 1.0) {
    const tighterMargin = currentMargin * 0.97
    const result = await updateLearnedParam(supabase, coolerController.controller_id, `cooler_margin:${tempBucket}`, tighterMargin, 2.0, 15.0)
    log('MARGIN_LEARN', 'pass', `[${tempBucket}] Margin adequate: ${result.oldValue.toFixed(1)}→${result.newValue.toFixed(1)}°C`)
  } else if (overshot) {
    const reducedMargin = currentMargin * 0.75
    const result = await updateLearnedParam(supabase, coolerController.controller_id, `cooler_margin:${tempBucket}`, reducedMargin, 2.0, 15.0)
    log('MARGIN_LEARN', 'action', `[${tempBucket}] Overshoot! Reducing: ${result.oldValue.toFixed(1)}→${result.newValue.toFixed(1)}°C`)
  } else if (!atTarget) {
    const biggerMargin = currentMargin * 1.15
    const result = await updateLearnedParam(supabase, coolerController.controller_id, `cooler_margin:${tempBucket}`, biggerMargin, 2.0, 15.0)
    log('MARGIN_LEARN', 'action', `[${tempBucket}] Not reaching target — increasing: ${result.oldValue.toFixed(1)}→${result.newValue.toFixed(1)}°C`)
  }

  // Also learn max effective during hold if we have rate data
  if (actualRate !== null) {
    await learnMaxEffectiveMargin(supabase, coolerController.controller_id, tempBucket, currentMargin, actualRate, log)
  }
}

// ─── Measure actual probe cooling rate ───────────────────────

async function measureCoolingRate(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
): Promise<number | null> {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()

  const { data } = await supabase
    .from('temp_controller_history')
    .select('current_temp, recorded_at')
    .eq('controller_id', controllerId)
    .gte('recorded_at', thirtyMinAgo)
    .order('recorded_at', { ascending: true })

  if (!data || data.length < 2) return null

  const first = data[0]
  const last = data[data.length - 1]
  const tempDiff = parseFloat(String(first.current_temp)) - parseFloat(String(last.current_temp))
  const hoursDiff = (new Date(last.recorded_at).getTime() - new Date(first.recorded_at).getTime()) / (1000 * 60 * 60)

  if (hoursDiff < 0.05) return null // less than 3 min of data
  return tempDiff / hoursDiff // positive = cooling
}

// ─── Learn max effective margin ──────────────────────────────

async function learnMaxEffectiveMargin(
  supabase: ReturnType<typeof createClient>,
  coolerId: string,
  tempBucket: string,
  currentMargin: number,
  currentRate: number,
  log: CoolerContext['log'],
): Promise<void> {
  // Load previous observation
  const prev = await getLearnedParam(supabase, coolerId, `prev_margin_rate:${tempBucket}`, 0)
  const prevMargin = prev.value
  const prevRate = await getLearnedParam(supabase, coolerId, `prev_cooling_rate:${tempBucket}`, 0)

  // Save current observation for next cycle
  await supabase.from('fermentation_learnings').upsert({
    controller_id: coolerId,
    parameter_name: `prev_margin_rate:${tempBucket}`,
    learned_value: Math.round(currentMargin * 100) / 100,
    sample_count: 1,
    last_updated_at: new Date().toISOString(),
  }, { onConflict: 'controller_id,parameter_name' })

  await supabase.from('fermentation_learnings').upsert({
    controller_id: coolerId,
    parameter_name: `prev_cooling_rate:${tempBucket}`,
    learned_value: Math.round(currentRate * 100) / 100,
    sample_count: 1,
    last_updated_at: new Date().toISOString(),
  }, { onConflict: 'controller_id,parameter_name' })

  // Need previous data to compare
  if (prevMargin < 0.5 || prevRate.value < 0.05) return

  // Margin increased by >1°C but rate didn't improve (within 10% tolerance)
  const marginIncrease = currentMargin - prevMargin
  const rateImprovement = currentRate - prevRate.value

  if (marginIncrease > 1.0 && rateImprovement < prevRate.value * 0.1) {
    // Diminishing returns detected — the previous margin was already effective enough
    const ceilingMargin = prevMargin + 0.5 // small buffer
    const result = await updateLearnedParam(supabase, coolerId, `max_effective_margin:${tempBucket}`, ceilingMargin, 3.0, 15.0)
    log('MAX_MARGIN', 'action', `[${tempBucket}] Diminishing returns at margin ${currentMargin.toFixed(1)}°C — ceiling: ${result.oldValue.toFixed(1)}→${result.newValue.toFixed(1)}°C`)
  }
}

async function applyCoolerTarget(
  ctx: CoolerContext,
  coolerController: TempController,
  oldTarget: number,
  newTarget: number,
  lowestFollowedTemp: number,
  reason: string,
  adjustments: AdjustmentResult[],
  followedControllerId?: string,
  followedControllerName?: string,
): Promise<void> {
  const { supabase, supabaseUrl, serviceRoleKey, log } = ctx

  log('ADJUSTMENT', 'action', `${oldTarget}°C → ${newTarget}°C: ${reason}`)

  let success: boolean
  if (ctx.updateBatch) {
    ctx.updateBatch.add(coolerController.controller_id, newTarget)
    success = true
  } else {
    success = await setControllerTargetTemp(supabaseUrl, serviceRoleKey, coolerController.controller_id, newTarget)
  }

  if (success) {
    log('ADJUSTMENT', 'pass', `Kylare satt till ${newTarget}°C${ctx.updateBatch ? ' (batched)' : ''}`)
    adjustments.push({ cooler: coolerController.name, oldTarget, newTarget })

    await logAdjustment(supabase, {
      cooler_controller_id: coolerController.controller_id,
      cooler_controller_name: coolerController.name,
      old_target_temp: oldTarget,
      new_target_temp: newTarget,
      lowest_followed_temp: lowestFollowedTemp,
      followed_controller_id: followedControllerId ?? null,
      followed_controller_name: followedControllerName ?? null,
      reason,
    })
  } else {
    log('ADJUSTMENT', 'fail', 'Kunde inte sätta glykolmål')
  }
}
