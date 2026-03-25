import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { round1, TempController, setControllerTargetTemp, RaptUpdateBatch } from './temp-utils.ts'
import { getTempBucket, getLearnedParam, updateLearnedParam } from './learning-utils.ts'
import { logAdjustment, AdjustmentResult } from './adjustment-logger.ts'
import { insertNotification } from './notifications.ts'

// ============================================================
// Cooler Management
// 
// PRINCIPLE: The cooler only cares about ONE thing —
// maintaining a learned margin below the lowest followed
// controller's effective probe target so cooling happens
// at a good/reasonable rate.
//
// DEMAND-DRIVEN: The cooler only lowers its target when at
// least one tank is actively cooling (probe > target + hysteresis).
// This prevents wasteful adjustments when PID shifts targets
// but the tank hasn't even triggered its cooling circuit yet.
//
// UTILIZATION-AWARE: By tracking cooling_run_time between
// cycles, we calculate how much of the time the cooling
// circuit was active. High utilization → need more margin.
// Low utilization → can tighten margin to save energy.
//
// Controller adjustments (PID, stall) are handled separately
// in controller-adjustments.ts. When they lower probe targets,
// the cooler naturally follows once actual demand appears.
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
  /** Set by runCoolerCooling when a kick is queued — caller must set DB flag after flush succeeds */
  pendingKickControllerId?: string
  /** Maps controller_id → dual-sensor baseTarget (grundmål).
   *  Cooler plans against this stable target instead of the PID-fluctuating target_temp. */
  baseTargetMap?: Map<string, number>
  /** When true, skip all learning (EMA updates) — system is in idle mode */
  skipLearning?: boolean
  /** PWM bursts from PID — used to detect active cooling need even when hardware util is 0% */
  pwmBursts?: Array<{ controller_id: string; duty_pct: number }>
}

// Cached profile data shared between functions to avoid duplicate queries
interface ProfileCache {
  sessions: any[]
  stepsMap: Map<string, any[]>
}

// Per-controller cooling utilization data
interface CoolingUtilization {
  controllerId: string
  controllerName: string
  utilization: number | null  // avg of 2 most recent intervals (for decisions)
  recentUtilization: number | null  // p1→p0
  midUtilization: number | null  // p2→p1
  oldestUtilization: number | null  // p3→p2
  ancientUtilization: number | null  // p4→p3
  isActivelyCooling: boolean
  probeTemp: number
  targetTemp: number
  hysteresis: number
  // Raw data for tooltip
  prevTimestampMs: number
  prevRunTime: number
  p2TimestampMs: number
  p2RunTime: number
  anchorTimestampMs: number
  anchorRunTime: number
  p4TimestampMs: number
  p4RunTime: number
  currentRunTime: number
  sensorTimestampMs: number
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

  // ── Calculate cooler's own utilization (rolling 30-min avg) ──
  const coolerUtilResult = await calculateSingleUtilization(supabase, coolerController)
  const coolerUtil = coolerUtilResult.rolling

  // ── Measure cooler's own cooling rate ──
  const coolerCoolingRate = await measureCoolingRate(supabase, coolerController.controller_id)

  log('COOLER_STATUS', 'pass', `Cooler: ${coolerController.name}${coolerUtil != null ? ` util=${Math.round(coolerUtil * 100)}%` : ''}${coolerCoolingRate != null ? ` rate=${coolerCoolingRate.toFixed(2)}°C/h` : ''}`, {
    target_temp: round1(currentCoolerTarget),
    current_temp: round1(coolerController.current_temp),
    cooler_utilization: coolerUtil != null ? Math.round(coolerUtil * 100) : null,
    cooling_rate_per_hour: coolerCoolingRate != null ? Math.round(coolerCoolingRate * 100) / 100 : null,
    cooling_hysteresis: coolerController.cooling_hysteresis ?? 0.2,
    recent_utilization: coolerUtilResult.recent != null ? Math.round(coolerUtilResult.recent * 100) : null,
    mid_utilization: coolerUtilResult.mid != null ? Math.round(coolerUtilResult.mid * 100) : null,
    oldest_utilization: coolerUtilResult.oldest != null ? Math.round(coolerUtilResult.oldest * 100) : null,
    ancient_utilization: coolerUtilResult.ancient != null ? Math.round(coolerUtilResult.ancient * 100) : null,
    cooling_run_time: coolerController.cooling_run_time ?? 0,
    cooling_starts: coolerController.cooling_starts ?? 0,
    last_update: coolerController.last_update,
    prev_at: coolerUtilResult.prevTimestampMs > 0 ? new Date(coolerUtilResult.prevTimestampMs).toISOString() : null,
    prev_run_time: coolerUtilResult.prevRunTime,
    p2_at: coolerUtilResult.p2TimestampMs > 0 ? new Date(coolerUtilResult.p2TimestampMs).toISOString() : null,
    p2_run_time: coolerUtilResult.p2RunTime,
    anchor_at: coolerUtilResult.anchorTimestampMs > 0 ? new Date(coolerUtilResult.anchorTimestampMs).toISOString() : null,
    anchor_run_time: coolerUtilResult.anchorRunTime,
    p4_at: coolerUtilResult.p4TimestampMs > 0 ? new Date(coolerUtilResult.p4TimestampMs).toISOString() : null,
    p4_run_time: coolerUtilResult.p4RunTime,
  })

  // ── Alert: prolonged cooler utilization (all 5 buckets ≥95% ≈ 1h+) ──
  const allBucketsHigh = coolerUtil != null && coolerUtil >= 0.95
    && coolerUtilResult.recent != null && coolerUtilResult.recent >= 0.95
    && coolerUtilResult.mid != null && coolerUtilResult.mid >= 0.95
    && coolerUtilResult.oldest != null && coolerUtilResult.oldest >= 0.95
    && coolerUtilResult.ancient != null && coolerUtilResult.ancient >= 0.95
  if (allBucketsHigh) {
    await insertNotification(supabase, {
      type: 'cooler_high_utilization',
      title: 'Glykolkylare hög belastning',
      body: `${coolerController.name} har kört på ${Math.round(coolerUtil! * 100)}% i över 1 timme — kontrollera systemet`,
      controller_id: coolerController.controller_id,
    })
  }

  // ── Find followed controllers with cooling enabled ────────
  const controllersWithCooling = followedControllersFullData.filter(c => c.cooling_enabled === true)

  if (controllersWithCooling.length === 0) {
    log('COOLING_CAPABILITY', 'fail', 'No followed controller has cooling enabled')
    // Idle = cooler's max allowed temp (highest possible = least cooling)
    const idleTemp = coolerMaxTemp
    if (Math.abs(currentCoolerTarget - idleTemp) > 0.5) {
      await applyCoolerTarget(ctx, coolerController, currentCoolerTarget, idleTemp, 0, `Ingen tank kyler — viloläge (${idleTemp}°C)`, adjustments)
    }
    return adjustments
  }

  // No PWM baseline fix needed — PWM now uses hardware-only mode,
  // so DB target_temp always reflects the real PID value.

  // ── Calculate cooling utilization per controller ───────────
  const utilizations = await calculateCoolingUtilizations(ctx, controllersWithCooling)

  for (const u of utilizations) {
    const c = controllersWithCooling.find(c => c.controller_id === u.controllerId)
    const pwmDuty = ctx.pwmBursts?.find(b => b.controller_id === u.controllerId)?.duty_pct ?? 0
    log('COOLING_UTIL', 'info', `${u.controllerName}: ${u.isActivelyCooling ? '❄️ kyler' : '⏸️ vilar'} (probe ${round1(u.probeTemp)}° mål ${round1(u.targetTemp)}° hyst ${round1(u.hysteresis)}°)${u.utilization != null ? ` util=${Math.round(u.utilization * 100)}%` : ''}${pwmDuty > 0 ? ` pwm=${pwmDuty}%` : ''}`, {
      utilization: u.utilization != null ? Math.round(u.utilization * 100) : null,
      recent_utilization: u.recentUtilization != null ? Math.round(u.recentUtilization * 100) : null,
      mid_utilization: u.midUtilization != null ? Math.round(u.midUtilization * 100) : null,
      oldest_utilization: u.oldestUtilization != null ? Math.round(u.oldestUtilization * 100) : null,
      ancient_utilization: u.ancientUtilization != null ? Math.round(u.ancientUtilization * 100) : null,
      cooling_run_time: c?.cooling_run_time ?? null,
      last_update: c?.last_update ?? null,
      prev_at: u.prevTimestampMs > 0 ? new Date(u.prevTimestampMs).toISOString() : null,
      prev_run_time: u.prevRunTime,
      p2_at: u.p2TimestampMs > 0 ? new Date(u.p2TimestampMs).toISOString() : null,
      p2_run_time: u.p2RunTime,
      anchor_at: u.anchorTimestampMs > 0 ? new Date(u.anchorTimestampMs).toISOString() : null,
      anchor_run_time: u.anchorRunTime,
      p4_at: u.p4TimestampMs > 0 ? new Date(u.p4TimestampMs).toISOString() : null,
      p4_run_time: u.p4RunTime,
    })
  }

  // ── Load profile data once (used for ramp detection + blocking) ──
  const profileCache = await loadProfileCache(ctx, controllersWithCooling)

  // ── Determine effective lowest target ─────────────────────
  // No PWM correction needed — DB target_temp is always the real PID value
  const effectiveTarget = resolveEffectiveLowestTarget(ctx, controllersWithCooling, profileCache)

  log('EFFECTIVE_TARGET', 'info', `Lowest effective target: ${effectiveTarget.temp.toFixed(1)}°C (${effectiveTarget.source})`, {
    controller: effectiveTarget.controllerName,
    temp: effectiveTarget.temp,
  })

  // ── Get learned margin for this temperature zone ──────────
  const tempBucket = getTempBucket(effectiveTarget.temp)
  const activeTankCount = utilizations.filter(u => u.isActivelyCooling).length
  const loadBucket = activeTankCount === 0 ? 'load_0' : activeTankCount === 1 ? 'load_1' : 'load_2plus'

  // Use context-specific margin (hold vs ramp) when available, fall back to generic cooler_margin
  const isRamp = effectiveTarget.isRampingDown || (effectiveTarget.requiredRatePerHour != null && effectiveTarget.requiredRatePerHour > 0)
  const activityBucket = await getActivityBucket(supabase, effectiveTarget.controllerId)
  const marginTypePrefix = isRamp ? 'ramp_margin' : 'hold_margin'

  // Fallback chain: activity-specific → load-specific → generic cooler_margin
  const activityMarginKey = `${marginTypePrefix}:${tempBucket}:${loadBucket}:${activityBucket}`
  const loadMarginKey = `${marginTypePrefix}:${tempBucket}:${loadBucket}`
  const [activityMargin, loadMargin, genericMargin] = await Promise.all([
    getLearnedParam(supabase, coolerController.controller_id, activityMarginKey, -1),
    getLearnedParam(supabase, coolerController.controller_id, loadMarginKey, -1),
    getLearnedParam(supabase, coolerController.controller_id, `cooler_margin:${tempBucket}`, 5.0),
  ])
  const learnedMargin = activityMargin.sampleCount >= 3 ? activityMargin
    : loadMargin.sampleCount >= 3 ? loadMargin : genericMargin
  const marginSource = activityMargin.sampleCount >= 3 ? activityMarginKey
    : loadMargin.sampleCount >= 3 ? loadMarginKey : `cooler_margin:${tempBucket}`

  const minEffective = await getLearnedParam(supabase, coolerController.controller_id, `min_effective_margin:${tempBucket}`, 1.0)

  // ── Rate-aware margin boost during ramps ──────────────────
  // If we know the required cooling rate AND the learned cooling rate for this zone,
  // predict whether the current margin is sufficient
  let rateBoostFactor = 1.0
  if (isRamp && effectiveTarget.requiredRatePerHour != null && effectiveTarget.requiredRatePerHour > 0) {
    const learnedRate = await getLearnedParam(supabase, coolerController.controller_id, `cooling_rate:${tempBucket}:${loadBucket}`, -1)
    if (learnedRate.sampleCount >= 3 && learnedRate.value > 0.05) {
      const rateRatio = effectiveTarget.requiredRatePerHour / learnedRate.value
      if (rateRatio > 1.1) {
        // Required rate exceeds learned rate — need more margin
        rateBoostFactor = Math.min(rateRatio, 1.5)
        log('RATE_PREDICT', 'action', `Ramp kräver ${effectiveTarget.requiredRatePerHour.toFixed(2)}°C/h men lärd rate är ${learnedRate.value.toFixed(2)}°C/h — ökar marginal ×${rateBoostFactor.toFixed(2)}`)
      } else {
        log('RATE_PREDICT', 'pass', `Ramp kräver ${effectiveTarget.requiredRatePerHour.toFixed(2)}°C/h, lärd rate ${learnedRate.value.toFixed(2)}°C/h — marginal OK`)
      }
    }
  }

  // Use learned margin directly — min_effective is logged as reference only (no hard floor)
  const baseMargin = learnedMargin.value
  const effectiveMargin = Math.round(baseMargin * rateBoostFactor * 10) / 10
  const desiredCoolerTarget = Math.round((effectiveTarget.temp - effectiveMargin) * 10) / 10
  const clampedTarget = Math.max(coolerMinTemp, Math.min(coolerMaxTemp, desiredCoolerTarget))

  log('MARGIN_CALC', 'info', `Target: ${effectiveTarget.temp.toFixed(1)}°C - margin ${effectiveMargin.toFixed(1)}°C = kylare ${clampedTarget.toFixed(1)}°C`, {
    temp_bucket: tempBucket,
    margin_source: marginSource,
    margin_samples: learnedMargin.sampleCount,
    learned_margin: learnedMargin.value,
    rate_boost: rateBoostFactor > 1.0 ? rateBoostFactor : null,
    min_effective: minEffective.value,
    current_cooler: currentCoolerTarget,
    required_rate: effectiveTarget.requiredRatePerHour,
    load_bucket: loadBucket,
  })

  // ── Log margin history snapshot ───────────────────────────
  const lowestUtil = utilizations.find(u => u.controllerId === effectiveTarget.controllerId)
  const actualRate = await measureCoolingRate(supabase, effectiveTarget.controllerId)
  await supabase.from('cooler_margin_history').insert({
    controller_id: coolerController.controller_id,
    temp_bucket: tempBucket,
    margin_value: Math.round(effectiveMargin * 100) / 100,
    max_effective: minEffective.sampleCount > 0 ? Math.round(minEffective.value * 100) / 100 : null,
    utilization: lowestUtil?.utilization != null ? Math.round(lowestUtil.utilization * 1000) / 1000 : null,
    cooling_rate: actualRate != null ? Math.round(actualRate * 100) / 100 : null,
    sample_count: learnedMargin.sampleCount,
  })

  // ── Hysteresis kick: force relay ON if cooler is in dead band ──
  const coolerHysteresis = parseFloat(String(coolerController.cooling_hysteresis ?? '0.2'))
  const coolerTemp = parseFloat(String(coolerController.current_temp ?? '0'))
  const coolerRelayThreshold = clampedTarget + coolerHysteresis
  const coolerInDeadBand = coolerTemp > clampedTarget && coolerTemp < coolerRelayThreshold

  // Detect if the PREVIOUS cycle was a kick using the DB flag (set when kick is sent)
  const previousWasKick = !!(coolerController as any).hysteresis_kick_active

  if (previousWasKick) {
    log('HYSTERESIS_REVERT', 'action', `Föregående cykel var hysteres-kick (${round1(currentCoolerTarget)}°) — återgår till ${round1(clampedTarget)}°C`)
    // Clear the kick flag
    await supabase.from('rapt_temp_controllers')
      .update({ hysteresis_kick_active: false })
      .eq('controller_id', coolerController.controller_id)
    // Fall through to the normal "apply if different" logic below
  } else if (currentCoolerTarget <= coolerMinTemp - 0.5) {
    // Safety: if target is still at/below kick level (minTemp - 1°C) but flag was cleared,
    // RAPT may not have applied the revert. Force it back to the calculated target now.
    log('KICK_STUCK_GUARD', 'action', `Mål fortfarande vid kick-nivå (${round1(currentCoolerTarget)}° ≤ min ${round1(coolerMinTemp)}°) — tvingar tillbaka till ${round1(clampedTarget)}°C`)
    await applyCoolerTarget(ctx, coolerController, currentCoolerTarget, clampedTarget, effectiveTarget.temp,
      `🔧 Kick-stuck guard: mål ${round1(currentCoolerTarget)}° under min ${round1(coolerMinTemp)}° — återställer till ${round1(clampedTarget)}°C`,
      adjustments, effectiveTarget.controllerId, effectiveTarget.controllerName)
    return adjustments
  } else if (coolerInDeadBand) {
    // Only kick if: a tank is at 100% util AND cooler itself is at 0% util
    const anyTankMaxUtil = utilizations.some(u => u.utilization != null && u.utilization >= 0.99)
    const coolerAtZero = coolerUtil != null && coolerUtil < 0.01

    if (anyTankMaxUtil && coolerAtZero) {
      // ── Anti-oscillation: 15 min cooldown after kick+revert cycle ──
      const { data: lastKickAdj } = await supabase
        .from('auto_cooling_adjustments')
        .select('created_at')
        .eq('cooler_controller_id', coolerController.controller_id)
        .like('reason', '%Hysteres-kick%')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      const kickCooldownMs = 15 * 60 * 1000
      const timeSinceLastKick = lastKickAdj
        ? Date.now() - new Date(lastKickAdj.created_at).getTime()
        : Infinity
      if (timeSinceLastKick < kickCooldownMs) {
        log('HYSTERESIS_COOLDOWN', 'info', `Hysteres-kick cooldown — ${Math.round((kickCooldownMs - timeSinceLastKick) / 60000)} min kvar`)
      } else {
        // Kick target = 1°C below minimum allowed → clearly signals automation is active
        // SAFETY: Clamp to RAPT API minimum (-10°C) to prevent API rejection
        const kickTarget = round1(Math.max(-10, coolerMinTemp - 1))
        // Guard: skip if current target is already at or below kick target (no-op kick)
        if (currentCoolerTarget <= kickTarget) {
          log('HYSTERESIS_KICK_NOOP', 'info', `Hysteres-kick onödig — mål redan ${round1(currentCoolerTarget)}° ≤ kick ${kickTarget}°`)
        } else {
        const maxUtilTank = utilizations.find(u => u.utilization != null && u.utilization >= 0.99)
        log('HYSTERESIS_KICK', 'action', `Tank ${maxUtilTank?.controllerName} kyler 100% men glykolkylare 0% — kickar till ${kickTarget}°C (min ${coolerMinTemp}° - 1°)`)
        // Queue the kick — DB flag will be set AFTER batch flush succeeds (in auto-adjust-cooling)
        const kickApplied = await applyCoolerTarget(ctx, coolerController, currentCoolerTarget, kickTarget, effectiveTarget.temp,
          `⚡ Hysteres-kick: tank 100% + kylare 0% → mål ${kickTarget}° (återgår nästa cykel)`,
          adjustments, effectiveTarget.controllerId, effectiveTarget.controllerName)
        if (kickApplied) {
          // Signal to caller that kick flag should be set after flush confirms success
          ctx.pendingKickControllerId = coolerController.controller_id
        }
        return adjustments
        }
      }
    } else {
      log('HYSTERESIS_DEADBAND', 'info', `Kylare i dead band (${round1(coolerTemp)}° < ${round1(coolerRelayThreshold)}°)${anyTankMaxUtil ? '' : ' — ingen tank vid 100%'}${coolerAtZero ? '' : ` — kylare util ${coolerUtil != null ? Math.round(coolerUtil * 100) : '?'}%`}`)
    }
  }

  // ── All tanks at 0% utilization AND no PID cooling duty → turn cooler off ──
  // If no tank is cooling (hardware or PWM), raise cooler target to max so the
  // relay stays off.
  const anyPidCoolingDuty = ctx.pwmBursts?.some(b => b.duty_pct > 0) ?? false
  const allTanksZeroUtil = utilizations.length > 0 && utilizations.every(
    u => u.utilization != null && u.utilization < 0.01
  ) && !anyPidCoolingDuty
  if (allTanksZeroUtil && !previousWasKick) {
    // If cooler relay is already off (0% util), no need to send another shutdown
    const coolerAlreadyOff = coolerUtil != null && coolerUtil < 0.01
    if (coolerAlreadyOff) {
      log('COOLER_IDLE', 'info', `Alla controllers aktiverade 0% — kylare aktiverad 0% (avstängd), skippar`)
      await learnFromCurrentState(ctx, coolerController, controllersWithCooling, effectiveTarget, tempBucket, utilizations)
      return adjustments
    }

    // ── Warming rate prediction: keep cooler ready if temp will exceed target soon ──
    // Check if any tank's learned warming rate predicts it'll need cooling within 15 min
    let keepCoolerReady = false
    for (const c of controllersWithCooling) {
      const cBaseTarget = ctx.baseTargetMap?.get(c.controller_id) ?? parseFloat(String(c.target_temp ?? '20'))
      const cTempBucket = getTempBucket(cBaseTarget)
      const warmingParam = await getLearnedParam(supabase, c.controller_id, `warming_rate:${cTempBucket}`, -1)
      if (warmingParam.sampleCount >= 3 && warmingParam.value > 0.1) {
        const probeTemp = parseFloat(String(c.current_temp ?? '0'))
        const targetTemp = cBaseTarget
        const hysteresis = parseFloat(String(c.cooling_hysteresis ?? '0.2'))
        const headroom = (targetTemp + hysteresis) - probeTemp // °C before cooling triggers
        if (headroom > 0) {
          const minutesUntilCooling = (headroom / warmingParam.value) * 60

          // Use learned duty cycle for smarter prediction:
          // High duty cycle = controller spends a lot of time cooling = keep cooler ready sooner
          const dutyParam = await getLearnedParam(supabase, c.controller_id, `steady_state_duty:${cTempBucket}`, -1)
          const dutyThresholdMinutes = dutyParam.sampleCount >= 3 && dutyParam.value > 0.3
            ? 20  // high duty cycle → longer lookahead (keep cooler ready earlier)
            : 15  // default

          if (minutesUntilCooling < dutyThresholdMinutes) {
            const dutyInfo = dutyParam.sampleCount >= 3 ? ` duty=${Math.round(dutyParam.value * 100)}%` : ''
            log('WARMING_PREDICT', 'action', `${c.name}: warming ${warmingParam.value.toFixed(2)}°C/h → kylning behövs om ~${Math.round(minutesUntilCooling)}min${dutyInfo} — håller kylare redo`)
            keepCoolerReady = true
            break
          }
        }
      }
    }

    if (keepCoolerReady) {
      // Don't shut down cooler — keep at current target
      log('COOLER_IDLE', 'info', `Alla controllers aktiverade 0% men warming prediction → håller kylare aktiv`)
      await learnFromCurrentState(ctx, coolerController, controllersWithCooling, effectiveTarget, tempBucket, utilizations)
      return adjustments
    }

    // Cooldown: only idle once per 30 min to let new utilization data arrive
    const { data: lastIdleAdj } = await ctx.supabase
      .from('auto_cooling_adjustments')
      .select('created_at')
      .eq('cooler_controller_id', coolerController.controller_id)
      .like('reason', '%Alla controllers aktiverade 0%%')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    const idleCooldownMs = 30 * 60 * 1000
    const timeSinceLastIdle = lastIdleAdj
      ? Date.now() - new Date(lastIdleAdj.created_at).getTime()
      : Infinity
    if (timeSinceLastIdle < idleCooldownMs) {
      log('COOLER_IDLE', 'info', `Alla controllers aktiverade 0% — cooldown (${Math.round((idleCooldownMs - timeSinceLastIdle) / 60000)} min kvar)`)
    } else {
      const coolerHyst = coolerController.cooling_hysteresis ?? 0.2
      // Use effectiveTarget (based on tank demands) to ensure idle is above cooling threshold
      const idleTarget = Math.min(coolerMaxTemp, round1(Math.max(coolerTemp + coolerHyst, effectiveTarget.temp + 0.5)))
      if (currentCoolerTarget < idleTarget - 0.1) {
        log('COOLER_IDLE', 'action', `Alla controllers aktiverade 0% — stänger av kylare (${round1(currentCoolerTarget)}° → ${round1(idleTarget)}°C)`)
        await applyCoolerTarget(ctx, coolerController, currentCoolerTarget, idleTarget, effectiveTarget.temp,
          `💤 Alla controllers aktiverade 0% — höjer kylare till ${idleTarget}°C (stänger av)`,
          adjustments, effectiveTarget.controllerId, effectiveTarget.controllerName)
        return adjustments
      } else {
        log('COOLER_IDLE', 'info', `Alla controllers aktiverade 0% — kylare redan av (mål ${round1(currentCoolerTarget)}°)`)
      }
    }
  }


  // ── Relay-aware no-op guard ────────────────────────────────
  // Instead of a fixed 0.1°C threshold, check if the new target would
  // actually change the cooler relay state. With large hysteresis (e.g. 2°C),
  // small adjustments (0.2°C) are meaningless API calls.
  //
  // IMPORTANT: Only block LOWERING when relay state is unchanged.
  // RAISING (less aggressive) is always applied so the cooler target
  // tracks the formula (lowest target − margin) accurately.
  // Without this, the target gets stuck at an overly aggressive value
  // and margin learning can never validate whether a higher target suffices.
  const diff = Math.abs(clampedTarget - currentCoolerTarget)
  const isRaising = clampedTarget > currentCoolerTarget
  const oldRelayOn = coolerTemp > currentCoolerTarget + coolerHysteresis
  const newRelayOn = coolerTemp > clampedTarget + coolerHysteresis
  // Allow lowering if diff > 1.0°C even when relay state is unchanged.
  // This ensures the cooler preemptively positions itself for upcoming demand
  // instead of staying too warm until a tank actually triggers its cooling relay.
  const isSignificantLowering = !isRaising && diff > 1.0
  if (!isRaising && !isSignificantLowering && oldRelayOn === newRelayOn && diff < coolerHysteresis && !previousWasKick) {
    log('COOLER_OK', 'pass', `Ändring ${diff.toFixed(1)}°C < hysteres ${coolerHysteresis}°C — relästatus oförändrad (relä ${oldRelayOn ? 'PÅ' : 'AV'}, temp ${round1(coolerTemp)}°, tröskel ${round1(clampedTarget + coolerHysteresis)}°)`)
    await learnFromCurrentState(ctx, coolerController, controllersWithCooling, effectiveTarget, tempBucket, utilizations)
    return adjustments
  }

  // ── Manual override cooldown: respect user's cooler changes for 30 min ──
  // If the user manually changed the cooler target recently, don't override it.
  if (!previousWasKick) {
    const { data: recentManualAdj } = await supabase
      .from('auto_cooling_adjustments')
      .select('created_at, reason, old_target_temp, new_target_temp')
      .eq('cooler_controller_id', coolerController.controller_id)
      .like('reason', '%Manuell hårdvaruändring%kylare-hanterad%')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (recentManualAdj) {
      const manualCooldownMs = 30 * 60 * 1000 // 30 min cooldown
      const timeSinceManual = Date.now() - new Date(recentManualAdj.created_at).getTime()
      if (timeSinceManual < manualCooldownMs) {
        const oldManualTarget = parseFloat(String(recentManualAdj.old_target_temp ?? currentCoolerTarget))
        const newManualTarget = parseFloat(String(recentManualAdj.new_target_temp ?? currentCoolerTarget))
        const userRequestedLower = newManualTarget < oldManualTarget - 0.1
        const automationRaisedAboveManual = currentCoolerTarget > newManualTarget + 0.5
        const automationWantsLowerNow = clampedTarget < currentCoolerTarget - 0.1

        // Guard against cooldown lock: if user manually lowered the cooler target,
        // but automation later raised it above that manual level, allow a corrective
        // lower adjustment instead of freezing at an overly warm target.
        if (userRequestedLower && automationRaisedAboveManual && automationWantsLowerNow) {
          log(
            'MANUAL_COOLDOWN_BYPASS',
            'action',
            `Bypass cooldown: manuell sänkning ${round1(oldManualTarget)}°→${round1(newManualTarget)}° överskreds (nu ${round1(currentCoolerTarget)}°), tillåter korrigering till ${round1(clampedTarget)}°`
          )
        } else {
          log('MANUAL_COOLDOWN', 'info', `Manuell kylare-ändring detekterad för ${Math.round(timeSinceManual / 60000)}min sedan — respekterar i ${Math.round((manualCooldownMs - timeSinceManual) / 60000)}min till`)
          return adjustments
        }
      }
    }
  }

  // Rate-limit: 5 min between adjustments (bypassed for hysteresis revert)
  if (!previousWasKick) {
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
  }

  // ── Block raising cooler during active downward ramps ─────
  if (clampedTarget > currentCoolerTarget) {
    if (effectiveTarget.isRampingDown) {
      log('RAMP_BLOCK', 'info', 'Blockerar höjning — aktiv nedåtramp pågår')
      return adjustments
    }
  }

  // ── Demand guard: only LOWER cooler if tanks actually need cooling ──
  if (clampedTarget < currentCoolerTarget && !effectiveTarget.isRampingDown) {
    const anyActivelyCooling = utilizations.some(u => u.isActivelyCooling)
    if (!anyActivelyCooling) {
      log('DEMAND_GUARD', 'info', `Ingen tank kyler aktivt — avvaktar sänkning (${currentCoolerTarget}°C → ${clampedTarget}°C)`)
      await learnFromCurrentState(ctx, coolerController, controllersWithCooling, effectiveTarget, tempBucket, utilizations)
      return adjustments
    }

    // Even if probe > target+hysteresis right now, block if utilization is very low
    // (tank's cooling relay barely running → no real demand for lower cooler)
    const lowestUtil = utilizations.find(u => u.controllerId === effectiveTarget.controllerId)
    if (lowestUtil?.utilization != null && lowestUtil.utilization < 0.10) {
      log('DEMAND_GUARD', 'info', `Tank kyler momentant men util=${Math.round(lowestUtil.utilization * 100)}% — avvaktar sänkning (${currentCoolerTarget}°C → ${clampedTarget}°C)`)
      await learnFromCurrentState(ctx, coolerController, controllersWithCooling, effectiveTarget, tempBucket, utilizations)
      return adjustments
    }
  }

  // ── Apply ─────────────────────────────────────────────────
  const direction = clampedTarget < currentCoolerTarget ? 'Sänker' : 'Höjer'
  const rateInfo = rateBoostFactor > 1.0 ? `, rate-boost ×${rateBoostFactor.toFixed(2)}` : ''
  await applyCoolerTarget(ctx, coolerController, currentCoolerTarget, clampedTarget, effectiveTarget.temp,
    `${direction} kylare: margin ${effectiveMargin.toFixed(1)}°C [${marginSource}] under ${effectiveTarget.temp.toFixed(1)}°C (${effectiveTarget.source}${rateInfo})`,
    adjustments, effectiveTarget.controllerId, effectiveTarget.controllerName)

  return adjustments
}

// ─── Cooling Utilization Tracking ─────────────────────────────
// Tracks cooling_run_time between cycles to calculate what fraction
// of the time each controller's cooling circuit was running.

// Calculate rolling 30-min utilization for a single controller
// Returns { rolling, recent } where recent = util between the two latest data points
export interface UtilizationResult {
  rolling: number | null   // avg of 2 most recent intervals (for decisions)
  recent: number | null    // p1→p0 (most recent interval)
  mid: number | null       // p2→p1 (second most recent interval)
  oldest: number | null    // p3→p2 (third interval)
  ancient: number | null   // p4→p3 (oldest interval)
  prevRunTime: number      // p1
  prevTimestampMs: number
  p2RunTime: number        // p2
  p2TimestampMs: number
  anchorRunTime: number    // p3
  anchorTimestampMs: number
  p4RunTime: number        // p4 (oldest)
  p4TimestampMs: number
  currentRunTime: number   // p0
  sensorTimestampMs: number
}

export async function calculateSingleUtilization(
  supabase: ReturnType<typeof createClient>,
  c: TempController,
  options?: { skipShift?: boolean },
): Promise<UtilizationResult> {
  const currentRunTime = c.cooling_run_time ?? 0
  const sensorTimestampMs = c.last_update ? new Date(c.last_update).getTime() : 0

  // Load all 5 stored points: p4 (oldest) → p3 (anchor) → p2 → p1 (prev) → p0 (current from hw)
  const [p4RunTimeParam, p4TimestampParam, anchorRunTimeParam, anchorTimestampParam, p2RunTimeParam, p2TimestampParam, prevRunTimeParam, prevTimestampParam] = await Promise.all([
    getLearnedParam(supabase, c.controller_id, 'util_p4_run_time', -1),
    getLearnedParam(supabase, c.controller_id, 'util_p4_at', 0),
    getLearnedParam(supabase, c.controller_id, 'util_anchor_run_time', -1),
    getLearnedParam(supabase, c.controller_id, 'util_anchor_at', 0),
    getLearnedParam(supabase, c.controller_id, 'util_p2_run_time', -1),
    getLearnedParam(supabase, c.controller_id, 'util_p2_at', 0),
    getLearnedParam(supabase, c.controller_id, 'util_prev_run_time', -1),
    getLearnedParam(supabase, c.controller_id, 'util_prev_at', 0),
  ])

  let p4RunTime = p4RunTimeParam.value
  let p4TimestampMs = p4TimestampParam.value
  let anchorRunTime = anchorRunTimeParam.value
  let anchorTimestampMs = anchorTimestampParam.value
  let p2RunTime = p2RunTimeParam.value
  let p2TimestampMs = p2TimestampParam.value

  // Preserve pre-shift values for calcInterval (shift mutates p2/anchor/p4)
  const origP2RunTime = p2RunTime
  const origP2TimestampMs = p2TimestampMs
  const origAnchorRunTime = anchorRunTime
  const origAnchorTimestampMs = anchorTimestampMs
  const origP4RunTime = p4RunTime
  const origP4TimestampMs = p4TimestampMs

  const prevSensorMs = prevTimestampParam.value
  const prevRunTime = prevRunTimeParam.value
  const isNewData = sensorTimestampMs > 0 && (prevSensorMs === 0 || sensorTimestampMs > prevSensorMs + 30_000)

  if (isNewData && prevSensorMs > 0 && !options?.skipShift) {
    // Shift the chain: p4 ← old p3, p3 ← old p2, p2 ← old p1, p1 ← current
    const now = new Date().toISOString()

    // Promote anchor (p3) → p4
    if (anchorRunTime >= 0 && anchorTimestampMs > 0) {
      p4RunTime = anchorRunTime
      p4TimestampMs = anchorTimestampMs
      await Promise.all([
        supabase.from('fermentation_learnings').upsert({
          controller_id: c.controller_id, parameter_name: 'util_p4_run_time',
          learned_value: p4RunTime, sample_count: 1, last_updated_at: now,
        }, { onConflict: 'controller_id,parameter_name' }),
        supabase.from('fermentation_learnings').upsert({
          controller_id: c.controller_id, parameter_name: 'util_p4_at',
          learned_value: p4TimestampMs, sample_count: 1, last_updated_at: now,
        }, { onConflict: 'controller_id,parameter_name' }),
      ])
    }

    // Promote p2 → anchor (p3)
    if (p2RunTime >= 0 && p2TimestampMs > 0) {
      anchorRunTime = p2RunTime
      anchorTimestampMs = p2TimestampMs
      await Promise.all([
        supabase.from('fermentation_learnings').upsert({
          controller_id: c.controller_id, parameter_name: 'util_anchor_run_time',
          learned_value: anchorRunTime, sample_count: 1, last_updated_at: now,
        }, { onConflict: 'controller_id,parameter_name' }),
        supabase.from('fermentation_learnings').upsert({
          controller_id: c.controller_id, parameter_name: 'util_anchor_at',
          learned_value: anchorTimestampMs, sample_count: 1, last_updated_at: now,
        }, { onConflict: 'controller_id,parameter_name' }),
      ])
    }

    // Promote prev → p2
    p2RunTime = prevRunTime
    p2TimestampMs = prevSensorMs
    await Promise.all([
      supabase.from('fermentation_learnings').upsert({
        controller_id: c.controller_id, parameter_name: 'util_p2_run_time',
        learned_value: p2RunTime, sample_count: 1, last_updated_at: now,
      }, { onConflict: 'controller_id,parameter_name' }),
      supabase.from('fermentation_learnings').upsert({
        controller_id: c.controller_id, parameter_name: 'util_p2_at',
        learned_value: p2TimestampMs, sample_count: 1, last_updated_at: now,
      }, { onConflict: 'controller_id,parameter_name' }),
    ])

    // Save current as new prev (p1)
    await Promise.all([
      supabase.from('fermentation_learnings').upsert({
        controller_id: c.controller_id, parameter_name: 'util_prev_run_time',
        learned_value: currentRunTime, sample_count: 1, last_updated_at: now,
      }, { onConflict: 'controller_id,parameter_name' }),
      supabase.from('fermentation_learnings').upsert({
        controller_id: c.controller_id, parameter_name: 'util_prev_at',
        learned_value: sensorTimestampMs, sample_count: 1, last_updated_at: now,
      }, { onConflict: 'controller_id,parameter_name' }),
    ])
  } else if (isNewData && prevSensorMs === 0 && !options?.skipShift) {
    // First data point ever — just save as prev
    const now = new Date().toISOString()
    await Promise.all([
      supabase.from('fermentation_learnings').upsert({
        controller_id: c.controller_id, parameter_name: 'util_prev_run_time',
        learned_value: currentRunTime, sample_count: 1, last_updated_at: now,
      }, { onConflict: 'controller_id,parameter_name' }),
      supabase.from('fermentation_learnings').upsert({
        controller_id: c.controller_id, parameter_name: 'util_prev_at',
        learned_value: sensorTimestampMs, sample_count: 1, last_updated_at: now,
      }, { onConflict: 'controller_id,parameter_name' }),
    ])
  }

  // Helper to compute utilization between two points
  const calcInterval = (fromRunTime: number, fromMs: number, toRunTime: number, toMs: number): number | null => {
    if (fromRunTime < 0 || fromMs <= 0 || toMs <= fromMs) return null
    const elapsed = (toMs - fromMs) / 1000
    if (elapsed <= 30) return null
    const delta = toRunTime - fromRunTime
    return delta >= 0 ? Math.min(1.0, delta / elapsed) : null
  }

  // p1→p0 (most recent interval) — use original (pre-shift) prev values
  const recent = calcInterval(prevRunTime, prevSensorMs, currentRunTime, sensorTimestampMs)
  // p2→p1 — use original p2 values (before shift mutated them)
  const mid = calcInterval(origP2RunTime, origP2TimestampMs, prevRunTime, prevSensorMs)
  // p3→p2 — use original anchor values
  const oldest = calcInterval(origAnchorRunTime, origAnchorTimestampMs, origP2RunTime, origP2TimestampMs)
  // p4→p3 — use original p4 values
  const ancient = calcInterval(origP4RunTime, origP4TimestampMs, origAnchorRunTime, origAnchorTimestampMs)

  // Rolling = average of the 2 most recent intervals (for decisions)
  let rolling: number | null = null
  if (recent != null && mid != null) {
    rolling = (recent + mid) / 2
  } else if (recent != null) {
    rolling = recent
  } else if (mid != null) {
    rolling = mid
  }

  return {
    rolling, recent, mid, oldest, ancient,
    prevRunTime, prevTimestampMs: prevSensorMs,
    p2RunTime: origP2RunTime, p2TimestampMs: origP2TimestampMs,
    anchorRunTime: origAnchorRunTime, anchorTimestampMs: origAnchorTimestampMs,
    p4RunTime: origP4RunTime, p4TimestampMs: origP4TimestampMs,
    currentRunTime, sensorTimestampMs,
  }
}

async function calculateCoolingUtilizations(
  ctx: CoolerContext,
  controllersWithCooling: TempController[],
): Promise<CoolingUtilization[]> {
  const results: CoolingUtilization[] = []

  for (const c of controllersWithCooling) {
    const probeTemp = parseFloat(String(c.current_temp ?? c.pill_temp ?? '999'))
    const targetTemp = parseFloat(String(c.target_temp ?? '999'))
    const hysteresis = parseFloat(String(c.cooling_hysteresis ?? '0.2'))
    // Calculate utilization first (needed for both active-cooling check and results)
    const utilResult = await calculateSingleUtilization(ctx.supabase, c)
    // Consider "actively cooling" if probe exceeds threshold OR utilization is meaningfully high
    // OR PID has assigned a non-zero cooling duty (PWM mode — hardware util may be 0%)
    const isAboveThreshold = probeTemp > targetTemp + hysteresis
    const isHighUtil = utilResult.rolling != null && utilResult.rolling >= 0.30
    const pwmDuty = ctx.pwmBursts?.find(b => b.controller_id === c.controller_id)?.duty_pct ?? 0
    const hasPidCoolingDuty = pwmDuty > 0
    const isActivelyCooling = isAboveThreshold || isHighUtil || hasPidCoolingDuty

    results.push({
      controllerId: c.controller_id,
      controllerName: c.name,
      utilization: utilResult.rolling,
      recentUtilization: utilResult.recent,
      midUtilization: utilResult.mid,
      oldestUtilization: utilResult.oldest,
      ancientUtilization: utilResult.ancient,
      isActivelyCooling,
      probeTemp,
      targetTemp,
      hysteresis,
      prevTimestampMs: utilResult.prevTimestampMs,
      prevRunTime: utilResult.prevRunTime,
      p2TimestampMs: utilResult.p2TimestampMs,
      p2RunTime: utilResult.p2RunTime,
      anchorTimestampMs: utilResult.anchorTimestampMs,
      anchorRunTime: utilResult.anchorRunTime,
      p4TimestampMs: utilResult.p4TimestampMs,
      p4RunTime: utilResult.p4RunTime,
      currentRunTime: utilResult.currentRunTime,
      sensorTimestampMs: utilResult.sensorTimestampMs,
    })
  }

  return results
}



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

  // Helper: get the stable baseTarget (grundmål) for a controller.
  // Falls back to target_temp if no baseTarget is available (e.g. no active session).
  const getBaseTarget = (c: TempController): number =>
    ctx.baseTargetMap?.get(c.controller_id) ?? parseFloat(String(c.target_temp ?? '999'))

  // Start with the static lowest baseTarget (not PID-adjusted target_temp)
  const lowestStatic = controllersWithCooling.reduce((lowest, c) => {
    const t = getBaseTarget(c)
    const lt = getBaseTarget(lowest)
    return t < lt ? c : lowest
  })

  let result: EffectiveTarget = {
    temp: getBaseTarget(lowestStatic),
    controllerName: lowestStatic.name,
    controllerId: lowestStatic.controller_id,
    source: 'baseTarget',
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
  utilizations?: CoolingUtilization[],
): Promise<void> {
  const { supabase, log } = ctx

  // ── Skip all learning during idle mode ──
  if (ctx.skipLearning) {
    log('LEARN_SKIP', 'info', 'Hoppar all inlärning — systemet i viloläge')
    return
  }

  // ── Only learn when at least one controller is actively cooling ──
  // If no tank has active demand, the observed margin is meaningless
  const anyActive = utilizations?.some(u => u.isActivelyCooling) ?? false
  if (!anyActive) {
    // ── Learn warming rate + duty cycle even during PWM — these use probe history, not hardware targets ──
    await learnWarmingRate(ctx, controllersWithCooling, tempBucket)
    log('MARGIN_LEARN', 'info', `Hoppar marginalinlärning — ingen controller kyler aktivt`)
    return
  }

  // ── Skip margin/cooling-rate learning during PWM ON phases — targets are temporary ──
  const { data: activePwmReverts } = await supabase
    .from('pending_rapt_retries')
    .select('controller_id')
    .like('reason', '%PWM OFF%')
    .limit(1)
  if (activePwmReverts && activePwmReverts.length > 0) {
    // Still learn warming rate + duty cycle — PWM only affects hardware target, not thermal behavior
    await learnWarmingRate(ctx, controllersWithCooling, tempBucket)
    log('MARGIN_LEARN', 'info', `Hoppar marginal/cooling-rate-inlärning — PWM-burst aktiv (duty cycle uppdateras separat)`)
    return
  }
  const currentCoolerTarget = parseFloat(String(coolerController.target_temp ?? '18'))
  const coolerMaxTemp = parseFloat(String(coolerController.max_target_temp ?? '25'))
  const currentMargin = Math.abs(effectiveTarget.temp - currentCoolerTarget)

  // ── Guard: skip hold_margin learning when cooler is at/near max (idle) ──
  // When the cooler target is clamped at max_target_temp, the observed margin
  // is artificially small (e.g. 1.0°C). Learning this value creates a
  // self-reinforcing loop where the margin stays too small to ever cool.
  const coolerEffectivelyIdle = currentCoolerTarget >= coolerMaxTemp - 0.5
  if (coolerEffectivelyIdle) {
    await learnWarmingRate(ctx, controllersWithCooling, tempBucket)
    log('MARGIN_LEARN', 'info', `Hoppar marginalinlärning — kylare vid max (${round1(currentCoolerTarget)}° ≈ max ${round1(coolerMaxTemp)}°), observerad marginal ${currentMargin.toFixed(1)}° är artificiellt liten`)
    return
  }

  // Use baseTarget (grundmål) for margin learning — stable and not affected by PI fluctuations
  const getBaseTarget = (c: TempController): number =>
    ctx.baseTargetMap?.get(c.controller_id) ?? parseFloat(String(c.target_temp ?? '999'))

  const lowestController = controllersWithCooling.reduce((lowest, c) => {
    const t = getBaseTarget(c)
    const lt = getBaseTarget(lowest)
    return t < lt ? c : lowest
  })

  const probeTemp = parseFloat(String(lowestController.current_temp ?? '999'))
  const targetTemp = getBaseTarget(lowestController)
  const hysteresis = parseFloat(String(lowestController.cooling_hysteresis ?? '0.2'))

  // ── Measure actual cooling rate from history (last 30 min) ──
  const actualRate = await measureCoolingRate(supabase, lowestController.controller_id)

  const lowestUtil = utilizations?.find(u => u.controllerId === lowestController.controller_id)

  // ── Determine load bucket (how many tanks are actively cooling) ──
  const activeTankCount = utilizations?.filter(u => u.isActivelyCooling).length ?? 0
  const loadBucket = activeTankCount === 0 ? 'load_0' : activeTankCount === 1 ? 'load_1' : 'load_2plus'

  // ── Determine activity bucket for learning ──
  const activityBucket = await getActivityBucket(supabase, lowestController.controller_id)

  // ── Learn cooling rate per bucket+load+activity ──
  if (actualRate !== null && actualRate > 0.05) {
    const rateParam = `cooling_rate:${tempBucket}:${loadBucket}:${activityBucket}`
    const rateParamGeneric = `cooling_rate:${tempBucket}:${loadBucket}`
    const [rateResult] = await Promise.all([
      updateLearnedParam(supabase, coolerController.controller_id, rateParam, actualRate, 0.01, 20.0),
      updateLearnedParam(supabase, coolerController.controller_id, rateParamGeneric, actualRate, 0.01, 20.0),
    ])
    if (Math.abs(rateResult.oldValue - rateResult.newValue) > 0.01) {
      log('RATE_LEARN', 'info', `🎓 [${tempBucket}:${loadBucket}:${activityBucket}] Cooling rate: ${rateResult.oldValue.toFixed(2)}→${rateResult.newValue.toFixed(2)}°C/h`)
    }
  }

  // ── Learn cooling capacity at near-100% utilization ──
  if (lowestUtil?.utilization != null && lowestUtil.utilization >= 0.95 && actualRate !== null && actualRate > 0) {
    const capParam = `cooling_capacity:${loadBucket}`
    await updateLearnedParam(supabase, coolerController.controller_id, capParam, actualRate, 0.01, 20.0)
  }

  // ── Determine if current state is hold or ramp for separate margin learning ──
  const isRamp = effectiveTarget.isRampingDown || (effectiveTarget.requiredRatePerHour != null && effectiveTarget.requiredRatePerHour > 0)
  const marginType = isRamp ? 'ramp_margin' : 'hold_margin'
  const marginParam = `${marginType}:${tempBucket}:${loadBucket}:${activityBucket}`
  const marginParamGeneric = `${marginType}:${tempBucket}:${loadBucket}`

  // ── Rate-based learning during active ramps ──
  if (effectiveTarget.requiredRatePerHour != null && effectiveTarget.requiredRatePerHour > 0 && actualRate !== null) {
    const requiredRate = effectiveTarget.requiredRatePerHour
    const ratio = actualRate > 0.05 ? requiredRate / actualRate : 2.0 // avoid div-by-zero

    log('RATE_LEARN', 'info', `Ramp rate: actual ${actualRate.toFixed(2)}°C/h vs required ${requiredRate.toFixed(2)}°C/h (ratio ${ratio.toFixed(2)})`)

    if (ratio > 1.1) {
      const scaledMargin = currentMargin * Math.min(ratio, 1.5)
      const result = await updateLearnedParam(supabase, coolerController.controller_id, `cooler_margin:${tempBucket}`, scaledMargin, 2.0, 15.0)
      log('MARGIN_LEARN', 'action', `[${tempBucket}] Rate too slow — increasing: ${result.oldValue.toFixed(2)}→${result.newValue.toFixed(2)}°C`, { old_value: result.oldValue, new_value: result.newValue })
    } else if (ratio < 0.85) {
      const tighterMargin = currentMargin * 0.95
      const result = await updateLearnedParam(supabase, coolerController.controller_id, `cooler_margin:${tempBucket}`, tighterMargin, 2.0, 15.0)
      log('MARGIN_LEARN', 'pass', `[${tempBucket}] Rate adequate — tightening: ${result.oldValue.toFixed(2)}→${result.newValue.toFixed(2)}°C`, { old_value: result.oldValue, new_value: result.newValue })
    }

    // Learn ramp-specific margin (both activity-specific and generic)
    await Promise.all([
      updateLearnedParam(supabase, coolerController.controller_id, marginParam, currentMargin, 1.0, 15.0),
      updateLearnedParam(supabase, coolerController.controller_id, marginParamGeneric, currentMargin, 1.0, 15.0),
    ])

    await learnMinEffectiveMargin(supabase, coolerController.controller_id, tempBucket, currentMargin, actualRate, log, lowestUtil?.utilization)
    return
  }

  // ── Utilization-based learning (hold steps) ──
  // Primary learning signal: how hard is the cooling circuit working?
  // Philosophy: only increase margin at 100% utilization (tank can't keep up).
  // Otherwise tighten aggressively to keep cooler temp as high as possible
  // (minimizes condensation risk on glycol lines).
  if (lowestUtil?.utilization != null) {
    const util = lowestUtil.utilization

    log('UTIL_LEARN', 'info', `[${tempBucket}] Cooling utilization: ${Math.round(util * 100)}% (margin ${currentMargin.toFixed(1)}°C)`)

    if (util >= 0.99 && currentMargin > 1.0) {
      // Cooling circuit running 100% — tank genuinely can't keep up, need more margin
      const scaledMargin = currentMargin * 1.08  // conservative 8% increase
      const result = await updateLearnedParam(supabase, coolerController.controller_id, `cooler_margin:${tempBucket}`, scaledMargin, 2.0, 15.0)
      log('MARGIN_LEARN', 'action', `🎓 [${tempBucket}] Full utilization (${Math.round(util * 100)}%) — increasing: ${result.oldValue.toFixed(2)}→${result.newValue.toFixed(2)}°C`, { old_value: result.oldValue, new_value: result.newValue })
    } else if (util < 0.7 && currentMargin > 1.2) {
      // Under 70% — actively tighten to reduce condensation risk
      // Use faster alpha (0.3) at low util for quicker downward convergence
      // Threshold lowered from 2.0 to 1.2 so margins approaching min_effective can still converge
      const tighterMargin = currentMargin * 0.93  // 7% decrease (more aggressive)
      const alphaOverride = util < 0.5 ? 0.3 : undefined
      const result = await updateLearnedParam(supabase, coolerController.controller_id, `cooler_margin:${tempBucket}`, tighterMargin, 2.0, 15.0, alphaOverride)
      log('MARGIN_LEARN', 'pass', `🎓 [${tempBucket}] Low utilization (${Math.round(util * 100)}%) — tightening: ${result.oldValue.toFixed(2)}→${result.newValue.toFixed(2)}°C${alphaOverride ? ' (fast α=0.3)' : ''}`, { old_value: result.oldValue, new_value: result.newValue })
    } else if (util >= 0.7 && util < 0.99) {
      // 70–99%: good zone, but still try to nudge tighter slowly
      if (currentMargin > 2.5) {
        const nudge = currentMargin * 0.98  // gentle 2% decrease
        const result = await updateLearnedParam(supabase, coolerController.controller_id, `cooler_margin:${tempBucket}`, nudge, 2.0, 15.0)
        log('MARGIN_LEARN', 'pass', `🎓 [${tempBucket}] Good utilization (${Math.round(util * 100)}%) — nudging tighter: ${result.oldValue.toFixed(2)}→${result.newValue.toFixed(2)}°C`, { old_value: result.oldValue, new_value: result.newValue })
      } else {
        log('MARGIN_LEARN', 'pass', `🎓 [${tempBucket}] Good utilization (${Math.round(util * 100)}%) — margin ${currentMargin.toFixed(1)}°C is optimal`)
      }
    }

    // Learn hold-specific margin (both activity-specific and generic)
    await Promise.all([
      updateLearnedParam(supabase, coolerController.controller_id, marginParam, currentMargin, 1.0, 15.0),
      updateLearnedParam(supabase, coolerController.controller_id, marginParamGeneric, currentMargin, 1.0, 15.0),
    ])

    // Also learn max effective during hold if we have rate data
    if (actualRate !== null) {
      await learnMinEffectiveMargin(supabase, coolerController.controller_id, tempBucket, currentMargin, actualRate, log, lowestUtil?.utilization)
    }
    return
  }

  // ── Fallback: static target-based learning (no utilization data yet) ──
  const atTarget = probeTemp <= targetTemp + hysteresis
  const overshot = probeTemp < targetTemp - 1.0

  if (atTarget && !overshot && currentMargin > 1.0) {
    const tighterMargin = currentMargin * 0.97
    const result = await updateLearnedParam(supabase, coolerController.controller_id, `cooler_margin:${tempBucket}`, tighterMargin, 2.0, 15.0)
    log('MARGIN_LEARN', 'pass', `[${tempBucket}] Margin adequate: ${result.oldValue.toFixed(1)}→${result.newValue.toFixed(1)}°C`, { old_value: result.oldValue, new_value: result.newValue })
  } else if (overshot) {
    const reducedMargin = currentMargin * 0.75
    const result = await updateLearnedParam(supabase, coolerController.controller_id, `cooler_margin:${tempBucket}`, reducedMargin, 2.0, 15.0)
    log('MARGIN_LEARN', 'action', `[${tempBucket}] Overshoot! Reducing: ${result.oldValue.toFixed(1)}→${result.newValue.toFixed(1)}°C`, { old_value: result.oldValue, new_value: result.newValue })
  } else if (!atTarget) {
    const biggerMargin = currentMargin * 1.15
    const result = await updateLearnedParam(supabase, coolerController.controller_id, `cooler_margin:${tempBucket}`, biggerMargin, 2.0, 15.0)
    log('MARGIN_LEARN', 'action', `[${tempBucket}] Når ej mål — ökar marginal: ${result.oldValue.toFixed(1)}→${result.newValue.toFixed(1)}°C`, { old_value: result.oldValue, new_value: result.newValue })
  }

  // Learn hold-specific margin (both activity-specific and generic)
  await Promise.all([
    updateLearnedParam(supabase, coolerController.controller_id, marginParam, currentMargin, 1.0, 15.0),
    updateLearnedParam(supabase, coolerController.controller_id, marginParamGeneric, currentMargin, 1.0, 15.0),
  ])

  if (actualRate !== null) {
    await learnMinEffectiveMargin(supabase, coolerController.controller_id, tempBucket, currentMargin, actualRate, log, lowestUtil?.utilization)
  }
}

// ─── Learn passive warming rate ──────────────────────────────
// When no controller is actively cooling (cooler util ~0%), measure
// how fast each controller's probe temp rises passively.

async function learnWarmingRate(
  ctx: CoolerContext,
  controllersWithCooling: TempController[],
  tempBucket: string,
): Promise<void> {
  const { supabase, log } = ctx

  for (const c of controllersWithCooling) {
    // Use the controller's own target temp for bucket, not the cooler's
    const controllerBucket = getTempBucket(ctx.baseTargetMap?.get(c.controller_id) ?? parseFloat(String(c.target_temp ?? '20')))
    const rate = await measureCoolingRate(supabase, c.controller_id)
    // rate > 0 = cooling, rate < 0 = warming. We want warming (negative rate → positive warming)
    if (rate !== null && rate < -0.05) {
      const warmingRate = Math.abs(rate) // °C/h of passive warming
      const result = await updateLearnedParam(supabase, c.controller_id, `warming_rate:${controllerBucket}`, warmingRate, 0.01, 10.0)
      if (Math.abs(result.oldValue - result.newValue) > 0.01) {
        log('WARMING_LEARN', 'info', `🎓 [${controllerBucket}] ${c.name} warming rate: ${result.oldValue.toFixed(2)}→${result.newValue.toFixed(2)}°C/h`)
      }

      // Steady-state duty cycle learning removed — the PID integral now
      // directly accumulates the steady-state duty via the unified duty-cycle model.
    }
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

// ─── Get activity bucket for a controller ────────────────────
// Looks up the fermentation activity_score via running session → brew → metrics
// Returns 'activity_high' (≥40%) or 'activity_low' (<40%)

async function getActivityBucket(
  supabase: ReturnType<typeof createClient>,
  controllerId: string,
): Promise<'activity_high' | 'activity_low'> {
  const { data: session } = await supabase
    .from('fermentation_sessions')
    .select('brew_id')
    .eq('controller_id', controllerId)
    .eq('status', 'running')
    .limit(1)
    .maybeSingle()

  if (!session?.brew_id) return 'activity_low'

  const { data: metrics } = await supabase
    .from('brew_fermentation_metrics')
    .select('activity_score')
    .eq('brew_id', session.brew_id)
    .limit(1)
    .maybeSingle()

  if (!metrics) return 'activity_low'

  return parseFloat(String(metrics.activity_score)) >= 40 ? 'activity_high' : 'activity_low'
}



async function learnMinEffectiveMargin(
  supabase: ReturnType<typeof createClient>,
  coolerId: string,
  tempBucket: string,
  currentMargin: number,
  currentRate: number,
  log: CoolerContext['log'],
  utilization?: number | null,
): Promise<void> {
  // Only learn from cycles where cooling is actually happening (rate > 0)
  if (currentRate <= 0 || currentMargin < 0.5) {
    // No boost at 100% util — cooler_margin learning already handles escalation
    if (utilization != null && utilization >= 0.99) {
      log('MIN_MARGIN', 'info', `[${tempBucket}] Util 100% + rate≤0 — skipping min_effective boost (cooler_margin handles escalation)`)
    }
    return
  }

  // Pure observation: converge toward current margin when cooling actually works
  // No boost logic — this is just tracking what margin produces cooling
  const result = await updateLearnedParam(supabase, coolerId, `min_effective_margin:${tempBucket}`, currentMargin, 0.5, 20.0)
  if (Math.abs(result.oldValue - result.newValue) > 0.05) {
    log('MIN_MARGIN', 'info', `[${tempBucket}] Min eff marginal: ${result.oldValue.toFixed(1)}→${result.newValue.toFixed(1)}°C (rate ${currentRate.toFixed(2)}°C/h, util ${utilization != null ? Math.round(utilization * 100) : '?'}%, n=${result.sampleCount})`)
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
): Promise<boolean> {
  const { supabase, supabaseUrl, serviceRoleKey, log } = ctx

  log('ADJUSTMENT', 'action', `${oldTarget}°C → ${newTarget}°C: ${reason}`)

  let success: boolean
  if (ctx.updateBatch) {
    ctx.updateBatch.add(coolerController.controller_id, newTarget, oldTarget)
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
  return success
}
