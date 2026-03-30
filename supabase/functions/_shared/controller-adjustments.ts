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

  // Check if mode is enabled on hardware
  const isEnabled = mode === 'cooling' ? fc.cooling_enabled : fc.heating_enabled
  if (!isEnabled) {
    log('DUTY_SKIP', 'info', `${fc.name}: ${mode} not enabled, skipping duty cycle`)
    return
  }

  // 2-cycle model: 10%-resolution over 10-min (2×5-min) window
  const dutyPct = Math.round(dutyRaw * 10) * 10
  const totalBurstMin = dutyPct / 10
  const phase = Math.floor(Date.now() / 300000) % 2
  const currentBurstMin = phase === 0 ? Math.ceil(totalBurstMin / 2) : Math.floor(totalBurstMin / 2)
  const burstSeconds = currentBurstMin * 60

  const raptProbeTemp = fc.current_temp
  const minTemp = parseFloat(String(fc.min_target_temp ?? '-10'))
  const maxTemp = parseFloat(String(fc.max_target_temp ?? '25'))

  // ON target: force relay past 5°C hysteresis
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
    await supabase.from('pending_rapt_retries')
      .delete().eq('controller_id', fc.controller_id).like('reason', '%PWM OFF%')
    // CRITICAL: Keep DB target_temp at onTarget (matching actual hardware state).
    await supabase.from('rapt_temp_controllers')
      .update({ target_temp: onTarget, updated_at: new Date().toISOString() })
      .eq('controller_id', fc.controller_id)
    adjustments.push({ cooler: fc.name, oldTarget: ctrlTarget, newTarget: onTarget })
    ctx.pwmBursts.push({ controller_id: fc.controller_id, controller_name: fc.name, on_target: onTarget, off_target: revertTarget, duty_seconds: 300, duty_pct: 100 })
  } else if (burstSeconds > 0) {
    // 10-90%: burst at extreme, schedule revert to suppress target
    log('DUTY_BURST', 'action', `${fc.name}: ${mode} duty ${dutyPct}% → ${burstSeconds}s burst at ${onTarget}° (revert=${revertTarget}°)`, {
      duty_pct: dutyPct, duty_seconds: burstSeconds, on_target: onTarget, off_target: revertTarget, mode,
    })
    if (ctx.updateBatch) {
      ctx.updateBatch.addHardwareOnly(fc.controller_id, onTarget, revertTarget)
    } else {
      await setControllerTargetTemp(ctx.supabaseUrl, ctx.serviceRoleKey, fc.controller_id, onTarget)
    }
    // CRITICAL: Keep DB target_temp at onTarget (matching actual hardware state).
    await supabase.from('rapt_temp_controllers')
      .update({ target_temp: onTarget, updated_at: new Date().toISOString() })
      .eq('controller_id', fc.controller_id)
    // Align to minute boundary so the 1-min cron picks it up precisely
    const minuteFloor = Math.floor(Date.now() / 60000) * 60000
    const executeAt = new Date(minuteFloor + burstSeconds * 1000).toISOString()
    await supabase.from('pending_rapt_retries')
      .delete().eq('controller_id', fc.controller_id).like('reason', '%PWM OFF%')
    await supabase.from('pending_rapt_retries').insert({
      controller_id: fc.controller_id,
      target_temp: revertTarget,
      reason: `⚡ PWM OFF: hw → ${revertTarget}° (${burstSeconds}s burst, ${dutyPct}% duty, ${mode})`,
      execute_at: executeAt,
    })
    // Reset P-term during burst (probe changes artificially from extreme target)
    await supabase.from('controller_learned_compensation')
      .update({ latest_p_correction: 0, updated_at: new Date().toISOString() })
      .eq('controller_id', fc.controller_id)
      .eq('mode', mode)
    adjustments.push({ cooler: fc.name, oldTarget: ctrlTarget, newTarget: onTarget })
    ctx.pwmBursts.push({ controller_id: fc.controller_id, controller_name: fc.name, on_target: onTarget, off_target: revertTarget, duty_seconds: burstSeconds, duty_pct: dutyPct })
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
      if (ctrlTarget < -4 || ctrlTarget >= 39) {
        log('DUTY_ZERO_REVERT', 'action', `${fc.name}: hw vid ${ctrlTarget}° (PWM-rest) → ${revertTarget}°`)
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

  for (const fc of followedControllersFullData) {
    const isProfileOwned = profileOwnedControllerIds.has(fc.controller_id)

    if (cooloffControllerIds.has(fc.controller_id)) {
      log('PID_SKIP', 'info', `${fc.name}: 30min cooloff active, skipping PID`)
      continue
    }
    if (!fc.heating_enabled && !fc.cooling_enabled) continue

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
    // RAPT reports every 15 min but PID runs every 5 min.
    // Estimate current temp using learned thermal rates when data is stale.
    let interpolatedTemp = actualTemp
    let tempInterpolated = false
    const lastUpdateMs = fc.last_update ? new Date(fc.last_update as string).getTime() : Date.now()
    const staleMinutes = (Date.now() - lastUpdateMs) / 60000

    // Read mode + switch-pressure counter + last probe temp from fermentation_learnings
    const { data: pressureRows } = await supabase.from('fermentation_learnings')
      .select('parameter_name, learned_value, sample_count')
      .eq('controller_id', fc.controller_id)
      .in('parameter_name', ['mode_switch_pressure', 'mode_last_probe', 'pid_current_mode', 'pid_last_duty', 'mode_last_step_index', 'pid_effective_target', 'thermal_rate_heating', 'thermal_rate_cooling'])
    const pressureMap = new Map((pressureRows ?? []).map(r => [r.parameter_name, r.learned_value]))
    const sampleCountMap = new Map((pressureRows ?? []).map(r => [r.parameter_name, r.sample_count]))

    // ── Temperature interpolation using learned thermal rates ──
    if (staleMinutes > 3) {
      const lastModeVal = pressureMap.get('pid_current_mode')
      const lastMode = lastModeVal === 1 ? 'heating' : lastModeVal === 2 ? 'cooling' : null
      if (lastMode) {
        const rateKey = `thermal_rate_${lastMode}`
        const thermalRate = pressureMap.get(rateKey) ?? 0
        const rateSamples = sampleCountMap.get(rateKey) ?? 0
        const lastDuty = pressureMap.get('pid_last_duty') ?? 0

        if (thermalRate > 0 && rateSamples >= 3 && lastDuty > 0) {
          const ratePerMin = thermalRate / 60
          const dutyFraction = Math.min(lastDuty, 100) / 100
          const deltaEst = ratePerMin * staleMinutes * dutyFraction
          const sign = lastMode === 'cooling' ? -1 : 1

          interpolatedTemp = actualTemp + sign * deltaEst
          if (lastMode === 'cooling') interpolatedTemp = Math.max(interpolatedTemp, actualTarget)
          if (lastMode === 'heating') interpolatedTemp = Math.min(interpolatedTemp, actualTarget)
          interpolatedTemp = round1(interpolatedTemp)

          if (Math.abs(interpolatedTemp - actualTemp) >= 0.05) {
            tempInterpolated = true
            log('TEMP_INTERPOLATED', 'info',
              `${fc.name}: sensor ${actualTemp}° (${staleMinutes.toFixed(0)}min gammal) → est ${interpolatedTemp}° (rate ${thermalRate}°/h, duty ${lastDuty}%)`)
          }
        }
      }
    }

    // ── Ramp-rate-limiting: prevents abrupt target changes ──────
    // Gradually moves the effective target at a max rate.
    // Protects against step changes (e.g. 18°→2° cold crash).
    const RAMP_RATE_COOLING = 4.0 // °C/hour max target decrease
    const RAMP_RATE_HEATING = 3.0 // °C/hour max target increase
    const CYCLE_HOURS = 5 / 60    // 5-min cycle

    const lastEffective = pressureMap.get('pid_effective_target')
    let pidEffectiveTarget = actualTarget
    let rampRateLimited = false

    if (lastEffective != null) {
      const delta = actualTarget - lastEffective
      if (delta < -0.1) {
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
    const MODE_SWITCH_CYCLES = 6
    const STALL_MIN_PROGRESS = 0.05

    let suggestedMode: 'heating' | 'cooling' = actualTemp > actualTarget + 0.05 ? 'cooling' : 'heating'

    // During active profile ramp, force mode to match ramp direction
    let rampOverrideApplied = false
    const profileCtx = ctx.profileStatusMap.get(fc.controller_id)
    if (profileCtx?.rampDirection && 
        (profileCtx.currentStepType === 'gradual_ramp' || profileCtx.currentStepType === 'ramp')) {
      const rampMode = profileCtx.rampDirection as 'heating' | 'cooling'
      if (suggestedMode !== rampMode) {
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
    } else if (onWrongSide && distanceToTarget > 0.05) {
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
        log('MODE_DUTY_HOLD', 'info', `${fc.name}: väntar på duty 0% innan lägesbyträkning startar (duty ${lastDutyPct}%)`, {
          from: prevMode, to: suggestedMode, last_duty: lastDutyPct, pressure: switchPressure,
        })
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
    const stepType = isProfileOwned ? (profileStatus?.currentStepType ?? (profileStatus ? 'profile' : 'unknown')) : 'standalone'

    // Calculate cooling utilization for this controller and share with cooler
    let coolingUtil: number | null = null
    let recentUtil: number | null = null
    if (fc.cooling_enabled) {
      const utilResult = await calculateSingleUtilization(supabase, fc, { skipShift: true })
      coolingUtil = utilResult.rolling
      recentUtil = utilResult.recent
      // Share with cooler context to avoid re-querying
      ctx.sharedUtilizations.set(fc.controller_id, utilResult)
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

    // === PID Calculation ===
    const pidResult = await calculateCompensatedTarget(
      supabase, fc.controller_id, pidEffectiveTarget, actualTarget, ctrlTarget,
      fc.name || fc.controller_id, { enabled: true }, pidMode, stepType,
      interpolatedTemp, undefined, coolingUtil, rampContext, false, ctx.skipLearning,
    )

    // Log PID status
    const constraintLabels = pidResult.constraints && pidResult.constraints.length > 0 ? pidResult.constraints : []

    log('PILL_COMP_STATUS', 'info', `Controller: ${fc.name} [${pidMode}]`, {
      pill_temp: round1(fc.pill_temp ?? 0),
      probe_temp: round1(fc.current_temp ?? 0),
      actual_temp: round1(actualTemp),
      interpolated_temp: tempInterpolated ? round1(interpolatedTemp) : undefined,
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

    // Post-PID safety: if PID still has active duty in the current mode,
    // any switch pressure accumulated from stale pid_last_duty data is invalid.
    if (computedDutyPct > 0 && switchPressure > 0) {
      log('MODE_PRESSURE_RESET', 'info', `${fc.name}: duty ${computedDutyPct}% aktiv, nollställer switch pressure ${switchPressure} → 0`)
      switchPressure = 0
      if (!ctx.skipLearning) {
        await supabase.from('fermentation_learnings').upsert({
          controller_id: fc.controller_id,
          parameter_name: 'mode_switch_pressure',
          learned_value: 0,
          sample_count: 0,
          last_updated_at: new Date().toISOString(),
        }, { onConflict: 'controller_id,parameter_name' })
      }
    }
    if (!ctx.skipLearning) {
      await supabase.from('fermentation_learnings').upsert({
        controller_id: fc.controller_id,
        parameter_name: 'pid_last_duty',
        learned_value: computedDutyPct,
        sample_count: 1,
        last_updated_at: new Date().toISOString(),
      }, { onConflict: 'controller_id,parameter_name' })

      // Learn steady-state duty cycle when PID is in deadband (system at equilibrium)
      if (pidResult.dutyCycle != null && pidResult.constraints?.includes('deadband') && pidResult.iCorrection != null) {
        const dutyBucket = getTempBucket(actualTarget)
        await updateLearnedParam(supabase, fc.controller_id, `steady_state_duty:${dutyBucket}`, pidResult.iCorrection, 0, 1.0)
      }
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
