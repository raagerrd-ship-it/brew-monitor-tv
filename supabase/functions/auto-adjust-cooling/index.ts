import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { round1, TempController, loadPillCompSettings, isSensorDataStale, filterStaleControllers, RaptUpdateBatch } from '../_shared/temp-utils.ts';
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const decisionLog: DecisionLogEntry[] = [];
  const startTime = Date.now();

  let reqBody: any = {};
  try { reqBody = await req.json(); } catch { /* no body */ }

  const log = (step: string, result: 'pass' | 'fail' | 'info' | 'action', message: string, details?: Record<string, unknown>) => {
    decisionLog.push({ step, result, message, details });
    const icon = result === 'pass' ? '✅' : result === 'fail' ? '❌' : result === 'action' ? '🔧' : 'ℹ️';
    console.log(`${icon} [${step}] ${message}`, details ? JSON.stringify(details) : '');
  };

  const printSummary = async (supabase: ReturnType<typeof createClient> | null, finalResult: string, adjustmentMade: boolean) => {
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

    if (supabase) {
      try {
        // Deduplicate consecutive "No adjustment" logs: update the latest instead of inserting
        let shouldInsert = true;
        if (!adjustmentMade) {
          const { data: prev, error: prevError } = await supabase
            .from('auto_cooling_decision_logs')
            .select('id, adjustment_made')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          if (!prevError && prev && !prev.adjustment_made) {
            // Latest log is also no-adjustment — update it in place
            const { error: updateError } = await supabase.from('auto_cooling_decision_logs')
              .update({
                duration_ms: duration,
                decision_count: decisionLog.length,
                decisions: decisionLog as any,
                final_result: finalResult,
                created_at: new Date().toISOString(),
              } as any)
              .eq('id', prev.id);
            
            if (!updateError) {
              shouldInsert = false;
            } else {
              console.error('Dedup update failed, will insert instead:', updateError.message);
            }
          }
        }

        if (shouldInsert) {
          await supabase.from('auto_cooling_decision_logs').insert({
            duration_ms: duration, decision_count: decisionLog.length,
            decisions: decisionLog, final_result: finalResult, adjustment_made: adjustmentMade,
          } as any);
        }
      } catch (e) { console.error('Error saving decision log:', e); }
    }
  };

  let supabase: ReturnType<typeof createClient> | null = null;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    supabase = createClient(supabaseUrl, supabaseKey);

    log('START', 'info', 'Starting auto cooling adjustment check', {
      timestamp: new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    });

    // ── Load settings ────────────────────────────────────────────
    const { data: settingsData, error: settingsError } = await supabase
      .from('auto_cooling_settings').select('*').limit(1).single();

    if (settingsError || !settingsData) {
      log('SETTINGS', 'fail', 'Failed to fetch settings', { error: settingsError?.message });
      await printSummary(supabase, 'Settings error', false);
      return new Response(JSON.stringify({ message: 'Settings error', decisionLog }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const settings = settingsData as any;
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

    // Log sync data per controller (post-sync state from DB)
    for (const controller of followedControllersFullData) {
      const pillTemp = round1(controller.pill_temp);
      const currentTemp = round1(controller.current_temp ?? controller.pill_temp) ?? 0;
      const targetTemp = round1(controller.target_temp) ?? 999;
      const hysteresis = parseFloat(String(controller.cooling_hysteresis ?? '0.2'));
      const isActivelyCooling = controller.cooling_enabled && currentTemp > (targetTemp + hysteresis);
      
      const profileTarget = profileTargetMap.get(controller.controller_id);
      const controllerProfileTarget = (controller as any).profile_target_temp != null
        ? round1(parseFloat(String((controller as any).profile_target_temp)))
        : null;
      const originalTarget = profileTarget ?? controllerProfileTarget ?? targetTemp;

      // Check if target_temp was preserved (differs from what RAPT hardware would have set)
      const isPreserved = profileOwnedControllerIds.has(controller.controller_id) || (controller as any).is_glycol_cooler;

      const details: Record<string, unknown> = {
        last_update: controller.last_update ? new Date(controller.last_update).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null,
        pill_temp: pillTemp, ctrl_temp: currentTemp, ctrl_target: targetTemp,
        profile_target: originalTarget,
        cooling_enabled: controller.cooling_enabled, is_actively_cooling: isActivelyCooling,
        preserved: isPreserved,
      };
      const profileInfo = profileStatusMap.get(controller.controller_id);
      if (profileInfo) {
        if (profileInfo.activeTarget != null && profileInfo.activeTarget !== profileInfo.profileTarget) details.ramp_target = profileInfo.activeTarget;
        details.step_index = profileInfo.stepIndex;
        if (profileInfo.currentStepType) details.step_type = profileInfo.currentStepType;
        if (profileInfo.hasCooloff) details.cooloff = true;
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

    // ══════════════════════════════════════════════════════════════
    // CONTROLLER ADJUSTMENTS (PID + Stall — tank-level)
    // ══════════════════════════════════════════════════════════════
    const stallSettings: StallSettings = {
      enabled: settings.auto_boost_enabled ?? false,
      sgRateThreshold: parseFloat(String(settings.stall_rate_threshold ?? 0.001)),
      minAttenuation: parseFloat(String(settings.stall_min_attenuation ?? 10)),
      maxAttenuation: parseFloat(String(settings.stall_max_attenuation ?? 90)),
    };

    const controllerCtx: ControllerAdjustmentContext = {
      supabase, supabaseUrl, serviceRoleKey: supabaseKey,
      followedControllersFullData, profileOwnedControllerIds,
      profileTargetMap, sessionBrewIdMap, cooloffControllerIds,
      profileStatusMap, lastAdjTimestampMap, pillCompSettings,
      stallSettings, log,
      updateBatch,
    };

    const controllerAdjs = await runControllerAdjustments(controllerCtx);
    allAdjustments.push(...controllerAdjs);

    // ══════════════════════════════════════════════════════════════
    // COOLER MANAGEMENT (shared cooling unit)
    // ══════════════════════════════════════════════════════════════
    if (coolingEnabled) {
      const coolerCtx: CoolerContext = {
        supabase, supabaseUrl, serviceRoleKey: supabaseKey,
        allControllers, followedControllersFullData, followedControllerIds,
        settings: { id: settings.id, last_check_at: settings.last_check_at }, log,
        updateBatch,
      };
      const coolerAdjs = await runCoolerCooling(coolerCtx);
      allAdjustments.push(...coolerAdjs);
    } else {
      log('COOLING', 'info', 'Auto cooling adjustment disabled');
    }

    // ══════════════════════════════════════════════════════════════
    // FLUSH: Send all queued RAPT updates in parallel (1 auth, N parallel API calls)
    // ══════════════════════════════════════════════════════════════
    if (updateBatch.size > 0) {
      log('BATCH_FLUSH', 'info', `Flushing ${updateBatch.size} RAPT update(s) in parallel...`);
      const batchResults = await updateBatch.flush();
      const failed = [...batchResults.entries()].filter(([, ok]) => !ok);
      if (failed.length > 0) {
        log('BATCH_FLUSH', 'fail', `${failed.length} update(s) failed: ${failed.map(([id]) => id).join(', ')}`);
      } else {
        log('BATCH_FLUSH', 'pass', `All ${batchResults.size} update(s) sent successfully`);
      }

      // Log individual RAPT_SEND entries for each successfully sent update
      const succeeded = [...batchResults.entries()].filter(([, ok]) => ok);
      for (const [controllerId] of succeeded) {
        const target = updateBatch.getAppliedTarget(controllerId);
        const controllerData = followedControllersFullData.find(c => c.controller_id === controllerId)
          ?? allControllers.find(c => c.controller_id === controllerId);
        // Use the original old target stored at queue time, not the in-memory (mutated) value
        const oldTarget = updateBatch.getOldTarget(controllerId) ?? (controllerData ? round1(controllerData.target_temp) : null);
        const name = controllerData?.name ?? controllerId;
        // Skip logging when rounded values are identical (sub-0.1° difference)
        if (oldTarget != null && target != null && round1(oldTarget) === round1(target)) continue;
        log('RAPT_SEND', 'action', `${name}: ${oldTarget ?? '?'}°C → ${target}°C`, {
          controller_id: controllerId,
          old_target: oldTarget,
          new_target: target,
        });
      }

      // Persist successful target_temp changes to DB so next cycle reads the correct value
      if (succeeded.length > 0) {
        const dbUpdates = succeeded.map(([controllerId]) => {
          const target = updateBatch.getAppliedTarget(controllerId);
          return supabase
            .from('rapt_temp_controllers')
            .update({ target_temp: target, updated_at: new Date().toISOString() })
            .eq('controller_id', controllerId);
        });
        const dbResults = await Promise.allSettled(dbUpdates);
        const dbFailed = dbResults.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.error));
        if (dbFailed.length > 0) {
          log('BATCH_DB', 'fail', `${dbFailed.length} DB update(s) failed`);
        }
      }
    }

    // ── Summary ──────────────────────────────────────────────────
    log('COMPLETE', 'info', `Completed`, { adjustments_made: allAdjustments.length });
    await printSummary(supabase, allAdjustments.length > 0 ? 'Adjustment made' : 'No adjustment needed', allAdjustments.length > 0);

    return new Response(JSON.stringify({ success: true, adjustments: allAdjustments, message: `Made ${allAdjustments.length} adjustments`, decisionLog }), {
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
