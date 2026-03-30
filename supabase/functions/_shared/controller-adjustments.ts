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
  profileStatusMap: Map<string, { profileTarget: number | null; stepIndex: number; hasCooloff: boolean; activeTarget?: number | null; currentStepType?: string; rampDirection?: 'heating' | 'cooling' | null }>
  lastAdjTimestampMap: Map<string, string>
  pillCompSettings: Awaited<ReturnType<typeof loadPillCompSettings>>
  stallSettings: StallSettings
  log: (step: string, result: 'pass' | 'fail' | 'info' | 'action', message: string, details?: Record<string, unknown>) => void
  updateBatch?: RaptUpdateBatch
  pwmBursts: PwmBurst[]
  /** Populated by PID: maps controller_id → actualTarget (profile target).
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

  // PID always runs — dual-sensor is now per controller (dual_sensor_enabled)
  log('PID_CONTROL', 'info', `PID control check (dual sensors: per-controller)`)

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

    // Dual sensor fusion: read pre-computed actual_temp from sync engine,
    // or compute from controller's own dual_sensor_enabled flag
    const dualEnabled = (fc as any).dual_sensor_enabled ?? false
    const preferredSensor: 'pill' | 'probe' = (fc as any).preferred_sensor ?? 'pill'
    const actualTemp = (fc as any).actual_temp != null
      ? parseFloat(String((fc as any).actual_temp))
      : computeDualSensorTarget(actualTarget, fc.current_temp ?? null, fc.pill_temp ?? null, dualEnabled, preferredSensor).actualTemp

    // Read mode + switch-pressure counter + last probe temp from fermentation_learnings
    // NOTE: Previously read from controller_learned_compensation, but that table has
    // SEPARATE rows per mode (upsert key includes 'mode'), so the "latest" row could
    // flip between heating/cooling depending on which was persisted last — causing
    // false mode switches. fermentation_learnings has one row per parameter_name.
    const { data: pressureRows } = await supabase.from('fermentation_learnings')
      .select('parameter_name, learned_value')
      .eq('controller_id', fc.controller_id)
      .in('parameter_name', ['mode_switch_pressure', 'mode_last_probe', 'pid_current_mode', 'pid_last_duty', 'mode_last_step_index', 'pid_effective_target'])
    const pressureMap = new Map((pressureRows ?? []).map(r => [r.parameter_name, r.learned_value]))

    // ── Ramp-rate-limiting: soft D-term alternative ──────────
    // Prevents PID from seeing abrupt target changes (e.g. 18°→2° cold crash)
    // by gradually moving the effective target at a max rate.
    // This turns any step change into a smooth ramp, reducing overshoot.
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
    // pid_current_mode: 1 = heating, 2 = cooling
    const prevMode: 'heating' | 'cooling' | null = prevModeValue === 1 ? 'heating' : prevModeValue === 2 ? 'cooling' : null
    const lastDutyPct = pressureMap.get('pid_last_duty') ?? 0
    const lastStepIndex = pressureMap.get('mode_last_step_index') ?? null

    // Mode detection: overshoot-aware with stabilisation guard.
    const MODE_SWITCH_CYCLES = 6
    const STALL_MIN_PROGRESS = 0.05 // °C per cycle — less than this = stabilized

    // Determine what mode the current temperature suggests
    let suggestedMode: 'heating' | 'cooling' = actualTemp > actualTarget + 0.05 ? 'cooling' : 'heating'

    // During active profile ramp, force mode to match ramp direction
    // Ramp up → only heating allowed, ramp down → only cooling allowed
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

    // Check if probe is on the WRONG side of the target and either:
    // 1. Stabilized (barely moving) — thermal inertia dissipated
    // 2. Diverging (moving further away from target) — active drift
    const distanceToTarget = Math.abs(actualTemp - actualTarget)
    // Mode switching only makes sense when BOTH heating and cooling are available
    const canSwitchMode = fc.heating_enabled && fc.cooling_enabled
    // Single-mode controllers: no mode switching needed, clear pressure
    if (!canSwitchMode && switchPressure > 0) {
      switchPressure = 0
    }
    const onWrongSide = canSwitchMode && prevMode != null && suggestedMode !== prevMode

    // ── Profile context ──────────────────────────────────────
    const profileSwitchStatus = ctx.profileStatusMap.get(fc.controller_id)
    const isProfileRamp = profileSwitchStatus?.currentStepType === 'gradual_ramp' || profileSwitchStatus?.currentStepType === 'ramp'
    const rampMatchesSuggested = profileSwitchStatus?.rampDirection === suggestedMode
    const velocity = lastProbe != null ? Math.abs(actualTemp - lastProbe) : 0

    // Detect profile step change → immediate mode switch
    const currentStepIndex = profileSwitchStatus?.stepIndex ?? null
    const stepChanged = currentStepIndex != null && lastStepIndex != null && currentStepIndex !== lastStepIndex

    // ── Unified mode-switch logic ────────────────────────────
    // All paths share one switchPressure counter and require 6 cycles of
    // stability (velocity < 0.05°/cycle). The only differences:
    //   - Normal: also requires duty === 0% before counter starts
    //   - Profile ramp matching suggested: skips the duty-zero gate
    //   - Profile step change: immediate switch (no waiting)
    //   - Large error (>1°C): immediate switch (emergency)
    const isProfileRampBypass = onWrongSide && isProfileRamp && rampMatchesSuggested && distanceToTarget > 0.3

    let pidMode: 'heating' | 'cooling'
    if (canSwitchMode && prevMode != null && suggestedMode !== prevMode && stepChanged) {
      // Profile step just changed — switch immediately
      pidMode = suggestedMode
      switchPressure = 0
      log('MODE_STEP_SWITCH', 'action', `${fc.name}: ${prevMode} → ${suggestedMode} (profilsteg ändrat ${lastStepIndex} → ${currentStepIndex}, omedelbar)`, {
        from: prevMode, to: suggestedMode, oldStep: lastStepIndex, newStep: currentStepIndex,
        distance: round1(distanceToTarget), actualTemp: round1(actualTemp), actualTarget: round1(actualTarget),
      })
    } else if (onWrongSide && distanceToTarget > 1.0) {
      // Large error — emergency switch regardless of stability
      pidMode = suggestedMode
      switchPressure = 0
      log('MODE_EMERGENCY', 'action', `${fc.name}: ${prevMode} → ${suggestedMode} (Δ${round1(distanceToTarget)}° > 1°, omedelbar)`, {
        from: prevMode, to: suggestedMode, distance: round1(distanceToTarget),
        actualTemp: round1(actualTemp), actualTarget: round1(actualTarget),
      })
    } else if (onWrongSide && distanceToTarget > 0.05) {
      // Wrong side — need to evaluate stability and possibly switch
      const isStable = velocity < STALL_MIN_PROGRESS
      const velocitySigned = lastProbe != null ? actualTemp - lastProbe : 0
      const isDivergingCheck = (suggestedMode === 'cooling' && velocitySigned > 0.02) ||
                               (suggestedMode === 'heating' && velocitySigned < -0.02)
      const isStuckOrDiverging = isStable || isDivergingCheck

      // Duty-zero gate: only for normal (non-profile-ramp) switches
      const needsDutyZero = !isProfileRampBypass
      const dutyBlocked = needsDutyZero && lastDutyPct > 0

      if (!isStuckOrDiverging) {
        // Temp is moving but not diverging — hold, don't count
        pidMode = prevMode!
        if (isProfileRampBypass) {
          log('MODE_PROFILE_HOLD', 'info', `${fc.name}: profil-ramp ${profileSwitchStatus?.rampDirection} men temp ej stabil (velocity=${round1(velocity)}°, Δ${round1(distanceToTarget)}°)`)
        }
      } else if (dutyBlocked) {
        // Duty not yet zero — wait before counting
        pidMode = prevMode!
        log('MODE_DUTY_HOLD', 'info', `${fc.name}: väntar på duty 0% innan lägesbyträkning startar (duty ${lastDutyPct}%)`, {
          from: prevMode, to: suggestedMode, last_duty: lastDutyPct, pressure: switchPressure,
        })
      } else if (isStable) {
        // Stable (velocity < 0.05°) — accumulate counter
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
        // Diverging — also accumulate counter (conditions already met)
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
      // On wrong side but very close (< 0.05°) — hold, start gentle pressure
      pidMode = prevMode ?? suggestedMode
      if (lastDutyPct === 0 && switchPressure === 0) switchPressure = 1
    } else {
      // Back on correct side / near target — decay pressure
      pidMode = prevMode ?? suggestedMode
      if (switchPressure > 0) switchPressure = Math.max(0, switchPressure - 1)
    }

    // Capability guard: never select a mode the hardware cannot execute.
    // This prevents endless DUTY_SKIP loops and ensures heating-only controllers
    // can always drop to duty 0 (heater OFF) when above target.
    if (fc.heating_enabled && !fc.cooling_enabled && pidMode !== 'heating') {
      log('MODE_FORCE', 'info', `${fc.name}: cooling ej tillgängligt, tvingar mode=heating`)
      pidMode = 'heating'
      switchPressure = 0
    } else if (fc.cooling_enabled && !fc.heating_enabled && pidMode !== 'cooling') {
      log('MODE_FORCE', 'info', `${fc.name}: heating ej tillgängligt, tvingar mode=cooling`)
      pidMode = 'cooling'
      switchPressure = 0
    }

    // Persist the switch-pressure counter + last probe temp + current mode
    if (!ctx.skipLearning) {
      await supabase.from('fermentation_learnings').upsert([
        {
          controller_id: fc.controller_id,
          parameter_name: 'mode_switch_pressure',
          learned_value: switchPressure,
          sample_count: switchPressure,
          last_updated_at: new Date().toISOString(),
        },
        {
          controller_id: fc.controller_id,
          parameter_name: 'mode_last_probe',
          learned_value: round1(actualTemp),
          sample_count: 1,
          last_updated_at: new Date().toISOString(),
        },
        {
          controller_id: fc.controller_id,
          parameter_name: 'pid_current_mode',
          learned_value: pidMode === 'heating' ? 1 : 2,
          sample_count: 1,
          last_updated_at: new Date().toISOString(),
        },
        ...(currentStepIndex != null ? [{
          controller_id: fc.controller_id,
          parameter_name: 'mode_last_step_index',
          learned_value: currentStepIndex,
          sample_count: 1,
          last_updated_at: new Date().toISOString(),
        }] : []),
        {
          controller_id: fc.controller_id,
          parameter_name: 'pid_effective_target',
          learned_value: pidEffectiveTarget,
          sample_count: 1,
          last_updated_at: new Date().toISOString(),
        },
      ], { onConflict: 'controller_id,parameter_name' })
    }
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
      supabase, fc.controller_id, pidEffectiveTarget, actualTarget, ctrlTarget,
      fc.name || fc.controller_id, pillCompSettings, pidMode, stepType,
      actualTemp, undefined, coolingUtil, rampContext, false, ctx.skipLearning,
    )

    // Log PID status
    const constraintLabels = pidResult.constraints && pidResult.constraints.length > 0 ? pidResult.constraints : []

    log('PILL_COMP_STATUS', 'info', `Controller: ${fc.name} [${pidMode}]`, {
      pill_temp: round1(fc.pill_temp ?? 0),
      probe_temp: round1(fc.current_temp ?? 0),
      actual_temp: round1(actualTemp),
      dual_sensors: dualEnabled,
      actual_target: round1(actualTarget),
      ctrl_target: round1(ctrlTarget),
      ctrl_target_pid: round1(pidResult.ctrlTargetPid),
      p_correction: round1(pidResult.pCorrection ?? 0),
      i_correction: round1(pidResult.iCorrection ?? 0),
      damping: round1(pidResult.dampingFactor),
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
    // Reset it to prevent false mode switches while the system is actively working.
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
      const revertTarget = round1(pidEffectiveTarget)

      if (dutyPct >= 100) {
        // 100%: hold 0°C entire cycle (no revert needed)
        log('DUTY_FULL', 'action', `${fc.name}: duty 100% → 0°C hela cykeln`, { duty_pct: 100, mode: 'cooling' })
        if (ctx.updateBatch) {
          ctx.updateBatch.addHardwareOnly(fc.controller_id, 0, revertTarget)
        } else {
          await setControllerTargetTemp(ctx.supabaseUrl, ctx.serviceRoleKey, fc.controller_id, 0)
        }
        await supabase.from('pending_rapt_retries')
          .delete().eq('controller_id', fc.controller_id).like('reason', '%PWM OFF%')
        // CRITICAL: Keep DB target_temp at 0 (matching actual hardware state).
        // Same principle as DUTY_BURST — prevents DB/hardware desync if PID
        // drops to 0% duty next cycle: DUTY_ZERO_REVERT checks ctrlTarget < 1.
        await supabase.from('rapt_temp_controllers')
          .update({ target_temp: 0, updated_at: new Date().toISOString() })
          .eq('controller_id', fc.controller_id)
        adjustments.push({ cooler: fc.name, oldTarget: ctrlTarget, newTarget: 0 })
        ctx.pwmBursts.push({ controller_id: fc.controller_id, controller_name: fc.name, on_target: 0, off_target: revertTarget, duty_seconds: 300, duty_pct: 100 })
      } else if (burstSeconds > 0) {
        // 10-90%: burst at 0°C, schedule revert to actualTarget
        log('DUTY_BURST', 'action', `${fc.name}: duty ${dutyPct}% → ${burstSeconds}s burst (revert=${revertTarget}°)`, {
          duty_pct: dutyPct, duty_seconds: burstSeconds, on_target: 0, off_target: revertTarget, mode: 'cooling',
        })
        if (ctx.updateBatch) {
          ctx.updateBatch.addHardwareOnly(fc.controller_id, 0, revertTarget)
        } else {
          await setControllerTargetTemp(ctx.supabaseUrl, ctx.serviceRoleKey, fc.controller_id, 0)
        }
        // CRITICAL: Keep DB target_temp at 0 (matching actual hardware state).
        // Only PWM OFF will update DB to revertTarget after confirming the RAPT
        // command succeeded. This prevents the DB/hardware desync that caused
        // Controller Blå to be stuck at 0°C when PWM OFF failed silently.
        await supabase.from('rapt_temp_controllers')
          .update({ target_temp: 0, updated_at: new Date().toISOString() })
          .eq('controller_id', fc.controller_id)
        // Align to minute boundary so the 1-min cron picks it up precisely
        const minuteFloor = Math.floor(Date.now() / 60000) * 60000
        const executeAt = new Date(minuteFloor + burstSeconds * 1000).toISOString()
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
          .eq('mode', 'cooling')
        adjustments.push({ cooler: fc.name, oldTarget: ctrlTarget, newTarget: 0 })
        ctx.pwmBursts.push({ controller_id: fc.controller_id, controller_name: fc.name, on_target: 0, off_target: revertTarget, duty_seconds: burstSeconds, duty_pct: dutyPct })
      } else {
        // 0% or phase B idle
        if (dutyPct === 0) {
          log('DUTY_ZERO', 'info', `${fc.name}: duty 0% — ingen kylning`)
          // Only revert if hardware is stuck at a PWM extreme (0°C from a burst)
          // Normal target differences (e.g. 15 vs 16) should NOT trigger a send —
          // that causes a sync loop where RAPT reports old value, we correct, repeat.
          const maxTemp = parseFloat(String(fc.max_target_temp ?? '25'))
          if (ctrlTarget < 1 || ctrlTarget >= maxTemp - 0.5) {
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
          log('DUTY_PHASE_B', 'info', `${fc.name}: PWM ${dutyPct}% fas B — ingen burst denna cykel`)
        }
      }
      continue
    }

    // ═══════════════════════════════════════════════════
    // HEATING: Unified PWM duty cycle execution
    // PID output is a duty cycle (0–100%). Hardware is controlled
    // via PWM bursts: maxTemp = heating ON, actualTarget = heating OFF.
    // ═══════════════════════════════════════════════════
    if (pidMode === 'heating' && pidResult.dutyCycle != null) {
      if (!fc.heating_enabled) {
        log('DUTY_SKIP', 'info', `${fc.name}: heating not enabled, skipping duty cycle`)
        continue
      }

      const dutyRaw = pidResult.dutyCycle
      let dutyPct = Math.round(dutyRaw * 10) * 10
      const totalBurstMin = dutyPct / 10
      const phase = Math.floor(Date.now() / 300000) % 2
      const currentBurstMin = phase === 0 ? Math.ceil(totalBurstMin / 2) : Math.floor(totalBurstMin / 2)
      const burstSeconds = currentBurstMin * 60

      // ── Heating Session Cap (hold-only) ──────────────────────
      // Prevents thermal inertia buildup from long continuous low-duty heating.
      // Tracks cumulative active heating minutes; forces a rest period after cap.
      // Bypassed during ramps where continuous heating is needed.
      const HEATING_SESSION_CAP_MIN = 10
      const HEATING_REST_MIN = 30
      let forcedRest = false

      if (!isProfileRamp && dutyPct > 0 && !ctx.skipLearning) {
        const sessionParam = await getLearnedParam(supabase, fc.controller_id, 'heating_session_minutes', 0)
        const restParam = await getLearnedParam(supabase, fc.controller_id, 'heating_rest_until', 0)
        const restUntil = restParam.value // stored as unix timestamp in ms, 0 = no rest
        const nowMs = Date.now()

        if (restUntil > nowMs) {
          // Forced rest is active — clamp duty to 0
          const restRemainMin = Math.round((restUntil - nowMs) / 60000)
          log('HEATING_REST', 'info', `${fc.name}: vilofas aktiv, ${restRemainMin} min kvar`)
          dutyPct = 0
          forcedRest = true
        } else if (sessionParam.value >= HEATING_SESSION_CAP_MIN) {
          // Cap hit → start forced rest period
          const restEnd = nowMs + HEATING_REST_MIN * 60000
          await supabase.from('fermentation_learnings').upsert({
            controller_id: fc.controller_id,
            parameter_name: 'heating_rest_until',
            learned_value: restEnd,
            sample_count: (restParam.sampleCount || 0) + 1,
            last_updated_at: new Date().toISOString(),
          }, { onConflict: 'controller_id,parameter_name' })
          await supabase.from('fermentation_learnings').upsert({
            controller_id: fc.controller_id,
            parameter_name: 'heating_session_minutes',
            learned_value: 0,
            sample_count: 0,
            last_updated_at: new Date().toISOString(),
          }, { onConflict: 'controller_id,parameter_name' })
          log('HEATING_CAP_HIT', 'action', `${fc.name}: ${round1(sessionParam.value)} min heating → ${HEATING_REST_MIN} min vila`)
          dutyPct = 0
          forcedRest = true
        } else {
          // Accumulate: add this burst's active minutes
          const newTotal = sessionParam.value + currentBurstMin
          await supabase.from('fermentation_learnings').upsert({
            controller_id: fc.controller_id,
            parameter_name: 'heating_session_minutes',
            learned_value: newTotal,
            sample_count: (sessionParam.sampleCount || 0) + 1,
            last_updated_at: new Date().toISOString(),
          }, { onConflict: 'controller_id,parameter_name' })
          log('HEATING_SESSION', 'info', `${fc.name}: session ${round1(newTotal)}/${HEATING_SESSION_CAP_MIN} min`)
        }
      }

      // Reset session counter when PID naturally outputs 0% (not during forced rest or ramp)
      if (!isProfileRamp && dutyPct === 0 && !forcedRest && !ctx.skipLearning) {
        const sessionCheck = await getLearnedParam(supabase, fc.controller_id, 'heating_session_minutes', 0)
        if (sessionCheck.value > 0) {
          await supabase.from('fermentation_learnings').upsert({
            controller_id: fc.controller_id,
            parameter_name: 'heating_session_minutes',
            learned_value: 0,
            sample_count: 0,
            last_updated_at: new Date().toISOString(),
          }, { onConflict: 'controller_id,parameter_name' })
          log('HEATING_SESSION_RESET', 'info', `${fc.name}: PID 0% naturligt → session nollställd`)
        }
      }
      const revertTarget = round1(pidEffectiveTarget)
      const maxTemp = parseFloat(String(fc.max_target_temp ?? '25'))
      const onTarget = round1(maxTemp) // heating ON = max temp

      if (dutyPct >= 100) {
        // 100%: hold maxTemp entire cycle
        log('DUTY_FULL', 'action', `${fc.name}: heating duty 100% → ${onTarget}°C hela cykeln`, { duty_pct: 100, mode: 'heating' })
        if (ctx.updateBatch) {
          ctx.updateBatch.addHardwareOnly(fc.controller_id, onTarget, revertTarget)
        } else {
          await setControllerTargetTemp(ctx.supabaseUrl, ctx.serviceRoleKey, fc.controller_id, onTarget)
        }
        await supabase.from('pending_rapt_retries')
          .delete().eq('controller_id', fc.controller_id).like('reason', '%PWM OFF%')
        // CRITICAL: Keep DB target_temp at onTarget (matching actual hardware state).
        // Same principle as DUTY_BURST — prevents DB/hardware desync if PID
        // drops to 0% duty next cycle: DUTY_ZERO_REVERT checks ctrlTarget >= maxTemp - 0.5.
        await supabase.from('rapt_temp_controllers')
          .update({ target_temp: onTarget, updated_at: new Date().toISOString() })
          .eq('controller_id', fc.controller_id)
        adjustments.push({ cooler: fc.name, oldTarget: ctrlTarget, newTarget: onTarget })
        ctx.pwmBursts.push({ controller_id: fc.controller_id, controller_name: fc.name, on_target: onTarget, off_target: revertTarget, duty_seconds: 300, duty_pct: 100 })
      } else if (burstSeconds > 0) {
        // 10-90%: burst at maxTemp, schedule revert to actualTarget
        log('DUTY_BURST', 'action', `${fc.name}: heating duty ${dutyPct}% → ${burstSeconds}s burst at ${onTarget}° (revert=${revertTarget}°)`, {
          duty_pct: dutyPct, duty_seconds: burstSeconds, on_target: onTarget, off_target: revertTarget, mode: 'heating',
        })
        if (ctx.updateBatch) {
          ctx.updateBatch.addHardwareOnly(fc.controller_id, onTarget, revertTarget)
        } else {
          await setControllerTargetTemp(ctx.supabaseUrl, ctx.serviceRoleKey, fc.controller_id, onTarget)
        }
        // CRITICAL: Keep DB target_temp at onTarget (matching actual hardware state).
        // Only PWM OFF will update DB to revertTarget after confirming success.
        await supabase.from('rapt_temp_controllers')
          .update({ target_temp: onTarget, updated_at: new Date().toISOString() })
          .eq('controller_id', fc.controller_id)
        // Align to minute boundary so the 1-min cron picks it up precisely
        const minuteFloor2 = Math.floor(Date.now() / 60000) * 60000
        const executeAt = new Date(minuteFloor2 + burstSeconds * 1000).toISOString()
        await supabase.from('pending_rapt_retries')
          .delete().eq('controller_id', fc.controller_id).like('reason', '%PWM OFF%')
        await supabase.from('pending_rapt_retries').insert({
          controller_id: fc.controller_id,
          target_temp: revertTarget,
          reason: `⚡ PWM OFF: hw → ${revertTarget}° (${burstSeconds}s burst, ${dutyPct}% duty, heating)`,
          execute_at: executeAt,
        })
        await supabase.from('controller_learned_compensation')
          .update({ latest_p_correction: 0, updated_at: new Date().toISOString() })
          .eq('controller_id', fc.controller_id)
          .eq('mode', 'heating')
        adjustments.push({ cooler: fc.name, oldTarget: ctrlTarget, newTarget: onTarget })
        ctx.pwmBursts.push({ controller_id: fc.controller_id, controller_name: fc.name, on_target: onTarget, off_target: revertTarget, duty_seconds: burstSeconds, duty_pct: dutyPct })
      } else {
        // 0% or phase B idle
        if (dutyPct === 0) {
          log('DUTY_ZERO', 'info', `${fc.name}: heating duty 0% — ingen uppvärmning`)

          // Heating suppression: if actual_temp is above target but probe is below target,
          // the hardware's built-in thermostat would heat (probe < hwTarget).
          // Prevent this by lowering the hardware target below the probe temp.
          // Use tighter threshold (0.05°) during ramp override to prevent unwanted heating
          const probeTemp = fc.current_temp ?? actualTemp
          const suppressThreshold = rampOverrideApplied ? 0.05 : 0.3
          if (actualTemp > actualTarget + suppressThreshold && probeTemp < ctrlTarget) {
            const suppressTarget = round1(Math.max(probeTemp - 2, parseFloat(String(fc.min_target_temp ?? '-10'))))
            log('DUTY_ZERO_SUPPRESS', 'action', `${fc.name}: actual ${round1(actualTemp)}° > mål ${round1(actualTarget)}° men probe ${round1(probeTemp)}° < hw ${ctrlTarget}° → sänker hw till ${suppressTarget}° för att stoppa värme`)
            if (ctx.updateBatch) {
              ctx.updateBatch.add(fc.controller_id, suppressTarget, ctrlTarget)
            } else {
              await setControllerTargetTemp(ctx.supabaseUrl, ctx.serviceRoleKey, fc.controller_id, suppressTarget)
            }
            await supabase.from('rapt_temp_controllers')
              .update({ target_temp: suppressTarget, updated_at: new Date().toISOString() })
              .eq('controller_id', fc.controller_id)
            adjustments.push({ cooler: fc.name, oldTarget: ctrlTarget, newTarget: suppressTarget })
          } else if (ctrlTarget < 1 || ctrlTarget >= maxTemp - 0.5) {
            // Only revert if hardware is stuck at a PWM extreme (maxTemp from a heating burst,
            // or 0°C from a previous cooling burst after mode switch)
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
          log('DUTY_PHASE_B', 'info', `${fc.name}: heating PWM ${dutyPct}% fas B — ingen burst denna cykel`)
        }
      }
      continue
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
