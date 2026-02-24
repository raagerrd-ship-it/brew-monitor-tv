import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { round1, TempController, setControllerTargetTemp, loadPillCompSettings, calculateCompensatedTarget } from '../_shared/temp-utils.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Type definitions for database records
interface AutoCoolingSettings {
  id: string;
  enabled: boolean;
  check_interval_minutes: number;
  temp_reduction_degrees: number;
  max_diff_from_lowest: number;
  cooler_controller_id: string | null;
  last_check_at: string | null;
  delta_alert_threshold: number;
  auto_boost_enabled: boolean;
  auto_boost_degrees: number;
  stall_rate_threshold: number;
}

interface FollowedController {
  controller_id: string;
}

interface HistoryRecord {
  recorded_at: string;
  current_temp: number;
  target_temp: number;
  cooling_enabled: boolean;
}

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

  // No mode parsing needed — all features run in a single pass
  try { await req.json(); } catch { /* no body */ }

  const log = (step: string, result: 'pass' | 'fail' | 'info' | 'action', message: string, details?: Record<string, unknown>) => {
    const entry: DecisionLogEntry = { step, result, message, details };
    decisionLog.push(entry);
    const icon = result === 'pass' ? '✅' : result === 'fail' ? '❌' : result === 'action' ? '🔧' : 'ℹ️';
    console.log(`${icon} [${step}] ${message}`, details ? JSON.stringify(details) : '');
  };

  const printSummary = async (supabase: ReturnType<typeof createClient> | null, finalResult: string, adjustmentMade: boolean) => {
    const duration = Date.now() - startTime;
    console.log('\n' + '='.repeat(60));
    console.log('📊 AUTO-COOLING DECISION SUMMARY');
    console.log('='.repeat(60));
    console.log(`⏱️  Duration: ${duration}ms`);
    console.log(`📝 Total decisions: ${decisionLog.length}`);
    console.log(`🎯 Result: ${finalResult}`);
    console.log(`🔧 Adjustment made: ${adjustmentMade ? 'Yes' : 'No'}`);
    console.log('-'.repeat(60));
    
    decisionLog.forEach((entry, index) => {
      const icon = entry.result === 'pass' ? '✅' : entry.result === 'fail' ? '❌' : entry.result === 'action' ? '🔧' : 'ℹ️';
      console.log(`${index + 1}. ${icon} ${entry.step}: ${entry.message}`);
      if (entry.details) {
        Object.entries(entry.details).forEach(([key, value]) => {
          console.log(`      └─ ${key}: ${JSON.stringify(value)}`);
        });
      }
    });
    
    console.log('='.repeat(60) + '\n');

    // Always persist decision log
    if (supabase) {
      try {
        await supabase.from('auto_cooling_decision_logs').insert({
          duration_ms: duration,
          decision_count: decisionLog.length,
          decisions: decisionLog,
          final_result: finalResult,
          adjustment_made: adjustmentMade
        } as any);
        console.log('Decision log saved to database');
      } catch (e) {
        console.error('Error saving decision log:', e);
      }
    }
  };

  let supabase: ReturnType<typeof createClient> | null = null;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    supabase = createClient(supabaseUrl, supabaseKey);

    log('START', 'info', 'Starting auto cooling adjustment check', { timestamp: new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', second: '2-digit' }) });

    // Get settings
    const { data: settingsData, error: settingsError } = await supabase
      .from('auto_cooling_settings')
      .select('*')
      .limit(1)
      .single();

    const settings = settingsData as AutoCoolingSettings | null;

    if (settingsError || !settings) {
      log('SETTINGS', 'fail', 'Failed to fetch settings', { error: settingsError?.message });
      await printSummary(supabase, 'Settings error', false);
      return new Response(JSON.stringify({ message: 'Settings error', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load pill-comp settings early — needed to check feature toggles
    const pillCompSettings = await loadPillCompSettings(supabase);

    // Check if ANY feature is enabled
    const coolingEnabled = settings.enabled;
    const pillCompEnabled = pillCompSettings.enabled;

    log('SETTINGS', 'info', 'Feature toggles', {
      cooling: coolingEnabled,
      pill_compensation: pillCompEnabled,
    });

    if (!coolingEnabled && !pillCompEnabled) {
      log('SETTINGS', 'fail', 'All features disabled');
      await printSummary(supabase, 'All disabled', false);
      return new Response(JSON.stringify({ message: 'All features disabled', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get followed controllers (needed by all features)
    const { data: followedData, error: followedError } = await supabase
      .from('auto_cooling_followed_controllers')
      .select('controller_id');

    const followedControllers = followedData as FollowedController[] | null;

    if (followedError || !followedControllers || followedControllers.length === 0) {
      log('FOLLOWED_CONTROLLERS', 'fail', 'No followed controllers configured');
      await printSummary(supabase, 'No followed controllers', false);
      return new Response(JSON.stringify({ message: 'No followed controllers', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const followedControllerIds = followedControllers.map(c => c.controller_id);
    log('FOLLOWED_CONTROLLERS', 'pass', `Found ${followedControllerIds.length} followed controller(s)`);

    // Get data for followed controllers (needed by all features)
    const { data: followedFullData, error: followedDataError } = await supabase
      .from('rapt_temp_controllers')
      .select('*')
      .in('controller_id', followedControllerIds);

    const followedControllersFullData = followedFullData as TempController[] | null;

    if (followedDataError || !followedControllersFullData || followedControllersFullData.length === 0) {
      log('FOLLOWED_DATA', 'fail', 'No followed controllers data found');
      await printSummary(supabase, 'No followed controllers data', false);
      return new Response(JSON.stringify({ message: 'No followed controllers data', decisionLog }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // NOTE: originalTargetMap is populated AFTER profileOwnedControllerIds is filled (below)
    // to avoid using stale historical targets for profile-owned controllers.
    const originalTargetMap = new Map<string, number>();

    // Log each followed controller's status — round1 imported from shared module

    // Build map of last adjusted_against_timestamp per controller — BATCHED single query
    const lastAdjTimestampMap = new Map<string, string>();
    {
      const allIds = followedControllersFullData.map(c => c.controller_id);
      const { data: allLastAdj } = await supabase
        .from('auto_cooling_adjustments')
        .select('cooler_controller_id, adjusted_against_timestamp, created_at')
        .in('cooler_controller_id', allIds)
        .not('adjusted_against_timestamp', 'is', null)
        .order('created_at', { ascending: false });
      
      // Keep only the most recent per controller
      if (allLastAdj) {
        for (const adj of allLastAdj) {
          if (!lastAdjTimestampMap.has(adj.cooler_controller_id)) {
            lastAdjTimestampMap.set(adj.cooler_controller_id, adj.adjusted_against_timestamp);
          }
        }
      }
    }

    // Store full data for logging after profile targets are resolved
    const followedDataForLog: Array<{controller: typeof followedControllersFullData[0], pillTemp: number|null, currentTemp: number, targetTemp: number, hysteresis: number, isActivelyCooling: boolean, pillDelta: number|null}> = [];
    followedControllersFullData.forEach(controller => {
      const pillTemp = round1(controller.pill_temp);
      const currentTemp = round1(controller.current_temp ?? controller.pill_temp) ?? 0;
      const targetTemp = round1(controller.target_temp) ?? 999;
      const hysteresis = parseFloat(String(controller.cooling_hysteresis ?? '0.2'));
      const isActivelyCooling = controller.cooling_enabled && currentTemp > (targetTemp + hysteresis);
      const pillDelta = pillTemp !== null ? round1(pillTemp - currentTemp) : null;
      followedDataForLog.push({controller, pillTemp, currentTemp, targetTemp, hysteresis, isActivelyCooling, pillDelta});
    });

    // Controllers with active fermentation profiles — profile owns the temperature
    const profileOwnedControllerIds = new Set<string>();
    // Map controller_id → profile target temp (the REAL goal, not the compensated controller target)
    const profileTargetMap = new Map<string, number>();
    // Map controller_id → brew_id from running fermentation session
    const sessionBrewIdMap = new Map<string, string>();
    // Check for 30-min cooloff after fermentation profile adjustments
    const cooloffControllerIds = new Set<string>();
    // Collect profile status per controller for consolidated logging
    const profileStatusMap = new Map<string, { profileTarget: number | null; stepIndex: number; hasCooloff: boolean; activeTarget?: number | null }>();
    // Always fetch profile data (needed for correct original_target in all modes)
    {
      const { data: runningSessions } = await supabase
        .from('fermentation_sessions')
        .select('id, controller_id, profile_id, current_step_index, step_started_at, step_start_temp, brew_id')
        .eq('status', 'running')
        .in('controller_id', followedControllerIds);

      if (runningSessions && runningSessions.length > 0) {
        // Pre-check cooloff for all sessions if needed
        const cooloffSet = new Set<string>();
        {
          const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
          const sessionIds = runningSessions.map(s => s.id);
          const { data: recentAdjs } = await supabase
            .from('fermentation_step_log')
            .select('session_id')
            .in('session_id', sessionIds)
            .eq('action', 'temp_adjusted')
            .gte('created_at', thirtyMinAgo);
          
          if (recentAdjs) {
            const sessionControllerMap = new Map(runningSessions.map(s => [s.id, s.controller_id]));
            for (const adj of recentAdjs) {
              const cId = sessionControllerMap.get(adj.session_id);
              if (cId) {
                cooloffSet.add(cId);
                cooloffControllerIds.add(cId);
              }
            }
          }
        }

        // Batch fetch all profile steps for all running sessions
        const uniqueProfileIds = [...new Set(runningSessions.map(s => s.profile_id))];
        const { data: allProfileSteps } = await supabase
          .from('fermentation_profile_steps')
          .select('profile_id, target_temp, step_order, step_type, duration_hours, ramp_type')
          .in('profile_id', uniqueProfileIds)
          .order('step_order', { ascending: true });
        
        const profileStepsMap = new Map<string, Array<{ target_temp: number | null; step_order: number; step_type: string; duration_hours: number | null; ramp_type: string | null }>>();
        if (allProfileSteps) {
          for (const step of allProfileSteps) {
            const list = profileStepsMap.get(step.profile_id) || [];
            list.push(step);
            profileStepsMap.set(step.profile_id, list);
          }
        }

        // ALL controllers with running sessions are profile-owned
        for (const session of runningSessions) {
          profileOwnedControllerIds.add(session.controller_id);
          if (session.brew_id) {
            sessionBrewIdMap.set(session.controller_id, session.brew_id);
          }
          
          let effectiveTarget: number | null = null;
          const profileSteps = profileStepsMap.get(session.profile_id);
          
          if (profileSteps && profileSteps.length > 0) {
            for (let i = Math.min(session.current_step_index, profileSteps.length - 1); i >= 0; i--) {
              if (profileSteps[i].target_temp !== null) {
                effectiveTarget = parseFloat(String(profileSteps[i].target_temp));
                break;
              }
            }
            if (effectiveTarget !== null) {
              profileTargetMap.set(session.controller_id, effectiveTarget);
            }
          }

          // Calculate interpolated ramp target if applicable
          let activeTarget: number | null = null;
          if (profileSteps && profileSteps.length > 0) {
            const currentStepIdx = Math.min(session.current_step_index, profileSteps.length - 1);
            const currentStep = profileSteps[currentStepIdx];
            if (currentStep.step_type === 'ramp' && currentStep.ramp_type !== 'immediate' && currentStep.duration_hours && currentStep.duration_hours > 0) {
              const stepStartTemp = session.step_start_temp != null ? parseFloat(String(session.step_start_temp)) : null;
              const stepTarget = currentStep.target_temp != null ? parseFloat(String(currentStep.target_temp)) : null;
              if (stepStartTemp != null && stepTarget != null && session.step_started_at) {
                const elapsedMs = Date.now() - new Date(session.step_started_at).getTime();
                const elapsedHours = elapsedMs / (1000 * 60 * 60);
                const progress = Math.min(elapsedHours / currentStep.duration_hours, 1);
                activeTarget = round1(stepStartTemp + (stepTarget - stepStartTemp) * progress);
              }
            }
          }

          profileStatusMap.set(session.controller_id, {
            profileTarget: effectiveTarget,
            stepIndex: session.current_step_index,
            hasCooloff: cooloffSet.has(session.controller_id),
            activeTarget,
          });
        }

        // Profile status is now included in FOLLOWED_DATA below
      }
    }

    // NOW populate originalTargetMap — after profileOwnedControllerIds is filled
    // BATCHED: single query for all non-profile-owned controllers
    {
      const nonProfileIds = followedControllersFullData
        .filter(c => !profileOwnedControllerIds.has(c.controller_id))
        .map(c => c.controller_id);
      
      if (nonProfileIds.length > 0) {
        const { data: allPrevAdj } = await supabase
          .from('auto_cooling_adjustments')
          .select('cooler_controller_id, old_target_temp, original_target_temp, created_at')
          .in('cooler_controller_id', nonProfileIds)
          .like('reason', '🌡️%')
          .order('created_at', { ascending: true });
        
        if (allPrevAdj) {
          // Keep the FIRST (oldest) per controller to find the original target
          for (const adj of allPrevAdj) {
            if (!originalTargetMap.has(adj.cooler_controller_id)) {
              originalTargetMap.set(adj.cooler_controller_id, adj.original_target_temp ?? adj.old_target_temp);
            }
          }
        }
      }
    }

    // Now log FOLLOWED_DATA with correct original_target (profile target takes precedence)
    for (const entry of followedDataForLog) {
      const { controller, pillTemp, currentTemp, targetTemp, isActivelyCooling, pillDelta } = entry;
      const profileTarget = profileTargetMap.get(controller.controller_id);
      const originalTarget = profileTarget !== undefined
        ? profileTarget
        : (round1(originalTargetMap.get(controller.controller_id) ?? null) ?? targetTemp);
      
      const profileInfo = profileStatusMap.get(controller.controller_id);
      const details: Record<string, unknown> = {
        original_target: originalTarget,
        last_update: controller.last_update
          ? new Date(controller.last_update).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : null,
        target_temp: targetTemp,
        current_temp: currentTemp,
        pill_temp: pillTemp,
        pill_delta: pillDelta,
        cooling_enabled: controller.cooling_enabled,
        is_actively_cooling: isActivelyCooling,
      };
      if (profileInfo) {
        details.profile_target = profileInfo.profileTarget;
        if (profileInfo.activeTarget != null && profileInfo.activeTarget !== profileInfo.profileTarget) {
          details.profile_active_target = profileInfo.activeTarget;
        }
        details.profile_step = profileInfo.stepIndex;
        if (profileInfo.hasCooloff) details.profile_cooloff = true;
      }
      log('FOLLOWED_DATA', 'info', `Controller: ${controller.name}`, details);
    }

    // PROFILE_STATUS removed — all profile info is now embedded in FOLLOWED_DATA above

    // pillCompSettings already loaded above (needed for feature toggle check)

    const allAdjustments: Array<{ cooler: string; oldTarget: number; newTarget: number }> = [];

    // ====================================================================
    // FEATURE 1: PILL COMPENSATION (PID-based temperature control)
    // Handles both undershoot and overshoot via symmetric PI-regulator.
    // ====================================================================
    if (pillCompSettings.enabled) {
      log('PILL_COMP', 'info', '--- PID pill compensation check ---');

      // Build map of original targets for pill-comp (from 🎯 adjustments)
      const pillCompOriginalTargetMap = new Map<string, number>();
      {
        const nonProfileIds = followedControllersFullData
          .filter(c => !profileOwnedControllerIds.has(c.controller_id))
          .map(c => c.controller_id);

        if (nonProfileIds.length > 0) {
          const { data: pillCompAdj } = await supabase
            .from('auto_cooling_adjustments')
            .select('cooler_controller_id, original_target_temp, created_at')
            .in('cooler_controller_id', nonProfileIds)
            .like('reason', '🎯%')
            .order('created_at', { ascending: true });

          if (pillCompAdj) {
            for (const adj of pillCompAdj) {
              if (!pillCompOriginalTargetMap.has(adj.cooler_controller_id) && adj.original_target_temp != null) {
                pillCompOriginalTargetMap.set(adj.cooler_controller_id, parseFloat(String(adj.original_target_temp)));
              }
            }
          }
        }
      }

      for (const fc of followedControllersFullData) {
        // Skip profile-owned controllers — handled by process-fermentation-profiles
        if (profileOwnedControllerIds.has(fc.controller_id)) {
          continue;
        }

        // Skip cooloff controllers
        if (cooloffControllerIds.has(fc.controller_id)) {
          log('PILL_COMP_SKIP', 'info', `${fc.name}: 30min cooloff active, skipping pill-comp`);
          continue;
        }

        // Must have heating OR cooling active
        if (!fc.heating_enabled && !fc.cooling_enabled) {
          continue;
        }

        // Must have pill data
        if (fc.pill_temp === null || fc.pill_temp === undefined) {
          continue;
        }

        // Same-data guard
        const lastAdjTs = lastAdjTimestampMap.get(fc.controller_id);
        if (lastAdjTs && fc.last_update && lastAdjTs === fc.last_update) {
          log('PILL_COMP_SKIP', 'info', `${fc.name}: Samma data som senaste justering (${fc.last_update}), hoppar över`);
          continue;
        }

        const targetTemp = parseFloat(String(fc.target_temp ?? '20'));

        // Determine the "base target" — the intended goal before any pill-comp
        const baseTarget = pillCompOriginalTargetMap.get(fc.controller_id) ?? targetTemp;

        // Determine mode based on which system is active
        const pidMode: 'heating' | 'cooling' = fc.cooling_enabled ? 'cooling' : 'heating';

        const compensation = await calculateCompensatedTarget(
          supabase, fc.controller_id, baseTarget, targetTemp,
          fc.name || fc.controller_id, pillCompSettings, pidMode, 'standalone'
        );

        if (!compensation) {
          continue;
        }

        // Safety bounds
        const maxTemp = parseFloat(String(fc.max_target_temp ?? '25'));
        const minTemp = parseFloat(String(fc.min_target_temp ?? '-5'));
        let newTarget = Math.max(minTemp, Math.min(maxTemp, compensation.compensatedTarget));

        if (Math.abs(newTarget - targetTemp) < 0.1) {
          continue;
        }

        const learnedInfo = compensation.learnedBaseline > 0 ? `, learned=${compensation.learnedBaseline.toFixed(2)}[${compensation.deltaBucket}]n=${compensation.convergenceCount}` : ''
        const piTermInfo = compensation.errorCorrection !== 0 ? `, PI=${compensation.errorCorrection >= 0 ? '+' : ''}${compensation.errorCorrection.toFixed(2)}°C(P=${compensation.pCorrection?.toFixed(2) ?? '0'},I=${compensation.iCorrection?.toFixed(2) ?? '0'}${learnedInfo})` : ''
        const dTermInfo = compensation.dampingFactor < 1.0
          ? `, D-term: rate=${compensation.pillRate?.toFixed(2) ?? '?'}°/h, ETA=${compensation.etaMinutes ?? '?'}min, damp=${compensation.dampingFactor.toFixed(2)}${piTermInfo}`
          : `, D-term: rate=${compensation.pillRate?.toFixed(2) ?? '?'}°/h, damp=1.0${piTermInfo}`

        log('PILL_COMP_ACTION', 'action', `${fc.name}: PID ${baseTarget.toFixed(1)}°C → ${newTarget.toFixed(1)}°C (delta=${compensation.avgDelta.toFixed(2)}, komp=${compensation.compensation.toFixed(2)}°C${dTermInfo})`);

        const success = await setControllerTargetTemp(supabaseUrl, supabaseKey, fc.controller_id, newTarget);

        if (success) {
          log('PILL_COMP_ACTION', 'pass', `Set ${fc.name} to ${newTarget}°C`);
          allAdjustments.push({ cooler: fc.name, oldTarget: targetTemp, newTarget });

          await supabase.from('rapt_temp_controllers')
            .update({ target_temp: newTarget, updated_at: new Date().toISOString() })
            .eq('controller_id', fc.controller_id);

          await supabase.from('auto_cooling_adjustments').insert({
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
            reason: `🎯 Pill-kompensation: ${baseTarget.toFixed(1)}°C → ${newTarget.toFixed(1)}°C (delta=${compensation.avgDelta.toFixed(2)}, komp=${compensation.compensation.toFixed(2)}°C${dTermInfo})`,
            adjusted_against_timestamp: fc.last_update,
          } as any);
        } else {
          log('PILL_COMP_ACTION', 'fail', `Failed to update ${fc.name}`);
        }
      }
    } else if (!pillCompSettings.enabled) {
      log('PILL_COMP', 'info', 'Pill compensation disabled');
    }

    // ====================================================================
    // FEATURE 2: STALL DETECTION (temp-delta + SG combined)
    // Detects fermentation stalls and auto-boosts temperature
    // ====================================================================
    const stallSettings = {
      enabled: (settings as any).auto_boost_enabled ?? false,
      boostDegrees: parseFloat(String((settings as any).auto_boost_degrees ?? 1.0)),
      sgRateThreshold: parseFloat(String((settings as any).stall_rate_threshold ?? 0.001)),
    };

    if (stallSettings.enabled) {
      log('STALL', 'info', '--- Stall detection check ---', {
        boost_degrees: stallSettings.boostDegrees,
        sg_rate_threshold: stallSettings.sgRateThreshold,
      });

      // Only check controllers with running fermentation sessions
      for (const session of (() => {
        const { data } = { data: [] as any[] };
        // Use runningSessions already fetched above (in profileOwnedControllerIds block)
        return [...profileOwnedControllerIds].map(cId => ({
          controller_id: cId,
          profileTarget: profileTargetMap.get(cId),
        }));
      })()) {
        const fc = followedControllersFullData.find(c => c.controller_id === session.controller_id);
        if (!fc) continue;

        // Need a linked brew to get SG data — prefer brew_id from session, fall back to linked_controller_id
        const sessionBrewId = sessionBrewIdMap.get(fc.controller_id);
        let brewLink: any = null;
        if (sessionBrewId) {
          const { data } = await supabase
            .from('brew_readings')
            .select('id, name, sg_data, original_gravity, final_gravity, status')
            .eq('id', sessionBrewId)
            .maybeSingle();
          brewLink = data;
        }
        if (!brewLink) {
          const { data } = await supabase
            .from('brew_readings')
            .select('id, name, sg_data, original_gravity, final_gravity, status')
            .eq('linked_controller_id', fc.controller_id)
            .in('status', ['Fermenting', 'Jäsning'])
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          brewLink = data;
        }

        if (!brewLink || !brewLink.sg_data) {
          log('STALL_SKIP', 'info', `${fc.name}: Ingen aktiv bryggning kopplad`);
          continue;
        }

        // Parse SG data and calculate rate
        const sgData = (Array.isArray(brewLink.sg_data) ? brewLink.sg_data : []) as Array<{ date: string; value: number; temp: number }>;
        const brewName = (brewLink as any).name ?? brewLink.id;

        if (sgData.length < 3) {
          log('STALL_SKIP', 'info', `${fc.name} (${brewName}): För lite SG-data (${sgData.length} punkter)`);
          continue;
        }

        // Sort by date descending
        const sortedSg = [...sgData].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        
        // Calculate SG rate over last 24h
        const now = Date.now();
        const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
        const recentSg = sortedSg.filter(p => new Date(p.date).getTime() > twentyFourHoursAgo);
        
        if (recentSg.length < 2) {
          // Still compute a rough rate from whatever data we have to show trend
          const latestSg = sortedSg[0];
          const secondLatest = sortedSg.length > 1 ? sortedSg[1] : null;
          const latestAgeHours = ((now - new Date(latestSg.date).getTime()) / (1000 * 60 * 60)).toFixed(1);
          let trendInfo = '';
          if (secondLatest) {
            const pairHours = (new Date(latestSg.date).getTime() - new Date(secondLatest.date).getTime()) / (1000 * 60 * 60);
            if (pairHours > 0) {
              const pairRate = ((secondLatest.value - latestSg.value) / pairHours) * 24;
              const threshold = stallSettings.sgRateThreshold;
              const pct = threshold > 0 ? ((pairRate / threshold) * 100).toFixed(0) : '?';
              trendInfo = `, senaste rate=${pairRate.toFixed(4)}/dag (${pct}% av tröskel ${threshold.toFixed(4)})`;
            }
          }
          log('STALL_SKIP', 'info', `${fc.name} (${brewName}): Inte tillräckligt med SG-data senaste 24h (${recentSg.length}/${sgData.length} punkter, senaste ${latestAgeHours}h sedan, SG=${latestSg.value.toFixed(4)}${trendInfo})`);
          continue;
        }

        const newestSg = recentSg[0];
        const oldestRecentSg = recentSg[recentSg.length - 1];
        const sgTimeDiffHours = (new Date(newestSg.date).getTime() - new Date(oldestRecentSg.date).getTime()) / (1000 * 60 * 60);
        
        if (sgTimeDiffHours < 6) {
          // Compute rate even though span is short, for visibility
          const shortDrop = oldestRecentSg.value - newestSg.value;
          const shortRate = sgTimeDiffHours > 0 ? (shortDrop / sgTimeDiffHours) * 24 : 0;
          const threshold = stallSettings.sgRateThreshold;
          const pct = threshold > 0 ? ((shortRate / threshold) * 100).toFixed(0) : '?';
          log('STALL_SKIP', 'info', `${fc.name} (${brewName}): SG-data spänner bara ${sgTimeDiffHours.toFixed(1)}h (behöver 6h+), rate=${shortRate.toFixed(4)}/dag (${pct}% av tröskel ${threshold.toFixed(4)}), SG=${newestSg.value.toFixed(4)}→${oldestRecentSg.value.toFixed(4)}`);
          continue;
        }

        const sgDrop = oldestRecentSg.value - newestSg.value; // positive = fermentation active
        const sgRatePerDay = (sgDrop / sgTimeDiffHours) * 24;
        const sgIsStalling = sgRatePerDay < stallSettings.sgRateThreshold;

        // Check temp delta trend (is fermentation heat decreasing?)
        const deltaHistory = await supabase
          .from('temp_delta_history')
          .select('delta, recorded_at')
          .eq('controller_id', fc.controller_id)
          .order('recorded_at', { ascending: false })
          .limit(12); // ~1 hour of data at 5min intervals

        const deltas = (deltaHistory.data || []).map((d: any) => parseFloat(String(d.delta)));
        
        let deltaIsDropping = false;
        let deltaIsLow = false; // pill ≈ controller, delta gives no signal
        let currentAvgDelta = 0;
        let oldAvgDelta = 0;
        
        if (deltas.length >= 6) {
          // Compare recent 3 vs older 3 deltas
          currentAvgDelta = deltas.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
          oldAvgDelta = deltas.slice(3, 6).reduce((a, b) => a + b, 0) / 3;
          // If delta has historically been meaningful (>0.5) and is now dropping → signal
          deltaIsDropping = oldAvgDelta > 0.5 && currentAvgDelta < oldAvgDelta - 0.1;
          // If delta is consistently low (<0.5), it provides no fermentation heat info
          // In this case we rely on SG-rate alone
          deltaIsLow = Math.max(currentAvgDelta, oldAvgDelta) < 0.5;
        } else {
          // Not enough delta data → treat as low delta (SG-only mode)
          deltaIsLow = true;
        }

        // Check if target SG has been reached (no stall if fermentation is done)
        const fg = parseFloat(String(brewLink.final_gravity ?? 0));
        const currentSg = newestSg.value;
        const fermentationComplete = fg > 0 && currentSg <= fg + 0.002;

        if (fermentationComplete) {
          log('STALL_SKIP', 'info', `${fc.name} (${brewName}): Jäsningen ser klar ut (SG ${currentSg.toFixed(4)} ≤ FG ${fg.toFixed(4)}+0.002)`);
          continue;
        }

        // Stall = SG stalling AND (delta dropping OR delta too low to be useful)
        const stallDetected = sgIsStalling && (deltaIsDropping || deltaIsLow);
        const stallThreshold = stallSettings.sgRateThreshold;
        const ratePct = stallThreshold > 0 ? ((sgRatePerDay / stallThreshold) * 100).toFixed(0) : '?';

        log('STALL_ANALYSIS', stallDetected ? 'action' : 'info', `${fc.name} (${brewName}): SG-rate=${sgRatePerDay.toFixed(4)}/dag (${ratePct}% av tröskel ${stallThreshold.toFixed(4)}), SG=${currentSg.toFixed(4)}, drop=${sgDrop.toFixed(4)}/${sgTimeDiffHours.toFixed(0)}h, delta: cur=${currentAvgDelta.toFixed(2)} old=${oldAvgDelta.toFixed(2)} (dropping=${deltaIsDropping}, low=${deltaIsLow})`, {
          sg_stalling: sgIsStalling,
          delta_dropping: deltaIsDropping,
          delta_is_low: deltaIsLow,
          stall_detected: stallDetected,
          sg_rate_pct_of_threshold: ratePct,
        });

        if (!stallDetected) continue;

        // Cooldown: don't boost same controller within 12 hours
        const { data: lastBoost } = await supabase
          .from('auto_cooling_adjustments')
          .select('created_at')
          .eq('cooler_controller_id', fc.controller_id)
          .like('reason', '🔥%')
          .order('created_at', { ascending: false })
          .limit(1);

        if (lastBoost && lastBoost.length > 0) {
          const lastBoostTime = new Date(lastBoost[0].created_at).getTime();
          const hoursSinceBoost = (now - lastBoostTime) / (1000 * 60 * 60);
          if (hoursSinceBoost < 12) {
            log('STALL_COOLDOWN', 'info', `${fc.name}: Senaste boost var ${hoursSinceBoost.toFixed(1)}h sedan (väntar 12h)`);
            continue;
          }
        }

        // Apply boost via PID compensation (keeps profile target / Mål line unchanged)
        const currentTarget = parseFloat(String(fc.target_temp ?? 20));
        const profileTarget = session.profileTarget ?? currentTarget;
        const boostDeg = stallSettings.boostDegrees;

        // Safety bounds check: would the boosted target exceed limits?
        const maxTemp = parseFloat(String(fc.max_target_temp ?? 25));
        const boostedTarget = currentTarget + boostDeg;
        if (boostedTarget > maxTemp) {
          log('STALL_SKIP', 'info', `${fc.name}: Boost blocked by safety bounds (${boostedTarget}°C > max=${maxTemp}°C)`);
          continue;
        }

        log('STALL_BOOST', 'action', `${fc.name}: Stall detekterad! Lägger till +${boostDeg}°C via PID-kompensation (profil-mål ${profileTarget}°C oförändrat)`);

        // Find or create the learned compensation record for this controller
        // Use a special delta_bucket "stall_boost" to track the offset separately
        const { data: existingComp } = await supabase
          .from('controller_learned_compensation')
          .select('id, learned_pi_correction, accumulated_integral')
          .eq('controller_id', fc.controller_id)
          .eq('delta_bucket', 'active')
          .eq('mode', fc.cooling_enabled ? 'cooling' : 'heating')
          .limit(1)
          .maybeSingle();

        if (existingComp) {
          // Add boost to the accumulated integral so PID applies it
          const newCorrection = existingComp.learned_pi_correction + boostDeg;
          await supabase.from('controller_learned_compensation')
            .update({
              learned_pi_correction: newCorrection,
              accumulated_integral: existingComp.accumulated_integral + boostDeg,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingComp.id);
          log('STALL_BOOST', 'pass', `${fc.name}: PID-kompensation höjd med +${boostDeg}°C (total: ${newCorrection.toFixed(2)}°C)`);
        } else {
          // No existing compensation record — apply boost directly via RAPT API as fallback
          const safeTarget = Math.min(maxTemp, boostedTarget);
          const boostSuccess = await setControllerTargetTemp(supabaseUrl, supabaseKey, fc.controller_id, safeTarget);
          if (boostSuccess) {
            await supabase.from('rapt_temp_controllers')
              .update({ target_temp: safeTarget, updated_at: new Date().toISOString() })
              .eq('controller_id', fc.controller_id);
            log('STALL_BOOST', 'pass', `${fc.name}: Direkt boost (ingen PID-post) ${currentTarget}°C → ${safeTarget}°C`);
          } else {
            log('STALL_BOOST', 'fail', `${fc.name}: Kunde inte höja temperaturen`);
            continue;
          }
        }

        allAdjustments.push({ cooler: fc.name, oldTarget: currentTarget, newTarget: boostedTarget });

        await supabase.from('auto_cooling_adjustments').insert({
          cooler_controller_id: fc.controller_id,
          cooler_controller_name: fc.name,
          old_target_temp: currentTarget,
          new_target_temp: Math.min(maxTemp, boostedTarget),
          original_target_temp: profileTarget,
          lowest_followed_temp: currentTarget,
          followed_controller_id: fc.controller_id,
          followed_controller_name: fc.name,
          followed_current_temp: parseFloat(String(fc.pill_temp ?? fc.current_temp ?? 0)),
          followed_target_temp: profileTarget,
          reason: `🔥 Stall: SG-rate ${sgRatePerDay.toFixed(4)}/dag, delta cur=${currentAvgDelta.toFixed(2)} old=${oldAvgDelta.toFixed(2)} (low=${deltaIsLow}), PID +${boostDeg}°C`,
        } as any);

        // Log in fermentation step log if session exists
        const { data: activeSession } = await supabase
          .from('fermentation_sessions')
          .select('id, current_step_index')
          .eq('controller_id', fc.controller_id)
          .eq('status', 'running')
          .limit(1)
          .maybeSingle();

        if (activeSession) {
          await supabase.from('fermentation_step_log').insert({
            session_id: activeSession.id,
            step_index: activeSession.current_step_index,
            action: 'stall_boost',
            details: {
              boost_degrees: boostDeg,
              via: existingComp ? 'pid_compensation' : 'direct',
              sg_rate_per_day: sgRatePerDay,
              current_sg: currentSg,
              profile_target: profileTarget,
              delta_current: currentAvgDelta,
              delta_old: oldAvgDelta,
              delta_is_low: deltaIsLow,
            },
          });
        }
      }
    } else {
      log('STALL', 'info', 'Stall detection disabled');
    }

    // ====================================================================
    // FEATURE 3: AUTO COOLING ADJUSTMENT (runs last)
    // ====================================================================
    if (coolingEnabled) {
      log('COOLING', 'info', '--- Auto cooling adjustment check ---');

      if (!settings.cooler_controller_id) {
        log('COOLER_CONFIG', 'fail', 'No cooler controller configured');
      } else {
        // Get cooler controller data
        const { data: coolerData, error: coolerError } = await supabase
          .from('rapt_temp_controllers')
          .select('*')
          .eq('controller_id', settings.cooler_controller_id)
          .eq('cooling_enabled', true)
          .single();

        const coolerController = coolerData as TempController | null;

        if (coolerError || !coolerController) {
          log('COOLER_STATUS', 'fail', 'Cooler controller not found or cooling not enabled');
        } else {
          log('COOLER_STATUS', 'pass', `Cooler: ${coolerController.name}`, {
            target_temp: round1(coolerController.target_temp),
            current_temp: round1(coolerController.current_temp)
          });

          const currentCoolerTarget = parseFloat(String(coolerController.target_temp ?? '18'));

          // Check if any followed controller has cooling enabled
          const controllersWithCooling = followedControllersFullData.filter(c => c.cooling_enabled === true);

          if (controllersWithCooling.length === 0) {
            log('COOLING_CAPABILITY', 'fail', 'No followed controller has cooling enabled');

            const defaultTemp = 18;
            if (Math.abs(currentCoolerTarget - defaultTemp) > 0.1) {
              const coolerMinTemp = parseFloat(String(coolerController.min_target_temp ?? '-5'));
              const coolerMaxTemp = parseFloat(String(coolerController.max_target_temp ?? '25'));

              if (defaultTemp >= coolerMinTemp && defaultTemp <= coolerMaxTemp) {
                log('ADJUSTMENT', 'action', `Setting cooler to default ${defaultTemp}°C`);

                const defaultSuccess = await setControllerTargetTemp(supabaseUrl, supabaseKey, coolerController.controller_id, defaultTemp);

                if (defaultSuccess) {
                  log('ADJUSTMENT', 'pass', `Set cooler to ${defaultTemp}°C`);

                  await supabase.from('auto_cooling_adjustments').insert({
                    cooler_controller_id: coolerController.controller_id,
                    cooler_controller_name: coolerController.name,
                    old_target_temp: currentCoolerTarget,
                    new_target_temp: defaultTemp,
                    lowest_followed_temp: 0,
                    reason: 'Ingen följd controller är aktiv med kyla'
                  } as any);

                  allAdjustments.push({ cooler: coolerController.name, oldTarget: currentCoolerTarget, newTarget: defaultTemp });
                }
              }
            }
          } else {
            log('COOLING_CAPABILITY', 'pass', `${controllersWithCooling.length} controller(s) have cooling enabled`);

            // Find the controller with the lowest target temperature AMONG those with cooling enabled
            const lowestTempController = controllersWithCooling.reduce((lowest, current) => {
              const currentTarget = parseFloat(String(current.target_temp ?? '999'));
              const lowestTarget = parseFloat(String(lowest.target_temp ?? '999'));
              return currentTarget < lowestTarget ? current : lowest;
            });

            const lowestTargetTemp = parseFloat(String(lowestTempController.target_temp ?? '999'));

            log('LOWEST_CONTROLLER', 'info', `Lowest target with cooling: ${lowestTempController.name}`, {
              target_temp: round1(lowestTargetTemp),
              cooler_target: round1(currentCoolerTarget),
              diff: round1(currentCoolerTarget - lowestTargetTemp)
            });

            // Temperature difference analysis
            const tempDiff = currentCoolerTarget - lowestTargetTemp;

            // Check if cooler is more than 10 degrees COLDER
            if (tempDiff < -10) {
              log('OVERCOOLING_CHECK', 'info', `Cooler is ${Math.abs(tempDiff).toFixed(1)}°C colder than lowest`);

              const newTarget = lowestTargetTemp - 10;
              const coolerMinTemp = parseFloat(String(coolerController.min_target_temp ?? '-5'));
              const coolerMaxTemp = parseFloat(String(coolerController.max_target_temp ?? '25'));

              if (newTarget > currentCoolerTarget && newTarget >= coolerMinTemp && newTarget <= coolerMaxTemp) {
                log('ADJUSTMENT', 'action', `Increasing cooler from ${currentCoolerTarget}°C to ${newTarget}°C`);

                const overCoolSuccess = await setControllerTargetTemp(supabaseUrl, supabaseKey, coolerController.controller_id, newTarget);

                if (overCoolSuccess) {
                  log('ADJUSTMENT', 'pass', `Increased cooler to ${newTarget}°C`);

                  await supabase.from('auto_cooling_adjustments').insert({
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
                    reason: `Cooler was ${Math.abs(tempDiff).toFixed(1)}°C colder than needed`
                  } as any);

                  allAdjustments.push({ cooler: coolerController.name, oldTarget: currentCoolerTarget, newTarget });
                }
              }
            }

            // Check if lowest controller is actively cooling
            const lowestCurrentTemp = parseFloat(String(lowestTempController.current_temp ?? lowestTempController.pill_temp ?? '0'));
            const lowestHysteresis = parseFloat(String(lowestTempController.cooling_hysteresis ?? '0.2'));
            const coolingThreshold = lowestTargetTemp + lowestHysteresis;
            const isActivelyCooling = lowestCurrentTemp > coolingThreshold;

            log('ACTIVE_COOLING_CHECK', isActivelyCooling ? 'pass' : 'info',
              isActivelyCooling ? `${lowestTempController.name} IS actively cooling` : `${lowestTempController.name} is NOT actively cooling`, {
              current_temp: round1(lowestCurrentTemp),
              threshold: round1(coolingThreshold)
            });

            if (isActivelyCooling) {
              // Check interval
              const now = new Date();
              const checkIntervalMs = settings.check_interval_minutes * 60 * 1000;

              let intervalPassed = true;
              if (settings.last_check_at) {
                const lastCheckTime = new Date(settings.last_check_at);
                const timeSinceLastCheck = now.getTime() - lastCheckTime.getTime();
                const remainingMs = checkIntervalMs - timeSinceLastCheck;

                if (timeSinceLastCheck < checkIntervalMs) {
                  const remainingMinutes = Math.ceil(remainingMs / 60000);
                  log('INTERVAL_CHECK', 'fail', `Must wait ${remainingMinutes} more minutes`);
                  intervalPassed = false;
                } else {
                  log('INTERVAL_CHECK', 'pass', 'Enough time has passed');
                }
              } else {
                log('INTERVAL_CHECK', 'pass', 'No previous check recorded');
              }

              if (intervalPassed) {
                // Check history
                const checkTime = new Date(Date.now() - settings.check_interval_minutes * 60 * 1000);

                const { data: historyData, error: historyError } = await supabase
                  .from('temp_controller_history')
                  .select('*')
                  .eq('controller_id', lowestTempController.controller_id)
                  .gte('recorded_at', checkTime.toISOString())
                  .order('recorded_at', { ascending: false });

                const history = historyData as HistoryRecord[] | null;

                if (historyError || !history || history.length < 2) {
                  log('HISTORY_CHECK', 'fail', 'Not enough history data', { records_found: history?.length ?? 0 });
                } else {
                  log('HISTORY_CHECK', 'pass', `Found ${history.length} history records`);

                  const allActivelyCooling = history.every(record => {
                    return record.cooling_enabled === true && record.current_temp > (record.target_temp + lowestHysteresis);
                  });

                  log('SUSTAINED_COOLING_CHECK', allActivelyCooling ? 'pass' : 'fail',
                    allActivelyCooling ? 'Controller has been trying to cool for entire interval' : 'Controller was NOT actively cooling for entire interval');

                  if (allActivelyCooling) {
                    log('DECISION', 'action', `${lowestTempController.name} has been struggling to cool`, {
                      current_temp: lowestCurrentTemp,
                      target_temp: lowestTargetTemp
                    });

                    await (supabase as any).from('auto_cooling_settings').update({ last_check_at: new Date().toISOString() }).eq('id', settings.id);

                    // === DELTA ANALYSIS ===
                    let deltaMultiplier = 1.0;

                    // Batch: fetch recent delta history for all followed controllers (last 24h)
                    const batchDeltaMap = new Map<string, Array<{ delta: number; recorded_at: string }>>();
                    {
                      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                      const { data: allDeltaHistory } = await supabase
                        .from('temp_delta_history')
                        .select('controller_id, delta, recorded_at')
                        .in('controller_id', followedControllerIds)
                        .gte('recorded_at', twentyFourHoursAgo)
                        .order('recorded_at', { ascending: false });
                      
                      if (allDeltaHistory) {
                        for (const d of allDeltaHistory) {
                          const list = batchDeltaMap.get(d.controller_id) || [];
                          if (list.length < 5) list.push(d);
                          batchDeltaMap.set(d.controller_id, list);
                        }
                      }
                    }

                    // Batch: fetch all unacknowledged delta alerts for followed controllers
                    const existingAlertControllerIds = new Set<string>();
                    {
                      const { data: allAlerts } = await supabase
                        .from('temp_delta_alerts')
                        .select('controller_id')
                        .in('controller_id', followedControllerIds)
                        .eq('acknowledged', false);
                      
                      if (allAlerts) {
                        for (const a of allAlerts) existingAlertControllerIds.add(a.controller_id);
                      }
                    }

                    for (const fc of followedControllersFullData) {
                      if (fc.pill_temp === null || fc.pill_temp === undefined || fc.current_temp === null || fc.current_temp === undefined) continue;

                      const pillTemp = parseFloat(String(fc.pill_temp));
                      const ctrlTemp = parseFloat(String(fc.current_temp));
                      const currentDelta = pillTemp - ctrlTemp;

                      log('DELTA_ANALYSIS', 'info', `${fc.name}: pill=${pillTemp.toFixed(1)}° ctrl=${ctrlTemp.toFixed(1)}° delta=${currentDelta >= 0 ? '+' : ''}${currentDelta.toFixed(1)}°`);

                      const deltaHistory = batchDeltaMap.get(fc.controller_id);

                      if (deltaHistory && deltaHistory.length >= 2) {
                        const recentDeltas = deltaHistory.map(d => parseFloat(String(d.delta)));
                        const avgRecentDelta = recentDeltas.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
                        const avgOlderDelta = recentDeltas.slice(2).reduce((a, b) => a + b, 0) / Math.max(recentDeltas.length - 2, 1);
                        const deltaRising = avgRecentDelta > avgOlderDelta + 0.1;

                        if (deltaRising) {
                          deltaMultiplier = Math.max(deltaMultiplier, 1.5);
                          log('DELTA_TREND', 'action', `Delta RISING for ${fc.name} (${avgOlderDelta.toFixed(1)}° → ${avgRecentDelta.toFixed(1)}°)`);
                        }
                      }

                      if (currentDelta > 1.5) {
                        deltaMultiplier = Math.max(deltaMultiplier, 2.0);
                        log('DELTA_HIGH', 'action', `High delta (${currentDelta.toFixed(1)}°) for ${fc.name} — doubling reduction`);
                      }

                      // Generate alert if delta exceeds threshold
                      const alertThreshold = settings.delta_alert_threshold ?? 2.0;
                      if (currentDelta > alertThreshold && !existingAlertControllerIds.has(fc.controller_id)) {
                        await supabase.from('temp_delta_alerts').insert({
                          controller_id: fc.controller_id,
                          delta: currentDelta,
                          alert_type: 'high_delta'
                        } as any);
                        existingAlertControllerIds.add(fc.controller_id);
                        log('DELTA_ALERT', 'pass', `Alert created for ${fc.name}`);
                      }
                    }

                    const baseTempReduction = parseFloat(String(settings.temp_reduction_degrees));
                    const effectiveTempReduction = baseTempReduction * deltaMultiplier;

                    if (deltaMultiplier > 1.0) {
                      log('DELTA_ADJUSTMENT', 'action', `Delta multiplier: ${deltaMultiplier}x (${baseTempReduction}°C → ${effectiveTempReduction.toFixed(1)}°C reduction)`);
                    }

                    const proposedNewTarget = currentCoolerTarget - effectiveTempReduction;
                    const maxAllowedTarget = lowestTargetTemp - parseFloat(String(settings.max_diff_from_lowest));

                    let finalTarget = proposedNewTarget;
                    if (proposedNewTarget < maxAllowedTarget) {
                      finalTarget = maxAllowedTarget;
                      log('TARGET_CALCULATION', 'info', `Limited by max_diff_from_lowest to ${finalTarget.toFixed(1)}°C`);
                    }

                    if (finalTarget < currentCoolerTarget) {
                      const coolerMinTemp = parseFloat(String(coolerController.min_target_temp ?? '-5'));
                      const coolerMaxTemp = parseFloat(String(coolerController.max_target_temp ?? '25'));

                      if (finalTarget < coolerMinTemp) {
                        log('ADJUSTMENT', 'fail', `Cannot set cooler below minimum (${coolerMinTemp}°C)`);
                      } else if (finalTarget > coolerMaxTemp) {
                        log('ADJUSTMENT', 'fail', `Cannot set cooler above maximum (${coolerMaxTemp}°C)`);
                      } else {
                        log('ADJUSTMENT', 'action', `Lowering cooler from ${currentCoolerTarget}°C to ${finalTarget}°C`);

                        const lowerSuccess = await setControllerTargetTemp(supabaseUrl, supabaseKey, coolerController.controller_id, finalTarget);

                        if (lowerSuccess) {
                          log('ADJUSTMENT', 'pass', `Updated cooler to ${finalTarget}°C`);
                          allAdjustments.push({ cooler: coolerController.name, oldTarget: currentCoolerTarget, newTarget: finalTarget });

                          const lowestFollowedTemp = followedControllersFullData
                            .map(c => parseFloat(String(c.current_temp ?? c.pill_temp ?? '999')))
                            .reduce((min, temp) => Math.min(min, temp), 999);

                          await supabase.from('auto_cooling_adjustments').insert({
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
                            reason: `${lowestTempController.name} struggling to cool`
                          } as any);
                        } else {
                          log('ADJUSTMENT', 'fail', 'Failed to update cooler controller');
                        }
                      }
                    } else {
                      log('ADJUSTMENT', 'info', 'Cooler target would not be lowered');
                    }
                  } else {
                    await (supabase as any).from('auto_cooling_settings').update({ last_check_at: new Date().toISOString() }).eq('id', settings.id);
                    // Sustained cooling check failed but controller IS actively cooling
                    // Still check if cooler needs recovery/adjustment toward ideal
                  }
                }
              }
            } else {
              // Not actively cooling - reset timer
              await (supabase as any).from('auto_cooling_settings').update({ last_check_at: null }).eq('id', settings.id);
              log('TIMER', 'info', 'Reset timer - not actively cooling');
            }

            // Always check recovery: move cooler toward ideal target regardless of active cooling state
            {
              const idealTarget = lowestTargetTemp - parseFloat(String(settings.temp_reduction_degrees));
              const coolerMinTemp = parseFloat(String(coolerController.min_target_temp ?? '-5'));
              const coolerMaxTemp = parseFloat(String(coolerController.max_target_temp ?? '25'));

              const needsLowering = currentCoolerTarget > idealTarget + 0.2;
              const needsRaising = currentCoolerTarget < idealTarget - 0.2;

              log('COOLING_RECOVERY_CHECK', 'info', `Recovery check: cooler=${currentCoolerTarget}°C, ideal=${idealTarget.toFixed(1)}°C, needs_lowering=${needsLowering}, needs_raising=${needsRaising}`);

              if (needsLowering || needsRaising) {
                try {
                // Check interval guard: don't adjust more often than every 30 minutes
                const RECOVERY_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
                const { data: lastRecovery, error: recoveryQueryError } = await supabase
                  .from('auto_cooling_adjustments')
                  .select('created_at')
                  .like('reason', '%Cooling recovery%')
                  .order('created_at', { ascending: false })
                  .limit(1);

                if (recoveryQueryError) {
                  log('COOLING_RECOVERY', 'fail', `Query error: ${recoveryQueryError.message}`);
                }

                const lastRecoveryTime = lastRecovery?.[0]?.created_at ? new Date(lastRecovery[0].created_at).getTime() : 0;
                const timeSinceLastRecovery = Date.now() - lastRecoveryTime;

                log('COOLING_RECOVERY_INTERVAL', 'info', `Last recovery: ${lastRecoveryTime === 0 ? 'never' : `${Math.round(timeSinceLastRecovery / 60000)}min ago`}, need ${RECOVERY_INTERVAL_MS / 60000}min`);

                if (timeSinceLastRecovery < RECOVERY_INTERVAL_MS) {
                  log('COOLING_RECOVERY', 'info', `Skipping recovery - only ${Math.round(timeSinceLastRecovery / 60000)}min since last (need ${RECOVERY_INTERVAL_MS / 60000}min)`);
                } else {
                  // Set directly to ideal — glycol cooler doesn't need ramping
                  let recoveryTarget = Math.round(idealTarget * 10) / 10;
                  recoveryTarget = Math.max(coolerMinTemp, Math.min(coolerMaxTemp, recoveryTarget));

                  const significantChange = needsLowering
                    ? recoveryTarget <= currentCoolerTarget - 0.1
                    : recoveryTarget >= currentCoolerTarget + 0.1;

                  if (significantChange) {
                    const direction = needsLowering ? 'Sänker' : 'Höjer';
                    log('COOLING_RECOVERY', 'action', `${direction} cooler from ${currentCoolerTarget}°C toward ideal ${idealTarget.toFixed(1)}°C → ${recoveryTarget}°C`);

                    const coolRecSuccess = await setControllerTargetTemp(supabaseUrl, supabaseKey, coolerController.controller_id, recoveryTarget);

                    if (coolRecSuccess) {
                      log('COOLING_RECOVERY', 'pass', `Set cooler to ${recoveryTarget}°C`);
                      allAdjustments.push({ cooler: coolerController.name, oldTarget: currentCoolerTarget, newTarget: recoveryTarget });

                      await supabase.from('auto_cooling_adjustments').insert({
                        cooler_controller_id: coolerController.controller_id,
                        cooler_controller_name: coolerController.name,
                        old_target_temp: currentCoolerTarget,
                        new_target_temp: recoveryTarget,
                        lowest_followed_temp: lowestTargetTemp,
                        followed_controller_id: lowestTempController.controller_id,
                        followed_controller_name: lowestTempController.name,
                        followed_current_temp: lowestCurrentTemp,
                        followed_target_temp: lowestTargetTemp,
                        reason: `🔄 Cooling recovery: ${needsLowering ? 'kylbehov ökat' : 'kylbehov minskat'}, ${needsLowering ? 'sänker' : 'höjer'} mot ideal ${idealTarget.toFixed(1)}°C`
                      } as any);
                    } else {
                      log('COOLING_RECOVERY', 'fail', `Failed to update cooler`);
                    }
                  }
                }
                } catch (recoveryError) {
                  log('COOLING_RECOVERY', 'fail', `Recovery error: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`);
                }
              }
            }
          }
        }
      }
    } else {
      log('COOLING', 'info', 'Auto cooling adjustment disabled');
    }

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
