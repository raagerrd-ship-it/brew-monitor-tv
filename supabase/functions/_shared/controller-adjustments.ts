import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { round1, TempController, setControllerTargetTemp, calculateCompensatedTarget, RaptUpdateBatch } from './temp-utils.ts'
import { calculateCompensatedTarget as calculateCompensatedTargetClaude } from './pid-compensation-claude.ts'
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
  mode?: 'cooling' | 'heating'
}

export interface ControllerAdjustmentContext {
  supabase: any
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
  /** Circuit-breaker: controllers vars RAPT-writes är pausade pga konsekutiva fel. */
  openCircuitControllerIds?: Set<string>
  /** Glykolkylarens aktuella temperatur (°C). Används av PID för kontinuerlig
   *  ΔT-normalisering av lärda parametrar (feedforward_duty, process_gain)
   *  mot referens ΔT=10°. `null`/`undefined` → ingen ΔT-skalning (fallback). */
  glycolTemp?: number | null
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
  // Note: in-memory target sync happens inside runProcessors after each processor
  const processorAdjs = await runProcessors(ctx)
  adjustments.push(...processorAdjs)

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

  // SAFETY GUARD: Prevent cooling commands on heating-only controllers and vice versa
  const isEnabled = mode === 'cooling' ? fc.cooling_enabled : fc.heating_enabled
  if (!isEnabled) {
    log('DUTY_SKIP', 'info', `${fc.name}: ${mode} not enabled, skipping duty cycle`)
    return
  }
  // Double-check: block extreme targets that contradict the controller's capabilities
  if (mode === 'cooling' && !fc.cooling_enabled) {
    log('MODE_GUARD', 'fail', `🚨 ${fc.name}: attempted cooling burst but cooling_enabled=false — BLOCKED`)
    return
  }
  if (mode === 'heating' && !fc.heating_enabled) {
    log('MODE_GUARD', 'fail', `🚨 ${fc.name}: attempted heating burst but heating_enabled=false — BLOCKED`)
    return
  }

  // Circuit-breaker: blockera nya bursts mot controllers med öppen krets.
  // Skyddar RAPT-quota för övriga controllers tills den döda återhämtar sig.
  if (ctx.openCircuitControllerIds?.has(fc.controller_id)) {
    log('CIRCUIT_OPEN_SKIP', 'fail', `⏸️ ${fc.name}: RAPT-krets öppen (för många konsekutiva fel) — hoppar över PWM-burst denna cykel`, { mode })
    return
  }

  // 2-cycle model with dithering: achieves sub-10% effective duty over time.
  // E.g. dutyRaw=0.23 → alternates between 20% and 30% (30% used 3/10 cycles).
  const dutyLow = Math.floor(dutyRaw * 10) * 10   // e.g. 20
  const dutyHigh = Math.ceil(dutyRaw * 10) * 10    // e.g. 30
  const fraction = dutyRaw * 100 - dutyLow          // e.g. 3.0 (how many tenths toward high)
  // 5-min PWM cycle (matches sync cadence). 10-slot dithering across 50 min.
  // Round-robin (Bresenham) spread: distribute N high-slots evenly across 10
  // instead of front-loading them. E.g. N=4 → slots {2,4,7,9}; N=7 → {1,2,4,5,7,8,9}.
  const SLOT_MS = 300_000
  const currentSlot = Math.floor(Date.now() / SLOT_MS)
  const ditherSlot = currentSlot % 10
  const highSlots = Math.round(fraction) // 0..10
  const isHighSlot = Math.floor(((ditherSlot + 1) * highSlots) / 10) > Math.floor((ditherSlot * highSlots) / 10)
  let dutyPct = isHighSlot ? dutyHigh : dutyLow
  const slotParam = `pwm_last_slot:${mode}`
  let lastSlot = -1
  let subTenMinGapSlots = 0
  if (dutyRaw > 0 && dutyRaw < 0.10 && dutyHigh > 0) {
    const { data: slotRow } = await supabase
      .from('fermentation_learnings')
      .select('learned_value')
      .eq('controller_id', fc.controller_id)
      .eq('parameter_name', slotParam)
      .maybeSingle()
    lastSlot = slotRow ? Math.floor(parseFloat(String(slotRow.learned_value))) : -1
    subTenMinGapSlots = Math.max(1, Math.floor(10 / Math.max(1, highSlots)))
    const slotsSinceBurst = lastSlot >= 0 ? currentSlot - lastSlot : Infinity
    if (dutyPct === 0 && slotsSinceBurst >= subTenMinGapSlots) {
      dutyPct = dutyHigh
    }
  }
  // Single consolidated burst per 5-min cycle (no split phases).
  // burstSeconds = dutyPct% * 300s  →  20%=60s, 40%=120s, 100%=300s.
  const burstSeconds = Math.round((dutyPct / 100) * 300)

  const raptProbeTemp = fc.current_temp
  const minTemp = parseFloat(String(fc.min_target_temp ?? '-10'))
  const maxTemp = parseFloat(String(fc.max_target_temp ?? '25'))

  // ON target: hard-coded extremes to force the relay past hysteresis reliably.
  // Controller min/max bounds vary per fermenter and may not be aggressive enough.
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
    log('DUTY_FULL', 'action', `${fc.name}: ${mode} duty 100% → ${onTarget}°C hela cykeln`, { controller_id: fc.controller_id, controller_name: fc.name, duty_pct: 100, mode })
    if (ctx.updateBatch) {
      ctx.updateBatch.addHardwareOnly(fc.controller_id, onTarget, revertTarget)
    } else {
      await setControllerTargetTemp(ctx.supabaseUrl, ctx.serviceRoleKey, fc.controller_id, onTarget)
    }
    // CRITICAL: Keep DB target_temp at onTarget (matching actual hardware state).
    await Promise.all([
      supabase.from('pending_rapt_retries')
        .delete().eq('controller_id', fc.controller_id).like('reason', '%PWM OFF%'),
      supabase.from('rapt_temp_controllers')
        .update({ target_temp: onTarget, updated_at: new Date().toISOString() })
        .eq('controller_id', fc.controller_id),
    ])
    adjustments.push({ cooler: fc.name, oldTarget: ctrlTarget, newTarget: onTarget })
    ctx.pwmBursts.push({ controller_id: fc.controller_id, controller_name: fc.name, on_target: onTarget, off_target: revertTarget, duty_seconds: 300, duty_pct: 100, mode })
  } else if (burstSeconds > 0) {
    // 10-90%: burst at extreme, schedule revert to suppress target.
    // Slot guard: only fire ONE burst per 5-min slot. Subsequent
    // run-automation runs within the same slot leave the pending
    // PWM OFF row untouched so the cycle completes naturally.
    if (lastSlot < 0) {
      const { data: slotRow } = await supabase
        .from('fermentation_learnings')
        .select('learned_value')
        .eq('controller_id', fc.controller_id)
        .eq('parameter_name', slotParam)
        .maybeSingle()
      lastSlot = slotRow ? Math.floor(parseFloat(String(slotRow.learned_value))) : -1
    }
    if (lastSlot === currentSlot) {
      log('DUTY_BURST_SKIP', 'info', `${fc.name}: ${mode} ${dutyPct}% — burst redan schemalagd för 5-min-slot ${currentSlot}`, { duty_pct: dutyPct, mode, slot: currentSlot })
      return
    }
    if (subTenMinGapSlots > 0 && lastSlot >= 0 && currentSlot - lastSlot < subTenMinGapSlots) {
      log('DUTY_DITHER_IDLE', 'info', `${fc.name}: ${mode} raw=${Math.round(dutyRaw * 100)}% — väntar ${subTenMinGapSlots - (currentSlot - lastSlot)} slot(s) till nästa låg-duty burst`, { duty_raw: Math.round(dutyRaw * 100), mode, slot: currentSlot })
      return
    }
    log('DUTY_BURST', 'action', `${fc.name}: ${mode} duty ${dutyPct}% (raw=${Math.round(dutyRaw * 100)}%, dither=${ditherSlot}/${Math.round(fraction)}) → ${burstSeconds}s burst at ${onTarget}° (revert=${revertTarget}°)`, {
      controller_id: fc.controller_id, controller_name: fc.name,
      duty_pct: dutyPct, duty_raw: Math.round(dutyRaw * 100), dither_slot: ditherSlot, duty_seconds: burstSeconds, on_target: onTarget, off_target: revertTarget, mode,
    })
    if (ctx.updateBatch) {
      ctx.updateBatch.addHardwareOnly(fc.controller_id, onTarget, revertTarget)
    } else {
      await setControllerTargetTemp(ctx.supabaseUrl, ctx.serviceRoleKey, fc.controller_id, onTarget)
    }
    // CRITICAL: Keep DB target_temp at onTarget (matching actual hardware state).
    // Anchor revert at the 5-min slot start so the OFF lands exactly
    // burstSeconds into the slot regardless of when the cron fired.
    const slotStartMs = currentSlot * SLOT_MS
    const executeAt = new Date(slotStartMs + burstSeconds * 1000).toISOString()
    const nowIso = new Date().toISOString()
    await Promise.all([
      supabase.from('rapt_temp_controllers')
        .update({ target_temp: onTarget, updated_at: nowIso })
        .eq('controller_id', fc.controller_id),
      supabase.from('pending_rapt_retries')
        .delete().eq('controller_id', fc.controller_id).like('reason', '%PWM OFF%')
        .then(() => supabase.from('pending_rapt_retries').insert({
          controller_id: fc.controller_id,
          target_temp: revertTarget,
          reason: `⚡ PWM OFF: hw → ${revertTarget}° (${burstSeconds}s burst, ${dutyPct}% duty, ${mode})`,
          execute_at: executeAt,
        })),
      // Reset P-term during burst (probe changes artificially from extreme target)
      supabase.from('controller_learned_compensation')
        .update({ latest_p_correction: 0, updated_at: new Date().toISOString() })
        .eq('controller_id', fc.controller_id)
        .eq('mode', mode),
      // Persist slot marker so we don't re-fire this slot
      supabase.from('fermentation_learnings').upsert(
        { controller_id: fc.controller_id, parameter_name: slotParam, learned_value: currentSlot, sample_count: 1, last_updated_at: nowIso },
        { onConflict: 'controller_id,parameter_name' },
      ),
    ])
    adjustments.push({ cooler: fc.name, oldTarget: ctrlTarget, newTarget: onTarget })
    ctx.pwmBursts.push({ controller_id: fc.controller_id, controller_name: fc.name, on_target: onTarget, off_target: revertTarget, duty_seconds: burstSeconds, duty_pct: dutyPct, mode })
  } else {
    // 0% or phase B idle
    if (dutyPct === 0) {
      log('DUTY_ZERO', 'info', `${fc.name}: ${mode} duty 0% — ingen ${mode === 'cooling' ? 'kylning' : 'uppvärmning'}`, { controller_id: fc.controller_id, controller_name: fc.name, mode })

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
      if (ctrlTarget <= minTemp + 0.1 || ctrlTarget >= maxTemp - 0.1) {
        // SAFETY: Flag if the extreme contradicts the controller's capabilities
        const stuckInCooling = ctrlTarget <= minTemp + 0.1 && !fc.cooling_enabled
        const stuckInHeating = ctrlTarget >= maxTemp - 0.1 && !fc.heating_enabled
        if (stuckInCooling || stuckInHeating) {
          log('MODE_GUARD_REVERT', 'fail', `🚨 ${fc.name}: hw fastnad vid ${ctrlTarget}° (${stuckInCooling ? 'kyla' : 'värme'}-extrem) men ${stuckInCooling ? 'cooling' : 'heating'}_enabled=false — reverterar omedelbart → ${revertTarget}°`)
        } else {
          log('DUTY_ZERO_REVERT', 'action', `${fc.name}: hw vid ${ctrlTarget}° (PWM-rest) → ${revertTarget}°`)
        }
        if (ctx.updateBatch) {
          ctx.updateBatch.add(fc.controller_id, revertTarget, ctrlTarget)
        } else {
          await setControllerTargetTemp(ctx.supabaseUrl, ctx.serviceRoleKey, fc.controller_id, revertTarget)
        }
        await supabase.from('rapt_temp_controllers')
          .update({ target_temp: revertTarget, updated_at: new Date().toISOString() })
          .eq('controller_id', fc.controller_id)
        adjustments.push({ cooler: fc.name, oldTarget: ctrlTarget, newTarget: revertTarget })
      } else {
        // HEARTBEAT REASSERT: every 3rd cycle (~15 min), re-send the intended
        // hw target even if unchanged. Protects against telemetry drift / silent
        // hw-state mismatches where RAPT shows a stale extreme value.
        const heartbeatSlot = Math.floor(Date.now() / 300000) % 3
        if (heartbeatSlot === 0 && Math.abs(ctrlTarget - revertTarget) > 0.05) {
          log('DUTY_ZERO_HEARTBEAT', 'action', `${fc.name}: heartbeat re-assert hw ${ctrlTarget}° → ${revertTarget}° (var 15:e min)`)
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
      }
    } else {
      log('DUTY_PHASE_B', 'info', `${fc.name}: ${mode} PWM ${dutyPct}% fas B — ingen burst denna cykel`, { controller_id: fc.controller_id, controller_name: fc.name, duty_pct: dutyPct, mode })
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

  // ── Pre-filter active controllers ──────────────────────────
  const activeControllers = followedControllersFullData.filter(fc =>
    !cooloffControllerIds.has(fc.controller_id) &&
    (fc.heating_enabled || fc.cooling_enabled)
  )

  if (activeControllers.length === 0) return adjustments

  // ── Parallel pre-fetch: fermentation_learnings + utilization ──
  // Batch-fetch ALL PID state params for all active controllers in ONE query.
  // This replaces N sequential queries (one per controller) with a single query.
  const activeControllerIds = activeControllers.map(fc => fc.controller_id)

  // Collect all possible parameter names (including all temp bucket variants)
  const TEMP_BUCKETS = ['cold', 'cool', 'warm', 'hot']
  const BASE_PARAMS = [
    'mode_switch_pressure', 'mode_last_probe', 'pid_current_mode',
    'pid_last_duty', 'mode_last_step_index', 'pid_effective_target',
    'thermal_rate_heating', 'thermal_rate_cooling',
    'est_prev_actual_temp_at',
    'was_ramp_active',
  ]
  const bucketParams = TEMP_BUCKETS.flatMap(b => [
    `thermal_rate_heating:${b}`, `thermal_rate_cooling:${b}`,
  ])
  const allParamNames = [...BASE_PARAMS, ...bucketParams]

  // Fire all queries in parallel
  const [{ data: allLearnings }, utilResults] = await Promise.all([
    // 1. Single batch query for all fermentation_learnings
    supabase.from('fermentation_learnings')
      .select('controller_id, parameter_name, learned_value, sample_count')
      .in('controller_id', activeControllerIds)
      .in('parameter_name', allParamNames),
    // 2. Parallel utilization pre-fetch for all cooling controllers
    Promise.all(
      activeControllers
        .filter(fc => fc.cooling_enabled)
        .map(async fc => {
          const result = await calculateSingleUtilization(supabase, fc, { skipShift: true })
          return { controllerId: fc.controller_id, result }
        })
    ),
  ])

  // Build per-controller lookup maps
  const learningsByController = new Map<string, Map<string, number>>()
  const samplesByController = new Map<string, Map<string, number>>()
  for (const row of (allLearnings ?? [])) {
    if (!learningsByController.has(row.controller_id)) {
      learningsByController.set(row.controller_id, new Map())
      samplesByController.set(row.controller_id, new Map())
    }
    learningsByController.get(row.controller_id)!.set(row.parameter_name, parseFloat(String(row.learned_value)))
    samplesByController.get(row.controller_id)!.set(row.parameter_name, row.sample_count)
  }

  // Pre-populate shared utilizations
  for (const { controllerId, result } of utilResults) {
    ctx.sharedUtilizations.set(controllerId, result)
  }

  for (const fc of activeControllers) {
    const isProfileOwned = profileOwnedControllerIds.has(fc.controller_id)

    const ctrlTarget = parseFloat(String(fc.target_temp ?? '20'))

    // Actual target from SSOT (already bootstrapped)
    const actualTarget = parseFloat(String((fc as any).profile_target_temp))
    const dualEnabled = !!(fc as any).dual_sensor_enabled
    const preferred = (fc as any).preferred_sensor as string | undefined
    // Probe-only mode: control purely on probe reading toward target, no pill comp.
    const probeCompOffset: number | null = null

    // SSOT: pill (via BLE-ingest) writes actual_temp every minute. No fusion,
    // no interpolation, no probe fallback. If actual_temp is missing the
    // controller is skipped upstream by filterStaleControllers.
    // FALLBACK: if BLE-ingest hasn't written actual_temp yet (race vs auto-adjust
    // at :00), recompute the SSOT on-the-fly from the same inputs BLE-ingest uses.
    // When dual_sensor is enabled, that means avg(pill, probe) — NOT just pill —
    // otherwise PID sees a value 0.5–1°C off from reality and skips needed action
    // (e.g. pill 18.2°, probe 17.1° → real SSOT 17.65°, but pill-only fallback
    // would tell PID it's at 18.2° and brake cooling while the beer is undershooting).
    let actualTemp = parseFloat(String((fc as any).actual_temp))
    if (!Number.isFinite(actualTemp)) {
      const pill = parseFloat(String((fc as any).pill_temp))
      const probe = parseFloat(String((fc as any).current_temp))
      if (dualEnabled && Number.isFinite(pill) && Number.isFinite(probe)) {
        actualTemp = (pill + probe) / 2
        log('ACTUAL_TEMP_FALLBACK', 'info', `${fc.name}: actual_temp saknas — räknar snitt(pill=${round1(pill)}°, probe=${round1(probe)}°) = ${round1(actualTemp)}° för PID`)
      } else if (preferred === 'probe' && Number.isFinite(probe)) {
        actualTemp = probe
        log('ACTUAL_TEMP_FALLBACK', 'info', `${fc.name}: actual_temp saknas — använder probe=${round1(probe)}° för PID`)
      } else if (Number.isFinite(pill)) {
        actualTemp = pill
        log('ACTUAL_TEMP_FALLBACK', 'info', `${fc.name}: actual_temp saknas — använder pill=${round1(pill)}° för PID`)
      } else if (Number.isFinite(probe)) {
        actualTemp = probe
        log('ACTUAL_TEMP_FALLBACK', 'info', `${fc.name}: actual_temp saknas — använder probe=${round1(probe)}° för PID (ingen pill)`)
      }
    }
    const sensorActualTemp = actualTemp
    const raptProbeTemp = fc.current_temp
    if (probeCompOffset != null) {
      actualTemp = actualTemp + probeCompOffset
    }
    const lastUpdateMs = fc.last_update ? new Date(fc.last_update as string).getTime() : Date.now()
    const staleMinutes = (Date.now() - lastUpdateMs) / 60000
    const thermalBucket = getTempBucket(actualTemp)

    // Use pre-fetched learnings (from batch query above)
    const pressureMap = learningsByController.get(fc.controller_id) ?? new Map()
    const sampleCountMap = samplesByController.get(fc.controller_id) ?? new Map()

    const prevActualTempAt = pressureMap.get('est_prev_actual_temp_at')
    const prevDutyPct = pressureMap.get('pid_last_duty') ?? 0
    // PID input is always the real sensor reading — no interpolation.
    const pidInputTemp = actualTemp

    // ── Ramp-rate-limiting: prevents abrupt target changes ──────
    // Gradually moves the effective target at a max rate.
    // Protects against step changes (e.g. 18°→2° cold crash).
    const RAMP_RATE_COOLING = 4.0 // °C/hour max target decrease
    const RAMP_RATE_HEATING = 3.0 // °C/hour max target increase
    const CYCLE_HOURS = 5 / 60    // 5-min cycle
    const BIG_JUMP_BYPASS = 5.0   // °C: skip ramp-limit on large step changes (e.g. cold start, new session)

    const lastEffective = pressureMap.get('pid_effective_target')
    let pidEffectiveTarget = actualTarget
    let rampRateLimited = false

    if (lastEffective != null) {
      const delta = actualTarget - lastEffective
      if (Math.abs(delta) >= BIG_JUMP_BYPASS) {
        // Big jump (e.g. user set 25° from 10°): jump straight to target, no ramp.
        pidEffectiveTarget = actualTarget
      } else if (delta < -0.1) {
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

    // ── Integral wind-up release at ramp completion ──
    // När det virtuella målet slutar röra på sig (rampen klar) har PID byggt upp
    // integral ("ryggsäck") för att driva rampen. Den fortsätter trycka i några
    // cykler och orsakar onödig överskjutning. Detektera flank (was=1 → nu=0)
    // och nollställ accumulated_integral så vi startar på ren P-term vid target.
    const wasRampActive = pressureMap.get('was_ramp_active') === 1
    const rampJustFinished = wasRampActive && !rampRateLimited
    if (rampJustFinished) {
      log('PID_RAMP_DONE', 'action', `${fc.name}: ramp klar (mål ${round1(actualTarget)}°) — nollställer integral för att förhindra wind-up overshoot`)
      // Fire-and-forget; PID-loopen nedan läser accumulated_integral direkt efter.
      await supabase.from('controller_learned_compensation')
        .update({ accumulated_integral: 0, latest_i_correction: 0, updated_at: new Date().toISOString() })
        .eq('controller_id', fc.controller_id)
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
    // BLE-länkade controllers har 1-min färsk data + event-driven PID-trigger,
    // så 2 cykler räcker som brus-skydd. RAPT-only behåller 3 (15 min RAPT-jitter).
    const isBleLinked = !!(fc as any).linked_pill_id
    const MODE_SWITCH_CYCLES = isBleLinked ? 2 : 3
    const STALL_MIN_PROGRESS = 0.05

    // Neutral zone: under hold-steg är termisk massa trög nog att återhämta
    // små över-/undershoots passivt. Symmetriskt under hold (0.6°): PID:s
    // pTerm+ff decay hanterar små överskjutningar utan att bygga mode-switch-
    // tryck. Tidigare asymmetri (HOT=0.00) gav "krypande fel"-flip vid +0.01°.
    //
    // BLE-avvägning: MODE_EMERGENCY använder egen tröskel (0.5° BLE / 0.8°
    // annars) som kräver onWrongSide=true. Med ESCAPE_HOLD=0.60 kan
    // suggestedMode inte flippa förrän >0.60°, så BLE-nödbromsen skjuts från
    // nominella 0.5° till effektivt 0.6° — medveten avvägning mot
    // kort-cykling. BLE kompenserar med MODE_SWITCH_CYCLES=2 (vs 3).
    // isHoldStep var tidigare en whitelist (HOLD_EQUIVALENT_STEP_TYPES) —
    // vi missade 'wait_for_gravity_stable' och sedan standalone (ingen
    // profil alls) i tur och ordning, båda med samma symptom: kortcykling
    // pga smal 0.05°-neutralzon istället för ESCAPE_HOLD. En whitelist är
    // fel riktning här — nästa ofärdiga stegtyp (diacetyl_rest, crash_hold,
    // vad som helst) skulle falla igenom på exakt samma sätt.
    //
    // Inverterat till en blacklist av det enda som FAKTISKT skiljer sig
    // fysikaliskt: ett steg med ett RÖRLIGT mål (ramp/gradual_ramp). Allt
    // annat — hold, wait_for_*, standalone/ingen profil, och varje framtida
    // stegtyp vi inte tänkt på — har ett fast mål och får ESCAPE_HOLD som
    // default. rampOverrideApplied (nedan) kollar currentStepType direkt
    // och är oberoende av isHoldStep, så ramp-hanteringen påverkas inte.
    //
    // Grundorsak bakom kortcyklings-incident 2026-07-09 09:00-09:20 UTC på
    // "En goding" (Custom, ingen profil): switch till cooling vid endast
    // +0.19° överskjutning — exakt 0.05°-bandets signatur.
    const rawStepTypeForHoldCheck = ctx.profileStatusMap.get(fc.controller_id)?.currentStepType
    const isRampStep = rawStepTypeForHoldCheck === 'ramp' || rawStepTypeForHoldCheck === 'gradual_ramp'
    const isHoldStep = !isRampStep
    const ESCAPE_HOLD = 0.60
    const NEUTRAL_BAND_HOT = isHoldStep ? ESCAPE_HOLD : 0.05
    const NEUTRAL_BAND_COLD = isHoldStep ? ESCAPE_HOLD : 0.05
    let suggestedMode: 'heating' | 'cooling'
    if (actualTemp > actualTarget + NEUTRAL_BAND_HOT) {
      suggestedMode = 'cooling'
    } else if (actualTemp < actualTarget - NEUTRAL_BAND_COLD) {
      suggestedMode = 'heating'
    } else {
      // Inom neutralzonen: behåll föregående läge (eller default cooling om okänt)
      suggestedMode = prevMode ?? (actualTemp > actualTarget ? 'cooling' : 'heating')
    }

    // SAFETY FIRST: detect emergency BEFORE inlärda golv-block kan tysta nödbromsen.
    // Om temperaturen sticker iväg >0.8°C på fel sida måste vi få byta läge oavsett
    // tidigare inlärda steady-state floors (annars deadlock: prevMode=heating, beer
    // far över target, FLOOR_BLOCK skriver om suggestedMode→heating, onWrongSide blir
    // false, PID kör 0% och systemet är blint för rusningen).
    const rawDistanceToTarget = Math.abs(actualTemp - actualTarget)
    // Hold-steg har trög termisk massa men 0.8° drift är redan en stor överskjutning.
    // Sänk emergency-tröskeln så MODE_FLOOR_BLOCK inte låser oss i fel läge när
    // temp redan tydligt passerat target (t.ex. 20.43° vid mål 20.0° → blockad
    // i heating med 0% duty och kylan startar aldrig).
    // Emergency-tröskel också asymmetrisk under hold: överskjutning åt det
    // varma hållet är farlig (jäsningsvärme), men en kall undershoot ska få
    // återhämtas passivt innan vi tvingar heating.
    const emergencyThreshold = isHoldStep ? ESCAPE_HOLD : 0.8
    const emergencyOverride =
      prevMode != null &&
      suggestedMode !== prevMode &&
      rawDistanceToTarget > emergencyThreshold &&
      fc.heating_enabled && fc.cooling_enabled

    // MODE_EQUALIZATION_HOLD-guarden borttagen: med symmetrisk 0.6° neutral-
    // zon kan suggestedMode inte flippa till heating förrän undershoot >0.6°,
    // så guardens villkor (undershoot ≤1.0° och suggestedMode=heating från
    // 0.5°-band) blev dödkod. Passiv återhämtning inom 0.6° hanteras nu av
    // själva neutralzonen istället för denna specialguard.

    // During active profile ramp, force mode to match ramp direction
    let rampOverrideApplied = false
    const profileCtx = ctx.profileStatusMap.get(fc.controller_id)
    if (profileCtx?.rampDirection && 
        (profileCtx.currentStepType === 'gradual_ramp' || profileCtx.currentStepType === 'ramp')) {
      const rampMode = profileCtx.rampDirection as 'heating' | 'cooling'
      // Auto-release efter drift-bypass: så fort temp passerat tillbaka över
      // target i ramp-riktning ska vi släppa ev. motsatt läge som hänger kvar
      // pga neutralzon/prevMode-tröghet, så bypass inte drar förbi setpoint.
      // Heating-ramp: actual ≤ target → tvinga heating direkt.
      // Cooling-ramp: actual ≥ target → tvinga cooling direkt.
      const RAMP_AUTO_RELEASE_BAND = 0.02
      const crossedBack = rampMode === 'heating'
        ? actualTemp <= actualTarget + RAMP_AUTO_RELEASE_BAND
        : actualTemp >= actualTarget - RAMP_AUTO_RELEASE_BAND
      if (crossedBack && suggestedMode !== rampMode) {
        log('MODE_RAMP_AUTO_RELEASE', 'info',
          `${fc.name}: ramp ${rampMode} auto-release (temp ${round1(actualTemp)}° vs target ${round1(actualTarget)}° passerat tillbaka, släpper ${suggestedMode})`)
        suggestedMode = rampMode
        rampOverrideApplied = true
      }
      // Safety escape: if temp is clearly on the wrong side during a ramp,
      // allow the opposite mode before we get a full 1°C runaway.
      // This prevents heating ramps from pinning mode=heating while beer is
      // already drifting warm and cooling should begin.
      const RAMP_OVERRIDE_OVERSHOOT_LIMIT = 0.3
      const overshoot = rampMode === 'heating'
        ? actualTemp - actualTarget   // positive = too hot, need cooling
        : actualTarget - actualTemp   // positive = too cold, need heating
      if (suggestedMode !== rampMode && overshoot > RAMP_OVERRIDE_OVERSHOOT_LIMIT) {
        log('MODE_RAMP_OVERRIDE_BYPASS', 'info',
          `${fc.name}: ramp ${rampMode} override SKIPPED — överskjutning ${overshoot.toFixed(1)}° > ${RAMP_OVERRIDE_OVERSHOOT_LIMIT}°, tillåter ${suggestedMode}`)
      } else if (suggestedMode !== rampMode) {
        // Anti-drift watchdog: en långsam drift under överskjutnings-tröskeln
        // (t.ex. +0.5°C på 3h med duty=0%) hindras inte av guarden ovan. Läs
        // de senaste ~30 min ur temp_controller_history och om temperaturen
        // har glidit ≥ 0.15°C i escape-riktningen släpper vi ramp-override.
        // 0.15°C drift över 60 min = sustained ≥ 0.15°C/h i fel riktning.
        const RAMP_OVERRIDE_DRIFT_LIMIT = 0.15
        const RAMP_OVERRIDE_DRIFT_MINUTES = 60
        let driftBypass = false
        let driftDelta: number | null = null
        if (overshoot > 0.05) {
          const sinceIso = new Date(Date.now() - (RAMP_OVERRIDE_DRIFT_MINUTES + 5) * 60_000).toISOString()
          const { data: histRows } = await ctx.supabase
            .from('temp_controller_history')
            .select('actual_temp, recorded_at')
            .eq('controller_id', fc.controller_id)
            .gte('recorded_at', sinceIso)
            .order('recorded_at', { ascending: true })
            .limit(5)
          if (histRows && histRows.length >= 2) {
            const oldest = Number(histRows[0].actual_temp)
            if (Number.isFinite(oldest)) {
              // Drift mätt i escape-riktning (positivt = behov att byta läge)
              driftDelta = rampMode === 'heating'
                ? actualTemp - oldest   // värmde sig under en heating-ramp → behöver cool
                : oldest - actualTemp   // svalnade under en cooling-ramp → behöver heat
              if (driftDelta >= RAMP_OVERRIDE_DRIFT_LIMIT) driftBypass = true
            }
          }
        }
        if (driftBypass) {
          log('MODE_RAMP_OVERRIDE_DRIFT_BYPASS', 'info',
            `${fc.name}: ramp ${rampMode} override SKIPPED — drift ${driftDelta!.toFixed(2)}°/${RAMP_OVERRIDE_DRIFT_MINUTES}min ≥ ${RAMP_OVERRIDE_DRIFT_LIMIT}°, tillåter ${suggestedMode}`)
        } else {
          // Sustained-overshoot bypass: även om driften är liten, om temp legat
          // på fel sida om target i minst 30 min i rad (t.ex. gradual_ramp som
          // nått sitt mål och nu står still strax över), släpp override så vi
          // kan kyla mjukt tillbaka istället för att låsa heating-läget.
          const RAMP_OVERRIDE_SUSTAINED_MINUTES = 30
          const RAMP_OVERRIDE_SUSTAINED_BAND = 0.05
          let sustainedBypass = false
          let sustainedSamples = 0
          if (overshoot > RAMP_OVERRIDE_SUSTAINED_BAND) {
            const sinceIso = new Date(Date.now() - (RAMP_OVERRIDE_SUSTAINED_MINUTES + 2) * 60_000).toISOString()
            const { data: sustRows } = await ctx.supabase
              .from('temp_controller_history')
              .select('actual_temp, target_temp, recorded_at')
              .eq('controller_id', fc.controller_id)
              .gte('recorded_at', sinceIso)
              .order('recorded_at', { ascending: true })
            if (sustRows && sustRows.length >= 4) {
              sustainedSamples = sustRows.length
              const allOnWrongSide = sustRows.every(r => {
                const at = Number(r.actual_temp)
                const tg = Number(r.target_temp ?? actualTarget)
                if (!Number.isFinite(at) || !Number.isFinite(tg)) return false
                return rampMode === 'heating'
                  ? at > tg + RAMP_OVERRIDE_SUSTAINED_BAND
                  : at < tg - RAMP_OVERRIDE_SUSTAINED_BAND
              })
              const spanMin = (new Date(sustRows[sustRows.length - 1].recorded_at).getTime() - new Date(sustRows[0].recorded_at).getTime()) / 60_000
              if (allOnWrongSide && spanMin >= RAMP_OVERRIDE_SUSTAINED_MINUTES - 2) {
                sustainedBypass = true
              }
            }
          }
          if (sustainedBypass) {
            log('MODE_RAMP_OVERRIDE_SUSTAINED_BYPASS', 'info',
              `${fc.name}: ramp ${rampMode} override SKIPPED — temp legat ${overshoot.toFixed(2)}° på fel sida i ≥${RAMP_OVERRIDE_SUSTAINED_MINUTES}min (${sustainedSamples} samples), tillåter ${suggestedMode}`)
          } else {
            log('MODE_RAMP_OVERRIDE', 'info',
              `${fc.name}: ramp ${rampMode} override (temp ${round1(actualTemp)}° vs target ${round1(actualTarget)}°, would have been ${suggestedMode}${driftDelta != null ? `, drift ${driftDelta.toFixed(2)}°/${RAMP_OVERRIDE_DRIFT_MINUTES}min` : ''})`)
            suggestedMode = rampMode
            rampOverrideApplied = true
          }
        }
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
    if (canSwitchMode && prevMode != null && suggestedMode !== prevMode && (stepChanged || rampJustFinished)) {
      pidMode = suggestedMode
      switchPressure = 0
      const trigger = rampJustFinished ? 'ramp avslutad' : `profilsteg ändrat ${lastStepIndex} → ${currentStepIndex}`
      log(rampJustFinished ? 'MODE_RAMP_SWITCH' : 'MODE_STEP_SWITCH', 'action', `${fc.name}: ${prevMode} → ${suggestedMode} (${trigger}, omedelbar)`, {
        from: prevMode, to: suggestedMode, trigger, oldStep: lastStepIndex, newStep: currentStepIndex,
        distance: round1(distanceToTarget), actualTemp: round1(actualTemp), actualTarget: round1(actualTarget),
      })
    } else if (onWrongSide && distanceToTarget > (isBleLinked ? 0.5 : 0.8)) {
      pidMode = suggestedMode
      switchPressure = 0
      const emThresh = isBleLinked ? 0.5 : 0.8
      log('MODE_EMERGENCY', 'action', `${fc.name}: ${prevMode} → ${suggestedMode} (Δ${round1(distanceToTarget)}° > ${emThresh}°, omedelbar${isBleLinked ? ', BLE' : ''})`, {
        from: prevMode, to: suggestedMode, distance: round1(distanceToTarget),
        actualTemp: round1(actualTemp), actualTarget: round1(actualTarget),
      })
    } else if (onWrongSide && distanceToTarget > 0.6) {
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
        if (lastDutyPct <= 10) {
          log('MODE_DUTY_HOLD', 'info', `${fc.name}: väntar på duty 0% innan lägesbyträkning startar (duty ${lastDutyPct}%)`, {
            from: prevMode, to: suggestedMode, last_duty: lastDutyPct, pressure: switchPressure,
          })
        }
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
      // Litet fel (0.05–0.6°C) på fel sida: ackumulera tryck istället för att låsa
      // pressure på 1. Krypande fel ska annars aldrig nå MODE_SWITCH_CYCLES.
      pidMode = prevMode ?? suggestedMode
      switchPressure = Math.min(switchPressure + 1, MODE_SWITCH_CYCLES + 1)
      if (switchPressure >= MODE_SWITCH_CYCLES && lastDutyPct === 0) {
        pidMode = suggestedMode
        switchPressure = 0
        log('MODE_SWITCH', 'action', `${fc.name}: ${prevMode} → ${suggestedMode} (krypande fel Δ${round1(distanceToTarget)}°, ${MODE_SWITCH_CYCLES} cykler, duty=0%)`, {
          from: prevMode, to: suggestedMode, cycles: MODE_SWITCH_CYCLES, distance: round1(distanceToTarget),
        })
      }
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
    const rawStepType = isProfileOwned ? (profileStatus?.currentStepType ?? (profileStatus ? 'profile' : 'unknown')) : 'standalone'
    // Normalize allt utom ramp/gradual_ramp till 'hold' för PID-baseline-
    // delning — samma blacklist-princip som isHoldStep ovan (rad ~594) och
    // av samma skäl: en whitelist av "hold-lika" namn missar nya stegtyper
    // (vi missade wait_for_gravity_stable och standalone i tur och ordning).
    // Detta förhindrar också I-term-reset när ett profil-steg växlar mellan
    // två fast-mål-varianter (t.ex. 'hold' → 'standalone' när en profil tar
    // slut) — de ska dela lärd baseline, inte nollställas mot varandra.
    const stepType = (rawStepType === 'ramp' || rawStepType === 'gradual_ramp') ? rawStepType : 'hold'

    // === Stale-data detection ===
    // Data is stale if no new sensor reading AND no valid interpolation.
    // When we have a valid interpolation, PID can act on the estimated temp.
    const rawStaleData = prevActualTempAt != null && prevActualTempAt > 0 &&
      lastUpdateMs <= prevActualTempAt * 1000
    const isStaleData = rawStaleData

    // Use pre-fetched utilization (calculated in parallel before the loop)
    let coolingUtil: number | null = null
    let recentUtil: number | null = null
    if (fc.cooling_enabled) {
      const utilResult = ctx.sharedUtilizations.get(fc.controller_id)
      if (utilResult) {
        coolingUtil = utilResult.rolling
        recentUtil = utilResult.recent
      }
    }

    // === PID Calculation (uses interpolated temp when available) ===
    const modeJustSwitched = prevMode != null && pidMode !== prevMode

    // SSOT-stale-signal: PID ser bara actual_temp. Färskheten kommer från
    // controllerns last_update (uppdateras när ny SSOT skrivs).
    const ssotAgeMin = staleMinutes

    const pidVersion = (fc as any).pid_version === 'claude' ? 'claude' : 'v5'
    const pidFn = pidVersion === 'claude' ? calculateCompensatedTargetClaude : calculateCompensatedTarget
    const pidResult = await pidFn(
      supabase, fc.controller_id, pidEffectiveTarget, ctrlTarget,
      fc.name || fc.controller_id, pidMode, stepType,
      pidInputTemp, isStaleData, coolingUtil,
      modeJustSwitched,
      8,
      ssotAgeMin,
      ctx.glycolTemp ?? null,
    )

    // ── Emergency: no-heat undershoot coast ──
    // Heating ej aktiverat → vi kan inte korrigera överskjutning. Tillåt därför
    // bara mjuk "anticipatory" kylning när vi närmar oss mål underifrån:
    //   error >= 0          → full PID (över mål, behövs)
    //   -0.3 < error < 0    → linjär soft-cap (0 → 3%) för mjuk inbromsning
    //   error <= -0.3       → tvinga 0% (för långt under, låt drift återhämta)
    if (
      pidMode === 'cooling' &&
      !fc.heating_enabled &&
      pidResult.dutyCycle != null && pidResult.dutyCycle > 0 &&
      actualTemp < actualTarget
    ) {
      const err = actualTarget - actualTemp // positivt = under mål
      const requestedPct = Math.round(pidResult.dutyCycle * 100)
      if (err >= 0.3) {
        pidResult.dutyCycle = 0
        ;(pidResult.constraints ??= []).push('no-heat-undershoot-coast')
        log('DUTY_FORCE_ZERO', 'action',
          `${fc.name}: probe ${round1(actualTemp)}° ≥0.3° under mål ${round1(actualTarget)}° och heating ej aktiverat → tvingar duty 0% (PID ville ${requestedPct}%)`)
      } else {
        // Linjär soft-cap: 0% vid err=0.3, upp till 3% vid err≈0
        const softCapPct = Math.max(0, Math.round(3 * (1 - err / 0.3)))
        const cappedPct = Math.min(requestedPct, softCapPct)
        if (cappedPct < requestedPct) {
          pidResult.dutyCycle = cappedPct / 100
          ;(pidResult.constraints ??= []).push(`no-heat-soft-approach(${cappedPct}%)`)
          log('DUTY_SOFT_CAP', 'action',
            `${fc.name}: probe ${round1(actualTemp)}° närmar mål ${round1(actualTarget)}° (err ${err.toFixed(2)}°) → mjuk-cap duty ${cappedPct}% (PID ville ${requestedPct}%)`)
        }
      }
    }

    // Log PID status
    const constraintLabels = pidResult.constraints && pidResult.constraints.length > 0 ? pidResult.constraints : []

    log('PILL_COMP_STATUS', 'info', `Controller: ${fc.name} [${pidMode}]`, {
      controller_id: fc.controller_id,
      controller_name: fc.name,
      pill_temp: round1(fc.pill_temp ?? 0),
      probe_temp: round1(fc.current_temp ?? 0),
      actual_temp: Math.round(sensorActualTemp * 100) / 100,
      ...(probeCompOffset != null ? {
        control_temp: Math.round(actualTemp * 100) / 100,
        probe_offset: round1(probeCompOffset),
        sensor_mode: 'probe_compensated',
      } : {}),
      actual_target: round1(actualTarget),
      ctrl_target: round1(ctrlTarget),
      ctrl_target_pid: round1(pidResult.ctrlTargetPid),
      p_correction: round1(pidResult.pCorrection ?? 0),
      i_correction: round1(pidResult.iCorrection ?? 0),
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

    // Interpolation already ran pre-PID; no post-PID interpolation needed.

    // Post-PID safety: if PID still has active duty in the current mode,
    // any switch pressure accumulated from stale pid_last_duty data is invalid.
    if (computedDutyPct > 0 && switchPressure > 0) {
      log('MODE_PRESSURE_RESET', 'info', `${fc.name}: duty ${computedDutyPct}% aktiv, nollställer switch pressure ${switchPressure} → 0`)
      switchPressure = 0
    }

    // ── Single merged upsert for all PID state ──
    // PID operational state (duty, mode, interpolation) must ALWAYS be persisted,
    // even during idle (skipLearning).
    {
      const now = new Date().toISOString()
      const rows: Array<{ controller_id: string; parameter_name: string; learned_value: number; sample_count: number; last_updated_at: string }> = [
        { controller_id: fc.controller_id, parameter_name: 'mode_switch_pressure', learned_value: switchPressure, sample_count: switchPressure, last_updated_at: now },
        { controller_id: fc.controller_id, parameter_name: 'mode_last_probe', learned_value: round1(actualTemp)!, sample_count: 1, last_updated_at: now },
        { controller_id: fc.controller_id, parameter_name: 'pid_current_mode', learned_value: pidMode === 'heating' ? 1 : 2, sample_count: 1, last_updated_at: now },
        { controller_id: fc.controller_id, parameter_name: 'pid_effective_target', learned_value: pidEffectiveTarget, sample_count: 1, last_updated_at: now },
        { controller_id: fc.controller_id, parameter_name: 'pid_last_duty', learned_value: computedDutyPct, sample_count: 1, last_updated_at: now },
        { controller_id: fc.controller_id, parameter_name: 'was_ramp_active', learned_value: rampRateLimited ? 1 : 0, sample_count: 1, last_updated_at: now },
        { controller_id: fc.controller_id, parameter_name: 'est_prev_actual_temp_at', learned_value: lastUpdateMs / 1000, sample_count: 1, last_updated_at: now },
      ]
      if (currentStepIndex != null) {
        rows.push({ controller_id: fc.controller_id, parameter_name: 'mode_last_step_index', learned_value: currentStepIndex, sample_count: 1, last_updated_at: now })
      }
      // Parallel: PID state (controller_learned_compensation) + learnings (fermentation_learnings)
      await Promise.all([
        pidResult.persistPromise,
        supabase.from('fermentation_learnings').upsert(rows, { onConflict: 'controller_id,parameter_name' }),
      ].filter(Boolean))
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
