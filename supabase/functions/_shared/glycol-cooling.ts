import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { round1, TempController, setControllerTargetTemp, learnGlycolCoolerRate, getGlycolRatesSummary } from './temp-utils.ts'
import { getTempBucket, getLearnedParam, updateLearnedParam } from './learning-utils.ts'
import { logAdjustment, AdjustmentResult } from './adjustment-logger.ts'

// ============================================================
// Glycol Cooling Management (Feature 3)
// Single Source of Truth for glycol cooler logic.
// ============================================================

export interface GlycolContext {
  supabase: ReturnType<typeof createClient>
  supabaseUrl: string
  serviceRoleKey: string
  allControllers: TempController[]
  followedControllersFullData: TempController[]
  followedControllerIds: string[]
  settings: { id: string; last_check_at: string | null }
  log: (step: string, result: 'pass' | 'fail' | 'info' | 'action', message: string, details?: Record<string, unknown>) => void
}

// ─── Proactive pre-cooling types ──────────────────────────────
interface UpcomingCoolingNeed {
  controllerId: string
  controllerName: string
  currentTarget: number
  upcomingTarget: number
  rampRateNeeded: number // °C/h needed
  hoursUntilNeeded: number // how soon the ramp starts/is happening
  stepType: string
}

export async function runGlycolCooling(ctx: GlycolContext): Promise<AdjustmentResult[]> {
  const { supabase, supabaseUrl, serviceRoleKey, allControllers, followedControllersFullData, followedControllerIds, settings, log } = ctx
  const adjustments: AdjustmentResult[] = []
  // Mutable ref so all handlers see the latest cooler target after adjustments
  const coolerTargetRef = { value: 0 } // initialized after cooler is found

  log('COOLING', 'info', '--- Auto cooling adjustment check ---')

  // Outcome evaluation: learn from past cooling adjustments
  await evaluateCoolingOutcomes(ctx)

  // Find glycol cooler
  const coolerController = allControllers.find(c => (c as any).is_glycol_cooler) as TempController | undefined
  if (!coolerController) {
    log('COOLER_CONFIG', 'fail', 'No controller marked as glycol cooler (set under Enheter)')
    return adjustments
  }

  if (!coolerController.cooling_enabled) {
    log('COOLER_STATUS', 'fail', 'Glycol cooler has cooling disabled')
    return adjustments
  }

  // SAFETY: Check if glycol cooler sensor data is stale
  if (coolerController.last_update) {
    const coolerAgeMs = Date.now() - new Date(coolerController.last_update).getTime()
    const coolerAgeMinutes = Math.round(coolerAgeMs / 60000)
    if (coolerAgeMs > 30 * 60 * 1000) {
      log('COOLER_STALE', 'fail', `Glycol cooler ${coolerController.name}: sensor data is ${coolerAgeMinutes}min old — SKIPPING glycol control for safety`)
      return adjustments
    }
  } else {
    log('COOLER_STALE', 'fail', `Glycol cooler ${coolerController.name}: no sensor data timestamp — SKIPPING for safety`)
    return adjustments
  }

  log('COOLER_STATUS', 'pass', `Cooler: ${coolerController.name}`, {
    target_temp: round1(coolerController.target_temp),
    current_temp: round1(coolerController.current_temp),
  })

  const currentCoolerTarget = parseFloat(String(coolerController.target_temp ?? '18'))
  coolerTargetRef.value = currentCoolerTarget

  // Learn glycol cooler rate
  const coolingLoadCount = followedControllersFullData.filter(c => {
    if (!c.cooling_enabled) return false
    const ct = parseFloat(String(c.current_temp ?? c.pill_temp ?? '0'))
    const tt = parseFloat(String(c.target_temp ?? '999'))
    const hyst = parseFloat(String(c.cooling_hysteresis ?? '0.2'))
    return ct > (tt + hyst)
  }).length

  const glycolRate = await learnGlycolCoolerRate(supabase, coolerController.controller_id, coolingLoadCount)
  const allGlycolRates = await getGlycolRatesSummary(supabase, coolerController.controller_id)

  if (glycolRate || Object.keys(allGlycolRates).length > 0) {
    const rateDetails: Record<string, unknown> = { current_load: coolingLoadCount }
    if (glycolRate) rateDetails.current_rate = `${glycolRate.rate.toFixed(2)}°C/h (n=${glycolRate.sampleCount})`
    for (const [bucket, info] of Object.entries(allGlycolRates)) {
      rateDetails[`rate_${bucket}`] = `${info.rate.toFixed(2)}°C/h (n=${info.sampleCount})`
    }
    log('GLYCOL_RATES', 'info', `Learned cooling rates by load`, rateDetails)
  }

  // Check if any followed controller has cooling enabled
  const controllersWithCooling = followedControllersFullData.filter(c => c.cooling_enabled === true)

  if (controllersWithCooling.length === 0) {
    log('COOLING_CAPABILITY', 'fail', 'No followed controller has cooling enabled')
    await handleNoCooling(ctx, coolerController, coolerTargetRef.value, adjustments, coolerTargetRef)
    return adjustments
  }

  log('COOLING_CAPABILITY', 'pass', `${controllersWithCooling.length} controller(s) have cooling enabled`)

  // Find lowest target controller
  const lowestTempController = controllersWithCooling.reduce((lowest, current) => {
    const ct = parseFloat(String(current.target_temp ?? '999'))
    const lt = parseFloat(String(lowest.target_temp ?? '999'))
    return ct < lt ? current : lowest
  })

  const lowestTargetTemp = parseFloat(String(lowestTempController.target_temp ?? '999'))
  log('LOWEST_CONTROLLER', 'info', `Lowest target with cooling: ${lowestTempController.name}`, {
    target_temp: round1(lowestTargetTemp),
    cooler_target: round1(coolerTargetRef.value),
    diff: round1(coolerTargetRef.value - lowestTargetTemp),
  })

  // Check if cooler is >10° colder than needed
  const tempDiff = coolerTargetRef.value - lowestTargetTemp
  if (tempDiff < -10) {
    await handleOvercooling(ctx, coolerController, coolerTargetRef.value, lowestTempController, lowestTargetTemp, tempDiff, adjustments, coolerTargetRef)
  }

  // Check if lowest controller is actively cooling
  const lowestCurrentTemp = parseFloat(String(lowestTempController.current_temp ?? lowestTempController.pill_temp ?? '0'))
  const lowestHysteresis = parseFloat(String(lowestTempController.cooling_hysteresis ?? '0.2'))
  const isActivelyCooling = lowestCurrentTemp > (lowestTargetTemp + lowestHysteresis)

  log('ACTIVE_COOLING_CHECK', isActivelyCooling ? 'pass' : 'info',
    isActivelyCooling ? `${lowestTempController.name} IS actively cooling` : `${lowestTempController.name} is NOT actively cooling`, {
      current_temp: round1(lowestCurrentTemp),
      threshold: round1(lowestTargetTemp + lowestHysteresis),
    })

  try {
    if (isActivelyCooling) {
      await handleActiveCooling(ctx, coolerController, coolerTargetRef.value, lowestTempController, lowestTargetTemp, lowestCurrentTemp, coolingLoadCount, adjustments, coolerTargetRef)
    } else {
      await (supabase as any).from('auto_cooling_settings').update({ last_check_at: null }).eq('id', settings.id)

      // Learn margin is adequate
      const tempBucketLearn = getTempBucket(lowestTargetTemp)
      const loadBucket = coolingLoadCount >= 2 ? '2plus' : String(coolingLoadCount)
      const currentMargin = Math.abs(coolerTargetRef.value - lowestTargetTemp)
      if (currentMargin > 2.0) {
        const suggestedMargin = currentMargin * 0.95
        const marginParamName = `cooler_margin:${tempBucketLearn}:load_${loadBucket}`
        const marginUpdate = await updateLearnedParam(supabase, coolerController.controller_id, marginParamName, suggestedMargin, 2.0, 12.0)
        const baseUpdate = await updateLearnedParam(supabase, coolerController.controller_id, `cooler_margin:${tempBucketLearn}`, suggestedMargin, 2.0, 12.0)
        log('MARGIN_LEARNING', 'info', `Tank at target → margin adequate [${tempBucketLearn}/load_${loadBucket}]: ${marginUpdate.oldValue.toFixed(1)}→${marginUpdate.newValue.toFixed(1)}°C (base: ${baseUpdate.oldValue.toFixed(1)}→${baseUpdate.newValue.toFixed(1)}°C)`)
      }
      log('TIMER', 'info', 'Reset timer - not actively cooling')
    }
  } catch (coolingError) {
    const errorMsg = coolingError instanceof Error ? coolingError.message : String(coolingError)
    log('COOLING_ERROR', 'fail', `Active cooling handler crashed: ${errorMsg}`)
  }

  // Track adjustments count before proactive cooling
  const adjustmentsBeforeProactive = adjustments.length

  // Always: proactive pre-cooling check (look-ahead at fermentation profiles)
  try {
    await handleProactiveCooling(ctx, coolerController, coolerTargetRef.value, coolingLoadCount, adjustments, coolerTargetRef)
  } catch (proactiveError) {
    const errorMsg = proactiveError instanceof Error ? proactiveError.message : String(proactiveError)
    log('PROACTIVE_ERROR', 'fail', `Proactive cooling handler crashed: ${errorMsg}`)
  }

  // Recovery check — skip if ANY earlier handler already adjusted this cycle
  const anyPriorAdjustment = adjustments.length > 0
  if (anyPriorAdjustment) {
    log('COOLING_RECOVERY', 'info', `Skipping recovery — glycol already adjusted this cycle (${adjustments.length} adjustment(s))`)
  } else {
    try {
      await handleRecovery(ctx, coolerController, coolerTargetRef.value, lowestTempController, lowestTargetTemp, lowestCurrentTemp, coolingLoadCount, adjustments, coolerTargetRef)
    } catch (recoveryError) {
      const errorMsg = recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
      log('RECOVERY_ERROR', 'fail', `Recovery handler crashed: ${errorMsg}`)
    }
  }

  return adjustments
}

// ─── Private helpers ──────────────────────────────────────────

async function evaluateCoolingOutcomes(ctx: GlycolContext): Promise<void> {
  const { supabase, followedControllersFullData, log } = ctx
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

  const { data: pastAdjustments } = await supabase
    .from('auto_cooling_adjustments')
    .select('id, cooler_controller_id, new_target_temp, followed_controller_id, followed_current_temp, followed_target_temp, reason')
    .like('reason', '%struggling to cool%')
    .lt('created_at', thirtyMinAgo)
    .gt('created_at', twoHoursAgo)

  if (!pastAdjustments || pastAdjustments.length === 0) return

  for (const adj of pastAdjustments) {
    if (!adj.followed_controller_id || !adj.followed_target_temp) continue
    const fc = followedControllersFullData.find(c => c.controller_id === adj.followed_controller_id)
    if (!fc) continue

    const currentTemp = parseFloat(String(fc.current_temp ?? fc.pill_temp ?? 999))
    const targetTemp = parseFloat(String(fc.target_temp ?? adj.followed_target_temp))
    const tempBucket = getTempBucket(targetTemp)
    const hysteresis = parseFloat(String(fc.cooling_hysteresis ?? 0.2))

    const reachedTarget = currentTemp <= targetTemp + hysteresis
    const overshot = currentTemp < targetTemp - 1.0

    if (reachedTarget && !overshot) {
      const currentMargin = targetTemp - adj.new_target_temp
      const result = await updateLearnedParam(supabase, adj.cooler_controller_id, `cooler_margin:${tempBucket}`, currentMargin, 2.0, 15.0)
      log('COOLING_LEARN', 'pass', `[${tempBucket}] Margin adequate: ${result.oldValue.toFixed(1)}→${result.newValue.toFixed(1)}°C (n=${result.sampleCount})`)
    } else if (overshot) {
      const currentMargin = targetTemp - adj.new_target_temp
      const reducedMargin = currentMargin * 0.75
      const result = await updateLearnedParam(supabase, adj.cooler_controller_id, `cooler_margin:${tempBucket}`, reducedMargin, 2.0, 15.0)
      log('COOLING_LEARN', 'action', `[${tempBucket}] Overshoot! Reducing margin: ${result.oldValue.toFixed(1)}→${result.newValue.toFixed(1)}°C (n=${result.sampleCount})`)
    } else {
      const currentMargin = targetTemp - adj.new_target_temp
      const increasedMargin = currentMargin * 1.25
      const result = await updateLearnedParam(supabase, adj.cooler_controller_id, `cooler_margin:${tempBucket}`, increasedMargin, 2.0, 15.0)
      log('COOLING_LEARN', 'action', `[${tempBucket}] Insufficient cooling! Increasing margin: ${result.oldValue.toFixed(1)}→${result.newValue.toFixed(1)}°C (n=${result.sampleCount})`)
    }
  }
}

async function handleNoCooling(ctx: GlycolContext, coolerController: TempController, currentCoolerTarget: number, adjustments: AdjustmentResult[], coolerTargetRef: { value: number }): Promise<void> {
  const { supabase, supabaseUrl, serviceRoleKey, log } = ctx
  const defaultTemp = 18
  if (Math.abs(currentCoolerTarget - defaultTemp) <= 0.1) return

  const coolerMinTemp = parseFloat(String(coolerController.min_target_temp ?? '-5'))
  const coolerMaxTemp = parseFloat(String(coolerController.max_target_temp ?? '25'))
  if (defaultTemp < coolerMinTemp || defaultTemp > coolerMaxTemp) return

  log('ADJUSTMENT', 'action', `Setting cooler to default ${defaultTemp}°C`)
  const success = await setControllerTargetTemp(supabaseUrl, serviceRoleKey, coolerController.controller_id, defaultTemp)
  if (success) {
    log('ADJUSTMENT', 'pass', `Set cooler to ${defaultTemp}°C`)
    await logAdjustment(supabase, {
      cooler_controller_id: coolerController.controller_id,
      cooler_controller_name: coolerController.name,
      old_target_temp: currentCoolerTarget,
      new_target_temp: defaultTemp,
      lowest_followed_temp: 0,
      reason: 'Ingen följd controller är aktiv med kyla',
    })
    adjustments.push({ cooler: coolerController.name, oldTarget: currentCoolerTarget, newTarget: defaultTemp })
    coolerTargetRef.value = defaultTemp
  }
}

async function handleOvercooling(ctx: GlycolContext, coolerController: TempController, currentCoolerTarget: number, lowestTempController: TempController, lowestTargetTemp: number, tempDiff: number, adjustments: AdjustmentResult[], coolerTargetRef: { value: number }): Promise<void> {
  const { supabase, supabaseUrl, serviceRoleKey, log } = ctx
  log('OVERCOOLING_CHECK', 'info', `Cooler is ${Math.abs(tempDiff).toFixed(1)}°C colder than lowest`)

  const newTarget = lowestTargetTemp - 10
  const coolerMinTemp = parseFloat(String(coolerController.min_target_temp ?? '-5'))
  const coolerMaxTemp = parseFloat(String(coolerController.max_target_temp ?? '25'))

  if (newTarget <= currentCoolerTarget || newTarget < coolerMinTemp || newTarget > coolerMaxTemp) return

  log('ADJUSTMENT', 'action', `Increasing cooler from ${currentCoolerTarget}°C to ${newTarget}°C`)
  const success = await setControllerTargetTemp(supabaseUrl, serviceRoleKey, coolerController.controller_id, newTarget)
  if (success) {
    log('ADJUSTMENT', 'pass', `Increased cooler to ${newTarget}°C`)
    await logAdjustment(supabase, {
      cooler_controller_id: coolerController.controller_id,
      cooler_controller_name: coolerController.name,
      old_target_temp: currentCoolerTarget,
      new_target_temp: newTarget,
      lowest_followed_temp: lowestTargetTemp,
      followed_controller_id: lowestTempController.controller_id,
      followed_controller_name: lowestTempController.name,
      followed_current_temp: parseFloat(String(lowestTempController.current_temp ?? lowestTempController.pill_temp ?? '0')),
      followed_target_temp: lowestTargetTemp,
      followed_hysteresis: parseFloat(String(lowestTempController.cooling_hysteresis ?? '0.2')),
      reason: `Cooler was ${Math.abs(tempDiff).toFixed(1)}°C colder than needed`,
    })
    adjustments.push({ cooler: coolerController.name, oldTarget: currentCoolerTarget, newTarget })
    coolerTargetRef.value = newTarget
  }
}

async function handleActiveCooling(
  ctx: GlycolContext,
  coolerController: TempController,
  currentCoolerTarget: number,
  lowestTempController: TempController,
  lowestTargetTemp: number,
  lowestCurrentTemp: number,
  coolingLoadCount: number,
  adjustments: AdjustmentResult[],
  coolerTargetRef: { value: number }
): Promise<void> {
  const { supabase, supabaseUrl, serviceRoleKey, followedControllersFullData, followedControllerIds, settings, log } = ctx

  // Interval check
  const now = new Date()
  const checkIntervalMs = 30 * 60 * 1000
  let intervalPassed = true
  if (settings.last_check_at) {
    const timeSinceLastCheck = now.getTime() - new Date(settings.last_check_at).getTime()
    if (timeSinceLastCheck < checkIntervalMs) {
      log('INTERVAL_CHECK', 'fail', `Must wait ${Math.ceil((checkIntervalMs - timeSinceLastCheck) / 60000)} more minutes`)
      intervalPassed = false
    }
  }

  if (!intervalPassed) return

  // Sustained cooling check (2 of last 3 samples > threshold)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { data: recentHistory } = await supabase
    .from('temp_controller_history')
    .select('recorded_at, current_temp, target_temp, cooling_enabled')
    .eq('controller_id', lowestTempController.controller_id)
    .gte('recorded_at', oneHourAgo)
    .order('recorded_at', { ascending: false })
    .limit(3)

  if (!recentHistory || recentHistory.length < 2) {
    log('SUSTAINED_CHECK', 'fail', 'Not enough history data')
    return
  }

  const hysteresis = parseFloat(String(lowestTempController.cooling_hysteresis ?? '0.2'))
  const aboveThresholdCount = recentHistory.filter(h => {
    const ct = parseFloat(String(h.current_temp))
    const tt = parseFloat(String(h.target_temp))
    return ct > tt + hysteresis
  }).length

  if (aboveThresholdCount < 2) {
    log('SUSTAINED_CHECK', 'fail', `Only ${aboveThresholdCount}/3 samples above threshold`)
    await (supabase as any).from('auto_cooling_settings').update({ last_check_at: new Date().toISOString() }).eq('id', settings.id)
    return
  }

  log('SUSTAINED_CHECK', 'pass', `${aboveThresholdCount}/3 samples above threshold — sustained cooling need`)

  // Smart glycol performance check
  let skipReduction = false
  const glycolRate = await learnGlycolCoolerRate(supabase, coolerController.controller_id, coolingLoadCount)
  if (glycolRate && glycolRate.sampleCount >= 3) {
    const expectedRate = glycolRate.rate
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const { data: coolerHistory } = await supabase
      .from('temp_controller_history')
      .select('recorded_at, current_temp')
      .eq('controller_id', coolerController.controller_id)
      .gte('recorded_at', thirtyMinAgo)
      .order('recorded_at', { ascending: false })
      .limit(3)

    if (coolerHistory && coolerHistory.length >= 2) {
      const newest = coolerHistory[0]
      const oldest = coolerHistory[coolerHistory.length - 1]
      const hours = (new Date(newest.recorded_at).getTime() - new Date(oldest.recorded_at).getTime()) / (1000 * 60 * 60)
      if (hours > 0.08) {
        const tempChange = parseFloat(String(newest.current_temp)) - parseFloat(String(oldest.current_temp))
        const actualRate = Math.abs(tempChange) / hours
        const isCoolingDown = tempChange < 0
        const performanceRatio = expectedRate > 0 ? actualRate / expectedRate : 0

        log('GLYCOL_PERFORMANCE', 'info', `Cooler performance check`, {
          actual_rate: `${(isCoolingDown ? '-' : '+')}${actualRate.toFixed(2)}°C/h`,
          expected_rate: `${expectedRate.toFixed(2)}°C/h`,
          performance: `${(performanceRatio * 100).toFixed(0)}%`,
          load: coolingLoadCount,
        })

        if (isCoolingDown && performanceRatio >= 0.6) {
          const coolerTemp = parseFloat(String(coolerController.current_temp ?? '0'))
          const etaHours = actualRate > 0.1 ? Math.abs(lowestCurrentTemp - lowestTargetTemp) / (actualRate * 0.3) : 99
          const etaMinutes = Math.round(etaHours * 60)

          log('GLYCOL_PERFORMANCE', 'pass', `Cooler performing at ${(performanceRatio * 100).toFixed(0)}% of expected — tank needs ~${etaMinutes}min more, skipping reduction`, {
            cooler_temp: `${coolerTemp.toFixed(1)}°C`,
            tank_temp: `${lowestCurrentTemp.toFixed(1)}°C → ${lowestTargetTemp.toFixed(1)}°C`,
            eta_minutes: etaMinutes,
          })
          skipReduction = true
        } else if (!isCoolingDown) {
          log('GLYCOL_PERFORMANCE', 'fail', `Cooler temp is RISING (${tempChange.toFixed(2)}°C) despite cooling demand — needs lower target`)
        } else {
          log('GLYCOL_PERFORMANCE', 'info', `Cooler underperforming (${(performanceRatio * 100).toFixed(0)}% of expected) — proceeding with reduction`)
        }
      }
    }
  }

  if (skipReduction) {
    await (supabase as any).from('auto_cooling_settings').update({ last_check_at: new Date().toISOString() }).eq('id', settings.id)

    // Learn bigger margin
    const tempBucketLearn = getTempBucket(lowestTargetTemp)
    const loadBucket = coolingLoadCount >= 2 ? '2plus' : String(coolingLoadCount)
    const marginParamName = `cooler_margin:${tempBucketLearn}:load_${loadBucket}`
    const currentMargin = Math.abs(currentCoolerTarget - lowestTargetTemp)
    const suggestedMargin = currentMargin * 1.2
    const marginUpdate = await updateLearnedParam(supabase, coolerController.controller_id, marginParamName, suggestedMargin, 2.0, 12.0)
    log('MARGIN_LEARNING', 'action', `Tank slow despite good glycol → learning bigger margin [${tempBucketLearn}/load_${loadBucket}]: ${marginUpdate.oldValue.toFixed(1)}°C → ${marginUpdate.newValue.toFixed(1)}°C (n=${marginUpdate.sampleCount})`, {
      current_margin: `${currentMargin.toFixed(1)}°C`,
      suggested: `${suggestedMargin.toFixed(1)}°C`,
    })

    const baseMarginUpdate = await updateLearnedParam(supabase, coolerController.controller_id, `cooler_margin:${tempBucketLearn}`, suggestedMargin, 2.0, 12.0)
    log('MARGIN_LEARNING', 'info', `Base margin [${tempBucketLearn}]: ${baseMarginUpdate.oldValue.toFixed(1)}°C → ${baseMarginUpdate.newValue.toFixed(1)}°C`)

    log('DECISION', 'info', `${lowestTempController.name} is cooling — glycol performing normally, keeping current target (learned bigger margin for next time)`)
    return
  }

  // Proceed with reduction
  log('DECISION', 'action', `${lowestTempController.name} has been struggling to cool`, {
    current_temp: lowestCurrentTemp,
    target_temp: lowestTargetTemp,
  })

  await (supabase as any).from('auto_cooling_settings').update({ last_check_at: new Date().toISOString() }).eq('id', settings.id)

  // Delta analysis
  let deltaMultiplier = 1.0
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: allDeltaHistory } = await supabase
    .from('temp_delta_history')
    .select('controller_id, delta, recorded_at')
    .in('controller_id', followedControllerIds)
    .gte('recorded_at', twentyFourHoursAgo)
    .order('recorded_at', { ascending: false })

  const batchDeltaMap = new Map<string, Array<{ delta: number; recorded_at: string }>>()
  if (allDeltaHistory) {
    for (const d of allDeltaHistory) {
      const list = batchDeltaMap.get(d.controller_id) || []
      if (list.length < 5) list.push(d)
      batchDeltaMap.set(d.controller_id, list)
    }
  }

  for (const fc of followedControllersFullData) {
    if (fc.pill_temp === null || fc.pill_temp === undefined || fc.current_temp === null || fc.current_temp === undefined) continue

    const pillTemp = parseFloat(String(fc.pill_temp))
    const ctrlTemp = parseFloat(String(fc.current_temp))
    const currentDelta = pillTemp - ctrlTemp

    log('DELTA_ANALYSIS', 'info', `${fc.name}: pill=${pillTemp.toFixed(1)}° ctrl=${ctrlTemp.toFixed(1)}° delta=${currentDelta >= 0 ? '+' : ''}${currentDelta.toFixed(1)}°`)

    const deltaHistory = batchDeltaMap.get(fc.controller_id)
    if (deltaHistory && deltaHistory.length >= 2) {
      const recentDeltas = deltaHistory.map(d => parseFloat(String(d.delta)))
      const avgRecentDelta = recentDeltas.slice(0, 2).reduce((a, b) => a + b, 0) / 2
      const avgOlderDelta = recentDeltas.slice(2).reduce((a, b) => a + b, 0) / Math.max(recentDeltas.length - 2, 1)
      if (avgRecentDelta > avgOlderDelta + 0.1) {
        deltaMultiplier = Math.max(deltaMultiplier, 1.5)
        log('DELTA_TREND', 'action', `Delta RISING for ${fc.name} (${avgOlderDelta.toFixed(1)}° → ${avgRecentDelta.toFixed(1)}°)`)
      }
    }

    if (currentDelta > 1.5) {
      deltaMultiplier = Math.max(deltaMultiplier, 2.0)
      log('DELTA_HIGH', 'action', `High delta (${currentDelta.toFixed(1)}°) for ${fc.name} — doubling reduction`)
    }
  }

  // Context-aware margin
  const tempBucket = getTempBucket(lowestTargetTemp)
  const learnedMargin = await getLearnedParam(supabase, coolerController.controller_id, `cooler_margin:${tempBucket}`, 5.0)
  const baseTempReduction = learnedMargin.value
  log('LEARNED_MARGIN', 'info', `Cooler margin [${tempBucket}]: ${baseTempReduction.toFixed(1)}°C (${learnedMargin.sampleCount} samples)`)
  const effectiveTempReduction = baseTempReduction * deltaMultiplier

  if (deltaMultiplier > 1.0) {
    log('DELTA_ADJUSTMENT', 'action', `Delta multiplier: ${deltaMultiplier}x (${baseTempReduction}°C → ${effectiveTempReduction.toFixed(1)}°C reduction)`)
  }

  const proposedNewTarget = currentCoolerTarget - effectiveTempReduction
  const maxAllowedTarget = lowestTargetTemp - 10.0
  let finalTarget = proposedNewTarget < maxAllowedTarget ? maxAllowedTarget : proposedNewTarget

  if (finalTarget < maxAllowedTarget) {
    log('TARGET_CALCULATION', 'info', `Limited by max_diff_from_lowest to ${finalTarget.toFixed(1)}°C`)
  }

  if (finalTarget >= currentCoolerTarget) {
    log('ADJUSTMENT', 'info', 'Cooler target would not be lowered')
    return
  }

  // Rate-limit: 5 min
  const COOLER_MIN_INTERVAL_MS = 5 * 60 * 1000
  const { data: lastAdjust } = await supabase
    .from('auto_cooling_adjustments')
    .select('created_at')
    .eq('cooler_controller_id', coolerController.controller_id)
    .order('created_at', { ascending: false }).limit(1)
  const lastAdjustTime = lastAdjust?.[0]?.created_at ? new Date(lastAdjust[0].created_at).getTime() : 0
  const timeSinceLastAdjust = Date.now() - lastAdjustTime

  if (timeSinceLastAdjust < COOLER_MIN_INTERVAL_MS) {
    log('ADJUSTMENT', 'info', `Skipping - only ${Math.round(timeSinceLastAdjust / 60000)}min since last adjust (need 5min)`)
    return
  }

  const coolerMinTemp = parseFloat(String(coolerController.min_target_temp ?? '-5'))
  const coolerMaxTemp = parseFloat(String(coolerController.max_target_temp ?? '25'))

  if (finalTarget < coolerMinTemp) {
    log('ADJUSTMENT', 'fail', `Cannot set cooler below minimum (${coolerMinTemp}°C)`)
    return
  }
  if (finalTarget > coolerMaxTemp) {
    log('ADJUSTMENT', 'fail', `Cannot set cooler above maximum (${coolerMaxTemp}°C)`)
    return
  }

  log('ADJUSTMENT', 'action', `Lowering cooler from ${currentCoolerTarget}°C to ${finalTarget}°C`)
  const success = await setControllerTargetTemp(supabaseUrl, serviceRoleKey, coolerController.controller_id, finalTarget)

  if (success) {
    log('ADJUSTMENT', 'pass', `Updated cooler to ${finalTarget}°C`)
    adjustments.push({ cooler: coolerController.name, oldTarget: currentCoolerTarget, newTarget: finalTarget })
    coolerTargetRef.value = finalTarget

    const lowestFollowedTemp = followedControllersFullData
      .map(c => parseFloat(String(c.current_temp ?? c.pill_temp ?? '999')))
      .reduce((min, temp) => Math.min(min, temp), 999)

    await logAdjustment(supabase, {
      cooler_controller_id: coolerController.controller_id,
      cooler_controller_name: coolerController.name,
      old_target_temp: currentCoolerTarget,
      new_target_temp: finalTarget,
      lowest_followed_temp: lowestFollowedTemp,
      followed_controller_id: lowestTempController.controller_id,
      followed_controller_name: lowestTempController.name,
      followed_current_temp: parseFloat(String(lowestTempController.current_temp ?? lowestTempController.pill_temp ?? '0')),
      followed_target_temp: parseFloat(String(lowestTempController.target_temp ?? '0')),
      followed_hysteresis: parseFloat(String(lowestTempController.cooling_hysteresis ?? '0.2')),
      reason: `${lowestTempController.name} struggling to cool`,
    })
  } else {
    log('ADJUSTMENT', 'fail', 'Failed to update cooler controller')
  }
}

async function handleRecovery(
  ctx: GlycolContext,
  coolerController: TempController,
  currentCoolerTarget: number,
  lowestTempController: TempController,
  lowestTargetTemp: number,
  lowestCurrentTemp: number,
  coolingLoadCount: number,
  adjustments: AdjustmentResult[],
  coolerTargetRef: { value: number }
): Promise<void> {
  const { supabase, supabaseUrl, serviceRoleKey, log } = ctx

  const tempBucketRecovery = getTempBucket(lowestTargetTemp)
  const loadBucketRecovery = coolingLoadCount >= 2 ? '2plus' : String(coolingLoadCount)
  const loadSpecificMargin = await getLearnedParam(supabase, coolerController.controller_id, `cooler_margin:${tempBucketRecovery}:load_${loadBucketRecovery}`, 0)
  const baseMargin = await getLearnedParam(supabase, coolerController.controller_id, `cooler_margin:${tempBucketRecovery}`, 5.0)
  const recoveryMarginValue = loadSpecificMargin.sampleCount >= 3 ? loadSpecificMargin.value : baseMargin.value
  const idealTarget = lowestTargetTemp - recoveryMarginValue
  log('RECOVERY_MARGIN', 'info', `Using margin: ${recoveryMarginValue.toFixed(1)}°C (load_${loadBucketRecovery}: ${loadSpecificMargin.value.toFixed(1)}°C n=${loadSpecificMargin.sampleCount}, base: ${baseMargin.value.toFixed(1)}°C n=${baseMargin.sampleCount})`)

  const coolerMinTemp = parseFloat(String(coolerController.min_target_temp ?? '-5'))
  const coolerMaxTemp = parseFloat(String(coolerController.max_target_temp ?? '25'))

  const needsLowering = currentCoolerTarget > idealTarget + 0.2
  const needsRaising = currentCoolerTarget < idealTarget - 0.2

  log('COOLING_RECOVERY_CHECK', 'info', `Glykolkylare`, {
    cooler_current: `${currentCoolerTarget}°C`,
    ideal_target: `${idealTarget.toFixed(1)}°C`,
    needs_lowering: needsLowering,
    needs_raising: needsRaising,
  })

  if (!needsLowering && !needsRaising) return

  try {
    const RECOVERY_INTERVAL_MS = 30 * 60 * 1000
    const { data: lastRecovery, error: recoveryQueryError } = await supabase
      .from('auto_cooling_adjustments')
      .select('created_at')
      .eq('cooler_controller_id', coolerController.controller_id)
      .like('reason', '%Cooling recovery%')
      .order('created_at', { ascending: false }).limit(1)

    if (recoveryQueryError) {
      log('COOLING_RECOVERY', 'fail', `Query error: ${recoveryQueryError.message}`)
      return
    }

    const lastRecoveryTime = lastRecovery?.[0]?.created_at ? new Date(lastRecovery[0].created_at).getTime() : 0
    const timeSinceLastRecovery = Date.now() - lastRecoveryTime

    log('COOLING_RECOVERY_INTERVAL', 'info', `Last recovery: ${lastRecoveryTime === 0 ? 'never' : `${Math.round(timeSinceLastRecovery / 60000)}min ago`}, need ${RECOVERY_INTERVAL_MS / 60000}min`)

    if (timeSinceLastRecovery < RECOVERY_INTERVAL_MS) {
      log('COOLING_RECOVERY', 'info', `Skipping recovery - only ${Math.round(timeSinceLastRecovery / 60000)}min since last (need ${RECOVERY_INTERVAL_MS / 60000}min)`)
      return
    }

    let recoveryTarget = Math.round(idealTarget * 10) / 10
    recoveryTarget = Math.max(coolerMinTemp, Math.min(coolerMaxTemp, recoveryTarget))

    const significantChange = needsLowering
      ? recoveryTarget <= currentCoolerTarget - 0.1
      : recoveryTarget >= currentCoolerTarget + 0.1

    if (!significantChange) return

    const direction = needsLowering ? 'Sänker' : 'Höjer'
    log('COOLING_RECOVERY', 'action', `${direction} cooler from ${currentCoolerTarget}°C toward ideal ${idealTarget.toFixed(1)}°C → ${recoveryTarget}°C`)

    const success = await setControllerTargetTemp(supabaseUrl, serviceRoleKey, coolerController.controller_id, recoveryTarget)
    if (success) {
      log('COOLING_RECOVERY', 'pass', `Set cooler to ${recoveryTarget}°C`)
      adjustments.push({ cooler: coolerController.name, oldTarget: currentCoolerTarget, newTarget: recoveryTarget })
      coolerTargetRef.value = recoveryTarget

      await logAdjustment(supabase, {
        cooler_controller_id: coolerController.controller_id,
        cooler_controller_name: coolerController.name,
        old_target_temp: currentCoolerTarget,
        new_target_temp: recoveryTarget,
        lowest_followed_temp: lowestTargetTemp,
        followed_controller_id: lowestTempController.controller_id,
        followed_controller_name: lowestTempController.name,
        followed_current_temp: lowestCurrentTemp,
        followed_target_temp: lowestTargetTemp,
        reason: `🔄 Cooling recovery: ${needsLowering ? 'kylbehov ökat' : 'kylbehov minskat'}, ${needsLowering ? 'sänker' : 'höjer'} mot ideal ${idealTarget.toFixed(1)}°C`,
      })
    } else {
      log('COOLING_RECOVERY', 'fail', `Failed to update cooler`)
    }
  } catch (recoveryError) {
    log('COOLING_RECOVERY', 'fail', `Recovery error: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`)
  }
}

// ─── Proactive Pre-Cooling (Forward-Looking) ─────────────────

async function handleProactiveCooling(
  ctx: GlycolContext,
  coolerController: TempController,
  currentCoolerTarget: number,
  coolingLoadCount: number,
  adjustments: AdjustmentResult[],
  coolerTargetRef: { value: number }
): Promise<void> {
  const { supabase, supabaseUrl, serviceRoleKey, followedControllersFullData, log } = ctx

  // 1. Fetch running fermentation sessions on followed controllers
  const followedIds = followedControllersFullData.map(c => c.controller_id)
  if (followedIds.length === 0) return

  const { data: sessions } = await supabase
    .from('fermentation_sessions')
    .select('id, controller_id, profile_id, current_step_index, step_started_at, step_start_temp')
    .eq('status', 'running')
    .in('controller_id', followedIds)

  if (!sessions || sessions.length === 0) return

  // 2. Batch fetch profile steps
  const uniqueProfileIds = [...new Set(sessions.map(s => s.profile_id))]
  const { data: allSteps } = await supabase
    .from('fermentation_profile_steps')
    .select('profile_id, step_order, step_type, target_temp, duration_hours, ramp_type')
    .in('profile_id', uniqueProfileIds)
    .order('step_order', { ascending: true })

  if (!allSteps || allSteps.length === 0) return

  const stepsMap = new Map<string, any[]>()
  for (const step of allSteps) {
    const list = stepsMap.get(step.profile_id) || []
    list.push(step)
    stepsMap.set(step.profile_id, list)
  }

  // 3. Analyze upcoming cooling needs
  const upcomingNeeds: UpcomingCoolingNeed[] = []

  for (const session of sessions) {
    const steps = stepsMap.get(session.profile_id)
    if (!steps || steps.length === 0) continue

    const controller = followedControllersFullData.find(c => c.controller_id === session.controller_id)
    if (!controller) continue

    const currentStepIdx = session.current_step_index
    const currentStep = steps[currentStepIdx]
    if (!currentStep) continue

    // Find effective current target temp
    let currentEffectiveTarget: number | null = null
    for (let i = currentStepIdx; i >= 0; i--) {
      if (steps[i].target_temp != null) {
        currentEffectiveTarget = parseFloat(String(steps[i].target_temp))
        break
      }
    }
    if (currentEffectiveTarget === null) continue

    // Check current step: is it an active ramp going down?
    if (currentStep.step_type === 'ramp' && currentStep.target_temp != null && currentStep.duration_hours > 0) {
      const stepTarget = parseFloat(String(currentStep.target_temp))
      const startTemp = session.step_start_temp != null ? parseFloat(String(session.step_start_temp)) : currentEffectiveTarget
      if (stepTarget < startTemp) {
        const rampRate = Math.abs(stepTarget - startTemp) / currentStep.duration_hours
        const elapsedHours = (Date.now() - new Date(session.step_started_at).getTime()) / (1000 * 60 * 60)
        const remainingHours = Math.max(0, currentStep.duration_hours - elapsedHours)
        if (remainingHours > 0) {
          // Use the INTERPOLATED current ramp position as the target for glycol,
          // not the ramp's final destination. Otherwise glycol pre-cools way too aggressively.
          const progress = Math.min(elapsedHours / currentStep.duration_hours, 1)
          const interpolatedTarget = startTemp + (stepTarget - startTemp) * progress

          // Look ahead: where will the ramp be in ~1 hour? That's what glycol needs to support.
          const lookAheadHours = Math.min(1.0, remainingHours)
          const futureProgress = Math.min((elapsedHours + lookAheadHours) / currentStep.duration_hours, 1)
          const futureTarget = startTemp + (stepTarget - startTemp) * futureProgress

          upcomingNeeds.push({
            controllerId: session.controller_id,
            controllerName: controller.name,
            currentTarget: Math.round(interpolatedTarget * 10) / 10,
            upcomingTarget: Math.round(futureTarget * 10) / 10,
            rampRateNeeded: rampRate,
            hoursUntilNeeded: 0, // already happening
            stepType: 'active_ramp',
          })
        }
      }
    }

    // Check next step: will it require cooling?
    const nextStepIdx = currentStepIdx + 1
    if (nextStepIdx < steps.length) {
      const nextStep = steps[nextStepIdx]
      if (nextStep.target_temp != null) {
        const nextTarget = parseFloat(String(nextStep.target_temp))
        if (nextTarget < currentEffectiveTarget - 0.5) {
          // Next step goes lower — calculate rate needed
          const durationHours = nextStep.duration_hours || 24 // default 24h if no duration
          const rampRate = Math.abs(nextTarget - currentEffectiveTarget) / durationHours

          // Estimate hours until this step starts
          let hoursUntilNeeded = 0
          if (currentStep.duration_hours) {
            const elapsedHours = (Date.now() - new Date(session.step_started_at).getTime()) / (1000 * 60 * 60)
            hoursUntilNeeded = Math.max(0, currentStep.duration_hours - elapsedHours)
          }

          upcomingNeeds.push({
            controllerId: session.controller_id,
            controllerName: controller.name,
            currentTarget: currentEffectiveTarget,
            upcomingTarget: nextTarget,
            rampRateNeeded: rampRate,
            hoursUntilNeeded,
            stepType: nextStep.step_type,
          })
        }
      }
    }
  }

  if (upcomingNeeds.length === 0) {
    log('PROACTIVE_COOLING', 'info', 'No upcoming cooling needs detected in profiles')
    return
  }

  // 4. For each upcoming need, check if glycol can support the rate
  const glycolRate = await learnGlycolCoolerRate(supabase, coolerController.controller_id, coolingLoadCount)
  const learnedGlycolRate = glycolRate?.rate ?? 1.0 // default 1°C/h if unknown
  const glycolSamples = glycolRate?.sampleCount ?? 0

  log('PROACTIVE_COOLING', 'info', `Found ${upcomingNeeds.length} upcoming cooling need(s), glycol rate: ${learnedGlycolRate.toFixed(2)}°C/h (n=${glycolSamples})`)

  // Find the most demanding need (lowest upcoming target)
  let worstNeed: UpcomingCoolingNeed | null = null
  for (const need of upcomingNeeds) {
    log('PROACTIVE_NEED', 'info', `${need.controllerName}: ${need.currentTarget}°C → ${need.upcomingTarget}°C @ ${need.rampRateNeeded.toFixed(2)}°C/h (${need.stepType}, ${need.hoursUntilNeeded > 0 ? `om ${need.hoursUntilNeeded.toFixed(1)}h` : 'pågår nu'})`)

    if (!worstNeed || need.upcomingTarget < worstNeed.upcomingTarget) {
      worstNeed = need
    }
  }

  if (!worstNeed) return

  // 5. Calculate required headroom
  const tempBucket = getTempBucket(worstNeed.upcomingTarget)
  const learnedHeadroom = await getLearnedParam(supabase, coolerController.controller_id, `glycol_headroom:${tempBucket}`, 5.0)

  // Dynamic headroom: scale based on ramp rate vs glycol capacity
  const utilizationRatio = learnedGlycolRate > 0.01 ? worstNeed.rampRateNeeded / learnedGlycolRate : 1.0
  const dynamicHeadroom = learnedHeadroom.value * Math.max(0.8, Math.min(1.5, utilizationRatio))
  const requiredGlycolTarget = worstNeed.upcomingTarget - dynamicHeadroom

  log('PROACTIVE_HEADROOM', 'info', `Headroom calc [${tempBucket}]`, {
    learned_headroom: `${learnedHeadroom.value.toFixed(1)}°C (n=${learnedHeadroom.sampleCount})`,
    utilization: `${(utilizationRatio * 100).toFixed(0)}%`,
    dynamic_headroom: `${dynamicHeadroom.toFixed(1)}°C`,
    required_glycol_target: `${requiredGlycolTarget.toFixed(1)}°C`,
    current_glycol_target: `${currentCoolerTarget.toFixed(1)}°C`,
  })

  // 6. Should we pre-cool?
  const PRE_COOL_HORIZON_HOURS = 2.0
  const isImminent = worstNeed.hoursUntilNeeded <= PRE_COOL_HORIZON_HOURS
  const glycolNotColdEnough = currentCoolerTarget > requiredGlycolTarget + 0.5

  if (!isImminent) {
    log('PROACTIVE_COOLING', 'info', `Next cooling need in ${worstNeed.hoursUntilNeeded.toFixed(1)}h — not yet imminent (horizon: ${PRE_COOL_HORIZON_HOURS}h)`)
    return
  }

  if (!glycolNotColdEnough) {
    log('PROACTIVE_COOLING', 'pass', `Glycol already at ${currentCoolerTarget.toFixed(1)}°C, cold enough for upcoming ${worstNeed.upcomingTarget}°C target`)

    // Learn: headroom was adequate — tighten slightly
    if (learnedHeadroom.sampleCount >= 1) {
      const actualHeadroom = Math.abs(currentCoolerTarget - worstNeed.upcomingTarget)
      await updateLearnedParam(supabase, coolerController.controller_id, `glycol_headroom:${tempBucket}`, actualHeadroom, 3.0, 15.0)
    }
    return
  }

  // 7. Pre-cool!
  const coolerMinTemp = parseFloat(String(coolerController.min_target_temp ?? '-5'))
  const coolerMaxTemp = parseFloat(String(coolerController.max_target_temp ?? '25'))
  let finalTarget = Math.round(Math.max(coolerMinTemp, Math.min(coolerMaxTemp, requiredGlycolTarget)) * 10) / 10

  // Rate-limit: 15 min for proactive adjustments
  const PROACTIVE_INTERVAL_MS = 15 * 60 * 1000
  const { data: lastProactive } = await supabase
    .from('auto_cooling_adjustments')
    .select('created_at')
    .eq('cooler_controller_id', coolerController.controller_id)
    .like('reason', '%Proaktiv%')
    .order('created_at', { ascending: false }).limit(1)

  const lastProactiveTime = lastProactive?.[0]?.created_at ? new Date(lastProactive[0].created_at).getTime() : 0
  if (Date.now() - lastProactiveTime < PROACTIVE_INTERVAL_MS) {
    log('PROACTIVE_COOLING', 'info', `Proactive cooldown active — ${Math.round((PROACTIVE_INTERVAL_MS - (Date.now() - lastProactiveTime)) / 60000)}min left`)
    return
  }

  if (finalTarget >= currentCoolerTarget - 0.2) {
    log('PROACTIVE_COOLING', 'info', `Target change too small (${currentCoolerTarget}°C → ${finalTarget}°C)`)
    return
  }

  log('PROACTIVE_COOLING', 'action', `Pre-cooling glycol: ${currentCoolerTarget}°C → ${finalTarget}°C for upcoming ${worstNeed.controllerName} ramp to ${worstNeed.upcomingTarget}°C`)

  const success = await setControllerTargetTemp(supabaseUrl, serviceRoleKey, coolerController.controller_id, finalTarget)
  if (success) {
    log('PROACTIVE_COOLING', 'pass', `Set glycol to ${finalTarget}°C`)
    adjustments.push({ cooler: coolerController.name, oldTarget: currentCoolerTarget, newTarget: finalTarget })
    coolerTargetRef.value = finalTarget

    await logAdjustment(supabase, {
      cooler_controller_id: coolerController.controller_id,
      cooler_controller_name: coolerController.name,
      old_target_temp: currentCoolerTarget,
      new_target_temp: finalTarget,
      lowest_followed_temp: worstNeed.upcomingTarget,
      followed_controller_id: worstNeed.controllerId,
      followed_controller_name: worstNeed.controllerName,
      followed_current_temp: worstNeed.currentTarget,    // interpolated current ramp position (SSOT)
      followed_target_temp: worstNeed.upcomingTarget,    // interpolated 1h look-ahead (SSOT)
      reason: `🔮 Proaktiv förkylning: ${worstNeed.controllerName} rampar mot ${worstNeed.upcomingTarget}°C (${worstNeed.stepType}, ${worstNeed.hoursUntilNeeded > 0 ? `om ${worstNeed.hoursUntilNeeded.toFixed(1)}h` : 'pågår nu'}), headroom ${dynamicHeadroom.toFixed(1)}°C`,
    })

    // Learn: update headroom
    const appliedHeadroom = Math.abs(finalTarget - worstNeed.upcomingTarget)
    await updateLearnedParam(supabase, coolerController.controller_id, `glycol_headroom:${tempBucket}`, appliedHeadroom, 3.0, 15.0)
    log('HEADROOM_LEARNING', 'info', `Updated headroom [${tempBucket}]: ${appliedHeadroom.toFixed(1)}°C`)
  } else {
    log('PROACTIVE_COOLING', 'fail', 'Failed to update glycol target')
  }
}
