import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { round1, TempController, loadPillCompSettings, isSensorDataStale, filterStaleControllers, RaptUpdateBatch } from '../_shared/temp-utils.ts';
import { getTempBucket, getLearnedParam } from '../_shared/learning-utils.ts';
import { insertNotification } from '../_shared/notifications.ts';
import { AdjustmentResult } from '../_shared/adjustment-logger.ts';
import { StallSettings } from '../_shared/stall-detection.ts';
import { runControllerAdjustments, ControllerAdjustmentContext } from '../_shared/controller-adjustments.ts';
import { runCoolerCooling, CoolerContext } from '../_shared/cooler-management.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Type definitions
interface DecisionLogEntry {
  step: string;
  result: 'pass' | 'fail' | 'info' | 'action';
  message: string;
  details?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const decisionLog: DecisionLogEntry[] = [];
  const startTime = Date.now();

  let reqBody: any = {};
  try { reqBody = await req.json(); } catch { /* no body */ }
  const dryRun = reqBody?.dryRun === true;

  const log = (step: string, result: 'pass' | 'fail' | 'info' | 'action', message: string, details?: Record<string, unknown>) => {
    decisionLog.push({ step, result, message, details });
    const icon = result === 'pass' ? '✅' : result === 'fail' ? '❌' : result === 'action' ? '🔧' : 'ℹ️';
    console.log(`${icon} [${step}] ${message}`, details ? JSON.stringify(details) : '');
  };

  const printSummary = async (_supabase: ReturnType<typeof createClient> | null, finalResult: string, adjustmentMade: boolean) => {
    const duration = Date.now() - startTime;
    console.log('\n' + '='.repeat(60));
    console.log('📊 AUTO-COOLING DECISION SUMMARY');
    console.log('='.repeat(60));
    console.log(`⏱️  Duration: ${duration}ms | 📝 Decisions: ${decisionLog.length} | 🎯 ${finalResult} | 🔧 ${adjustmentMade ? 'Yes' : 'No'}`);
    decisionLog.forEach((entry, i) => {
      const icon = entry.result === 'pass' ? '✅' : entry.result === 'fail' ? '❌' : entry.result === 'action' ? '🔧' : 'ℹ️';
      console.log(`${i + 1}. ${icon} ${entry.step}: ${entry.message}`);
    });
    console.log('='.repeat(60) + '\n');
    // NOTE: DB logging is handled by sync-rapt-data-quick (merged with sync decisions)
    // to avoid duplicate log entries per cycle.
  };

  let supabase: ReturnType<typeof createClient> | null = null;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    supabase = createClient(supabaseUrl, supabaseKey);

    log('START', 'info', 'Starting auto cooling adjustment check', {
      timestamp: new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    });

    // ── Load settings (use injected data from orchestrator if available) ──
    let settings: any;
    if (reqBody?.injected_settings) {
      settings = reqBody.injected_settings;
      log('SETTINGS', 'info', 'Using injected settings from orchestrator');
    } else {
      const { data: settingsData, error: settingsError } = await supabase
        .from('auto_cooling_settings').select('*').limit(1).single();
      if (settingsError || !settingsData) {
        log('SETTINGS', 'fail', 'Failed to fetch settings', { error: settingsError?.message });
        await printSummary(supabase, 'Settings error', false);
        return new Response(JSON.stringify({ message: 'Settings error', decisionLog }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      settings = settingsData;
    }
    const pillCompSettings = await loadPillCompSettings(supabase);
    const coolingEnabled = settings.enabled;
    const pillCompEnabled = pillCompSettings.enabled;

    log('SETTINGS', 'info', 'Feature toggles', {
      cooling: coolingEnabled,
      pill_compensation: pillCompEnabled,
      stall_boost: !!settings.auto_boost_enabled,
      overshoot_prevention: !!settings.overshoot_prevention_enabled,
      ai_audit: !!settings.ai_audit_enabled,
    });

    if (!coolingEnabled && !pillCompEnabled) {
      log('SETTINGS', 'fail', 'All features disabled');
      await printSummary(supabase, 'All disabled', false);
      return new Response(JSON.stringify({ message: 'All features disabled', decisionLog }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Retry: load pending RAPT retries from previous failed flushes ──
    const { data: pendingRetries } = await supabase
      .from('pending_rapt_retries')
      .select('*')
      .order('created_at', { ascending: true });
    const retriesToProcess = (pendingRetries ?? []) as { id: string; controller_id: string; target_temp: number; reason: string; attempts: number }[];
    if (retriesToProcess.length > 0) {
      log('RETRY', 'info', `Found ${retriesToProcess.length} pending retry(ies) from previous cycle(s)`);
    }

    // ── Load controllers ─────────────────────────────────────────
    const { data: allControllersData, error: allControllersError } = await supabase.from('rapt_temp_controllers').select('*');
    const allControllers = (allControllersData || []) as TempController[];

    if (allControllersError || allControllers.length === 0) {
      log('CONTROLLERS', 'fail', 'No controllers found');
      await printSummary(supabase, 'No controllers', false);
      return new Response(JSON.stringify({ message: 'No controllers', decisionLog }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Auto-follow: all controllers with active cooling or heating, excluding the glycol cooler
    const allActiveControllers = allControllers.filter(c =>
      !(c as any).is_glycol_cooler && (c.cooling_enabled || c.heating_enabled)
    ) as TempController[];

    // SAFETY: Filter out controllers with stale sensor data
    const { fresh: followedControllersFullData, stale: staleControllers } = filterStaleControllers(allActiveControllers, log);
    const followedControllerIds = followedControllersFullData.map(c => c.controller_id);

    if (staleControllers.length > 0) {
      // Notify about stale sensors — this is a safety concern
      for (const sc of staleControllers) {
        const age = isSensorDataStale(sc.last_update);
        await insertNotification(supabase, {
          type: 'stale_sensor',
          title: 'Sensor offline',
          body: `${sc.name}: Ingen sensordata på ${age.ageMinutes ?? '?'} minuter. Automatisk styrning pausad för denna enhet.`,
          controller_id: sc.controller_id,
        });
      }
    }

    if (followedControllerIds.length === 0) {
      log('FOLLOWED_CONTROLLERS', 'info', 'No controllers with fresh data and active cooling/heating found');
    } else {
      log('FOLLOWED_CONTROLLERS', 'pass', `Auto-detected ${followedControllerIds.length} active controller(s) with fresh data`);
    }

    // ── Build context maps ───────────────────────────────────────
    // originalTargetMap removed — profile_target_temp is SSOT
    const lastAdjTimestampMap = new Map<string, string>();
    const profileOwnedControllerIds = new Set<string>();
    const profileTargetMap = new Map<string, number>();
    const sessionBrewIdMap = new Map<string, string>();
    const cooloffControllerIds = new Set<string>();
    const profileStatusMap = new Map<string, { profileTarget: number | null; stepIndex: number; hasCooloff: boolean; activeTarget?: number | null; currentStepType?: string }>();

    // Batch: last PID-adjusted timestamps (exclude pass-through and manual entries)
    {
      const allIds = followedControllersFullData.map(c => c.controller_id);
      const { data: allLastAdj } = await supabase
        .from('auto_cooling_adjustments')
        .select('cooler_controller_id, adjusted_against_timestamp, created_at, reason')
        .in('cooler_controller_id', allIds)
        .not('adjusted_against_timestamp', 'is', null)
        .order('created_at', { ascending: false });
      if (allLastAdj) {
        for (const adj of allLastAdj) {
          if (!lastAdjTimestampMap.has(adj.cooler_controller_id)) {
            // Only track PID adjustments for same-data guard, not pass-throughs or manual
            const reason = adj.reason ?? '';
            if (reason.startsWith('🔄') || reason.startsWith('✏️')) continue;
            lastAdjTimestampMap.set(adj.cooler_controller_id, adj.adjusted_against_timestamp);
          }
        }
      }
    }

    // ── Load profile data ────────────────────────────────────────
    {
      const { data: runningSessions } = await supabase
        .from('fermentation_sessions')
        .select('id, controller_id, profile_id, current_step_index, step_started_at, step_start_temp, brew_id')
        .eq('status', 'running')
        .in('controller_id', followedControllerIds);

      if (runningSessions && runningSessions.length > 0) {
        // Cooloff check — only trigger for large temp changes (≥ 1°C)
        // Small incremental changes from gradual_ramp should not block PID
        const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const sessionIds = runningSessions.map(s => s.id);
        const { data: recentAdjs } = await supabase
          .from('fermentation_step_log')
          .select('session_id, details')
          .in('session_id', sessionIds)
          .eq('action', 'temp_adjusted')
          .gte('created_at', thirtyMinAgo);

        const sessionControllerMap = new Map(runningSessions.map(s => [s.id, s.controller_id]));
        if (recentAdjs) {
          for (const adj of recentAdjs) {
            // Check if this was a small incremental change (gradual_ramp)
            const details = adj.details as Record<string, any> | null;
            if (details?.phase === 'gradual_ramping') {
              // Skip cooloff for gradual ramp — these are small incremental changes
              continue;
            }
            const cId = sessionControllerMap.get(adj.session_id);
            if (cId) { cooloffControllerIds.add(cId); }
          }
        }

        // Batch fetch profile steps
        const uniqueProfileIds = [...new Set(runningSessions.map(s => s.profile_id))];
        const { data: allProfileSteps } = await supabase
          .from('fermentation_profile_steps')
          .select('profile_id, target_temp, step_order, step_type, duration_hours, ramp_type')
          .in('profile_id', uniqueProfileIds)
          .order('step_order', { ascending: true });

        const profileStepsMap = new Map<string, Array<any>>();
        if (allProfileSteps) {
          for (const step of allProfileSteps) {
            const list = profileStepsMap.get(step.profile_id) || [];
            list.push(step);
            profileStepsMap.set(step.profile_id, list);
          }
        }

        for (const session of runningSessions) {
          profileOwnedControllerIds.add(session.controller_id);
          if (session.brew_id) sessionBrewIdMap.set(session.controller_id, session.brew_id);

          // Find the controller's profile_target_temp (SSOT) from the full controller data
          const controllerData = followedControllersFullData.find(c => c.controller_id === session.controller_id);
          const controllerProfileTarget = controllerData?.profile_target_temp != null
            ? parseFloat(String(controllerData.profile_target_temp))
            : null;

          let effectiveTarget: number | null = null;
          const profileSteps = profileStepsMap.get(session.profile_id);
          const currentStepIdx = profileSteps ? Math.min(session.current_step_index, profileSteps.length - 1) : -1;
          const currentStep = profileSteps && currentStepIdx >= 0 ? profileSteps[currentStepIdx] : null;
          const isDynamicStep = currentStep && ['gradual_ramp', 'diacetyl_rest'].includes(currentStep.step_type);

          if (isDynamicStep && controllerProfileTarget !== null) {
            // For dynamic steps (gradual_ramp, diacetyl_rest), the controller's
            // profile_target_temp is the SSOT — not the step's base target_temp
            effectiveTarget = controllerProfileTarget;
          } else if (profileSteps && profileSteps.length > 0) {
            for (let i = currentStepIdx; i >= 0; i--) {
              if (profileSteps[i].target_temp !== null) {
                effectiveTarget = parseFloat(String(profileSteps[i].target_temp));
                break;
              }
            }
          }
          if (effectiveTarget !== null) profileTargetMap.set(session.controller_id, effectiveTarget);

          // Interpolated ramp target (for linear ramp steps only)
          let activeTarget: number | null = null;
          if (currentStep && currentStep.step_type === 'ramp' && currentStep.ramp_type !== 'immediate' && currentStep.duration_hours > 0) {
            const stepStartTemp = session.step_start_temp != null ? parseFloat(String(session.step_start_temp)) : null;
            const stepTarget = currentStep.target_temp != null ? parseFloat(String(currentStep.target_temp)) : null;
            if (stepStartTemp != null && stepTarget != null && session.step_started_at) {
              const elapsedMs = Date.now() - new Date(session.step_started_at).getTime();
              const progress = Math.min(elapsedMs / (currentStep.duration_hours * 3600000), 1);
              activeTarget = round1(stepStartTemp + (stepTarget - stepStartTemp) * progress);
            }
          }

          profileStatusMap.set(session.controller_id, {
            profileTarget: effectiveTarget,
            stepIndex: session.current_step_index,
            hasCooloff: cooloffControllerIds.has(session.controller_id),
            activeTarget,
            currentStepType: currentStep?.step_type ?? undefined,
          });
        }
      }
    }

    // originalTargetMap removed — profile_target_temp is now SSOT for all controllers

    // Log sync data per controller (post-sync state from DB) — ALL controllers for visibility
    for (const controller of allControllers) {
      const pillTemp = round1(controller.pill_temp);
      const currentTemp = round1(controller.current_temp ?? controller.pill_temp) ?? 0;
      const targetTemp = round1(controller.target_temp) ?? 999;
      const hysteresis = parseFloat(String(controller.cooling_hysteresis ?? '0.2'));
      const isActivelyCooling = controller.cooling_enabled && currentTemp > (targetTemp + hysteresis);
      
      const profileTarget = profileTargetMap.get(controller.controller_id);
      const controllerProfileTarget = (controller as any).profile_target_temp != null
        ? round1(parseFloat(String((controller as any).profile_target_temp)))
        : null;
      const isGlycolCtrl = !!(controller as any).is_glycol_cooler;
      const originalTarget = isGlycolCtrl ? targetTemp : (profileTarget ?? controllerProfileTarget ?? targetTemp);

      // Check if target_temp was preserved (profile or PID controls target, not hardware)
      const isPreserved = profileOwnedControllerIds.has(controller.controller_id);

      // Check if this controller is stale or excluded
      const isStale = staleControllers.some(s => s.controller_id === controller.controller_id);
      const isGlycol = !!(controller as any).is_glycol_cooler;
      const isFollowed = followedControllerIds.includes(controller.controller_id);

      const details: Record<string, unknown> = {
        last_update: controller.last_update ? new Date(controller.last_update).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null,
        pill_temp: pillTemp, ctrl_temp: currentTemp, ctrl_target: targetTemp,
        profile_target: originalTarget,
        cooling_enabled: controller.cooling_enabled, is_actively_cooling: isActivelyCooling,
        preserved: isPreserved,
      };
      if (isStale) details.stale = true;
      if (isGlycol) details.glycol = true;
      if (!isFollowed && !isGlycol) details.inactive = true;
      const profileInfo = profileStatusMap.get(controller.controller_id);
      if (profileInfo) {
        if (profileInfo.activeTarget != null && profileInfo.activeTarget !== profileInfo.profileTarget) details.ramp_target = profileInfo.activeTarget;
        details.step_index = profileInfo.stepIndex;
        if (profileInfo.currentStepType) details.step_type = profileInfo.currentStepType;
        if (profileInfo.hasCooloff) details.cooloff = true;
      }

      // Add learned duty cycle percentage if available (for non-glycol, active controllers)
      if (!isGlycol && isFollowed && !isStale) {
        const cBucket = getTempBucket(targetTemp);
        const dutyParam = await getLearnedParam(supabase, controller.controller_id, `steady_state_duty:${cBucket}`, -1);
        if (dutyParam.sampleCount >= 3 && dutyParam.value > 0) {
          details.duty_pct = Math.round(dutyParam.value * 100);
          details.duty_samples = dutyParam.sampleCount;
        }
      }

      log('SYNC_DATA', 'info', `Controller: ${controller.name}`, details);
    }

    // ── Log Brew/SG data per controller ──────────────────────────
    // Use brew_sg_data passed from orchestrator if available (eliminates DB query)
    {
      const passedBrewSgData: Record<string, any> | null = reqBody?.brew_sg_data || null;

      // Collect all brew IDs linked to followed controllers
      const controllerBrewIds = new Map<string, string>();
      for (const controller of followedControllersFullData) {
        const brewId = sessionBrewIdMap.get(controller.controller_id);
        if (brewId) controllerBrewIds.set(controller.controller_id, brewId);
      }

      // Determine which controllers have brew data (from passed data or session linkage)
      const controllersWithBrewData = new Set<string>();
      if (passedBrewSgData) {
        for (const cId of Object.keys(passedBrewSgData)) {
          controllersWithBrewData.add(cId);
        }
      }
      for (const cId of controllerBrewIds.keys()) {
        controllersWithBrewData.add(cId);
      }

      if (controllersWithBrewData.size > 0) {
        // Fetch metrics from DB (computed by compute-fermentation-metrics which runs before us)
        const brewIds = [...new Set([
          ...controllerBrewIds.values(),
          ...(passedBrewSgData ? Object.values(passedBrewSgData).map((b: any) => b.brew_id).filter(Boolean) : []),
        ])];

        // Only fetch brew_readings from DB if we don't have passed data (fallback for manual invocations)
        let brewMap = new Map<string, any>();
        if (!passedBrewSgData) {
          const { data: brews } = await supabase.from('brew_readings')
            .select('id, name, current_sg, original_gravity, final_gravity, attenuation, current_temp, battery, last_update, status')
            .in('id', brewIds);
          brewMap = new Map((brews || []).map(b => [b.id, b]));
          log('BREW_SG_STATUS', 'info', 'Using DB fallback for brew data (no orchestrator data passed)');
        } else {
          log('BREW_SG_STATUS', 'info', `Using orchestrator-passed brew data for ${Object.keys(passedBrewSgData).length} controller(s)`);
        }

        const { data: metrics } = await supabase.from('brew_fermentation_metrics')
          .select('brew_id, sg_rate_per_hour, fermentation_phase, activity_score, eta_to_fg_hours, ready_to_crash')
          .in('brew_id', brewIds);
        const metricsMap = new Map((metrics || []).map(m => [m.brew_id, m]));

        for (const controller of followedControllersFullData) {
          // Try passed data first, then DB fallback
          const passed = passedBrewSgData?.[controller.controller_id];
          const brewId = passed?.brew_id || controllerBrewIds.get(controller.controller_id);
          if (!brewId && !passed) continue;

          const brew = passed || brewMap.get(brewId);
          if (!brew) continue;

          const m = metricsMap.get(brewId || passed?.brew_id);

          log('BREW_SG_STATUS', 'info', `Controller: ${controller.name}`, {
            brew_name: brew.name ?? brew.brew_name,
            current_sg: brew.current_sg,
            og: brew.og ?? brew.original_gravity,
            fg: brew.fg ?? brew.final_gravity,
            attenuation: brew.attenuation,
            pill_temp: brew.pill_temp ?? brew.current_temp,
            battery: brew.battery,
            status: brew.status,
            last_update: brew.last_update ? new Date(brew.last_update).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' }) : null,
            last_update_raw: brew.last_update || null,
            ...(m ? {
              sg_rate: parseFloat((m.sg_rate_per_hour ?? 0).toFixed(4)),
              phase: m.fermentation_phase,
              activity: parseFloat((m.activity_score ?? 0).toFixed(1)),
              eta_hours: m.eta_to_fg_hours != null ? parseFloat((m.eta_to_fg_hours).toFixed(1)) : null,
              ready_to_crash: m.ready_to_crash,
            } : {}),
          });
        }
      }
    }

    const allAdjustments: AdjustmentResult[] = [];

    // Create shared batch for all RAPT API updates (reuse token if passed from orchestrator)
    const updateBatch = new RaptUpdateBatch(reqBody?.rapt_access_token);

    // ── Add pending retries to the batch (before new adjustments) ──
    for (const retry of retriesToProcess) {
      const ctrl = allControllers.find(c => c.controller_id === retry.controller_id);
      const isPwmRevert = retry.reason.includes('PWM OFF');

      if (!ctrl) {
        await supabase.from('pending_rapt_retries').delete().eq('id', retry.id);
        continue;
      }

      if (isPwmRevert) {
        // PWM OFF reverts are normally handled by run-automation (sleep + OFF).
        // Only process here as FALLBACK if the pending is stale (>6 min = run-automation failed).
        const pendingAge = Date.now() - new Date(retry.created_at).getTime();
        const STALE_THRESHOLD_MS = 6 * 60 * 1000; // 6 minutes

        if (pendingAge < STALE_THRESHOLD_MS) {
          // Fresh pending — run-automation will handle it
          log('RETRY', 'pass', `PWM OFF revert ${ctrl.name}: skipping — run-automation handles sleep+OFF (age ${Math.round(pendingAge/1000)}s)`);
          continue;
        }

        // Stale pending — run-automation failed, process as fallback
        updateBatch.addHardwareOnly(retry.controller_id, retry.target_temp, 0);
        log('RETRY', 'action', `PWM OFF revert ${ctrl.name}: FALLBACK hw 0° → ${retry.target_temp}°C (stale ${Math.round(pendingAge/1000)}s, run-automation missed)`);
      } else if (Math.abs((ctrl.target_temp ?? 0) - retry.target_temp) >= 0.05) {
        updateBatch.add(retry.controller_id, retry.target_temp, ctrl.target_temp ?? undefined);
        log('RETRY', 'action', `Retrying ${ctrl.name}: → ${retry.target_temp}°C (attempt ${retry.attempts + 1}, reason: ${retry.reason.slice(0, 60)})`);
      } else {
        // Target already matches or controller gone — clean up
        await supabase.from('pending_rapt_retries').delete().eq('id', retry.id);
        log('RETRY', 'pass', `Retry no longer needed for ${ctrl.name} (target already ${ctrl.target_temp}°C)`);
      }
    }

    // ── Idle detection: skip learning when system is idle ──
    // Idle = no running fermentation sessions (any controller) AND
    // cooler already at max or cooling disabled
    const { data: anyRunningSessions } = await supabase
      .from('fermentation_sessions')
      .select('id')
      .eq('status', 'running')
      .limit(1);
    const hasAnySessions = (anyRunningSessions?.length ?? 0) > 0;
    const coolerControllerData = allControllers.find(c => (c as any).is_glycol_cooler);
    const coolerAtMaxTemp = coolerControllerData
      ? parseFloat(String(coolerControllerData.target_temp ?? '0')) >= parseFloat(String(coolerControllerData.max_target_temp ?? '25'))
      : true;
    const systemIsIdle = !hasAnySessions && (!coolingEnabled || coolerAtMaxTemp);
    if (systemIsIdle) {
      log('LEARNING', 'info', 'Systemet i viloläge — hoppar all inlärning');
    }

    // ══════════════════════════════════════════════════════════════
    // CONTROLLER ADJUSTMENTS (PID + Stall — tank-level)
    // ══════════════════════════════════════════════════════════════
    const stallSettings: StallSettings = {
      enabled: settings.auto_boost_enabled ?? false,
      sgRateThreshold: parseFloat(String(settings.stall_rate_threshold ?? 0.001)),
      minAttenuation: parseFloat(String(settings.stall_min_attenuation ?? 10)),
      maxAttenuation: parseFloat(String(settings.stall_max_attenuation ?? 90)),
    };

    const pwmBursts: import('../_shared/controller-adjustments.ts').PwmBurst[] = []; // kept for type compat
    const baseTargetMap = new Map<string, number>();

    const controllerCtx: ControllerAdjustmentContext = {
      supabase, supabaseUrl, serviceRoleKey: supabaseKey,
      followedControllersFullData, profileOwnedControllerIds,
      profileTargetMap, sessionBrewIdMap, cooloffControllerIds,
      profileStatusMap, lastAdjTimestampMap, pillCompSettings,
      stallSettings, log,
      updateBatch,
      pwmBursts,
      baseTargetMap,
      skipLearning: systemIsIdle,
    };

    const controllerAdjs = await runControllerAdjustments(controllerCtx);
    allAdjustments.push(...controllerAdjs);

    // ══════════════════════════════════════════════════════════════
    // COOLER MANAGEMENT (shared cooling unit)
    // ══════════════════════════════════════════════════════════════
    let coolerCtx: CoolerContext | null = null;
    if (coolingEnabled) {
      coolerCtx = {
        supabase, supabaseUrl, serviceRoleKey: supabaseKey,
        allControllers, followedControllersFullData, followedControllerIds,
        settings: { id: settings.id, last_check_at: settings.last_check_at }, log,
        updateBatch,
        baseTargetMap,
        skipLearning: systemIsIdle,
      };
      const coolerAdjs = await runCoolerCooling(coolerCtx);
      allAdjustments.push(...coolerAdjs);
    } else {
      log('COOLING', 'info', 'Auto cooling adjustment disabled');
    }

    // ══════════════════════════════════════════════════════════════
    // DRY-RUN: Return pending updates without flushing to RAPT API
    // Used by orchestrator (sync-rapt-data-quick) for Phase 3 flush
    // ══════════════════════════════════════════════════════════════
    if (dryRun) {
      const pendingUpdates = updateBatch.getPendingUpdates();
      const hwOnlyIds = updateBatch.getHwOnlyIds();
      log('COMPLETE', 'info', `Completed (dryRun)`, { adjustments_made: allAdjustments.length, pending_updates: pendingUpdates.length });
      await printSummary(supabase, allAdjustments.length > 0 ? 'Adjustment made (dryRun)' : 'No adjustment needed', allAdjustments.length > 0);

      return new Response(JSON.stringify({
        success: true,
        dryRun: true,
        adjustments: allAdjustments,
        message: `Made ${allAdjustments.length} adjustments (dryRun)`,
        decisionLog,
        pendingUpdates,
        hwOnlyIds,
        retriesToProcess: retriesToProcess.map(r => ({ id: r.id, controller_id: r.controller_id, target_temp: r.target_temp, reason: r.reason, attempts: r.attempts })),
        pendingKickControllerId: coolerCtx?.pendingKickControllerId ?? null,
        pwmBursts: pwmBursts.length > 0 ? pwmBursts : undefined,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ══════════════════════════════════════════════════════════════
    // FLUSH: Send all queued RAPT updates in parallel (1 auth, N parallel API calls)
    // (Only when NOT in dryRun mode — standalone invocations)
    // ══════════════════════════════════════════════════════════════
    if (updateBatch.size > 0) {
      log('BATCH_FLUSH', 'info', `Flushing ${updateBatch.size} RAPT update(s) in parallel...`);
      const batchResults = await updateBatch.flush();
      const failed = [...batchResults.entries()].filter(([, ok]) => !ok);
      if (failed.length > 0) {
        log('BATCH_FLUSH', 'fail', `${failed.length} update(s) failed: ${failed.map(([id]) => id).join(', ')}`);

        // Remove adjustment log entries for failed controllers — they were logged
        // before the flush and would otherwise block cooldown timers from allowing retries
        const cycleStart = new Date(startTime).toISOString();
        for (const [controllerId] of failed) {
          await supabase.from('auto_cooling_adjustments')
            .delete()
            .eq('cooler_controller_id', controllerId)
            .gte('created_at', cycleStart);
          log('FLUSH_CLEANUP', 'info', `Tog bort adjustment-log för ${allControllers.find(c => c.controller_id === controllerId)?.name ?? controllerId} (flush misslyckades)`);
        }

        // Save failed updates for retry next cycle
        for (const [controllerId] of failed) {
          const target = updateBatch.getAppliedTarget(controllerId);
          if (target == null) continue;
          const existingRetry = retriesToProcess.find(r => r.controller_id === controllerId);
          const attempts = (existingRetry?.attempts ?? 0) + 1;
          const controllerData = allControllers.find(c => c.controller_id === controllerId);
          const name = controllerData?.name ?? controllerId;

          if (attempts >= 5) {
            log('RETRY', 'fail', `Ger upp retry för ${name} efter ${attempts} försök`);
            if (existingRetry) {
              await supabase.from('pending_rapt_retries').delete().eq('id', existingRetry.id);
            }
          } else if (existingRetry) {
            await supabase.from('pending_rapt_retries')
              .update({ target_temp: target, attempts })
              .eq('id', existingRetry.id);
            log('RETRY', 'info', `Sparar retry för ${name} → ${target}°C (försök ${attempts})`);
          } else {
            await supabase.from('pending_rapt_retries').insert({
              controller_id: controllerId,
              target_temp: target,
              reason: `Flush failed for ${name}`,
              attempts: 1,
            } as any);
            log('RETRY', 'info', `Sparar retry för ${name} → ${target}°C (försök 1)`);
          }
        }
      } else {
        log('BATCH_FLUSH', 'pass', `All ${batchResults.size} update(s) sent successfully`);
      }

      // Clean up retries that succeeded
      const succeeded = [...batchResults.entries()].filter(([, ok]) => ok);
      for (const [controllerId] of succeeded) {
        const existingRetry = retriesToProcess.find(r => r.controller_id === controllerId);
        if (existingRetry) {
          await supabase.from('pending_rapt_retries').delete().eq('id', existingRetry.id);
          const ctrlName = allControllers.find(c => c.controller_id === controllerId)?.name ?? controllerId;
          log('RETRY', 'pass', `Retry lyckades för ${ctrlName}`);
        }
      }

      // Log individual RAPT_SEND entries for each successfully sent update
      for (const [controllerId] of succeeded) {
        const target = updateBatch.getAppliedTarget(controllerId);
        const controllerData = followedControllersFullData.find(c => c.controller_id === controllerId)
          ?? allControllers.find(c => c.controller_id === controllerId);
        // Use the original old target stored at queue time, not the in-memory (mutated) value
        const oldTarget = updateBatch.getOldTarget(controllerId) ?? (controllerData ? round1(controllerData.target_temp) : null);
        const name = controllerData?.name ?? controllerId;
        // Skip logging when rounded values are identical (sub-0.1° difference)
        if (oldTarget != null && target != null && round1(oldTarget) === round1(target)) continue;
        // Detect PWM ON sends (hardware-only with target=0)
        const isPwmSend = updateBatch.isHardwareOnly(controllerId) && target === 0;
        // Extract duty_pct from DUTY_PWM_BURST decision if available
        const pwmBurstDecision = isPwmSend ? decisionLog.find(d => d.step === 'DUTY_PWM_BURST' && d.message?.includes(name)) : null;
        const pwmDutyPct = (pwmBurstDecision?.details as { duty_pct?: number } | undefined)?.duty_pct;
        log('RAPT_SEND', 'action', `${name}: ${oldTarget ?? '?'}°C → ${target}°C`, {
          controller_id: controllerId,
          old_target: oldTarget,
          new_target: target,
          ...(isPwmSend && { is_pwm: true, duty_pct: pwmDutyPct }),
        });
      }

      // Persist successful target_temp changes to DB so next cycle reads the correct value
      // SKIP hardware-only updates (PWM bursts) — DB target_temp stays at the real PID value
      if (succeeded.length > 0) {
        const dbUpdates = succeeded
          .filter(([controllerId]) => !updateBatch.isHardwareOnly(controllerId))
          .map(([controllerId]) => {
            const target = updateBatch.getAppliedTarget(controllerId);
            return supabase
              .from('rapt_temp_controllers')
              .update({ target_temp: target, updated_at: new Date().toISOString() })
              .eq('controller_id', controllerId);
          });
        if (dbUpdates.length > 0) {
          const dbResults = await Promise.allSettled(dbUpdates);
          const dbFailed = dbResults.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.error));
          if (dbFailed.length > 0) {
            log('BATCH_DB', 'fail', `${dbFailed.length} DB update(s) failed`);
          }
        }
      }

      // Set hysteresis_kick_active flag ONLY after confirming the kick was flushed successfully
      if (coolingEnabled && coolerCtx?.pendingKickControllerId) {
        const kickId = coolerCtx.pendingKickControllerId;
        const kickSucceeded = batchResults.get(kickId) === true;
        if (kickSucceeded) {
          await supabase.from('rapt_temp_controllers')
            .update({ hysteresis_kick_active: true })
            .eq('controller_id', kickId);
          log('KICK_FLAG', 'pass', `Hysteres-kick bekräftad — flagga satt efter lyckad flush`);
        } else {
          log('KICK_FLAG', 'fail', `Hysteres-kick flush misslyckades — flagga EJ satt`);
        }
      }
    }

    // ── Summary ──────────────────────────────────────────────────
    log('COMPLETE', 'info', `Completed`, { adjustments_made: allAdjustments.length });
    await printSummary(supabase, allAdjustments.length > 0 ? 'Adjustment made' : 'No adjustment needed', allAdjustments.length > 0);

    return new Response(JSON.stringify({ success: true, adjustments: allAdjustments, message: `Made ${allAdjustments.length} adjustments`, decisionLog, pwmBursts: pwmBursts.length > 0 ? pwmBursts : undefined }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    log('ERROR', 'fail', 'Unexpected error', { error: error instanceof Error ? error.message : 'Unknown error' });
    await printSummary(supabase, 'Error', false);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error', decisionLog }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
